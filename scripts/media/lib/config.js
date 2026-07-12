const path = require('path');
const os = require('os');

const HOST = process.env.MEDIA_HOST || '127.0.0.1';
const PORT = parseInt(process.env.MEDIA_PORT || '8080', 10);
const ROOT = path.resolve(process.env.MEDIA_ROOT || path.join(process.env.HOME || '', 'storage/shared'));
const USER = process.env.MEDIA_USER || 'admin';
const PASS = process.env.MEDIA_PASS || '';
const MAX_UPLOAD_BYTES = parseInt(process.env.MEDIA_MAX_UPLOAD_MB || '10240', 10) * 1024 * 1024;
const MAX_SAVE_BYTES = 2 * 1024 * 1024;
const CHUNK_SIZE = 48 * 1024 * 1024;
const UPLOAD_TMP = path.join(os.tmpdir(), 'media-uploads');
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

module.exports = {
  HOST,
  PORT,
  ROOT,
  USER,
  PASS,
  MAX_UPLOAD_BYTES,
  MAX_SAVE_BYTES,
  CHUNK_SIZE,
  UPLOAD_TMP,
  PUBLIC_DIR,
};
