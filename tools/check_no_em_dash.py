#!/usr/bin/env python3
"""Fail if the em dash (U+2014) appears in the site, the generated pages, or the
Kapex write-up that feeds /kotlin. See the 'No em dashes' rule in CLAUDE.md.

    python3 website/tools/check_no_em_dash.py
"""
import pathlib, sys

EM = "—"
HERE = pathlib.Path(__file__).resolve().parent
SITE = HERE.parent
REPO = SITE.parent
TEXT = {".html", ".css", ".js", ".md", ".py", ".json", ".txt", ".svg"}
SKIP = {".git", "node_modules"}

roots = [SITE, REPO / "jetbrains-page"]
files = [REPO / "kapex" / "docs" / "07-kotlin-on-the-balloon.md", REPO / "kapex" / "README.md", REPO / "CLAUDE.md"]
for r in roots:
    if r.exists():
        files += [p for p in r.rglob("*") if p.is_file() and p.suffix in TEXT and not (set(p.parts) & SKIP)]

# The rule text itself has to name the character; its explanation is the one allowed place.
bad = []
for p in sorted(set(files)):
    if not p.exists():
        continue
    for n, line in enumerate(p.read_text(encoding="utf-8", errors="replace").splitlines(), 1):
        if EM in line and not (p == HERE / "check_no_em_dash.py"):
            bad.append((p.relative_to(REPO), n, line.strip()[:100]))

if bad:
    for path, n, text in bad:
        print(f"{path}:{n}: {text}")
    print(f"\nFAIL: {len(bad)} line(s) contain an em dash.")
    sys.exit(1)
print(f"OK: no em dash in {len(set(files))} files checked.")
