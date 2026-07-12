(function () {
  var root = document.querySelector('.viewer-immersive');
  if (!root) return;

  var data = document.getElementById('viewer-data');
  var kind = data?.dataset.kind || '';
  var hideTimer = null;
  // For video: dim the chrome (not hide) after inactivity. For image: hide fully.
  var autoDim = kind === 'video';
  var autoHide = kind === 'image';

  function showChrome() {
    root.classList.remove('chrome-hidden', 'chrome-dimmed');
    if (!autoDim && !autoHide) return;
    clearTimeout(hideTimer);
    hideTimer = setTimeout(function () {
      if (autoHide) root.classList.add('chrome-hidden');
      else if (autoDim) root.classList.add('chrome-dimmed');
    }, 3500);
  }

  function toggleChrome() {
    var hidden = root.classList.contains('chrome-hidden') || root.classList.contains('chrome-dimmed');
    if (hidden) showChrome();
    else {
      clearTimeout(hideTimer);
      if (autoHide) root.classList.add('chrome-hidden');
      else if (autoDim) root.classList.add('chrome-dimmed');
    }
  }

  root.addEventListener('mousemove', showChrome, { passive: true });
  root.addEventListener('touchstart', showChrome, { passive: true });

  root.addEventListener('click', function (e) {
    if (e.target.closest(
      '.viewer-chrome, .viewer-controls, .viewer-edge, .viewer-ctl, .viewer-chrome-btn, .viewer-audio-fix-btn, .viewer-media-status, .viewer-info-overlay, video, audio, .plyr, #pdf-canvas-wrap, .cm-editor'
    )) return;
    if (autoDim || autoHide) toggleChrome();
  });

  document.addEventListener('keydown', function (e) {
    if (e.target.matches('input, textarea, select, [contenteditable="true"], .cm-content')) return;

    var prev = root.querySelector('.viewer-edge--prev');
    var next = root.querySelector('.viewer-edge--next');

    if (e.key === 'ArrowLeft' && prev) {
      e.preventDefault();
      window.location.href = prev.getAttribute('href');
    }
    if (e.key === 'ArrowRight' && next) {
      e.preventDefault();
      window.location.href = next.getAttribute('href');
    }
    if (e.key === 'Escape') {
      var infoOv = document.getElementById('viewer-info-overlay');
      if (infoOv && infoOv.classList.contains('open')) {
        infoOv.classList.remove('open');
        infoOv.setAttribute('aria-hidden', 'true');
        return;
      }
      var back = root.querySelector('.viewer-chrome-btn[aria-label="Back"]');
      if (back) window.location.href = back.getAttribute('href');
    }
  });

  var sx = 0;
  var sy = 0;
  root.addEventListener('touchstart', function (e) {
    if (e.touches.length !== 1) return;
    sx = e.touches[0].clientX;
    sy = e.touches[0].clientY;
  }, { passive: true });

  root.addEventListener('touchend', function (e) {
    if (e.changedTouches.length !== 1) return;
    var dx = e.changedTouches[0].clientX - sx;
    var dy = e.changedTouches[0].clientY - sy;
    if (Math.abs(dx) < 72 || Math.abs(dx) < Math.abs(dy) * 1.4) return;
    var prev = root.querySelector('.viewer-edge--prev');
    var next = root.querySelector('.viewer-edge--next');
    if (dx > 0 && prev) window.location.href = prev.getAttribute('href');
    else if (dx < 0 && next) window.location.href = next.getAttribute('href');
  });

  if (autoDim || autoHide) showChrome();

  // Info panel
  var infoOverlay = document.getElementById('viewer-info-overlay');
  var infoBtn = document.getElementById('viewer-info-btn');
  var infoClose = document.getElementById('viewer-info-close');
  var infoBackdrop = document.getElementById('viewer-info-backdrop');

  function openInfo() {
    if (!infoOverlay) return;
    infoOverlay.classList.add('open');
    infoOverlay.setAttribute('aria-hidden', 'false');
    showChrome();
  }

  function closeInfo() {
    if (!infoOverlay) return;
    infoOverlay.classList.remove('open');
    infoOverlay.setAttribute('aria-hidden', 'true');
  }

  infoBtn?.addEventListener('click', function (e) {
    e.stopPropagation();
    openInfo();
  });

  infoClose?.addEventListener('click', closeInfo);
  infoBackdrop?.addEventListener('click', closeInfo);
})();
