(function () {
  var M = window.Media;
  var CHUNK_SIZE = 48 * 1024 * 1024;
  var CHUNK_THRESHOLD = 80 * 1024 * 1024;
  var webPath = M.$('#page-data')?.dataset.webPath || '/';
  var uploadQueue = [];
  var abortControllers = {};

  function openUpload() {
    M.openSheet('#upload-sheet', '#upload-backdrop');
  }

  function closeUpload() {
    M.closeSheet('#upload-sheet', '#upload-backdrop');
  }

  function updateFabBadge() {
    var badge = M.$('#upload-queue-badge');
    var active = uploadQueue.filter(function (q) { return q.status === 'active'; }).length;
    if (!badge) return;
    if (active > 0) {
      badge.textContent = String(active);
      badge.classList.add('show');
    } else {
      badge.classList.remove('show');
    }
  }

  function renderQueue() {
    var el = M.$('#upload-queue');
    if (!el) return;
    if (!uploadQueue.length) {
      el.innerHTML = '';
      updateFabBadge();
      return;
    }
    el.innerHTML = uploadQueue.map(function (q) {
      var p = M.pct(q.done, q.total);
      var st = q.status === 'active' ? (p + '%') : (q.status === 'done' ? 'Done' : (q.error || q.status));
      var cancelBtn = q.status === 'active'
        ? '<button type="button" class="btn ghost sm" data-cancel="' + q.id + '">Cancel</button>' : '';
      var retryBtn = q.status === 'error'
        ? '<button type="button" class="btn sm" data-retry="' + q.id + '">Retry</button>' : '';
      return '<div class="upload-queue-item ' + q.status + '" data-id="' + q.id + '">' +
        '<div class="upload-queue-row">' +
        '<span class="upload-queue-name" title="' + q.name.replace(/"/g, '&quot;') + '">' + q.name + '</span>' +
        '<span class="upload-queue-status">' + st + '</span>' + cancelBtn + retryBtn +
        '</div>' +
        '<div class="upload-queue-bar"><span style="width:' + p + '%"></span></div>' +
        '<div class="upload-queue-meta"><span>' + M.fmtBytes(q.done) + ' / ' + M.fmtBytes(q.total) + '</span>' +
        '<span>' + (q.speed ? M.fmtSpeed(q.speed) : '') + '</span></div></div>';
    }).join('');

    el.querySelectorAll('[data-cancel]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var id = btn.dataset.cancel;
        if (abortControllers[id]) abortControllers[id].abort();
        var q = uploadQueue.find(function (x) { return x.id === id; });
        if (q) { q.status = 'cancelled'; q.error = 'Cancelled'; }
        renderQueue();
      });
    });

    el.querySelectorAll('[data-retry]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var id = btn.dataset.retry;
        var q = uploadQueue.find(function (x) { return x.id === id; });
        if (q && q.file) {
          q.status = 'active'; q.done = 0; q.error = null;
          renderQueue();
          uploadOne(q.file, q);
        }
      });
    });

    updateFabBadge();
  }

  function xhrPut(url, blob, onProgress, signal) {
    return new Promise(function (resolve, reject) {
      var xhr = new XMLHttpRequest();
      var lastDone = 0, lastT = Date.now();
      if (signal) signal.addEventListener('abort', function () { xhr.abort(); });
      xhr.upload.onprogress = function (e) {
        if (e.lengthComputable && onProgress) {
          var now = Date.now(), dt = (now - lastT) / 1000, speed = 0;
          if (dt > 0.35) { speed = (e.loaded - lastDone) / dt; lastDone = e.loaded; lastT = now; }
          onProgress(e.loaded, e.total, speed);
        }
      };
      xhr.onload = function () {
        if (xhr.status >= 200 && xhr.status < 300) {
          try { resolve(JSON.parse(xhr.responseText || '{}')); } catch (e) { resolve({ ok: true }); }
        } else {
          try { reject(new Error(JSON.parse(xhr.responseText).error || ('HTTP ' + xhr.status))); }
          catch (e) { reject(new Error('HTTP ' + xhr.status)); }
        }
      };
      xhr.onerror = function () { reject(new Error('Connection reset')); };
      xhr.onabort = function () { reject(new DOMException('Aborted', 'AbortError')); };
      xhr.open('PUT', url);
      xhr.setRequestHeader('Content-Type', 'application/octet-stream');
      xhr.send(blob);
    });
  }

  async function uploadDirect(file, q, signal) {
    var url = (webPath.endsWith('/') ? webPath : webPath + '/') + encodeURIComponent(file.name) + '?upload=1';
    var result = await xhrPut(url, file, function (done, total, speed) {
      q.done = done; q.total = total; q.speed = speed;
      renderQueue();
      if (M.setTransfer && q.transferId) M.setTransfer(q.transferId, { done: done, total: total, speed: speed });
    }, signal);
    return result;
  }

  async function uploadChunked(file, q, signal) {
    var totalChunks = Math.ceil(file.size / CHUNK_SIZE);
    var initRes = await fetch('/__upload/init', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dir: webPath, filename: file.name, totalSize: file.size, totalChunks: totalChunks }),
      signal: signal,
    });
    var initData = await initRes.json();
    if (!initRes.ok) throw new Error(initData.error || 'Chunk init failed');
    var uploadId = initData.uploadId;
    for (var i = 0; i < totalChunks; i++) {
      if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
      var start = i * CHUNK_SIZE;
      var chunk = file.slice(start, start + CHUNK_SIZE);
      await xhrPut('/__upload/chunk/' + uploadId + '/' + i, chunk, function (done) {
        q.done = start + done;
        renderQueue();
        if (M.setTransfer && q.transferId) M.setTransfer(q.transferId, { done: q.done, total: file.size });
      }, signal);
    }
    var doneRes = await fetch('/__upload/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ uploadId: uploadId }),
      signal: signal,
    });
    var doneData = await doneRes.json();
    if (!doneRes.ok) throw new Error(doneData.error || 'Finalize failed');
    return doneData;
  }

  async function uploadOne(file, existing) {
    var id = existing?.id || ('u-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7));
    var q = existing || {
      id: id, name: file.name, file: file, total: file.size, done: 0, speed: 0, status: 'active', error: null,
    };
    if (!existing) uploadQueue.unshift(q);

    var transferId = 'u-' + id;
    q.transferId = transferId;
    if (M.addTransfer) {
      M.addTransfer({ id: transferId, name: file.name, type: 'upload', total: file.size, done: 0, speed: 0, status: 'active', error: null });
    }

    var ac = new AbortController();
    abortControllers[id] = ac;
    renderQueue();

    try {
      var result;
      if (file.size > CHUNK_THRESHOLD) result = await uploadChunked(file, q, ac.signal);
      else result = await uploadDirect(file, q, ac.signal);
      q.status = 'done';
      q.done = file.size;
      if (M.setTransfer) M.setTransfer(transferId, { status: 'done', done: file.size, total: file.size, speed: 0 });
      delete abortControllers[id];
      renderQueue();
      if (M.onUploadComplete) M.onUploadComplete(result, file);
      return result;
    } catch (e) {
      if (e.name === 'AbortError') {
        q.status = 'cancelled';
        q.error = 'Cancelled';
      } else {
        q.status = 'error';
        q.error = e.message || 'Upload failed';
      }
      if (M.setTransfer) M.setTransfer(transferId, { status: 'error', error: q.error, speed: 0 });
      delete abortControllers[id];
      renderQueue();
      throw e;
    }
  }

  async function uploadFiles(files) {
    if (!files.length) return;
    openUpload();
    var ok = 0, fail = 0;
    for (var i = 0; i < files.length; i++) {
      try { await uploadOne(files[i]); ok++; }
      catch (e) { if (e.name !== 'AbortError') fail++; }
    }
    var fi = M.$('#file-input');
    var fo = M.$('#folder-input');
    if (fi) fi.value = '';
    if (fo) fo.value = '';
    if (ok) M.toast('Uploaded ' + ok + ' file(s)' + (fail ? (', ' + fail + ' failed') : ''));
    else if (fail) M.toast(fail + ' upload(s) failed');
  }

  M.uploadFiles = uploadFiles;
  M.openUpload = openUpload;

  ['#empty-upload-btn', '#bottom-upload', '#upload-btn-desktop'].forEach(function (sel) {
    M.$(sel)?.addEventListener('click', openUpload);
  });
  M.$('#upload-close')?.addEventListener('click', closeUpload);
  M.$('#upload-backdrop')?.addEventListener('click', closeUpload);

  M.$('#file-input')?.addEventListener('change', function (e) {
    uploadFiles(Array.from(e.target.files || []));
  });
  M.$('#folder-input')?.addEventListener('change', function (e) {
    uploadFiles(Array.from(e.target.files || []));
  });

  var drop = M.$('#upload-drop');
  drop?.addEventListener('dragover', function (e) { e.preventDefault(); drop.classList.add('dragover'); });
  drop?.addEventListener('dragleave', function () { drop.classList.remove('dragover'); });
  drop?.addEventListener('drop', function (e) {
    e.preventDefault();
    drop.classList.remove('dragover');
    uploadFiles(Array.from(e.dataTransfer?.files || []));
  });

  var overlay = M.$('#drag-overlay');
  var dragCount = 0;
  document.addEventListener('dragenter', function (e) {
    if (!e.dataTransfer?.types?.includes('Files')) return;
    dragCount++;
    overlay?.classList.add('open');
  });
  document.addEventListener('dragleave', function () {
    dragCount--;
    if (dragCount <= 0) { dragCount = 0; overlay?.classList.remove('open'); }
  });
  document.addEventListener('dragover', function (e) {
    if (e.dataTransfer?.types?.includes('Files')) e.preventDefault();
  });
  document.addEventListener('drop', function (e) {
    if (!e.dataTransfer?.files?.length) return;
    e.preventDefault();
    dragCount = 0;
    overlay?.classList.remove('open');
    uploadFiles(Array.from(e.dataTransfer.files));
  });
})();
