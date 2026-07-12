#!/usr/bin/env node
/**
 * Lightweight media file server for Termux (127.0.0.1 only).
 * Env: MEDIA_HOST, MEDIA_PORT, MEDIA_ROOT, MEDIA_USER, MEDIA_PASS
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const HOST = process.env.MEDIA_HOST || '127.0.0.1';
const PORT = parseInt(process.env.MEDIA_PORT || '8080', 10);
const ROOT = path.resolve(process.env.MEDIA_ROOT || path.join(process.env.HOME || '', 'storage/shared'));
const USER = process.env.MEDIA_USER || 'admin';
const PASS = process.env.MEDIA_PASS || '';

const MIME = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
  '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml',
  '.bmp': 'image/bmp', '.ico': 'image/x-icon', '.avif': 'image/avif',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime',
  '.m4v': 'video/x-m4v', '.mkv': 'video/x-matroska',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg',
  '.flac': 'audio/flac', '.m4a': 'audio/mp4', '.aac': 'audio/aac',
  '.pdf': 'application/pdf', '.txt': 'text/plain', '.md': 'text/markdown',
  '.json': 'application/json', '.csv': 'text/csv',
};

if (!PASS) {
  console.error('MEDIA_PASS is required');
  process.exit(1);
}

function authOk(req) {
  const h = req.headers.authorization || '';
  if (!h.startsWith('Basic ')) return false;
  const decoded = Buffer.from(h.slice(6), 'base64').toString();
  const i = decoded.indexOf(':');
  if (i < 0) return false;
  return decoded.slice(0, i) === USER && decoded.slice(i + 1) === PASS;
}

function send401(res) {
  res.writeHead(401, {
    'WWW-Authenticate': 'Basic realm="Media"',
    'Content-Type': 'text/plain; charset=utf-8',
  });
  res.end('Authentication required');
}

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
  if (['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.bmp', '.ico', '.avif'].includes(ext)) return 'image';
  if (['.mp4', '.webm', '.mov', '.m4v', '.mkv'].includes(ext)) return 'video';
  if (['.mp3', '.wav', '.ogg', '.flac', '.m4a', '.aac'].includes(ext)) return 'audio';
  if (ext === '.pdf') return 'pdf';
  if (['.txt', '.md', '.json', '.csv', '.log'].includes(ext)) return 'text';
  return 'file';
}

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}


const CSS = `
:root{--page:#f7f8fa;--surface:#fff;--border:#e5e7eb;--border-strong:#d1d5db;--text:#0f172a;--muted:#64748b;--primary:#2563eb;--primary-dark:#1d4ed8;--radius:14px;--font:Inter,system-ui,-apple-system,sans-serif}
@media(prefers-color-scheme:dark){:root{--page:#0d1117;--surface:#161b22;--border:#21262d;--border-strong:#30363d;--text:#e6edf3;--muted:#8b949e}}
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:var(--font);background:var(--page);color:var(--text);line-height:1.55;min-height:100vh;-webkit-font-smoothing:antialiased}
a{color:inherit;text-decoration:none}
/* Shell */
.shell{max-width:1280px;margin:0 auto;padding:.75rem 1.25rem 3rem}
/* Top bar */
.topnav{background:var(--surface);border-bottom:1px solid var(--border);padding:.75rem 1.25rem;position:sticky;top:0;z-index:20;display:flex;align-items:center;gap:.75rem}
.topnav-title{font-size:.9rem;font-weight:700;letter-spacing:-.02em;flex:1}
/* Header card */
.header{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:1.125rem 1.25rem;margin-bottom:1.25rem;box-shadow:0 1px 3px rgba(0,0,0,.04)}
.header-top{display:flex;align-items:center;gap:.75rem;flex-wrap:wrap;margin-bottom:.75rem}
.header-top h1{font-size:1.125rem;font-weight:700;flex:1;min-width:0;letter-spacing:-.025em}
.count{color:var(--muted);font-size:.8125rem;font-weight:500}
.breadcrumb{display:flex;flex-wrap:wrap;gap:.25rem;font-size:.8125rem;color:var(--muted);margin-bottom:.875rem;align-items:center}
.breadcrumb a{color:var(--muted);padding:.1rem .35rem;border-radius:5px;transition:background .1s}
.breadcrumb a:hover{background:rgba(100,116,139,.1);color:var(--text)}
.breadcrumb span{color:var(--border-strong)}
.toolbar{display:flex;gap:.625rem;flex-wrap:wrap;align-items:center}
.search{flex:1;min-width:180px;background:var(--page);border:1px solid var(--border-strong);border-radius:8px;padding:.5rem .75rem;font-size:.875rem;color:var(--text);font-family:var(--font)}
.search:focus{outline:2px solid rgba(37,99,235,.2);border-color:var(--primary)}
.search::placeholder{color:var(--muted)}
/* Buttons */
.btn{display:inline-flex;align-items:center;justify-content:center;padding:.4375rem .875rem;border-radius:8px;font-size:.8125rem;font-weight:600;border:1px solid var(--border-strong);background:var(--surface);color:var(--text);cursor:pointer;gap:.375rem;white-space:nowrap;transition:all .12s;font-family:var(--font)}
.btn:hover{background:var(--page)}
.btn.primary{background:var(--primary);border-color:var(--primary);color:#fff}
.btn.primary:hover{background:var(--primary-dark);box-shadow:0 2px 6px rgba(37,99,235,.35)}
.btn.ghost{background:transparent;border-color:transparent}
.btn.ghost:hover{background:rgba(100,116,139,.08)}
/* Sections */
.section{margin-bottom:1.5rem}
.section-label{font-size:.6875rem;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:var(--muted);margin-bottom:.75rem;display:flex;align-items:center;gap:.5rem}
.section-label::after{content:'';flex:1;height:1px;background:var(--border)}
/* Folder grid */
.folder-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:.625rem}
.folder-card{display:flex;align-items:center;gap:.75rem;padding:.8125rem 1rem;background:var(--surface);border:1px solid var(--border);border-radius:10px;min-width:0;transition:border-color .12s,box-shadow .12s}
.folder-card:hover{border-color:var(--border-strong);box-shadow:0 2px 8px rgba(0,0,0,.06)}
.folder-icon{width:38px;height:38px;border-radius:9px;background:#eff6ff;color:#2563eb;display:flex;align-items:center;justify-content:center;font-size:1.125rem;flex-shrink:0}
.folder-name{font-size:.875rem;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--text)}
.folder-count{font-size:.7rem;color:var(--muted);margin-top:.0625rem}
/* Photo gallery */
.gallery{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:.625rem}
.tile{position:relative;background:var(--surface);border:1px solid var(--border);border-radius:10px;overflow:hidden;aspect-ratio:1;transition:border-color .12s,box-shadow .12s}
.tile:hover{border-color:var(--border-strong);box-shadow:0 4px 14px rgba(0,0,0,.1)}
.tile-link{display:block;width:100%;height:100%;position:relative}
.tile img,.tile-thumb{width:100%;height:100%;object-fit:cover;display:block;background:var(--page)}
.tile-overlay{position:absolute;inset:auto 0 0 0;padding:.5rem .625rem;background:linear-gradient(transparent,rgba(0,0,0,.75));color:#fff;font-size:.6875rem;line-height:1.3}
.tile-name{display:block;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tile-meta{opacity:.8}
/* Video gallery - 16:9 */
.gallery-video{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:.75rem}
.tile-video-wrap{position:relative;background:var(--surface);border:1px solid var(--border);border-radius:10px;overflow:hidden;aspect-ratio:16/9;transition:border-color .12s,box-shadow .12s}
.tile-video-wrap:hover{border-color:var(--border-strong);box-shadow:0 4px 16px rgba(0,0,0,.12)}
.tile-video-wrap .tile-link{display:flex;align-items:center;justify-content:center;width:100%;height:100%;background:linear-gradient(160deg,#1e1b4b,#0f172a)}
.play-btn{width:52px;height:52px;border-radius:50%;background:rgba(255,255,255,.15);border:2px solid rgba(255,255,255,.35);display:flex;align-items:center;justify-content:center;color:#fff;font-size:1.25rem;backdrop-filter:blur(4px);transition:background .15s,transform .15s;padding-left:3px}
.tile-video-wrap:hover .play-btn{background:rgba(255,255,255,.25);transform:scale(1.06)}
/* Audio / file table */
.file-table{background:var(--surface);border:1px solid var(--border);border-radius:10px;overflow:hidden}
.file-row{display:flex;align-items:center;gap:.875rem;padding:.75rem 1rem;border-bottom:1px solid var(--border);transition:background .1s}
.file-row:last-child{border-bottom:none}
.file-row:hover{background:var(--page)}
.file-kind-icon{font-size:1.125rem;flex-shrink:0;width:28px;text-align:center;line-height:1}
.file-info{flex:1;min-width:0}
.file-name{font-size:.875rem;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--text)}
.file-meta{font-size:.75rem;color:var(--muted);margin-top:.125rem}
.file-actions{display:flex;gap:.375rem;flex-shrink:0}
/* Empty */
.empty{padding:3.5rem 1rem;text-align:center;color:var(--muted);background:var(--surface);border:1.5px dashed var(--border);border-radius:10px}
.empty p{font-size:.9rem}
/* Viewer */
.viewer-shell{max-width:1000px;margin:0 auto;padding:1rem 1.25rem 2.5rem}
.viewer-card{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,.07)}
.viewer-bar{display:flex;align-items:center;gap:.625rem;padding:.875rem 1.125rem;border-bottom:1px solid var(--border);flex-wrap:wrap}
.viewer-bar h2{font-size:.9rem;font-weight:700;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;letter-spacing:-.01em}
.viewer-body{background:#000;display:flex;align-items:center;justify-content:center;min-height:280px}
.viewer-body img{max-width:100%;max-height:82vh;display:block;background:var(--page)}
.viewer-body video{width:100%;max-height:82vh;display:block}
.viewer-body audio{width:100%;padding:1.5rem;background:var(--page)}
.viewer-body iframe{width:100%;min-height:72vh;border:none;background:#fff}
/* Lightbox */
.lightbox{position:fixed;inset:0;background:rgba(0,0,0,.92);z-index:100;display:none;align-items:center;justify-content:center;padding:1rem}
.lightbox.open{display:flex}
.lightbox img{max-width:min(96vw,1200px);max-height:88vh;border-radius:6px;box-shadow:0 20px 80px rgba(0,0,0,.5)}
.lightbox-ui{position:fixed;inset:0;pointer-events:none}
.lightbox-top{display:flex;justify-content:space-between;align-items:center;padding:.875rem 1.25rem;color:#fff;pointer-events:auto}
.lightbox-title{font-size:.875rem;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:60vw}
.lightbox-actions{display:flex;gap:.5rem}
.lightbox-nav{position:absolute;top:50%;transform:translateY(-50%);width:44px;height:44px;border-radius:50%;border:1px solid rgba(255,255,255,.2);background:rgba(255,255,255,.07);color:#fff;font-size:1.25rem;cursor:pointer;pointer-events:auto;display:flex;align-items:center;justify-content:center;transition:background .12s}
.lightbox-nav:hover{background:rgba(255,255,255,.15)}
.lightbox-nav.prev{left:1rem}
.lightbox-nav.next{right:1rem}
.lightbox-nav:disabled{opacity:.25;cursor:default}
@media(max-width:640px){.gallery{grid-template-columns:repeat(auto-fill,minmax(120px,1fr))}.gallery-video{grid-template-columns:1fr}.folder-grid{grid-template-columns:1fr 1fr}}
`;

const CLIENT_JS = `
(function(){
  const q=document.getElementById('search');
  if(q){q.addEventListener('input',function(){
    const term=this.value.trim().toLowerCase();
    document.querySelectorAll('[data-name]').forEach(function(el){
      el.style.display=!term||el.dataset.name.toLowerCase().includes(term)?'':'none';
    });
  });}
  const images=JSON.parse(document.getElementById('gallery-data')?.textContent||'[]');
  const box=document.getElementById('lightbox');
  if(!box||!images.length)return;
  let idx=0;
  const img=box.querySelector('img');
  const title=box.querySelector('.lightbox-title');
  const prev=box.querySelector('.lightbox-nav.prev');
  const next=box.querySelector('.lightbox-nav.next');
  function show(i){
    idx=(i+images.length)%images.length;
    const item=images[idx];
    img.src=item.raw; title.textContent=item.name;
    const dl=document.getElementById('lb-download');
    if(dl)dl.href=item.view+'?download=1';
    prev.disabled=images.length<2; next.disabled=images.length<2;
  }
  function openAt(i){show(i);box.classList.add('open');document.body.style.overflow='hidden';}
  function close(){box.classList.remove('open');document.body.style.overflow='';img.src='';}
  document.querySelectorAll('[data-lightbox]').forEach(function(el){
    el.addEventListener('click',function(e){
      e.preventDefault();
      openAt(parseInt(el.dataset.index,10)||0);
    });
  });
  box.querySelector('[data-close]')?.addEventListener('click',close);
  prev.addEventListener('click',function(){show(idx-1);});
  next.addEventListener('click',function(){show(idx+1);});
  box.addEventListener('click',function(e){if(e.target===box)close();});
  document.addEventListener('keydown',function(e){
    if(!box.classList.contains('open'))return;
    if(e.key==='Escape')close();
    if(e.key==='ArrowLeft')show(idx-1);
    if(e.key==='ArrowRight')show(idx+1);
  });
})();
`;

function pageShell(title, body, extra = '') {
  return `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<style>${CSS}</style>
</head><body>
${body}
${extra}
</body></html>`;
}

function breadcrumbs(webPath) {
  const parts = webPath.split('/').filter(Boolean);
  let html = '<nav class="breadcrumb"><a href="/">Home</a>';
  let acc = '';
  for (const p of parts) {
    acc += `/${encodeURIComponent(p)}`;
    html += `<span>/</span><a href="${acc}/">${esc(decodeURIComponent(p))}</a>`;
  }
  html += '</nav>';
  return html;
}

function listDir(abs, webPath) {
  const entries = fs.readdirSync(abs, { withFileTypes: true });
  entries.sort((a, b) => {
    if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  const folders = [];
  const images = [];
  const videos = [];
  const audios = [];
  const others = [];
  const galleryData = [];

  for (const e of entries) {
    const name = e.name;
    const nextPath = `${webPath.replace(/\/$/, '')}/${encodeURIComponent(name)}`;
    if (e.isDirectory()) {
      folders.push({ name, href: `${nextPath}/` });
      continue;
    }

    let size = 0;
    let mtime = 0;
    try {
      const st = fs.statSync(path.join(abs, name));
      size = st.size;
      mtime = st.mtimeMs;
    } catch (_) { /* ignore */ }

    const kind = fileKind(name);
    const item = { name, nextPath, size: formatSize(size), kind, mtime };

    if (kind === 'image') {
      images.push(item);
      galleryData.push({ name, raw: `${nextPath}?raw=1`, view: nextPath, index: galleryData.length });
    } else if (kind === 'video') videos.push(item);
    else if (kind === 'audio') audios.push(item);
    else others.push(item);
  }

  const folderName = webPath === '/'
    ? 'Media Library'
    : decodeURIComponent(webPath.split('/').filter(Boolean).pop() || 'Media');
  const parent = webPath !== '/'
    ? webPath.replace(/\/[^/]+\/?$/, '') || '/'
    : null;
  const totalFiles = images.length + videos.length + audios.length + others.length;

  let body = `<div class="topnav"><span class="topnav-title">📁 Media</span></div><div class="shell">
<div class="header">
  ${breadcrumbs(webPath.endsWith('/') ? webPath.slice(0, -1) || '/' : webPath)}
  <div class="header-top">
    <h1>${esc(folderName)}</h1>
    <span class="count">${folders.length > 0 ? `${folders.length} folders · ` : ''}${totalFiles} files</span>
    ${parent ? `<a class="btn ghost" href="${parent}">← Back</a>` : ''}
  </div>
  <div class="toolbar">
    <input class="search" id="search" type="search" placeholder="Search in this folder…" autocomplete="off">
  </div>
</div>`;

  if (!folders.length && !totalFiles) {
    body += '<div class="empty"><p>This folder is empty</p></div></div>';
    return pageShell(folderName, body);
  }

  if (folders.length) {
    body += `<div class="section"><div class="section-label">Folders</div><div class="folder-grid">
      ${folders.map((f) => `
        <a class="folder-card" href="${f.href}" data-name="${esc(f.name)}">
          <span class="folder-icon">📁</span>
          <span class="folder-name">${esc(f.name)}</span>
        </a>`).join('')}
    </div></div>`;
  }

  if (images.length) {
    body += `<div class="section"><div class="section-label">Photos &nbsp;${images.length}</div><div class="gallery">
      ${images.map((item, i) => `
        <article class="tile" data-name="${esc(item.name)}">
          <a class="tile-link" href="${item.nextPath}" data-lightbox data-index="${i}">
            <img class="tile-thumb" src="${item.nextPath}?raw=1" alt="${esc(item.name)}" loading="lazy" decoding="async">
            <div class="tile-overlay"><span class="tile-name">${esc(item.name)}</span><span class="tile-meta">${item.size}</span></div>
          </a>
        </article>`).join('')}
    </div></div>`;
  }

  if (videos.length) {
    body += `<div class="section"><div class="section-label">Videos &nbsp;${videos.length}</div><div class="gallery-video">
      ${videos.map((item) => `
        <article class="tile-video-wrap" data-name="${esc(item.name)}">
          <a class="tile-link" href="${item.nextPath}">
            <span class="play-btn">▶</span>
            <div class="tile-overlay"><span class="tile-name">${esc(item.name)}</span><span class="tile-meta">${item.size}</span></div>
          </a>
        </article>`).join('')}
    </div></div>`;
  }

  if (audios.length) {
    body += `<div class="section"><div class="section-label">Audio &nbsp;${audios.length}</div><div class="file-table">
      ${audios.map((item) => fileRow(item)).join('')}
    </div></div>`;
  }

  if (others.length) {
    body += `<div class="section"><div class="section-label">Files &nbsp;${others.length}</div><div class="file-table">
      ${others.map((item) => fileRow(item)).join('')}
    </div></div>`;
  }

  body += '</div>';

  const lightbox = images.length ? `
<div id="lightbox" class="lightbox" role="dialog" aria-modal="true">
  <div class="lightbox-ui">
    <div class="lightbox-top">
      <span class="lightbox-title"></span>
      <div class="lightbox-actions">
        <a class="btn primary" id="lb-download" href="#">Download</a>
        <button type="button" class="btn" data-close>Close</button>
      </div>
    </div>
    <button type="button" class="lightbox-nav prev" aria-label="Previous">‹</button>
    <button type="button" class="lightbox-nav next" aria-label="Next">›</button>
  </div>
  <img alt="">
</div>
<script id="gallery-data" type="application/json">${JSON.stringify(galleryData)}</script>
<script>${CLIENT_JS}</script>` : '';

  return pageShell(folderName, body, lightbox);
}

const KIND_ICON = { image: '🖼️', video: '🎬', audio: '🎵', pdf: '📄', text: '📝', file: '📦' };

function fileRow(item) {
  const canView = item.kind !== 'file';
  const icon = KIND_ICON[item.kind] || KIND_ICON.file;
  return `<div class="file-row" data-name="${esc(item.name)}">
    <span class="file-kind-icon" aria-hidden="true">${icon}</span>
    <div class="file-info">
      <div class="file-name">${esc(item.name)}</div>
      <div class="file-meta">${item.size}</div>
    </div>
    <div class="file-actions">
      ${canView ? `<a class="btn primary" href="${item.nextPath}">Open</a>` : ''}
      <a class="btn" href="${item.nextPath}?download=1">Download</a>
    </div>
  </div>`;
}

function viewerPage(abs, webPath, kind, siblings) {
  const name = path.basename(abs);
  const rawUrl = `${webPath}?raw=1`;
  const dlUrl = `${webPath}?download=1`;
  const parent = webPath.replace(/\/[^/]+$/, '') || '/';
  let media = '';

  if (kind === 'image') {
    media = `<img src="${rawUrl}" alt="${esc(name)}">`;
  } else if (kind === 'video') {
    media = `<video controls playsinline preload="metadata" src="${rawUrl}">Your browser does not support video.</video>`;
  } else if (kind === 'audio') {
    media = `<audio controls preload="metadata" src="${rawUrl}">Your browser does not support audio.</audio>`;
  } else if (kind === 'pdf' || kind === 'text') {
    media = `<iframe src="${rawUrl}" title="${esc(name)}"></iframe>`;
  }

  const nav = siblings || { prev: null, next: null };

  const body = `<div class="topnav"><span class="topnav-title">📁 Media</span></div><div class="viewer-shell">
  ${breadcrumbs(parent === '/' ? '' : parent)}
  <div class="viewer-card">
    <div class="viewer-bar">
      <h2>${esc(name)}</h2>
      ${nav.prev ? `<a class="btn" href="${nav.prev}">← Prev</a>` : ''}
      ${nav.next ? `<a class="btn" href="${nav.next}">Next →</a>` : ''}
      <a class="btn" href="${parent}">Folder</a>
      <a class="btn primary" href="${dlUrl}">Download</a>
    </div>
    <div class="viewer-body">${media}</div>
  </div>
</div>`;

  return pageShell(name, body);
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

function serveFile(req, res, abs, download) {
  fs.stat(abs, (err, st) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      return res.end('Not found');
    }

    const type = mimeType(abs);
    const filename = path.basename(abs);
    const headers = {
      'Content-Type': type,
      'Accept-Ranges': 'bytes',
    };

    if (download) {
      headers['Content-Disposition'] = `attachment; filename="${filename.replace(/"/g, '')}"`;
    } else {
      headers['Content-Disposition'] = `inline; filename="${filename.replace(/"/g, '')}"`;
    }

    const range = req.headers.range;
    if (range && (type.startsWith('video/') || type.startsWith('audio/'))) {
      const m = /^bytes=(\d*)-(\d*)$/.exec(range);
      if (m) {
        const start = m[1] ? parseInt(m[1], 10) : 0;
        const end = m[2] ? parseInt(m[2], 10) : st.size - 1;
        if (start >= st.size || end >= st.size) {
          res.writeHead(416, { 'Content-Range': `bytes */${st.size}` });
          return res.end();
        }
        headers['Content-Range'] = `bytes ${start}-${end}/${st.size}`;
        headers['Content-Length'] = end - start + 1;
        res.writeHead(206, headers);
        return fs.createReadStream(abs, { start, end }).pipe(res);
      }
    }

    headers['Content-Length'] = st.size;
    res.writeHead(200, headers);
    fs.createReadStream(abs).pipe(res);
  });
}

const server = http.createServer((req, res) => {
  const u = new URL(req.url, `http://${HOST}`);

  if (u.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end('{"ok":true}');
  }

  if (!authOk(req)) return send401(res);

  const abs = safePath(u.pathname);
  if (!abs) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    return res.end('Forbidden');
  }

  const raw = u.searchParams.has('raw');
  const download = u.searchParams.has('download');

  fs.stat(abs, (err, st) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      return res.end('Not found');
    }

    if (st.isDirectory()) {
      const webPath = u.pathname.endsWith('/') ? u.pathname : `${u.pathname}/`;
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(listDir(abs, webPath));
    }

    if (raw || download) {
      return serveFile(req, res, abs, download);
    }

    const kind = fileKind(path.basename(abs));
    if (kind === 'file') {
      return serveFile(req, res, abs, true);
    }

    const webDir = u.pathname.replace(/\/[^/]+$/, '') || '/';
    const siblings = siblingNav(path.dirname(abs), path.basename(abs), webDir);
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(viewerPage(abs, u.pathname, kind, siblings));
  });
});

server.listen(PORT, HOST, () => {
  console.log(`Media server http://${HOST}:${PORT} root=${ROOT}`);
});
