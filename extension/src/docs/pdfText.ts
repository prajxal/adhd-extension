/**
 * PDF reading view: turns positioned text runs into headings and paragraphs.
 * Pure layout logic: PDF.js only supplies the runs (see pageTexts / pdfLoad.ts).
 */
import type { Block, Doc, DocError } from './doc';

export const MAX_PAGES = 300;

/** One run of text, in PDF units (origin bottom-left, y up), at its baseline. */
export type TextItem = { str: string; x: number; y: number; width: number; size: number };
export type PageText = { width: number; height: number; items: TextItem[] };

type Segment = { text: string; x0: number; x1: number; y: number; size: number };
type Placed = Segment & { column: number };

const MARGIN_ZONE = 0.08; // top/bottom share of the page where headers and footers live
const REPEAT_SHARE = 0.6; // a margin line on at least 60% of pages is a running header/footer
const HEADING_RATIO = 1.25;
const PARAGRAPH_GAP_RATIO = 1.4;
const SPLIT_GAP_CHARS = 3;
const ENDS_SENTENCE = /[.!?:"”’)\]]$/;
const PAGE_NUMBER = /^(?:page\s*)?\d+(?:\s*(?:of|\/)\s*\d+)?$/i;
// Labels inside a diagram ("C T", "[CLS]", "1") come out as scattered tiny fragments. A page
// with this many of them has a figure; its labels are left to "Show original".
const FIGURE_FRAGMENTS = 5;

// ---------------------------------------------------------------- input

type PdfjsItemLike = { str: string; transform: number[]; width: number; height: number };

function isPdfjsItem(v: unknown): v is PdfjsItemLike {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  return typeof o.str === 'string' && Array.isArray(o.transform) && typeof o.width === 'number' && typeof o.height === 'number';
}

/** A PDF.js text item → TextItem. Skips whitespace-only runs and vertical text. */
export function fromPdfjsItem(item: unknown): TextItem | null {
  if (!isPdfjsItem(item) || item.str.trim() === '') return null;
  const [a = 0, b = 0, c = 0, d = 0, e = 0, f = 0] = item.transform;
  if (Math.abs(b) > Math.abs(a)) return null; // rotated / vertical text
  const size = Math.hypot(c, d) || Math.hypot(a, b) || item.height;
  return size > 0 ? { str: item.str, x: e, y: f, width: item.width, size } : null;
}

/** The minimal slice of a PDF.js document this module needs (keeps it testable in Node). */
export type PdfLike = {
  numPages: number;
  getPage(n: number): Promise<{
    getViewport(options: { scale: number }): { width: number; height: number };
    getTextContent(): Promise<{ items: unknown[] }>;
  }>;
};

/** Reads every page's text runs, yielding between pages so the reader stays responsive. */
export async function pageTexts(pdf: PdfLike): Promise<PageText[]> {
  const pages: PageText[] = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    const page = await pdf.getPage(n);
    const { width, height } = page.getViewport({ scale: 1 });
    const { items } = await page.getTextContent();
    pages.push({ width, height, items: items.map(fromPdfjsItem).filter((i): i is TextItem => i !== null) });
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  return pages;
}

// ---------------------------------------------------------------- lines

function joinRuns(items: TextItem[]): string {
  let text = '';
  let prevEnd: number | null = null;
  for (const item of items) {
    const gap = prevEnd === null ? 0 : item.x - prevEnd;
    if (prevEnd !== null && gap > item.size * 0.15 && !text.endsWith(' ') && !item.str.startsWith(' ')) text += ' ';
    text += item.str;
    prevEnd = item.x + item.width;
  }
  return text.replace(/\s+/g, ' ').trim();
}

/** Groups runs on the same baseline, then splits a line where there's a wide gap (columns). */
export function segmentsOf(page: PageText): Segment[] {
  const sorted = [...page.items].sort((p, q) => q.y - p.y || p.x - q.x);
  const lines: TextItem[][] = [];
  for (const item of sorted) {
    const line = lines[lines.length - 1];
    const ref = line?.[0];
    if (line && ref && Math.abs(ref.y - item.y) <= Math.max(ref.size, item.size) * 0.35) line.push(item);
    else lines.push([item]);
  }
  const segments: Segment[] = [];
  for (const line of lines) {
    line.sort((p, q) => p.x - q.x);
    let run: TextItem[] = [];
    const flush = (): void => {
      const first = run[0];
      const last = run[run.length - 1];
      if (!first || !last) return;
      const text = joinRuns(run);
      // The size used for layout is the size most of the characters have.
      const weights = new Map<number, number>();
      for (const i of run) weights.set(Math.round(i.size * 10) / 10, (weights.get(Math.round(i.size * 10) / 10) ?? 0) + i.str.length);
      const size = [...weights.entries()].sort((p, q) => q[1] - p[1])[0]?.[0] ?? first.size;
      if (text) segments.push({ text, x0: first.x, x1: last.x + last.width, y: first.y, size });
      run = [];
    };
    for (const item of line) {
      const prev = run[run.length - 1];
      if (prev && item.x - (prev.x + prev.width) > SPLIT_GAP_CHARS * item.size * 0.5) flush();
      run.push(item);
    }
    flush();
  }
  return segments;
}

// ---------------------------------------------------------------- headers, footers, page numbers

function inMargin(seg: Segment, page: PageText): boolean {
  return seg.y > page.height * (1 - MARGIN_ZONE) || seg.y < page.height * MARGIN_ZONE;
}

const marginKey = (text: string): string => text.toLowerCase().replace(/\d+/g, '#').trim();

/** Drops running headers/footers (repeated in the margins) and bare page numbers. */
export function removeMargins(pages: PageText[], segments: Segment[][]): Segment[][] {
  const pagesWithKey = new Map<string, number>();
  segments.forEach((segs, p) => {
    const page = pages[p];
    if (!page) return;
    const keys = new Set(segs.filter((s) => inMargin(s, page)).map((s) => marginKey(s.text)));
    for (const key of keys) pagesWithKey.set(key, (pagesWithKey.get(key) ?? 0) + 1);
  });
  const repeated = (key: string): boolean =>
    pages.length >= 2 && (pagesWithKey.get(key) ?? 0) / pages.length >= REPEAT_SHARE;
  return segments.map((segs, p) => {
    const page = pages[p];
    if (!page) return segs;
    return segs.filter((s) => !(inMargin(s, page) && (PAGE_NUMBER.test(s.text) || repeated(marginKey(s.text)))));
  });
}

// ---------------------------------------------------------------- reading order

/**
 * Columns: if several lines on the right half sit level with a line on the left, read the
 * left column top to bottom, then the right. Full-width lines above the columns come first.
 */
export function readingOrder(segs: Segment[], width: number): Placed[] {
  const byY = [...segs].sort((p, q) => q.y - p.y || p.x0 - q.x0);
  const rightStarts = byY.filter(
    (r) =>
      r.x0 > width * 0.3 &&
      byY.some((l) => l !== r && l.x1 < r.x0 && Math.abs(l.y - r.y) <= Math.max(l.size, r.size) * 0.35),
  );
  if (rightStarts.length < 2) return byY.map((s) => ({ ...s, column: 0 }));

  const split = Math.min(...rightStarts.map((r) => r.x0));
  const left = byY.filter((s) => s.x1 <= split);
  const right = byY.filter((s) => s.x0 >= split);
  const full = byY.filter((s) => s.x0 < split && s.x1 > split);
  const columnTop = Math.max(...[...left, ...right].map((s) => s.y));
  return [
    ...full.filter((s) => s.y > columnTop).map((s) => ({ ...s, column: 0 })),
    ...left.map((s) => ({ ...s, column: 1 })),
    ...right.map((s) => ({ ...s, column: 2 })),
    ...full.filter((s) => s.y <= columnTop).map((s) => ({ ...s, column: 3 })),
  ];
}

// ---------------------------------------------------------------- paragraphs

function joinLines(prev: string, next: string): string {
  // "under-" + "stand" → "understand"
  if (/[A-Za-z]-$/.test(prev) && /^[a-z]/.test(next)) return prev.slice(0, -1) + next;
  return `${prev} ${next}`;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? null;
}

/** The body font size: the size most characters in the document have. */
function bodySizeOf(segments: Segment[][]): number {
  const weights = new Map<number, number>();
  for (const s of segments.flat()) weights.set(s.size, (weights.get(s.size) ?? 0) + s.text.length);
  return [...weights.entries()].sort((p, q) => q[1] - p[1])[0]?.[0] ?? 12;
}

type Draft = { kind: 'heading' | 'paragraph'; text: string };

function blocksOfPage(placed: Placed[], bodySize: number): Draft[] {
  const gaps: number[] = [];
  for (let i = 1; i < placed.length; i++) {
    const prev = placed[i - 1];
    const cur = placed[i];
    if (!prev || !cur || prev.column !== cur.column || prev.size !== cur.size) continue;
    const gap = prev.y - cur.y;
    if (gap > 0 && gap < cur.size * 3) gaps.push(gap);
  }
  const leading = median(gaps) ?? bodySize * 1.2;

  const drafts: Draft[] = [];
  let prev: Placed | null = null;
  for (const seg of placed) {
    const kind = seg.size >= bodySize * HEADING_RATIO ? 'heading' : 'paragraph';
    const last = drafts[drafts.length - 1];
    const continues =
      prev !== null &&
      last !== undefined &&
      last.kind === kind &&
      prev.column === seg.column &&
      Math.abs(seg.size - prev.size) <= prev.size * 0.1 &&
      prev.y - seg.y > 0 &&
      prev.y - seg.y <= leading * PARAGRAPH_GAP_RATIO;
    if (continues) last.text = joinLines(last.text, seg.text);
    else drafts.push({ kind, text: seg.text });
    prev = seg;
  }
  return dropFigureLabels(drafts);
}

const isFragment = (d: Draft): boolean =>
  d.kind === 'paragraph' && d.text.length <= 15 && d.text.split(' ').length <= 2;

/** Drops tiny fragments only when a page has many of them (figure labels, not real text). */
export function dropFigureLabels<T extends Draft>(drafts: T[]): T[] {
  return drafts.filter(isFragment).length >= FIGURE_FRAGMENTS ? drafts.filter((d) => !isFragment(d)) : drafts;
}

// ---------------------------------------------------------------- the document

export function layoutPdf(pages: PageText[], name: string): Doc | { error: DocError } {
  if (pages.length > MAX_PAGES) return { error: 'too-many-pages' };
  const segments = removeMargins(pages, pages.map(segmentsOf));
  if (segments.every((s) => s.length === 0)) return { error: 'no-text' };
  const bodySize = bodySizeOf(segments);

  const perPage: Draft[][] = segments.map((segs, p) => blocksOfPage(readingOrder(segs, pages[p]?.width ?? 612), bodySize));
  // A paragraph that runs over a page break continues into the next page's first paragraph,
  // and stays in the earlier page's section.
  for (let p = 1; p < perPage.length; p++) {
    const prevPage = perPage.slice(0, p).reverse().find((d) => d.length > 0);
    const tail = prevPage?.[prevPage.length - 1];
    const head = perPage[p]?.[0];
    if (tail?.kind === 'paragraph' && head?.kind === 'paragraph' && !ENDS_SENTENCE.test(tail.text)) {
      tail.text = joinLines(tail.text, head.text);
      perPage[p]?.shift();
    }
  }

  return {
    kind: 'pdf',
    name,
    sections: perPage.map((drafts, p) => ({
      label: `Page ${p + 1}`,
      title: null,
      blocks: drafts.map((d): Block => ({ kind: d.kind, text: d.text })),
    })),
  };
}
