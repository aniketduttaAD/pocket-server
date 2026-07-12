const { spawn, execSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { UPLOAD_TMP } = require('./config');
const { serveFile } = require('./serve');

let ffmpegAvailable = null;
const activeJobs = new Map();

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

  const client = { req, res, ended: false };
  job.clients.push(client);

  if (!res.headersSent) {
    res.writeHead(200, {
      'Content-Type': 'video/mp4',
      'Transfer-Encoding': 'chunked',
      'Cache-Control': 'no-cache',
    });
  }

  req.on('close', () => {
    client.ended = true;
    const idx = job.clients.indexOf(client);
    if (idx >= 0) job.clients.splice(idx, 1);
    if (!job.clients.length && !job.done && job.ff) {
      job.ff.kill('SIGKILL');
      activeJobs.delete(job.cache);
      fs.unlink(job.partial, () => {});
    }
  });
}

module.exports = { isFfmpegAvailable, serveTranscoded };
