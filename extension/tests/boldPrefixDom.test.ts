import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BoldPrefixController } from '@/src/modes/boldPrefixDom';

const PAGE = `
  <h1>Readable headings matter</h1>
  <p id="p1">Long sentences can be <a href="#">difficult</a> to follow, she said.</p>
  <p>In 2024, prices rose 4.5% — <em>naïve café</em> owners didn't notice.</p>
  <ul><li>First item</li><li>   </li></ul>
  <pre>const keep = "untouched";</pre>
  <p>Inline <code>codeSample</code> stays plain.</p>
  <textarea id="ta">editable textarea text</textarea>
  <input id="in" value="input value text" />
  <div contenteditable="true" id="ce"><p>Editor paragraph text</p></div>
  <script>var scriptText = "no";</script>
  <svg><text>svg text label</text></svg>
  <kbd>Ctrl</kbd> <samp>sample output</samp>
`;

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('BoldPrefixController', () => {
  let controller: BoldPrefixController;

  beforeEach(() => {
    document.head.innerHTML = '';
    document.body.innerHTML = PAGE;
    controller = new BoldPrefixController(document);
  });

  afterEach(async () => {
    await controller.disable();
  });

  it('wraps prose words with bold prefixes', async () => {
    await controller.enable(0.45);
    const p1 = document.getElementById('p1');
    expect(p1?.querySelector('span[data-rw="bp"] b.rw-b[data-rw="b"]')?.textContent).toBe('Lo');
    expect(p1?.textContent).toBe('Long sentences can be difficult to follow, she said.');
    expect(document.querySelectorAll('b[data-rw="b"]').length).toBeGreaterThan(10);
    expect(document.getElementById('rw-bold')).not.toBeNull();
  });

  it('never touches code, editors, inputs, scripts or svg', async () => {
    await controller.enable(0.45);
    for (const selector of ['pre', 'code', 'textarea', '#ce', 'script', 'svg', 'kbd', 'samp']) {
      const el = document.querySelector(selector);
      expect(el, selector).not.toBeNull();
      expect(el?.querySelector('[data-rw]'), selector).toBeNull();
    }
    expect((document.getElementById('ta') as HTMLTextAreaElement).value).toBe('editable textarea text');
    expect((document.getElementById('in') as HTMLInputElement).value).toBe('input value text');
  });

  it('restores the exact original DOM and text nodes when turned off', async () => {
    const beforeHtml = document.body.innerHTML;
    const beforeText = document.body.textContent;
    const firstText = document.getElementById('p1')?.firstChild;

    await controller.enable(0.45);
    expect(document.body.innerHTML).not.toBe(beforeHtml);

    await controller.disable();
    expect(document.body.innerHTML).toBe(beforeHtml);
    expect(document.body.textContent).toBe(beforeText);
    expect(document.getElementById('p1')?.firstChild).toBe(firstText); // same node, not a copy
    expect(document.getElementById('rw-bold')).toBeNull();
  });

  it('survives repeated on/off and intensity changes', async () => {
    const beforeHtml = document.body.innerHTML;
    await controller.enable(0.3);
    await controller.restart(0.6);
    await controller.disable();
    await controller.enable(0.45);
    await controller.disable();
    expect(document.body.innerHTML).toBe(beforeHtml);
  });

  it('processes content added after it was turned on', async () => {
    await controller.enable(0.45);
    const added = document.createElement('p');
    added.id = 'late';
    added.textContent = 'Freshly loaded paragraph';
    document.body.append(added);

    await wait(350); // 300ms debounce
    await controller.whenIdle();
    expect(document.querySelector('#late b[data-rw="b"]')?.textContent).toBe('Fres');
  });

  it('ignores added nodes inside skipped areas', async () => {
    await controller.enable(0.45);
    const code = document.createElement('code');
    code.textContent = 'notProcessed';
    document.body.append(code);
    await wait(350);
    await controller.whenIdle();
    expect(code.querySelector('[data-rw]')).toBeNull();
  });

  it('can be limited to one part of the page', async () => {
    const limited = new BoldPrefixController(document, document.getElementById('p1') ?? undefined);
    await limited.enable(0.45);
    expect(document.querySelector('#p1 b[data-rw="b"]')).not.toBeNull();
    expect(document.querySelector('h1 [data-rw]')).toBeNull();
    await limited.disable();
    expect(document.querySelector('[data-rw]')).toBeNull();
  });

  it('keeps text the page changed while bold-prefix was on', async () => {
    await controller.enable(0.45);
    const li = document.querySelector('li');
    const span = li?.querySelector('span[data-rw="bp"]');
    const b = span?.querySelector('b');
    if (!b) throw new Error('expected a wrapped list item');
    b.textContent = 'Fi'; // page edits text inside our wrapper
    await controller.disable();
    expect(li?.textContent).toBe('First item'.replace('Fir', 'Fi'));
    expect(li?.querySelector('[data-rw]')).toBeNull();
  });
});
