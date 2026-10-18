/**
 * Reads the text of a .pptx into the Doc model: slide titles, bullets with levels,
 * plain paragraphs, tables and speaker notes, in the order the deck shows them.
 */
import { strFromU8, unzipSync } from 'fflate';
import type { Block, Doc, DocError, Section } from './doc';

export const MAX_SLIDES = 300;
// Unzipped-size guards so a small, highly compressed file can't exhaust memory.
const MAX_ENTRY_BYTES = 20 * 1024 * 1024;
const MAX_TOTAL_BYTES = 100 * 1024 * 1024;

const R_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const WANTED =
  /^ppt\/(?:presentation\.xml|_rels\/presentation\.xml\.rels|slides\/slide\d+\.xml|slides\/_rels\/slide\d+\.xml\.rels|notesSlides\/notesSlide\d+\.xml)$/;
const TITLE_TYPES = new Set(['title', 'ctrTitle']);
const BULLET_TYPES = new Set(['body', 'obj']);
const SKIPPED_TYPES = new Set(['dt', 'ftr', 'hdr', 'sldNum', 'sldImg']);

export type PptxResult = Doc | { error: DocError };

class PptxError extends Error {
  constructor(readonly code: DocError) {
    super(code);
  }
}

// ---- small XML helpers (match on localName so namespace prefixes don't matter) ----

function parseXml(text: string): Document {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length > 0) throw new PptxError('unreadable');
  return doc;
}

const kids = (el: Element, name: string): Element[] =>
  Array.from(el.children).filter((c) => c.localName === name);

const firstKid = (el: Element, name: string): Element | undefined => kids(el, name)[0];

const descendants = (el: Element | Document, name: string): Element[] =>
  Array.from(el.getElementsByTagName('*')).filter((e) => e.localName === name);

const relId = (el: Element): string | null =>
  el.getAttributeNS(R_NS, 'id') || el.getAttribute('r:id');

const collapse = (text: string): string => text.replace(/\s+/g, ' ').trim();

/** Resolves a relationship target against the folder of the part that refers to it. */
function resolvePath(baseDir: string, target: string): string {
  if (target.startsWith('/')) return target.slice(1);
  const parts = baseDir.split('/').filter(Boolean);
  for (const segment of target.split('/')) {
    if (segment === '..') parts.pop();
    else if (segment !== '.' && segment !== '') parts.push(segment);
  }
  return parts.join('/');
}

type Rel = { type: string; path: string };

function relationships(files: Record<string, Uint8Array>, relsPath: string, baseDir: string): Map<string, Rel> {
  const rels = new Map<string, Rel>();
  const data = files[relsPath];
  if (!data) return rels;
  for (const rel of descendants(parseXml(strFromU8(data)), 'Relationship')) {
    const id = rel.getAttribute('Id');
    const target = rel.getAttribute('Target');
    if (id && target) rels.set(id, { type: rel.getAttribute('Type') ?? '', path: resolvePath(baseDir, target) });
  }
  return rels;
}

// ---- paragraphs and shapes ----

type Para = { text: string; level: number; bullet: boolean | null };

function readParagraph(p: Element): Para {
  const pPr = firstKid(p, 'pPr');
  let bullet: boolean | null = null;
  if (pPr) {
    if (firstKid(pPr, 'buNone')) bullet = false;
    else if (firstKid(pPr, 'buChar') || firstKid(pPr, 'buAutoNum')) bullet = true;
  }
  const level = Number.parseInt(pPr?.getAttribute('lvl') ?? '0', 10) || 0;
  const pieces: string[] = [];
  for (const child of Array.from(p.children)) {
    if (child.localName === 'r' || child.localName === 'fld') {
      pieces.push(firstKid(child, 't')?.textContent ?? '');
    } else if (child.localName === 'br') {
      pieces.push(' ');
    }
  }
  return { text: collapse(pieces.join('')), level, bullet };
}

function paragraphsOf(txBody: Element | undefined): Para[] {
  return txBody ? kids(txBody, 'p').map(readParagraph).filter((p) => p.text !== '') : [];
}

/** Shapes in reading order, looking inside groups. */
function shapesIn(tree: Element): Element[] {
  return Array.from(tree.children).flatMap((child) => {
    if (child.localName === 'grpSp') return shapesIn(child);
    return child.localName === 'sp' || child.localName === 'graphicFrame' ? [child] : [];
  });
}

/** The placeholder type of a shape: null for a plain shape, "body" for an untyped placeholder. */
function placeholderType(sp: Element): string | null {
  const ph = descendants(sp, 'ph')[0];
  if (!ph) return null;
  return ph.getAttribute('type') ?? 'body';
}

function readTable(frame: Element): string[][] {
  const table = descendants(frame, 'tbl')[0];
  if (!table) return [];
  return kids(table, 'tr')
    .map((tr) => kids(tr, 'tc').map((tc) => paragraphsOf(firstKid(tc, 'txBody')).map((p) => p.text).join(' ')))
    .filter((row) => row.some((cell) => cell !== ''));
}

function pushPara(blocks: Block[], para: Para, bullet: boolean): void {
  if (bullet) {
    const last = blocks[blocks.length - 1];
    const item = { text: para.text, level: para.level };
    if (last?.kind === 'list') last.items.push(item);
    else blocks.push({ kind: 'list', items: [item] });
  } else {
    blocks.push({ kind: 'paragraph', text: para.text });
  }
}

function readSlide(xml: Document): { title: string | null; blocks: Block[] } {
  const tree = descendants(xml, 'spTree')[0];
  let title: string | null = null;
  const blocks: Block[] = [];
  if (!tree) return { title, blocks };
  for (const shape of shapesIn(tree)) {
    if (shape.localName === 'graphicFrame') {
      const rows = readTable(shape);
      if (rows.length > 0) blocks.push({ kind: 'table', rows });
      continue;
    }
    const type = placeholderType(shape);
    if (type !== null && SKIPPED_TYPES.has(type)) continue;
    const paras = paragraphsOf(firstKid(shape, 'txBody'));
    if (paras.length === 0) continue;
    if (type !== null && TITLE_TYPES.has(type)) {
      title ??= paras.map((p) => p.text).join(' ');
      continue;
    }
    const bulletByDefault = type !== null && BULLET_TYPES.has(type);
    for (const para of paras) pushPara(blocks, para, para.bullet ?? bulletByDefault);
  }
  return { title, blocks };
}

function readNotes(xml: Document): string[] {
  const tree = descendants(xml, 'spTree')[0];
  if (!tree) return [];
  return shapesIn(tree)
    .filter((shape) => shape.localName === 'sp' && placeholderType(shape) === 'body')
    .flatMap((shape) => paragraphsOf(firstKid(shape, 'txBody')).map((p) => p.text));
}

// ---- the deck ----

function unzip(bytes: Uint8Array): Record<string, Uint8Array> {
  // An object, so the type checker sees the filter callback changing it.
  const size = { total: 0, tooBig: false };
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes, {
      filter: (file) => {
        if (!WANTED.test(file.name)) return false;
        size.total += file.originalSize;
        if (file.originalSize > MAX_ENTRY_BYTES || size.total > MAX_TOTAL_BYTES) size.tooBig = true;
        return !size.tooBig;
      },
    });
  } catch {
    throw new PptxError('unreadable');
  }
  if (size.tooBig) throw new PptxError('too-large');
  return files;
}

export function parsePptx(bytes: Uint8Array, name: string): PptxResult {
  try {
    const files = unzip(bytes);
    const presentationData = files['ppt/presentation.xml'];
    if (!presentationData) return { error: 'unreadable' };
    const presentation = parseXml(strFromU8(presentationData));
    const rels = relationships(files, 'ppt/_rels/presentation.xml.rels', 'ppt');

    const slidePaths = descendants(presentation, 'sldId')
      .map((el) => rels.get(relId(el) ?? '')?.path)
      .filter((p): p is string => p !== undefined);
    if (slidePaths.length > MAX_SLIDES) return { error: 'too-many-pages' };

    const sections: Section[] = slidePaths.map((path, i) => {
      const data = files[path];
      const { title, blocks } = data ? readSlide(parseXml(strFromU8(data))) : { title: null, blocks: [] };
      const dir = path.slice(0, path.lastIndexOf('/'));
      const file = path.slice(path.lastIndexOf('/') + 1);
      const slideRels = relationships(files, `${dir}/_rels/${file}.rels`, dir);
      const notesPath = [...slideRels.values()].find((r) => r.type.endsWith('/notesSlide'))?.path;
      const notesData = notesPath ? files[notesPath] : undefined;
      const notes = notesData ? readNotes(parseXml(strFromU8(notesData))) : [];
      if (notes.length > 0) blocks.push({ kind: 'notes', paragraphs: notes });
      return { label: `Slide ${i + 1}`, title, blocks };
    });
    return { kind: 'pptx', name, sections };
  } catch (error) {
    return { error: error instanceof PptxError ? error.code : 'unreadable' };
  }
}
