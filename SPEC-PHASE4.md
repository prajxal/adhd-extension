# Readwell: Phase 4 build spec (deployment, Web Store package, OCR)

## How to work

- Same process as before: build the milestones in order, then **stop** after each one with a walkthrough and a "Decisions I made" list.
- If something isn't covered here, pick the simplest option and log it. Don't add features outside this spec.
- Every earlier rule still applies:
  - no LLM keys in the extension
  - injected UI in Shadow DOM
  - no user text in logs
  - text sent only on an explicit action
  - least-privilege permissions (Phase 3)

## What we're building

1. **The server deployed on Render** from this GitHub repo, hardened for a public endpoint.
2. **A Chrome Web Store–ready package:** a production build pointing at the deployed server, plus icons, listing, screenshots, privacy policy and permission justifications.
3. **OCR for scanned PDFs and images** in the reader, running on the user's computer.

### Out of scope for Phase 4

Submitting to the store (the owner uploads), user accounts, payments, analytics, OCR in languages other than English, OCR on web pages (outside the reader), auto-scaling or multi-instance setups, and custom domains.

---

## A. Server deployment

### Container
`server/Dockerfile`:
- Python 3.13 slim base image; install the pinned dependencies with `pip install .`.
- Run as a non-root user.
- Start with `uvicorn app.main:app --host 0.0.0.0 --port $PORT --proxy-headers --forwarded-allow-ips='*'`, so `request.client.host` is the visitor's real IP behind Render's proxy. Only Render's proxy can reach the container.
- A `.dockerignore` keeps out `.env`, `.venv`, caches and tests.

### Render Blueprint (`render.yaml`, repo root)
- One web service:
  - `runtime: docker`, `rootDir: server`, `healthCheckPath: /health`, `plan: free` (can be changed later)
  - `envVars`: `APP_ENV=production`, the model settings from `.env.example`, `CACHE_PATH=/tmp/readwell-cache.sqlite3`
  - `GEMINI_API_KEY` and `ALLOWED_EXTENSION_IDS` set as `sync: false`, so they're entered in the dashboard and never stored in the repo

### Production settings (`APP_ENV=production`; development keeps the current behaviour)

| Setting | Production | Development |
|---|---|---|
| CORS | Only `chrome-extension://<id>` for each ID in `ALLOWED_EXTENSION_IDS` (comma-separated). If none are set, no browser origins are allowed, and a warning is logged at startup. | Any `chrome-extension://` origin |
| `/docs`, `/redoc`, `/openapi.json` | off | on |
| Request body limit | 64 KB → 413 | same |
| Per-IP limits | 20/min (`RATE_LIMIT_PER_MINUTE`) and 200/day (`RATE_LIMIT_PER_DAY`) → 429 | 30/min, no daily limit |
| Server-wide AI calls per UTC day | `DAILY_AI_CALL_LIMIT` (default 500). Over the limit → 503 "Readwell has reached its daily limit. Please try again tomorrow." Checks fall back to rules. | no limit |
| Cache expiry | `CACHE_TTL_HOURS` (default 24). Expired entries are never served and are deleted at most once an hour. | same |

- An "AI call" is one call to the provider, including fallbacks, retries, the judge and repair. Counters live in memory, which is fine because the Free and Starter plans run a single instance.
- A cached response counts against the per-IP limits but not the AI-call limit.

### Privacy policy
`GET /privacy` serves a static HTML page, also linked from the extension's popup. It covers:
- what is sent and when
- that the text is processed by Google Gemini under Google's API terms
- the 24-hour cache
- that logs hold only lengths and hashes
- that there are no accounts, no tracking and no selling of data
- that documents opened in the reader and OCR stay on the device
- how to contact the owner

### Verification
- Unit tests for every production setting.
- Locally: run the exact production command and environment and check them with real requests.
- After the owner deploys: from here, check `/health`, CORS (allowed and refused origins), a real `/simplify` and `/check`, `/privacy`, the 64 KB limit, and that `/docs` returns 404.

---

## B. Chrome Web Store package

- **`npm run build:prod`** with `READWELL_SERVER_URL=https://…`:
  - the default `serverUrl` and the only required host permission are that URL (`<origin>/*`); no `localhost`
  - the build fails if the variable is missing or isn't `https:`
  - output goes to `.output/chrome-mv3`; `npm run zip:prod` makes `readwell-1.0.0-chrome.zip`
- **Manifest:**
  - `version: 1.0.0`
  - icons at 16/32/48/128
  - `action.default_icon`
  - a description of 132 characters or fewer
  - `homepage_url`: the GitHub repo
  - `minimum_chrome_version: "121"`
- **Icons:** one SVG source in `extension/assets/icon.svg`, rendered to PNG at every size. They must read clearly at 16 px and work on both light and dark toolbars.
- **Store assets** in `store/`:
  - `listing.md`: name, short description (132 characters or fewer), detailed description, category Accessibility, language English
  - `permissions.md`: the single-purpose statement, a justification for each permission and host permission, and data-use disclosures that match the Web Store form
  - `screenshots/` with five at 1280×800: reading modes, the Simplify card with the meaning check, auto-repair, the PDF reader, the PPTX reader
  - `promo-440x280.png`
  - `SUBMISSION.md`: a step-by-step upload checklist
- **Package checks (scripted):**
  - the manifest is valid MV3 with only the needed permissions
  - every permission is used in code
  - no remote code: all scripts and wasm come from the package
  - zip size reported
  - the extension loads, and its key features work, from the zip contents in Chrome for Testing

---

## C. OCR (scanned PDFs and images)

- **Engine:** Tesseract.js 7.0.0 (pinned) with the English model from `@tesseract.js-data/eng`.
  - The worker, core wasm and language data are packaged under `/tesseract/`: no network, no CDN.
  - `workerBlobURL: false`, and no IndexedDB caching of language data.
  - Loaded only on the reader page.
- **When:**
  - **PDFs:** when some or all pages have no text (Phase 3's "no text" case), the reader shows "This PDF has no selectable text (it may be scanned)." with a **Read text from images (OCR)** button, or "N pages have no text" with the same button when only some pages lack it.
  - **Images:** the reader also opens `.png`, `.jpg`/`.jpeg` and `.webp`, detected by content. An image shows a preview and the same button.
  - OCR never starts on its own.
- **How:**
  - Draw each page at about 2× scale (or use the image as it is), recognize it, and turn Tesseract's paragraphs into paragraph blocks in that page's section.
  - Pages that already have text keep their reading-view blocks.
  - Shows progress ("Reading page 3 of 12…") with **Cancel**. Limits: 50 pages for OCR, and images up to 25 MB / 40 megapixels.
  - Paragraphs with low average confidence (under 60) are left out, and the number left out is shown on the page.
  - A note at the top: "Text read from images with OCR. It may contain mistakes; check Show original if something looks wrong."
- **Afterwards:** reading modes, Simplify, the meaning check and repair all work on OCR text.
- **Accuracy:** generated scanned fixtures (an image-only PDF of known text, and a PNG). **Character error rate of 5% or less**, measured in a real browser.

---

## Milestones (stop after each one)

1. **Spec.** This file.
2. **Production-ready server.** Dockerfile, `render.yaml`, production settings, limits, cache expiry, `/privacy` and tests. Verified locally.
3. **Deploy to Render.** The owner's dashboard steps, then live verification from here.
4. **Web Store package.** Production build, icons, screenshots, listing and permission docs, zip, package checks.
5. **OCR.** Packaging, the PDF and image flow, the accuracy test, unit and browser tests.
6. **README and submission checklist.**

## Acceptance checks

- [ ] The production settings each have tests: CORS allows only configured IDs, docs are off, oversized bodies get 413, per-IP minute and day limits, the daily AI-call cap, and cache expiry.
- [ ] The live Render server passes `/health`, CORS, `/simplify`, `/check`, `/privacy` and the 64 KB limit, with `/docs` returning 404. No secrets are in the repo or in `render.yaml`.
- [ ] The production build has no `localhost`, only the deployed server as a required host, and version 1.0.0. The zip loads and works in Chrome for Testing.
- [ ] Every permission has a written justification and is used in code. No remotely hosted code.
- [ ] Five screenshots at 1280×800 and a 440×280 promo tile exist. Icons are clear at 16 px.
- [ ] OCR: character error rate of 5% or less on the clean fixtures. No network requests during OCR. Cancel works. Modes and Simplify work on OCR text.
- [ ] Strict TypeScript with no `any`, ruff and all tests pass. No user text in logs.
