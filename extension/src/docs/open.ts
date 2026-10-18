/** Turning bytes (from a file the user picked, or a link) into a Doc for the reader. */
import type { Doc, DocError } from './doc';
import { parsePptx } from './pptx';

export const MAX_BYTES = 25 * 1024 * 1024;

export type OpenResult = Doc | { error: DocError };
export type DetectedKind = 'pdf' | 'pptx' | 'legacy-ppt' | 'unknown';
export type PdfParser = (bytes: Uint8Array, name: string) => Promise<OpenResult>;

export const ERROR_MESSAGES: Record<DocError, string> = {
  'no-text': 'This PDF has no selectable text (it may be scanned).',
  'legacy-ppt': 'Readwell can’t open old .ppt files. Save it as .pptx and try again.',
  'too-large': 'This file is too large to open (the limit is 25 MB).',
  'too-many-pages': 'This file has too many pages or slides to open (the limit is 300).',
  unreadable: 'Readwell couldn’t read this file. It can open .pptx and .pdf files.',
};

const startsWith = (bytes: Uint8Array, signature: number[]): boolean =>
  signature.every((b, i) => bytes[i] === b);

/** Decides by content, not file name: a renamed file still opens correctly. */
export function detectKind(bytes: Uint8Array): DetectedKind {
  // "%PDF-" may follow a little junk at the start of some files.
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, 1024));
  if (head.includes('%PDF-')) return 'pdf';
  if (startsWith(bytes, [0x50, 0x4b, 0x03, 0x04])) return 'pptx';
  if (startsWith(bytes, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) return 'legacy-ppt';
  return 'unknown';
}

/** PDF reading arrives in milestone 5; until then PDFs report as unreadable. */
const noPdfYet: PdfParser = () => Promise.resolve({ error: 'unreadable' });

export async function openDocument(
  bytes: Uint8Array,
  name: string,
  parsePdf: PdfParser = noPdfYet,
): Promise<OpenResult> {
  if (bytes.byteLength > MAX_BYTES) return { error: 'too-large' };
  switch (detectKind(bytes)) {
    case 'pdf':
      return parsePdf(bytes, name);
    case 'pptx':
      return parsePptx(bytes, name);
    case 'legacy-ppt':
      return { error: 'legacy-ppt' };
    case 'unknown':
      return { error: 'unreadable' };
  }
}

export function isOpenError(result: OpenResult): result is { error: DocError } {
  return 'error' in result;
}

/** The file name shown in the reader, taken from the last part of the URL path. */
export function nameFromUrl(url: string): string {
  try {
    const last = new URL(url).pathname.split('/').filter(Boolean).pop() ?? '';
    return decodeURIComponent(last) || 'document';
  } catch {
    return 'document';
  }
}

/** Only web documents can be opened from a link (not file:, data:, chrome:, …). */
export function isOpenableUrl(url: string): boolean {
  try {
    const { protocol } = new URL(url);
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

/** The host permission pattern for one site, e.g. "https://example.com/*". */
export function originPattern(url: string): string {
  return `${new URL(url).origin}/*`;
}

export type Fetched = { bytes: Uint8Array; name: string } | { error: DocError };

/** Downloads a document (the reader asks for the site permission first). */
export async function fetchDocument(url: string, fetchFn: typeof fetch = fetch): Promise<Fetched> {
  let response: Response;
  try {
    response = await fetchFn(url, { credentials: 'include' });
  } catch {
    return { error: 'unreadable' };
  }
  if (!response.ok) return { error: 'unreadable' };
  const length = Number(response.headers.get('content-length') ?? '0');
  if (length > MAX_BYTES) return { error: 'too-large' };
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > MAX_BYTES) return { error: 'too-large' };
  return { bytes, name: nameFromUrl(response.url || url) };
}

/** Path of the reader page, optionally opening a document from a link. */
export function readerPath(src?: string): `/reader.html${string}` {
  return src ? `/reader.html?src=${encodeURIComponent(src)}` : '/reader.html';
}
