const path = require('path');
const fs = require('fs');
const { ROOT } = require('./config');

const MIME = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
  '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml',
  '.bmp': 'image/bmp', '.ico': 'image/x-icon', '.avif': 'image/avif',
  '.heic': 'image/heic', '.heif': 'image/heif',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime',
  '.m4v': 'video/x-m4v', '.mkv': 'video/x-matroska', '.avi': 'video/x-msvideo',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg',
  '.flac': 'audio/flac', '.m4a': 'audio/mp4', '.aac': 'audio/aac',
  '.pdf': 'application/pdf', '.txt': 'text/plain', '.md': 'text/markdown',
  '.json': 'application/json', '.csv': 'text/csv', '.zip': 'application/zip',
  '.js': 'text/javascript', '.ts': 'text/typescript', '.jsx': 'text/javascript',
  '.tsx': 'text/typescript', '.py': 'text/x-python', '.html': 'text/html',
  '.css': 'text/css', '.xml': 'application/xml', '.yaml': 'text/yaml',
  '.yml': 'text/yaml', '.sh': 'text/x-shellscript', '.env': 'text/plain',
  '.log': 'text/plain', '.sql': 'text/plain', '.go': 'text/plain',
  '.rs': 'text/plain', '.java': 'text/plain', '.c': 'text/plain',
  '.cpp': 'text/plain', '.h': 'text/plain',
};

const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.bmp', '.ico', '.avif', '.heic', '.heif']);
const VIDEO_EXT = new Set(['.mp4', '.webm', '.mov', '.m4v', '.mkv', '.avi']);
const AUDIO_EXT = new Set(['.mp3', '.wav', '.ogg', '.flac', '.m4a', '.aac']);
const DOC_EXT = new Set(['.pdf', '.txt', '.md', '.json', '.csv']);
const EDITABLE_EXT = new Set([
  '.txt', '.md', '.json', '.csv', '.js', '.ts', '.jsx', '.tsx', '.py',
  '.html', '.css', '.xml', '.yaml', '.yml', '.sh', '.env', '.log', '.sql',
  '.go', '.rs', '.java', '.c', '.cpp', '.h',
]);
const CODE_EXT = new Set([
  '.js', '.ts', '.jsx', '.tsx', '.py', '.html', '.css', '.xml', '.yaml',
  '.yml', '.sh', '.sql', '.go', '.rs', '.java', '.c', '.cpp', '.h', '.json',
]);

function safePath(reqPath) {
  const decoded = decodeURIComponent(reqPath.split('?')[0]);
  const joined = path.normalize(path.join(ROOT, decoded.replace(/^\//, '')));
  if (!joined.startsWith(ROOT)) return null;
  return joined;
}

function mimeType(filePath) {
  return MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
}

function fileKind(name) {
  const ext = path.extname(name).toLowerCase();
  if (IMAGE_EXT.has(ext)) return 'image';
  if (VIDEO_EXT.has(ext)) return 'video';
  if (AUDIO_EXT.has(ext)) return 'audio';
  if (ext === '.pdf') return 'pdf';
  if (DOC_EXT.has(ext) || EDITABLE_EXT.has(ext)) return 'text';
  return 'file';
}

function isEditable(name) {
  return EDITABLE_EXT.has(path.extname(name).toLowerCase());
}

function isCodeFile(name) {
  return CODE_EXT.has(path.extname(name).toLowerCase());
}

function sanitizeFilename(name) {
  const base = path.basename(name).replace(/[^\w.\- ()[\]]+/g, '_');
  return base && !base.startsWith('.') ? base : null;
}

function uniqueName(dir, name) {
  const ext = path.extname(name);
  const base = path.basename(name, ext);
  let candidate = name;
  let n = 1;
  while (fs.existsSync(path.join(dir, candidate))) {
    candidate = `${base} (${n})${ext}`;
    n += 1;
  }
  return candidate;
}

function siblingNav(absDir, currentName, webDir) {
  try {
    const entries = fs.readdirSync(absDir, { withFileTypes: true })
      .filter((e) => e.isFile() && fileKind(e.name) !== 'file')
      .map((e) => e.name)
      .sort((a, b) => a.localeCompare(b));
    const idx = entries.indexOf(currentName);
    if (idx < 0) return { prev: null, next: null };
    const base = webDir.replace(/\/$/, '') || '';
    return {
      prev: idx > 0 ? `${base}/${encodeURIComponent(entries[idx - 1])}` : null,
      next: idx < entries.length - 1 ? `${base}/${encodeURIComponent(entries[idx + 1])}` : null,
    };
  } catch {
    return { prev: null, next: null };
  }
}

module.exports = {
  MIME,
  IMAGE_EXT,
  VIDEO_EXT,
  AUDIO_EXT,
  DOC_EXT,
  EDITABLE_EXT,
  CODE_EXT,
  safePath,
  mimeType,
  fileKind,
  isEditable,
  isCodeFile,
  sanitizeFilename,
  uniqueName,
  siblingNav,
};
