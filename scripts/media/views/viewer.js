const fs = require('fs');
const path = require('path');
const { esc } = require('../lib/util');
const { isEditable, mimeType } = require('../lib/paths');
const { isFfmpegAvailable } = require('../lib/transcode');
const { icon } = require('./icons');
const { pageShell } = require('./layout');

function viewerPage(abs, webPath, kind, siblings) {
  const name = path.basename(abs);
  const rawUrl = `${webPath}?raw=1`;
  const dlUrl = `${webPath}?download=1`;
  const parent = webPath.replace(/\/[^/]+$/, '') || '/';
  const ext = path.extname(name).toLowerCase();
  const mime = mimeType(abs);
  let fileSize = 0;
  try {
    fileSize = fs.statSync(abs).size;
  } catch { /* ignore */ }

  const editable = isEditable(name);
  const nav = siblings || { prev: null, next: null };
  const transcodeUrl = `${webPath}?transcode=1`;
  const ffmpegOk = isFfmpegAvailable();

  let viewerContent = '';
  let cdnStyles = [];
  let cdnScripts = [];
  let moduleScripts = [];
  const scripts = ['/__assets/js/core.js', '/__assets/js/viewers/chrome.js'];

  if (kind === 'image') {
    viewerContent = `<div class="viewer-stage viewer-image"><img id="viewer-img" src="${rawUrl}" alt=""></div>`;
    cdnStyles.push('https://cdn.jsdelivr.net/npm/photoswipe@5.4.4/dist/photoswipe.min.css');
    cdnScripts.push(
      'https://cdn.jsdelivr.net/npm/photoswipe@5.4.4/dist/photoswipe-lightbox.umd.min.js',
      '/__assets/js/viewers/image-viewer.js',
    );
  } else if (kind === 'video') {
    viewerContent = `<div class="viewer-stage viewer-media"><video id="viewer-video" playsinline controls preload="auto" src="${rawUrl}"></video></div>`;
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
      <div class="pdf-canvas-wrap" id="pdf-canvas-wrap"><div class="pdf-page" id="pdf-page"><canvas id="pdf-canvas"></canvas></div></div>
      <div class="viewer-controls viewer-controls--pdf" id="pdf-controls">
        <button type="button" class="viewer-ctl icon-only" id="pdf-prev" aria-label="Previous page">${icon('chevronLeft')}</button>
        <span id="pdf-page-info" class="viewer-ctl-label">1 / 1</span>
        <button type="button" class="viewer-ctl icon-only" id="pdf-next" aria-label="Next page">${icon('chevronRight')}</button>
        <span class="viewer-ctl-sep"></span>
        <button type="button" class="viewer-ctl icon-only" id="pdf-zoom-out" aria-label="Zoom out">−</button>
        <span id="pdf-zoom-info" class="viewer-ctl-label">100%</span>
        <button type="button" class="viewer-ctl icon-only" id="pdf-zoom-in" aria-label="Zoom in">+</button>
        <button type="button" class="viewer-ctl" id="pdf-fit" aria-label="Fit width">Fit</button>
      </div>
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

  const prevEdge = nav.prev
    ? `<a class="viewer-edge viewer-edge--prev" href="${nav.prev}" aria-label="Previous">${icon('chevronLeft')}</a>`
    : '';
  const nextEdge = nav.next
    ? `<a class="viewer-edge viewer-edge--next" href="${nav.next}" aria-label="Next">${icon('chevronRight')}</a>`
    : '';

  const editControls = editable
    ? `<button type="button" class="viewer-chrome-btn" id="mode-view" hidden aria-label="View mode">${icon('eye')}</button>
       <button type="button" class="viewer-chrome-btn" id="mode-edit" aria-label="Edit">${icon('edit')}</button>
       <button type="button" class="viewer-chrome-btn primary" id="save-btn" hidden aria-label="Save">${icon('save')}</button>`
    : '';

  const body = `<div id="viewer-data"
  data-path="${esc(webPath)}"
  data-raw="${esc(rawUrl)}"
  data-dl="${esc(dlUrl)}"
  data-transcode="${esc(transcodeUrl)}"
  data-ffmpeg="${ffmpegOk ? '1' : '0'}"
  data-kind="${kind}"
  data-mime="${esc(mime)}"
  data-ext="${esc(ext)}"
  data-editable="${editable ? '1' : '0'}"
  data-name="${esc(name)}"
  data-size="${fileSize}"
  hidden></div>
<div class="viewer-immersive viewer-immersive--${kind}">
  <header class="viewer-chrome">
    <a class="viewer-chrome-btn" href="${esc(parent)}" aria-label="Back">${icon('arrowLeft')}</a>
    <span class="viewer-chrome-title" title="${esc(name)}">${esc(name)}</span>
    <div class="viewer-chrome-actions">
      ${editControls}
      <a class="viewer-chrome-btn" href="${dlUrl}" aria-label="Download">${icon('download')}</a>
    </div>
  </header>
  <div class="viewer-body">${viewerContent}</div>
  ${prevEdge}${nextEdge}
</div>`;

  return pageShell(name, body, {
    showBack: false,
    backHref: parent,
    page: 'viewer',
    scripts,
    cdnStyles,
    cdnScripts,
    moduleScripts,
  });
}

module.exports = { viewerPage };
