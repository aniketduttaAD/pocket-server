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

  // When transcoding in real-time, the server streams chunked MP4 with no Content-Length.
  // The browser can't seek, and duration keeps updating as more data arrives.
  // We poll the transcode URL until it responds with Accept-Ranges (meaning it's cached),
  // then swap the source so seeking works normally.
  function pollForSeekable() {
    if (!transcodeUrl) return;
    var xhr = new XMLHttpRequest();
    xhr.open('HEAD', transcodeUrl);
    xhr.timeout = 5000;
    var retry = function () { setTimeout(pollForSeekable, 12000); };
    xhr.onload = function () {
      var ranges = xhr.getResponseHeader('Accept-Ranges');
      if (xhr.status === 200 && ranges && ranges.indexOf('bytes') >= 0) {
        // Cached! Reload source so user can seek.
        var wasTime = video.currentTime || 0;
        var wasPlaying = !video.paused;
        if (player && typeof player.source !== 'undefined') {
          try {
            player.source = { type: 'video', sources: [{ src: transcodeUrl, type: 'video/mp4' }] };
          } catch (e) {
            video.src = transcodeUrl;
            video.load();
          }
        } else {
          video.src = transcodeUrl;
          video.load();
        }
        unmute(video);
        video.addEventListener('loadedmetadata', function onMeta() {
          video.removeEventListener('loadedmetadata', onMeta);
          if (wasTime > 2) {
            try { video.currentTime = wasTime; } catch (e) {}
          }
          if (wasPlaying) {
            var p = video.play();
            if (p && p.catch) p.catch(function () {});
          }
          setStatus('AAC', false);
          if (M.toast) M.toast('Video ready — seeking enabled');
        }, { once: true });
      } else {
        retry();
      }
    };
    xhr.onerror = retry;
    xhr.ontimeout = retry;
    xhr.send();
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
          iconUrl: '/__assets/vendor/plyr.svg',
        });

        player.on('ready', function () {
          unmute(video);
          bindAudioWatch();
          if (transcodeFirst) {
            setStatus('Converting…', false);
            // Start polling — once transcode cache is ready the user can seek
            setTimeout(pollForSeekable, 10000);
          }
        });

        player.on('play', function () {
          unmute(video);
        });
      } catch (e) {
        video.controls = true;
        bindAudioWatch();
        if (transcodeFirst) {
          setStatus('Converting…', false);
          setTimeout(pollForSeekable, 10000);
        }
      }
    } else {
      video.controls = true;
      bindAudioWatch();
      if (transcodeFirst) {
        setStatus('Converting…', false);
        setTimeout(pollForSeekable, 10000);
      }
    }
  }

  if (fixBtn) {
    fixBtn.addEventListener('click', function () {
      startTranscode({ forcePlay: true });
    });
  }

  // Auto-retry the transcode stream on network errors (e.g. H2 reset, network change)
  if (video && transcodeFirst) {
    var retryCount = 0;
    var retryTimer = null;
    video.addEventListener('error', function () {
      var err = video.error;
      if (!err || !transcodeUrl) return;
      // MEDIA_ERR_NETWORK (2) or MEDIA_ERR_SRC_NOT_SUPPORTED (4) → retry
      if ((err.code === 2 || err.code === 4) && retryCount < 6) {
        var delay = Math.min(3000 * Math.pow(1.8, retryCount), 30000);
        retryCount++;
        setStatus('Reconnecting…', false);
        clearTimeout(retryTimer);
        retryTimer = setTimeout(function () {
          var wasTime = video.currentTime || 0;
          video.src = transcodeUrl + '&_r=' + retryCount;
          video.load();
          unmute(video);
          video.addEventListener('loadedmetadata', function onMeta() {
            video.removeEventListener('loadedmetadata', onMeta);
            if (wasTime > 2) { try { video.currentTime = wasTime; } catch (e) {} }
            var p = video.play();
            if (p && p.catch) p.catch(function () {});
            setStatus('AAC', false);
          }, { once: true });
        }, delay);
      }
    });

    video.addEventListener('playing', function () {
      retryCount = 0;
      clearTimeout(retryTimer);
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
