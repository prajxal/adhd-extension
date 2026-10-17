# Readwell

A Chrome extension that makes web text easier to read for people who find long sentences and hard words hard to follow, including many ADHD readers.

- **Visual reading modes** run entirely in the page, with no network calls, and switch off cleanly:
  - **Bold-prefix** bolds the first part of each word.
  - **Reading ruler** keeps a clear band at the mouse and dims the rest of the page (Alt+R toggles it).
  - **Spacing** adds line, word and letter spacing.
- **Simplify on selection:** select text and click **Simplify** (or right-click → *Simplify selection*). You get a plain-language rewrite where every sentence links back to the original, a one-line TL;DR, and a short glossary of hard words.

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

`.env` is git-ignored. Never put a real key in `.env.example`.

**Choosing models.** A model is skipped for 60 seconds after it fails, so one slow model doesn't make every request wait. On the Gemini free tier, each model has its **own daily request cap**, so a longer fallback list also gives you more requests per day. "Live" Gemini models can't be used here, because they only support the real-time streaming API.

### Server checks

```bash
ruff check . && ruff format --check .
pytest
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

### Using a server that isn't on localhost

The extension may only contact `http://localhost:8000/*`. To use a deployed server:

1. Add its origin to `host_permissions` in `extension/wxt.config.ts`, for example `'https://readwell.example.com/*'`.
2. Rebuild and reload the extension.
3. Enter the URL in the popup's **Server** field.

Without step 1, Chrome blocks the request and the card shows "Server not reachable at …".

---

## 3. Demo script (about 5 minutes, 3 pages)

Start the server (`uvicorn app.main:app --port 8000`) and load the extension first.

### Page 1: Wikipedia, reading modes
Open <https://en.wikipedia.org/wiki/Attention_deficit_hyperactivity_disorder>.
1. Open the popup and switch on **Turn on for this site**. The reading modes only run on sites you turn on.
2. Turn on **Bold-prefix**. The first part of each word turns bold without reloading the page. Drag **Bold amount** and the page updates once you let go.
3. Turn on **Extra spacing** and the paragraphs open up.
4. Turn on **Reading ruler** and move the mouse: a clear band follows the cursor. Press **Alt+R** to turn it off and on again.
5. Switch everything off. The page goes back exactly as it was.

### Page 2: a news article, Simplify
Open any article on <https://www.bbc.com/news>.
1. Select a long paragraph. A small **Simplify** button appears at the end of the selection.
2. Click it. The first time, a privacy notice explains what gets sent. Click **Continue**.
3. The card shows:
   - the **TL;DR**
   - the reading grade before and after, e.g. "Grade 14 → Grade 7"
   - the simplified sentences: click one to see the original sentence it came from, highlighted
   - glossary chips: click one to see its definition
4. Click **3** in the level switcher to get the simplest version. Press **Escape** to close the card.
5. Select a whole article (more than about 3,000 characters). You'll see "Select a shorter passage (max ~3000 characters)".

### Page 3: GitHub, editors and the context menu
Open <https://github.com/microsoft/TypeScript/blob/main/README.md>.
1. Turn the site on and enable **Bold-prefix**. Prose gets bold prefixes, but code blocks and the search box are left alone.
2. Select a paragraph, right-click and choose **Simplify selection**. The same card opens.
3. Stop the server and click Simplify again. The card says "Server not reachable at http://localhost:8000". Restart the server and click **Retry**.

---

## 4. How it fits together

```
popup ──storage.sync──► content script ──► visual modes (local only)
                            │
   select text / menu ──────┤
                            ▼
                     background worker ──POST /simplify──► server ──► Gemini (+ fallbacks)
                            ▲                                │
                            └──────── result ◄───────────────┘
                     content script ──► result card (Shadow DOM)
```

How the server handles a request:
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

Server logs record only the length and a hash of user text, never the text itself.

---

## 5. Known limitations

- **Pages that rewrite their own text.** Bold-prefix wraps text in `<span>` elements. A framework such as React that later tries to update one of those text nodes can lose the update or log an error. Turning the mode off restores the page's latest text.
- **Iframes, shadow DOM and PDFs.** Bold-prefix and Simplify only work in the top-level page, not inside iframes, other sites' shadow DOM or the PDF viewer.
- **Styled `<span>` elements.** A site with broad CSS rules for `span` elements (for example `article span { display: block }`) can change how bold-prefixed text is laid out.
- **Keyboard-only Simplify.** The floating button is for mouse users. With the keyboard, select text and use the context menu (Shift+F10 or the Menu key) → *Simplify selection*. Everything inside the card works with the keyboard.
- **Simplification quality.** Only the cheap checks above are applied, not a full check that the meaning is preserved, so read the warnings. Citation markers such as `[1]` are sent along with the text.
- **The AI provider can be slow or rationed.** Free-tier Gemini keys have daily per-model caps and models can be overloaded, so a request may take up to about a minute or fail with "The AI service is busy or out of quota". Repeating the same request is served from the cache in a few milliseconds.
- **Rate limit:** 30 requests per minute per IP, held in memory, so it resets when the server restarts and isn't shared between server processes.
- **Chrome only.** No Firefox or Safari, no accounts and no deployment setup yet.
