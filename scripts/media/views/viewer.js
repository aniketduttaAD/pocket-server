const fs = require('fs');
const path = require('path');
const { esc, formatSize, formatDate } = require('../lib/util');
const { isEditable } = require('../lib/paths');
const { icon } = require('./icons');
const { pageShell, breadcrumbs } = require('./layout');

function viewerPage(abs, webPath, kind, siblings) {
  const name = path.basename(abs);
  const rawUrl = `${webPath}?raw=1`;
  const dlUrl = `${webPath}?download=1`;
  const parent = webPath.replace(/\/[^/]+$/, '') || '/';
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
    viewerContent = `<div class="viewer-stage viewer-media"><video id="viewer-video" playsinline controls crossorigin="anonymous"><source src="${rawUrl}" type="video/mp4"></video></div>`;
    cdnStyles.push('https://cdn.jsdelivr.net/npm/plyr@3.7.8/dist/plyr.css');
    cdnScripts.push(
      'https://cdn.jsdelivr.net/npm/plyr@3.7.8/dist/plyr.polyfilled.min.js',
      '/__assets/js/viewers/media.js',
    );
  } else if (kind === 'audio') {
    viewerContent = `<div class="viewer-stage viewer-audio"><audio id="viewer-audio" controls crossorigin="anonymous"><source src="${rawUrl}"></audio></div>`;
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
        <button type="button" class="btn sm" id="pdf-zoom-out">−</button>
        <button type="button" class="btn sm" id="pdf-zoom-in">+</button>
        <button type="button" class="btn sm" id="pdf-fit">Fit</button>
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

  const editToggle = editable
    ? `<button type="button" class="btn sm active" id="mode-view" data-mode="view">${icon('eye')} View</button>
       <button type="button" class="btn sm" id="mode-edit" data-mode="edit">${icon('edit')} Edit</button>`
    : '';

  const body = `<div id="viewer-data"
  data-path="${esc(webPath)}"
  data-raw="${esc(rawUrl)}"
  data-kind="${kind}"
  data-editable="${editable ? '1' : '0'}"
  data-name="${esc(name)}"
  data-ext="${esc(path.extname(name).toLowerCase())}"
  hidden></div>
<main class="viewer-shell">
  ${breadcrumbs(parent === '/' ? '' : parent)}
  <div class="viewer-card card">
    <div class="viewer-toolbar">
      <div class="viewer-toolbar-start">
        <a class="btn sm icon-only mobile-only" href="${parent}" aria-label="Back">${icon('arrowLeft')}</a>
        <h1 class="viewer-title" title="${esc(name)}">${esc(name)}</h1>
      </div>
      <div class="viewer-toolbar-actions">
        ${nav.prev ? `<a class="btn sm icon-only" href="${nav.prev}" aria-label="Previous">${icon('chevronLeft')}</a>` : ''}
        ${nav.next ? `<a class="btn sm icon-only" href="${nav.next}" aria-label="Next">${icon('chevronRight')}</a>` : ''}
        <a class="btn sm desktop-only" href="${parent}">${icon('folder')} Folder</a>
        ${editToggle}
        <button type="button" class="btn sm icon-only" id="info-toggle" aria-label="File info">${icon('info')}</button>
        <button type="button" class="btn primary sm" data-action="download" data-dl="${dlUrl}" data-name="${esc(name)}" data-size="${fileSize}">${icon('download')}<span class="desktop-only"> Download</span></button>
        ${editable ? `<button type="button" class="btn sm primary" id="save-btn">${icon('save')} Save</button>` : ''}
      </div>
    </div>
    <div class="viewer-body">${viewerContent}</div>
    <aside class="viewer-info" id="viewer-info" hidden>
      <dl>
        <dt>Size</dt><dd>${formatSize(fileSize)}</dd>
        <dt>Type</dt><dd>${kind}</dd>
        <dt>Modified</dt><dd>${formatDate(mtime)}</dd>
      </dl>
    </aside>
  </div>
</main>`;

  return pageShell(name, body, {
    navTitle: name,
    showBack: true,
    backHref: parent,
    scripts,
    cdnStyles,
    cdnScripts,
    moduleScripts,
  });
}

module.exports = { viewerPage };
