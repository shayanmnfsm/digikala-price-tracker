/* Digikala Price Tracker — popup.
 * Persian RTL UI. Reads recorded price points from chrome.storage.local,
 * renders the current product (when the active tab is a Digikala product
 * page) with a history chart, and lists all tracked products.
 * All page-derived text is rendered via textContent only.
 */
(function () {
  'use strict';

  var STORAGE_KEY = 'dk-products-v1';
  var THEME_KEY = 'dk-theme';

  var MOON_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8z"/></svg>';
  var SUN_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>';

  function $(id) { return document.getElementById(id); }

  function faNum(n) { return Number(n).toLocaleString('fa-IR'); }

  function faTime(t) {
    var d = new Date(t);
    return d.toLocaleDateString('fa-IR', { month: 'short', day: 'numeric' }) +
      ' ' + d.toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' });
  }

  function faDate(t) {
    return new Date(t).toLocaleDateString('fa-IR', { month: 'short', day: 'numeric' });
  }

  /* --- theme (persisted, OS default) ----------------------------------- */

  var theme = 'light';
  function applyTheme() {
    document.documentElement.dataset.theme = theme === 'dark' ? 'dark' : 'light';
    var btn = $('theme-toggle');
    btn.innerHTML = theme === 'dark' ? SUN_SVG : MOON_SVG;
    btn.title = theme === 'dark' ? 'حالت روشن' : 'حالت تیره';
  }
  function loadPrefs() {
    return new Promise(function (resolve) {
      try {
        chrome.storage.local.get([THEME_KEY], function (data) {
          var saved = data && data[THEME_KEY];
          if (saved === 'dark' || saved === 'light') theme = saved;
          else if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) theme = 'dark';
          resolve();
        });
      } catch (e) { resolve(); }
    });
  }

  /* --- storage ---------------------------------------------------------- */

  function loadProducts() {
    return new Promise(function (resolve) {
      chrome.storage.local.get([STORAGE_KEY], function (data) {
        resolve((data && data[STORAGE_KEY]) || {});
      });
    });
  }

  function saveProducts(products) {
    return new Promise(function (resolve) {
      var obj = {};
      obj[STORAGE_KEY] = products;
      chrome.storage.local.set(obj, resolve);
    });
  }

  function getActiveTab() {
    return new Promise(function (resolve) {
      chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
        resolve(tabs && tabs[0]);
      });
    });
  }

  function keyFromUrl(url) {
    var m = /\/product\/dkp-(\d+)/.exec(url || '');
    if (!m) return null;
    var variant = null;
    try { variant = new URL(url).searchParams.get('variant_id'); } catch (e) {}
    return { key: m[1] + ':' + (variant || 'default'), id: m[1], variant: variant };
  }

  /* --- chart ------------------------------------------------------------ */

  function drawChart(canvas, points) {
    if (!canvas || !canvas.getContext) return;
    var ctx = canvas.getContext('2d');
    if (!ctx) return;
    var W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);
    if (!points || !points.length) return;
    var dark = document.documentElement.dataset.theme === 'dark';
    var prices = points.map(function (p) { return p.price; });
    var min = Math.min.apply(null, prices);
    var max = Math.max.apply(null, prices);
    if (min === max) { min -= 1; max += 1; }
    var padL = 16, padR = 16, padT = 18, padB = 30;
    var iw = W - padL - padR, ih = H - padT - padB;
    function x(i) { return points.length === 1 ? padL + iw / 2 : padL + (i / (points.length - 1)) * iw; }
    function y(v) { return padT + (1 - (v - min) / (max - min)) * ih; }
    /* grid baseline */
    ctx.strokeStyle = dark ? '#334155' : '#e2e8f0';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(padL, padT + ih);
    ctx.lineTo(padL + iw, padT + ih);
    ctx.stroke();
    /* area fill */
    var grad = ctx.createLinearGradient(0, padT, 0, padT + ih);
    grad.addColorStop(0, 'rgba(239, 64, 86, 0.25)');
    grad.addColorStop(1, 'rgba(239, 64, 86, 0.0)');
    ctx.beginPath();
    points.forEach(function (p, i) { if (i === 0) ctx.moveTo(x(i), y(p.price)); else ctx.lineTo(x(i), y(p.price)); });
    if (points.length === 1) { ctx.lineTo(x(0) + 1, y(points[0].price)); }
    ctx.lineTo(x(points.length - 1), padT + ih);
    ctx.lineTo(x(0), padT + ih);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();
    /* line */
    ctx.beginPath();
    points.forEach(function (p, i) { if (i === 0) ctx.moveTo(x(i), y(p.price)); else ctx.lineTo(x(i), y(p.price)); });
    if (points.length === 1) { ctx.lineTo(x(0) + 1, y(points[0].price)); }
    ctx.strokeStyle = '#ef4056';
    ctx.lineWidth = 3;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.stroke();
    /* last point dot */
    var last = points[points.length - 1];
    ctx.beginPath();
    ctx.arc(x(points.length - 1), y(last.price), 5, 0, Math.PI * 2);
    ctx.fillStyle = '#ef4056';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x(points.length - 1), y(last.price), 8, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(239, 64, 86, 0.35)';
    ctx.lineWidth = 2;
    ctx.stroke();
    /* labels: max top-left, min just above the baseline, oldest date
     * bottom-left, newest date bottom-right. */
    ctx.fillStyle = dark ? '#94a3b8' : '#64748b';
    ctx.font = '20px Vazirmatn, Tahoma, sans-serif';
    ctx.textAlign = 'left';
    if (points.length > 1) {
      ctx.fillText(faNum(max), padL, padT - 4);
      ctx.fillText(faNum(min), padL, padT + ih - 8);
    }
    ctx.fillText(faDate(points[0].t), padL, padT + ih + 22);
    if (points.length > 1) {
      ctx.textAlign = 'right';
      ctx.fillText(faDate(last.t), padL + iw, padT + ih + 22);
    }
  }

  /* --- rendering -------------------------------------------------------- */

  function changeBadge(el, noteEl, first, last) {
    var diff = last - first;
    var pct = first ? Math.round((diff / first) * 100) : 0;
    el.classList.remove('up', 'down', 'flat');
    if (diff < 0) {
      el.classList.add('down');
      el.textContent = '▼ ' + faNum(Math.abs(pct)) + '٪ ارزان‌تر';
      noteEl.textContent = 'نسبت به اولین ثبت: ' + faNum(Math.abs(diff)) + ' تومان کاهش';
    } else if (diff > 0) {
      el.classList.add('up');
      el.textContent = '▲ ' + faNum(pct) + '٪ گران‌تر';
      noteEl.textContent = 'نسبت به اولین ثبت: ' + faNum(diff) + ' تومان افزایش';
    } else {
      el.classList.add('flat');
      el.textContent = 'بدون تغییر';
      noteEl.textContent = 'قیمت نسبت به اولین ثبت تغییری نکرده است';
    }
  }

  function renderCurrent(entry) {
    var section = $('current');
    section.hidden = false;
    $('cur-title').textContent = entry.title;
    var points = entry.points || [];
    var last = points[points.length - 1];
    $('cur-price').textContent = faNum(last.price);
    var oldEl = $('cur-old');
    var discEl = $('cur-discount');
    if (last.oldPrice && last.oldPrice > last.price) {
      oldEl.hidden = false;
      oldEl.textContent = faNum(last.oldPrice);
    } else { oldEl.hidden = true; }
    if (last.discount) {
      discEl.hidden = false;
      discEl.textContent = faNum(last.discount) + '٪ تخفیف';
    } else { discEl.hidden = true; }
    if (points.length > 1) {
      changeBadge($('cur-change'), $('cur-change-note'), points[0].price, last.price);
    } else {
      var badge = $('cur-change');
      badge.classList.remove('up', 'down');
      badge.classList.add('flat');
      badge.textContent = 'اولین ثبت';
      $('cur-change-note').textContent = 'با بازدیدهای بعدی، تغییرات قیمت اینجا نمایش داده می‌شود';
    }
    var prices = points.map(function (p) { return p.price; });
    $('stat-min').textContent = faNum(Math.min.apply(null, prices));
    $('stat-max').textContent = faNum(Math.max.apply(null, prices));
    $('stat-count').textContent = faNum(points.length);
    drawChart($('chart'), points);
    $('cur-meta').textContent = 'آخرین ثبت: ' + faTime(last.t) +
      (entry.variant ? ' — مدل انتخاب‌شده' : '');
  }

  function renderList(products, currentKey) {
    var listEl = $('list');
    while (listEl.firstChild) listEl.removeChild(listEl.firstChild);
    var keys = Object.keys(products).sort(function (a, b) {
      return (products[b].updatedAt || 0) - (products[a].updatedAt || 0);
    });
    $('empty').hidden = keys.length > 0;
    keys.forEach(function (key) {
      var entry = products[key];
      var points = entry.points || [];
      if (!points.length) return;
      var last = points[points.length - 1];
      var first = points[0];
      var item = document.createElement('button');
      item.type = 'button';
      item.className = 'list-item';
      var title = document.createElement('span');
      title.className = 'li-title';
      title.textContent = entry.title + (key === currentKey ? ' (همین صفحه)' : '');
      var row = document.createElement('span');
      row.className = 'li-row';
      var price = document.createElement('span');
      price.className = 'li-price';
      price.textContent = faNum(last.price) + ' تومان';
      var badge = document.createElement('span');
      badge.className = 'badge flat';
      var diff = last.price - first.price;
      if (points.length > 1 && diff < 0) {
        badge.className = 'badge down';
        badge.textContent = '▼ ' + faNum(Math.abs(Math.round((diff / first.price) * 100))) + '٪';
      } else if (points.length > 1 && diff > 0) {
        badge.className = 'badge up';
        badge.textContent = '▲ ' + faNum(Math.round((diff / first.price) * 100)) + '٪';
      } else {
        badge.textContent = faNum(points.length) + ' ثبت';
      }
      var time = document.createElement('span');
      time.className = 'li-time';
      time.textContent = faTime(last.t);
      row.appendChild(price);
      row.appendChild(badge);
      row.appendChild(time);
      item.appendChild(title);
      item.appendChild(row);
      item.addEventListener('click', function () {
        var url = entry.url;
        if (entry.variant) url += '?variant_id=' + encodeURIComponent(entry.variant);
        chrome.tabs.create({ url: url });
      });
      listEl.appendChild(item);
    });
  }

  /* --- main ------------------------------------------------------------- */

  var currentTab = null;
  var currentInfo = null;
  var products = {};

  function refresh() {
    return loadProducts().then(function (data) {
      products = data;
      var hasCurrent = !!(currentInfo && products[currentInfo.key] &&
        (products[currentInfo.key].points || []).length);
      $('current').hidden = !hasCurrent;
      $('not-product').hidden = !!currentInfo;
      $('no-price').hidden = !(currentInfo && !hasCurrent);
      if (hasCurrent) renderCurrent(products[currentInfo.key]);
      renderList(products, currentInfo ? currentInfo.key : null);
    });
  }

  function init() {
    return loadPrefs().then(function () {
      applyTheme();
      $('theme-toggle').addEventListener('click', function () {
        theme = theme === 'dark' ? 'light' : 'dark';
        applyTheme();
        try {
          var obj = {};
          obj[THEME_KEY] = theme;
          chrome.storage.local.set(obj);
        } catch (e) {}
        refresh();
      });
      return getActiveTab();
    }).then(function (tab) {
      currentTab = tab || null;
      currentInfo = tab ? keyFromUrl(tab.url) : null;
      $('btn-refresh').addEventListener('click', function () {
        if (!currentTab || !currentTab.id) return;
        try {
          chrome.tabs.sendMessage(currentTab.id, { type: 'dk-extract-now' }, function () {
            setTimeout(refresh, 900);
          });
        } catch (e) { setTimeout(refresh, 900); }
      });
      $('btn-remove').addEventListener('click', function () {
        if (!currentInfo) return;
        delete products[currentInfo.key];
        saveProducts(products).then(refresh);
      });
      return refresh();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.__dkPopup = { faNum: faNum, keyFromUrl: keyFromUrl, drawChart: drawChart };
})();
