import * as pdfjsLib from 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.8.69/build/pdf.min.mjs';

pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.8.69/build/pdf.worker.min.mjs';

const data = document.getElementById('viewer-data');
const rawUrl = data?.dataset.raw;
const canvas = document.getElementById('pdf-canvas');
const wrap = document.getElementById('pdf-canvas-wrap');
const pageInfo = document.getElementById('pdf-page-info');
const zoomInfo = document.getElementById('pdf-zoom-info');

if (!rawUrl || !canvas) {
  // nothing to do
} else {
  let pdfDoc = null;
  let pageNum = 1;
  let scale = 1;
  let renderTask = null;
  let renderQueued = false;
  let pageWidth = 0;

  function updateZoomLabel() {
    if (zoomInfo) zoomInfo.textContent = Math.round(scale * 100) + '%';
  }

  async function renderPage(num) {
    if (!pdfDoc) return;
    if (renderTask) {
      renderQueued = true;
      try { renderTask.cancel(); } catch { /* ignore */ }
      return;
    }

    const page = await pdfDoc.getPage(num);
    const dpr = window.devicePixelRatio || 1;
    const viewport = page.getViewport({ scale: scale * dpr });
    pageWidth = page.getViewport({ scale: 1 }).width;

    canvas.height = viewport.height;
    canvas.width = viewport.width;
    canvas.style.width = `${viewport.width / dpr}px`;
    canvas.style.height = `${viewport.height / dpr}px`;

    const ctx = canvas.getContext('2d');
    renderTask = page.render({ canvasContext: ctx, viewport });
    try {
      await renderTask.promise;
    } catch (e) {
      if (e?.name !== 'RenderingCancelledException') throw e;
    } finally {
      renderTask = null;
    }

    if (pageInfo) pageInfo.textContent = `Page ${num} / ${pdfDoc.numPages}`;
    updateZoomLabel();

    if (renderQueued) {
      renderQueued = false;
      await renderPage(num);
    }
  }

  function queueRender() {
    renderPage(pageNum);
  }

  function fitWidth() {
    if (!pdfDoc || !pageWidth || !wrap) return;
    const pad = 24;
    const width = wrap.clientWidth || wrap.getBoundingClientRect().width;
    if (width <= pad) return;
    scale = Math.max(0.25, Math.min((width - pad) / pageWidth, 4));
    queueRender();
  }

  function zoomBy(delta) {
    scale = Math.max(0.25, Math.min(scale + delta, 4));
    queueRender();
  }

  try {
    pdfDoc = await pdfjsLib.getDocument(rawUrl).promise;
    requestAnimationFrame(() => {
      fitWidth();
    });
  } catch (e) {
    wrap.innerHTML = `<p class="pdf-error">Could not load PDF: ${e.message}</p>`;
  }

  document.getElementById('pdf-prev')?.addEventListener('click', () => {
    if (pageNum <= 1) return;
    pageNum--;
    queueRender();
  });

  document.getElementById('pdf-next')?.addEventListener('click', () => {
    if (!pdfDoc || pageNum >= pdfDoc.numPages) return;
    pageNum++;
    queueRender();
  });

  document.getElementById('pdf-zoom-in')?.addEventListener('click', () => zoomBy(0.15));
  document.getElementById('pdf-zoom-out')?.addEventListener('click', () => zoomBy(-0.15));
  document.getElementById('pdf-fit')?.addEventListener('click', fitWidth);

  wrap?.addEventListener('wheel', (e) => {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    zoomBy(e.deltaY < 0 ? 0.1 : -0.1);
  }, { passive: false });

  let pinchStart = 0;
  let scaleStart = 1;
  wrap?.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 2) return;
    pinchStart = Math.hypot(
      e.touches[0].clientX - e.touches[1].clientX,
      e.touches[0].clientY - e.touches[1].clientY,
    );
    scaleStart = scale;
  }, { passive: true });

  wrap?.addEventListener('touchmove', (e) => {
    if (e.touches.length !== 2 || !pinchStart) return;
    e.preventDefault();
    const dist = Math.hypot(
      e.touches[0].clientX - e.touches[1].clientX,
      e.touches[0].clientY - e.touches[1].clientY,
    );
    scale = Math.max(0.25, Math.min(scaleStart * (dist / pinchStart), 4));
    queueRender();
  }, { passive: false });

  wrap?.addEventListener('touchend', () => {
    pinchStart = 0;
  });

  window.addEventListener('resize', () => {
    if (scale <= 1.05) fitWidth();
  });
}
