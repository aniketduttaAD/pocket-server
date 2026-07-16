(function () {
  var M = window.MediaLib || window.Media;
  if (!M || typeof M.$ !== 'function') return;

  var selected = new Set();
  var bulkBar = M.$('#bulk-bar');
  var bulkCount = M.$('#bulk-count');
  var searchInput = M.$('#filter-search');

  // ── State ──────────────────────────────────────────────────────────────────
  var state = {
    kind: 'all',
    sort: 'date-desc', // default: newest first
    view: 'grid',
    query: '',
  };

  try {
    var sv = localStorage.getItem('mediaView');
    var ss = localStorage.getItem('mediaSort');
    var sk = localStorage.getItem('mediaKind');
    if (sv) state.view = sv;
    if (ss) state.sort = ss;
    if (sk) state.kind = sk;
  } catch (_) {}

  // ── Helpers ────────────────────────────────────────────────────────────────
  function openOptions() { if (M.openOptions) M.openOptions(); }
  function closeOptions() { if (M.closeOptions) M.closeOptions(); }

  function dateLabel(mtime) {
    if (!mtime) return 'Unknown';
    var d = new Date(+mtime);
    var now = new Date();
    var today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    var itemDay = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    var diff = today - itemDay;
    if (diff === 0) return 'Today';
    if (diff === 86400000) return 'Yesterday';
    if (diff < 7 * 86400000) return d.toLocaleDateString(undefined, { weekday: 'long' });
    if (d.getFullYear() === now.getFullYear()) {
      return d.toLocaleDateString(undefined, { month: 'long', day: 'numeric' });
    }
    return d.toLocaleDateString(undefined, { year: 'numeric', month: 'long' });
  }

  function matchesSearch(el) {
    if (!state.query) return true;
    return (el.dataset.name || '').toLowerCase().includes(state.query.toLowerCase());
  }

  // ── Filter + Sort ──────────────────────────────────────────────────────────
  function applyFilters() {
    M.$$('.media-item').forEach(function (el) {
      var kindOk = state.kind === 'all' || (el.dataset.kind || '') === state.kind;
      el.classList.toggle('hidden', !kindOk || !matchesSearch(el));
    });
    sortAndGroup();
    updateActiveCount();
  }

  function sortAndGroup() {
    var mode = state.sort;
    var isDateSort = mode === 'date-desc' || mode === 'date-asc';

    M.$$('.gallery').forEach(function (gallery) {
      M.$$('.date-group-header', gallery).forEach(function (h) { h.remove(); });

      var items = M.$$('.media-item:not(.hidden)', gallery);

      items.sort(function (a, b) {
        switch (mode) {
          case 'name-asc':  return (a.dataset.name || '').localeCompare(b.dataset.name || '');
          case 'name-desc': return (b.dataset.name || '').localeCompare(a.dataset.name || '');
          case 'size-desc': return (+b.dataset.size || 0) - (+a.dataset.size || 0);
          case 'date-asc':  return (+a.dataset.mtime || 0) - (+b.dataset.mtime || 0);
          default:          return (+b.dataset.mtime || 0) - (+a.dataset.mtime || 0); // date-desc
        }
      });

      items.forEach(function (el) { gallery.appendChild(el); });

      if (isDateSort && items.length) {
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
    state.view = mode;
    M.$$('.gallery').forEach(function (g) {
      g.classList.toggle('list-view', mode === 'list');
    });
    M.$$('[data-view]').forEach(function (b) {
      var isActive = b.dataset.view === mode;
      b.classList.toggle('active', isActive);
      b.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    });
    try { localStorage.setItem('mediaView', mode); } catch (_) {}
  }

  // ── Sync filter-sheet UI to state ──────────────────────────────────────────
  function syncFilterUI() {
    M.$$('[data-kind]').forEach(function (btn) {
      btn.classList.toggle('active', btn.dataset.kind === state.kind);
    });
    M.$$('[data-sort]').forEach(function (btn) {
      btn.classList.toggle('active', btn.dataset.sort === state.sort);
    });
    M.$$('[data-view]').forEach(function (btn) {
      var isActive = btn.dataset.view === state.view;
      btn.classList.toggle('active', isActive);
      btn.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    });
    if (searchInput && state.query) searchInput.value = state.query;
  }

  // Show a dot on the filter button when non-default filters are active
  function updateActiveCount() {
    var hasFilter = state.kind !== 'all' || state.sort !== 'date-desc' || state.query;
    var toggleBtn = M.$('#options-toggle');
    if (toggleBtn) toggleBtn.classList.toggle('filter-active', !!hasFilter);
    var bottomBtn = M.$('#bottom-options');
    if (bottomBtn) bottomBtn.classList.toggle('filter-active', !!hasFilter);
  }

  // ── Bulk selection ─────────────────────────────────────────────────────────
  function updateBulk() {
    var n = selected.size;
    if (bulkBar) bulkBar.classList.toggle('open', n > 0);
    if (bulkCount) bulkCount.textContent = n + ' selected';
    M.$$('.media-item').forEach(function (el) {
      var sel = selected.has(el.dataset.path);
      el.classList.toggle('selected', sel);
      var cb = M.$('.pick input', el);
      if (cb) cb.checked = sel;
    });
  }

  function selectAllVisible() {
    M.$$('.media-item:not(.hidden)').forEach(function (el) {
      if (el.dataset.path) selected.add(el.dataset.path);
    });
    updateBulk();
    closeOptions();
  }

  // ── Event delegation ───────────────────────────────────────────────────────
  document.addEventListener('click', function (e) {
    // Kind filter chips
    var chip = e.target.closest('[data-kind]');
    if (chip) {
      state.kind = chip.dataset.kind;
      try { localStorage.setItem('mediaKind', state.kind); } catch (_) {}
      syncFilterUI();
      applyFilters();
      return;
    }

    // Sort buttons
    var sortBtn = e.target.closest('[data-sort]');
    if (sortBtn) {
      state.sort = sortBtn.dataset.sort;
      try { localStorage.setItem('mediaSort', state.sort); } catch (_) {}
      syncFilterUI();
      applyFilters();
      return;
    }

    // Layout view buttons
    var viewBtn = e.target.closest('[data-view]');
    if (viewBtn) {
      setView(viewBtn.dataset.view);
      return;
    }
  });

  // Search — inline in page header, always visible
  if (searchInput) {
    searchInput.addEventListener('input', M.debounce(function () {
      state.query = searchInput.value;
      applyFilters();
    }, 150));

    // Clear on Escape
    searchInput.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        searchInput.value = '';
        state.query = '';
        applyFilters();
      }
    });
  }

  // Gallery checkbox selection
  var gallery = M.$('#media-gallery');
  if (gallery) {
    gallery.addEventListener('change', function (e) {
      if (!e.target.matches('.pick input')) return;
      e.stopPropagation();
      var item = e.target.closest('.media-item');
      var p = item && item.dataset.path;
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

  M.$('#options-upload')?.addEventListener('click', function () {
    closeOptions();
    if (M.openUpload) M.openUpload();
  });

  // ── Append tile after upload ───────────────────────────────────────────────
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

  // ── Init ───────────────────────────────────────────────────────────────────
  syncFilterUI();
  setView(state.view);
  applyFilters();
})();
