import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { unzipSync, strFromU8 } from 'fflate';
import { describe, expect, it } from 'vitest';
import { docText, isDoc } from '@/src/docs/doc';

const DIR = path.join(__dirname, 'fixtures', 'docs');
const read = (name: string): Uint8Array => new Uint8Array(readFileSync(path.join(DIR, name)));
const expected = (name: string): unknown => JSON.parse(readFileSync(path.join(DIR, name), 'utf8')) as unknown;

describe('document fixtures', () => {
  it('every document has an expected-output file', () => {
    const files = readdirSync(DIR);
    const docs = files.filter((f) => /\.(pdf|pptx|ppt)$/.test(f));
    expect(docs.sort()).toEqual(['legacy.ppt', 'no-text.pdf', 'one-column.pdf', 'sample-deck.pptx', 'two-column.pdf']);
    for (const doc of docs) {
      expect(files, doc).toContain(doc.replace(/\.(pdf|pptx|ppt)$/, '.expected.json'));
    }
  });

  it.each(['one-column', 'two-column', 'sample-deck'])('%s.expected.json is a valid Doc', (name) => {
    const doc = expected(`${name}.expected.json`);
    expect(isDoc(doc)).toBe(true);
    if (isDoc(doc)) expect(docText(doc).length).toBeGreaterThan(20);
  });

  it.each([
    ['no-text', 'no-text'],
    ['legacy', 'legacy-ppt'],
  ])('%s.expected.json is the %s error', (name, error) => {
    expect(expected(`${name}.expected.json`)).toEqual({ error });
  });

  it('PDFs are well-formed enough to have a header, xref and trailer', () => {
    for (const name of ['one-column.pdf', 'two-column.pdf', 'no-text.pdf']) {
      const text = new TextDecoder('latin1').decode(read(name));
      expect(text.startsWith('%PDF-1.4'), name).toBe(true);
      expect(text, name).toContain('xref');
      expect(text.trimEnd().endsWith('%%EOF'), name).toBe(true);
    }
  });

  it('the deck stores slides out of display order and has notes', () => {
    const files = unzipSync(read('sample-deck.pptx'));
    expect(Object.keys(files)).toEqual(
      expect.arrayContaining(['ppt/presentation.xml', 'ppt/slides/slide1.xml', 'ppt/notesSlides/notesSlide1.xml']),
    );
    const presentation = strFromU8(files['ppt/presentation.xml'] ?? new Uint8Array());
    expect(presentation.indexOf('r:id="rId2"')).toBeLessThan(presentation.indexOf('r:id="rId1"'));
  });

  it('legacy.ppt starts with the old binary (OLE) signature', () => {
    expect([...read('legacy.ppt').slice(0, 4)]).toEqual([0xd0, 0xcf, 0x11, 0xe0]);
  });
});
