(function () {
  var data = document.getElementById('viewer-data');
  var video = document.getElementById('viewer-video');
  var audio = document.getElementById('viewer-audio');
  var transcodeUrl = data?.dataset.transcode;
  var ffmpegOk = data?.dataset.ffmpeg === '1';
  var transcodeStarted = false;

  function startTranscode() {
    if (!video || !transcodeUrl || transcodeStarted) return;
    transcodeStarted = true;
    var wasTime = video.currentTime || 0;
    var wasPlaying = !video.paused;
    video.pause();
    video.src = transcodeUrl;
    video.load();
    video.addEventListener('loadedmetadata', function onMeta() {
      video.removeEventListener('loadedmetadata', onMeta);
      if (wasTime > 0 && video.duration && wasTime < video.duration - 1) {
        video.currentTime = wasTime;
      }
      if (wasPlaying) video.play().catch(function () {});
    }, { once: true });
  }

  function maybeAutoTranscode() {
    if (!ffmpegOk || !transcodeUrl) return;
    startTranscode();
  }

  if (video) {
    video.defaultMuted = false;
    video.muted = false;
    video.volume = 1;
    video.removeAttribute('muted');

    video.addEventListener('loadeddata', function () {
      if (video.audioTracks && video.audioTracks.length === 0) {
        maybeAutoTranscode();
      }
    });

    video.addEventListener('timeupdate', function onTime() {
      if (video.currentTime > 1.5) {
        if (typeof video.webkitAudioDecodedByteCount === 'number'
          && video.webkitAudioDecodedByteCount === 0) {
          maybeAutoTranscode();
        }
        video.removeEventListener('timeupdate', onTime);
      }
    });

    video.addEventListener('error', function () {
      if (transcodeStarted && transcodeUrl) return;
    });
  }

  if (audio && typeof Plyr !== 'undefined') {
    new Plyr(audio, {
      controls: ['play', 'progress', 'current-time', 'duration', 'mute', 'volume'],
    });
  }
})();
