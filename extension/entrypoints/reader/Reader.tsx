import { useCallback, useEffect, useRef, useState, type DragEvent, type ReactElement } from 'react';
import type { Doc } from '@/src/docs/doc';
import { DocView } from '@/src/docs/DocView';
import {
  ERROR_MESSAGES,
  fetchDocument,
  isOpenableUrl,
  isOpenError,
  nameFromUrl,
  openDocument,
  originPattern,
} from '@/src/docs/open';
import { parsePdfBytes } from '@/src/docs/pdfLoad';
import { VisualModes } from '@/src/modes/visualModes';
import { loadSettings, onSettingsChanged, type Settings } from '@/src/shared/settings';
import { OriginalPages } from './OriginalPages';

/** Stands in for a hostname so the reader always counts as a "turned on" site. */
const READER_SITE = 'readwell-reader';

type View =
  | { kind: 'empty' }
  | { kind: 'ask'; url: string; name: string; host: string }
  | { kind: 'loading'; name: string }
  | { kind: 'error'; message: string }
  | { kind: 'doc'; doc: Doc; bytes: Uint8Array };

function readerSettings(settings: Settings): Settings {
  return { ...settings, enabledSites: [...settings.enabledSites, READER_SITE] };
}

export function Reader({ src }: { src: string | null }): ReactElement {
  const [view, setView] = useState<View>(() => {
    if (src === null) return { kind: 'empty' };
    if (!isOpenableUrl(src)) return { kind: 'error', message: 'Readwell can only open documents from web links.' };
    return { kind: 'ask', url: src, name: nameFromUrl(src), host: new URL(src).host };
  });
  const [dragging, setDragging] = useState(false);
  const [showOriginal, setShowOriginal] = useState(false);
  const articleRef = useRef<HTMLElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Reading modes apply to the document only, never to the reader's own controls.
  useEffect(() => {
    const article = articleRef.current;
    if (!article) return;
    const modes = new VisualModes(READER_SITE, document, article);
    void loadSettings().then((s) => {
      modes.apply(readerSettings(s));
    });
    return onSettingsChanged((s) => {
      modes.apply(readerSettings(s));
    });
  }, []);

  const show = useCallback(async (bytes: Uint8Array, name: string) => {
    setView({ kind: 'loading', name });
    setShowOriginal(false);
    const result = await openDocument(bytes, name, parsePdfBytes);
    setView(
      isOpenError(result) ? { kind: 'error', message: ERROR_MESSAGES[result.error] } : { kind: 'doc', doc: result, bytes },
    );
  }, []);

  const openFile = useCallback(
    async (file: File) => {
      await show(new Uint8Array(await file.arrayBuffer()), file.name);
    },
    [show],
  );

  const openLink = useCallback(
    async (url: string, name: string) => {
      setView({ kind: 'loading', name });
      const fetched = await fetchDocument(url);
      if ('error' in fetched) setView({ kind: 'error', message: ERROR_MESSAGES[fetched.error] });
      else await show(fetched.bytes, fetched.name);
    },
    [show],
  );

  // If the link's site is already allowed, open it straight away (first load only).
  useEffect(() => {
    if (src === null || !isOpenableUrl(src)) return;
    void browser.permissions.contains({ origins: [originPattern(src)] }).then((allowed) => {
      if (allowed) void openLink(src, nameFromUrl(src));
    });
  }, [src, openLink]);

  const allowAndOpen = async (url: string, name: string): Promise<void> => {
    // Must run straight from the click: Chrome only shows the prompt for a user gesture.
    const granted = await browser.permissions.request({ origins: [originPattern(url)] });
    if (granted) await openLink(url, name);
    else setView({ kind: 'error', message: 'Readwell wasn’t allowed to read files from that site.' });
  };

  const onDrop = (event: DragEvent): void => {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer.files[0];
    if (file) void openFile(file);
  };

  const chooseFile = (): void => {
    fileInputRef.current?.click();
  };

  return (
    <div
      className={dragging ? 'rw-reader rw-dragging' : 'rw-reader'}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDragging(false);
      }}
      onDrop={onDrop}
    >
      <header className="rw-bar">
        <span className="rw-brand">Readwell</span>
        <span className="rw-bar-name">{view.kind === 'doc' ? view.doc.name : 'Reader'}</span>
        {view.kind === 'doc' && view.doc.kind === 'pdf' && (
          <button
            type="button"
            className="rw-button-secondary"
            aria-pressed={showOriginal}
            onClick={() => {
              setShowOriginal(!showOriginal);
            }}
          >
            {showOriginal ? 'Reading view' : 'Show original'}
          </button>
        )}
        <button type="button" className="rw-button-secondary" onClick={chooseFile}>
          Open file…
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".pptx,.pdf,application/pdf,application/vnd.openxmlformats-officedocument.presentationml.presentation"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void openFile(file);
            e.target.value = '';
          }}
        />
      </header>

      <main className="rw-main">
        {view.kind === 'empty' && (
          <div className="rw-panel">
            <h1>Open a document to read it more easily</h1>
            <p>PowerPoint (.pptx) and PDF files. Your file stays on this computer unless you click Simplify.</p>
            <button type="button" className="rw-button-primary" onClick={chooseFile}>
              Choose a file
            </button>
            <p className="rw-hint">or drop it anywhere on this page</p>
          </div>
        )}
        {view.kind === 'ask' && (
          <div className="rw-panel">
            <h1>Open “{view.name}”?</h1>
            <p>
              Readwell needs permission to read files from <strong>{view.host}</strong>. Chrome will ask you once for
              this site only.
            </p>
            <div className="rw-actions">
              <button
                type="button"
                className="rw-button-primary"
                onClick={() => {
                  void allowAndOpen(view.url, view.name);
                }}
              >
                Allow and open
              </button>
              <button
                type="button"
                className="rw-button-secondary"
                onClick={() => {
                  setView({ kind: 'empty' });
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        )}
        {view.kind === 'loading' && (
          <p className="rw-panel rw-status" role="status">
            Opening {view.name}…
          </p>
        )}
        {view.kind === 'error' && (
          <div className="rw-panel" role="alert">
            <p>{view.message}</p>
            <button type="button" className="rw-button-primary" onClick={chooseFile}>
              Choose another file
            </button>
          </div>
        )}
        <article ref={articleRef} className="rw-doc" hidden={view.kind !== 'doc' || showOriginal}>
          {view.kind === 'doc' && <DocView doc={view.doc} />}
        </article>
        {view.kind === 'doc' && showOriginal && <OriginalPages bytes={view.bytes} />}
      </main>
      {dragging && <div className="rw-drop">Drop to open</div>}
    </div>
  );
}
