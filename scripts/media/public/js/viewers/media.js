(function () {
  if (typeof Plyr === 'undefined') return;

  var video = document.getElementById('viewer-video');
  var audio = document.getElementById('viewer-audio');
  var el = video || audio;
  if (!el) return;

  new Plyr(el, {
    controls: video
      ? ['play-large', 'play', 'progress', 'current-time', 'duration', 'mute', 'volume', 'settings', 'pip', 'fullscreen']
      : ['play', 'progress', 'current-time', 'duration', 'mute', 'volume'],
    settings: video ? ['speed'] : [],
    speed: { selected: 1, options: [0.5, 0.75, 1, 1.25, 1.5, 2] },
  });
})();
