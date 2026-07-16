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
    galleryData.push({ name: item.name, raw: `${item.nextPath}?raw=1`, view: item.nextPath, w: 1200, h: 900 });
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
        <span class="tile-meta"><span class="type-badge type-${item.kind}">${item.kind}</span>${item.size}</span>
      </div>
    </a>
    <div class="tile-actions">${viewBtn}${dlBtn}</div>
  </article>`;
}

async function listDir(abs, webPath) {
  const entries = await fs.promises.readdir(abs, { withFileTypes: true });

  const dirNames = [];
  const fileNames = [];
  for (const e of entries) {
    if (e.name.startsWith('.')) continue;
    if (e.isDirectory()) dirNames.push(e.name);
    else fileNames.push(e.name);
  }

  dirNames.sort((a, b) => a.localeCompare(b));

  // Stat all files in parallel — much faster than sequential syncStat
  const fileStats = await Promise.all(
    fileNames.map(async (name) => {
      try {
        const st = await fs.promises.stat(path.join(abs, name));
        return { name, sizeBytes: st.size, mtime: Math.floor(st.mtimeMs) };
      } catch {
        return { name, sizeBytes: 0, mtime: 0 };
      }
    }),
  );

  // Default: newest first
  fileStats.sort((a, b) => b.mtime - a.mtime);

  const folders = dirNames.map((name) => ({
    name,
    href: `${webPath.replace(/\/$/, '')}/${encodeURIComponent(name)}/`,
  }));

  const galleryData = [];
  const mediaItems = fileStats.map((s) => {
    const nextPath = `${webPath.replace(/\/$/, '')}/${encodeURIComponent(s.name)}`;
    return {
      name: s.name,
      nextPath,
      size: formatSize(s.sizeBytes),
      sizeBytes: s.sizeBytes,
      kind: fileKind(s.name),
      mtime: s.mtime,
      date: formatDate(s.mtime),
    };
  });

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
    <div class="search-wrap">
      ${icon('search')}
      <input type="search" class="search" id="filter-search" placeholder="Search files…" autocomplete="off" spellcheck="false">
    </div>
  </div>
</section>`;

  if (!folders.length && !mediaItems.length) {
    body += `<div class="empty-state card"><div class="empty-icon">${icon('upload')}</div><p>This folder is empty</p><button type="button" class="btn primary" id="empty-upload-btn">Upload files</button></div></main>`;
    body += bulkBarHtml();
    body += uploadSheetHtml();
    body += optionsSheetHtml();
    body += dragOverlayHtml();
    return pageShell(folderName, body, pageOpts(folderName, parent, galleryData));
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

  return pageShell(folderName, body, pageOpts(folderName, parent, galleryData));
}

function pageOpts(folderName, parent, galleryData) {
  return {
    navTitle: folderName,
    showBack: !!parent,
    backHref: parent || '/',
    scripts: [
      '/__assets/js/core.js',
      '/__assets/js/transfer.js',
      '/__assets/js/upload.js',
      '/__assets/js/browse.js',
    ],
    cdnStyles: ['/__assets/vendor/photoswipe.min.css'],
    // Use local vendor instead of CDN — eliminates network round-trip
    cdnScripts: [
      '/__assets/vendor/photoswipe-lightbox.min.js',
      '/__assets/js/viewers/image.js',
    ],
    extra: `<script id="gallery-data" type="application/json">${JSON.stringify(galleryData)}</script>`,
  };
}

function uploadSheetHtml() {
  return `<div id="upload-backdrop" class="sheet-backdrop" aria-hidden="true"></div>
<div id="upload-sheet" class="upload-sheet sheet" role="dialog" aria-label="Upload files">
  <div class="sheet-drag-bar" aria-hidden="true"><span></span></div>
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
  <div class="sheet-drag-bar" aria-hidden="true"><span></span></div>
  <div class="sheet-head">
    <h3>${icon('filter')} Filters &amp; Sort</h3>
    <button type="button" class="btn ghost sm icon-only" id="filter-close" aria-label="Close">${icon('x')}</button>
  </div>
  <div class="filter-body">

    <p class="filter-section-label">File type</p>
    <div class="filter-chips" role="group" aria-label="Filter by file type">
      <button type="button" class="chip active" data-kind="all">All</button>
      <button type="button" class="chip" data-kind="image">${icon('image')} Photos</button>
      <button type="button" class="chip" data-kind="video">${icon('video')} Videos</button>
      <button type="button" class="chip" data-kind="audio">${icon('audio')} Audio</button>
      <button type="button" class="chip" data-kind="pdf">${icon('fileText')} PDF</button>
      <button type="button" class="chip" data-kind="text">${icon('fileText')} Docs</button>
    </div>

    <p class="filter-section-label">Sort by</p>
    <div class="sort-list" role="group" aria-label="Sort order">
      <button type="button" class="sort-btn active" data-sort="date-desc">Newest first</button>
      <button type="button" class="sort-btn" data-sort="date-asc">Oldest first</button>
      <button type="button" class="sort-btn" data-sort="name-asc">Name A–Z</button>
      <button type="button" class="sort-btn" data-sort="name-desc">Name Z–A</button>
      <button type="button" class="sort-btn" data-sort="size-desc">Largest first</button>
    </div>

    <p class="filter-section-label">Layout</p>
    <div class="seg-control full" role="group" aria-label="View mode">
      <button type="button" class="btn sm active" data-view="grid" aria-pressed="true">${icon('grid')} Grid</button>
      <button type="button" class="btn sm" data-view="list" aria-pressed="false">${icon('list')} List</button>
    </div>

    <div class="filter-divider"></div>
    <button type="button" class="btn primary full mt-xs" id="options-upload">${icon('upload')} Upload files</button>
    <button type="button" class="btn sm full mt-xs" id="select-all">${icon('check')} Select all visible</button>
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
