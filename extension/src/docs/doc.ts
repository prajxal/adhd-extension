/** A document reduced to readable structure: what the reader page renders. */

export type DocKind = 'pdf' | 'pptx';

export type ListItem = { text: string; level: number };

export type Block =
  | { kind: 'heading'; text: string }
  | { kind: 'paragraph'; text: string }
  | { kind: 'list'; items: ListItem[] }
  | { kind: 'table'; rows: string[][] }
  | { kind: 'notes'; paragraphs: string[] };

/** One slide ("Slide 3") or one page ("Page 2"). */
export type Section = { label: string; title: string | null; blocks: Block[] };

export type Doc = { kind: DocKind; name: string; sections: Section[] };

/** Why a document couldn't be opened. Each maps to a message in the reader. */
export type DocError = 'no-text' | 'legacy-ppt' | 'too-large' | 'too-many-pages' | 'unreadable';

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

const isString = (v: unknown): v is string => typeof v === 'string';
const isStringArray = (v: unknown): v is string[] => Array.isArray(v) && v.every(isString);

function isBlock(v: unknown): v is Block {
  if (!isRecord(v)) return false;
  switch (v.kind) {
    case 'heading':
    case 'paragraph':
      return isString(v.text);
    case 'list':
      return (
        Array.isArray(v.items) &&
        v.items.every((i) => isRecord(i) && isString(i.text) && typeof i.level === 'number')
      );
    case 'table':
      return Array.isArray(v.rows) && v.rows.every(isStringArray);
    case 'notes':
      return isStringArray(v.paragraphs);
    default:
      return false;
  }
}

export function isDoc(v: unknown): v is Doc {
  return (
    isRecord(v) &&
    (v.kind === 'pdf' || v.kind === 'pptx') &&
    isString(v.name) &&
    Array.isArray(v.sections) &&
    v.sections.every(
      (s) =>
        isRecord(s) &&
        isString(s.label) &&
        (s.title === null || isString(s.title)) &&
        Array.isArray(s.blocks) &&
        s.blocks.every(isBlock),
    )
  );
}

/** All readable text in order, one block per line (used by tests and as a plain-text fallback). */
export function docText(doc: Doc): string {
  const lines: string[] = [];
  for (const section of doc.sections) {
    if (section.title) lines.push(section.title);
    for (const block of section.blocks) {
      switch (block.kind) {
        case 'heading':
        case 'paragraph':
          lines.push(block.text);
          break;
        case 'list':
          lines.push(...block.items.map((i) => i.text));
          break;
        case 'table':
          lines.push(...block.rows.map((r) => r.join(' | ')));
          break;
        case 'notes':
          lines.push(...block.paragraphs);
          break;
      }
    }
  }
  return lines.join('\n');
}
