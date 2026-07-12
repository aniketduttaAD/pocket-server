import * as pdfjsLib from 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.8.69/build/pdf.min.mjs';

pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.8.69/build/pdf.worker.min.mjs';

const data = document.getElementById('viewer-data');
const rawUrl = data?.dataset.raw;
const canvas = document.getElementById('pdf-canvas');
const wrap = document.getElementById('pdf-canvas-wrap');
const pageInfo = document.getElementById('pdf-page-info');

if (!rawUrl || !canvas) {
  // nothing to do
} else {
  let pdfDoc = null;
  let pageNum = 1;
  let scale = 1.2;
  let rendering = false;

  async function renderPage(num) {
    if (!pdfDoc || rendering) return;
    rendering = true;
    const page = await pdfDoc.getPage(num);
    const viewport = page.getViewport({ scale });
    canvas.height = viewport.height;
    canvas.width = viewport.width;
    const ctx = canvas.getContext('2d');
    await page.render({ canvasContext: ctx, viewport }).promise;
    pageInfo.textContent = 'Page ' + num + ' / ' + pdfDoc.numPages;
    rendering = false;
  }

  try {
    pdfDoc = await pdfjsLib.getDocument(rawUrl).promise;
    await renderPage(pageNum);
  } catch (e) {
    wrap.innerHTML = '<p style="padding:2rem;color:var(--muted)">Could not load PDF: ' + e.message + '</p>';
  }

  document.getElementById('pdf-prev')?.addEventListener('click', async function () {
    if (pageNum <= 1) return;
    pageNum--;
    await renderPage(pageNum);
  });

  document.getElementById('pdf-next')?.addEventListener('click', async function () {
    if (!pdfDoc || pageNum >= pdfDoc.numPages) return;
    pageNum++;
    await renderPage(pageNum);
  });

  document.getElementById('pdf-zoom-in')?.addEventListener('click', async function () {
    scale = Math.min(scale + 0.2, 3);
    await renderPage(pageNum);
  });

  document.getElementById('pdf-zoom-out')?.addEventListener('click', async function () {
    scale = Math.max(scale - 0.2, 0.4);
    await renderPage(pageNum);
  });

  document.getElementById('pdf-fit')?.addEventListener('click', async function () {
    if (!pdfDoc) return;
    const page = await pdfDoc.getPage(pageNum);
    const vp = page.getViewport({ scale: 1 });
    scale = Math.min((wrap.clientWidth - 32) / vp.width, 2);
    await renderPage(pageNum);
  });
}
