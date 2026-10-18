import { useEffect, useRef, useState, type ReactElement } from 'react';
import { openPdf, renderPage } from '@/src/docs/pdfLoad';

const MAX_WIDTH = 900;

/**
 * "Show original": the PDF's real pages, drawn as images one after another.
 * Reading modes don't apply here; this is for checking layout, figures and tables.
 */
export function OriginalPages({ bytes }: { bytes: Uint8Array }): ReactElement {
  const containerRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<'loading' | 'done' | 'error'>('loading');

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const task = openPdf(bytes);
    // An object, so the type checker sees the cleanup below changing it.
    const run = { cancelled: false };
    void (async () => {
      try {
        const pdf = await task.promise;
        const width = Math.min(MAX_WIDTH, container.clientWidth || MAX_WIDTH);
        for (let n = 1; n <= pdf.numPages && !run.cancelled; n++) {
          const figure = document.createElement('figure');
          figure.className = 'rw-page';
          const canvas = document.createElement('canvas');
          canvas.setAttribute('role', 'img');
          canvas.setAttribute('aria-label', `Page ${n} of the original PDF`);
          const caption = document.createElement('figcaption');
          caption.textContent = `Page ${n}`;
          figure.append(canvas, caption);
          container.append(figure);
          await renderPage(pdf, n, canvas, width);
        }
        if (!run.cancelled) setStatus('done');
      } catch {
        if (!run.cancelled) setStatus('error');
      }
    })();
    return () => {
      run.cancelled = true;
      container.replaceChildren();
      void task.destroy();
    };
  }, [bytes]);

  return (
    <div className="rw-original">
      {status === 'loading' && (
        <p className="rw-status" role="status">
          Drawing pages…
        </p>
      )}
      {status === 'error' && <p role="alert">Readwell couldn’t draw this PDF’s pages.</p>}
      <div ref={containerRef} />
    </div>
  );
}
