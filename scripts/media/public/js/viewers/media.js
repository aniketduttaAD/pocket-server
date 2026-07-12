(function () {
  var data = document.getElementById('viewer-data');
  var video = document.getElementById('viewer-video');
  var audio = document.getElementById('viewer-audio');
  var hint = document.getElementById('media-audio-hint');
  var transcodeBtn = document.getElementById('media-transcode-btn');

  function showAudioHint() {
    if (hint) hint.classList.add('visible');
  }

  if (video) {
    video.defaultMuted = false;
    video.muted = false;
    video.volume = 1;
    video.removeAttribute('muted');

    function startTranscode(btn) {
      var transcodeUrl = data?.dataset.transcode;
      if (!transcodeUrl) return;

      var wasTime = video.currentTime || 0;
      var wasPlaying = !video.paused;
      if (btn) {
        btn.disabled = true;
        var label = btn.querySelector('.btn-label');
        if (label) label.textContent = 'Converting…';
        else btn.textContent = 'Converting…';
      }

      video.pause();
      video.src = transcodeUrl;
      video.load();

      video.addEventListener('loadedmetadata', function onMeta() {
        video.removeEventListener('loadedmetadata', onMeta);
        if (wasTime > 0 && video.duration && wasTime < video.duration - 1) {
          video.currentTime = wasTime;
        }
        if (wasPlaying) video.play().catch(function () {});
        if (btn) btn.hidden = true;
        if (transcodeBtn) transcodeBtn.hidden = true;
        if (hint) hint.classList.remove('visible');
      });

      video.addEventListener('error', function onErr() {
        video.removeEventListener('error', onErr);
        if (btn) {
          btn.disabled = false;
          var lbl = btn.querySelector('.btn-label');
          if (lbl) lbl.textContent = 'Browser audio';
        }
        showAudioHint();
      });
    }

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

    if (transcodeBtn) {
      transcodeBtn.addEventListener('click', function () {
        startTranscode(transcodeBtn);
      });
    }

    document.getElementById('media-transcode-toolbar')?.addEventListener('click', function () {
      startTranscode(this);
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
