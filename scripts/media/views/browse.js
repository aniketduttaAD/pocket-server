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
          <div class="tile-skeleton" aria-hidden="true"></div>
          <img class="tile-thumb" data-src="${item.nextPath}?thumb=1" alt="${esc(item.name)}" decoding="async" width="200" height="200">
        </div>
        <div class="tile-info">
          <span class="tile-name">${esc(item.name)}</span>
          <span class="tile-meta">${item.size}</span>
        </div>
      </a>
      <div class="tile-actions">${viewBtn}${dlBtn}</div>
    </article>`;
  }

  if (item.kind === 'video') {
    return `<article class="media-item tile" data-name="${esc(item.name)}" data-kind="video" data-path="${esc(item.nextPath)}" data-size="${item.sizeBytes}" data-mtime="${item.mtime}">
      ${pick}
      <a class="tile-link" href="${item.nextPath}">
        <div class="tile-media tile-thumb-video">
          <div class="tile-skeleton" aria-hidden="true"></div>
          <img class="tile-thumb" data-src="${item.nextPath}?thumb=1" alt="" decoding="async" width="200" height="112">
          <div class="tile-play-badge" aria-hidden="true">${icon('play', 'play-icon')}</div>
        </div>
        <div class="tile-info">
          <span class="tile-name">${esc(item.name)}</span>
          <span class="tile-meta"><span class="type-badge type-video">video</span>${item.size}</span>
        </div>
      </a>
      <div class="tile-actions">${viewBtn}${dlBtn}</div>
    </article>`;
  }

  return `<article class="media-item tile" data-name="${esc(item.name)}" data-kind="${item.kind}" data-path="${esc(item.nextPath)}" data-size="${item.sizeBytes}" data-mtime="${item.mtime}">
    ${pick}
    <a class="tile-link" href="${item.nextPath}">
      <div class="tile-media tile-thumb-icon"><div class="tile-icon-bg">${kindIcon(item.kind)}</div></div>
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

  let body = `<div id="page-data" data-web-path="${esc(webPath)}" data-file-count="${mediaItems.length}" hidden></div>
<main class="shell">
<section class="page-header card">
  ${breadcrumbs(webPath.endsWith('/') ? webPath.slice(0, -1) || '/' : webPath)}
  <div class="page-header-row">
    <div class="page-header-text">
      <h1>${esc(folderName)}</h1>
      <p class="page-stats"><span id="visible-count">${mediaItems.length}</span> of ${mediaItems.length} files${folders.length ? ` · ${folders.length} folders` : ''}</p>
    </div>
    <button type="button" class="btn sm filter-open-btn desktop-only" id="filter-open-inline" aria-label="Filters">
      ${icon('filter')} <span>Filter</span>
    </button>
  </div>
  <div class="toolbar">
    <div class="search-wrap">
      ${icon('search')}
      <input type="search" class="search" id="filter-search" placeholder="Search files…" autocomplete="off" spellcheck="false">
      <button type="button" class="search-clear" id="search-clear" aria-label="Clear search" hidden>${icon('x')}</button>
    </div>
  </div>
  <div class="active-filters" id="active-filters" hidden></div>
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
    const large = mediaItems.length > 60 ? ' gallery-dense' : '';
    body += `<section class="section" id="files-section">
      <h2 class="section-label">Files</h2>
      <div class="gallery${large}" id="media-gallery">
        ${mediaItems.map((item) => mediaTile(item, galleryData)).join('')}
      </div>
      <div class="filter-empty" id="filter-empty" hidden>
        <p>No files match your filters</p>
        <button type="button" class="btn sm" id="filter-empty-reset">Clear filters</button>
      </div>
    </section>`;
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
<div id="filter-sheet" class="filter-sheet sheet" role="dialog" aria-modal="true" aria-labelledby="filter-sheet-title">
  <div class="sheet-drag-bar" aria-hidden="true"><span></span></div>

  <div class="filter-sheet-head">
    <div class="filter-sheet-titles">
      <h3 id="filter-sheet-title">Filters</h3>
      <p class="filter-sheet-sub" id="filter-result-label">Showing all files</p>
    </div>
    <div class="filter-sheet-head-actions">
      <button type="button" class="btn ghost sm" id="filter-reset" hidden>Reset</button>
      <button type="button" class="btn ghost sm icon-only" id="filter-close" aria-label="Close">${icon('x')}</button>
    </div>
  </div>

  <div class="filter-body">
    <section class="filter-block">
      <h4 class="filter-block-label">Type</h4>
      <div class="filter-type-grid" role="group" aria-label="Filter by file type">
        <button type="button" class="type-tile active" data-kind="all">
          <span class="type-tile-icon type-all">${icon('grid')}</span>
          <span class="type-tile-label">All</span>
        </button>
        <button type="button" class="type-tile" data-kind="image">
          <span class="type-tile-icon type-image">${icon('image')}</span>
          <span class="type-tile-label">Photos</span>
        </button>
        <button type="button" class="type-tile" data-kind="video">
          <span class="type-tile-icon type-video">${icon('video')}</span>
          <span class="type-tile-label">Videos</span>
        </button>
        <button type="button" class="type-tile" data-kind="audio">
          <span class="type-tile-icon type-audio">${icon('audio')}</span>
          <span class="type-tile-label">Audio</span>
        </button>
        <button type="button" class="type-tile" data-kind="pdf">
          <span class="type-tile-icon type-pdf">${icon('fileText')}</span>
          <span class="type-tile-label">PDF</span>
        </button>
        <button type="button" class="type-tile" data-kind="text">
          <span class="type-tile-icon type-text">${icon('fileText')}</span>
          <span class="type-tile-label">Docs</span>
        </button>
      </div>
    </section>

    <section class="filter-block">
      <h4 class="filter-block-label">Sort</h4>
      <div class="sort-list" role="radiogroup" aria-label="Sort order">
        <button type="button" class="sort-btn active" data-sort="date-desc" role="radio" aria-checked="true">
          <span class="sort-btn-text">Newest first</span>
          <span class="sort-check" aria-hidden="true">${icon('check')}</span>
        </button>
        <button type="button" class="sort-btn" data-sort="date-asc" role="radio" aria-checked="false">
          <span class="sort-btn-text">Oldest first</span>
          <span class="sort-check" aria-hidden="true">${icon('check')}</span>
        </button>
        <button type="button" class="sort-btn" data-sort="name-asc" role="radio" aria-checked="false">
          <span class="sort-btn-text">Name A–Z</span>
          <span class="sort-check" aria-hidden="true">${icon('check')}</span>
        </button>
        <button type="button" class="sort-btn" data-sort="name-desc" role="radio" aria-checked="false">
          <span class="sort-btn-text">Name Z–A</span>
          <span class="sort-check" aria-hidden="true">${icon('check')}</span>
        </button>
        <button type="button" class="sort-btn" data-sort="size-desc" role="radio" aria-checked="false">
          <span class="sort-btn-text">Largest first</span>
          <span class="sort-check" aria-hidden="true">${icon('check')}</span>
        </button>
      </div>
    </section>

    <section class="filter-block">
      <h4 class="filter-block-label">Layout</h4>
      <div class="layout-toggle" role="group" aria-label="View mode">
        <button type="button" class="layout-btn active" data-view="grid" aria-pressed="true">
          ${icon('grid')}
          <span>Grid</span>
        </button>
        <button type="button" class="layout-btn" data-view="list" aria-pressed="false">
          ${icon('list')}
          <span>List</span>
        </button>
      </div>
    </section>
  </div>

  <div class="filter-footer">
    <button type="button" class="btn sm" id="select-all">${icon('check')} Select visible</button>
    <button type="button" class="btn primary sm" id="options-upload">${icon('upload')} Upload</button>
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
