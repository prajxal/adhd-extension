import { HOST_ATTR } from './shadowHost';

export const MIN_SELECTION_CHARS = 20;
export const MAX_SELECTION_CHARS = 3000;
export const TOO_LONG_MESSAGE = 'Select a shorter passage (max ~3000 characters)';

/** Viewport position of the end of the selection, used to place our UI. */
export type Anchor = { x: number; top: number; bottom: number };

export type SelectionInfo =
  | { status: 'ok'; text: string; anchor: Anchor }
  | { status: 'too-long'; anchor: Anchor };

const EDITABLE_SELECTOR = 'input, textarea, select, [contenteditable]:not([contenteditable="false"])';

function isEditable(node: Node | null): boolean {
  const el = node instanceof Element ? node : (node?.parentElement ?? null);
  if (!el) return false;
  return (el instanceof HTMLElement && el.isContentEditable) || el.closest(EDITABLE_SELECTOR) !== null;
}

function isInsideOurUi(node: Node | null): boolean {
  const el = node instanceof Element ? node : (node?.parentElement ?? null);
  return el?.closest(`[${HOST_ATTR}]`) != null;
}

/** True if the selection end moved on screen (by more than a couple of pixels). */
export function anchorMoved(a: Anchor, b: Anchor): boolean {
  return Math.abs(a.x - b.x) > 2 || Math.abs(a.top - b.top) > 2;
}

export function normalisedLength(text: string): number {
  return text.split(/\s+/).filter(Boolean).join(' ').length;
}

function anchorFor(range: Range): Anchor {
  const rects = range.getClientRects();
  const last = rects.length > 0 ? rects[rects.length - 1] : undefined;
  const rect = last ?? range.getBoundingClientRect();
  return { x: rect.right, top: rect.top, bottom: rect.bottom };
}

/** Decides whether the current selection can be simplified. Null means "show nothing". */
export function readSelection(selection: Selection | null, doc: Document = document): SelectionInfo | null {
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null;
  const active = doc.activeElement;
  if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) return null;
  if (isEditable(selection.anchorNode) || isEditable(selection.focusNode)) return null;
  if (isInsideOurUi(selection.anchorNode)) return null;

  const text = selection.toString();
  const length = normalisedLength(text);
  if (length < MIN_SELECTION_CHARS) return null;

  const anchor = anchorFor(selection.getRangeAt(selection.rangeCount - 1));
  if (length > MAX_SELECTION_CHARS) return { status: 'too-long', anchor };
  return { status: 'ok', text: text.trim(), anchor };
}
