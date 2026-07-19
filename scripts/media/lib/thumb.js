/**
 * Cached image/video thumbnails via ffmpeg.
 * Query: ?thumb=1  →  JPEG ~420px long edge, long-lived cache.
 */
const { spawn, execSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { UPLOAD_TMP } = require('./config');
const { fileKind } = require('./paths');

const THUMB_SIZE = 420;
const CACHE_MAX_AGE = 7 * 24 * 60 * 60; // 7 days
const EVICT_MS = 24 * 60 * 60 * 1000;
const MAX_CACHE_FILES = 800;

let ffmpegAvailable = null;
const inflight = new Map();

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

function thumbCachePath(abs, st) {
  const hash = crypto.createHash('sha256')
    .update(`thumb:${abs}:${st.mtimeMs}:${st.size}:${THUMB_SIZE}`)
    .digest('hex')
    .slice(0, 20);
  return path.join(UPLOAD_TMP, `th-${hash}.jpg`);
}

function evictOldThumbs() {
  try {
    if (!fs.existsSync(UPLOAD_TMP)) return;
    const files = fs.readdirSync(UPLOAD_TMP)
      .filter((f) => f.startsWith('th-') && f.endsWith('.jpg'))
      .map((f) => {
        const abs = path.join(UPLOAD_TMP, f);
        try {
          const st = fs.statSync(abs);
          return { abs, mtime: st.mtimeMs };
        } catch {
          return null;
        }
      })
      .filter(Boolean)
      .sort((a, b) => a.mtime - b.mtime);

    const cutoff = Date.now() - EVICT_MS * 14;
    for (const f of files) {
      if (f.mtime < cutoff || files.length > MAX_CACHE_FILES) {
        try { fs.unlinkSync(f.abs); } catch {}
      }
    }
  } catch {}
}
setInterval(evictOldThumbs, EVICT_MS).unref();

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const proc = spawn('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    proc.stderr.on('data', (d) => { err += d; });
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(err.slice(-400) || `ffmpeg exit ${code}`));
    });
  });
}

async function generateThumb(abs, cache, kind) {
  const partial = `${cache}.part`;
  try {
    if (kind === 'video') {
      // Seek ~1s in for a better frame; fall back to start if short
      await runFfmpeg([
        '-y', '-ss', '1', '-i', abs,
        '-frames:v', '1',
        '-vf', `scale=${THUMB_SIZE}:${THUMB_SIZE}:force_original_aspect_ratio=decrease`,
        '-q:v', '6',
        partial,
      ]).catch(() => runFfmpeg([
        '-y', '-i', abs,
        '-frames:v', '1',
        '-vf', `scale=${THUMB_SIZE}:${THUMB_SIZE}:force_original_aspect_ratio=decrease`,
        '-q:v', '6',
        partial,
      ]));
    } else {
      await runFfmpeg([
        '-y', '-i', abs,
        '-frames:v', '1',
        '-vf', `scale=${THUMB_SIZE}:${THUMB_SIZE}:force_original_aspect_ratio=decrease`,
        '-q:v', '5',
        partial,
      ]);
    }
    await fs.promises.rename(partial, cache);
  } catch (e) {
    try { await fs.promises.unlink(partial); } catch {}
    throw e;
  }
}

function sendCached(req, res, cache, st) {
  const etag = `"th-${st.size}-${Math.floor(st.mtimeMs)}"`;
  if (req.headers['if-none-match'] === etag) {
    res.writeHead(304);
    return res.end();
  }
  const headers = {
    'Content-Type': 'image/jpeg',
    'Content-Length': st.size,
    'ETag': etag,
    'Cache-Control': `public, max-age=${CACHE_MAX_AGE}, immutable`,
  };
  if (req.method === 'HEAD') {
    res.writeHead(200, headers);
    return res.end();
  }
  res.writeHead(200, headers);
  fs.createReadStream(cache).pipe(res);
}

/**
 * Serve a thumbnail for image or video. Falls back to false so caller can stream original.
 */
async function serveThumb(req, res, abs) {
  const kind = fileKind(path.basename(abs));
  if (kind !== 'image' && kind !== 'video') return false;
  if (!isFfmpegAvailable()) return false;

  // Skip SVG / tiny GIFs — browser handles them fine at full size
  const ext = path.extname(abs).toLowerCase();
  if (ext === '.svg' || ext === '.ico') return false;

  let st;
  try {
    st = await fs.promises.stat(abs);
  } catch {
    return false;
  }

  // Tiny images: just serve original via caller
  if (kind === 'image' && st.size < 48 * 1024) return false;

  const cache = thumbCachePath(abs, st);

  try {
    const cst = await fs.promises.stat(cache);
    if (cst.isFile() && cst.size > 0) {
      sendCached(req, res, cache, cst);
      return true;
    }
  } catch {}

  // Deduplicate concurrent generation for the same file
  let job = inflight.get(cache);
  if (!job) {
    job = generateThumb(abs, cache, kind).finally(() => inflight.delete(cache));
    inflight.set(cache, job);
  }

  try {
    await job;
    const cst = await fs.promises.stat(cache);
    sendCached(req, res, cache, cst);
    return true;
  } catch (e) {
    console.error('thumb error:', path.basename(abs), e.message);
    return false;
  }
}

module.exports = { serveThumb, isFfmpegAvailable, THUMB_SIZE };
