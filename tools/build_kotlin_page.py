#!/usr/bin/env python3
"""Render kapex/docs/07-kotlin-on-the-balloon.md as /kotlin (kotlin/index.html) in the site's own design.

Run from anywhere:  python3 website/tools/build_kotlin_page.py
Reads the maintained Markdown from the main repo and writes website/kotlin/index.html.
"""
import pathlib, re, sys
import markdown  # python-markdown 3.x

HERE = pathlib.Path(__file__).resolve().parent
SITE = HERE.parent
SRC = SITE.parent / "kapex" / "docs" / "07-kotlin-on-the-balloon.md"
OUT = SITE / "kotlin" / "index.html"

text = SRC.read_text()
# Drop the H1 and the bold one-line summary: the page carries its own title block.
text = re.sub(r"^# .*\n", "", text, count=1)
m = re.search(r"\*\*(HAB-1: .*?)\*\*", text, re.S)
summary = " ".join(m.group(1).split()) if m else ""
text = text.replace(m.group(0), "", 1) if m else text
# The "Maintained document" line becomes the dateline.
dm = re.search(r"Maintained document\. Last updated (\d{4}-\d{2}-\d{2})\.", text)
updated = dm.group(1) if dm else ""
text = re.sub(r"Maintained document\..*?(?=\n\n)", "", text, count=1, flags=re.S)
# Changelog section: keep, but as a footnote-sized block.
body = markdown.markdown(text, extensions=["tables", "fenced_code", "sane_lists"])
# Strip the leading "N. " from headings; the number sits in a label instead.
def heading(mo):
    n, title = mo.group(2), mo.group(3)
    slug = re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-")
    return f'<h2 id="{slug}"><span class="label">{n.zfill(2)}</span>{title}</h2>'
body = re.sub(r'<h2>((\d+)\. (.*?))</h2>', heading, body)
body = body.replace("<h3>Changelog of this document</h3>", '<h3 class="doc__changelog">Changelog of this document</h3>')
body = body.replace("<hr />", "")
page = f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Boscon Space: Kotlin on the balloon</title>
  <meta name="description" content="{summary}">
  <meta property="og:title" content="Kotlin on the balloon">
  <meta property="og:description" content="{summary}">
  <meta property="og:image" content="https://space.ketoy.dev/assets/og.jpg">
  <meta property="og:url" content="https://space.ketoy.dev/kotlin">
  <link rel="canonical" href="https://space.ketoy.dev/kotlin">
  <meta name="theme-color" content="#0a0a0b">
  <link rel="icon" href="/assets/favicon-32.png" sizes="32x32" type="image/png">
  <link rel="apple-touch-icon" href="/assets/apple-touch-icon.png">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter+Tight:wght@400;500;600&family=Inter:wght@400;500&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/css/style.css?v=9">
  <link rel="stylesheet" href="/css/doc.css?v=2">
</head>
<body class="doc-page">

  <header class="nav" id="nav">
    <a class="brand" href="/" aria-label="Boscon Space, home"><img class="brand__mark" src="/assets/logo-mark.png" alt="" width="574" height="519"><img class="brand__wm" src="/assets/wordmark.png" alt="Boscon Space" width="836" height="173"></a>
    <nav class="nav__links" aria-label="Primary">
      <a href="/jetbrains">HAB-1 for JetBrains</a>
      <a href="/payload-box">Payload in 3D</a>
      <a href="/#contact">Contact</a>
    </nav>
    <button class="nav__toggle" id="navToggle" aria-expanded="false" aria-controls="menu" aria-label="Open menu"><span></span><span></span></button>
  </header>

  <div class="menu" id="menu" aria-hidden="true">
    <nav class="menu__links" aria-label="Mobile">
      <a href="/jetbrains">For JetBrains</a>
      <a href="/payload-box">Payload in 3D</a>
      <a href="/#contact">Contact</a>
    </nav>
    <a class="menu__foot" href="mailto:aditya@ketoy.dev">aditya@ketoy.dev</a>
  </div>

  <main id="top">
    <header class="doc__head">
      <span class="label">HAB-1 · Engineering write-up · Updated {updated}</span>
      <h1 class="doc__title">Kotlin on the balloon.</h1>
      <p class="doc__lede">{summary}</p>
      <p class="doc__note">Every number here was measured on our bench unless it says <em>assumed</em>. Changes are logged at the end.</p>
    </header>
    <article class="doc">
{body}
    </article>
    <nav class="doc__next" aria-label="Related">
      <a href="https://github.com/developerchunk/Kapex"><span>Kapex on GitHub<small>The source this write-up describes, under Apache 2.0.</small></span><span>GitHub</span></a>
      <a href="/jetbrains"><span>HAB-1, for JetBrains<small>The flight, the software, the bench results, and what we are asking.</small></span><span>Page</span></a>
      <a href="/payload-box"><span>The payload, in 3D<small>The honeycomb case for the flight computer. Explode it, section it, turn it.</small></span><span>Open</span></a>
      <a href="https://boscon-hab-predictor.vercel.app/"><span>The flight predictor<small>Landing predictor, burst calculator and wind climatology for HAB-1. Runs in the browser.</small></span><span>Open</span></a>
    </nav>
  </main>

  <footer class="foot">
    <span>© 2026 Boscon Space</span>
    <span>From docs/07 in the Kapex repository</span>
    <a href="#top">Back to top</a>
  </footer>

  <script src="https://cdn.jsdelivr.net/npm/lenis@1.1.18/dist/lenis.min.js"></script>
  <script src="/js/main.js?v=3"></script>
</body>
</html>
"""
OUT.write_text(page)
print(f"wrote {OUT.relative_to(SITE.parent)} from {SRC.relative_to(SITE.parent)} ({len(page):,} bytes)")
