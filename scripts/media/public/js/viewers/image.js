(function () {
  var dataEl = document.getElementById('gallery-data');
  if (!dataEl || typeof PhotoSwipeLightbox === 'undefined') return;

  var items = [];
  try { items = JSON.parse(dataEl.textContent || '[]'); } catch (e) { return; }
  if (!items.length) return;

  var lightbox = new PhotoSwipeLightbox({
    dataSource: items,
    pswpModule: function () {
      return import('https://cdn.jsdelivr.net/npm/photoswipe@5.4.4/dist/photoswipe.esm.min.js');
    },
    bgOpacity: 0.92,
  });

  lightbox.on('uiRegister', function () {
    lightbox.pswp.ui.registerElement({
      name: 'download-button',
      order: 8,
      isButton: true,
      html: '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/></svg>',
      onClick: function (e, el, pswp) {
        var item = pswp.currSlide.data;
        if (item && (window.MediaLib || window.Media)?.downloadTracked) {
          (window.MediaLib || window.Media).downloadTracked(item.view + '?download=1', item.name, 0);
        }
      },
    });
  });

  lightbox.init();

  document.querySelectorAll('[data-lightbox]').forEach(function (el) {
    el.addEventListener('click', function (e) {
      e.preventDefault();
      var idx = parseInt(el.dataset.index, 10) || 0;
      lightbox.loadAndOpen(idx);
    });
  });
})();
