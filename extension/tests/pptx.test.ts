// @vitest-environment jsdom
// jsdom, not happy-dom: happy-dom's XML parser drops namespaced attributes such as r:id.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import {
  detectKind,
  fetchDocument,
  isOpenableUrl,
  MAX_BYTES,
  nameFromUrl,
  openDocument,
  originPattern,
  readerPath,
} from '@/src/docs/open';
import { MAX_SLIDES, parsePptx } from '@/src/docs/pptx';

const DIR = path.join(__dirname, 'fixtures', 'docs');
const read = (name: string): Uint8Array => new Uint8Array(readFileSync(path.join(DIR, name)));
const expected = (name: string): unknown => JSON.parse(readFileSync(path.join(DIR, name), 'utf8')) as unknown;

const P = 'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';

function deck(files: Record<string, string | Uint8Array>): Uint8Array {
  return zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, typeof v === 'string' ? strToU8(v) : v])));
}

describe('parsePptx', () => {
  it('reads the sample deck exactly as expected', () => {
    expect(parsePptx(read('sample-deck.pptx'), 'sample-deck.pptx')).toEqual(expected('sample-deck.expected.json'));
  });

  it('needs ppt/presentation.xml', () => {
    expect(parsePptx(deck({ 'other.xml': '<x/>' }), 'x.pptx')).toEqual({ error: 'unreadable' });
  });

  it('reports garbage as unreadable', () => {
    expect(parsePptx(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3]), 'x.pptx')).toEqual({ error: 'unreadable' });
    expect(parsePptx(deck({ 'ppt/presentation.xml': '<not closed' }), 'x.pptx')).toEqual({ error: 'unreadable' });
  });

  it('refuses entries that unzip too large', () => {
    const big = deck({ 'ppt/presentation.xml': `<p:presentation ${P}/>`, 'ppt/slides/slide1.xml': new Uint8Array(21 * 1024 * 1024) });
    expect(parsePptx(big, 'big.pptx')).toEqual({ error: 'too-large' });
  });

  it(`refuses decks with more than ${MAX_SLIDES} slides`, () => {
    const ids = Array.from({ length: MAX_SLIDES + 1 }, (_, i) => `<p:sldId id="${256 + i}" r:id="rId1"/>`).join('');
    const tooMany = deck({
      'ppt/presentation.xml': `<p:presentation ${P}><p:sldIdLst>${ids}</p:sldIdLst></p:presentation>`,
      'ppt/_rels/presentation.xml.rels':
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="x/slide" Target="slides/slide1.xml"/></Relationships>',
    });
    expect(parsePptx(tooMany, 'many.pptx')).toEqual({ error: 'too-many-pages' });
  });

  it('keeps a slide whose file is missing as an empty section', () => {
    const missing = deck({
      'ppt/presentation.xml': `<p:presentation ${P}><p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst></p:presentation>`,
      'ppt/_rels/presentation.xml.rels':
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="x/slide" Target="/ppt/slides/slide9.xml"/></Relationships>',
    });
    expect(parsePptx(missing, 'm.pptx')).toEqual({ kind: 'pptx', name: 'm.pptx', sections: [{ label: 'Slide 1', title: null, blocks: [] }] });
  });
});

describe('openDocument', () => {
  it.each([
    ['sample-deck.pptx', 'pptx'],
    ['one-column.pdf', 'pdf'],
    ['legacy.ppt', 'legacy-ppt'],
  ])('detects %s as %s by its content', (file, kind) => {
    expect(detectKind(read(file))).toBe(kind);
  });

  it('opens a pptx even with the wrong file name', async () => {
    const doc = await openDocument(read('sample-deck.pptx'), 'renamed.pdf');
    expect('sections' in doc && doc.sections).toHaveLength(3);
  });

  it('explains old .ppt files and unknown files', async () => {
    expect(await openDocument(read('legacy.ppt'), 'old.ppt')).toEqual({ error: 'legacy-ppt' });
    expect(await openDocument(strToU8('hello'), 'notes.txt')).toEqual({ error: 'unreadable' });
  });

  it('hands PDFs to the PDF parser', async () => {
    let called = '';
    await openDocument(read('one-column.pdf'), 'a.pdf', (_bytes, name) => {
      called = name;
      return Promise.resolve({ error: 'no-text' });
    });
    expect(called).toBe('a.pdf');
  });

  it('refuses files over the size limit', async () => {
    expect(await openDocument(new Uint8Array(MAX_BYTES + 1), 'huge.pptx')).toEqual({ error: 'too-large' });
  });
});

describe('opening from a link', () => {
  it('names the document after the URL', () => {
    expect(nameFromUrl('https://example.com/files/My%20Deck.pptx?x=1')).toBe('My Deck.pptx');
    expect(nameFromUrl('https://example.com/')).toBe('document');
  });

  it('only opens web URLs and asks for one site at a time', () => {
    expect(isOpenableUrl('https://example.com/a.pdf')).toBe(true);
    expect(isOpenableUrl('file:///Users/me/a.pdf')).toBe(false);
    expect(isOpenableUrl('javascript:alert(1)')).toBe(false);
    expect(originPattern('https://docs.example.com:8443/x/a.pdf')).toBe('https://docs.example.com:8443/*');
    expect(readerPath('https://e.com/a b.pdf')).toBe('/reader.html?src=https%3A%2F%2Fe.com%2Fa%20b.pdf');
  });

  it('downloads bytes and refuses oversized or failed downloads', async () => {
    const ok = await fetchDocument('https://e.com/d.pptx', () => Promise.resolve(new Response(new Uint8Array([1, 2, 3]))));
    expect(ok).toEqual({ bytes: new Uint8Array([1, 2, 3]), name: 'd.pptx' });
    const big = await fetchDocument('https://e.com/d.pptx', () =>
      Promise.resolve(new Response('x', { headers: { 'content-length': String(MAX_BYTES + 1) } })),
    );
    expect(big).toEqual({ error: 'too-large' });
    expect(await fetchDocument('https://e.com/d', () => Promise.resolve(new Response('', { status: 404 })))).toEqual({ error: 'unreadable' });
    expect(await fetchDocument('https://e.com/d', () => Promise.reject(new TypeError('offline')))).toEqual({ error: 'unreadable' });
  });
});
