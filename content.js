/* Digikala Price Tracker — content script.
 *
 * Extracts the product id, variant, title and prices from a Digikala
 * product page and records price points in chrome.storage.local.
 *
 * Extraction strategies for the current price (first success wins):
 *  1. DOM landmarks (verified against live pages 2026-11-12): the seller
 *     box above the "افزودن به سبد خرید" button holds, in order, the old
 *     price, the discount %, and the current price followed by تومان.
 *     Prices use Persian digits with Latin commas. Related-product cards
 *     lower on the page repeat the same triplet, so extraction anchors on
 *     the Add-to-cart button instead of taking the first match on the page.
 *  2. JSON-LD offers.price (priceCurrency IRR is divided by 10 -> Tomans).
 *
 * __NEXT_DATA__ parsing is intentionally NOT used: whether its prices are
 * in Rials or Tomans could not be verified, and a 10x-wrong guess is worse
 * than no record. If DOM and JSON-LD both fail, nothing is recorded.
 *
 * Prices are variant-specific on Digikala (colour/storage selector), so
 * history is keyed by product id + variant_id from the URL.
 *
 * Exposes window.__dkTracker for testing.
 */
(function () {
  'use strict';

  var STORAGE_KEY = 'dk-products-v1';
  var MAX_POINTS = 500;
  var MIN_PRICE_TOMAN = 1000;
  var REDUNDANT_WINDOW_MS = 6 * 3600 * 1000;

  var FA_DIGITS = {
    '۰': '0', '۱': '1', '۲': '2', '۳': '3', '۴': '4',
    '۵': '5', '۶': '6', '۷': '7', '۸': '8', '۹': '9',
    '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4',
    '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9'
  };

  function toLatinDigits(s) {
    return String(s).replace(/[۰-۹٠-٩]/g, function (ch) { return FA_DIGITS[ch]; });
  }

  /* "۲,۳۸۹,۹۹۰" -> 2389990 ; "۵۴" -> 54 ; anything else -> null */
  function parseFaNumber(s) {
    if (s == null) return null;
    var cleaned = toLatinDigits(String(s)).replace(/[,\s٬‌ ]/g, '');
    if (!/^\d+$/.test(cleaned)) return null;
    var n = parseInt(cleaned, 10);
    return isFinite(n) ? n : null;
  }

  function productIdFromUrl(url) {
    var m = /\/product\/dkp-(\d+)/.exec(url || '');
    return m ? m[1] : null;
  }

  function variantFromUrl(url) {
    try { return new URL(url).searchParams.get('variant_id'); }
    catch (e) { return null; }
  }

  function leafElements(root) {
    var out = [];
    var all = root.querySelectorAll('*');
    for (var i = 0; i < all.length; i++) {
      if (all[i].children.length === 0) out.push(all[i]);
    }
    return out;
  }

  /* Parse the old/discount/current triplet inside one container element.
   * The current price is the LARGEST تومان value in the container: the
   * seller box may also mention a lower "best price in 30 days" or
   * instalment amounts, and the struck-through old price carries no تومان
   * marker. Related-product cards are outside the anchored container, so
   * their prices are never seen here. */
  function parseTriplet(container) {
    var leaves = leafElements(container);
    var tomanValues = [];
    var discount = null;
    var pureNumbers = [];
    for (var i = 0; i < leaves.length; i++) {
      var t = (leaves[i].textContent || '').trim();
      if (!t) continue;
      if (t.indexOf('تومان') !== -1) {
        var v = parseFaNumber(t.replace(/تومان/g, ''));
        if (v != null && v >= MIN_PRICE_TOMAN) tomanValues.push(v);
        continue;
      }
      if (/[٪%]/.test(t)) {
        var d = parseFaNumber(t.replace(/[٪%]/g, ''));
        if (d != null && d > 0 && d < 100 && discount == null) discount = d;
        continue;
      }
      var v2 = parseFaNumber(t);
      if (v2 != null && v2 >= MIN_PRICE_TOMAN) {
        /* Number split from its تومان marker in the next sibling element. */
        var sib = leaves[i].nextElementSibling;
        if (sib && (sib.textContent || '').indexOf('تومان') !== -1) {
          tomanValues.push(v2);
          continue;
        }
        pureNumbers.push(v2);
      }
    }
    if (!tomanValues.length) return { price: null, oldPrice: null, discount: null };
    var current = Math.max.apply(null, tomanValues);
    /* Old price: first bare number higher than the current price. */
    var oldPrice = null;
    for (var k = 0; k < pureNumbers.length; k++) {
      if (pureNumbers[k] > current) { oldPrice = pureNumbers[k]; break; }
    }
    return { price: current, oldPrice: oldPrice, discount: discount };
  }

  function extractFromDom(doc) {
    var buttons = doc.querySelectorAll('button, a, [role="button"]');
    var buttonEl = null;
    for (var i = 0; i < buttons.length; i++) {
      if ((buttons[i].textContent || '').indexOf('افزودن به سبد خرید') !== -1) {
        buttonEl = buttons[i];
        break;
      }
    }
    if (!buttonEl) {
      /* Fallback: parse the whole document body. */
      return parseTriplet(doc.body || doc.documentElement);
    }
    /* Smallest ancestor of the button that contains a تومان marker. */
    var container = null;
    var node = buttonEl.parentElement;
    for (var level = 0; level < 8 && node; level++) {
      if ((node.textContent || '').indexOf('تومان') !== -1) { container = node; break; }
      node = node.parentElement;
    }
    if (!container) return { price: null, oldPrice: null, discount: null };
    return parseTriplet(container);
  }

  function findProductOffer(node, depth) {
    if (!node || typeof node !== 'object' || depth > 4) return null;
    if (Array.isArray(node)) {
      for (var i = 0; i < node.length; i++) {
        var r = findProductOffer(node[i], depth + 1);
        if (r) return r;
      }
      return null;
    }
    var type = node['@type'];
    var isProduct = type === 'Product' ||
      (Array.isArray(type) && type.indexOf('Product') !== -1);
    if (isProduct && node.offers) {
      var offers = Array.isArray(node.offers) ? node.offers[0] : node.offers;
      if (offers && offers.price != null) {
        var p = typeof offers.price === 'number'
          ? offers.price
          : parseFaNumber(offers.price);
        if (p != null && p >= 100) {
          if (offers.priceCurrency === 'IRR') p = Math.round(p / 10);
          if (p >= MIN_PRICE_TOMAN) return { price: p, source: 'jsonld' };
        }
      }
    }
    for (var k in node) {
      var found = findProductOffer(node[k], depth + 1);
      if (found) return found;
    }
    return null;
  }

  function extractFromJsonLd(doc) {
    var scripts = doc.querySelectorAll('script[type="application/ld+json"]');
    for (var i = 0; i < scripts.length; i++) {
      var data = null;
      try { data = JSON.parse(scripts[i].textContent || ''); }
      catch (e) { continue; }
      var found = findProductOffer(data, 0);
      if (found) return found;
    }
    return null;
  }

  function extractProduct(doc, url) {
    var id = productIdFromUrl(url);
    if (!id) return null;
    var h1 = doc.querySelector('h1');
    var title = h1 ? (h1.textContent || '').trim() : '';
    var dom = extractFromDom(doc);
    var price = dom.price;
    var oldPrice = dom.oldPrice;
    var discount = dom.discount;
    var source = 'dom';
    if (price == null) {
      var jl = extractFromJsonLd(doc);
      if (jl) { price = jl.price; source = 'jsonld'; }
    }
    if (price == null) return null;
    return {
      id: id,
      variant: variantFromUrl(url),
      title: title || 'محصول دیجی‌کالا',
      url: 'https://www.digikala.com/product/dkp-' + id + '/',
      price: price,
      oldPrice: oldPrice || null,
      discount: discount || null,
      source: source
    };
  }

  /* --- recording ------------------------------------------------------- */

  function hasStorage() {
    try {
      return typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local;
    } catch (e) { return false; }
  }

  function record(p) {
    if (!hasStorage()) return;
    var key = p.id + ':' + (p.variant || 'default');
    chrome.storage.local.get(STORAGE_KEY, function (data) {
      var products = (data && data[STORAGE_KEY]) || {};
      var entry = products[key] || {
        id: p.id, variant: p.variant, title: p.title, url: p.url, points: []
      };
      entry.title = p.title;
      entry.url = p.url;
      entry.variant = p.variant;
      var now = Date.now();
      var last = entry.points[entry.points.length - 1];
      if (!last || last.price !== p.price || now - last.t > REDUNDANT_WINDOW_MS) {
        entry.points.push({
          t: now, price: p.price, oldPrice: p.oldPrice, discount: p.discount
        });
        if (entry.points.length > MAX_POINTS) {
          entry.points = entry.points.slice(entry.points.length - MAX_POINTS);
        }
      }
      entry.updatedAt = now;
      products[key] = entry;
      var obj = {};
      obj[STORAGE_KEY] = products;
      chrome.storage.local.set(obj);
    });
  }

  function attempt() {
    try {
      var p = extractProduct(document, location.href);
      if (p) record(p);
      return p;
    } catch (e) { return null; }
  }

  /* --- scheduling: Digikala renders after a ~10s skeleton, and variant
   * changes (colour/storage) update the page without a reload. --------- */

  function schedule() {
    if (!hasStorage() && typeof chrome === 'undefined') return;
    attempt();
    [3000, 8000, 15000].forEach(function (ms) {
      setTimeout(attempt, ms);
    });
    var lastUrl = location.href;
    setInterval(function () {
      if (location.href !== lastUrl) { lastUrl = location.href; attempt(); }
    }, 2000);
    if (typeof MutationObserver !== 'undefined' && document.body) {
      var timer = null;
      var observer = new MutationObserver(function () {
        if (timer) clearTimeout(timer);
        timer = setTimeout(attempt, 1500);
      });
      observer.observe(document.body, { childList: true, subtree: true });
    }
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
      chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
        if (msg && msg.type === 'dk-extract-now') {
          var p = attempt();
          sendResponse({ ok: !!p, product: p || null });
        }
        return true;
      });
    }
  }

  if (typeof document !== 'undefined' && productIdFromUrl(location.href)) {
    schedule();
  }

  window.__dkTracker = {
    parseFaNumber: parseFaNumber,
    productIdFromUrl: productIdFromUrl,
    variantFromUrl: variantFromUrl,
    extractProduct: extractProduct,
    extractFromDom: extractFromDom,
    extractFromJsonLd: extractFromJsonLd,
    STORAGE_KEY: STORAGE_KEY
  };
})();
