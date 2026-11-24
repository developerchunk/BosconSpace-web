/* HAB-1 full flight page (private, never in the website repo). Data from data/*.json, built by hab1-launch/tools/make_flight_page_data.py
   in the main repo. One playback time (state.t, seconds from release) drives the map, the HUD and the
   cursor line on every chart. */
(() => {
  "use strict";

  const MAPBOX_TOKEN = window.HAB_MAPBOX_TOKEN || "";
  const REL = 1793430426;            // release, 07:07:06Z
  const CLIP0 = 1793434605;          // Lenovo clip 0050 starts 08:16:45Z (file name)
  const IST = 19800;
  const W = "#f3f3f1", G = "rgba(243,243,241,0.55)", D = "rgba(243,243,241,0.32)";
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const nf = (v, d = 0) => v == null || isNaN(v) ? "none" : v.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
  const pad2 = n => String(n).padStart(2, "0");
  const clock = (epoch, tz = IST) => { const s = Math.floor(epoch + tz); const d = ((s % 86400) + 86400) % 86400; return `${pad2(Math.floor(d / 3600))}:${pad2(Math.floor(d / 60) % 60)}:${pad2(d % 60)}`; };
  const tplus = t => { const s = Math.abs(Math.round(t)); return `T${t < 0 ? "−" : "+"}${pad2(Math.floor(s / 3600))}:${pad2(Math.floor(s / 60) % 60)}:${pad2(s % 60)}`; };
  const minus = s => String(s).replace(/^-/, "−");

  // index of the last element <= t in a sorted array
  const idx = (arr, t) => { let lo = 0, hi = arr.length - 1; if (t < arr[0]) return -1; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (arr[m] <= t) lo = m; else hi = m - 1; } return lo; };
  const near = (ser, key, t, maxGap) => { const i = idx(ser.t, t); if (i < 0) return null; if (maxGap && t - ser.t[i] > maxGap) return null; return ser[key][i]; };

  let F, LLM, STILLS, SIM = null, CLIM = null, LIVE = null;
  const state = { t: 0, playing: false, speed: 180, view: "3d", sync: false, orbit: false };
  const onTime = [];
  let lastChartDraw = 0;

  function setT(t, opts = {}) {
    const sc = $("#scrub");
    state.t = Math.max(+sc.min, Math.min(+sc.max, t));
    for (const f of onTime) f(state.t, opts);
  }

  /* ---------------- boot ---------------- */

  const j = u => fetch(u).then(r => { if (!r.ok) throw new Error(u + " " + r.status); return r.json(); });
  Promise.all([j("data/flight.json"), j("data/llm.json"), j("data/stills.json"),
               j("data/sim.json").catch(() => null), j("data/clim.json").catch(() => null), j("data/live.json").catch(() => null)])
    .then(([f, l, s, sim, clim, live]) => {
      F = f; LLM = l; STILLS = s; SIM = sim; CLIM = clim; LIVE = live;
      initPlayer(); initHud(); initMap(); initCharts(); initProfiles(); initSim(); initClim(); initAI(); initFootage();
      setT(0);
    })
    .catch(e => { console.error(e); });

  /* ---------------- reveal, nav ---------------- */

  document.body.classList.add("is-ready");
  const io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { e.target.classList.add("is-in"); io.unobserve(e.target); } }), { rootMargin: "0px 0px -8% 0px" });
  $$(".rv, .line").forEach(el => io.observe(el));
  const tog = $("#navToggle"), menu = $("#menu");
  tog.addEventListener("click", () => { const o = !menu.classList.contains("is-open"); menu.classList.toggle("is-open", o); tog.setAttribute("aria-expanded", o); menu.setAttribute("aria-hidden", !o); });
  $$("#menu a").forEach(a => a.addEventListener("click", () => { menu.classList.remove("is-open"); tog.setAttribute("aria-expanded", false); }));
  let lastY = 0; const nav = $("#nav");
  addEventListener("scroll", () => { const y = scrollY; nav.classList.toggle("is-hidden", y > lastY && y > 200 && !menu.classList.contains("is-open")); lastY = y; }, { passive: true });

  // a small bar that offers to take you to the map after a click elsewhere moved the time
  const toast = document.createElement("div");
  toast.className = "toast"; toast.innerHTML = `<span></span><a href="#map">Go to the map</a>`;
  document.body.appendChild(toast);
  let toastTimer;
  function showToast(t) {
    toast.firstChild.textContent = `Map set to ${clock(REL + t)} IST, ${tplus(t)}`;
    toast.classList.add("is-on"); clearTimeout(toastTimer); toastTimer = setTimeout(() => toast.classList.remove("is-on"), 4200);
  }
  function jump(t) { setT(t); const r = $("#mapwrap").getBoundingClientRect(); if (r.bottom < 0 || r.top > innerHeight) showToast(t); }

  /* ---------------- player ---------------- */

  function initPlayer() {
    const sc = $("#scrub"), btn = $("#playBtn"), player = $("#player");
    const span = +sc.max - +sc.min;
    const keyT = new Set([0, F.meta.burst_t, F.meta.touch_t]);
    $("#ticks").innerHTML = F.events.filter(e => e.t >= +sc.min).map(e => `<span class="${keyT.has(e.t) ? "is-key" : ""}" style="left:${(e.t - sc.min) / span * 100}%" title="${e.name}"></span>`).join("");
    $("#events").innerHTML = F.events.filter(e => e.t >= +sc.min).map(e => `<li data-t="${e.t}"><time>${clock(REL + e.t)} IST</time><h4>${e.name.replace(/-/g, "−")}</h4></li>`).join("");
    $$("#events li").forEach(li => li.addEventListener("click", () => setT(+li.dataset.t)));
    sc.addEventListener("input", () => { setT(+sc.value); });
    btn.addEventListener("click", () => toggle());
    $$("[data-speed]").forEach(b => b.addEventListener("click", () => { state.speed = +b.dataset.speed; $$("[data-speed]").forEach(x => x.classList.toggle("is-on", x === b)); }));
    function toggle(on = !state.playing) {
      state.playing = on; player.classList.toggle("is-playing", on); btn.setAttribute("aria-label", on ? "Pause" : "Play");
      if (on) { if (state.t >= +sc.max - 1) setT(+sc.min); last = performance.now(); requestAnimationFrame(tick); }
    }
    let last = 0;
    function tick(now) {
      if (!state.playing) return;
      const dt = Math.min(0.1, (now - last) / 1000); last = now;
      setT(state.t + dt * state.speed, { playing: true });
      if (state.t >= +sc.max) toggle(false); else requestAnimationFrame(tick);
    }
    onTime.push(t => {
      sc.value = t; sc.style.setProperty("--p", ((t - sc.min) / span * 100) + "%");
      $$("#events li").forEach(li => li.classList.toggle("is-past", +li.dataset.t <= t));
    });
    // play when the map comes into view the first time
    const once = new IntersectionObserver(es => { if (es[0].isIntersecting) { once.disconnect(); setTimeout(() => { if (!state.playing && state.t <= 0) toggle(true); }, 900); } }, { threshold: 0.55 });
    once.observe($("#mapwrap"));
    addEventListener("keydown", e => { if (e.code === "Space" && document.activeElement === document.body) { const r = $("#mapwrap").getBoundingClientRect(); if (r.top < innerHeight && r.bottom > 0) { e.preventDefault(); toggle(); } } });
  }

  /* ---------------- HUD ---------------- */

  const distM = (a, b) => { const r = Math.PI / 180, p1 = a[0] * r, p2 = b[0] * r, x = Math.sin((p2 - p1) / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin((b[1] - a[1]) * r / 2) ** 2; return 2 * 6371008.8 * Math.asin(Math.sqrt(x)); };
  function initHud() {
    if (LIVE) { LIVE._t = LIVE.est.map(e => e[0]); LIVE._miss = LIVE.est.map(e => distM([e[1], e[2]], F.meta.landing)); }
    const tr = F.track, bo = F.baro_out, bi = F.baro_in, h = F.health, m = F.meta;
    onTime.push(t => {
      $("#hudT").textContent = tplus(t);
      $("#hudClock").textContent = clock(REL + t) + " IST";
      $("#hudPhase").textContent = t < 0 ? "On the pad" : t < m.burst_t - 3 ? "Climbing" : t < m.burst_t + 6 ? "Burst" : t < m.touch_t ? "Descending under parachute" : "Landed";
      const i = idx(tr.t, t);
      if (i >= 0) {
        $("#hudAlt").textContent = nf(tr.alt[i]) + " m";
        const vz = tr.vz[i] != null && Math.abs(tr.vz[i]) < 0.05 ? 0 : tr.vz[i]; $("#hudVz").textContent = vz == null ? "none" : minus((vz > 0 ? "+" : "") + nf(vz, 1)) + " m/s";
        $("#hudVh").textContent = tr.vh[i] == null ? "none" : nf(tr.vh[i], 1) + " m/s";
        $("#hudD").textContent = nf(tr.dpad[i], 1) + " km";
      }
      const to = near(bo, "c", t, 10), p = near(bo, "hpa", t, 10), ti = near(bi, "c", t, 10), soc = near(h, "soc", t, 30);
      $("#hudTo").textContent = to == null ? "none" : minus(nf(to, 1)) + " °C";
      $("#hudP").textContent = p == null ? "none" : nf(p, p < 100 ? 1 : 0) + " hPa";
      $("#hudTi").textContent = ti == null ? (t > m.touch_t - 20 ? "lost" : "none") : nf(ti, 1) + " °C";
      $("#hudSoc").textContent = soc == null ? "none" : nf(soc, 1) + " °C";
      if (LIVE) { const k = idx(LIVE._t, t); $("#hudLive").textContent = k < 0 ? "none yet" : nf(LIVE._miss[k] / 1000, LIVE._miss[k] < 10000 ? 2 : 1) + " km from where it landed"; }
    });
  }

  /* ---------------- map ---------------- */

  let map, layer3d;
  function initMap() {
    const tr = F.track;
    if (!window.mapboxgl || MAPBOX_TOKEN.indexOf("pk.") !== 0) { $("#mapFallback").hidden = false; return; }
    mapboxgl.accessToken = MAPBOX_TOKEN;
    const pad = F.meta.pad, land = F.meta.landing;
    try {
      map = new mapboxgl.Map({
        container: "mapEl", style: "mapbox://styles/mapbox/satellite-v9", projection: "mercator",
        center: [76.03, 17.93], zoom: 8.7, pitch: 62, bearing: -24, antialias: true,
        cooperativeGestures: true, attributionControl: true, maxPitch: 80,
      });
    } catch (e) { $("#mapFallback").hidden = false; return; }
    if (/[?&]debug\b/.test(location.search)) window.hab1Map = map;
    map.addControl(new mapboxgl.NavigationControl({ visualizePitch: true }), "bottom-left");
    map.on("error", e => console.warn("map", e && e.error && e.error.message));

    map.on("style.load", () => {
      map.addSource("dem", { type: "raster-dem", url: "mapbox://mapbox.mapbox-terrain-dem-v1", tileSize: 512, maxzoom: 14 });
      map.setTerrain({ source: "dem", exaggeration: 1 });
      map.setFog({ range: [2, 14], color: "rgb(28,30,36)", "high-color": "rgb(16,22,38)", "space-color": "rgb(6,6,9)", "horizon-blend": 0.06, "star-intensity": 0.12 });

      const line = (id, coords, paint, layout = {}) => {
        map.addSource(id, { type: "geojson", data: { type: "Feature", geometry: { type: "LineString", coordinates: coords } } });
        map.addLayer({ id, type: "line", source: id, paint, layout: Object.assign({ "line-cap": "round", "line-join": "round" }, layout) });
      };
      const flownCoords = tr.t.map((t, i) => [tr.lon[i], tr.lat[i]]).filter((c, i) => tr.t[i] >= 0 && tr.t[i] <= F.meta.touch_t);
      line("flown-all", flownCoords, { "line-color": W, "line-opacity": 0.28, "line-width": 1.5 });
      line("flown-played", [], { "line-color": W, "line-opacity": 0.95, "line-width": 2.5 });

      // 58 NM limit around the pad
      const ring = []; for (let a = 0; a <= 360; a += 3) { const r = 107.4 / 6371.0088, b = a * Math.PI / 180, la = pad[0] * Math.PI / 180, lo = pad[1] * Math.PI / 180;
        const la2 = Math.asin(Math.sin(la) * Math.cos(r) + Math.cos(la) * Math.sin(r) * Math.cos(b));
        const lo2 = lo + Math.atan2(Math.sin(b) * Math.sin(r) * Math.cos(la), Math.cos(r) - Math.sin(la) * Math.sin(la2)); ring.push([lo2 * 180 / Math.PI, la2 * 180 / Math.PI]); }
      line("limit", ring, { "line-color": W, "line-opacity": 0.6, "line-width": 1, "line-dasharray": [3, 3] }, { visibility: "none" });

      // live prediction: one landing estimate per packet heard, from the predictor's Live tab during the flight
      if (LIVE) {
        const est = LIVE.est;
        line("live-trail", est.map(e => [e[2], e[1]]), { "line-color": W, "line-opacity": 0.55, "line-width": 1.2, "line-dasharray": [1, 1.5] });
        map.addSource("live-pts", { type: "geojson", data: { type: "FeatureCollection", features: est.map(e => ({ type: "Feature", properties: { t: e[0] }, geometry: { type: "Point", coordinates: [e[2], e[1]] } })) } });
        map.addLayer({ id: "live-pts", type: "circle", source: "live-pts", paint: { "circle-radius": 2, "circle-color": W, "circle-opacity": 0.55 } });
        map.addSource("live-now", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
        map.addLayer({ id: "live-now", type: "circle", source: "live-now", paint: { "circle-radius": 7, "circle-color": "rgba(0,0,0,0)", "circle-stroke-color": W, "circle-stroke-width": 2.5 } });
        map.addLayer({ id: "live-now-lbl", type: "symbol", source: "live-now", layout: { "text-field": ["get", "label"], "text-size": 12, "text-offset": [1.1, 0], "text-anchor": "left", "text-allow-overlap": true, "text-font": ["DIN Pro Medium", "Arial Unicode MS Regular"] },
          paint: { "text-color": W, "text-halo-color": "rgba(0,0,0,0.85)", "text-halo-width": 1.4 } });
      }

      // pre-flight predicted landings (docs/07 section 0.15) and simulation paths
      const pre = [["11:00", 18.0659, 75.9991], ["12:00", 18.0662, 76.0305], ["13:00", 18.0558, 76.0575], ["14:00", 18.0401, 76.0652]];
      map.addSource("pre", { type: "geojson", data: { type: "FeatureCollection", features: pre.map(p => ({ type: "Feature", properties: { n: p[0] }, geometry: { type: "Point", coordinates: [p[2], p[1]] } })) } });
      map.addLayer({ id: "pre", type: "circle", source: "pre", layout: { visibility: "none" }, paint: { "circle-radius": 5, "circle-color": "rgba(0,0,0,0)", "circle-stroke-color": W, "circle-stroke-width": 1.5 } });
      map.addLayer({ id: "pre-lbl", type: "symbol", source: "pre", filter: ["==", ["get", "n"], "12:00"], layout: { visibility: "none", "text-field": "Pre-flight prediction (run 07:10 IST): landings for 11:00 to 14:00 IST releases", "text-size": 11, "text-offset": [0, 1.3], "text-anchor": "top", "text-font": ["DIN Pro Medium", "Arial Unicode MS Regular"] },
        paint: { "text-color": W, "text-halo-color": "rgba(0,0,0,0.75)", "text-halo-width": 1.2 } });
      const sp = simPaths();
      if (sp.pre) line("sim-pre", sp.pre.map(p => [p[2], p[1]]), { "line-color": W, "line-opacity": 0.75, "line-width": 1.5, "line-dasharray": [2, 2] }, { visibility: "none" });
      if (sp.hind) line("sim-hind", sp.hind.map(p => [p[2], p[1]]), { "line-color": W, "line-opacity": 0.85, "line-width": 1.5, "line-dasharray": [0.5, 2] }, { visibility: "none" });

      const mk = (ll, text, below) => { const el = document.createElement("div"); el.className = "map-label" + (below ? " map-label--below" : ""); el.textContent = text; new mapboxgl.Marker({ element: el, anchor: below ? "top" : "bottom" }).setLngLat([ll[1], ll[0]]).addTo(map);
        const dot = document.createElement("div"); dot.className = "map-dot"; new mapboxgl.Marker({ element: dot }).setLngLat([ll[1], ll[0]]).addTo(map); };
      mk(pad, "Pad, 12:37 IST");
      mk(land, "Landed, 14:41 IST");
      mk([17.958576, 76.074326], "Below the burst", true);

      layer3d = makeLayer3d(sp);
      map.addLayer(layer3d);
      setView("3d", true);
      setT(state.t);
    });

    let lastSet = 0;
    onTime.push((t, o) => {
      if (!map || !map.getSource("flown-played")) return;
      const now = performance.now();
      if (layer3d) { layer3d.setTime(t); map.triggerRepaint(); }
      if (o.playing && now - lastSet < 200) return;
      lastSet = now;
      const n = idx(tr.t, Math.min(t, F.meta.touch_t)), coords = [];
      for (let i = 0; i <= n; i++) if (tr.t[i] >= 0) coords.push([tr.lon[i], tr.lat[i]]);
      map.getSource("flown-played").setData({ type: "Feature", geometry: { type: "LineString", coordinates: coords.length > 1 ? coords : [] } });
      if (LIVE && map.getSource("live-now")) {
        const k = idx(LIVE._t, t), e = LIVE.est[k];
        map.getSource("live-now").setData({ type: "FeatureCollection", features: k < 0 ? [] : [{ type: "Feature", properties: { label: `Live prediction, ${clock(REL + e[0]).slice(0, 5)} IST` }, geometry: { type: "Point", coordinates: [e[2], e[1]] } }] });
        map.setFilter("live-pts", ["<=", ["get", "t"], t]);
      }
    });
    onTime.push(t => {
      if (!map || state.view !== "follow") return;
      const tr = F.track, n = idx(tr.t, Math.min(t, F.meta.touch_t));
      if (n >= 0 && !map.isMoving()) map.jumpTo({ center: [tr.lon[n], tr.lat[n]] });
    });

    $$("[data-view]").forEach(b => b.addEventListener("click", () => setView(b.dataset.view)));
    [map.dragRotate, map.touchZoomRotate, map.touchPitch, map.keyboard, map.dragPan].forEach(h => h && h.enable());
    $$("[data-turn]").forEach(b => b.addEventListener("click", () => map.easeTo({ bearing: map.getBearing() + +b.dataset.turn, duration: 700 })));
    $$("[data-tilt]").forEach(b => b.addEventListener("click", () => map.easeTo({ pitch: Math.max(0, Math.min(80, map.getPitch() + +b.dataset.tilt)), duration: 500 })));
    const orbitBtn = $("#orbitBtn"); let orbitLast = 0;
    const orbit = now => { if (!state.orbit) return; const dt = Math.min(0.1, (now - orbitLast) / 1000); orbitLast = now; if (!map.isMoving() || state.view === "follow") map.setBearing(map.getBearing() + dt * 8); requestAnimationFrame(orbit); };
    const setOrbit = on => { state.orbit = on; orbitBtn.classList.toggle("is-on", on); orbitBtn.setAttribute("aria-pressed", on); if (on) { orbitLast = performance.now(); requestAnimationFrame(orbit); } };
    orbitBtn.addEventListener("click", () => setOrbit(!state.orbit));
    ["mousedown", "touchstart", "wheel"].forEach(ev => map.getCanvasContainer().addEventListener(ev, () => setOrbit(false), { passive: true }));
    // In 3D and Follow, a mouse drag orbits the view (turn and tilt); right-drag or Shift-drag moves it.
    // Touch keeps Mapbox's own gestures (two fingers to move, turn and tilt).
    const cv = map.getCanvasContainer(); let drag = null;
    cv.addEventListener("contextmenu", e => { if (state.view !== "plan") e.preventDefault(); });
    cv.addEventListener("pointerdown", e => {
      if (state.view === "plan" || e.pointerType === "touch") return;
      drag = { x: e.clientX, y: e.clientY, pan: e.button === 2 || e.shiftKey }; cv.setPointerCapture(e.pointerId); cv.classList.add("is-dragging");
    });
    cv.addEventListener("pointermove", e => {
      if (!drag) return;
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y; drag.x = e.clientX; drag.y = e.clientY;
      if (drag.pan) map.panBy([-dx, -dy], { duration: 0 });
      else map.jumpTo({ bearing: map.getBearing() - dx * 0.35, pitch: Math.max(0, Math.min(80, map.getPitch() - dy * 0.25)) });
    });
    const endDrag = () => { drag = null; cv.classList.remove("is-dragging"); };
    cv.addEventListener("pointerup", endDrag); cv.addEventListener("pointercancel", endDrag);
    $("#layersBtn").addEventListener("click", e => { const o = $("#layers").classList.toggle("is-open"); e.currentTarget.classList.toggle("is-on", o); e.currentTarget.setAttribute("aria-expanded", o); });
    $$("[data-layer]").forEach(cb => cb.addEventListener("change", () => setLayer(cb.dataset.layer, cb.checked)));
  }

  function setView(v, instant) {
    state.view = v;
    if (map) [map.dragPan, map.dragRotate].forEach(h => v === "plan" ? h.enable() : h.disable());
    $$("[data-view]").forEach(b => b.classList.toggle("is-on", b.dataset.view === v));
    if (!map) return;
    const opt = { duration: instant ? 0 : 1800, essential: true };
    const small = innerWidth < 700;
    if (v === "3d") map.flyTo(Object.assign({ center: [76.04, 17.90], zoom: small ? 8.6 : 9.45, pitch: 66, bearing: -32 }, opt));
    else if (v === "plan") map.fitBounds([[75.78, 17.68], [76.28, 18.18]], Object.assign({ pitch: 0, bearing: 0, padding: small ? 30 : { top: 40, bottom: 40, left: 320, right: 230 } }, opt));
    else {
      const tr = F.track, n = Math.max(0, idx(tr.t, Math.min(state.t, F.meta.touch_t)));
      map.flyTo(Object.assign({ center: [tr.lon[n], tr.lat[n]], zoom: 10.6, pitch: 70, bearing: 20 }, opt));
    }
  }

  function setLayer(name, on) {
    if (!map) return;
    const vis = on ? "visible" : "none";
    const ids = { flown: ["flown-all", "flown-played"], pre: ["pre", "pre-lbl", "sim-pre"], live: ["live-trail", "live-pts", "live-now", "live-now-lbl"], hind: ["sim-hind"], gs: [], limit: ["limit"] }[name];
    ids.forEach(id => map.getLayer(id) && map.setLayoutProperty(id, "visibility", vis));
    if (layer3d) { layer3d.show[name] = on; map.triggerRepaint(); }
  }

  function simPaths() {
    const sc = SIM && SIM.scenarios;
    if (!sc) return {};
    return { pre: sc.preflight && sc.preflight.path, hind: sc.as_flown && sc.as_flown.path };
  }

  // Custom WebGL layer: the flown track in 3D, a translucent curtain to the ground, the payload marker,
  // and the simulated paths. Positions are Mercator coordinates with altitude in metres.
  function makeLayer3d(sp) {
    const tr = F.track, base = 470;
    const MC = (lon, lat, alt) => mapboxgl.MercatorCoordinate.fromLngLat([lon, lat], alt);
    const pts = [], times = [];
    for (let i = 0; i < tr.t.length; i++) if (tr.t[i] >= 0 && tr.t[i] <= F.meta.touch_t) { pts.push([tr.lon[i], tr.lat[i], tr.alt[i]]); times.push(tr.t[i]); }
    const line = new Float32Array(pts.length * 4), curtain = new Float32Array(pts.length * 8);
    pts.forEach((p, i) => { const a = MC(p[0], p[1], p[2]), g = MC(p[0], p[1], base);
      line.set([a.x, a.y, a.z, 1], i * 4); curtain.set([g.x, g.y, g.z, 0, a.x, a.y, a.z, 1], i * 8); });
    const simBuf = {};
    const mkSim = path => { const b = new Float32Array(path.length * 4); path.forEach((p, i) => { const a = MC(p[2], p[1], p[3]); b.set([a.x, a.y, a.z, 1], i * 4); }); return b; };
    if (sp.pre) simBuf.pre = mkSim(sp.pre);
    if (sp.hind) simBuf.hind = mkSim(sp.hind);
    // packets heard on the ground, drawn where the balloon was when it sent them; brighter = better SNR
    const gs = F.gs, gT = [], gP = [];
    gs.t.forEach((t, i) => { if (t < 0 || t > F.meta.touch_t || gs.lat[i] == null) return; const a = MC(gs.lon[i], gs.lat[i], gs.alt[i]);
      gT.push(t); gP.push(a.x, a.y, a.z, Math.max(0.25, Math.min(1, (gs.snr[i] + 16) / 24))); });
    const gsBuf = new Float32Array(gP); let gk = -1;

    let gl, prog, uM, uC, uB, uS, aP, vao = null, bufs = {}, k = 0, marker = new Float32Array(8), markerDirty = true;
    const L = {
      id: "track3d", type: "custom", renderingMode: "3d",
      show: { flown: true, pre: false, live: true, hind: false, gs: false, limit: false }, ready: false,
      setTime(t) {
        k = Math.max(0, idx(times, t)); gk = idx(gT, t);
        const p = pts[k], a = MC(p[0], p[1], p[2]), g = MC(p[0], p[1], base);
        marker.set([g.x, g.y, g.z, 0.25, a.x, a.y, a.z, 1]);
        markerDirty = true;
      },
      onAdd(m, g) {
        gl = g;
        const vs = `attribute vec4 a_p; uniform mat4 u_m; uniform float u_s; varying float v_a;
          void main(){ gl_Position = u_m * vec4(a_p.xyz, 1.0); gl_PointSize = u_s; v_a = a_p.w; }`;
        const fs = `precision highp float; uniform vec4 u_c; uniform float u_b; uniform float u_s; varying float v_a;
          void main(){ float a = u_c.a * mix(u_b, 1.0, v_a);
            if (u_s > 1.5) { vec2 d = gl_PointCoord - 0.5; float r = length(d); if (r > 0.5) discard; a *= smoothstep(0.5, 0.36, r); }
            gl_FragColor = vec4(u_c.rgb * a, a); }`;
        const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) console.warn("track3d shader", gl.getShaderInfoLog(s)); return s; };
        prog = gl.createProgram(); gl.attachShader(prog, sh(gl.VERTEX_SHADER, vs)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(prog);
        if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) console.warn("track3d link", gl.getProgramInfoLog(prog));
        uM = gl.getUniformLocation(prog, "u_m"); uC = gl.getUniformLocation(prog, "u_c"); uB = gl.getUniformLocation(prog, "u_b"); uS = gl.getUniformLocation(prog, "u_s"); aP = gl.getAttribLocation(prog, "a_p");
        const mk = (data, dyn) => { const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, data, dyn ? gl.DYNAMIC_DRAW : gl.STATIC_DRAW); return b; };
        if (gl.createVertexArray) vao = gl.createVertexArray();
        const prevBuf = gl.getParameter(gl.ARRAY_BUFFER_BINDING);
        bufs.line = mk(line); bufs.curtain = mk(curtain); bufs.marker = mk(marker, true);
        for (const s in simBuf) bufs["sim_" + s] = mk(simBuf[s]);
        bufs.gs = mk(gsBuf);
        gl.bindBuffer(gl.ARRAY_BUFFER, prevBuf);
        L.setTime(state.t);
      },
      render(g, matrix) {
        gl = g;
        // Start drawing once every tile has loaded at least once; drawing from the first frame coincided
        // with black satellite imagery while testing (Mapbox GL 3.9).
        if (!L.ready) { if (map.areTilesLoaded()) L.ready = true; map.triggerRepaint(); return; }
        const saved = { prog: gl.getParameter(gl.CURRENT_PROGRAM), buf: gl.getParameter(gl.ARRAY_BUFFER_BINDING),
          vao: vao ? gl.getParameter(gl.VERTEX_ARRAY_BINDING) : null, blend: gl.isEnabled(gl.BLEND),
          src: gl.getParameter(gl.BLEND_SRC_RGB), dst: gl.getParameter(gl.BLEND_DST_RGB), srcA: gl.getParameter(gl.BLEND_SRC_ALPHA), dstA: gl.getParameter(gl.BLEND_DST_ALPHA),
          depth: gl.getParameter(gl.DEPTH_WRITEMASK) };
        if (vao) gl.bindVertexArray(vao);
        gl.useProgram(prog); gl.uniformMatrix4fv(uM, false, matrix);
        if (markerDirty) { gl.bindBuffer(gl.ARRAY_BUFFER, bufs.marker); gl.bufferSubData(gl.ARRAY_BUFFER, 0, marker); markerDirty = false; }
        gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        gl.depthMask(false);
        const draw = (buf, mode, first, count, c, b, size = 1) => {
          if (count <= 0) return;
          gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.enableVertexAttribArray(aP); gl.vertexAttribPointer(aP, 4, gl.FLOAT, false, 0, 0);
          gl.uniform4fv(uC, c); gl.uniform1f(uB, b); gl.uniform1f(uS, size); gl.drawArrays(mode, first, count);
        };
        if (L.show.pre && bufs.sim_pre) draw(bufs.sim_pre, gl.LINE_STRIP, 0, simBuf.pre.length / 4, [0.95, 0.95, 0.95, 0.55], 1);
        if (L.show.hind && bufs.sim_hind) draw(bufs.sim_hind, gl.LINE_STRIP, 0, simBuf.hind.length / 4, [0.8, 0.88, 1.0, 0.85], 1);
        if (L.show.flown) {
          draw(bufs.curtain, gl.TRIANGLE_STRIP, 0, 2 * (k + 1), [0.95, 0.95, 0.95, 0.22], 0);
          draw(bufs.line, gl.LINE_STRIP, 0, pts.length, [0.95, 0.95, 0.95, 0.3], 1);
          draw(bufs.line, gl.LINE_STRIP, 0, k + 1, [1, 1, 1, 1], 1);
        }
        draw(bufs.marker, gl.LINES, 0, 2, [1, 1, 1, 0.9], 0.2);
        if (L.show.gs) draw(bufs.gs, gl.POINTS, 0, gk + 1, [0.85, 0.92, 1, 0.95], 0, 6 * (window.devicePixelRatio || 1));
        draw(bufs.marker, gl.POINTS, 1, 1, [1, 1, 1, 1], 1, 13 * (window.devicePixelRatio || 1));
        gl.disableVertexAttribArray(aP);
        if (vao) gl.bindVertexArray(saved.vao);
        gl.bindBuffer(gl.ARRAY_BUFFER, saved.buf);
        gl.useProgram(saved.prog);
        gl.blendFuncSeparate(saved.src, saved.dst, saved.srcA, saved.dstA);
        if (!saved.blend) gl.disable(gl.BLEND);
        gl.depthMask(saved.depth);
      },
    };
    return L;
  }

  /* ---------------- time charts (uPlot) ---------------- */

  const charts = [];
  let syncing = false;
  const axisBase = { stroke: G, grid: { stroke: "rgba(243,243,241,0.07)", width: 1 }, ticks: { stroke: "rgba(243,243,241,0.14)", width: 1, size: 4 }, font: "11px Inter, sans-serif", labelFont: "11px Inter, sans-serif" };
  const tzIST = ts => uPlot.tzDate(new Date(ts * 1e3), "Asia/Kolkata");

  function series(label, stroke, opts = {}) { return Object.assign({ label, stroke, width: 1.5, spanGaps: false, points: { show: false } }, opts); }

  function tsChart(el, data, ser, o = {}) {
    const host = $(el);
    const opts = {
      width: host.clientWidth || 600, height: o.height || 220, tzDate: tzIST, pxAlign: 0,
      scales: Object.assign({ x: { time: true } }, o.scales || {}),
      series: [{ label: "IST", value: (u, v) => v == null ? "" : clock(v) }].concat(ser),
      axes: [Object.assign({}, axisBase, { space: 64, values: [[60, "{HH}:{mm}", null, null, null, null, null, null, 0]] }),
             Object.assign({}, axisBase, { size: 56, values: o.yvals || ((u, v) => v.map(x => minus(nf(x)))) }, o.ysplits ? { splits: o.ysplits } : {})].concat(o.axes || []),
      cursor: { y: false, sync: { key: o.group || "tele", setSeries: false, filters: { pub: () => state.sync } }, drag: { x: true, y: false, setScale: true }, points: { size: 6, fill: W, stroke: W } },
      legend: { live: true },
      hooks: {
        draw: [u => { drawMarks(u, o.marks !== false); if (o.draw) o.draw(u); }],
        drawClear: o.drawClear ? [o.drawClear] : [],
        setScale: [(u, key) => {
          if (key !== "x" || syncing || !state.sync) return; syncing = true;
          const { min, max } = u.scales.x;
          charts.forEach(c => { if (c !== u && c._group === (o.group || "tele")) c.setScale("x", { min, max }); });
          syncing = false;
        }],
      },
    };
    const u = new uPlot(opts, data, host);
    u._group = o.group || "tele"; u._full = [data[0][0], data[0][data[0].length - 1]];
    charts.push(u);
    u.over.addEventListener("click", () => { if (u.cursor.left == null || u.cursor.left < 0) return; jump(u.posToVal(u.cursor.left, "x") - REL); });
    u.over.addEventListener("dblclick", () => charts.forEach(c => { if (c === u || (state.sync && c._group === u._group)) c.setScale("x", { min: c._full[0], max: c._full[1] }); }));
    return u;
  }

  function drawMarks(u, events) {
    const ctx = u.ctx, { top, height } = u.bbox, dpr = devicePixelRatio || 1;
    ctx.save();
    if (events) {
      ctx.strokeStyle = "rgba(243,243,241,0.22)"; ctx.setLineDash([3 * dpr, 4 * dpr]); ctx.lineWidth = dpr;
      ctx.fillStyle = "rgba(243,243,241,0.55)"; ctx.font = `${10.5 * dpr}px Inter, sans-serif`;
      [[0, "Release"], [F.meta.burst_t, "Burst"], [F.meta.touch_t, "Touchdown"]].forEach(([t, n]) => {
        const x = u.valToPos(REL + t, "x", true); if (x < u.bbox.left || x > u.bbox.left + u.bbox.width) return;
        ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x, top + height); ctx.stroke(); ctx.fillText(n, x + 4 * dpr, top + 12 * dpr);
      });
    }
    const x = u.valToPos(REL + state.t, "x", true);
    if (x >= u.bbox.left && x <= u.bbox.left + u.bbox.width) {
      ctx.setLineDash([]); ctx.strokeStyle = W; ctx.lineWidth = 1.5 * dpr;
      ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x, top + height); ctx.stroke();
    }
    ctx.restore();
  }

  function initCharts() {
    $$("[data-sync]").forEach(b => b.addEventListener("click", () => {
      state.sync = !state.sync;
      $$("[data-sync]").forEach(x => { x.classList.toggle("is-on", state.sync); x.setAttribute("aria-pressed", state.sync); x.textContent = state.sync ? "Charts linked" : "Link charts"; });
    }));
    const tr = F.track, bo = F.baro_out, bi = F.baro_in, h = F.health, gs = F.gs, m = F.meta;
    const X = t => t.map(v => v + REL);
    const inFlight = (ser, keys) => { const o = { t: [] }; keys.forEach(k => o[k] = []); ser.t.forEach((t, i) => { if (t >= -1200 && t <= m.touch_t + 600) { o.t.push(t); keys.forEach(k => o[k].push(ser[k][i])); } }); return o; };
    const hf = inFlight(h, ["soc", "mhz", "v5", "thr"]);
    const J = (...pairs) => uPlot.join(pairs.map(([t, y]) => [X(t), y]));

    tsChart("#cAlt", J([tr.t, tr.alt], [bo.t, bo.alt]), [
      series("GPS", W, { value: (u, v) => v == null ? "" : nf(v) + " m" }),
      series("Barometer, standard atmosphere", G, { dash: [5, 4], value: (u, v) => v == null ? "" : nf(v) + " m" }),
    ], { height: 300, yvals: (u, v) => v.map(x => nf(x / 1000) + " km") });

    tsChart("#cVz", J([tr.t, tr.vz]), [series("Vertical", W, { value: (u, v) => v == null ? "" : minus(nf(v, 1)) + " m/s" })]);
    tsChart("#cVh", J([tr.t, tr.vh]), [series("Ground speed", W, { value: (u, v) => v == null ? "" : nf(v, 1) + " m/s" })]);

    const degv = (u, v) => v == null ? "" : minus(nf(v, 1)) + " °C";
    tsChart("#cTemp", uPlot.join([[X(bo.t), bo.c], [X(bi.t), bi.c], [X(hf.t), hf.soc]]), [
      series("Outside sensor", W, { value: degv }),
      series("Inside box", G, { dash: [6, 4], value: degv }),
      series("Pi SoC", D, { width: 1.25, spanGaps: true, value: degv }),
    ], { height: 300, yvals: (u, v) => v.map(x => minus(nf(x)) + "°") });

    tsChart("#cP", uPlot.join([[X(bo.t), bo.hpa], [X(bi.t), bi.hpa]]), [
      series("Outside", W, { value: (u, v) => v == null ? "" : nf(v, 1) + " hPa" }),
      series("Inside", G, { dash: [6, 4], value: (u, v) => v == null ? "" : nf(v, 1) + " hPa" }),
    ], { scales: { y: { distr: 3 } }, yvals: (u, v) => v.map(x => nf(x)), ysplits: () => [50, 100, 200, 500, 1000] });

    const pts = { paths: () => null, points: { show: true, size: 3.5, width: 0 } };
    tsChart("#cRf", uPlot.join([[X(gs.t), gs.rssi], [X(gs.t), gs.snr]]), [
      series("RSSI", W, Object.assign({ scale: "dbm", value: (u, v) => v == null ? "" : minus(v) + " dBm", points: { show: true, size: 3.5, fill: W, width: 0 } }, { paths: () => null })),
      series("SNR", G, Object.assign({ scale: "db", value: (u, v) => v == null ? "" : minus(nf(v, 1)) + " dB", points: { show: true, size: 3, fill: G, width: 0 } }, { paths: () => null })),
    ], { scales: { dbm: {}, db: {} }, yvals: (u, v) => v.map(x => minus(x)),
         axes: [Object.assign({}, axisBase, { scale: "db", side: 1, size: 44, grid: { show: false }, values: (u, v) => v.map(x => minus(x)) })] });
    // first axis must use the dbm scale
    const rf = charts[charts.length - 1]; rf.axes[1].scale = "dbm"; rf.redraw();

    // Pi (whole boot, own zoom group)
    const shade = u => {
      const ctx = u.ctx, { top, height } = u.bbox; ctx.save(); ctx.fillStyle = "rgba(243,243,241,0.09)";
      const t = u.data[0];
      for (let i = 0; i < t.length; i++) if (u.data[2] && (u.data[2][i] & 0xF)) {
        const x0 = u.valToPos(t[i] - 5, "x", true), x1 = u.valToPos(t[i] + 5, "x", true); ctx.fillRect(x0, top, x1 - x0 + 0.5, height);
      }
      ctx.restore();
    };
    tsChart("#cPi", [X(h.t), h.soc, h.thr], [
      series("SoC", W, { value: degv }),
      { label: "Throttled bits", show: false, value: (u, v) => v == null ? "" : "0x" + v.toString(16) },
    ], { group: "pi", height: 240, drawClear: shade, yvals: (u, v) => v.map(x => nf(x) + "\u00b0") });
    tsChart("#cV", [X(h.t), h.v5], [series("5 V rail", W, { value: (u, v) => v == null ? "" : nf(v, 3) + " V" })],
      { group: "pi", height: 170, scales: { y: { range: [4.6, 5.2] } }, yvals: (u, v) => v.map(x => nf(x, 2)) });

    // keep widths right, redraw the playback line
    const ro = new ResizeObserver(() => charts.forEach(c => { const w = c.root.parentElement.clientWidth; if (w && Math.abs(w - c.width) > 2) c.setSize({ width: w, height: c.height }); }));
    charts.forEach(c => ro.observe(c.root.parentElement));
    const vis = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { const c = charts.find(x => x.root === e.target); if (c) c.redraw(false, false); } }));
    charts.forEach(c => vis.observe(c.root));
    onTime.push((t, o) => {
      const now = performance.now(); if (o.playing && now - lastChartDraw < 250) return; lastChartDraw = now;
      charts.forEach(c => { const r = c.root.getBoundingClientRect(); if (r.bottom > 0 && r.top < innerHeight) c.redraw(false, false); });
    });
  }

  /* ---------------- profile charts (altitude on the y axis) ---------------- */

  const profs = [];
  function profile(canvas, cfg) {
    const c = $(canvas); if (!c) return;
    const P = { c, cfg, hoverY: null };
    profs.push(P);
    const draw = () => {
      const dpr = devicePixelRatio || 1, w = c.clientWidth, hgt = c.clientHeight;
      c.width = w * dpr; c.height = hgt * dpr;
      const ctx = c.getContext("2d"); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, hgt);
      const L = 46, R = 12, T = 30, B = 30, pw = w - L - R, ph = hgt - T - B;
      const [x0, x1] = cfg.x, [y0, y1] = cfg.y;
      const px = v => L + (v - x0) / (x1 - x0) * pw, py = v => T + ph - (v - y0) / (y1 - y0) * ph;
      ctx.font = "11px Inter, sans-serif"; ctx.fillStyle = G; ctx.strokeStyle = "rgba(243,243,241,0.07)"; ctx.lineWidth = 1;
      for (let y = 0; y <= y1; y += 5000) { ctx.beginPath(); ctx.moveTo(L, py(y) + 0.5); ctx.lineTo(L + pw, py(y) + 0.5); ctx.stroke(); ctx.textAlign = "right"; ctx.fillText(y / 1000 + " km", L - 8, py(y) + 4); }
      for (const xv of cfg.xticks) { ctx.beginPath(); ctx.moveTo(px(xv) + 0.5, T); ctx.lineTo(px(xv) + 0.5, T + ph); ctx.stroke(); ctx.textAlign = "center"; ctx.fillText(minus(xv) + (cfg.unit || ""), px(xv), T + ph + 18); }
      ctx.save(); ctx.beginPath(); ctx.rect(L, T, pw, ph); ctx.clip();
      (cfg.bands || []).forEach(b => {
        ctx.fillStyle = b.fill; ctx.beginPath();
        b.pts.forEach((p, i) => { const X = px(p[0]), Y = py(p[2]); i ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y); });
        for (let i = b.pts.length - 1; i >= 0; i--) ctx.lineTo(px(b.pts[i][1]), py(b.pts[i][2]));
        ctx.closePath(); ctx.fill();
      });
      cfg.series.forEach(s => {
        ctx.strokeStyle = s.stroke; ctx.fillStyle = s.stroke; ctx.lineWidth = s.width || 1.5; ctx.setLineDash(s.dash || []);
        if (s.dots) { s.pts.forEach(p => { if (p[0] == null) return; ctx.beginPath(); ctx.arc(px(p[0]), py(p[1]), s.r || 2.4, 0, 7); ctx.fill(); }); return; }
        ctx.beginPath(); let pen = false;
        s.pts.forEach(p => { if (p[0] == null) { pen = false; return; } const X = px(p[0]), Y = py(p[1]); pen ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y); pen = true; });
        ctx.stroke();
      });
      ctx.setLineDash([]); ctx.restore();
      // legend
      let lx = L + 8; ctx.textAlign = "left";
      cfg.series.concat(cfg.bands || []).forEach(s => { if (!s.label) return; ctx.fillStyle = s.fill || s.stroke; ctx.fillRect(lx, 8, 12, s.fill ? 8 : 2); ctx.fillStyle = G; ctx.fillText(s.label, lx + 17, 13); lx += ctx.measureText(s.label).width + 34; });
      if (P.hoverY != null) {
        const alt = y0 + (T + ph - P.hoverY) / ph * (y1 - y0);
        if (alt >= y0 && alt <= y1) {
          ctx.strokeStyle = "rgba(243,243,241,0.45)"; ctx.beginPath(); ctx.moveTo(L, P.hoverY + 0.5); ctx.lineTo(L + pw, P.hoverY + 0.5); ctx.stroke();
          const parts = [nf(alt / 1000, 1) + " km"];
          cfg.series.forEach(s => { if (!s.label) return; let best = null, bd = 1e9; s.pts.forEach(p => { if (p[0] == null) return; const d = Math.abs(p[1] - alt); if (d < bd) { bd = d; best = p; } }); if (best && bd < (cfg.snap || 400)) parts.push(`${s.label}: ${minus(nf(best[0], cfg.dp == null ? 1 : cfg.dp))}${cfg.unit || ""}`); });
          ctx.fillStyle = "rgba(10,10,11,0.85)"; const txt = parts.join("   "); const tw = ctx.measureText(txt).width + 14;
          const bx = Math.min(L + pw - tw, L + 4), by = Math.max(T, P.hoverY - 26);
          ctx.fillRect(bx, by, tw, 20); ctx.fillStyle = W; ctx.fillText(txt, bx + 7, by + 14);
        }
      }
    };
    P.draw = draw;
    c.addEventListener("mousemove", e => { P.hoverY = e.offsetY; draw(); });
    c.addEventListener("mouseleave", () => { P.hoverY = null; draw(); });
    new ResizeObserver(draw).observe(c);
    draw();
    return P;
  }

  function initProfiles() {
    const tp = F.tprof, up = [], dn = [], inn = [];
    tp.alt.forEach((a, i) => { (tp.up[i] ? up : dn).push([tp.out[i], a]); if (tp.up[i] && tp.inn[i] != null) inn.push([tp.inn[i], a]); });
    profile("#pTemp", { x: [-60, 50], y: [0, 21000], xticks: [-60, -40, -20, 0, 20, 40], unit: "°", series: [
      { label: "Outside, up", stroke: W, pts: up }, { label: "Outside, down", stroke: G, dash: [5, 4], pts: dn }, { label: "Inside, up", stroke: D, pts: inn }] });
    const wu = F.wind.filter(w => w.phase === "up"), wd = F.wind.filter(w => w.phase === "down");
    const band = climWindBand();
    profile("#pWind", { x: [0, 40], y: [0, 21000], xticks: [0, 10, 20, 30, 40], unit: "", dp: 1, snap: 300, bands: band ? [band] : [], series: [
      { label: "Up, m/s", stroke: W, pts: wu.map(w => [w.spd, w.alt]) }, { label: "Down", stroke: G, dash: [5, 4], pts: wd.map(w => [w.spd, w.alt]) }] });
    profile("#pDir", { x: [0, 360], y: [0, 21000], xticks: [0, 90, 180, 270, 360], unit: "°", dp: 0, snap: 300, series: [
      { label: "Up", stroke: W, dots: true, pts: wu.map(w => [w.from, w.alt]) }, { label: "Down", stroke: G, dots: true, r: 2, pts: wd.map(w => [w.from, w.alt]) }] });
  }

  /* ---------------- simulation ---------------- */

  function initSim() {
    const tr = F.track, X = tr.t.map(v => v + REL);
    const ser = [series("Flown, GPS", W, { value: (u, v) => v == null ? "" : nf(v) + " m" })], cols = [[X, tr.alt]];
    const sp = simPaths();
    const add = (path, label, stroke, dash) => { if (!path) return; cols.push([path.map(p => p[0] + REL), path.map(p => p[3])]); ser.push(series(label, stroke, { dash, spanGaps: true, value: (u, v) => v == null ? "" : nf(v) + " m" })); };
    add(sp.pre, "Pre-flight settings", G, [5, 4]);
    add(sp.hind, "Re-run, real burst", D, [2, 3]);
    tsChart("#cSim", uPlot.join(cols), ser, { group: "sim", height: 280, yvals: (u, v) => v.map(x => nf(x / 1000) + " km") });
    if (SIM) {
      $("#simNote").textContent = "Flown (white) against the Boscon predictor re-run after the flight on the day's GFS winds, with the pre-flight settings (dashed) and with the real burst and descent (dotted).";
      $$("[data-layer=hind]").forEach(cb => { cb.closest("label").classList.remove("is-off"); });
      renderHindcast();
    } else {
      $("#simNote").textContent = "Flown altitude. The simulation re-run is not loaded.";
      $$("[data-layer=hind]").forEach(cb => { cb.disabled = true; cb.closest("label").classList.add("is-off"); });
    }
  }

  function renderHindcast() {
    const sc = SIM.scenarios, order = ["preflight", "as_flown_preflight_descent", "as_flown"];
    const name = { preflight: "Pre-flight settings", as_flown_preflight_descent: "Real ascent and burst, pre-flight parachute", as_flown: "Real ascent, burst and descent" };
    $("#hindcast").innerHTML = `<div class="hc"><table class="tbl"><caption>Re-run after the flight, released 12:37:06 IST on the day's GFS winds (computed)</caption>
      <thead><tr><th>Settings</th><th>Burst</th><th>Landing</th><th>Miss</th></tr></thead><tbody>
      ${order.filter(k => sc[k]).map(k => { const r = sc[k].result; return `<tr${k === "as_flown" ? ' class="tbl__actual"' : ""}><td>${name[k]}</td><td>${nf(sc[k].settings.burst_m / 1000, 1)} km</td><td>${nf(r.range_km, 1)} km at ${r.bearing_deg}\u00b0</td><td>${nf(r.miss_from_touchdown_km, 1)} km</td></tr>`; }).join("")}
      </tbody></table><p class="fine">Miss is the distance from the real touchdown. The early burst and the slower parachute each account for about half of the 22.7 km. The pre-flight parachute model fell 1.6 to 1.9 times faster than HAB-1 did at every height. One deterministic track each, no Monte Carlo; the ascent is held at its 4.54 m/s mean.</p></div>`;
  }

  /* ---------------- climatology ---------------- */

  const cbins = k => CLIM && CLIM.series && CLIM.series[k] ? CLIM.series[k].bins.map(b => Object.assign({ alt: (b.z0 + b.z1) / 2 }, b)) : null;
  function climWindBand() {
    const b = cbins("solapur_gfs"); if (!b) return null;
    return { label: "October, middle half", fill: "rgba(243,243,241,0.10)", pts: b.filter(x => x.alt <= 21000 && x.spd_p25 != null).map(x => [x.spd_p25, x.spd_p75, x.alt]) };
  }

  function initClim() {
    const sol = cbins("solapur_gfs"), day = cbins("solapur_gfs_flight_day"), pune = cbins("pune_igra");
    if (!sol) { $("#climatology").hidden = true; return; }
    const wu = F.wind.filter(w => w.phase === "up");
    const S = CLIM.series.solapur_gfs, P = CLIM.series.pune_igra;
    const ok = x => x.spd_p50 != null;
    const series = [
      { label: "October median", stroke: G, dash: [5, 4], pts: sol.filter(ok).map(x => [x.spd_p50, x.alt]) },
      { label: "GFS on the day", stroke: D, dash: [1.5, 3], width: 2, pts: day.filter(ok).map(x => [x.spd_p50, x.alt]) },
      { label: "HAB-1 up", stroke: W, pts: wu.map(w => [w.spd, w.alt]) }];
    if (pune) series.splice(1, 0, { label: "Pune radiosondes", stroke: D, width: 1, pts: pune.filter(ok).map(x => [x.spd_p50, x.alt]) });
    profile("#cClimSpd", { x: [0, 45], y: [0, 30000], xticks: [0, 10, 20, 30, 40], dp: 1, snap: 600,
      bands: [{ label: "middle half", fill: "rgba(243,243,241,0.10)", pts: sol.filter(x => x.spd_p25 != null).map(x => [x.spd_p25, x.spd_p75, x.alt]) }], series });
    const up = []; F.tprof.alt.forEach((a, i) => { if (F.tprof.up[i]) up.push([F.tprof.out[i], a]); });
    const okT = x => x.T_p50_C != null;
    profile("#cClimT", { x: [-80, 40], y: [0, 30000], xticks: [-80, -60, -40, -20, 0, 20, 40], unit: "\u00b0", snap: 600, series: [
      { label: "October median air", stroke: G, dash: [5, 4], pts: sol.filter(okT).map(x => [x.T_p50_C, x.alt]) },
      { label: "GFS on the day", stroke: D, dash: [1.5, 3], width: 2, pts: day.filter(okT).map(x => [x.T_p50_C, x.alt]) },
      { label: "HAB-1 outside sensor", stroke: W, pts: up }] });
    $("#climSpdNote").textContent = `Wind speed. Band and dashed line: ${S.n_profiles} GFS profiles over the pad at 12:30 to 14:30 IST on ${S.n_days} October days, ${S.years[0]} to ${S.years[S.years.length - 1]} (model).` + (P ? ` Thin line: ${P.n_profiles} Pune radiosondes, 228 km west (measured).` : "");
    $("#climTNote").textContent = "GFS air temperature over the pad, October median and on the day (model), against HAB-1's outside sensor on the way up. The sensor read 4 \u00b0C warmer than the day's GFS air near the ground and 45 \u00b0C warmer at 19.5 km (computed, 1 km bins): it measures its own chip, warmed by sunlight and the box, not the air.";
    $("#climSrc").textContent = "Climatology: GFS via the Open-Meteo archive, bundled with the Boscon HAB predictor; NOAA IGRA v2 radiosondes, station INM00043063 Pune. HAB-1 winds: computed from its GPS drift. On the day, GFS and the balloon's own drift agree from 6 to 16 km: both about 23 m/s from about 205\u00b0 at 12 to 13 km.";
  }

  /* ---------------- onboard AI ---------------- */

  const SHORT = ["Altitude and pressure", "Inside temperature", "How thin the air is", "Flight phase", "Highest altitude", "Log entry", "Computer temperature", "For a school student"];
  function initAI() {
    const ans = LLM.answers, prompts = [];
    ans.forEach(a => { if (!prompts.includes(a.prompt)) prompts.push(a.prompt); });
    const short = p => SHORT[prompts.indexOf(p)] || p;
    let filter = null, q = "", shown = 0, list = [];
    const chips = $("#promptChips");
    chips.innerHTML = `<button class="chip is-on" data-p="">All 411</button>` + prompts.map((p, i) => `<button class="chip" data-p="${i}" title="${p.replace(/"/g, "&quot;")}">${SHORT[i] || p}</button>`).join("");
    $$(".chip", chips).forEach(b => b.addEventListener("click", () => { filter = b.dataset.p === "" ? null : prompts[+b.dataset.p]; $$(".chip", chips).forEach(x => x.classList.toggle("is-on", x === b)); render(); }));
    $("#aiSearch").addEventListener("input", e => { q = e.target.value.trim().toLowerCase(); render(); });
    $("#aiMore").addEventListener("click", () => more());
    const esc = s => s.replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);
    function card(a) {
      return `<li class="ans"><div class="ans__meta"><b>${a.alt != null ? nf(a.alt) + " m" : "none"}</b>${clock(REL + a.t)} IST<br>${tplus(a.t)}<br>SoC ${nf(a.soc, 1)} °C<br>${nf(a.ms / 1000, 1)} s${a.tok_s ? ", " + nf(a.tok_s, 1) + " tok/s" : ""}</div>
        <div><p class="ans__q">${esc(short(a.prompt))}: ${esc(a.prompt)}</p><p class="ans__a">${esc(a.text)}</p>
        ${a.retried ? `<span class="ans__flag">Asked again after the checker caught a contradiction</span>` : ""}
        <div class="ans__act"><button data-told>What it was told</button><button data-t="${a.t}">Show on the map</button></div>
        <pre hidden>${esc(a.sensors)}</pre></div></li>`;
    }
    function render() {
      list = ans.filter(a => (!filter || a.prompt === filter) && (!q || a.text.toLowerCase().includes(q)));
      $("#answers").innerHTML = ""; shown = 0; more();
    }
    function more() {
      const next = list.slice(shown, shown + 12); shown += next.length;
      $("#answers").insertAdjacentHTML("beforeend", next.map(card).join("") || `<li class="ans"><div></div><p class="ans__a">No answers match.</p></li>`);
      $("#aiMore").hidden = shown >= list.length;
      $("#aiMore").textContent = `Show more (${list.length - shown} left)`;
    }
    $("#answers").addEventListener("click", e => {
      const b = e.target.closest("button"); if (!b) return;
      if (b.hasAttribute("data-told")) { const pre = b.closest(".ans").querySelector("pre"); pre.hidden = !pre.hidden; b.textContent = pre.hidden ? "What it was told" : "Hide what it was told"; }
      else if (b.dataset.t) { setT(+b.dataset.t); $("#map").scrollIntoView({ behavior: "smooth" }); }
    });
    render();
  }

  /* ---------------- footage ---------------- */

  function initFootage() {
    const tr = F.track, v = $("#vid"), read = $("#vidRead");
    const alt = t => { const i = idx(tr.t, t); return i < 0 ? null : tr.alt[i]; };
    const vzAt = t => { const i = idx(tr.t, t); return i < 0 ? null : tr.vz[i]; };
    const upd = () => {
      const t = CLIP0 + v.currentTime - REL, a = alt(t), vz = vzAt(t);
      read.textContent = `${clock(REL + t)} IST · ${nf(a)} m · ${t < F.meta.burst_t ? "climbing" : "falling"} ${nf(Math.abs(vz || 0), 1)} m/s`;
    };
    v.addEventListener("timeupdate", upd); v.addEventListener("loadedmetadata", upd); upd();
    $("#vidMap").addEventListener("click", () => { setT(CLIP0 + v.currentTime - REL); $("#map").scrollIntoView({ behavior: "smooth" }); });

    const g = $("#gallery"), st = STILLS.stills.slice().sort((a, b) => a.t - b.t);
    const order = { sun_space_earth: 0, curve: 1, curve_centred: 2, space: 3, earth_detail: 4 };
    st.sort((a, b) => order[a.kind] - order[b.kind] || a.t - b.t);
    g.innerHTML = st.map((s, i) => `<li data-i="${i}"><img src="img/${s.file}-s.jpg" alt="${s.label}, ${nf(s.alt)} m, ${clock(REL + s.t)} IST" loading="lazy" width="640" height="360">
      <div class="g__cap"><span><b>${s.label}</b></span><span>${nf(s.alt)} m · ${clock(REL + s.t).slice(0, 8)} IST</span></div></li>`).join("");
    const lb = $("#lightbox");
    g.addEventListener("click", e => {
      const li = e.target.closest("li"); if (!li) return;
      const s = st[+li.dataset.i];
      $("#lbImg").src = `img/${s.file}.jpg`; $("#lbImg").alt = li.querySelector("img").alt;
      $("#lbCap").innerHTML = `<b>${s.label}</b><span>${nf(s.alt)} m GPS</span><span>${clock(REL + s.t)} IST (${s.utc} UTC, ±1 s)</span>
        <span>${s.vz < 0 ? "falling" : "climbing"} ${nf(Math.abs(s.vz), 1)} m/s</span><span>${s.lat.toFixed(5)} N, ${s.lon.toFixed(5)} E</span><span>${nf(s.dpad, 1)} km from the pad</span>
        <span>frame ${s.frame}, ${s.stacked} frame${s.stacked > 1 ? "s" : ""} merged</span><button class="btn" data-t="${s.t}">Show on the map</button>`;
      lb.showModal();
    });
    $("#lbClose").addEventListener("click", () => lb.close());
    lb.addEventListener("click", e => { if (e.target === lb) lb.close(); const b = e.target.closest("[data-t]"); if (b) { lb.close(); setT(+b.dataset.t); $("#map").scrollIntoView({ behavior: "smooth" }); } });
  }
})();
