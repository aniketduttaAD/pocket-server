const fs = require('fs');
const path = require('path');
const { esc, formatSize, formatDate } = require('../lib/util');
const { isEditable, mimeType } = require('../lib/paths');
const { icon } = require('./icons');
const { pageShell, breadcrumbs } = require('./layout');

function viewerPage(abs, webPath, kind, siblings) {
  const name = path.basename(abs);
  const rawUrl = `${webPath}?raw=1`;
  const dlUrl = `${webPath}?download=1`;
  const parent = webPath.replace(/\/[^/]+$/, '') || '/';
  const ext = path.extname(name).toLowerCase();
  const mime = mimeType(abs);
  let fileSize = 0;
  let mtime = 0;
  try {
    const st = fs.statSync(abs);
    fileSize = st.size;
    mtime = Math.floor(st.mtimeMs);
  } catch { /* ignore */ }

  const editable = isEditable(name);
  const nav = siblings || { prev: null, next: null };
  const browserLimitedAudio = ['.mkv', '.avi', '.wmv', '.flv', '.ts', '.m2ts'].includes(ext);

  let viewerContent = '';
  let cdnStyles = [];
  let cdnScripts = [];
  let moduleScripts = [];
  const scripts = ['/__assets/js/core.js', '/__assets/js/transfer.js'];

  if (kind === 'image') {
    viewerContent = `<div class="viewer-stage viewer-image"><img id="viewer-img" src="${rawUrl}" alt="${esc(name)}"></div>`;
    cdnStyles.push('https://cdn.jsdelivr.net/npm/photoswipe@5.4.4/dist/photoswipe.min.css');
    cdnScripts.push(
      'https://cdn.jsdelivr.net/npm/photoswipe@5.4.4/dist/photoswipe-lightbox.umd.min.js',
      '/__assets/js/viewers/image-viewer.js',
    );
  } else if (kind === 'video') {
    viewerContent = `<div class="viewer-stage viewer-media">
      <div id="media-audio-hint" class="media-hint"${browserLimitedAudio ? '' : ' hidden'}>
        <p>No sound in browser? This format often uses audio codecs (AC3/DTS) that browsers cannot play. <a href="${dlUrl}" data-action="download" data-dl="${dlUrl}" data-name="${esc(name)}" data-size="${fileSize}">Download</a> to play in VLC or your video app.</p>
      </div>
      <video id="viewer-video" playsinline controls preload="metadata" src="${rawUrl}"></video>
    </div>`;
    cdnScripts.push('/__assets/js/viewers/media.js');
  } else if (kind === 'audio') {
    viewerContent = `<div class="viewer-stage viewer-audio"><audio id="viewer-audio" controls preload="metadata" src="${rawUrl}"></audio></div>`;
    cdnStyles.push('https://cdn.jsdelivr.net/npm/plyr@3.7.8/dist/plyr.css');
    cdnScripts.push(
      'https://cdn.jsdelivr.net/npm/plyr@3.7.8/dist/plyr.polyfilled.min.js',
      '/__assets/js/viewers/media.js',
    );
  } else if (kind === 'pdf') {
    viewerContent = `<div class="viewer-stage viewer-pdf">
      <div class="pdf-toolbar" id="pdf-toolbar">
        <button type="button" class="btn sm icon-only" id="pdf-prev" aria-label="Previous page">${icon('chevronLeft')}</button>
        <span id="pdf-page-info" class="pdf-page-info">Page 1</span>
        <button type="button" class="btn sm icon-only" id="pdf-next" aria-label="Next page">${icon('chevronRight')}</button>
        <button type="button" class="btn sm" id="pdf-zoom-out" aria-label="Zoom out">−</button>
        <button type="button" class="btn sm" id="pdf-zoom-in" aria-label="Zoom in">+</button>
        <button type="button" class="btn sm" id="pdf-fit" aria-label="Fit width">Fit</button>
      </div>
      <div class="pdf-canvas-wrap" id="pdf-canvas-wrap"><canvas id="pdf-canvas"></canvas></div>
    </div>`;
    moduleScripts.push('/__assets/js/viewers/pdf.js');
  } else if (kind === 'text') {
    let textContent = '';
    try {
      textContent = fs.readFileSync(abs, 'utf8').slice(0, 500000);
    } catch {
      textContent = '';
    }
    viewerContent = `<div class="viewer-stage viewer-editor">
      <div id="editor-container" class="editor-container"></div>
      <textarea id="editor-fallback" class="editor-fallback" hidden>${esc(textContent)}</textarea>
    </div>`;
    moduleScripts.push('/__assets/js/viewers/editor.js');
  }

  const navBtns = `${nav.prev ? `<a class="btn sm icon-only nav-btn" href="${nav.prev}" aria-label="Previous file">${icon('chevronLeft')}</a>` : '<span class="btn sm icon-only nav-btn disabled" aria-hidden="true">' + icon('chevronLeft') + '</span>'}
        ${nav.next ? `<a class="btn sm icon-only nav-btn" href="${nav.next}" aria-label="Next file">${icon('chevronRight')}</a>` : '<span class="btn sm icon-only nav-btn disabled" aria-hidden="true">' + icon('chevronRight') + '</span>'}`;

  const moreMenu = `<details class="action-menu">
      <summary class="btn sm icon-only nav-btn" aria-label="More actions">⋯</summary>
      <div class="action-menu-panel">
        <button type="button" class="action-menu-item" id="info-toggle">${icon('info')} File info</button>
        ${editable ? `<button type="button" class="action-menu-item" id="mode-view">${icon('eye')} View mode</button>
        <button type="button" class="action-menu-item" id="mode-edit">${icon('edit')} Edit mode</button>
        <button type="button" class="action-menu-item" id="save-btn">${icon('save')} Save</button>` : ''}
      </div>
    </details>`;

  const body = `<div id="viewer-data"
  data-path="${esc(webPath)}"
  data-raw="${esc(rawUrl)}"
  data-kind="${kind}"
  data-mime="${esc(mime)}"
  data-ext="${esc(ext)}"
  data-editable="${editable ? '1' : '0'}"
  data-name="${esc(name)}"
  hidden></div>
<main class="viewer-shell">
  ${breadcrumbs(parent === '/' ? '' : parent)}
  <div class="viewer-card card">
    <div class="viewer-toolbar">
      <h1 class="viewer-title" title="${esc(name)}">${esc(name)}</h1>
      <div class="viewer-nav">${navBtns}</div>
      <div class="viewer-toolbar-actions">
        <button type="button" class="btn primary sm" data-action="download" data-dl="${dlUrl}" data-name="${esc(name)}" data-size="${fileSize}" aria-label="Download">${icon('download')}</button>
        ${moreMenu}
      </div>
    </div>
    <div class="viewer-body">${viewerContent}</div>
    <aside class="viewer-info" id="viewer-info" hidden>
      <dl>
        <dt>Size</dt><dd>${formatSize(fileSize)}</dd>
        <dt>Type</dt><dd>${kind}</dd>
        <dt>Format</dt><dd>${esc(ext || 'unknown')}</dd>
        <dt>Modified</dt><dd>${formatDate(mtime)}</dd>
      </dl>
    </aside>
  </div>
</main>`;

  return pageShell(name, body, {
    navTitle: name,
    showBack: true,
    backHref: parent,
    page: 'viewer',
    scripts,
    cdnStyles,
    cdnScripts,
    moduleScripts,
  });
}

module.exports = { viewerPage };
