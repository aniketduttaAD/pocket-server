(function (global) {
  var M;
  try {
    if (typeof global.MediaLib !== 'object' || global.MediaLib === null) {
      global.MediaLib = {};
    }
    M = global.MediaLib;
  } catch (e) {
    M = {};
  }
  if (typeof M !== 'object' || M === null) M = {};
  try {
    if (typeof global.Media !== 'object' || global.Media === null) global.Media = M;
  } catch (e) { /* window.Media may be read-only in some webviews */ }

  M.$ = function (s, r) { return (r || document).querySelector(s); };
  M.$$ = function (s, r) { return Array.from((r || document).querySelectorAll(s)); };

  M.fmtBytes = function (n) {
    n = +n || 0;
    if (n < 1024) return n + ' B';
    if (n < 1048576) return (n / 1024).toFixed(1) + ' KB';
    if (n < 1073741824) return (n / 1048576).toFixed(1) + ' MB';
    return (n / 1073741824).toFixed(2) + ' GB';
  };

  M.fmtSpeed = function (bps) {
    if (!bps || bps < 1) return '';
    return M.fmtBytes(bps) + '/s';
  };

  M.pct = function (done, total) {
    return total ? Math.min(100, Math.round((done / total) * 100)) : 0;
  };

  M.debounce = function (fn, ms) {
    var t;
    return function () {
      var args = arguments;
      var ctx = this;
      clearTimeout(t);
      t = setTimeout(function () { fn.apply(ctx, args); }, ms);
    };
  };

  M.toast = function (msg) {
    var el = M.$('#toast');
    if (!el) return;
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(M.toast._t);
    M.toast._t = setTimeout(function () { el.classList.remove('show'); }, 3200);
  };

  M.itemNameFromUrl = function (url) {
    try { return decodeURIComponent(url.split('/').pop().split('?')[0]); }
    catch (e) { return 'download'; }
  };

  M.openSheet = function (sheetId, backdropId) {
    var sheet = M.$(sheetId);
    var backdrop = M.$(backdropId);
    if (!sheet || !backdrop) return false;
    sheet.classList.add('open');
    backdrop.classList.add('open');
    backdrop.setAttribute('aria-hidden', 'false');
    document.body.classList.add('sheet-open');
    return true;
  };

  M.closeSheet = function (sheetId, backdropId) {
    M.$(sheetId)?.classList.remove('open');
    M.$(backdropId)?.classList.remove('open');
    M.$(backdropId)?.setAttribute('aria-hidden', 'true');
    if (!M.$('.sheet.open') && !M.$('.upload-sheet.open')) {
      document.body.classList.remove('sheet-open');
    }
  };

  M.openOptions = function () {
    return M.openSheet('#filter-sheet', '#options-backdrop');
  };

  M.closeOptions = function () {
    M.closeSheet('#filter-sheet', '#options-backdrop');
  };

  M.fileKindFromName = function (name) {
    var ext = (name.match(/\.[^.]+$/) || [''])[0].toLowerCase();
    var img = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.bmp', '.ico', '.avif', '.heic', '.heif'];
    var vid = ['.mp4', '.webm', '.mov', '.m4v', '.mkv', '.avi'];
    var aud = ['.mp3', '.wav', '.ogg', '.flac', '.m4a', '.aac'];
    if (img.indexOf(ext) >= 0) return 'image';
    if (vid.indexOf(ext) >= 0) return 'video';
    if (aud.indexOf(ext) >= 0) return 'audio';
    if (ext === '.pdf') return 'pdf';
    if (['.txt', '.md', '.json', '.csv', '.js', '.ts', '.py', '.html', '.css'].indexOf(ext) >= 0) return 'text';
    return 'file';
  };

  M.formatSize = M.fmtBytes;

  M.$('#options-toggle')?.addEventListener('click', function (e) {
    e.preventDefault();
    M.openOptions();
  });
  M.$('#bottom-options')?.addEventListener('click', function (e) {
    e.preventDefault();
    M.openOptions();
  });
  M.$('#filter-close')?.addEventListener('click', M.closeOptions);
  M.$('#options-backdrop')?.addEventListener('click', M.closeOptions);

  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    if (M.$('#filter-sheet.open')) M.closeOptions();
  });

  document.addEventListener('click', function (e) {
    var dl = e.target.closest('[data-action="download"], [data-dl]');
    if (!dl || !dl.dataset.dl) return;
    if (dl.tagName === 'A' && !dl.dataset.action) return;
    e.preventDefault();
    e.stopPropagation();
    var url = dl.dataset.dl;
    var name = dl.dataset.name || M.itemNameFromUrl(url);
    var size = +(dl.dataset.size || 0);
    if (!size) {
      var item = dl.closest('.media-item');
      size = +(item?.dataset?.size || 0);
      if (!dl.dataset.name && item) name = item.dataset.name || name;
    }
    if (M.downloadTracked) M.downloadTracked(url, name, size);
  });
})(window);
