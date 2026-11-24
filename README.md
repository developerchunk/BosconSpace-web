# Boscon Space: landing site

Static site, no build step. Each page is a directory with an `index.html`, so `/jetbrains`, `/kotlin` and `/payload-box` resolve on Vercel (`cleanUrls`, `trailingSlash: false`) and on any plain static server alike. Links never carry `.html`:

- `/`: `index.html`, the landing page
- `/jetbrains`: `jetbrains/index.html`, HAB-1 presented to JetBrains (same structure and photography rules as the landing page)
- `/kotlin`: `kotlin/index.html`, the "Kotlin on the balloon" write-up. **Generated**: edit `../kapex/docs/07-kotlin-on-the-balloon.md` in the main repo, then run `python3 tools/build_kotlin_page.py` (needs `pip install markdown`). Styles in `css/doc.css`.
- `/payload-box`: `payload-box/index.html`, the interactive 3D payload case (self-contained, three.js inlined)
- `/hab-1-flight`: `hab-1-flight/index.html`, the public HAB-1 page with limited data: the 3D track with the readings of the moment, the two predictions and the re-run tracks, the simulation tables, 8 of the 411 LLM answers, the burst clip and 8 stills. No charts. It loads only its own files: data is in `hab-1-flight/data/*.js` as plain JS objects (`window.HAB1_FLIGHT`, `HAB1_ANSWERS`, `HAB1_STILLS`), **generated** by `hab1-launch/tools/make_public_page_data.py` in the main repo from the full, private flight page data (track every 10 s, positions to 4 decimals, no sensor text, no still positions), plus the what-if tracks for a burst at 25 and 30 km. The full data is only under `/hab-testing`, behind the PIN. The Mapbox token is not in git: `page.js` reads it from `/hab-1-flight/config.js`, which `middleware.js` serves (no PIN) from the Vercel variable `HAB_MAPBOX_TOKEN`
- `/pitch`: `pitch/index.html`, the investor deck (reveal.js 5.1 from cdnjs, styles in `pitch/pitch.css`, NASA public-domain photos self-hosted in `pitch/img/`). Arrow keys or swipe to move, `S` opens speaker notes, `F` goes full screen. The "Download PDF" button serves `pitch/boscon-space-pitch.pdf`, rendered from `/pitch?print-pdf` in headless Chromium (vector text, photos embedded as the original JPEGs). It is a static file: re-render it whenever a slide changes

- `/hab-testing`: internal pages behind a 6-digit PIN (Aditya, 2026-11-24): an index of 23 pages and 2 PDFs from HAB-1 (including the **full, private flight page**, allowed here only behind the PIN), HAB-2, the 3D case viewers and the ground station. **Generated**: `python3 tools/build_hab_testing.py` copies the pages from the main repo into `hab-testing/<slug>/`, adds a `<base>` per page, checks every relative link and em dashes. Rebuild after any source page changes. Not included by Aditya's choice: the fundraise deck, the DRDO and ISRO briefs, the restricted-area map
  - **The gate is `middleware.js`** (Vercel Routing Middleware), on the server, before the CDN cache: nothing under `/hab-testing` is sent without the PIN, data files included. `package.json` exists only to make it an ES module (`"type": "module"`); there are no dependencies
  - **Set in Vercel** (Project Settings, Environment Variables, Production): `HAB_TESTING_PIN` (6 digits) and `HAB_TESTING_SECRET` (32+ random characters). Without them `/hab-testing` answers 503. Changing either logs everyone out. Also `HAB_MAPBOX_TOKEN`: the HAB-1 page's Mapbox token, served as `/hab-testing/config.js` only after the PIN, so it is never in git (GitHub push protection rejected it in `hab1.js`); without it the page shows its map fallback
  - A right PIN sets an HttpOnly cookie for `/hab-testing`, 12 h; `/hab-testing/lock` clears it. A wrong PIN waits 1.5 s. **A 6-digit PIN has only 1,000,000 values, and the delay does not stop many attempts in parallel**: add a Vercel Firewall rate limit on `/hab-testing/unlock`, or use a longer PIN, if that matters
  - Tests: `node tools/test_gate.mjs` (20 checks; `--break` must fail). Local run with the gate: `node tools/dev_server.mjs` (port 8083, launch entry `website-gated`), test PIN from the git-ignored `.env.local`
  - `tools/` and `.env.local` are not deployed (`.vercelignore`)

Shared: `css/style.css`, `js/main.js`.

Live at https://boscon.space (Vercel, static). Serve locally:

```bash
npx --yes serve -l 8096 .
```

(`python3 -m http.server 8090 --directory .` works too; it answers `/payload-box` with a redirect to `/payload-box/`.)

CDN dependencies: Inter Tight and Inter (Google Fonts); GSAP 3.12 + ScrollTrigger (cdnjs); Lenis 1.1 (jsDelivr).
Photography is hot-linked from Unsplash (NASA and Unsplash contributors); download and self-host before production.

The page makes no numeric claims. Photography only: no drawn graphics, icons or illustrations.

Brand: the master lockup is `assets/brand/boscon-space-lockup.png`. `assets/logo-mark*.png` and `assets/wordmark*.png` are cut from it (white and colour, transparent); icons and `og.jpg` are derived from the same file.
