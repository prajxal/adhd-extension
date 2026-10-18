// Writes the Phase 3 document fixtures into tests/fixtures/docs/.
// Run from /extension: node scripts/make-doc-fixtures.mjs
//
// PDFs are written by hand (Helvetica text at exact positions) so every heading, hyphen,
// header/footer and column is known. The PPTX is a minimal deck built with fflate; it
// contains just the parts Readwell reads (no masters/themes).

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { strToU8, zipSync } from 'fflate';

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'tests', 'fixtures', 'docs');
mkdirSync(OUT, { recursive: true });

const write = (name, data) => {
  writeFileSync(path.join(OUT, name), data);
  console.log('wrote', name);
};
const writeJson = (name, value) => write(name, `${JSON.stringify(value, null, 2)}\n`);

// ---------------------------------------------------------------- PDF

const esc = (s) => s.replace(/[\\()]/g, (c) => `\\${c}`);

/** One text line: Helvetica at `size` pt, baseline at (x, y). */
const text = (x, y, size, s) => `BT /F1 ${size} Tf ${x} ${y} Td (${esc(s)}) Tj ET`;

/** Builds a PDF from page content streams (US Letter, 612 x 792 pt). */
function pdf(pageContents) {
  const objects = [];
  const add = (body) => objects.push(body) && objects.length;
  const catalog = add(null);
  const pages = add(null);
  const font = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  const kids = [];
  for (const content of pageContents) {
    const stream = content.join('\n');
    const contentId = add(`<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`);
    kids.push(
      add(
        `<< /Type /Page /Parent ${pages} 0 R /MediaBox [0 0 612 792] ` +
          `/Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${contentId} 0 R >>`,
      ),
    );
  }
  objects[catalog - 1] = `<< /Type /Catalog /Pages ${pages} 0 R >>`;
  objects[pages - 1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`;

  let out = '%PDF-1.4\n';
  const offsets = [];
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(out, 'latin1'));
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out, 'latin1');
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  out += offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('');
  out += `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

const HEADER = (s) => text(72, 760, 9, s);
const FOOTER = (n) => text(300, 40, 9, String(n));

write(
  'one-column.pdf',
  pdf([
    [
      HEADER('Readwell test document'),
      text(72, 700, 18, 'Reading on Screens'),
      text(72, 670, 11, 'People read differently on screens than on paper. Most readers scan the'),
      text(72, 655, 11, 'page instead of reading every word, which makes long sentences harder to under-'),
      text(72, 640, 11, 'stand and remember.'),
      text(72, 605, 11, 'Short paragraphs, clear headings and plain words all help. This paragraph'),
      text(72, 590, 11, 'continues on the next page without a full stop at the end of this line, so'),
      FOOTER(1),
    ],
    [
      HEADER('Readwell test document'),
      text(72, 700, 11, 'it should be joined with the text from the previous page.'),
      text(72, 660, 18, 'Notes'),
      text(72, 630, 11, 'Page numbers and the running header should not appear in the reading view.'),
      FOOTER(2),
    ],
  ]),
);
writeJson('one-column.expected.json', {
  kind: 'pdf',
  name: 'one-column.pdf',
  sections: [
    {
      label: 'Page 1',
      title: null,
      blocks: [
        { kind: 'heading', text: 'Reading on Screens' },
        {
          kind: 'paragraph',
          text:
            'People read differently on screens than on paper. Most readers scan the page instead of ' +
            'reading every word, which makes long sentences harder to understand and remember.',
        },
        {
          kind: 'paragraph',
          text:
            'Short paragraphs, clear headings and plain words all help. This paragraph continues on the ' +
            'next page without a full stop at the end of this line, so it should be joined with the text ' +
            'from the previous page.',
        },
      ],
    },
    {
      label: 'Page 2',
      title: null,
      blocks: [
        { kind: 'heading', text: 'Notes' },
        {
          kind: 'paragraph',
          text: 'Page numbers and the running header should not appear in the reading view.',
        },
      ],
    },
  ],
});

write(
  'two-column.pdf',
  pdf([
    [
      text(72, 720, 18, 'Two Column Layout'),
      text(72, 680, 11, 'The left column starts here and keeps'),
      text(320, 680, 11, 'The right column is read after the'),
      text(72, 665, 11, 'going for a few lines before it ends'),
      text(320, 665, 11, 'left one, even though its lines sit'),
      text(72, 650, 11, 'at the bottom of the column.'),
      text(320, 650, 11, 'level with the left column lines.'),
    ],
  ]),
);
writeJson('two-column.expected.json', {
  kind: 'pdf',
  name: 'two-column.pdf',
  sections: [
    {
      label: 'Page 1',
      title: null,
      blocks: [
        { kind: 'heading', text: 'Two Column Layout' },
        {
          kind: 'paragraph',
          text: 'The left column starts here and keeps going for a few lines before it ends at the bottom of the column.',
        },
        {
          kind: 'paragraph',
          text: 'The right column is read after the left one, even though its lines sit level with the left column lines.',
        },
      ],
    },
  ],
});

write('no-text.pdf', pdf([['0 0 1 rg 100 100 200 200 re f']]));
writeJson('no-text.expected.json', { error: 'no-text' });

// ---------------------------------------------------------------- PPTX

const NS =
  'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
  'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ' +
  'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const xml = (body) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n${body}`;
const escXml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

let shapeId = 2;
const runs = (parts) => parts.map((t) => (t === '\n' ? '<a:br/>' : `<a:r><a:t>${escXml(t)}</a:t></a:r>`)).join('');
/** A paragraph: string, or { runs: [...], lvl, bullet: 'char'|'none' }. */
const para = (p) => {
  const spec = typeof p === 'string' ? { runs: [p] } : p;
  const pPr =
    spec.lvl !== undefined || spec.bullet
      ? `<a:pPr${spec.lvl !== undefined ? ` lvl="${spec.lvl}"` : ''}>${
          spec.bullet === 'char' ? '<a:buChar char="&#8226;"/>' : spec.bullet === 'none' ? '<a:buNone/>' : ''
        }</a:pPr>`
      : '';
  return `<a:p>${pPr}${runs(spec.runs)}</a:p>`;
};
const shape = (paragraphs, ph = '') =>
  `<p:sp><p:nvSpPr><p:cNvPr id="${shapeId++}" name="Shape"/><p:cNvSpPr/><p:nvPr>${ph}</p:nvPr></p:nvSpPr>` +
  `<p:spPr/><p:txBody><a:bodyPr/>${paragraphs.map(para).join('')}</p:txBody></p:sp>`;
const emptyShape = () =>
  `<p:sp><p:nvSpPr><p:cNvPr id="${shapeId++}" name="Picture frame"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr/></p:sp>`;
const group = (inner) =>
  `<p:grpSp><p:nvGrpSpPr><p:cNvPr id="${shapeId++}" name="Group"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>${inner}</p:grpSp>`;
const table = (rows) =>
  `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="${shapeId++}" name="Table"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr>` +
  '<p:xfrm/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table"><a:tbl>' +
  rows
    .map(
      (r) =>
        `<a:tr h="370840">${r.map((c) => `<a:tc><a:txBody><a:bodyPr/>${para(c)}</a:txBody></a:tc>`).join('')}</a:tr>`,
    )
    .join('') +
  '</a:tbl></a:graphicData></a:graphic></p:graphicFrame>';
const slide = (shapes) =>
  xml(
    `<p:sld ${NS}><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>` +
      `<p:grpSpPr/>${shapes.join('')}</p:spTree></p:cSld></p:sld>`,
  );
const TITLE = '<p:ph type="title"/>';
const BODY = '<p:ph idx="1"/>';

// Stored as slide1/2/3.xml but shown in the order slide2, slide1, slide3.
const slideWhy = slide([
  shape(['Why plain language matters'], TITLE),
  shape(
    [
      { runs: ['Long sentences are ', 'hard to follow'] },
      { runs: ['Especially for readers with ADHD'], lvl: 1 },
      { runs: [''] },
      'Short sentences help everyone',
    ],
    BODY,
  ),
]);
const slideSurvey = slide([
  shape(['Survey results'], TITLE),
  table([
    ['Group', 'Preferred plain text'],
    ['Adults', '72%'],
    ['Teens', '81%'],
  ]),
  shape(['Source: Readwell reader survey, 2023.']),
]);
const slideNext = slide([
  group(shape(['Next steps']) + shape([{ runs: ['Try the reader', '\n', 'on your own slides.'] }])),
  emptyShape(),
  shape([
    { runs: ['Open a .pptx file'], bullet: 'char' },
    { runs: ['Turn on Bold-prefix'], bullet: 'char' },
  ]),
]);
const notesWhy = xml(
  `<p:notes ${NS}><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>` +
    `<p:sp><p:nvSpPr><p:cNvPr id="2" name="Slide Image"/><p:cNvSpPr/><p:nvPr><p:ph type="sldImg"/></p:nvPr></p:nvSpPr><p:spPr/></p:sp>` +
    shape(['Mention the 2023 survey results.'], '<p:ph type="body" idx="1"/>') +
    shape(['1'], '<p:ph type="sldNum" idx="5"/>') +
    '</p:spTree></p:cSld></p:notes>',
);

const pptxFiles = {
  '[Content_Types].xml': xml(
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>' +
      [1, 2, 3]
        .map(
          (n) =>
            `<Override PartName="/ppt/slides/slide${n}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`,
        )
        .join('') +
      '<Override PartName="/ppt/notesSlides/notesSlide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.notesSlide+xml"/>' +
      '</Types>',
  ),
  '_rels/.rels': xml(
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      `<Relationship Id="rId1" Type="${REL}/officeDocument" Target="ppt/presentation.xml"/></Relationships>`,
  ),
  'ppt/presentation.xml': xml(
    `<p:presentation ${NS}><p:sldIdLst>` +
      '<p:sldId id="256" r:id="rId2"/><p:sldId id="257" r:id="rId1"/><p:sldId id="258" r:id="rId3"/>' +
      '</p:sldIdLst><p:sldSz cx="9144000" cy="6858000"/></p:presentation>',
  ),
  'ppt/_rels/presentation.xml.rels': xml(
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      [1, 2, 3].map((n) => `<Relationship Id="rId${n}" Type="${REL}/slide" Target="slides/slide${n}.xml"/>`).join('') +
      '</Relationships>',
  ),
  'ppt/slides/slide1.xml': slideSurvey,
  'ppt/slides/slide2.xml': slideWhy,
  'ppt/slides/slide3.xml': slideNext,
  'ppt/slides/_rels/slide2.xml.rels': xml(
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      `<Relationship Id="rId1" Type="${REL}/notesSlide" Target="../notesSlides/notesSlide1.xml"/></Relationships>`,
  ),
  'ppt/notesSlides/notesSlide1.xml': notesWhy,
};
write(
  'sample-deck.pptx',
  zipSync(Object.fromEntries(Object.entries(pptxFiles).map(([k, v]) => [k, strToU8(v)])), { mtime: new Date('2026-01-01T00:00:00Z') }),
);
writeJson('sample-deck.expected.json', {
  kind: 'pptx',
  name: 'sample-deck.pptx',
  sections: [
    {
      label: 'Slide 1',
      title: 'Why plain language matters',
      blocks: [
        {
          kind: 'list',
          items: [
            { text: 'Long sentences are hard to follow', level: 0 },
            { text: 'Especially for readers with ADHD', level: 1 },
            { text: 'Short sentences help everyone', level: 0 },
          ],
        },
        { kind: 'notes', paragraphs: ['Mention the 2023 survey results.'] },
      ],
    },
    {
      label: 'Slide 2',
      title: 'Survey results',
      blocks: [
        {
          kind: 'table',
          rows: [
            ['Group', 'Preferred plain text'],
            ['Adults', '72%'],
            ['Teens', '81%'],
          ],
        },
        { kind: 'paragraph', text: 'Source: Readwell reader survey, 2023.' },
      ],
    },
    {
      label: 'Slide 3',
      title: null,
      blocks: [
        { kind: 'paragraph', text: 'Next steps' },
        { kind: 'paragraph', text: 'Try the reader on your own slides.' },
        {
          kind: 'list',
          items: [
            { text: 'Open a .pptx file', level: 0 },
            { text: 'Turn on Bold-prefix', level: 0 },
          ],
        },
      ],
    },
  ],
});

// Old binary PowerPoint: just the OLE compound-file signature, enough to recognise it.
write('legacy.ppt', Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, ...new Array(504).fill(0)]));
writeJson('legacy.expected.json', { error: 'legacy-ppt' });
