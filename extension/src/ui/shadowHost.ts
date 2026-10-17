/**
 * One shadow host for all UI we inject into pages (ruler, Simplify button, result card).
 * A custom tag name keeps page selectors like `div { … }` from matching it, and the
 * shadow root keeps page CSS out and our CSS in.
 */
export const HOST_TAG = 'readwell-root';
export const HOST_ATTR = 'data-rw-host';

let host: HTMLElement | null = null;
let root: ShadowRoot | null = null;

export function getShadowRoot(doc: Document = document): ShadowRoot {
  if (host?.isConnected && root) return root;
  host = doc.createElement(HOST_TAG);
  host.setAttribute(HOST_ATTR, '');
  // Inline styles beat page rules that don't use !important; the tag name avoids most selectors.
  host.style.cssText =
    'all: initial; position: fixed; inset: 0; pointer-events: none; z-index: 2147483647;';
  root = host.attachShadow({ mode: 'open' });
  doc.documentElement.append(host);
  return root;
}

/** Returns the layer element with this id inside the shadow root, creating it if needed. */
export function getLayer(id: string, css: string, doc: Document = document): HTMLElement {
  const shadow = getShadowRoot(doc);
  const existing = shadow.getElementById(id);
  if (existing) return existing;
  const style = doc.createElement('style');
  style.dataset.for = id;
  style.textContent = css;
  const layer = doc.createElement('div');
  layer.id = id;
  shadow.append(style, layer);
  return layer;
}

export function removeLayer(id: string): void {
  if (!root) return;
  root.getElementById(id)?.remove();
  root.querySelector(`style[data-for="${id}"]`)?.remove();
  if (root.childElementCount === 0) {
    host?.remove();
    host = null;
    root = null;
  }
}

export function isInsideShadowHost(node: Node): boolean {
  return host !== null && (node === host || host.contains(node));
}
