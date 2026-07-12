(function () {
  var M = window.MediaLib || window.Media;
  if (!M || typeof M.$ !== 'function') return;
  var selected = new Set();
  var filterKind = M.$('#filter-kind');
  var sortBy = M.$('#sort-by');
  var bulkBar = M.$('#bulk-bar');
  var bulkCount = M.$('#bulk-count');

  function openOptions() { if (M.openOptions) M.openOptions(); }
  function closeOptions() { if (M.closeOptions) M.closeOptions(); }

  function dateLabel(mtime) {
    if (!mtime) return 'Unknown date';
    var d = new Date(+mtime);
    var now = new Date();
    var diff = now - d;
    if (diff < 86400000 && d.getDate() === now.getDate()) return 'Today';
    if (diff < 172800000) return 'Yesterday';
    return d.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
  }

  function applyFilters() {
    var kind = filterKind?.value || 'all';
    M.$$('.media-item').forEach(function (el) {
      var k = el.dataset.kind || '';
      el.classList.toggle('hidden', kind !== 'all' && k !== kind);
    });
    sortAndGroup();
  }

  function sortAndGroup() {
    var mode = sortBy?.value || 'name-asc';
    var isDateSort = mode === 'date-desc' || mode === 'date-asc';

    M.$$('.gallery').forEach(function (gallery) {
      // Remove existing date headers
      M.$$('.date-group-header', gallery).forEach(function (h) { h.remove(); });

      var items = M.$$('.media-item', gallery).filter(function (el) {
        return !el.classList.contains('hidden');
      });

      items.sort(function (a, b) {
        if (mode === 'name-asc') return (a.dataset.name || '').localeCompare(b.dataset.name || '');
        if (mode === 'name-desc') return (b.dataset.name || '').localeCompare(a.dataset.name || '');
        if (mode === 'size-desc') return (+b.dataset.size || 0) - (+a.dataset.size || 0);
        if (mode === 'date-desc') return (+b.dataset.mtime || 0) - (+a.dataset.mtime || 0);
        if (mode === 'date-asc') return (+a.dataset.mtime || 0) - (+b.dataset.mtime || 0);
        return 0;
      });

      items.forEach(function (el) { gallery.appendChild(el); });

      // Insert date group headers after sorting
      if (isDateSort) {
        var lastLabel = null;
        items.forEach(function (el) {
          var label = dateLabel(el.dataset.mtime);
          if (label !== lastLabel) {
            lastLabel = label;
            var header = document.createElement('div');
            header.className = 'date-group-header';
            header.textContent = label;
            gallery.insertBefore(header, el);
          }
        });
      }
    });
  }

  function setView(mode) {
    M.$$('.gallery').forEach(function (g) {
      g.classList.toggle('list-view', mode === 'list');
    });
    M.$$('[data-view]').forEach(function (b) {
      var active = b.dataset.view === mode;
      b.classList.toggle('active', active);
      b.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
    try { localStorage.setItem('mediaView', mode); } catch (e) {}
  }

  function updateBulk() {
    var n = selected.size;
    bulkBar?.classList.toggle('open', n > 0);
    if (bulkCount) bulkCount.textContent = n + ' selected';
    M.$$('.media-item').forEach(function (el) {
      el.classList.toggle('selected', selected.has(el.dataset.path));
      var cb = M.$('.pick input', el);
      if (cb) cb.checked = selected.has(el.dataset.path);
    });
  }

  function selectAllVisible() {
    M.$$('.media-item:not(.hidden)').forEach(function (el) {
      if (el.dataset.path) selected.add(el.dataset.path);
    });
    updateBulk();
    closeOptions();
  }

  var gallery = M.$('#media-gallery');
  if (gallery) {
    gallery.addEventListener('change', function (e) {
      if (!e.target.matches('.pick input')) return;
      e.stopPropagation();
      var item = e.target.closest('.media-item');
      var p = item?.dataset.path;
      if (!p) return;
      if (e.target.checked) selected.add(p);
      else selected.delete(p);
      updateBulk();
    });
  }

  M.$('#select-all')?.addEventListener('click', selectAllVisible);
  M.$('#clear-select')?.addEventListener('click', function () { selected.clear(); updateBulk(); });

  M.$('#bulk-download')?.addEventListener('click', async function () {
    var paths = Array.from(selected);
    if (!paths.length) return;
    var id = 'd-bulk-' + Date.now();
    if (M.addTransfer) {
      M.addTransfer({ id, name: paths.length + ' files.zip', type: 'download', total: 0, done: 0, speed: 0, status: 'active', error: null });
    }
    try {
      var res = await fetch('/__bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paths }),
      });
      if (res.headers.get('content-type')?.includes('application/json')) {
        var data = await res.json();
        if (data.fallback) {
          if (M.setTransfer) M.setTransfer(id, { status: 'done', name: paths.length + ' files (individual)' });
          data.fallback.forEach(function (u, idx) {
            setTimeout(function () {
              var el = M.$('[data-path="' + paths[idx] + '"]');
              M.downloadTracked(u, el?.dataset?.name || ('file-' + idx), +(el?.dataset?.size || 0));
            }, idx * 400);
          });
          return;
        }
        throw new Error(data.error || 'Download failed');
      }
      var total = +(res.headers.get('content-length') || 0);
      if (M.setTransfer && total) M.setTransfer(id, { total });
      var reader = res.body.getReader();
      var chunks = [], done = 0;
      while (true) {
        var part = await reader.read();
        if (part.done) break;
        chunks.push(part.value);
        done += part.value.length;
        if (M.setTransfer) M.setTransfer(id, { done, total: total || done });
      }
      var blob = new Blob(chunks, { type: 'application/zip' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'media-' + paths.length + '-files.zip';
      a.click();
      URL.revokeObjectURL(a.href);
      if (M.setTransfer) M.setTransfer(id, { status: 'done', done, total: done, speed: 0 });
      M.toast('Zip download started');
    } catch (e) {
      if (M.setTransfer) M.setTransfer(id, { status: 'error', error: e.message || 'Download failed' });
      M.toast(e.message || 'Download failed');
    }
  });

  filterKind?.addEventListener('change', applyFilters);
  sortBy?.addEventListener('change', applyFilters);

  document.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-view]');
    if (btn) setView(btn.dataset.view);
  });

  M.$('#options-upload')?.addEventListener('click', function () {
    closeOptions();
    if (M.openUpload) M.openUpload();
  });

  function appendTile(result, file) {
    var galleryEl = M.$('#media-gallery');
    if (!galleryEl) { location.reload(); return; }
    var webPath = M.$('#page-data')?.dataset.webPath || '/';
    var nextPath = (webPath.endsWith('/') ? webPath.slice(0, -1) : webPath) + '/' + encodeURIComponent(result.name || file.name);
    var kind = M.fileKindFromName(result.name || file.name);
    var sizeBytes = result.size || file.size;
    var article = document.createElement('article');
    article.className = 'media-item tile';
    article.dataset.name = result.name || file.name;
    article.dataset.kind = kind;
    article.dataset.path = nextPath;
    article.dataset.size = String(sizeBytes);
    article.dataset.mtime = String(Date.now());

    var iconHtml = kind === 'image'
      ? '<img class="tile-thumb" src="' + nextPath + '?raw=1" alt="" loading="lazy" decoding="async">'
      : '<div class="tile-icon-bg"><svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/></svg></div>';

    article.innerHTML =
      '<label class="pick" onclick="event.stopPropagation()"><input type="checkbox" aria-label="Select"></label>' +
      '<a class="tile-link" href="' + nextPath + '">' +
      '<div class="tile-media">' + iconHtml + '</div>' +
      '<div class="tile-info"><span class="tile-name">' + (result.name || file.name) + '</span>' +
      '<span class="tile-meta">' + M.fmtBytes(sizeBytes) + '</span></div></a>' +
      '<div class="tile-actions">' +
      '<a class="icon-btn" href="' + nextPath + '" aria-label="Open"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"/><circle cx="12" cy="12" r="3"/></svg></a>' +
      '<button type="button" class="icon-btn" data-action="download" data-dl="' + nextPath + '?download=1" data-name="' + (result.name || file.name) + '" data-size="' + sizeBytes + '" aria-label="Download"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/></svg></button></div>';

    galleryEl.insertBefore(article, galleryEl.firstChild);
    var empty = M.$('.empty-state');
    if (empty) empty.remove();
    var stats = M.$('.page-stats');
    if (stats) {
      var m = stats.textContent.match(/(\d+) folders · (\d+) files/);
      if (m) stats.textContent = m[1] + ' folders · ' + (parseInt(m[2], 10) + 1) + ' files';
    }
  }

  M.onUploadComplete = appendTile;

  try {
    var saved = localStorage.getItem('mediaView');
    if (saved) setView(saved);
    // Restore last sort
    var savedSort = localStorage.getItem('mediaSort');
    if (savedSort && sortBy) sortBy.value = savedSort;
  } catch (e) {}

  sortBy?.addEventListener('change', function () {
    try { localStorage.setItem('mediaSort', sortBy.value); } catch (e) {}
  });

  applyFilters();
})();
