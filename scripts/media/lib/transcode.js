const { spawn, execSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { UPLOAD_TMP } = require('./config');
const { serveFile } = require('./serve');

let ffmpegAvailable = null;
const activeJobs = new Map();

// Every 6 hours wipe all completed transcode caches.
// Skips any file that belongs to an actively-running job so in-progress
// transcodes are never interrupted. Does NOT run on startup so cache
// from a previous server session is reused immediately.
function evictAllCache() {
  try {
    const dir = UPLOAD_TMP;
    if (!fs.existsSync(dir)) return;
    const activeFiles = new Set();
    for (const job of activeJobs.values()) {
      activeFiles.add(job.cache);
      activeFiles.add(job.partial);
    }
    for (const f of fs.readdirSync(dir)) {
      if (!f.startsWith('tx-')) continue;
      const abs = path.join(dir, f);
      if (activeFiles.has(abs)) continue;
      try { fs.unlinkSync(abs); } catch {}
    }
  } catch {}
}
setInterval(evictAllCache, 6 * 60 * 60 * 1000).unref();

function isFfmpegAvailable() {
  if (ffmpegAvailable !== null) return ffmpegAvailable;
  try {
    execSync('ffmpeg -version', { stdio: 'ignore' });
    ffmpegAvailable = true;
  } catch {
    ffmpegAvailable = false;
  }
  return ffmpegAvailable;
}

const BROWSER_AUDIO_CODECS = new Set([
  'aac', 'mp3', 'opus', 'vorbis', 'flac', 'alac',
  'pcm_s16le', 'pcm_s24le', 'pcm_f32le', 'pcm_s16be',
]);

function needsAudioTranscode(abs) {
  if (!isFfmpegAvailable()) return false;
  try {
    const out = execSync(
      `ffprobe -v error -select_streams a:0 -show_entries stream=codec_name -of csv=p=0 ${JSON.stringify(abs)}`,
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    );
    const codec = out.trim().toLowerCase();
    return !!codec && !BROWSER_AUDIO_CODECS.has(codec);
  } catch {
    return false;
  }
}

function cachePath(abs, st) {
  const hash = crypto.createHash('sha256')
    .update(`${abs}:${st.mtimeMs}:${st.size}`)
    .digest('hex')
    .slice(0, 20);
  return path.join(UPLOAD_TMP, `tx-${hash}.mp4`);
}

function metaPath(cache) {
  return `${cache}.meta.json`;
}

function readCacheMeta(cache) {
  try {
    return JSON.parse(fs.readFileSync(metaPath(cache), 'utf8'));
  } catch {
    return null;
  }
}

function writeCacheMeta(cache, meta) {
  fs.writeFileSync(metaPath(cache), JSON.stringify(meta));
}

function serveTranscoded(req, res, abs) {
  fs.stat(abs, async (err, st) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      return res.end('Not found');
    }

    if (!isFfmpegAvailable()) {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({
        error: 'ffmpeg not installed',
        hint: 'Run: pkg install ffmpeg',
      }));
    }

    const cache = cachePath(abs, st);
    const meta = readCacheMeta(cache);

    if (fs.existsSync(cache) && meta && meta.sourceMtime === st.mtimeMs && meta.sourceSize === st.size) {
      return serveFile(req, res, cache, false);
    }

    if (activeJobs.has(cache)) {
      return pipeFromJob(activeJobs.get(cache), req, res);
    }

    const partial = `${cache}.partial`;
    const job = startTranscodeJob(abs, cache, partial, st);
    activeJobs.set(cache, job);
    pipeFromJob(job, req, res);
  });
}

function startTranscodeJob(abs, cache, partial, st) {
  const job = {
    abs,
    cache,
    partial,
    st,
    clients: [],
    ff: null,
    cacheStream: null,
    done: false,
    error: null,
  };

  fs.mkdirSync(path.dirname(cache), { recursive: true });

  const args = [
    '-hide_banner',
    '-loglevel',
    'error',
    '-nostdin',
    '-i',
    abs,
    '-map',
    '0:v:0?',
    '-map',
    '0:a:0?',
    '-c:v',
    'copy',
    '-c:a',
    'aac',
    '-b:a',
    '192k',
    '-ac',
    '2',
    '-movflags',
    'frag_keyframe+empty_moov+default_base_moof',
    '-f',
    'mp4',
    'pipe:1',
  ];

  job.ff = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });
  job.cacheStream = fs.createWriteStream(partial);

  job.ff.stdout.on('data', (chunk) => {
    for (const client of job.clients) {
      if (!client.ended) client.res.write(chunk);
    }
    job.cacheStream.write(chunk);
  });

  job.ff.stderr.on('data', (buf) => {
    job.error = buf.toString().trim();
  });

  job.ff.on('close', (code) => {
    job.cacheStream.end(() => {
      if (code === 0) {
        try {
          fs.renameSync(partial, cache);
          writeCacheMeta(cache, {
            sourceMtime: st.mtimeMs,
            sourceSize: st.size,
            createdAt: Date.now(),
          });
          job.done = true;
        } catch (e) {
          job.error = e.message;
        }
      } else if (!job.error) {
        job.error = `ffmpeg exited ${code}`;
      }
      fs.unlink(partial, () => {});
      activeJobs.delete(cache);
      for (const client of job.clients) {
        if (!client.ended) client.res.end();
      }
    });
  });

  return job;
}

function pipeFromJob(job, req, res) {
  if (job.done && fs.existsSync(job.cache)) {
    return serveFile(req, res, job.cache, false);
  }

  // Cancel any pending kill timer (client reconnected in time)
  if (job._killTimer) {
    clearTimeout(job._killTimer);
    job._killTimer = null;
  }

  const client = { req, res, ended: false };
  job.clients.push(client);

  if (!res.headersSent) {
    res.writeHead(200, {
      'Content-Type': 'video/mp4',
      'Cache-Control': 'no-store',
      'X-Accel-Buffering': 'no',
    });
  }

  req.on('close', () => {
    client.ended = true;
    const idx = job.clients.indexOf(client);
    if (idx >= 0) job.clients.splice(idx, 1);
    // Give a 45-second grace period before killing the transcode in case
    // the client reconnects (e.g., network blip, H2 reset, background tab).
    if (!job.clients.length && !job.done && job.ff) {
      job._killTimer = setTimeout(() => {
        if (!job.clients.length && !job.done && job.ff) {
          job.ff.kill('SIGKILL');
          activeJobs.delete(job.cache);
          fs.unlink(job.partial, () => {});
        }
      }, 45000);
    }
  });
}

module.exports = { isFfmpegAvailable, needsAudioTranscode, serveTranscoded };
