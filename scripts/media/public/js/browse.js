(function () {
  var M = window.MediaLib || window.Media;
  if (!M || typeof M.$ !== 'function') return;

  var selected = new Set();
  var bulkBar = M.$('#bulk-bar');
  var bulkCount = M.$('#bulk-count');
  var searchInput = M.$('#filter-search');
  var searchClear = M.$('#search-clear');
  var visibleCountEl = M.$('#visible-count');
  var filterEmpty = M.$('#filter-empty');
  var activeFiltersEl = M.$('#active-filters');
  var resultLabel = M.$('#filter-result-label');
  var resetBtn = M.$('#filter-reset');
  var totalFiles = parseInt(M.$('#page-data')?.dataset.fileCount || '0', 10) || 0;
  var thumbObserver = null;
  var filterRaf = 0;

  var KIND_LABELS = {
    all: 'All',
    image: 'Photos',
    video: 'Videos',
    audio: 'Audio',
    pdf: 'PDF',
    text: 'Docs',
  };

  var SORT_LABELS = {
    'date-desc': 'Newest',
    'date-asc': 'Oldest',
    'name-asc': 'A–Z',
    'name-desc': 'Z–A',
    'size-desc': 'Largest',
  };

  // ── State ──────────────────────────────────────────────────────────────────
  var state = {
    kind: 'all',
    sort: 'date-desc',
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

  function isDefaultFilters() {
    return state.kind === 'all' && state.sort === 'date-desc' && !state.query;
  }

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

  // ── Progressive thumbnails ─────────────────────────────────────────────────
  function markThumbLoaded(img) {
    img.classList.add('is-loaded');
    var media = img.closest('.tile-media');
    if (media) media.classList.add('has-thumb');
  }

  function loadThumb(img) {
    if (!img || img.dataset.loaded === '1') return;
    var src = img.dataset.src;
    if (!src) return;
    img.dataset.loaded = '1';
    img.addEventListener('load', function () { markThumbLoaded(img); }, { once: true });
    img.addEventListener('error', function () {
      // Fall back to full raw image if thumb fails
      if (src.indexOf('thumb=1') !== -1) {
        img.dataset.loaded = '0';
        img.dataset.src = src.replace('thumb=1', 'raw=1');
        loadThumb(img);
        return;
      }
      markThumbLoaded(img);
      img.classList.add('is-broken');
    }, { once: true });
    img.src = src;
  }

  function observeThumbs(root) {
    var imgs = M.$$('img.tile-thumb[data-src]', root || document);
    if (!imgs.length) return;

    if (!('IntersectionObserver' in window)) {
      imgs.forEach(loadThumb);
      return;
    }

    if (!thumbObserver) {
      thumbObserver = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) return;
          thumbObserver.unobserve(entry.target);
          loadThumb(entry.target);
        });
      }, { rootMargin: '240px 0px', threshold: 0.01 });
    }

    imgs.forEach(function (img) {
      if (img.dataset.loaded === '1') return;
      thumbObserver.observe(img);
    });
  }

  // ── Filter + Sort ──────────────────────────────────────────────────────────
  function applyFilters() {
    if (filterRaf) cancelAnimationFrame(filterRaf);
    filterRaf = requestAnimationFrame(function () {
      filterRaf = 0;
      applyFiltersNow();
    });
  }

  function applyFiltersNow() {
    var items = M.$$('.media-item');
    var visible = 0;

    items.forEach(function (el) {
      var kindOk = state.kind === 'all' || (el.dataset.kind || '') === state.kind;
      var show = kindOk && matchesSearch(el);
      el.hidden = !show;
      el.classList.toggle('hidden', !show);
      if (show) visible += 1;
    });

    sortAndGroup();
    updateChrome(visible);
    // Re-observe any newly revealed thumbs
    observeThumbs(M.$('#media-gallery'));
  }

  function sortAndGroup() {
    var mode = state.sort;
    var isDateSort = mode === 'date-desc' || mode === 'date-asc';

    M.$$('.gallery').forEach(function (gallery) {
      M.$$('.date-group-header', gallery).forEach(function (h) { h.remove(); });

      var items = M.$$('.media-item:not(.hidden)', gallery);
      if (!items.length) return;

      items.sort(function (a, b) {
        switch (mode) {
          case 'name-asc':  return (a.dataset.name || '').localeCompare(b.dataset.name || '');
          case 'name-desc': return (b.dataset.name || '').localeCompare(a.dataset.name || '');
          case 'size-desc': return (+b.dataset.size || 0) - (+a.dataset.size || 0);
          case 'date-asc':  return (+a.dataset.mtime || 0) - (+b.dataset.mtime || 0);
          default:          return (+b.dataset.mtime || 0) - (+a.dataset.mtime || 0);
        }
      });

      var frag = document.createDocumentFragment();
      var lastLabel = null;

      items.forEach(function (el) {
        if (isDateSort) {
          var label = dateLabel(el.dataset.mtime);
          if (label !== lastLabel) {
            lastLabel = label;
            var header = document.createElement('div');
            header.className = 'date-group-header';
            header.textContent = label;
            frag.appendChild(header);
          }
        }
        frag.appendChild(el);
      });

      // Keep hidden items at the end so they aren't lost
      M.$$('.media-item.hidden', gallery).forEach(function (el) {
        frag.appendChild(el);
      });

      gallery.appendChild(frag);
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

  function updateChrome(visible) {
    if (typeof visible !== 'number') {
      visible = M.$$('.media-item:not(.hidden)').length;
    }

    if (visibleCountEl) visibleCountEl.textContent = String(visible);

    if (filterEmpty) {
      var hasItems = totalFiles > 0 || M.$$('.media-item').length > 0;
      filterEmpty.hidden = !(hasItems && visible === 0);
    }

    var defaults = isDefaultFilters();
    if (resetBtn) resetBtn.hidden = defaults;

    var toggleBtn = M.$('#options-toggle');
    if (toggleBtn) toggleBtn.classList.toggle('filter-active', !defaults);
    var bottomBtn = M.$('#bottom-options');
    if (bottomBtn) bottomBtn.classList.toggle('filter-active', !defaults);
    var inlineBtn = M.$('#filter-open-inline');
    if (inlineBtn) inlineBtn.classList.toggle('filter-active', !defaults);

    if (resultLabel) {
      if (defaults) {
        resultLabel.textContent = 'Showing all files';
      } else {
        resultLabel.textContent = visible + ' of ' + (totalFiles || M.$$('.media-item').length) + ' files';
      }
    }

    renderActiveChips();
  }

  function renderActiveChips() {
    if (!activeFiltersEl) return;
    var chips = [];
    if (state.kind !== 'all') {
      chips.push({ key: 'kind', label: KIND_LABELS[state.kind] || state.kind });
    }
    if (state.sort !== 'date-desc') {
      chips.push({ key: 'sort', label: SORT_LABELS[state.sort] || state.sort });
    }
    if (state.query) {
      chips.push({ key: 'query', label: '“' + state.query + '”' });
    }

    if (!chips.length) {
      activeFiltersEl.hidden = true;
      activeFiltersEl.innerHTML = '';
      return;
    }

    activeFiltersEl.hidden = false;
    activeFiltersEl.innerHTML = chips.map(function (c) {
      return '<button type="button" class="active-chip" data-clear="' + c.key + '">' +
        '<span>' + c.label + '</span><span class="active-chip-x" aria-hidden="true">×</span></button>';
    }).join('') +
      '<button type="button" class="active-chip-clear" id="active-clear-all">Clear all</button>';
  }

  function resetFilters() {
    state.kind = 'all';
    state.sort = 'date-desc';
    state.query = '';
    if (searchInput) searchInput.value = '';
    if (searchClear) searchClear.hidden = true;
    try {
      localStorage.setItem('mediaKind', 'all');
      localStorage.setItem('mediaSort', 'date-desc');
    } catch (_) {}
    syncFilterUI();
    applyFilters();
  }

  function clearChip(key) {
    if (key === 'kind') {
      state.kind = 'all';
      try { localStorage.setItem('mediaKind', 'all'); } catch (_) {}
    } else if (key === 'sort') {
      state.sort = 'date-desc';
      try { localStorage.setItem('mediaSort', 'date-desc'); } catch (_) {}
    } else if (key === 'query') {
      state.query = '';
      if (searchInput) searchInput.value = '';
      if (searchClear) searchClear.hidden = true;
    }
    syncFilterUI();
    applyFilters();
  }

  // ── Sync filter-sheet UI to state ──────────────────────────────────────────
  function syncFilterUI() {
    M.$$('[data-kind]').forEach(function (btn) {
      btn.classList.toggle('active', btn.dataset.kind === state.kind);
    });
    M.$$('[data-sort]').forEach(function (btn) {
      var on = btn.dataset.sort === state.sort;
      btn.classList.toggle('active', on);
      btn.setAttribute('aria-checked', on ? 'true' : 'false');
    });
    M.$$('[data-view]').forEach(function (btn) {
      var isActive = btn.dataset.view === state.view;
      btn.classList.toggle('active', isActive);
      btn.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    });
    if (searchInput && state.query) searchInput.value = state.query;
    if (searchClear) searchClear.hidden = !state.query;
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
    var chip = e.target.closest('[data-kind]');
    if (chip && chip.closest('#filter-sheet')) {
      state.kind = chip.dataset.kind;
      try { localStorage.setItem('mediaKind', state.kind); } catch (_) {}
      syncFilterUI();
      applyFilters();
      return;
    }

    var sortBtn = e.target.closest('[data-sort]');
    if (sortBtn) {
      state.sort = sortBtn.dataset.sort;
      try { localStorage.setItem('mediaSort', state.sort); } catch (_) {}
      syncFilterUI();
      applyFilters();
      return;
    }

    var viewBtn = e.target.closest('[data-view]');
    if (viewBtn) {
      setView(viewBtn.dataset.view);
      return;
    }

    var clearChipBtn = e.target.closest('[data-clear]');
    if (clearChipBtn) {
      clearChip(clearChipBtn.dataset.clear);
      return;
    }

    if (e.target.closest('#active-clear-all') || e.target.closest('#filter-empty-reset')) {
      resetFilters();
      return;
    }

    if (e.target.closest('#filter-open-inline')) {
      openOptions();
    }
  });

  if (searchInput) {
    searchInput.addEventListener('input', M.debounce(function () {
      state.query = searchInput.value.trim();
      if (searchClear) searchClear.hidden = !state.query;
      applyFilters();
    }, 120));

    searchInput.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        searchInput.value = '';
        state.query = '';
        if (searchClear) searchClear.hidden = true;
        applyFilters();
      }
    });
  }

  searchClear?.addEventListener('click', function () {
    if (searchInput) searchInput.value = '';
    state.query = '';
    searchClear.hidden = true;
    applyFilters();
    searchInput?.focus();
  });

  resetBtn?.addEventListener('click', resetFilters);

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
      M.addTransfer({ id: id, name: paths.length + ' files.zip', type: 'download', total: 0, done: 0, speed: 0, status: 'active', error: null });
    }
    try {
      var res = await fetch('/__bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paths: paths }),
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
      if (M.setTransfer && total) M.setTransfer(id, { total: total });
      var reader = res.body.getReader();
      var chunks = [];
      var done = 0;
      while (true) {
        var part = await reader.read();
        if (part.done) break;
        chunks.push(part.value);
        done += part.value.length;
        if (M.setTransfer) M.setTransfer(id, { done: done, total: total || done });
      }
      var blob = new Blob(chunks, { type: 'application/zip' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'media-' + paths.length + '-files.zip';
      a.click();
      URL.revokeObjectURL(a.href);
      if (M.setTransfer) M.setTransfer(id, { status: 'done', done: done, total: done, speed: 0 });
      M.toast('Zip download started');
    } catch (err) {
      if (M.setTransfer) M.setTransfer(id, { status: 'error', error: err.message || 'Download failed' });
      M.toast(err.message || 'Download failed');
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

    var mediaHtml;
    if (kind === 'image' || kind === 'video') {
      mediaHtml =
        '<div class="tile-media' + (kind === 'video' ? ' tile-thumb-video' : '') + '">' +
        '<div class="tile-skeleton" aria-hidden="true"></div>' +
        '<img class="tile-thumb" data-src="' + nextPath + '?thumb=1" alt="" decoding="async" width="200" height="200">' +
        (kind === 'video' ? '<div class="tile-play-badge" aria-hidden="true"><span class="icon play-icon"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><polygon points="6 3 20 12 6 21 6 3"/></svg></span></div>' : '') +
        '</div>';
    } else {
      mediaHtml = '<div class="tile-media tile-thumb-icon"><div class="tile-icon-bg"><svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/></svg></div></div>';
    }

    article.innerHTML =
      '<label class="pick" onclick="event.stopPropagation()"><input type="checkbox" aria-label="Select"></label>' +
      '<a class="tile-link" href="' + nextPath + '">' + mediaHtml +
      '<div class="tile-info"><span class="tile-name">' + (result.name || file.name) + '</span>' +
      '<span class="tile-meta">' + M.fmtBytes(sizeBytes) + '</span></div></a>' +
      '<div class="tile-actions">' +
      '<a class="icon-btn" href="' + nextPath + '" aria-label="Open"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"/><circle cx="12" cy="12" r="3"/></svg></a>' +
      '<button type="button" class="icon-btn" data-action="download" data-dl="' + nextPath + '?download=1" data-name="' + (result.name || file.name) + '" data-size="' + sizeBytes + '" aria-label="Download"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/></svg></button></div>';

    galleryEl.insertBefore(article, galleryEl.firstChild);
    totalFiles += 1;
    var pageData = M.$('#page-data');
    if (pageData) pageData.dataset.fileCount = String(totalFiles);
    var empty = M.$('.empty-state');
    if (empty) empty.remove();
    observeThumbs(article);
    applyFilters();
  }

  M.onUploadComplete = appendTile;

  // ── Init ───────────────────────────────────────────────────────────────────
  syncFilterUI();
  setView(state.view);
  applyFiltersNow();
  observeThumbs();
})();
