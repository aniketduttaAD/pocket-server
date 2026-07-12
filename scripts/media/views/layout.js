const { esc } = require('../lib/util');
const { icon } = require('./icons');

const CSS_FILES = [
  '/__assets/css/tokens.css',
  '/__assets/css/layout.css',
  '/__assets/css/components.css',
  '/__assets/css/browse.css',
  '/__assets/css/upload.css',
  '/__assets/css/viewer.css',
];

function cssLinks() {
  return CSS_FILES.map((href) => `<link rel="stylesheet" href="${href}">`).join('\n');
}

function jsScripts(scripts) {
  return scripts.map((src) => `<script src="${src}" defer></script>`).join('\n');
}

function transferPanelHtml() {
  return `<div id="transfer-backdrop" class="sheet-backdrop" aria-hidden="true"></div>
<aside id="transfer-panel" class="transfer-panel sheet" aria-label="Transfer queue">
  <div class="sheet-head">
    <h3>${icon('activity')} Transfers</h3>
    <div class="sheet-head-actions">
      <button type="button" class="btn ghost sm" id="transfer-clear">Clear done</button>
      <button type="button" class="btn ghost sm icon-only" id="transfer-close" aria-label="Close">${icon('x')}</button>
    </div>
  </div>
  <div class="transfer-list" id="transfer-list"></div>
</aside>`;
}

function topnavHtml(options = {}) {
  const { title = 'Media Library', showBack = false, backHref = '/' } = options;
  return `<header class="topnav">
  <div class="topnav-start">
    ${showBack ? `<a class="btn ghost sm icon-only mobile-only" href="${esc(backHref)}" aria-label="Back">${icon('arrowLeft')}</a>` : ''}
    <a class="topnav-brand" href="/">${icon('folder', 'brand-icon')}<span class="topnav-title">${esc(title)}</span></a>
  </div>
  <div class="topnav-actions">
    <button type="button" id="transfer-toggle" class="btn ghost sm icon-only transfer-btn" title="Transfers" aria-label="View transfers">
      ${icon('activity')}
      <span id="transfer-badge" class="badge"></span>
    </button>
  </div>
</header>`;
}

function breadcrumbs(webPath) {
  const parts = webPath.split('/').filter(Boolean);
  let html = `<nav class="breadcrumb" aria-label="Breadcrumb">${icon('home')}<a href="/">Home</a>`;
  let acc = '';
  for (const p of parts) {
    acc += `/${encodeURIComponent(p)}`;
    html += `<span class="breadcrumb-sep">/</span><a href="${acc}/">${esc(decodeURIComponent(p))}</a>`;
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
  } = options;

  const cdnCss = cdnStyles.map((href) => `<link rel="stylesheet" href="${href}">`).join('\n');
  const cdnJs = cdnScripts.map((src) => `<script src="${src}" defer></script>`).join('\n');
  const modules = moduleScripts.map((src) => `<script type="module" src="${src}"></script>`).join('\n');

  return `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#2563eb">
<title>${esc(title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
${cssLinks()}
${cdnCss}
</head><body>
${topnavHtml({ title: options.navTitle || 'Media Library', showBack: options.showBack, backHref: options.backHref })}
${body}
${extra}
${transferPanelHtml()}
<div id="toast" class="toast" role="status" aria-live="polite"></div>
${jsScripts(scripts)}
${cdnJs}
${modules}
</body></html>`;
}

module.exports = {
  pageShell,
  topnavHtml,
  breadcrumbs,
  bulkBarHtml,
  transferPanelHtml,
};
