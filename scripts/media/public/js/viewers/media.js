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
  var M = window.MediaLib || window.Media || {};

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
    setStatus('Converting…', false);
    video.pause();
    if (player && player.source !== undefined) {
      try {
        player.source = { type: 'video', sources: [{ src: transcodeUrl, type: 'video/mp4' }] };
      } catch (e) {
        video.src = transcodeUrl;
      }
    } else {
      video.src = transcodeUrl;
    }
    video.load();
    unmute(video);
    var onReady = function () {
      video.removeEventListener('loadedmetadata', onReady);
      if (wasTime > 0 && video.duration && wasTime < video.duration - 1) {
        video.currentTime = wasTime;
      }
      setStatus('AAC', false);
      if (wasPlaying) {
        var p = video.play();
        if (p && p.catch) p.catch(function () {});
      }
      if (M.toast) M.toast('Audio converted to AAC');
    };
    video.addEventListener('loadedmetadata', onReady, { once: true });
  }

  function unmute(el) {
    try {
      el.muted = false;
      el.defaultMuted = false;
      el.volume = 1;
      el.removeAttribute('muted');
    } catch (e) {}
  }

  function maybeAutoTranscode() {
    if (!ffmpegOk || !transcodeUrl) {
      if (!ffmpegOk) setStatus('No audio — install ffmpeg', false);
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
      video.removeEventListener('playing', onPlay);
      setTimeout(function () {
        if (transcodeStarted) return;
        var decoded = hasDecodedAudio();
        if (decoded === false) {
          maybeAutoTranscode();
        } else if (decoded === null && ffmpegOk) {
          setStatus('No audio?', true);
        }
      }, 1800);
    });

    video.addEventListener('timeupdate', function onTime() {
      if (video.currentTime > 1.5) {
        video.removeEventListener('timeupdate', onTime);
        if (transcodeStarted) return;
        if (typeof video.webkitAudioDecodedByteCount === 'number'
          && video.webkitAudioDecodedByteCount === 0) {
          maybeAutoTranscode();
        }
      }
    });

    video.addEventListener('error', function () {
      if (transcodeStarted || !ffmpegOk) return;
      var err = video.error;
      if (err && (err.code === 3 || err.code === 4)) {
        maybeAutoTranscode();
      }
    });
  }

  if (video) {
    unmute(video);

    if (typeof Plyr !== 'undefined') {
      try {
        player = new Plyr(video, {
          controls: [
            'play-large', 'play', 'progress', 'current-time', 'duration',
            'mute', 'volume', 'settings', 'pip', 'fullscreen',
          ],
          settings: ['quality', 'speed'],
          speed: { selected: 1, options: [0.5, 0.75, 1, 1.25, 1.5, 2] },
          ratio: null,
          fullscreen: { enabled: true, fallback: true, iosNative: true },
          clickToPlay: true,
          hideControls: true,
          resetOnEnd: false,
          keyboard: { focused: true, global: false },
        });

        player.on('ready', function () {
          unmute(video);
          bindAudioWatch();
          if (transcodeFirst) setStatus('AAC', false);
        });

        player.on('play', function () {
          unmute(video);
        });
      } catch (e) {
        video.controls = true;
        bindAudioWatch();
        if (transcodeFirst) setStatus('AAC', false);
      }
    } else {
      video.controls = true;
      bindAudioWatch();
      if (transcodeFirst) setStatus('AAC', false);
    }
  }

  if (fixBtn) {
    fixBtn.addEventListener('click', function () {
      startTranscode({ forcePlay: true });
    });
  }

  if (audio) {
    unmute(audio);
    if (typeof Plyr !== 'undefined') {
      try {
        new Plyr(audio, {
          controls: ['play', 'progress', 'current-time', 'duration', 'mute', 'volume'],
          hideControls: false,
        });
      } catch (e) {
        audio.controls = true;
      }
    } else {
      audio.controls = true;
    }
  }
})();
