/**
 * PDF.js in the reader page. The worker, fonts, character maps and decoders are packaged
 * with the extension (see wxt.config.ts) and loaded from it: nothing comes from the network,
 * and nothing needs eval.
 */
import { getDocument, GlobalWorkerOptions, type PDFDocumentLoadingTask, type PDFDocumentProxy } from 'pdfjs-dist';
import type { OpenResult } from './open';
import { layoutPdf, MAX_PAGES, pageTexts } from './pdfText';

function assets(): string {
  // getURL('/') typed as the extension root; the pdfjs/ folder is added at build time.
  return `${browser.runtime.getURL('/')}pdfjs/`;
}

/**
 * Starts loading a PDF. PDF.js takes ownership of the buffer it gets, so it's given a copy.
 * Call `.destroy()` on the returned task when done.
 */
export function openPdf(bytes: Uint8Array): PDFDocumentLoadingTask {
  const base = assets();
  GlobalWorkerOptions.workerSrc = `${base}pdf.worker.min.mjs`;
  return getDocument({
    data: bytes.slice(),
    standardFontDataUrl: `${base}standard_fonts/`,
    cMapUrl: `${base}cmaps/`,
    cMapPacked: true,
    wasmUrl: `${base}wasm/`,
    iccUrl: `${base}iccs/`,
    enableXfa: false,
  });
}

export async function parsePdfBytes(bytes: Uint8Array, name: string): Promise<OpenResult> {
  const task = openPdf(bytes);
  try {
    const pdf = await task.promise;
    if (pdf.numPages > MAX_PAGES) return { error: 'too-many-pages' };
    return layoutPdf(await pageTexts(pdf), name);
  } catch {
    return { error: 'unreadable' }; // damaged or password-protected
  } finally {
    void task.destroy();
  }
}

/** Draws one page into a canvas at `cssWidth` CSS pixels wide (sharp on high-DPI screens). */
export async function renderPage(pdf: PDFDocumentProxy, n: number, canvas: HTMLCanvasElement, cssWidth: number): Promise<void> {
  const page = await pdf.getPage(n);
  const base = page.getViewport({ scale: 1 });
  const scale = (cssWidth / base.width) * (window.devicePixelRatio || 1);
  const viewport = page.getViewport({ scale });
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  canvas.style.width = `${cssWidth}px`;
  canvas.style.height = `${Math.floor((cssWidth / base.width) * base.height)}px`;
  await page.render({ canvas, viewport }).promise;
}
