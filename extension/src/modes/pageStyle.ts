/** Adds (or replaces) one of our <style> elements in the page. Removable by id. */
export function addPageStyle(id: string, css: string, doc: Document = document): void {
  let style = doc.getElementById(id);
  if (!(style instanceof HTMLStyleElement)) {
    style = doc.createElement('style');
    style.id = id;
    style.dataset.rw = 'style';
    // `doc.head` is typed non-null but can be missing (e.g. some XML/SVG documents).
    (doc.querySelector('head') ?? doc.documentElement).append(style);
  }
  style.textContent = css;
}

export function removePageStyle(id: string, doc: Document = document): void {
  doc.getElementById(id)?.remove();
}
