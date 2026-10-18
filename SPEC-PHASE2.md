# Readwell: Phase 2 build spec (meaning check)

## How to work

- Same process as Phase 1: build the milestones below in order. After each one, run its tests and checks, then **stop** and give a short walkthrough with a "Decisions I made" list.
- If something isn't covered here, pick the simplest option and log it. Don't add features outside this spec.
- All Phase 1 architecture rules still apply: no LLM keys in the extension, all UI in Shadow DOM, no user text in logs, and text sent only on an explicit user action.

## What we're building

Phase 1's checks are structural: bad `sourceIds`, coverage, made-up glossary terms and missing numbers. Phase 2 adds a **per-sentence meaning check**. For each simplified sentence it asks whether the sentence still says what its source sentence(s) said, and shows the answer on the result card.

It should catch these errors:

| Type | Example |
|---|---|
| `negation` | "did **not** rule out delays" → "ruled out delays" |
| `number` | "12.5%" → "15%", "March 2025" → "May 2025" |
| `added` | a cause, advice, opinion or fact that isn't in the source |
| `hedge` | "**may** reduce symptoms" → "reduces symptoms" |
| `condition` | "unless funding arrives" silently dropped |
| `name` | a person, place or organisation changed or invented |

### Confirmed decisions

1. The check runs in a **separate `POST /check` call**, made automatically by the card after `/simplify` returns. `/simplify` doesn't slow down.
2. **Flag only.** No automatic rewriting of flagged sentences in Phase 2.
3. The judge uses the **same model chain** as simplification (`LLM_MODEL` plus `LLM_FALLBACK_MODELS`).

### Out of scope for Phase 2

Auto-repair, the reading self-test, PDF support, accounts, payments, other browsers, deployment, analytics, and languages other than English.

---

## Server

### Two layers per simplified sentence

Each simplified sentence is compared with **its own sources**, the original sentences named in its `sourceIds`.

**1. Rule checks** (`app/meaning/rules.py`): pure functions with no LLM, English only.

- **Numbers.**
  - A number (Phase 1 regex) in the simplified sentence that doesn't appear in its sources is reported as an invented number.
  - A number in a source that doesn't appear in *any* simplified sentence mapped to that source is reported as a dropped number.
- **Negation.** Cues: `not, no, never, without, unless, none, nobody, nothing, neither, nor, cannot` and words ending in `n't`. A source with cues whose mapped simplified sentences have none, or the reverse, is reported.
- **Hedging.** Cues: `may, might, could, can, possibly, probably, likely, unlikely, suggest(s/ed), appear(s/ed), approximately, about, around, estimate(s/d), some`. A source with cues that are all gone from the mapped simplified sentences is reported.
- **Names.** A capitalised word in the simplified sentence, other than its first word, that doesn't appear (ignoring case) in its sources is reported.

**2. LLM judge** (`app/meaning/judge.py`): one batched call per passage, using structured JSON and `JUDGE_PROMPT_VERSION = "v1"`. For each simplified sentence (with its index and its sources), the judge returns:

```json
{ "index": 0, "label": "faithful | minor_loss | changed | added", "reason": "max 12 words" }
```

The judge gets a parse failure retried once, as in Phase 1. If it still fails, or every model in the chain fails, the check falls back to rules only (see below) instead of returning an error.

### Combining the layers

| Status | When |
|---|---|
| `problem` | judge says `changed` or `added`, **or** the negation or number rule fires |
| `check` | judge says `minor_loss`, **or** only the hedging or name rule fires |
| `ok` | otherwise |

Reasons are short, plain-language strings shown to the reader, e.g. `Negation may be lost (source says "not").` They include at most one rule reason per rule and the judge's reason when the status isn't `ok`.

### `POST /check`

Request (the same body as `/simplify`):
```json
{ "text": "string, 20–3000 chars", "level": 2 }
```

Behaviour:
- Look up the cached `/simplify` result for this text and level. If there's none, return **409** with `"Simplify this text first."` The client never sends simplified text, so it can't ask us to check arbitrary content.
- Cache key: `sha256(simplify_cache_key + JUDGE_PROMPT_VERSION + MEANING_CHECK)` in a second SQLite table, `check_cache(key, response_json, created_at)`.
- Same CORS, 400 validation, rate limit (shared with `/simplify`) and log rules as Phase 1.

Response:
```json
{
  "sentences": [{ "index": 0, "status": "ok", "reasons": [] }],
  "summary": { "ok": 5, "check": 1, "problem": 0 },
  "judge": "llm",
  "cached": false
}
```
`judge` is `"llm"` when the judge answered, and `"rules"` when only rules ran (because of config or a fallback).

### Config (`.env`)

`MEANING_CHECK=llm|rules|off` (default `llm`). With `off`, `/check` returns 404 and the card hides the check UI.

---

## Extension

- After a successful `/simplify`, the card automatically requests `/check` through the background worker. It's the same text the user just chose to simplify, so it counts as part of that same explicit action.
- **Summary line** under the readability grade:
  - while checking: "Checking meaning…"
  - "✓ Meaning check passed"
  - "1 sentence to double-check" or "2 sentences may have changed meaning", using the most severe status
  - quietly: "Meaning check unavailable" on error or 404
  - with `judge: "rules"`: add "(basic check only)"
- **Flagged sentences** get a small marker next to them: ⚠ for `problem`, • for `check`. The marker has a text label for screen readers ("Possible meaning change", "Double-check"). Expanding the sentence shows the reasons above the highlighted original.
- Changing the level runs a new check. Replies for an old level or a closed card are ignored, using the same stale guard as Phase 1.
- Light and dark mode, and full keyboard access, as in Phase 1.

---

## Evaluation

`server/tests/fixtures/meaning_eval.json` holds about 40 hand-labelled cases. Each is `{id, source[], simplified, label: "faithful"|"error", error_type, note}`: about 15 faithful paraphrases (some deliberately tricky for the rules) and about 25 cases with one injected error, covering every error type.

`server/scripts/eval_meaning.py` (opt-in, uses real models) prints precision, recall and false-flag rate for rules only, judge only and both combined, per model.

**Targets for the combined check,** counting `check` or `problem` as a flag:
- **Recall ≥ 85%** on error cases
- **False-flag rate ≤ 15%** on faithful cases

The rules alone are expected to miss `added` and some `condition` cases. That's what the judge is for.

---

## Milestones (stop after each one)

1. **Spec and evaluation set.** This file, plus the fixture and a test that validates its shape and balance.
2. **Rule checks.** `app/meaning/rules.py` with unit tests per rule, plus a test reporting rule-only scores on the evaluation set.
3. **Judge and `/check`.** Prompt, schema, combination, endpoint, cache, config. Tests with FakeProvider (including the fallback to rules), then a real evaluation run against the targets.
4. **Card UI.** Types and validator, flow state, summary line, sentence flags. Unit tests plus a real-browser test.
5. **README.** What the check does and doesn't guarantee, configuration, and an updated demo script.

## Acceptance checks

- [ ] The combined check meets the targets on the evaluation set with the main model (or the best available model if quota blocks it, reported honestly).
- [ ] Each rule has unit tests, including at least one known false positive documented as a limitation.
- [ ] `/check` returns 409 for text that was never simplified, and never accepts simplified text from the client.
- [ ] When the judge fails, `/check` still returns rule results with `judge: "rules"`. When `MEANING_CHECK=off`, it returns 404 and the card hides the check UI.
- [ ] A second `/check` for the same text and level returns `cached: true` in under 50ms.
- [ ] The card never blocks on the check, and stale check replies are ignored.
- [ ] No user text in logs. Strict TypeScript with no `any`, ruff and all tests pass.
