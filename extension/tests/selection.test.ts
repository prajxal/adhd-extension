import { beforeEach, describe, expect, it } from 'vitest';
import { placeNear } from '@/src/ui/position';
import { anchorMoved, normalisedLength, readSelection } from '@/src/ui/selection';

const LONG_ENOUGH = 'This sentence is comfortably longer than twenty characters.';

function selectContents(node: Node): Selection {
  const selection = window.getSelection();
  if (!selection) throw new Error('no selection support');
  const range = document.createRange();
  range.selectNodeContents(node);
  selection.removeAllRanges();
  selection.addRange(range);
  return selection;
}

describe('readSelection', () => {
  beforeEach(() => {
    window.getSelection()?.removeAllRanges();
    document.body.innerHTML = `
      <p id="ok">${LONG_ENOUGH}</p>
      <p id="short">Too short.</p>
      <p id="long">${'word '.repeat(700)}</p>
      <div contenteditable="true"><p id="editable">${LONG_ENOUGH}</p></div>
      <readwell-root data-rw-host><p id="ours">${LONG_ENOUGH}</p></readwell-root>
    `;
  });

  const el = (id: string): HTMLElement => {
    const found = document.getElementById(id);
    if (!found) throw new Error(id);
    return found;
  };

  it('accepts a normal 20–3000 character selection', () => {
    const info = readSelection(selectContents(el('ok')));
    expect(info?.status).toBe('ok');
    expect(info?.status === 'ok' ? info.text : '').toBe(LONG_ENOUGH);
  });

  it('ignores short selections and empty selections', () => {
    expect(readSelection(selectContents(el('short')))).toBeNull();
    expect(readSelection(null)).toBeNull();
  });

  it('flags selections over 3000 characters', () => {
    expect(readSelection(selectContents(el('long')))?.status).toBe('too-long');
  });

  it('ignores editable areas and our own UI', () => {
    expect(readSelection(selectContents(el('editable')))).toBeNull();
    expect(readSelection(selectContents(el('ours')))).toBeNull();
  });

  it('treats sub-pixel jitter as not moved', () => {
    const a = { x: 100, top: 50, bottom: 70 };
    expect(anchorMoved(a, { x: 101, top: 51, bottom: 71 })).toBe(false);
    expect(anchorMoved(a, { x: 100, top: 20, bottom: 40 })).toBe(true);
  });

  it('counts length after collapsing whitespace', () => {
    expect(normalisedLength('  a   b\n\n c  ')).toBe(5);
  });
});

describe('placeNear', () => {
  const viewport = { width: 1000, height: 800 };
  const size = { width: 420, height: 300 };

  it('goes below the selection when there is room', () => {
    expect(placeNear({ x: 500, top: 100, bottom: 120 }, size, viewport)).toEqual({ left: 476, top: 128 });
  });

  it('goes above when there is no room below', () => {
    expect(placeNear({ x: 500, top: 700, bottom: 720 }, size, viewport).top).toBe(392);
  });

  it('stays inside the viewport horizontally', () => {
    expect(placeNear({ x: 990, top: 100, bottom: 120 }, size, viewport).left).toBe(572);
    expect(placeNear({ x: 0, top: 100, bottom: 120 }, size, viewport).left).toBe(8);
  });
});
