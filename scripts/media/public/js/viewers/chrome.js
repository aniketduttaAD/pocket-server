(function () {
  var root = document.querySelector('.viewer-immersive');
  if (!root) return;

  var data = document.getElementById('viewer-data');
  var kind = data?.dataset.kind || '';
  var hideTimer = null;
  var autoHide = kind === 'image' || kind === 'video';

  function showChrome() {
    root.classList.remove('chrome-hidden');
    if (!autoHide) return;
    clearTimeout(hideTimer);
    hideTimer = setTimeout(function () {
      root.classList.add('chrome-hidden');
    }, 4000);
  }

  function toggleChrome() {
    if (root.classList.contains('chrome-hidden')) showChrome();
    else root.classList.add('chrome-hidden');
  }

  root.addEventListener('mousemove', showChrome, { passive: true });
  root.addEventListener('touchstart', showChrome, { passive: true });

  root.addEventListener('click', function (e) {
    if (e.target.closest(
      '.viewer-chrome, .viewer-controls, .viewer-edge, .viewer-ctl, .viewer-chrome-btn, .viewer-media-bar, .viewer-media-action, video, audio, .plyr, #pdf-canvas-wrap, .cm-editor'
    )) return;
    if (autoHide) toggleChrome();
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

  if (autoHide) showChrome();
})();
