#!/usr/bin/env python3
"""Builds /hab-testing: copies the internal HAB pages from the main BosconSpace repo into
website/hab-testing/<slug>/ and writes the index. Everything under /hab-testing is behind the PIN
gate in website/middleware.js.

    python3 website/tools/build_hab_testing.py      # rebuild after any source page changes

Each copied page gets <base href="/hab-testing/<slug>/"> so its relative files load at the site's
no-trailing-slash URLs, and its in-page "#..." and "?..." links are pointed at its own clean URL.
Then every relative src/href in every copied page is checked to resolve to a file (fails if not),
and the copy is checked for em dashes.

Pages chosen by Aditya on 2026-11-24: HAB-2, HAB-1 build pages, CAD viewers, ground station, and the
full HAB-1 flight page (private flight data, allowed behind the PIN only). Not included: the
fundraise deck, the DRDO and ISRO briefs, the restricted-area map.
"""
import html
import os
import re
import shutil
import sys

SITE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REPO = os.path.dirname(SITE)
OUT = os.path.join(SITE, "hab-testing")
WEB = {".html", ".js", ".css", ".json", ".png", ".jpg", ".jpeg", ".webp", ".svg", ".mp4", ".pdf", ".ico", ".woff2"}

# group, slug, source (a folder, or one .html file), pages in it [(file, title, what it is)]
MANIFEST = [
    ("HAB-2: second flight", "hab-2-probe", "hab-2/cad/viewer", [
        ("index.html", "HAB-2 probe: radiators and heat path",
         "3D layout of the payload: Orin Nano, copper spreader, paraffin, eight heat pipes, four white radiator panels, 4S2P pack. Show the heat path, section cuts.")]),
    ("HAB-2: second flight", "hab-2-yagi", "hab-2/cad/yagi/viewer", [
        ("index.html", "433 MHz ground Yagi, 6 and 10 elements",
         "Ground-station antenna for the image downlink, with its elevation mount. Fabrication PDFs below.")]),
    ("HAB-1: first flight, 31 October 2026", "hab-1", "hab-1", [
        ("index.html", "HAB-1 flight: full data",
         "The whole flight: track, telemetry, the computer, the LLM's answers, stills and video. Private flight data.")]),
    ("HAB-1: build", "hab1-wiring", "hab1-launch/hab1-wiring-and-config.html", [
        ("index.html", "Wiring and configuration", "Flight wiring, pin to pin, and every radio and GPS setting.")]),
    ("HAB-1: build", "hab1-payload-assembly", "hab1-launch/payload-assembly.html", [
        ("index.html", "Payload assembly", "How the payload goes together, part by part.")]),
    ("HAB-1: build", "hab1-sim800l-capacitor", "hab1-launch/sim800l-capacitor.html", [
        ("index.html", "SIM800L capacitor", "The 1000 uF reservoir for the SMS backup's GSM bursts.")]),
    ("HAB-1: build", "hab1-sim800l-buck", "hab1-launch/sim800l-power-2s-buck.html", [
        ("index.html", "SIM800L power: 2S and buck", "Powering the SMS backup from 2S cells through a 4.0 V buck.")]),
    ("HAB-1: build", "hab1-dossier", "hab1-dossier.html", [
        ("index.html", "HAB-1 dossier", "The early engineering dossier.")]),
    ("HAB-1: build", "phase1-build-guide", "phase1-build-guide.html", [
        ("index.html", "Phase 1 build guide", "Bench build, step by step.")]),
    ("HAB-1: build", "sensor-integration-guide", "sensor-integration-guide.html", [
        ("index.html", "Sensor integration guide", "Wiring and reading each sensor.")]),
    ("3D: payload cases", "cad-cradle-v5", "cad/viewer_v5", [
        ("index.html", "Cradle v5", "Honeycomb cradle, strapped (rejected design, kept for the record).")]),
    ("3D: payload cases", "cad-canister-v6", "cad/viewer_v6", [
        ("index.html", "Canister v6", "Threaded canister.")]),
    ("3D: payload cases", "cad-case-v7", "cad/viewer_v7", [
        ("index.html", "Case v7: corner test piece", "The joint, keys and clips on one corner."),
        ("box.html", "Case v7: the full box", "190 mm box with finger joints and quarter-turn clips.")]),
    ("3D: payload cases", "cad-case-v8", "cad/viewer_v8", [
        ("box.html", "Case v8: honeycomb panels", "v7 with open honeycomb panels."),
        ("stack.html", "Case v8: whole box in one print", "All panels stacked for a single print.")]),
    ("3D: test hardware", "cad-test-rig", "cad/test_rig/viewer", [
        ("index.html", "Telemetry test rig enclosures", "Enclosures for the telemetry range tests.")]),
    ("3D: test hardware", "cad-heltec-mount", "cad/heltec_mount/viewer", [
        ("index.html", "Heltec mount", "Mount for the Heltec V3 board.")]),
    ("Ground station", "ground-station", "ground-station", [
        ("index.html", "Ground station", "Tracking, Yagi aiming and the receiver set-up."),
        ("yagi3d.html", "Yagi mount in 3D", "Antenna as delivered, the stand, beam and direction."),
        ("build-sheets.html", "Yagi stand build sheets", "Workshop sheets for the stand.")]),
    ("Ground station", "drift-analysis", "drift-analysis.html", [
        ("index.html", "Drift analysis", "Where the balloon drifts, and what that means for the ground station.")]),
    ("Ground station", "link-ecg", "link-ecg.html", [
        ("index.html", "Link ECG", "The radio link drawn as a heartbeat.")]),
]
# Served by middleware.js after the PIN, never a file in git: window.HAB_MAPBOX_TOKEN from the Vercel
# variable HAB_MAPBOX_TOKEN (GitHub push protection rejected the token in hab1.js, 2026-11-24).
CONFIG_JS = "/hab-testing/config.js"
TOKEN = re.compile(r"\b(?:pk|sk|tk)\.eyJ[A-Za-z0-9._-]{20,}")

EXTRA_FILES = {"hab-2-yagi": [("hab-2/cad/yagi/out/yagi_10el_fabrication.pdf", "10-element fabrication sheets (PDF)"),
                              ("hab-2/cad/yagi/out/yagi_6el_fabrication.pdf", "6-element fabrication sheets (PDF)")]}


def detoken(slug, d):
    """hab-1: the Mapbox token comes from CONFIG_JS instead of the source's literal."""
    if slug != "hab-1":
        return
    js = os.path.join(d, "hab1.js")
    s = open(js, encoding="utf-8").read()
    s, n = re.subn(r'const MAPBOX_TOKEN = "[^"]*";', 'const MAPBOX_TOKEN = window.HAB_MAPBOX_TOKEN || "";', s)
    if n != 1:
        raise SystemExit("hab-1/hab1.js: MAPBOX_TOKEN line not found")
    open(js, "w", encoding="utf-8").write(s)
    page = os.path.join(d, "index.html")
    h = open(page, encoding="utf-8").read()
    h, n = re.subn(r'(<script src="hab1\.js[^"]*"></script>)', f'<script src="{CONFIG_JS}"></script>\n  \\1', h)
    if n != 1:
        raise SystemExit("hab-1/index.html: hab1.js script tag not found")
    open(page, "w", encoding="utf-8").write(h)


def clean_url(slug, page):
    return f"/hab-testing/{slug}" + ("" if page == "index.html" else "/" + page[:-5])


def rewrite(text, slug, page):
    if re.search(r"<base\b", text, re.I):
        raise SystemExit(f"{slug}/{page} already has a <base>")
    here = clean_url(slug, page)
    head = re.search(r"<head[^>]*>", text, re.I)
    if not head:
        raise SystemExit(f"{slug}/{page}: no <head>")
    inject = (f'\n<base href="/hab-testing/{slug}/">'
              '\n<meta name="robots" content="noindex, nofollow">')
    text = text[:head.end()] + inject + text[head.end():]
    text = text.replace('href="#', f'href="{here}#').replace('href="?', f'href="{here}?')
    return text


def copy_folder(src, dst):
    for root, dirs, files in os.walk(src):
        dirs[:] = [d for d in dirs if not d.startswith((".", "__"))]
        for f in files:
            if os.path.splitext(f)[1].lower() in WEB:
                rel = os.path.relpath(os.path.join(root, f), src)
                os.makedirs(os.path.dirname(os.path.join(dst, rel)), exist_ok=True)
                shutil.copy2(os.path.join(root, f), os.path.join(dst, rel))


def resolves(url_path):
    p = os.path.join(SITE, url_path.lstrip("/"))
    return os.path.isfile(p) or os.path.isfile(p + ".html") or os.path.isfile(os.path.join(p, "index.html"))


def check_links(slug, page, text):
    bad = []
    text = re.sub(r"<base\b[^>]*>", "", text, flags=re.I)        # the folder itself, not a file
    for ref in re.findall(r'(?:src|href)="([^"]+)"', text):
        if re.match(r"(https?:|mailto:|data:|tel:|javascript:|#|\$\{|//)", ref) or "${" in ref:
            continue
        path = ref.split("#")[0].split("?")[0]
        if not path:
            continue
        url = path if path.startswith("/") else f"/hab-testing/{slug}/{path}"
        if url != CONFIG_JS and not resolves(url):
            bad.append(f"{slug}/{page}: {ref}")
    return bad


def index_html():
    groups = {}
    for g, slug, src, pages in MANIFEST:
        for page, title, what in pages:
            groups.setdefault(g, []).append((clean_url(slug, page), title, what))
        for f, label in EXTRA_FILES.get(slug, []):
            groups[g].append((f"/hab-testing/{slug}/files/{os.path.basename(f)}", label, "Print or send to the workshop."))
    cards = []
    for g, items in groups.items():
        lis = "".join(f'<li><a href="{u}"><span class="t">{html.escape(t)}</span><span class="w">{html.escape(w)}</span></a></li>'
                      for u, t, w in items)
        cards.append(f"<section><h2>{html.escape(g)}</h2><ul>{lis}</ul></section>")
    n = sum(len(pages) for *_, pages in MANIFEST)
    npdf = sum(len(v) for v in EXTRA_FILES.values())
    return f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow"><title>HAB Testing</title>
<link rel="icon" href="/assets/favicon-32.png" sizes="32x32" type="image/png">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter+Tight:wght@500;600&family=Inter:wght@400;500&display=swap" rel="stylesheet">
<style>
:root{{--bg:#0a0a0b;--fg:#f3f3f1;--dim:rgba(243,243,241,.6);--mute:rgba(243,243,241,.36);--rule:rgba(243,243,241,.14);--card:rgba(243,243,241,.04)}}
*{{box-sizing:border-box}}html,body{{margin:0;background:var(--bg);color:var(--fg);font:16px/1.5 Inter,"Helvetica Neue",Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased}}
a{{color:inherit;text-decoration:none}}
.wrap{{max-width:1100px;margin:0 auto;padding:56px 16px 72px}}
header{{display:flex;justify-content:space-between;align-items:flex-end;gap:16px;border-bottom:1px solid var(--rule);padding-bottom:22px;margin-bottom:8px;flex-wrap:wrap}}
h1{{font:500 clamp(30px,5vw,46px)/1 "Inter Tight",Inter,sans-serif;letter-spacing:-.03em;margin:0 0 10px}}
.sub{{color:var(--dim);margin:0;max-width:640px}}
.lock{{color:var(--dim);font-size:14px;border:1px solid var(--rule);border-radius:999px;padding:7px 14px}}
.lock:hover{{color:var(--fg);border-color:var(--fg)}}
h2{{font:500 13px/1 Inter,sans-serif;letter-spacing:.08em;text-transform:uppercase;color:var(--mute);margin:36px 0 12px}}
ul{{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:10px}}
li a{{display:block;height:100%;padding:16px 18px;border:1px solid var(--rule);border-radius:12px;background:var(--card);transition:border-color .2s}}
li a:hover{{border-color:var(--fg)}}
.t{{display:block;font-weight:500;margin-bottom:4px}}.w{{display:block;color:var(--dim);font-size:14px}}
footer{{color:var(--mute);font-size:13px;margin-top:48px;border-top:1px solid var(--rule);padding-top:16px}}
</style></head><body><div class="wrap">
<header><div><h1>HAB testing</h1><p class="sub">Boscon Space internal pages: {n} pages and {npdf} PDFs from HAB-1 and HAB-2, the 3D models and the ground station. Private: please do not share these links.</p></div>
<a class="lock" href="/hab-testing/lock">Lock</a></header>
{''.join(cards)}
<footer>Built by website/tools/build_hab_testing.py from the BosconSpace repo. Pages are copies; rebuild after a source changes.</footer>
</div></body></html>
"""


def main():
    if os.path.isdir(OUT):
        shutil.rmtree(OUT)
    os.makedirs(OUT)
    bad = []
    for g, slug, src, pages in MANIFEST:
        s, d = os.path.join(REPO, src), os.path.join(OUT, slug)
        if os.path.isdir(s):
            copy_folder(s, d)
        else:
            os.makedirs(d)
            shutil.copy2(s, os.path.join(d, "index.html"))
        for f, _ in EXTRA_FILES.get(slug, []):
            os.makedirs(os.path.join(d, "files"), exist_ok=True)
            shutil.copy2(os.path.join(REPO, f), os.path.join(d, "files", os.path.basename(f)))
        detoken(slug, d)
        for page, _, _ in pages:
            p = os.path.join(d, page)
            if not os.path.isfile(p):
                raise SystemExit(f"missing page {slug}/{page}")
        for root, _, files in os.walk(d):
            for f in files:
                if f.endswith(".html"):
                    p = os.path.join(root, f)
                    rel = os.path.relpath(p, d)
                    text = rewrite(open(p, encoding="utf-8").read(), slug, rel)
                    open(p, "w", encoding="utf-8").write(text)
                    bad += check_links(slug, rel, text)
    open(os.path.join(OUT, "index.html"), "w", encoding="utf-8").write(index_html())
    em, tokens = [], []
    for root, _, files in os.walk(OUT):
        for f in files:
            if os.path.splitext(f)[1] in (".html", ".js", ".css", ".json"):
                p = os.path.join(root, f)
                text = open(p, encoding="utf-8", errors="ignore").read()
                if "\u2014" in text:
                    em.append(os.path.relpath(p, SITE))
                if TOKEN.search(text):
                    tokens.append(os.path.relpath(p, SITE))
    size = sum(os.path.getsize(os.path.join(r, f)) for r, _, fs in os.walk(OUT) for f in fs)
    nfiles = sum(len(fs) for _, _, fs in os.walk(OUT))
    print(f"/hab-testing: {sum(len(p) for *_, p in MANIFEST)} pages, {nfiles} files, {size / 1e6:.1f} MB")
    print(f"[{'PASS' if not bad else 'FAIL'}] every relative src/href in the copied pages resolves" + "".join("\n    " + b for b in bad))
    print(f"[{'PASS' if not em else 'FAIL'}] no em dash in /hab-testing" + "".join("\n    " + e for e in em))
    print(f"[{'PASS' if not tokens else 'FAIL'}] no Mapbox token in /hab-testing (served from {CONFIG_JS} instead)"
          + "".join("\n    " + t for t in tokens))
    sys.exit(1 if bad or em or tokens else 0)


if __name__ == "__main__":
    main()
