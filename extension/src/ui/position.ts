import type { Anchor } from './selection';

export const MARGIN = 8;

/**
 * Places a box of `size` near the end of the selection: below it if there is room,
 * otherwise above, always kept inside the viewport.
 */
export function placeNear(
  anchor: Anchor,
  size: { width: number; height: number },
  viewport: { width: number; height: number },
  gap = 8,
): { left: number; top: number } {
  const maxLeft = Math.max(MARGIN, viewport.width - size.width - MARGIN);
  const left = Math.min(Math.max(anchor.x - 24, MARGIN), maxLeft);

  const below = anchor.bottom + gap;
  const above = anchor.top - gap - size.height;
  let top: number;
  if (below + size.height <= viewport.height - MARGIN) top = below;
  else if (above >= MARGIN) top = above;
  else top = Math.max(MARGIN, viewport.height - size.height - MARGIN);
  return { left, top };
}
