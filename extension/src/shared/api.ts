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

export type CheckStatus = 'ok' | 'check' | 'problem';
/** An accepted auto-repair: `text` replaced `previous`, fixing the `fixed` reasons. */
export type Repair = { text: string; previous: string; fixed: string[] };

export type CheckSentence = {
  index: number;
  status: CheckStatus;
  reasons: string[];
  repair: Repair | null;
};

export type CheckResponse = {
  sentences: CheckSentence[];
  summary: { ok: number; check: number; problem: number; repaired: number };
  judge: 'llm' | 'rules';
  cached: boolean;
};

/** `off` means the server has the meaning check turned off: hide the check UI entirely. */
export type CheckResult =
  | { ok: true; data: CheckResponse }
  | { ok: false; reason: 'off' | 'unavailable' };

const isStatus = (v: unknown): v is CheckStatus => v === 'ok' || v === 'check' || v === 'problem';

const isRepair = (v: unknown): v is Repair =>
  isRecord(v) && isString(v.text) && isString(v.previous) && isArrayOf(v.fixed, isString);

/** Older servers send no `repair` field; treat that the same as `null`. */
function parseCheckSentence(v: unknown): CheckSentence | null {
  if (!isRecord(v) || !isNumber(v.index) || !isStatus(v.status) || !isArrayOf(v.reasons, isString)) {
    return null;
  }
  const repair = v.repair ?? null;
  if (repair !== null && !isRepair(repair)) return null;
  return { index: v.index, status: v.status, reasons: v.reasons, repair };
}

export function parseCheckResponse(value: unknown): CheckResponse | null {
  if (!isRecord(value)) return null;
  const { sentences, summary, judge, cached } = value;
  if (
    !Array.isArray(sentences) ||
    !isRecord(summary) ||
    !isNumber(summary.ok) ||
    !isNumber(summary.check) ||
    !isNumber(summary.problem) ||
    (summary.repaired !== undefined && !isNumber(summary.repaired)) ||
    (judge !== 'llm' && judge !== 'rules') ||
    typeof cached !== 'boolean'
  ) {
    return null;
  }
  const parsed = sentences.map(parseCheckSentence);
  if (!parsed.every((s): s is CheckSentence => s !== null)) return null;
  return {
    sentences: parsed,
    summary: {
      ok: summary.ok,
      check: summary.check,
      problem: summary.problem,
      repaired: typeof summary.repaired === 'number' ? summary.repaired : 0,
    },
    judge,
    cached,
  };
}

export function parseCheckResult(value: unknown): CheckResult | null {
  if (!isRecord(value)) return null;
  if (value.ok === false && (value.reason === 'off' || value.reason === 'unavailable')) {
    return { ok: false, reason: value.reason };
  }
  if (value.ok === true) {
    const data = parseCheckResponse(value.data);
    return data ? { ok: true, data } : null;
  }
  return null;
}
