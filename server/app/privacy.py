"""The privacy policy, served at /privacy (the Chrome Web Store needs a public URL)."""

from html import escape

PRIVACY_HTML = """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Readwell privacy policy</title>
<style>
  :root {{ color-scheme: light dark; }}
  body {{ max-width: 42rem; margin: 2rem auto; padding: 0 1rem; font: 17px/1.6 system-ui, sans-serif; }}
  h1 {{ font-size: 1.6rem; }} h2 {{ font-size: 1.15rem; margin-top: 2rem; }}
</style>
</head>
<body>
<h1>Readwell privacy policy</h1>
<p><em>Last updated: {updated}</em></p>

<p>Readwell is a Chrome extension that makes text easier to read. This page explains what
leaves your computer and what happens to it.</p>

<h2>What is sent, and when</h2>
<p>Only when you click <strong>Simplify</strong> (or choose <strong>Simplify selection</strong>
from the right-click menu), the text you selected and the reading level you chose are sent to
the Readwell server. The meaning check that follows uses the same text. Nothing is sent
automatically, and nothing is sent for the reading modes (bold-prefix, ruler, spacing).</p>

<h2>Who processes it</h2>
<p>The Readwell server sends the text to Google's Gemini API to simplify and check it. Google
processes it under the
<a href="https://ai.google.dev/gemini-api/terms">Gemini API terms</a>. Readwell does not send
your text anywhere else.</p>

<h2>What is stored</h2>
<ul>
  <li>To answer repeated requests quickly, the server keeps the text and its simplification in a
  cache for up to {cache_hours} hours, then deletes it.</li>
  <li>Server logs never contain your text: only its length, a one-way hash, the reading level
  and timings.</li>
  <li>To limit abuse, the server counts requests per IP address in memory for up to a day. These
  counts are not written to disk.</li>
  <li>Your Readwell settings are stored by Chrome in your browser (Chrome sync storage).</li>
</ul>

<h2>Documents and OCR</h2>
<p>PDF and PowerPoint files you open in the Readwell reader, and text read from images (OCR), are
processed on your computer. They are only sent to the server if you select some of their text and
click Simplify.</p>

<h2>What Readwell does not do</h2>
<p>No accounts, no advertising, no analytics or tracking, and no selling or sharing of data.</p>

<h2>Contact</h2>
<p>Questions or requests: {contact}</p>
</body>
</html>
"""

DEFAULT_CONTACT = "https://github.com/prajxal/adhd-extension/issues"
UPDATED = "18 October 2026"


def render_privacy(contact: str, cache_hours: float) -> str:
    target = contact.strip() or DEFAULT_CONTACT
    href = target if target.startswith("http") else f"mailto:{target}"
    link = f'<a href="{escape(href, quote=True)}">{escape(target)}</a>'
    hours = int(cache_hours) if float(cache_hours).is_integer() else cache_hours
    return PRIVACY_HTML.format(updated=UPDATED, cache_hours=hours, contact=link)
