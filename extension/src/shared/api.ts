/** Shapes of the server's /simplify response, plus a runtime check (we never trust the network). */

export type OriginalSentence = { id: number; text: string };
export type SimplifiedSentence = { text: string; sourceIds: number[] };
export type GlossaryEntry = { term: string; definition: string };

export type SimplifyResponse = {
  original: OriginalSentence[];
  simplified: SimplifiedSentence[];
  tldr: string;
  glossary: GlossaryEntry[];
  readability: { before: number; after: number };
  cached: boolean;
  warnings: string[];
};

export type SimplifyResult = { ok: true; data: SimplifyResponse } | { ok: false; error: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isArrayOf<T>(value: unknown, guard: (item: unknown) => item is T): value is T[] {
  return Array.isArray(value) && value.every(guard);
}

const isString = (v: unknown): v is string => typeof v === 'string';
const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

const isOriginal = (v: unknown): v is OriginalSentence =>
  isRecord(v) && isNumber(v.id) && isString(v.text);

const isSimplified = (v: unknown): v is SimplifiedSentence =>
  isRecord(v) && isString(v.text) && isArrayOf(v.sourceIds, isNumber);

const isGlossary = (v: unknown): v is GlossaryEntry =>
  isRecord(v) && isString(v.term) && isString(v.definition);

export function parseSimplifyResponse(value: unknown): SimplifyResponse | null {
  if (!isRecord(value)) return null;
  const { original, simplified, tldr, glossary, readability, cached, warnings } = value;
  if (
    isArrayOf(original, isOriginal) &&
    isArrayOf(simplified, isSimplified) &&
    isString(tldr) &&
    isArrayOf(glossary, isGlossary) &&
    isRecord(readability) &&
    isNumber(readability.before) &&
    isNumber(readability.after) &&
    typeof cached === 'boolean' &&
    isArrayOf(warnings, isString)
  ) {
    return {
      original,
      simplified,
      tldr,
      glossary,
      readability: { before: readability.before, after: readability.after },
      cached,
      warnings,
    };
  }
  return null;
}

export function parseSimplifyResult(value: unknown): SimplifyResult | null {
  if (!isRecord(value)) return null;
  if (value.ok === false && isString(value.error)) return { ok: false, error: value.error };
  if (value.ok === true) {
    const data = parseSimplifyResponse(value.data);
    return data ? { ok: true, data } : null;
  }
  return null;
}
