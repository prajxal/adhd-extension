import { readFileSync } from 'node:fs';
import path from 'node:path';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { isDoc, type Doc } from '@/src/docs/doc';
import { DocView, nestItems } from '@/src/docs/DocView';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const deck: unknown = JSON.parse(
  readFileSync(path.join(__dirname, 'fixtures', 'docs', 'sample-deck.expected.json'), 'utf8'),
);
if (!isDoc(deck)) throw new Error('fixture is not a Doc');
const DECK: Doc = deck;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
});

function render(doc: Doc): void {
  act(() => {
    root.render(<DocView doc={doc} />);
  });
}

describe('nestItems', () => {
  it('nests deeper levels under the previous item', () => {
    expect(
      nestItems([
        { text: 'a', level: 0 },
        { text: 'a1', level: 1 },
        { text: 'a1x', level: 2 },
        { text: 'b', level: 0 },
        { text: 'skips', level: 2 },
      ]),
    ).toEqual([
      { text: 'a', children: [{ text: 'a1', children: [{ text: 'a1x', children: [] }] }] },
      { text: 'b', children: [{ text: 'skips', children: [] }] },
    ]);
  });
});

describe('DocView', () => {
  it('gives each slide a labelled section with a real heading', () => {
    render(DECK);
    expect(container.querySelector('h1')?.textContent).toBe('sample-deck.pptx');
    const sections = [...container.querySelectorAll('section')];
    expect(sections).toHaveLength(3);
    expect(sections[0]?.querySelector('h2')?.textContent).toBe('Slide 1Why plain language matters');
    expect(sections[0]?.getAttribute('aria-labelledby')).toBe(sections[0]?.querySelector('h2')?.id);
    expect(sections[2]?.querySelector('h2')?.textContent).toBe('Slide 3'); // no title
  });

  it('renders nested bullets, a table with a header row, and collapsible notes', () => {
    render(DECK);
    const nested = container.querySelector('section ul > li > ul > li');
    expect(nested?.textContent).toBe('Especially for readers with ADHD');
    expect([...container.querySelectorAll('th')].map((th) => th.textContent)).toEqual(['Group', 'Preferred plain text']);
    expect(container.querySelectorAll('tbody tr')).toHaveLength(2);
    const notes = container.querySelector('details.rw-notes');
    expect(notes?.querySelector('summary')?.textContent).toBe('Speaker notes');
    expect(notes?.textContent).toContain('Mention the 2023 survey results.');
  });

  it('says when a slide or page has no text', () => {
    render({ kind: 'pdf', name: 'scan.pdf', sections: [{ label: 'Page 1', title: null, blocks: [] }] });
    expect(container.querySelector('.rw-empty-section')?.textContent).toBe('No text on this page.');
  });

  it('renders text as text, never as markup', () => {
    render({
      kind: 'pptx',
      name: '<img src=x onerror=alert(1)>.pptx',
      sections: [{ label: 'Slide 1', title: '<b>t</b>', blocks: [{ kind: 'paragraph', text: '<script>x</script>' }] }],
    });
    expect(container.querySelector('img, b, script')).toBeNull();
    expect(container.querySelector('p')?.textContent).toBe('<script>x</script>');
  });
});
