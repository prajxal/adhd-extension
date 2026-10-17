# Readwell (working name): Phase 1 build spec

## How to work

- Implement **Phase 1 only**. Before writing any code, produce an implementation plan covering the file tree, key modules, data flow, libraries with pinned versions and risks. **Wait for my approval before coding.**
- Build in the milestones below, in order. After each milestone, run the tests and checks for it, then **stop** and give me a short walkthrough: what changed, how to verify it, and a "Decisions I made" list.
- If something isn't covered here, pick the simplest option and log it under "Decisions I made". Do not add features outside this spec.

## What we're building

A Chrome extension that makes web text easier to read for people who struggle with long sentences and hard words, including many ADHD readers. It has two parts.

1. **Visual reading modes.** These are applied locally in the page with no network calls:
   - **Bold-prefix:** bold the first part of each word.
   - **Reading ruler:** a horizontal clear band follows the cursor and dims the rest of the page.
   - **Spacing:** larger line height, word spacing and letter spacing.
2. **Simplify on selection.** The user selects text and clicks "Simplify". The backend uses an LLM to return:
   - a plain-language version, with each simple sentence linked to the original sentence(s) it came from
   - a one-line TL;DR
   - a short glossary of hard words

Never use the name "Bionic Reading" in code, UI or docs, because it's another company's product name. Call the mode **Bold-prefix**.

### Out of scope for Phase 1

- Meaning/faithfulness checking beyond the validations listed below
- Reading self-test
- PDF support
- Accounts and auth
- Payments
- Firefox and Safari
- Deployment
- Analytics

## Stack

```
/extension   WXT (Manifest V3) + React + TypeScript (strict)
/server      Python 3.11+, FastAPI, Pydantic v2
README.md
```

- **Extension:** WXT, React, TypeScript strict mode with **no `any`**, and Vitest for unit tests. Use plain CSS or CSS modules, with no UI component library.
- **Server:** FastAPI, Pydantic v2, `pysbd` for sentence splitting, `textstat` for readability, stdlib `sqlite3` for the cache, `pytest` for tests and `ruff` for linting.
- **Config:** a `.env` file in `/server`. Commit a `.env.example` and never commit real keys.

## Architecture rules (non-negotiable)

1. The extension **never** holds an LLM API key and never calls an LLM directly. All LLM calls go through `/server`.
2. Visual modes run 100% client-side and must be **fully reversible**.
3. Text is sent to the server **only on an explicit user action** (Simplify button or context menu), never automatically.
4. All UI injected into web pages lives inside a **Shadow DOM**, so page CSS can't break it and our CSS can't leak out.
5. Server logs **never contain user text**. Log only its length and a hash.

---

## Extension

### Entry points

- **background** (service worker): registers the "Simplify selection" context menu, routes messages and calls the server.
- **content** script: runs the visual modes, the selection button and the result card.
- **popup**: settings.

**Permissions:** `storage` and `contextMenus`, plus host permission for `http://localhost:8000/*`. The README must note that a deployed server URL has to be added there. The content script matches `<all_urls>`.

### Settings (`chrome.storage.sync`)

```ts
type Settings = {
  boldPrefix: { enabled: boolean; intensity: number }; // 0.3–0.6, default 0.45
  ruler: { enabled: boolean; height: number };           // px, default 48
  spacing: { enabled: boolean };
  simplifyLevel: 1 | 2 | 3;                              // default 2
  serverUrl: string;                                      // default "http://localhost:8000"
  enabledSites: string[];                                 // hostnames where visual modes auto-apply
  privacyNoticeAccepted: boolean;
};
```

**The popup has:**
- toggles and sliders for the settings above
- a "Turn on for this site" switch, which adds or removes the current hostname
- the server URL field

**Settings apply immediately.** A popup change applies to the open tab right away, via a message to the content script, with no page reload.

**Privacy notice.** Show a one-time notice before the first Simplify:

> Selected text is sent to our server and an AI provider to simplify it. Nothing is sent unless you click Simplify.

### Bold-prefix

- Walk text nodes under `document.body` with a `TreeWalker`.
- **Skip text inside:**
  - these tags: `script, style, noscript, textarea, input, select, option, code, pre, kbd, samp, math, svg, canvas, iframe`
  - anything with a `[contenteditable]` ancestor
  - our own shadow host
- Skip whitespace-only nodes.
- **Word regex:** `/\p{L}[\p{L}\p{M}'’-]*/gu`. It matches letters only, so numbers and symbols are left alone.
- **Bold length** for a word of length `n`: `n <= 3 ? 1 : Math.min(n - 1, Math.ceil(n * intensity))`. The bold part is never the whole word when n ≥ 2.
- **Wrapping:**
  - Replace each processed text node with `<span data-rw="bp">`. Inside it, put the text with each prefix wrapped in `<b data-rw="b">`.
  - Style the prefix with a class that sets `font-weight: 700` explicitly, rather than relying on inherited bold.
  - Keep the original text, using a `WeakMap` or a data attribute, so turning the mode off restores the **exact** original text node.
- **Performance:** process in chunks of about 200 nodes via `requestIdleCallback`, falling back to `setTimeout`. No chunk may block the main thread for more than 50ms.
- **Dynamic pages:** while the mode is on, a `MutationObserver` (debounced 300ms) processes newly added nodes. It ignores mutations caused by our own code.
- **Pure function:** put `boldPrefix(text: string, intensity: number): Segment[]` in its own module, with unit tests.

### Reading ruler

- Two fixed-position dimming overlays, one above and one below a clear band of `ruler.height` px.
- The band follows `mousemove` Y, throttled with `requestAnimationFrame`.
- Overlays use `pointer-events: none`.
- Turning the ruler off removes the overlays.
- `Alt+R` toggles the ruler.
- Respect `prefers-reduced-motion`: no transitions.

### Spacing

Inject a removable stylesheet. It applies to `p, li, dd, blockquote, td`:

```css
line-height: 1.8;
word-spacing: 0.16em;
letter-spacing: 0.03em;
```

`!important` is allowed, but only inside this stylesheet.

### Simplify flow

1. **Show the button.** On `mouseup`/`keyup`, check the selection. If it is non-collapsed, 20–3000 characters long and not inside an input or editable area, show a small **Simplify** button (in Shadow DOM) near the end of the selection.
   - Hide the button on scroll, on `Escape`, or when the selection is cleared.
2. **Context menu.** The "Simplify selection" context menu item triggers the same action.
3. **Too long.** If the selection is over 3000 characters, show: "Select a shorter passage (max ~3000 characters)".
4. **Request path.** The content script messages the background, which calls `POST {serverUrl}/simplify` and sends the result back to the content script.
5. **Result card** (Shadow DOM), positioned near the selection. It closes with `Escape` or ×. It shows:
   - The **TL;DR** at the top.
   - **Readability**, e.g. "Grade 14 → Grade 7", using the values from the server.
   - **Simplified sentences** as a list. Clicking a sentence expands it to show the original sentence(s) it came from (via `sourceIds`), highlighted.
   - The **glossary** as chips. Clicking a chip shows its definition.
   - A **level switcher** (1 / 2 / 3) that re-requests at the new level.
   - **Loading and error states**, with a retry. When the fetch fails, the error says "Server not reachable at {serverUrl}".
   - **Warnings** from the server, shown subtly, e.g. "Some details may be missing".
6. **Card styling.**
   - Max width 420px and 16px base font, with good contrast.
   - Works in both light and dark mode (`prefers-color-scheme`).
   - Fully keyboard accessible.

---

## Server

### Endpoints

`GET /health` returns `{ "ok": true }`.

`POST /simplify`

Request:
```json
{ "text": "string, 20–3000 chars", "level": 2 }
```

Response:
```json
{
  "original":   [{ "id": 1, "text": "..." }],
  "simplified": [{ "text": "...", "sourceIds": [1] }],
  "tldr": "...",
  "glossary":   [{ "term": "...", "definition": "..." }],
  "readability": { "before": 14.2, "after": 7.1 },
  "cached": false,
  "warnings": []
}
```

**Request handling:**
- **CORS:** use `allow_origin_regex` for `chrome-extension://.*`.
- **Validation:** validate input with Pydantic and return 400 on bad input.
- **Rate limit:** simple in-memory per-IP limit of 30 requests/min. Return 429 when exceeded.

### Pipeline

1. **Segment.** Normalise whitespace, split into sentences with `pysbd` and number them from 1.
2. **Cache lookup.**
   - Key: `sha256(normalised_text + level + PROMPT_VERSION + LLM_MODEL)`.
   - Table: SQLite `cache(key TEXT PRIMARY KEY, response_json TEXT, created_at TEXT)`.
   - On a hit, return the stored response with `cached: true`.
3. **Call the LLM.**
   - Send the system prompt below, with the numbered sentences (`[1] ...`, `[2] ...`) as user content.
   - Use the provider's structured/JSON output mode and ask for this schema:
     ```json
     {
       "simplified": [{ "text": "string", "sourceIds": [1] }],
       "tldr": "string",
       "glossary": [{ "term": "string", "definition": "string" }]
     }
     ```
   - Parse the result with Pydantic. On a parse or validation failure, retry once. If it fails again, return 502 with a clear message.
4. **Validate.** These are cheap guards against hallucination; Phase 2 builds the real meaning check on top of them.
   - **sourceIds:** drop any that don't exist. If a simplified sentence is left with no valid `sourceIds`, drop the sentence and add a warning.
   - **Coverage:** every original sentence id should be covered by at least one simplified sentence. If not, add a warning listing the uncovered ids.
   - **Glossary:** drop entries whose `term` doesn't appear in the original text (case-insensitive), then cap the list at 5.
   - **Numbers:** every number in the original (regex `\d+(?:[.,]\d+)?%?`) should appear somewhere in the simplified text. Add a warning for each missing number.
5. **Readability.** Compute the Flesch-Kincaid grade with `textstat` for the original and the joined simplified text.
6. **Cache and return.** Store the response in the cache, then return it.

### LLM provider interface

```python
class LLMProvider(Protocol):
    def generate_json(self, system: str, user: str, schema: type[BaseModel]) -> BaseModel: ...
```

- **Gemini provider:** implement one real provider using the official `google-genai` SDK.
- **Config:** read `LLM_PROVIDER`, `LLM_MODEL` and the API key from `.env`. Don't hardcode a model name anywhere else.
- **FakeProvider:** add one that returns canned responses. All tests use it.

### System prompt

Put this in `server/prompts.py`, with `PROMPT_VERSION = "v1"`:

```
You rewrite text so it is easier to read for people who find long sentences and hard words difficult to follow.

You will get the original text as numbered sentences, like "[1] ...".

Rules:
- Keep the meaning exactly the same. Do not add facts, opinions, examples, or advice.
- Keep every number, date, name, and negation (not, no, never, without, unless).
- One idea per sentence.
- Level {level}:
  1 = Light: split long sentences, keep the original words where possible. Max 20 words per sentence.
  2 = Plain: use everyday words. Max 15 words per sentence.
  3 = Simplest: use the simplest common words. Max 10 words per sentence.
- For each simplified sentence, give sourceIds: the numbers of the original sentences it comes from.
- tldr: one sentence, max 20 words, that states the main point.
- glossary: up to 5 hard words or phrases, copied exactly as they appear in the original, each with a definition of max 12 words that fits how it is used here. Use an empty list if there are no hard words.

Return only JSON that matches the schema.
```

---

## Milestones (stop after each one)

1. **Scaffold.** Both projects run. The extension loads unpacked in Chrome. The popup reads and writes settings. The server's `/health` works. Lint, type-check and test commands are wired up.
2. **Visual modes.** Bold-prefix, ruler and spacing all work, along with per-site enable and live toggling from the popup.
3. **Server `/simplify`.** The full pipeline passes its tests with FakeProvider, and then works with the real provider.
4. **Simplify UI.** The selection button, context menu, result card, level switcher and error states all work.
5. **README.** Covers:
   - setup for both parts
   - loading the extension unpacked
   - `.env` setup
   - a demo script using 3 test pages
   - known limitations

## Acceptance checks (verify and report each one)

- [ ] **Clean restore.** Turning bold-prefix off restores the page: `document.body.innerText` is identical before enabling and after disabling. Test on Wikipedia, a news article and a Medium post.
- [ ] **Editors and code untouched.** Bold-prefix never touches inputs, textareas, contenteditable areas or `code`/`pre` blocks. Test on GitHub and in Gmail compose.
- [ ] **Performance.** On a long Wikipedia article, our script causes no long tasks over 50ms (check the Performance panel) and no visible jank while scrolling.
- [ ] **Dynamic content.** With the mode on, an infinite-scroll feed gets processed as new content loads.
- [ ] **Style isolation.** Our UI looks the same on 3 different sites, which shows the Shadow DOM isolation works.
- [ ] **No secrets in the bundle.** A `grep` of the built extension bundle finds no API key and no LLM provider URL.
- [ ] **`/simplify` correctness.** Every returned `sourceIds` is valid, and every glossary term appears in the original. Sending the same request twice gives `cached: true` on the second, in under 50ms.
- [ ] **Extension unit tests.** `boldPrefix` is tested on:
  - short words and long words
  - apostrophes and hyphens
  - non-English letters ("café", "naïve")
  - numbers, which must stay untouched
- [ ] **Server unit tests.** Each validation step is tested with FakeProvider: bad `sourceIds`, uncovered sentences, a made-up glossary term and a missing number.
- [ ] **Clean logs.** No user text appears in server logs.
- [ ] **Clean lint.** TypeScript strict passes with zero `any`, and `ruff` passes on the server.