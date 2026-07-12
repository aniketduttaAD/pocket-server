const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { pipeline } = require('stream/promises');
const { ROOT, MAX_UPLOAD_BYTES, CHUNK_SIZE, UPLOAD_TMP } = require('./config');
const { safePath, sanitizeFilename, uniqueName } = require('./paths');
const { sendJson, readBody, readJsonBody, formatSize } = require('./util');

fs.mkdirSync(UPLOAD_TMP, { recursive: true });

// Clean up abandoned chunked-upload sessions older than 2 hours.
// Runs every hour so a stalled 10 GB upload doesn't squat on storage forever.
function evictStaleUploads() {
  try {
    const cutoff = Date.now() - 2 * 60 * 60 * 1000;
    for (const entry of fs.readdirSync(UPLOAD_TMP, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const dir = path.join(UPLOAD_TMP, entry.name);
      const manifest = path.join(dir, 'manifest.json');
      try {
        const m = JSON.parse(fs.readFileSync(manifest, 'utf8'));
        if ((m.created || 0) < cutoff) fs.rm(dir, { recursive: true, force: true }, () => {});
      } catch {
        // No manifest or unreadable — stale, remove it
        try { fs.rm(dir, { recursive: true, force: true }, () => {}); } catch {}
      }
    }
  } catch {}
}
evictStaleUploads();
setInterval(evictStaleUploads, 60 * 60 * 1000).unref();

function parseMultipart(buffer, boundary) {
  const delim = Buffer.from(`--${boundary}`);
  const parts = [];
  let start = buffer.indexOf(delim) + delim.length + 2;

  while (start < buffer.length) {
    const end = buffer.indexOf(delim, start);
    if (end === -1) break;
    const part = buffer.slice(start, end - 2);
    const headerEnd = part.indexOf('\r\n\r\n');
    if (headerEnd === -1) break;
    const headers = part.slice(0, headerEnd).toString();
    const body = part.slice(headerEnd + 4);
    const nameMatch = /name="([^"]+)"/.exec(headers);
    const fileMatch = /filename="([^"]+)"/.exec(headers);
    if (nameMatch) {
      parts.push({
        name: nameMatch[1],
        filename: fileMatch ? path.basename(fileMatch[1]) : null,
        data: body,
      });
    }
    start = end + delim.length + 2;
  }
  return parts;
}

function streamToFile(req, targetPath, maxBytes) {
  return new Promise((resolve, reject) => {
    let received = 0;
    let aborted = false;
    const ws = fs.createWriteStream(targetPath);

    const fail = (err) => {
      if (aborted) return;
      aborted = true;
      req.destroy();
      ws.destroy();
      fs.unlink(targetPath, () => {});
      reject(err);
    };

    req.on('data', (chunk) => {
      received += chunk.length;
      if (received > maxBytes) {
        fail(new Error('File exceeds upload limit'));
      }
    });
    req.on('error', fail);
    ws.on('error', fail);
    ws.on('finish', () => {
      if (!aborted) resolve(received);
    });

    req.pipe(ws);
  });
}

function uploadManifestPath(uploadId) {
  return path.join(UPLOAD_TMP, uploadId, 'manifest.json');
}

function uploadChunkDir(uploadId) {
  return path.join(UPLOAD_TMP, uploadId);
}

function handleStreamUpload(req, res, absDir, filename) {
  const safeName = sanitizeFilename(filename);
  if (!safeName) {
    return sendJson(res, 400, { error: 'Invalid filename' });
  }

  const finalName = uniqueName(absDir, safeName);
  const target = path.join(absDir, finalName);
  if (!target.startsWith(ROOT)) {
    return sendJson(res, 403, { error: 'Forbidden path' });
  }

  const cl = parseInt(req.headers['content-length'] || '0', 10);
  if (cl > MAX_UPLOAD_BYTES) {
    return sendJson(res, 413, { error: `Max upload size is ${formatSize(MAX_UPLOAD_BYTES)}` });
  }

  streamToFile(req, target, MAX_UPLOAD_BYTES)
    .then((size) => sendJson(res, 200, { ok: true, name: finalName, size }))
    .catch((err) => {
      if (err.message.includes('limit')) {
        return sendJson(res, 413, { error: err.message });
      }
      sendJson(res, 500, { error: err.message || 'Upload failed' });
    });
}

async function handleUploadInit(req, res) {
  let body;
  try {
    body = await readJsonBody(req);
  } catch {
    return sendJson(res, 400, { error: 'Invalid JSON' });
  }

  const dirPath = body.dir || '/';
  const absDir = safePath(dirPath.endsWith('/') ? dirPath : `${dirPath}/`);
  if (!absDir) return sendJson(res, 403, { error: 'Invalid folder' });

  let st;
  try {
    st = fs.statSync(absDir);
  } catch {
    return sendJson(res, 404, { error: 'Folder not found' });
  }
  if (!st.isDirectory()) return sendJson(res, 400, { error: 'Not a folder' });

  const filename = sanitizeFilename(body.filename || '');
  if (!filename) return sendJson(res, 400, { error: 'Invalid filename' });

  const totalSize = parseInt(body.totalSize, 10) || 0;
  const totalChunks = parseInt(body.totalChunks, 10) || 0;
  if (totalSize <= 0 || totalSize > MAX_UPLOAD_BYTES) {
    return sendJson(res, 413, { error: `Max upload size is ${formatSize(MAX_UPLOAD_BYTES)}` });
  }
  if (totalChunks <= 0 || totalChunks > 10000) {
    return sendJson(res, 400, { error: 'Invalid chunk count' });
  }

  const uploadId = crypto.randomBytes(12).toString('hex');
  const dir = uploadChunkDir(uploadId);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(uploadManifestPath(uploadId), JSON.stringify({
    dir: dirPath,
    filename,
    totalSize,
    totalChunks,
    received: {},
    created: Date.now(),
  }));

  return sendJson(res, 200, { ok: true, uploadId, chunkSize: CHUNK_SIZE });
}

async function handleUploadChunk(req, res, uploadId, chunkIndex) {
  const dir = uploadChunkDir(uploadId);
  const manifestFile = uploadManifestPath(uploadId);
  if (!fs.existsSync(manifestFile)) {
    return sendJson(res, 404, { error: 'Upload session not found' });
  }

  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  const idx = parseInt(chunkIndex, 10);
  if (Number.isNaN(idx) || idx < 0 || idx >= manifest.totalChunks) {
    return sendJson(res, 400, { error: 'Invalid chunk index' });
  }

  const chunkPath = path.join(dir, String(idx));
  try {
    const size = await streamToFile(req, chunkPath, CHUNK_SIZE + 1024 * 1024);
    // Re-read manifest before writing to avoid clobbering concurrent chunk writes
    const fresh = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
    fresh.received[String(idx)] = size;
    fs.writeFileSync(manifestFile, JSON.stringify(fresh));
    return sendJson(res, 200, { ok: true, chunk: idx, size });
  } catch (err) {
    fs.unlink(chunkPath, () => {});
    return sendJson(res, 500, { error: err.message || 'Chunk upload failed' });
  }
}

async function mergeUploadChunks(uploadId) {
  const manifestFile = uploadManifestPath(uploadId);
  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  const dir = uploadChunkDir(uploadId);

  for (let i = 0; i < manifest.totalChunks; i += 1) {
    const cp = path.join(dir, String(i));
    if (!fs.existsSync(cp)) {
      throw new Error(`Missing chunk ${i}`);
    }
  }

  const absDir = safePath(manifest.dir.endsWith('/') ? manifest.dir : `${manifest.dir}/`);
  if (!absDir) throw new Error('Invalid folder');

  const finalName = uniqueName(absDir, manifest.filename);
  const target = path.join(absDir, finalName);
  if (!target.startsWith(ROOT)) throw new Error('Forbidden path');

  const ws = fs.createWriteStream(target);
  for (let i = 0; i < manifest.totalChunks; i += 1) {
    await pipeline(fs.createReadStream(path.join(dir, String(i))), ws, { end: false });
  }
  await new Promise((resolve, reject) => {
    ws.end((err) => (err ? reject(err) : resolve()));
  });

  const st = fs.statSync(target);
  fs.rm(dir, { recursive: true, force: true }, () => {});
  return { name: finalName, size: st.size, path: `${manifest.dir}${encodeURIComponent(finalName)}` };
}

async function handleUploadComplete(req, res) {
  let body;
  try {
    body = await readJsonBody(req);
  } catch {
    return sendJson(res, 400, { error: 'Invalid JSON' });
  }

  const uploadId = body.uploadId;
  if (!uploadId || !/^[a-f0-9]+$/.test(uploadId)) {
    return sendJson(res, 400, { error: 'Invalid upload id' });
  }

  try {
    const result = await mergeUploadChunks(uploadId);
    return sendJson(res, 200, { ok: true, ...result });
  } catch (err) {
    return sendJson(res, 400, { error: err.message || 'Could not finalize upload' });
  }
}

async function handleUpload(req, res, absDir, webPath) {
  const ct = req.headers['content-type'] || '';
  const m = /boundary=(.+)/i.exec(ct);
  if (!m) {
    return sendJson(res, 400, { error: 'Expected multipart/form-data' });
  }

  const cl = parseInt(req.headers['content-length'] || '0', 10);
  if (cl > 100 * 1024 * 1024) {
    return sendJson(res, 413, { error: 'Use single-file upload for files over 100MB' });
  }

  let buffer;
  try {
    buffer = await readBody(req, 100 * 1024 * 1024);
  } catch (err) {
    return sendJson(res, 413, { error: err.message || 'Upload too large' });
  }

  const parts = parseMultipart(buffer, m[1].trim());
  const saved = [];

  for (const part of parts) {
    if (!part.filename || !part.data.length) continue;
    const safeName = sanitizeFilename(part.filename);
    if (!safeName) continue;
    const finalName = uniqueName(absDir, safeName);
    const target = path.join(absDir, finalName);
    if (!target.startsWith(ROOT)) continue;
    fs.writeFileSync(target, part.data);
    saved.push({ name: finalName, path: `${webPath}${encodeURIComponent(finalName)}`, size: part.data.length });
  }

  if (!saved.length) {
    return sendJson(res, 400, { error: 'No files received' });
  }

  return sendJson(res, 200, { ok: true, files: saved, count: saved.length });
}

module.exports = {
  handleStreamUpload,
  handleUploadInit,
  handleUploadChunk,
  handleUploadComplete,
  handleUpload,
};
