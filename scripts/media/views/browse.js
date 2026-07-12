const fs = require('fs');
const path = require('path');
const { esc, formatSize, formatDate } = require('../lib/util');
const { fileKind } = require('../lib/paths');
const { icon, kindIcon } = require('./icons');
const { pageShell, breadcrumbs, bulkBarHtml } = require('./layout');

function mediaTile(item, galleryData) {
  const pick = `<label class="pick" onclick="event.stopPropagation()"><input type="checkbox" aria-label="Select ${esc(item.name)}"></label>`;
  const dlBtn = `<button type="button" class="icon-btn" data-action="download" data-dl="${item.nextPath}?download=1" data-name="${esc(item.name)}" data-size="${item.sizeBytes}" title="Download" aria-label="Download">${icon('download')}</button>`;
  const viewBtn = `<a class="icon-btn" href="${item.nextPath}" title="Open" aria-label="Open">${icon('eye')}</a>`;

  if (item.kind === 'image') {
    const imgIdx = galleryData.length;
    galleryData.push({
      name: item.name,
      raw: `${item.nextPath}?raw=1`,
      view: item.nextPath,
      w: 1200,
      h: 900,
    });
    return `<article class="media-item tile" data-name="${esc(item.name)}" data-kind="image" data-path="${esc(item.nextPath)}" data-size="${item.sizeBytes}" data-mtime="${item.mtime}">
      ${pick}
      <a class="tile-link" href="${item.nextPath}" data-lightbox data-index="${imgIdx}">
        <div class="tile-media">
          <img class="tile-thumb" src="${item.nextPath}?raw=1" alt="${esc(item.name)}" loading="lazy" decoding="async" width="200" height="200">
        </div>
        <div class="tile-info">
          <span class="tile-name">${esc(item.name)}</span>
          <span class="tile-meta">${item.size}</span>
        </div>
      </a>
      <div class="tile-actions">${viewBtn}${dlBtn}</div>
    </article>`;
  }

  const thumbClass = item.kind === 'video' ? 'tile-thumb-video' : 'tile-thumb-icon';
  const thumbInner = item.kind === 'video'
    ? `<div class="tile-video-bg">${icon('play', 'play-icon')}</div>`
    : `<div class="tile-icon-bg">${kindIcon(item.kind)}</div>`;

  return `<article class="media-item tile" data-name="${esc(item.name)}" data-kind="${item.kind}" data-path="${esc(item.nextPath)}" data-size="${item.sizeBytes}" data-mtime="${item.mtime}">
    ${pick}
    <a class="tile-link" href="${item.nextPath}">
      <div class="tile-media ${thumbClass}">${thumbInner}</div>
      <div class="tile-info">
        <span class="tile-name">${esc(item.name)}</span>
        <span class="tile-meta"><span class="type-badge">${item.kind}</span> · ${item.size}</span>
      </div>
    </a>
    <div class="tile-actions">${viewBtn}${dlBtn}</div>
  </article>`;
}

function listDir(abs, webPath) {
  const entries = fs.readdirSync(abs, { withFileTypes: true });
  entries.sort((a, b) => {
    if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  const folders = [];
  const mediaItems = [];
  const galleryData = [];

  for (const e of entries) {
    const name = e.name;
    const nextPath = `${webPath.replace(/\/$/, '')}/${encodeURIComponent(name)}`;
    if (e.isDirectory()) {
      folders.push({ name, href: `${nextPath}/` });
      continue;
    }

    let sizeBytes = 0;
    let mtime = 0;
    try {
      const st = fs.statSync(path.join(abs, name));
      sizeBytes = st.size;
      mtime = Math.floor(st.mtimeMs);
    } catch (_) { /* ignore */ }

    mediaItems.push({
      name,
      nextPath,
      size: formatSize(sizeBytes),
      sizeBytes,
      kind: fileKind(name),
      mtime,
      date: formatDate(mtime),
    });
  }

  const folderName = webPath === '/'
    ? 'Media Library'
    : decodeURIComponent(webPath.split('/').filter(Boolean).pop() || 'Media');
  const parent = webPath !== '/'
    ? webPath.replace(/\/[^/]+\/?$/, '') || '/'
    : null;

  let body = `<div id="page-data" data-web-path="${esc(webPath)}" hidden></div>
<main class="shell">
<section class="page-header card">
  ${breadcrumbs(webPath.endsWith('/') ? webPath.slice(0, -1) || '/' : webPath)}
  <div class="page-header-row">
    <div class="page-header-text">
      <h1>${esc(folderName)}</h1>
      <p class="page-stats">${folders.length} folders · ${mediaItems.length} files</p>
    </div>
  </div>
  <div class="toolbar">
    <div class="search-wrap">${icon('search')}<input class="search" id="search" type="search" placeholder="Search…" autocomplete="off" aria-label="Search files"></div>
  </div>
</section>`;

  if (!folders.length && !mediaItems.length) {
    body += `<div class="empty-state card"><div class="empty-icon">${icon('upload')}</div><p>This folder is empty</p><button type="button" class="btn primary" id="empty-upload-btn">Upload files</button></div></main>`;
    body += bulkBarHtml();
    body += uploadSheetHtml();
    body += optionsSheetHtml();
    body += dragOverlayHtml();
    return pageShell(folderName, body, {
      navTitle: folderName,
      showBack: !!parent,
      backHref: parent || '/',
      scripts: [
        '/__assets/js/core.js',
        '/__assets/js/transfer.js',
        '/__assets/js/upload.js',
        '/__assets/js/browse.js',
      ],
      cdnStyles: [
        'https://cdn.jsdelivr.net/npm/photoswipe@5.4.4/dist/photoswipe.min.css',
      ],
      cdnScripts: [
        'https://cdn.jsdelivr.net/npm/photoswipe@5.4.4/dist/photoswipe-lightbox.umd.min.js',
        '/__assets/js/viewers/image.js',
      ],
      extra: `<script id="gallery-data" type="application/json">${JSON.stringify(galleryData)}</script>`,
    });
  }

  if (folders.length) {
    body += `<section class="section"><h2 class="section-label">Folders</h2><div class="folder-grid" id="folder-grid">
      ${folders.map((f) => `
        <a class="folder-card" href="${f.href}" data-name="${esc(f.name)}">
          <span class="folder-icon">${icon('folder')}</span>
          <span class="folder-name">${esc(f.name)}</span>
        </a>`).join('')}
    </div></section>`;
  }

  if (mediaItems.length) {
    body += `<section class="section"><h2 class="section-label">Files</h2><div class="gallery" id="media-gallery">
      ${mediaItems.map((item) => mediaTile(item, galleryData)).join('')}
    </div></section>`;
  }

  body += '</main>';
  body += bulkBarHtml();
  body += uploadSheetHtml();
  body += optionsSheetHtml();
  body += dragOverlayHtml();

  return pageShell(folderName, body, {
    navTitle: folderName,
    showBack: !!parent,
    backHref: parent || '/',
    scripts: [
      '/__assets/js/core.js',
      '/__assets/js/transfer.js',
      '/__assets/js/upload.js',
      '/__assets/js/browse.js',
    ],
    cdnStyles: [
      'https://cdn.jsdelivr.net/npm/photoswipe@5.4.4/dist/photoswipe.min.css',
    ],
    cdnScripts: [
      'https://cdn.jsdelivr.net/npm/photoswipe@5.4.4/dist/photoswipe-lightbox.umd.min.js',
      '/__assets/js/viewers/image.js',
    ],
    extra: `<script id="gallery-data" type="application/json">${JSON.stringify(galleryData)}</script>`,
  });
}

function uploadSheetHtml() {
  return `<div id="upload-backdrop" class="sheet-backdrop" aria-hidden="true"></div>
<div id="upload-sheet" class="upload-sheet sheet" role="dialog" aria-label="Upload files">
  <div class="sheet-head">
    <h3>${icon('upload')} Upload</h3>
    <button type="button" class="btn ghost sm icon-only" id="upload-close" aria-label="Close">${icon('x')}</button>
  </div>
  <div class="upload-drop" id="upload-drop">
    <div class="upload-drop-inner">
      <div class="upload-drop-icon">${icon('upload')}</div>
      <p class="upload-drop-title">Drop files here</p>
      <p class="upload-drop-hint">or browse from your device · up to 10 GB per file</p>
      <div class="upload-actions">
        <label class="btn primary sm"><input type="file" id="file-input" multiple hidden>Choose files</label>
        <label class="btn sm"><input type="file" id="folder-input" webkitdirectory multiple hidden>Choose folder</label>
      </div>
    </div>
  </div>
  <div class="upload-queue" id="upload-queue"></div>
</div>`;
}

function optionsSheetHtml() {
  return `<div id="options-backdrop" class="sheet-backdrop" aria-hidden="true"></div>
<div id="filter-sheet" class="filter-sheet sheet" role="dialog" aria-label="View options">
  <div class="sheet-head">
    <h3>${icon('filter')} Options</h3>
    <button type="button" class="btn ghost sm icon-only" id="filter-close" aria-label="Close">${icon('x')}</button>
  </div>
  <div class="filter-body">
    <label class="field-label" for="filter-kind">Type</label>
    <select class="select full" id="filter-kind" aria-label="Filter by type">
      <option value="all">All types</option>
      <option value="image">Photos</option>
      <option value="video">Videos</option>
      <option value="audio">Audio</option>
      <option value="pdf">PDF</option>
      <option value="text">Documents</option>
      <option value="file">Other</option>
    </select>
    <label class="field-label" for="sort-by">Sort</label>
    <select class="select full" id="sort-by" aria-label="Sort">
      <option value="name-asc">Name A–Z</option>
      <option value="name-desc">Name Z–A</option>
      <option value="size-desc">Largest first</option>
      <option value="date-desc">Newest first</option>
    </select>
    <label class="field-label">Layout</label>
    <div class="seg-control full" role="group" aria-label="View mode">
      <button type="button" class="btn sm active" data-view="grid" aria-pressed="true">${icon('grid')} Grid</button>
      <button type="button" class="btn sm" data-view="list" aria-pressed="false">${icon('list')} List</button>
    </div>
    <button type="button" class="btn primary full" id="options-upload">${icon('upload')} Upload files</button>
    <button type="button" class="btn sm full" id="select-all">${icon('check')} Select all visible</button>
  </div>
</div>`;
}

function dragOverlayHtml() {
  return `<div id="drag-overlay" class="drag-overlay" aria-hidden="true">
  <div class="drag-overlay-inner">
    ${icon('upload')}
    <p>Drop to upload</p>
  </div>
</div>`;
}

module.exports = { listDir, mediaTile };
