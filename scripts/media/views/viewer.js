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
      <div id="media-audio-hint" class="media-hint">
        <strong>No sound in browser?</strong>
        <span>Many videos (especially WEB-DL MP4s) use EAC3/AC3/DTS audio that browsers cannot decode. Video plays but audio needs an external app.</span>
        <div class="media-hint-actions">
          <a class="btn primary sm" href="${dlUrl}" data-action="download" data-dl="${dlUrl}" data-name="${esc(name)}" data-size="${fileSize}">${icon('download')} Download &amp; play in VLC</a>
        </div>
      </div>
      <video id="viewer-video" playsinline controls preload="auto" src="${rawUrl}"></video>
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

  const prevBtn = nav.prev
    ? `<a class="viewer-side-nav prev" href="${nav.prev}" aria-label="Previous">${icon('chevronLeft')}</a>`
    : '';
  const nextBtn = nav.next
    ? `<a class="viewer-side-nav next" href="${nav.next}" aria-label="Next">${icon('chevronRight')}</a>`
    : '';

  const body = `<div id="viewer-data"
  data-path="${esc(webPath)}"
  data-raw="${esc(rawUrl)}"
  data-dl="${esc(dlUrl)}"
  data-kind="${kind}"
  data-mime="${esc(mime)}"
  data-ext="${esc(ext)}"
  data-editable="${editable ? '1' : '0'}"
  data-name="${esc(name)}"
  data-size="${fileSize}"
  hidden></div>
<main class="viewer-page">
  <div class="viewer-filename" title="${esc(name)}">${esc(name)}</div>
  <div class="viewer-frame">
    ${prevBtn}
    <div class="viewer-content">${viewerContent}</div>
    ${nextBtn}
  </div>
  <div class="viewer-footer">
    <button type="button" class="btn sm" data-action="download" data-dl="${dlUrl}" data-name="${esc(name)}" data-size="${fileSize}">${icon('download')} Download</button>
    <button type="button" class="btn sm" id="info-toggle">${icon('info')} Info</button>
    ${editable ? `<button type="button" class="btn sm" id="mode-view">${icon('eye')} View</button><button type="button" class="btn sm" id="mode-edit">${icon('edit')} Edit</button><button type="button" class="btn sm primary" id="save-btn">${icon('save')} Save</button>` : ''}
  </div>
  <aside class="viewer-info card" id="viewer-info" hidden>
    <dl>
      <dt>Size</dt><dd>${formatSize(fileSize)}</dd>
      <dt>Type</dt><dd>${kind}</dd>
      <dt>Format</dt><dd>${esc(ext || 'unknown')}</dd>
      <dt>Modified</dt><dd>${formatDate(mtime)}</dd>
    </dl>
  </aside>
</main>`;

  return pageShell(name, body, {
    navTitle: 'Media',
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
