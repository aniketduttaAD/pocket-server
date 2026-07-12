(function () {
  var data = document.getElementById('viewer-data');
  var video = document.getElementById('viewer-video');
  var audio = document.getElementById('viewer-audio');
  var hint = document.getElementById('media-audio-hint');

  function showAudioHint() {
    if (hint) hint.classList.add('visible');
  }

  if (video) {
    video.defaultMuted = false;
    video.muted = false;
    video.volume = 1;
    video.removeAttribute('muted');

    video.addEventListener('loadeddata', function () {
      if (video.audioTracks && video.audioTracks.length === 0) {
        showAudioHint();
      }
    });

    video.addEventListener('timeupdate', function onTime() {
      if (video.currentTime > 2) {
        if (typeof video.webkitAudioDecodedByteCount === 'number'
          && video.webkitAudioDecodedByteCount === 0) {
          showAudioHint();
        }
        video.removeEventListener('timeupdate', onTime);
      }
    });
  }

  if (audio && typeof Plyr !== 'undefined') {
    new Plyr(audio, {
      controls: ['play', 'progress', 'current-time', 'duration', 'mute', 'volume'],
    });
  }

  document.getElementById('info-toggle')?.addEventListener('click', function () {
    var info = document.getElementById('viewer-info');
    if (info) info.hidden = !info.hidden;
  });
})();
