(function () {
  var data = document.getElementById('viewer-data');
  var video = document.getElementById('viewer-video');
  var audio = document.getElementById('viewer-audio');
  var hint = document.getElementById('media-audio-hint');

  function showAudioHint() {
    if (hint) hint.hidden = false;
  }

  if (video) {
    video.muted = false;
    video.defaultMuted = false;
    video.volume = 1;
    video.setAttribute('muted', 'false');

    video.addEventListener('loadedmetadata', function () {
      var mime = data?.dataset.mime || '';
      if (mime && video.canPlayType(mime) === '') {
        showAudioHint();
      }
    });

    video.addEventListener('volumechange', function () {
      if (video.muted) {
        video.muted = false;
        video.volume = 1;
      }
    });

    video.addEventListener('playing', function () {
      window.setTimeout(function () {
        if (typeof video.webkitAudioDecodedByteCount === 'number'
          && video.webkitAudioDecodedByteCount === 0
          && video.currentTime > 1.5
          && !video.paused) {
          showAudioHint();
        }
      }, 2000);
    });

    video.addEventListener('error', function () {
      showAudioHint();
    });

    document.addEventListener('click', function once() {
      if (video.paused) {
        video.play().catch(function () {});
      }
      document.removeEventListener('click', once);
    }, { once: true });
  }

  if (audio && typeof Plyr !== 'undefined') {
    new Plyr(audio, {
      controls: ['play', 'progress', 'current-time', 'duration', 'mute', 'volume'],
    });
  }
})();
