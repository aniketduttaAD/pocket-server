(function () {
  var M = window.Media;
  if (!M || typeof M.$ !== 'function') return;
  var MAX_BLOB_DL = 250 * 1024 * 1024;
  var transfers = [];

  function saveTransfers() {
    try { sessionStorage.setItem('mediaTransfers', JSON.stringify(transfers.slice(0, 50))); } catch (e) {}
  }

  function loadTransfers() {
    try {
      var raw = sessionStorage.getItem('mediaTransfers');
      if (raw) {
        JSON.parse(raw).forEach(function (t) {
          if (t.status === 'active') { t.status = 'error'; t.error = 'Interrupted'; }
          transfers.push(t);
        });
      }
    } catch (e) {}
  }

  function activeCount() {
    return transfers.filter(function (t) { return t.status === 'active'; }).length;
  }

  function updateBadge() {
    var badge = M.$('#transfer-badge');
    var btn = M.$('#transfer-toggle');
    var n = activeCount();
    if (!badge) return;
    if (n > 0) {
      badge.textContent = String(n);
      badge.classList.add('show');
      btn?.classList.add('has-active');
    } else {
      badge.classList.remove('show');
      btn?.classList.remove('has-active');
    }
  }

  function renderTransfers() {
    var list = M.$('#transfer-list');
    if (!list) return;
    if (!transfers.length) {
      list.innerHTML = '<div class="transfer-empty">No uploads or downloads yet</div>';
      updateBadge();
      return;
    }
    list.innerHTML = transfers.map(function (t) {
      var p = M.pct(t.done, t.total);
      var st = t.status === 'active' ? (p + '%') : (t.status === 'done' ? 'Done' : (t.error || 'Failed'));
      var icon = t.type === 'upload'
        ? '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" x2="12" y1="3" y2="15"/></svg>'
        : '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/></svg>';
      return '<div class="transfer-item ' + t.status + '" data-id="' + t.id + '">' +
        '<div class="transfer-row"><span class="icon">' + icon + '</span>' +
        '<span class="transfer-name" title="' + t.name.replace(/"/g, '&quot;') + '">' + t.name + '</span>' +
        '<span class="transfer-status">' + st + '</span></div>' +
        '<div class="transfer-bar"><span style="width:' + p + '%"></span></div>' +
        '<div class="transfer-meta"><span>' + M.fmtBytes(t.done) + (t.total ? ' / ' + M.fmtBytes(t.total) : '') + '</span>' +
        '<span>' + (t.status === 'active' && t.speed ? M.fmtSpeed(t.speed) : '') + '</span></div></div>';
    }).join('');
    updateBadge();
    saveTransfers();
  }

  function addTransfer(item) {
    transfers.unshift(item);
    if (transfers.length > 80) transfers.length = 80;
    renderTransfers();
    if (!document.body.classList.contains('page-viewer')) {
      M.openSheet('#transfer-panel', '#transfer-backdrop');
    }
  }

  function setTransfer(id, patch) {
    var t = transfers.find(function (x) { return x.id === id; });
    if (!t) return;
    Object.assign(t, patch);
    renderTransfers();
  }

  M.openTransferPanel = function () {
    M.openSheet('#transfer-panel', '#transfer-backdrop');
  };

  M.closeTransferPanel = function () {
    M.closeSheet('#transfer-panel', '#transfer-backdrop');
  };

  M.addTransfer = addTransfer;
  M.setTransfer = setTransfer;

  M.$('#transfer-toggle')?.addEventListener('click', function () {
    if (M.$('#transfer-panel')?.classList.contains('open')) M.closeTransferPanel();
    else M.openTransferPanel();
  });
  M.$('#transfer-close')?.addEventListener('click', M.closeTransferPanel);
  M.$('#transfer-backdrop')?.addEventListener('click', M.closeTransferPanel);
  M.$('#transfer-clear')?.addEventListener('click', function () {
    for (var i = transfers.length - 1; i >= 0; i--) {
      if (transfers[i].status !== 'active') transfers.splice(i, 1);
    }
    renderTransfers();
  });

  function xhrGetBlob(url, onProgress, signal) {
    return new Promise(function (resolve, reject) {
      var xhr = new XMLHttpRequest();
      var lastDone = 0, lastT = Date.now();
      xhr.open('GET', url);
      xhr.responseType = 'blob';
      if (signal) {
        signal.addEventListener('abort', function () { xhr.abort(); });
      }
      xhr.onprogress = function (e) {
        if (e.lengthComputable && onProgress) {
          var now = Date.now(), dt = (now - lastT) / 1000, speed = 0;
          if (dt > 0.35) { speed = (e.loaded - lastDone) / dt; lastDone = e.loaded; lastT = now; }
          onProgress(e.loaded, e.total, speed);
        }
      };
      xhr.onload = function () {
        if (xhr.status >= 200 && xhr.status < 300) resolve(xhr.response);
        else reject(new Error('Download failed (HTTP ' + xhr.status + ')'));
      };
      xhr.onerror = function () { reject(new Error('Connection reset during download')); };
      xhr.onabort = function () { reject(new DOMException('Aborted', 'AbortError')); };
      xhr.send();
    });
  }

  M.downloadTracked = async function (url, name, sizeHint) {
    var id = 'd-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7);
    var t = { id: id, name: name, type: 'download', total: sizeHint || 0, done: 0, speed: 0, status: 'active', error: null };
    addTransfer(t);
    try {
      if (sizeHint > MAX_BLOB_DL && window.showSaveFilePicker) {
        var handle = await window.showSaveFilePicker({ suggestedName: name });
        var writable = await handle.createWritable();
        var res = await fetch(url);
        if (!res.ok) throw new Error('Download failed');
        var total = +(res.headers.get('content-length') || sizeHint || 0);
        if (total) setTransfer(id, { total: total });
        var reader = res.body.getReader();
        var done = 0, lastDone = 0, lastT = Date.now();
        while (true) {
          var chunk = await reader.read();
          if (chunk.done) break;
          await writable.write(chunk.value);
          done += chunk.value.length;
          var now = Date.now(), dt = (now - lastT) / 1000, speed = 0;
          if (dt > 0.35) { speed = (done - lastDone) / dt; lastDone = done; lastT = now; }
          setTransfer(id, { done: done, total: total || done, speed: speed });
        }
        await writable.close();
      } else {
        var blob = await xhrGetBlob(url, function (done, total, speed) {
          setTransfer(id, { done: done, total: total || sizeHint || 0, speed: speed });
        });
        var a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = name;
        a.click();
        URL.revokeObjectURL(a.href);
      }
      setTransfer(id, { status: 'done', speed: 0 });
      M.toast('Downloaded ' + name);
    } catch (e) {
      if (e.name !== 'AbortError') {
        setTransfer(id, { status: 'error', error: e.message || 'Download failed', speed: 0 });
        window.open(url + (url.includes('?') ? '&' : '?') + 'download=1', '_blank');
        M.toast('Fallback download opened for ' + name);
      } else {
        setTransfer(id, { status: 'error', error: 'Cancelled', speed: 0 });
      }
    }
  };

  loadTransfers();
  renderTransfers();
})();
