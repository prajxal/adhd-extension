// @vitest-environment node
// Fixture PDFs go through real PDF.js (the Node "legacy" build) and then our layout.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { describe, expect, it } from 'vitest';
import {
  dropFigureLabels,
  fromPdfjsItem,
  layoutPdf,
  MAX_PAGES,
  pageTexts,
  readingOrder,
  removeMargins,
  segmentsOf,
  type PageText,
  type TextItem,
} from '@/src/docs/pdfText';

const DIR = path.join(__dirname, 'fixtures', 'docs');
const expected = (name: string): unknown => JSON.parse(readFileSync(path.join(DIR, name), 'utf8')) as unknown;

async function parseFixture(file: string): Promise<unknown> {
  const data = new Uint8Array(readFileSync(path.join(DIR, file)));
  const task = getDocument({ data, verbosity: 0 });
  try {
    return layoutPdf(await pageTexts(await task.promise), file);
  } finally {
    await task.destroy();
  }
}

/** A run of Helvetica-ish text: width ≈ 0.5 × size per character. */
const run = (str: string, x: number, y: number, size = 11): TextItem => ({ str, x, y, size, width: str.length * size * 0.5 });
const page = (items: TextItem[]): PageText => ({ width: 612, height: 792, items });

describe('fixtures through PDF.js', () => {
  it.each(['one-column', 'two-column'])('%s.pdf matches its expected reading view', async (name) => {
    expect(await parseFixture(`${name}.pdf`)).toEqual(expected(`${name}.expected.json`));
  });

  it('no-text.pdf reports that it has no text', async () => {
    expect(await parseFixture('no-text.pdf')).toEqual(expected('no-text.expected.json'));
  });
});

describe('PDF.js items', () => {
  it('skips whitespace runs and vertical text, and reads size from the matrix', () => {
    expect(fromPdfjsItem({ str: '  ', transform: [11, 0, 0, 11, 1, 2], width: 5, height: 11 })).toBeNull();
    expect(fromPdfjsItem({ str: 'up', transform: [0, 11, -11, 0, 1, 2], width: 5, height: 11 })).toBeNull();
    expect(fromPdfjsItem({ str: 'Hi', transform: [18, 0, 0, 18, 72, 700], width: 20, height: 18 })).toEqual({
      str: 'Hi', x: 72, y: 700, width: 20, size: 18,
    });
    expect(fromPdfjsItem({ nope: true })).toBeNull();
  });
});

describe('layout rules', () => {
  it('joins runs on one baseline, splitting at wide gaps', () => {
    const segs = segmentsOf(page([run('Hello', 72, 700), run('world', 102, 700), run('Far away', 400, 700)]));
    expect(segs.map((s) => s.text)).toEqual(['Hello world', 'Far away']);
  });

  it('removes running headers and page numbers, keeps body text in the margin zone once', () => {
    const pages = [1, 2, 3].map((n) =>
      page([run('Annual Report 2025', 72, 770, 9), run(`Body text on page ${n}.`, 72, 600), run(String(n), 300, 30, 9)]),
    );
    pages[0]?.items.push(run('A note only on page one', 72, 40, 9));
    const kept = removeMargins(pages, pages.map(segmentsOf)).map((segs) => segs.map((s) => s.text));
    expect(kept[0]).toEqual(['Body text on page 1.', 'A note only on page one']);
    expect(kept[2]).toEqual(['Body text on page 3.']);
  });

  it('a one-page document keeps its top line (nothing can repeat)', () => {
    const pages = [page([run('Title at the very top', 72, 770, 9), run('Body.', 72, 600)])];
    expect(removeMargins(pages, pages.map(segmentsOf))[0]?.map((s) => s.text)).toEqual(['Title at the very top', 'Body.']);
  });

  it('reads two columns left then right, and a single column top to bottom', () => {
    const two = segmentsOf(page([run('L1', 72, 700), run('R1', 330, 700), run('L2', 72, 685), run('R2', 330, 685)]));
    expect(readingOrder(two, 612).map((s) => s.text)).toEqual(['L1', 'L2', 'R1', 'R2']);
    const one = segmentsOf(page([run('First line', 72, 700), run('Second line', 72, 685)]));
    expect(readingOrder(one, 612).map((s) => s.column)).toEqual([0, 0]);
  });

  it('does not treat an indented line as a second column', () => {
    const segs = segmentsOf(page([run('Normal line of text here', 72, 700), run('Indented quote', 220, 685), run('Back again', 72, 670)]));
    expect(readingOrder(segs, 612).map((s) => s.text)).toEqual(['Normal line of text here', 'Indented quote', 'Back again']);
  });

  it('only joins hyphenated words when the next line starts in lower case', () => {
    const doc = layoutPdf([page([run('A well-', 72, 700), run('known fact and a self-', 72, 685), run('Contained bit.', 72, 670)])], 'h.pdf');
    expect(doc).toEqual({
      kind: 'pdf',
      name: 'h.pdf',
      sections: [{ label: 'Page 1', title: null, blocks: [{ kind: 'paragraph', text: 'A wellknown fact and a self- Contained bit.' }] }],
    });
  });

  it('marks big text as headings and splits paragraphs at large gaps', () => {
    const doc = layoutPdf(
      [page([run('Big Title', 72, 720, 20), run('Para one line.', 72, 690), run('Para two after a gap.', 72, 650), run('Still two.', 72, 635)])],
      'g.pdf',
    );
    expect('sections' in doc && doc.sections[0]?.blocks).toEqual([
      { kind: 'heading', text: 'Big Title' },
      { kind: 'paragraph', text: 'Para one line.' },
      { kind: 'paragraph', text: 'Para two after a gap. Still two.' },
    ]);
  });

  it('does not continue across a page that ends a sentence', () => {
    const doc = layoutPdf([page([run('Ends here.', 72, 700)]), page([run('New paragraph.', 72, 700)])], 'p.pdf');
    expect('sections' in doc && doc.sections.map((s) => s.blocks.length)).toEqual([1, 1]);
  });

  it('drops figure labels only when a page is full of tiny fragments', () => {
    const para = { kind: 'paragraph' as const, text: 'A full sentence of real body text here.' };
    const tiny = (text: string): { kind: 'paragraph'; text: string } => ({ kind: 'paragraph', text });
    const heading = { kind: 'heading' as const, text: 'Model' };
    const figure = [para, tiny('C T'), tiny('[CLS]'), tiny('E E'), tiny('1'), tiny('Tok N'), heading];
    expect(dropFigureLabels(figure)).toEqual([para, heading]);
    const fewShort = [para, tiny('Yes.'), tiny('No.'), para];
    expect(dropFigureLabels(fewShort)).toEqual(fewShort);
  });

  it(`refuses more than ${MAX_PAGES} pages`, () => {
    expect(layoutPdf(Array.from({ length: MAX_PAGES + 1 }, () => page([run('x', 72, 700)])), 'big.pdf')).toEqual({ error: 'too-many-pages' });
  });
});
