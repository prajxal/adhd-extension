# Readwell

A Chrome extension that makes web text easier to read for people who find long sentences and hard words hard to follow, including many ADHD readers.

- **Visual reading modes** run entirely in the page, with no network calls, and switch off cleanly:
  - **Bold-prefix** bolds the first part of each word.
  - **Reading ruler** keeps a clear band at the mouse and dims the rest of the page (Alt+R toggles it).
  - **Spacing** adds line, word and letter spacing.
- **Simplify on selection:** select text and click **Simplify** (or right-click → *Simplify selection*). You get a plain-language rewrite where every sentence links back to the original, a one-line TL;DR, and a short glossary of hard words.
- **Meaning check and auto-repair:** after each Simplify, the card checks whether every simplified sentence still says what the original said. It fixes sentences that changed the meaning when it can, and flags the rest.
- **Reader for PDF and PowerPoint:** open a `.pdf` or `.pptx` as clean, readable text, with every feature above.

```
/extension   WXT (Manifest V3) + React + TypeScript (strict)
/server      Python 3.11+, FastAPI, Pydantic v2, Gemini
```

The extension never holds an API key and never calls an LLM. Text goes to **your** server only when you click Simplify, and the server is the only thing that talks to the AI provider.

---

## 1. Server setup

Requires Python 3.11+.

```bash
cd server
python3 -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"
cp .env.example .env        # then edit .env, see below
uvicorn app.main:app --port 8000
```

Check it: `curl localhost:8000/health` should return `{"ok":true}`.

### `.env`

| Key | What it does |
|---|---|
| `LLM_PROVIDER` | `gemini` for real use, or `fake` to run with no API key (it echoes the input back, which is handy for UI work) |
| `LLM_MODEL` | Main Gemini model, e.g. `gemini-3.6-flash` |
| `LLM_FALLBACK_MODELS` | Comma-separated models tried in order when the main one is busy, slow or out of quota, e.g. `gemini-3.5-flash,gemini-3.5-flash-lite,gemini-3.7-flash` |
| `LLM_TIMEOUT_S` | Seconds to wait for each model before moving to the next (default `30`) |
| `GEMINI_API_KEY` | Your key from Google AI Studio |
| `CACHE_PATH` | SQLite cache file (default `cache.sqlite3`) |
| `MEANING_CHECK` | `llm` (rules plus an AI judge, the default), `rules` (no extra AI call) or `off` (the card hides the check) |
| `MEANING_REPAIR` | `on` (default) fixes sentences the check marks as problems; `off` only flags them. Needs `MEANING_CHECK=llm`. |

`.env` is git-ignored. Never put a real key in `.env.example`.

**Choosing models.** A model is skipped for 60 seconds after it fails, so one slow model doesn't make every request wait. On the Gemini free tier, each model has its **own daily request cap** (20 requests a day per model on the keys tested), so a longer fallback list also gives you more requests per day. "Live" Gemini models can't be used here, because they only support the real-time streaming API.

### Server checks

```bash
ruff check . && ruff format --check .
pytest
```

To score the meaning check and auto-repair against real models on the labelled test set:

```bash
PYTHONPATH=. python scripts/eval_meaning.py gemini-3.6-flash      # 4 AI calls per model
PYTHONPATH=. python scripts/eval_repair.py gemini-3.5-flash-lite  # about 9 AI calls per model
```

---

## 2. Extension setup

Requires Node 22+ (WXT needs it).

```bash
cd extension
npm install
npm run build              # outputs .output/chrome-mv3
npm run check              # strict typecheck + lint (no `any`) + unit tests
```

### Load it unpacked in Chrome

1. Open `chrome://extensions`.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and choose `extension/.output/chrome-mv3`.
4. Pin Readwell from the puzzle-piece menu so the popup is one click away.

After a rebuild, click the reload icon on the Readwell card in `chrome://extensions`, then reload any open tabs. For development, `npm run dev` opens a separate Chrome window with the extension loaded and reloads it whenever you save.

### Permissions: what Readwell can access

Readwell asks for as little as possible. At install it can only reach its own server (`http://localhost:8000`).

| You want to… | What happens |
|---|---|
| Use reading modes on a site | Popup → **Turn on for this site**. Chrome asks once, for that site only. Turning it off gives the access back. |
| Simplify text anywhere | Select text, right-click → **Simplify selection**. This works on any site with no setup: Chrome gives temporary access to that tab when you click. |
| Have the Simplify button on every site | Popup → **Simplify button on every site**. Chrome asks for access to all sites. Without it, the floating button appears only on sites you've turned on. |
| Open a PDF or PPTX from a link | Readwell asks for that link's site the first time. |
| Open a file from your computer | Popup → **Open a PDF or PowerPoint file…**. No permission needed. |

`npm run build:e2e` makes a separate **test-only** build in `.output-e2e/` that has all-sites access pre-granted, because automated browser tests can't click Chrome's permission prompts. Never load or ship that build for real use.

### Using a server that isn't on localhost

The extension may only contact `http://localhost:8000/*`. To use a deployed server:

1. Add its origin to `host_permissions` in `extension/wxt.config.ts`, for example `'https://readwell.example.com/*'`.
2. Rebuild and reload the extension.
3. Enter the URL in the popup's **Server** field.

Without step 1, Chrome blocks the request and the card shows "Server not reachable at …".

---

## 3. Demo script (about 8 minutes)

Start the server (`uvicorn app.main:app --port 8000`) and load the extension first.

### 1. Wikipedia: reading modes
Open <https://en.wikipedia.org/wiki/Attention_deficit_hyperactivity_disorder>.
1. Open the popup and switch on **Turn on for this site**. Chrome asks for access to `en.wikipedia.org` only. Allow it.
2. Turn on **Bold-prefix**. The first part of each word turns bold without reloading the page. Drag **Bold amount** and the page updates once you let go.
3. Turn on **Extra spacing** and the paragraphs open up.
4. Turn on **Reading ruler** and move the mouse: a clear band follows the cursor. Press **Alt+R** to turn it off and on again.
5. Switch everything off. The page goes back exactly as it was.

### 2. A news article: Simplify, meaning check and auto-repair
Open any article on <https://www.bbc.com/news>. Don't turn the site on.
1. Select a long paragraph, right-click and choose **Simplify selection**. No permission prompt: the menu gives Readwell this one tab.
2. The first time, a privacy notice explains what gets sent. Click **Continue**.
3. The card shows:
   - the **TL;DR**
   - the reading grade before and after, e.g. "Grade 14 → Grade 7"
   - the simplified sentences: click one to see the original sentence it came from, highlighted
   - glossary chips: click one to see its definition
   - a meaning-check line under the grade: "Checking meaning…", then for example "✓ Meaning check passed", "1 sentence fixed · ✓ Meaning check passed" or "1 sentence may have changed meaning"
4. A ✎ marks a sentence Readwell fixed. Click it to see what was fixed and the earlier version. A ⚠ or • marks a sentence to double-check. Click it to see why, e.g. `Negation may be lost (original says "not").`
5. Click **3** in the level switcher to get the simplest version. Press **Escape** to close the card.
6. Select a whole article (more than about 3,000 characters). You'll see "Select a shorter passage (max ~3000 characters)".

### 3. GitHub: editors are left alone
Open <https://github.com/microsoft/TypeScript/blob/main/README.md>.
1. Turn the site on and enable **Bold-prefix**. Prose gets bold prefixes, but code blocks and the search box are left alone.
2. Stop the server and simplify a paragraph. The card says "Server not reachable at http://localhost:8000". Restart the server and click **Retry**.

### 4. The reader: a PDF and a PowerPoint
1. Open a PDF in Chrome, for example <https://arxiv.org/pdf/1706.03762>. Open the popup and click **Open this PDF in Readwell**, then allow the site when asked.
2. The paper opens as plain paragraphs, page by page, in reading order: two-column pages are read left then right, and running headers and page numbers are gone. Your reading modes apply here too.
3. Click **Show original** to see the real pages, then **Reading view** to come back.
4. Click **Open file…** and pick a `.pptx`. Each slide shows its title, bullets (indented as in the deck), tables and speaker notes.
5. Select a paragraph in the reader and click **Simplify**. The same card opens.

---

## 4. How it fits together

```
popup ──storage.sync──► content script ──► visual modes (local only)
   │                        │   (only on sites you allow; right-click injects it via activeTab)
   │   select text / menu ──┤
   │                        ▼
   │                 background worker ──POST /simplify──► server ──► Gemini (+ fallbacks)
   │                        ▲          POST /check ─────────►  │     (rules + judge + repair)
   │                        └──────── result, then check ◄─────┘
   │                 content script ──► result card (Shadow DOM)
   │
   └──► reader.html ──► PPTX (fflate + DOMParser) / PDF (PDF.js, packaged) ──► same modes and card
```

`/check` runs automatically right after a successful `/simplify`, for the same text and level. It's part of the same click, so no text is sent without an explicit action. The server checks its own cached simplification and never accepts simplified text from the extension.

How the server handles `/simplify`:
1. Split the text into sentences.
2. Check the SQLite cache.
3. Ask the LLM for structured JSON, retrying once if the reply doesn't parse.
4. Check the reply:
   - drop `sourceIds` that don't exist
   - flag original sentences that nothing covers
   - drop glossary terms that aren't in the original, keeping at most 5
   - flag numbers that went missing
5. Score readability (Flesch-Kincaid grade).
6. Store the result in the cache.

How the server handles `/check`:
1. Run the rules.
2. Run the AI judge.
3. Repair problem sentences, then check again.
4. Store the result in the cache.

Server logs record only the length and a hash of user text (plus counts), never the text itself.

---

## 5. The reader (PDF and PowerPoint)

Open it from the popup (**Open a PDF or PowerPoint file…**), by dropping a file on the reader page, by right-clicking a link to a `.pdf` or `.pptx` → **Open in Readwell**, or from the popup on a PDF tab.

Your file stays in the reader tab. Nothing is sent to the server unless you click Simplify. Limits are 25 MB and 300 pages or slides.

- **PowerPoint (.pptx):** slides appear in the deck's order with titles, bullets at their levels, plain text boxes, grouped shapes, tables, and speaker notes in a collapsible section. Old `.ppt` files get "Save it as .pptx and try again."
- **PDF:** a reading view rebuilt from the text:
  - columns are read in order and paragraphs are joined
  - larger text becomes headings
  - hyphenated words are rejoined
  - running headers, footers and page numbers are removed
  - a paragraph continues across a page break
  - diagram labels are left out

  **Show original** draws the real pages. PDF.js and its fonts and decoders are packaged with the extension, so reading a PDF makes no network requests. Scanned PDFs say "This PDF has no selectable text (it may be scanned)."

---

## 6. The meaning check and auto-repair

Each simplified sentence is compared with the original sentence(s) it came from, in two layers:

1. **Rules**, fast and with no AI:
   - numbers that changed, appeared or disappeared (citation markers like `[1]` are ignored, and "12.5 percent" counts as "12.5%")
   - negation lost or added ("not", "never", "unless", "can't"…). Words with a negative meaning, such as "refused" or "insufficient", count as negation too.
   - hedging lost ("may", "probably", "about"…)
   - capitalised names that aren't in the original
2. **An AI judge** (with `MEANING_CHECK=llm`) reads the whole passage. It labels each simplified sentence `faithful`, `changed` or `added`, and reports important details that every sentence dropped (conditions, limits, qualifiers).

Each sentence gets one status:

| Status | Shown as | When |
|---|---|---|
| `problem` | ⚠ "may have changed meaning" | The judge says *changed* or *added*, or the number or negation rule fires |
| `check` | • "to double-check" | The judge reports a minor loss, or only the hedging or name rule fires |
| `ok` | no marker | Neither layer found anything |

If the judge is unavailable (quota, timeouts), the rules still run and the card says "(basic check only)".

**Auto-repair** (with `MEANING_REPAIR=on`):
1. Readwell asks the AI once to rewrite only the `problem` sentences. It sends each sentence's original, the reasons it was flagged, and what the neighbouring sentences already say.
2. It checks the whole passage again.
3. A fix is kept only if:
   - the sentence now passes
   - it isn't much longer than before
   - no related sentence got worse

   Otherwise the original sentence keeps its ⚠.

Fixed sentences show ✎ on the card, and you can always see the earlier version. A repair problem never turns a working check into an error.

**How well it works.** On 40 hand-labelled cases in `server/tests/fixtures/meaning_eval.json` (15 faithful rewrites and 25 with one deliberate error):

| Checker | Errors caught | Faithful rewrites wrongly flagged |
|---|---|---|
| Rules only | 19/25 (76%) | 0/15 |
| Rules + judge (`gemini-3.5-flash-lite`) | 24/25 (96%) | 1/15 (7%) |
| Rules + judge (`gemini-3.6-flash`, 20 of the 40 cases before the daily quota ran out) | 14/14 | 0/6 |

| Auto-repair on the 25 error cases | Fixes accepted | Accepted fixes with a rule problem |
|---|---|---|
| `gemini-3.5-flash-lite` | 25/25 | 0 |
| `gemini-3.7-flash` | 20/25 | 0 |

**What it doesn't guarantee:**
- It's a second opinion, not proof. The judge and the repair are AI models too, and they can miss errors, flag faithful sentences, or make a fix that is correct but less simple. A repair often restores the original wording.
- A ✓ means nothing was found, not that the rewrite is perfect. For anything important (medical, legal, financial), read the original.
- The rules are English-only.
- Known rule blind spots:
  - double negatives ("not unreasonable" → "reasonable" gets flagged)
  - dropped "only if" conditions without a number or negation (left to the judge)
  - lowercase name changes
- The scores above come from a small test set and a few models. Rerun the scripts in `server/scripts/` after changing models.

---

## 7. Known limitations

- **Pages that rewrite their own text.** Bold-prefix wraps text in `<span>` elements. A framework such as React that later tries to update one of those text nodes can lose the update or log an error. Turning the mode off restores the page's latest text.
- **Iframes and shadow DOM.** On web pages, Bold-prefix and Simplify only work in the top-level page, not inside iframes or other sites' shadow DOM. Chrome's built-in PDF viewer is supported through the reader (see section 5).
- **Styled `<span>` elements.** A site with broad CSS rules for `span` elements (for example `article span { display: block }`) can change how bold-prefixed text is laid out.
- **Simplify button by default.** The floating Simplify button appears only on sites you've turned on, unless you switch on **Simplify button on every site**. Right-click → **Simplify selection** works everywhere.
- **Keyboard-only Simplify.** The floating button is for mouse users. With the keyboard, select text and use the context menu (Shift+F10 or the Menu key) → *Simplify selection*. Everything inside the card works with the keyboard.
- **PDF reading view:**
  - Layout is rebuilt from text positions. Complex title pages (author grids) can come out out of order.
  - Headings are found by font size, so bold section titles at body size are joined to their paragraph.
  - Tables become rows of text, and equations plain text.
  - Scanned PDFs need OCR, which isn't included.
  - Password-protected PDFs can't be opened.
- **PowerPoint:** only `.pptx`. Text in charts, SmartArt and images isn't read. A line break inside a paragraph becomes a space.
- **Popup on the reader tab.** It shows "Reading modes apply in the reader automatically". Change modes on any normal tab and they apply to the reader live.
- **Simplification quality.** The meaning check and repair catch most errors, but not all (see section 6). Citation markers such as `[1]` are still sent to the AI along with the text.
- **AI calls per Simplify.** The meaning check adds one AI call, and repair adds two more when a problem is found (repeats come from the cache). On a tight free-tier quota, set `MEANING_REPAIR=off` or `MEANING_CHECK=rules`.
- **The AI provider can be slow or rationed.** Free-tier Gemini keys have daily per-model caps and models can be overloaded, so a request may take up to about a minute or fail with "The AI service is busy or out of quota". Repeating the same request is served from the cache in a few milliseconds.
- **Rate limit:** 30 requests per minute per IP, held in memory, so it resets when the server restarts and isn't shared between server processes.
- **Chrome only.** No Firefox or Safari, no accounts and no deployment setup yet.
