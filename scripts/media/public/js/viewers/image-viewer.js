(function () {
  var img = document.getElementById('viewer-img');
  if (!img || typeof PhotoSwipeLightbox === 'undefined') return;

  var data = document.getElementById('viewer-data');
  var raw = data?.dataset.raw || img.src;
  var name = data?.dataset.name || 'image';

  var lightbox = new PhotoSwipeLightbox({
    dataSource: [{ src: raw, width: 1600, height: 1200, alt: name }],
    pswpModule: function () {
      return import('https://cdn.jsdelivr.net/npm/photoswipe@5.4.4/dist/photoswipe.esm.min.js');
    },
  });
  lightbox.init();

  img.style.cursor = 'zoom-in';
  img.addEventListener('click', function () {
    lightbox.loadAndOpen(0);
  });
})();
