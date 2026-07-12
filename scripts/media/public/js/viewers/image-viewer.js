(function () {
  var img = document.getElementById('viewer-img');
  if (!img || typeof PhotoSwipeLightbox === 'undefined') return;

  var data = document.getElementById('viewer-data');
  var raw = data?.dataset.raw || img.src;
  var lightbox = null;

  function ensureLightbox() {
    if (lightbox) return lightbox;
    lightbox = new PhotoSwipeLightbox({
      dataSource: [{ src: raw, width: 1600, height: 1200 }],
      pswpModule: function () {
        return import('https://cdn.jsdelivr.net/npm/photoswipe@5.4.4/dist/photoswipe.esm.min.js');
      },
      bgOpacity: 1,
      padding: { top: 48, bottom: 48, left: 0, right: 0 },
    });
    lightbox.init();
    return lightbox;
  }

  img.addEventListener('click', function () {
    var lb = ensureLightbox();
    var w = img.naturalWidth || 1600;
    var h = img.naturalHeight || 1200;
    lb.options.dataSource = [{ src: raw, width: w, height: h }];
    lb.loadAndOpen(0);
  });
})();
