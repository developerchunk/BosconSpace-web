/* HAB-1 public flight page. Data comes from the window.HAB1_* objects in /hab-1-flight/data/. */
(() => {
  "use strict";

  const ANS = window.HAB1_ANSWERS, STILLS = window.HAB1_STILLS, CLIP = window.HAB1_CLIP;
  const CLIP0_IST = 13 * 3600 + 46 * 60 + 45;   // burst clip starts 13:46:45 IST (08:16:45Z)
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const pad2 = n => String(n).padStart(2, "0");
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const mapUrl = s => `https://www.google.com/maps/search/?api=1&query=${s.lat},${s.lon}`;

  /* ---------------- reveal, nav ---------------- */

  document.body.classList.add("is-ready");
  const io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { e.target.classList.add("is-in"); io.unobserve(e.target); } }), { rootMargin: "0px 0px -8% 0px" });
  $$(".rv, .line").forEach(el => io.observe(el));
  const tog = $("#navToggle"), menu = $("#menu");
  tog.addEventListener("click", () => { const o = !menu.classList.contains("is-open"); menu.classList.toggle("is-open", o); tog.setAttribute("aria-expanded", o); menu.setAttribute("aria-hidden", !o); });
  $$("#menu a").forEach(a => a.addEventListener("click", () => { menu.classList.remove("is-open"); tog.setAttribute("aria-expanded", false); }));
  let lastY = 0; const nav = $("#nav");
  addEventListener("scroll", () => { const y = scrollY; nav.classList.toggle("is-hidden", y > lastY && y > 200 && !menu.classList.contains("is-open")); lastY = y; }, { passive: true });

  /* ---------------- onboard AI ---------------- */

  $("#answers").innerHTML = ANS.map((a, i) => `<li class="ans"><div class="ans__meta"><span class="label">${pad2(i + 1)} / ${pad2(ANS.length)}</span><b>${esc(a.k)}</b></div>
    <div><p class="ans__q">${esc(a.q)}</p><p class="ans__a">${esc(a.a)}</p></div></li>`).join("");

  /* ---------------- footage ---------------- */

  const v = $("#vid"), read = $("#vidRead");
  const upd = () => {
    const s = Math.floor(v.currentTime || 0), d = CLIP0_IST + s;
    const vz = CLIP.vz[Math.min(CLIP.vz.length - 1, Math.round((v.currentTime || 0) / 2))];
    const motion = vz == null ? "" : ` · ${s < CLIP.burst ? "climbing" : "falling"} ${Math.abs(vz).toFixed(1)} m/s`;
    read.textContent = `${pad2(Math.floor(d / 3600))}:${pad2(Math.floor(d / 60) % 60)}:${pad2(d % 60)} IST${motion}`;
  };
  v.addEventListener("timeupdate", upd); v.addEventListener("loadedmetadata", upd); upd();

  const g = $("#gallery");
  g.innerHTML = STILLS.map((s, i) => `<li data-i="${i}"><button class="g__open" aria-label="Open ${esc(s.label)}"><img src="/hab-1-flight/img/${s.file}-s.jpg" alt="${esc(s.label)}, from HAB-1 at ${s.ist} IST" loading="lazy" width="640" height="360"></button>
    <div class="g__cap"><span><b>${esc(s.label)}</b> ${s.ist} IST</span><a href="${mapUrl(s)}" target="_blank" rel="noopener">View on map</a></div></li>`).join("");
  const lb = $("#lightbox");
  g.addEventListener("click", e => {
    const btn = e.target.closest(".g__open"); if (!btn) return;
    const s = STILLS[+btn.closest("li").dataset.i];
    $("#lbImg").src = `/hab-1-flight/img/${s.file}.jpg`; $("#lbImg").alt = btn.querySelector("img").alt;
    $("#lbCap").innerHTML = `<b>${esc(s.label)}</b><span>${s.ist} IST</span><a class="btn" href="${mapUrl(s)}" target="_blank" rel="noopener">View on map</a>`;
    lb.showModal();
  });
  $("#lbClose").addEventListener("click", () => lb.close());
  lb.addEventListener("click", e => { if (e.target === lb) lb.close(); });
})();
