const fs = require('fs');
const path = require('path');
const { ROOT, MAX_SAVE_BYTES } = require('./config');
const { isEditable } = require('./paths');
const { sendJson, readBody, formatSize } = require('./util');

async function handleSave(req, res, abs) {
  const name = path.basename(abs);

  if (!isEditable(name)) {
    return sendJson(res, 400, { error: 'This file type cannot be edited' });
  }

  let st;
  try {
    st = fs.statSync(abs);
  } catch {
    return sendJson(res, 404, { error: 'File not found' });
  }
  if (!st.isFile()) {
    return sendJson(res, 400, { error: 'Not a file' });
  }
  if (!abs.startsWith(ROOT)) {
    return sendJson(res, 403, { error: 'Forbidden' });
  }

  const cl = parseInt(req.headers['content-length'] || '0', 10);
  if (cl > MAX_SAVE_BYTES) {
    return sendJson(res, 413, { error: `Max save size is ${formatSize(MAX_SAVE_BYTES)}` });
  }

  let content;
  try {
    content = await readBody(req, MAX_SAVE_BYTES);
  } catch (err) {
    return sendJson(res, 413, { error: err.message || 'Payload too large' });
  }

  try {
    fs.writeFileSync(abs, content);
    const newSt = fs.statSync(abs);
    return sendJson(res, 200, {
      ok: true,
      size: newSt.size,
      mtime: Math.floor(newSt.mtimeMs),
    });
  } catch (err) {
    return sendJson(res, 500, { error: err.message || 'Save failed' });
  }
}

module.exports = { handleSave };
