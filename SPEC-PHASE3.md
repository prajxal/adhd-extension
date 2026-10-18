# Readwell: Phase 3 build spec (auto-repair, PPTX and PDF reading)

## How to work

- Same process as Phases 1 and 2: build the milestones in order, then **stop** after each one with a walkthrough and a "Decisions I made" list.
- If something isn't covered here, pick the simplest option and log it. Don't add features outside this spec.
- Every earlier architecture rule still applies: no LLM keys in the extension, injected UI in Shadow DOM, no user text in logs, and text sent only on an explicit user action.

## What we're building

1. **Auto-repair.** When the meaning check finds `problem` sentences, the server asks the simplifier once to fix just those sentences, checks the result again, and keeps a fix only if it passes.
2. **A Readwell reader page** (`reader.html`, an extension page) that opens documents as clean, readable text, with every Phase 1 and 2 feature working inside it:
   - **PPTX:** each slide's title, bullets (with indentation levels), tables and speaker notes.
   - **PDF reading view:** text extracted with PDF.js and rebuilt into headings and paragraphs, with a **Show original** toggle that draws the real pages.

### Out of scope for Phase 3

Old binary `.ppt` (show a "save as .pptx" message instead), OCR for scanned PDFs, text inside images, charts and SmartArt, editing documents, Google Slides and PowerPoint Online pages, deployment, other browsers, accounts and analytics.

---

## Auto-repair (server)

Runs inside `POST /check` when `MEANING_CHECK=llm` and `MEANING_REPAIR=on` (the default), and only if the check found at least one `problem` sentence.

1. **One repair call.** For each `problem` sentence, the simplifier gets its source sentence(s), the current simplified sentence and its reasons. It returns `{ "repairs": [{ "index": 0, "text": "..." }] }` at the same level as the original simplification (same level rules as the Phase 1 prompt), using `REPAIR_PROMPT_VERSION = "v1"`. A parse failure is retried once, as in Phase 1.
2. **Re-check.** Build the passage again with the repaired sentences swapped in, then run the full check (rules and judge) on it.
3. **Accept a fix only if:**
   - the repaired sentence's status is now `ok` or `check`, **and**
   - no other sentence got worse, **and**
   - the repair didn't add a new `problem`-level rule finding.

   Otherwise keep the original sentence and its flag.
4. If the repair or re-check call fails, return the plain check result. Never return an error because of repair.

`/check` response changes:
```jsonc
{
  "sentences": [{
    "index": 2, "status": "ok", "reasons": [],
    "repair": {                       // null when the sentence wasn't repaired
      "text": "The council did not rule out more delays.",
      "previous": "The council ruled out more delays.",
      "fixed": ["Negation may be lost (original says \"not\")."]   // the reasons the fix addressed
    }
  }],
  "summary": { "ok": 3, "check": 0, "problem": 0, "repaired": 1 },
  "judge": "llm",
  "cached": false
}
```
For a repaired sentence, `status` and `reasons` describe the **repaired** text. The cache key includes `REPAIR_PROMPT_VERSION` and the repair setting.

### Evaluation
`server/scripts/eval_repair.py` runs the repair on the 25 error cases from the Phase 2 evaluation set and reports how many fixes were accepted. **Targets:** at least 60% accepted, and 0 accepted fixes containing a `problem`-level rule finding. I'll also review 10 accepted fixes by hand.

---

## Auto-repair (card)

- A repaired sentence shows its **new text** with a "✎ Fixed" marker; screen readers hear "Fixed: ".
- Expanding it shows "Fixed: <reasons>", then "Earlier version: <previous text>", then the highlighted original.
- **Summary line:** "N sentences fixed" is added in front of the existing wording, e.g. "1 sentence fixed · ✓ Meaning check passed" or "1 sentence fixed · 1 to double-check".

---

## Reader page

### Opening documents

| Way in | Permission |
|---|---|
| **Open file…** on the reader page or in the popup; drag and drop onto the reader | None |
| Right-click a link → **Open in Readwell** (menu shown for links ending `.pdf` or `.pptx`) | `optional_host_permissions`, requested for that link's site only, the first time |
| Popup → **Open this PDF in Readwell** (shown when the active tab is a PDF) | Same, per site |

Limits: **25 MB** and **300 pages or slides**. Over a limit shows a clear message. `.ppt` files show "Readwell can't open old .ppt files. Save it as .pptx and try again."

The opened document's bytes stay in the reader tab. Nothing is sent to the server unless you click Simplify.

### Document model (`extension/src/docs/doc.ts`)
```ts
type Block =
  | { kind: 'heading'; text: string }
  | { kind: 'paragraph'; text: string }
  | { kind: 'list'; items: { text: string; level: number }[] }
  | { kind: 'table'; rows: string[][] }
  | { kind: 'notes'; paragraphs: string[] };
type Section = { label: string; title: string | null; blocks: Block[] };  // "Slide 3" / "Page 2"
type Doc = { kind: 'pdf' | 'pptx'; name: string; sections: Section[] };
```

### PPTX rules
- Slide order comes from `ppt/presentation.xml` (`sldIdLst`) and its relationships, not from file names.
- Shapes are read in document order, including shapes inside groups. Shapes with no text are skipped.
- The title comes from the `title` or `ctrTitle` placeholder. A slide with no title placeholder has `title: null`.
- **Bullets vs paragraphs:**
  - Paragraphs in body or object placeholders are list items, at level `a:pPr/@lvl` (default 0).
  - Paragraphs in other shapes are plain paragraphs, unless they carry `a:buChar` or `a:buAutoNum`.
  - `a:buNone` always means a plain paragraph.
- Runs are joined. `a:br` becomes a space. Empty paragraphs are dropped.
- **Tables:** `a:tbl` rows of cell text.
- **Notes:** the body placeholder of the slide's notes slide. Slide-number placeholders are ignored.

### PDF reading-view rules
- Text items are grouped into **lines** by baseline, splitting a line where there's a gap wider than three average character widths.
- **Columns:** within the body of a page, if lines start at two clearly separate x positions, read the left column before the right. A full-width line above the columns, such as a heading, comes first.
- Lines become **paragraphs** where the vertical gap is more than 1.4 × the usual line spacing, or where the font size changes.
- **Headings:** a line whose font is at least 1.25 × the page's main body font size.
- **Hyphenation:** a line ending in letter + "-" followed by a line starting with a lowercase letter is joined with the hyphen removed.
- **Removed:** lines repeated near the top or bottom on at least 60% of pages (running headers and footers, when there are 2 or more pages), and lines near the top or bottom that are only a page number.
- **Across pages:** a paragraph that ends a page without `.`, `!`, `?` or `:` continues into the first paragraph of the next page, and stays in the earlier page's section.
- **No text** anywhere: the message "This PDF has no selectable text (it may be scanned)."
- **Show original** draws each page as an image (PDF.js). Reading modes apply only to the reading view.

### Inside the reader
- Visual modes follow the popup toggles directly. The reader always counts as "turned on", whatever the per-site switches say.
- Simplify, the meaning check and auto-repair work exactly as on web pages: select text, get the button, see the same card.
- Light and dark mode; each section labelled "Slide N" or "Page N" with its title; keyboard accessible. Headings use real heading elements so screen readers can navigate them.

---

## Access model (changes a Phase 1 rule)

Phase 1 ran the content script on `<all_urls>`. Chrome treats that as access to every site: the extension could fetch any site, and it shows a "read and change all your data on all websites" warning at install. Phase 3 replaces it with least-privilege access:

| Situation | Access |
|---|---|
| A site the user turns on (popup) | Chrome asks once for that site. The content script is registered for it and injected into the open tab. Turning the site off removes the permission again. |
| Right-click → **Simplify selection** on any site | `activeTab`, which gives temporary access to that tab on click. No standing permission. |
| **Simplify button on every site** (opt-in switch in the popup) | Chrome's all-sites permission, requested only when the user switches this on. Reading modes still apply only on turned-on sites. |
| The reader opening a link | Chrome asks for that link's site. |

- Install-time host permissions: only the Readwell server (`http://localhost:8000/*`).
- The content script is registered at runtime (`chrome.scripting`) and guards against being injected twice.
- Automated tests use a separate build (`npm run build:e2e`, output in `.output-e2e/`, never shipped) that pre-grants access, because tests can't click Chrome's permission prompts.

## Fixtures

`extension/scripts/make-doc-fixtures.mjs` writes these into `extension/tests/fixtures/docs/`, each with an `.expected.json`:
- **`sample-deck.pptx`:** three slides stored out of order. Covers a title, bullets at two levels, runs split mid-sentence, speaker notes with a slide-number placeholder, a table, a non-bullet text box, a group shape, a text box with explicit bullets, an empty shape, and a slide without a title.
- **`one-column.pdf`:** two pages. Covers a running header, page-number footers, headings, a word hyphenated across lines and a paragraph continuing across the page break.
- **`two-column.pdf`:** a full-width heading over two columns.
- **`no-text.pdf`:** a page with only a drawn shape.
- **`legacy.ppt`:** an old binary-format header only.

---

## Milestones (stop after each one)

1. **Spec and fixtures.** This file, the document model, the fixture generator and the generated fixtures, plus a test that checks they're well-formed.
2. **Auto-repair on the server.** Prompt, re-check, acceptance rules, caching and config. Tests with FakeProvider, then the real repair evaluation.
3. **Auto-repair on the card.** Fixed marker, earlier version, summary wording. Unit and browser tests.
4. **Reader and PPTX.** Reader page, document rendering, PPTX parser, Open file and drag-and-drop, the link menu with per-site permission. Fixture tests plus a browser test of every mode and Simplify inside the reader.
5. **PDF reading view.** PDF.js loading under the extension's security policy, reflow, Show original, and the PDF-tab button. Fixture tests plus checks on real public PDFs.
6. **README.** Opening documents, permissions, auto-repair, limitations.

## Acceptance checks

- [ ] The auto-repair evaluation meets its targets (reported per model, honestly, if quota limits which models can run).
- [ ] No repair is ever accepted if it adds a `problem`-level rule finding. A failed repair never turns a working `/check` into an error.
- [ ] Each fixture parses exactly to its `.expected.json`.
- [ ] In the reader, Bold-prefix, ruler, spacing, Simplify, the meaning check and auto-repair work, and the card is styled the same as on web pages.
- [ ] Opening a document from a link asks for permission for that site only. Open file needs none.
- [ ] The release build has no install-time host permission besides the server, can't read other sites, and runs nowhere until the user allows a site (or opts in to every site).
- [ ] PDF.js runs under the extension's default security policy, with no `unsafe-eval`. The PDF worker loads from the extension package.
- [ ] Two real public PDFs and one real PPTX open with readable text, reported with screenshots.
- [ ] Strict TypeScript with no `any`, ruff and all tests pass. No user text in logs.
