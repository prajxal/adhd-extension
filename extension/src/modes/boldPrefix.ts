export type Segment = { text: string; bold: boolean };

/** Letters only, so numbers and symbols are never touched. */
const WORD_RE = /\p{L}[\p{L}\p{M}'’-]*/gu;
const MARK_RE = /^\p{M}$/u;

/** How many characters of an n-character word get bolded. */
export function boldLength(n: number, intensity: number): number {
  if (n <= 0) return 0;
  return n <= 3 ? 1 : Math.min(n - 1, Math.ceil(n * intensity));
}

/**
 * Splits a word into user-perceived characters: a base code point plus any
 * combining marks after it, so "é" written as "é" counts (and bolds) as one.
 */
function clusters(word: string): string[] {
  const out: string[] = [];
  for (const ch of word) {
    const last = out.length - 1;
    if (MARK_RE.test(ch) && last >= 0) {
      out[last] = (out[last] ?? '') + ch;
    } else {
      out.push(ch);
    }
  }
  return out;
}

/** Pure: splits text into bold/plain segments. Joining every segment's text gives back `text`. */
export function boldPrefix(text: string, intensity: number): Segment[] {
  const segments: Segment[] = [];
  const push = (part: string, bold: boolean): void => {
    if (part === '') return;
    const last = segments[segments.length - 1];
    if (last?.bold === bold) {
      last.text += part;
    } else {
      segments.push({ text: part, bold });
    }
  };

  let cursor = 0;
  for (const match of text.matchAll(WORD_RE)) {
    const word = match[0];
    const start = match.index;
    push(text.slice(cursor, start), false);
    const chars = clusters(word);
    const k = boldLength(chars.length, intensity);
    push(chars.slice(0, k).join(''), true);
    push(chars.slice(k).join(''), false);
    cursor = start + word.length;
  }
  push(text.slice(cursor), false);
  return segments;
}
