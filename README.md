# Boscon Space — landing site

Static site, no build step. Each page is a directory with an `index.html`, so `/jetbrains`, `/kotlin` and `/payload-box` resolve on Vercel (`cleanUrls`, `trailingSlash: false`) and on any plain static server alike. Links never carry `.html`:

- `/` — `index.html`, the landing page
- `/jetbrains` — `jetbrains/index.html`, HAB-1 presented to JetBrains (same structure and photography rules as the landing page)
- `/kotlin` — `kotlin/index.html`, the "Kotlin on the balloon" write-up. **Generated**: edit `../kapex/docs/07-kotlin-on-the-balloon.md` in the main repo, then run `python3 tools/build_kotlin_page.py` (needs `pip install markdown`). Styles in `css/doc.css`.
- `/payload-box` — `payload-box/index.html`, the interactive 3D payload case (self-contained, three.js inlined)

Shared: `css/style.css`, `js/main.js`.

Live at https://space.ketoy.dev (Vercel, static). Serve locally:

```bash
npx --yes serve -l 8096 .
```

(`python3 -m http.server 8090 --directory .` works too; it answers `/payload-box` with a redirect to `/payload-box/`.)

CDN dependencies: Inter Tight and Inter (Google Fonts); GSAP 3.12 + ScrollTrigger (cdnjs); Lenis 1.1 (jsDelivr).
Photography is hot-linked from Unsplash (NASA and Unsplash contributors); download and self-host before production.

The page makes no numeric claims. Photography only: no drawn graphics, icons or illustrations.

Brand: the master lockup is `assets/brand/boscon-space-lockup.png`. `assets/logo-mark*.png` and `assets/wordmark*.png` are cut from it (white and colour, transparent); icons and `og.jpg` are derived from the same file.
