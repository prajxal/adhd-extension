import { addPageStyle, removePageStyle } from './pageStyle';

export const SPACING_STYLE_ID = 'rw-spacing';

// The only stylesheet where !important is allowed (per spec).
const SPACING_CSS = `
p, li, dd, blockquote, td {
  line-height: 1.8 !important;
  word-spacing: 0.16em !important;
  letter-spacing: 0.03em !important;
}`;

export function enableSpacing(doc: Document = document): void {
  addPageStyle(SPACING_STYLE_ID, SPACING_CSS, doc);
}

export function disableSpacing(doc: Document = document): void {
  removePageStyle(SPACING_STYLE_ID, doc);
}
