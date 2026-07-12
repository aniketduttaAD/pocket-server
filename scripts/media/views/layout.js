const { esc } = require('../lib/util');
const { icon } = require('./icons');

// Bust CSS/JS cache on every server restart so style/script changes take effect immediately.
const ASSET_VER = Date.now().toString(36);

const CSS_FILES = [
  '/__assets/css/tokens.css',
  '/__assets/css/layout.css',
  '/__assets/css/components.css',
  '/__assets/css/browse.css',
  '/__assets/css/upload.css',
  '/__assets/css/viewer.css',
];

const APP_ICON = '/__assets/icons/app.png';

function v(url) {
  // Skip CDN and already-versioned URLs; stamp local assets with restart version.
  if (url.startsWith('http') || url.includes('?')) return url;
  return `${url}?v=${ASSET_VER}`;
}

function cssLinks() {
  return CSS_FILES.map((href) => `<link rel="stylesheet" href="${v(href)}">`).join('\n');
}

function jsScripts(scripts) {
  return scripts.map((src) => `<script src="${v(src)}" defer></script>`).join('\n');
}

function transferPanelHtml() {
  return `<div id="transfer-backdrop" class="sheet-backdrop" aria-hidden="true"></div>
<aside id="transfer-panel" class="transfer-panel sheet" aria-label="Transfer queue">
  <div class="sheet-head">
    <h3>${icon('activity')} Transfers</h3>
    <div class="sheet-head-actions">
      <button type="button" class="btn ghost sm" id="transfer-clear">Clear</button>
      <button type="button" class="btn ghost sm icon-only" id="transfer-close" aria-label="Close">${icon('x')}</button>
    </div>
  </div>
  <div class="transfer-list" id="transfer-list"></div>
</aside>`;
}

function topnavHtml(options = {}) {
  const {
    title = 'Media',
    showBack = false,
    backHref = '/',
    mode = 'browse',
  } = options;

  const browseActions = mode === 'browse'
    ? `<button type="button" id="upload-btn-desktop" class="btn ghost icon-only nav-btn desktop-only" aria-label="Upload">${icon('upload')}</button>
    <button type="button" id="options-toggle" class="btn ghost icon-only nav-btn" aria-label="Options">${icon('filter')}</button>`
    : '';

  return `<header class="topnav">
  <div class="topnav-start">
    ${showBack ? `<a class="btn ghost icon-only nav-btn" href="${esc(backHref)}" aria-label="Go back">${icon('arrowLeft')}</a>` : ''}
    <a class="topnav-brand" href="/" aria-label="Home">
      <img class="app-icon" src="${APP_ICON}" width="28" height="28" alt="">
      <span class="topnav-title">${esc(title)}</span>
    </a>
  </div>
  <div class="topnav-actions">
    ${browseActions}
    <button type="button" id="transfer-toggle" class="btn ghost icon-only nav-btn transfer-btn" aria-label="Transfers">${icon('activity')}<span id="transfer-badge" class="badge"></span></button>
  </div>
</header>`;
}

function bottomNavHtml(options = {}) {
  const { showBack = false, backHref = '/' } = options;
  return `<nav class="bottom-nav mobile-only" aria-label="Main navigation">
  <a class="bottom-nav-item" href="/" aria-label="Home">${icon('home')}<span>Home</span></a>
  ${showBack ? `<a class="bottom-nav-item" href="${esc(backHref)}" aria-label="Back">${icon('arrowLeft')}<span>Back</span></a>` : '<span class="bottom-nav-item disabled" aria-hidden="true">' + icon('arrowLeft') + '<span>Back</span></span>'}
  <button type="button" class="bottom-nav-item" id="bottom-upload" aria-label="Upload">${icon('upload')}<span>Upload</span></button>
  <button type="button" class="bottom-nav-item" id="bottom-options" aria-label="Options">${icon('filter')}<span>Options</span></button>
</nav>`;
}

function breadcrumbs(webPath) {
  const parts = webPath.split('/').filter(Boolean);
  if (!parts.length) return '';
  let html = '<nav class="breadcrumb" aria-label="Breadcrumb">';
  let acc = '';
  for (const p of parts) {
    acc += `/${encodeURIComponent(p)}`;
    html += `<a href="${acc}/">${esc(decodeURIComponent(p))}</a>`;
    if (p !== parts[parts.length - 1]) html += '<span class="breadcrumb-sep">/</span>';
  }
  html += '</nav>';
  return html;
}

function bulkBarHtml() {
  return `<div class="bulk-bar" id="bulk-bar" role="toolbar" aria-label="Bulk actions">
  <span class="bulk-count" id="bulk-count">0 selected</span>
  <button type="button" class="btn primary sm" id="bulk-download">${icon('download')} Download</button>
  <button type="button" class="btn sm" id="clear-select">Clear</button>
</div>`;
}

function pageShell(title, body, options = {}) {
  const {
    extra = '',
    scripts = ['/__assets/js/core.js'],
    moduleScripts = [],
    cdnStyles = [],
    cdnScripts = [],
    showBack = false,
    backHref = '/',
    page = 'browse',
  } = options;

  const cdnCss = cdnStyles.map((href) => `<link rel="stylesheet" href="${v(href)}">`).join('\n');
  const cdnJs = cdnScripts.map((src) => `<script src="${v(src)}" defer></script>`).join('\n');
  const modules = moduleScripts.map((src) => `<script type="module" src="${v(src)}"></script>`).join('\n');
  const navMode = page === 'viewer' ? 'viewer' : 'browse';

  return `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="${page === 'viewer' ? '#0f1210' : '#f5f7f6'}">
<meta name="color-scheme" content="light">
<meta name="apple-mobile-web-app-title" content="Pocket Media">
<title>${esc(title)}</title>
<link rel="icon" type="image/png" href="${APP_ICON}">
<link rel="apple-touch-icon" href="${APP_ICON}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
${cssLinks()}
${cdnCss}
</head><body class="${page === 'viewer' ? 'page-viewer' : 'page-browse'}">
${page === 'viewer' ? '' : topnavHtml({ title: options.navTitle || 'Media', showBack, backHref, mode: navMode })}
${body}
${extra}
${page === 'viewer' ? '' : transferPanelHtml()}
${page === 'browse' ? bottomNavHtml({ showBack, backHref }) : ''}
<div id="toast" class="toast" role="status" aria-live="polite"></div>
${jsScripts(scripts)}
${cdnJs}
${modules}
</body></html>`;
}

module.exports = {
  pageShell,
  topnavHtml,
  bottomNavHtml,
  breadcrumbs,
  bulkBarHtml,
  transferPanelHtml,
  APP_ICON,
};
