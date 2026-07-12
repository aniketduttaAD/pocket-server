(function () {
  var data = document.getElementById('viewer-data');
  var video = document.getElementById('viewer-video');
  var audio = document.getElementById('viewer-audio');
  var statusEl = document.getElementById('viewer-media-status');
  var fixBtn = document.getElementById('viewer-audio-fix');
  var transcodeUrl = data?.dataset.transcode;
  var ffmpegOk = data?.dataset.ffmpeg === '1';
  var transcodeFirst = data?.dataset.transcodeAudio === '1';
  var transcodeStarted = transcodeFirst;
  var player = null;
  var M = window.MediaLib || window.Media;

  var PLYR_CONTROLS = [
    'play-large', 'play', 'progress', 'current-time', 'duration',
    'mute', 'volume', 'settings', 'pip', 'fullscreen',
  ];

  function setStatus(msg, showFix) {
    if (!statusEl) return;
    if (!msg) {
      statusEl.hidden = true;
      statusEl.textContent = '';
      return;
    }
    statusEl.hidden = false;
    statusEl.textContent = msg;
    if (fixBtn) fixBtn.hidden = !showFix;
  }

  function startTranscode(opts) {
    opts = opts || {};
    if (!video || !transcodeUrl || transcodeStarted) return;
    transcodeStarted = true;
    var wasTime = video.currentTime || 0;
    var wasPlaying = opts.forcePlay || !video.paused;
    setStatus('Converting audio to AAC…', false);
    video.pause();
    if (player) player.source = { type: 'video', sources: [{ src: transcodeUrl, type: 'video/mp4' }] };
    else video.src = transcodeUrl;
    video.load();
    video.muted = false;
    video.defaultMuted = false;
    video.volume = 1;
    video.removeAttribute('muted');
    var onReady = function () {
      video.removeEventListener('loadedmetadata', onReady);
      if (wasTime > 0 && video.duration && wasTime < video.duration - 1) {
        video.currentTime = wasTime;
      }
      setStatus('AAC audio', false);
      if (wasPlaying) {
        var p = video.play();
        if (p && p.catch) p.catch(function () {});
      }
      M?.toast?.('Audio enabled via server transcode');
    };
    video.addEventListener('loadedmetadata', onReady, { once: true });
  }

  function maybeAutoTranscode() {
    if (!ffmpegOk || !transcodeUrl) {
      if (!ffmpegOk) setStatus('No audio — install ffmpeg on server', false);
      return;
    }
    startTranscode();
  }

  function hasDecodedAudio() {
    if (typeof video.mozHasAudio === 'boolean') return video.mozHasAudio;
    if (typeof video.webkitAudioDecodedByteCount === 'number') {
      return video.webkitAudioDecodedByteCount > 0;
    }
    if (video.audioTracks && video.audioTracks.length === 0) return false;
    return null;
  }

  function bindAudioWatch() {
    if (!video || transcodeFirst) return;

    video.addEventListener('loadeddata', function () {
      if (video.audioTracks && video.audioTracks.length === 0) maybeAutoTranscode();
    });

    video.addEventListener('playing', function onPlay() {
      setTimeout(function () {
        var decoded = hasDecodedAudio();
        if (decoded === false) {
          maybeAutoTranscode();
        } else if (decoded === null && ffmpegOk) {
          setStatus('No audio?', true);
        }
      }, 1800);
      video.removeEventListener('playing', onPlay);
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
      if (transcodeStarted || !ffmpegOk) return;
      maybeAutoTranscode();
    });
  }

  if (video && typeof Plyr !== 'undefined') {
    player = new Plyr(video, {
      controls: PLYR_CONTROLS,
      settings: ['quality', 'speed'],
      speed: { selected: 1, options: [0.5, 0.75, 1, 1.25, 1.5, 2] },
      ratio: null,
      fullscreen: { enabled: true, fallback: true, iosNative: true },
      clickToPlay: true,
      hideControls: true,
    });

    video.muted = false;
    video.defaultMuted = false;
    video.volume = 1;
    video.removeAttribute('muted');

    player.on('ready', function () {
      bindAudioWatch();
      if (transcodeFirst) setStatus('AAC audio', false);
    });

    player.on('play', function () {
      video.muted = false;
      if (video.volume < 1) video.volume = 1;
    });
  } else if (video) {
    bindAudioWatch();
    if (transcodeFirst) setStatus('AAC audio', false);
  }

  fixBtn?.addEventListener('click', function () {
    startTranscode({ forcePlay: true });
  });

  if (audio && typeof Plyr !== 'undefined') {
    new Plyr(audio, {
      controls: ['play', 'progress', 'current-time', 'duration', 'mute', 'volume'],
    });
  }
})();
