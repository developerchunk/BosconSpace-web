/* HAB-1 public flight page. Data comes from the window.HAB1_* objects in /hab-1-flight/data/. One playback
   time (state.t, seconds from release) drives the map and the HUD. */
(() => {
  "use strict";

  const MAPBOX_TOKEN = window.HAB_MAPBOX_TOKEN || "";   // from /hab-1-flight/config.js (middleware.js)
  const F = window.HAB1_FLIGHT, ANS = window.HAB1_ANSWERS, STILLS = window.HAB1_STILLS;
  const REL = F.release;
  const CLIP0 = 1793434605;          // burst clip starts 08:16:45Z
  const IST = 19800;
  const W = "#f3f3f1";
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const nf = (v, d = 0) => v == null || isNaN(v) ? "none" : v.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
  const pad2 = n => String(n).padStart(2, "0");
  const clock = (epoch, tz = IST) => { const s = Math.floor(epoch + tz); const d = ((s % 86400) + 86400) % 86400; return `${pad2(Math.floor(d / 3600))}:${pad2(Math.floor(d / 60) % 60)}:${pad2(d % 60)}`; };
  const tplus = t => { const s = Math.abs(Math.round(t)); return `T${t < 0 ? "−" : "+"}${pad2(Math.floor(s / 3600))}:${pad2(Math.floor(s / 60) % 60)}:${pad2(s % 60)}`; };
  const minus = s => String(s).replace(/^-/, "−");

  // index of the last element <= t in a sorted array
  const idx = (arr, t) => { let lo = 0, hi = arr.length - 1; if (t < arr[0]) return -1; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (arr[m] <= t) lo = m; else hi = m - 1; } return lo; };

  // the rows as columns: tr.t, tr.lat, tr.alt, ...
  const tr = {};
  F.cols.forEach((c, j) => { tr[c] = F.rows.map(r => r[j]); });
  const LIVE_T = F.live.map(e => e[0]);
  // position at time t, linear between rows
  const posAt = t => {
    const i = Math.max(0, idx(tr.t, t)), k = Math.min(i + 1, tr.t.length - 1);
    const f = k === i ? 0 : Math.max(0, Math.min(1, (t - tr.t[i]) / (tr.t[k] - tr.t[i])));
    return [tr.lon[i] + (tr.lon[k] - tr.lon[i]) * f, tr.lat[i] + (tr.lat[k] - tr.lat[i]) * f, tr.alt[i] + (tr.alt[k] - tr.alt[i]) * f];
  };

  const state = { t: 0, playing: false, speed: 180, view: "3d", orbit: false };
  const onTime = [];

  function setT(t, opts = {}) {
    const sc = $("#scrub");
    state.t = Math.max(+sc.min, Math.min(+sc.max, t));
    for (const f of onTime) f(state.t, opts);
  }

  /* ---------------- reveal, nav ---------------- */

  document.body.classList.add("is-ready");
  const io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { e.target.classList.add("is-in"); io.unobserve(e.target); } }), { rootMargin: "0px 0px -8% 0px" });
  $$(".rv, .line").forEach(el => io.observe(el));
  const tog = $("#navToggle"), menu = $("#menu");
  tog.addEventListener("click", () => { const o = !menu.classList.contains("is-open"); menu.classList.toggle("is-open", o); tog.setAttribute("aria-expanded", o); menu.setAttribute("aria-hidden", !o); });
  $$("#menu a").forEach(a => a.addEventListener("click", () => { menu.classList.remove("is-open"); tog.setAttribute("aria-expanded", false); }));
  let lastY = 0; const nav = $("#nav");
  addEventListener("scroll", () => { const y = scrollY; nav.classList.toggle("is-hidden", y > lastY && y > 200 && !menu.classList.contains("is-open")); lastY = y; }, { passive: true });

  const toMap = t => { setT(t); $("#map").scrollIntoView({ behavior: "smooth" }); };

  /* ---------------- player ---------------- */

  function initPlayer() {
    const sc = $("#scrub"), btn = $("#playBtn"), player = $("#player");
    const span = +sc.max - +sc.min;
    const keyT = new Set([0, F.burst, F.touch]);
    $("#ticks").innerHTML = F.events.map(e => `<span class="${keyT.has(e.t) ? "is-key" : ""}" style="left:${(e.t - sc.min) / span * 100}%" title="${e.name}"></span>`).join("");
    $("#events").innerHTML = F.events.map(e => `<li data-t="${e.t}"><time>${clock(REL + e.t)} IST</time><h4>${e.name.replace(/-/g, "−")}</h4></li>`).join("");
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

  function initHud() {
    onTime.push(t => {
      $("#hudT").textContent = tplus(t);
      $("#hudClock").textContent = clock(REL + t) + " IST";
      $("#hudPhase").textContent = t < 0 ? "On the pad" : t < F.burst - 3 ? "Climbing" : t < F.burst + 6 ? "Burst" : t < F.touch ? "Descending under parachute" : "Landed";
      const i = idx(tr.t, t);
      if (i < 0) return;
      $("#hudAlt").textContent = nf(tr.alt[i]) + " m";
      const vz = tr.vz[i] != null && Math.abs(tr.vz[i]) < 0.05 ? 0 : tr.vz[i]; $("#hudVz").textContent = vz == null ? "none" : minus((vz > 0 ? "+" : "") + nf(vz, 1)) + " m/s";
      $("#hudVh").textContent = tr.vh[i] == null ? "none" : nf(tr.vh[i], 1) + " m/s";
      $("#hudD").textContent = nf(tr.dpad[i], 1) + " km";
      const to = tr.tout[i], p = tr.hpa[i], ti = tr.tin[i], soc = tr.soc[i];
      $("#hudTo").textContent = to == null ? "none" : minus(nf(to, 1)) + " °C";
      $("#hudP").textContent = p == null ? "none" : nf(p, p < 100 ? 1 : 0) + " hPa";
      $("#hudTi").textContent = ti == null ? (t > F.touch - 20 ? "lost" : "none") : nf(ti, 1) + " °C";
      $("#hudSoc").textContent = soc == null ? "none" : nf(soc, 1) + " °C";
      const k = idx(LIVE_T, t), miss = k < 0 ? null : F.live[k][3];
      $("#hudLive").textContent = miss == null ? "none yet" : nf(miss / 1000, miss < 10000 ? 2 : 1) + " km from where it landed";
    });
  }

  /* ---------------- map ---------------- */

  let map, layer3d;
  function initMap() {
    if (!window.mapboxgl || MAPBOX_TOKEN.indexOf("pk.") !== 0) { $("#mapFallback").hidden = false; return; }
    mapboxgl.accessToken = MAPBOX_TOKEN;
    const pad = F.pad, land = F.landing;
    try {
      map = new mapboxgl.Map({
        container: "mapEl", style: "mapbox://styles/mapbox/satellite-v9", projection: "mercator",
        center: [76.03, 17.93], zoom: 8.7, pitch: 62, bearing: -24, antialias: true,
        cooperativeGestures: true, attributionControl: true, maxPitch: 80,
      });
    } catch (e) { $("#mapFallback").hidden = false; return; }
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
      line("flown-all", tr.t.map((t, i) => [tr.lon[i], tr.lat[i]]), { "line-color": W, "line-opacity": 0.28, "line-width": 1.5 });
      line("flown-played", [], { "line-color": W, "line-opacity": 0.95, "line-width": 2.5 });

      // 58 NM limit around the pad
      const ring = []; for (let a = 0; a <= 360; a += 3) { const r = 107.4 / 6371.0088, b = a * Math.PI / 180, la = pad[0] * Math.PI / 180, lo = pad[1] * Math.PI / 180;
        const la2 = Math.asin(Math.sin(la) * Math.cos(r) + Math.cos(la) * Math.sin(r) * Math.cos(b));
        const lo2 = lo + Math.atan2(Math.sin(b) * Math.sin(r) * Math.cos(la), Math.cos(r) - Math.sin(la) * Math.sin(la2)); ring.push([lo2 * 180 / Math.PI, la2 * 180 / Math.PI]); }
      line("limit", ring, { "line-color": W, "line-opacity": 0.6, "line-width": 1, "line-dasharray": [3, 3] }, { visibility: "none" });

      // live prediction: landing estimates the ground station recomputed in flight
      const est = F.live;
      line("live-trail", est.map(e => [e[2], e[1]]), { "line-color": W, "line-opacity": 0.55, "line-width": 1.2, "line-dasharray": [1, 1.5] });
      map.addSource("live-pts", { type: "geojson", data: { type: "FeatureCollection", features: est.map(e => ({ type: "Feature", properties: { t: e[0] }, geometry: { type: "Point", coordinates: [e[2], e[1]] } })) } });
      map.addLayer({ id: "live-pts", type: "circle", source: "live-pts", paint: { "circle-radius": 2, "circle-color": W, "circle-opacity": 0.55 } });
      map.addSource("live-now", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addLayer({ id: "live-now", type: "circle", source: "live-now", paint: { "circle-radius": 7, "circle-color": "rgba(0,0,0,0)", "circle-stroke-color": W, "circle-stroke-width": 2.5 } });
      map.addLayer({ id: "live-now-lbl", type: "symbol", source: "live-now", layout: { "text-field": ["get", "label"], "text-size": 12, "text-offset": [1.1, 0], "text-anchor": "left", "text-allow-overlap": true, "text-font": ["DIN Pro Medium", "Arial Unicode MS Regular"] },
        paint: { "text-color": W, "text-halo-color": "rgba(0,0,0,0.85)", "text-halo-width": 1.4 } });

      // pre-flight predicted landings and the two simulated paths
      map.addSource("pre", { type: "geojson", data: { type: "FeatureCollection", features: F.preLandings.map(p => ({ type: "Feature", properties: { n: p[0] }, geometry: { type: "Point", coordinates: [p[2], p[1]] } })) } });
      map.addLayer({ id: "pre", type: "circle", source: "pre", layout: { visibility: "none" }, paint: { "circle-radius": 5, "circle-color": "rgba(0,0,0,0)", "circle-stroke-color": W, "circle-stroke-width": 1.5 } });
      map.addLayer({ id: "pre-lbl", type: "symbol", source: "pre", filter: ["==", ["get", "n"], "12:00"], layout: { visibility: "none", "text-field": "Pre-flight prediction (run 07:10 IST): landings for 11:00 to 14:00 IST releases", "text-size": 11, "text-offset": [0, 1.3], "text-anchor": "top", "text-font": ["DIN Pro Medium", "Arial Unicode MS Regular"] },
        paint: { "text-color": W, "text-halo-color": "rgba(0,0,0,0.75)", "text-halo-width": 1.2 } });
      line("sim-pre", F.simPre.map(p => [p[2], p[1]]), { "line-color": W, "line-opacity": 0.75, "line-width": 1.5, "line-dasharray": [2, 2] }, { visibility: "none" });
      line("sim-hind", F.simFlown.map(p => [p[2], p[1]]), { "line-color": W, "line-opacity": 0.85, "line-width": 1.5, "line-dasharray": [0.5, 2] }, { visibility: "none" });

      // what-if bursts at 25 and 30 km: the as-flown settings with only the burst height changed
      [["b25", F.simB25, [4, 2], "What if: burst at 25 km"], ["b30", F.simB30, [6, 2, 1, 2], "What if: burst at 30 km"]].forEach(([id, path, dash, text]) => {
        line("sim-" + id, path.map(p => [p[2], p[1]]), { "line-color": W, "line-opacity": 0.8, "line-width": 1.5, "line-dasharray": dash }, { visibility: "none" });
        const end = path[path.length - 1];
        map.addSource("land-" + id, { type: "geojson", data: { type: "Feature", properties: { text }, geometry: { type: "Point", coordinates: [end[2], end[1]] } } });
        map.addLayer({ id: "land-" + id, type: "circle", source: "land-" + id, layout: { visibility: "none" }, paint: { "circle-radius": 4, "circle-color": "rgba(0,0,0,0)", "circle-stroke-color": W, "circle-stroke-width": 1.5 } });
        map.addLayer({ id: "land-" + id + "-lbl", type: "symbol", source: "land-" + id, layout: { visibility: "none", "text-field": ["get", "text"], "text-size": 11, "text-offset": [-0.9, 0], "text-anchor": "right", "text-font": ["DIN Pro Medium", "Arial Unicode MS Regular"] },
          paint: { "text-color": W, "text-halo-color": "rgba(0,0,0,0.75)", "text-halo-width": 1.2 } });
      });

      const mk = (ll, text) => { const el = document.createElement("div"); el.className = "map-label"; el.textContent = text; new mapboxgl.Marker({ element: el, anchor: "bottom" }).setLngLat([ll[1], ll[0]]).addTo(map);
        const dot = document.createElement("div"); dot.className = "map-dot"; new mapboxgl.Marker({ element: dot }).setLngLat([ll[1], ll[0]]).addTo(map); };
      mk(pad, "Pad, 12:37 IST");
      mk(land, "Landed, 14:41 IST");

      layer3d = makeLayer3d();
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
      const n = idx(tr.t, t), coords = [];
      for (let i = 0; i <= n; i++) coords.push([tr.lon[i], tr.lat[i]]);
      if (n >= 0 && t > tr.t[n]) { const p = posAt(t); coords.push([p[0], p[1]]); }
      map.getSource("flown-played").setData({ type: "Feature", geometry: { type: "LineString", coordinates: coords.length > 1 ? coords : [] } });
      const k = idx(LIVE_T, t), e = F.live[k];
      map.getSource("live-now").setData({ type: "FeatureCollection", features: k < 0 ? [] : [{ type: "Feature", properties: { label: `Live prediction, ${clock(REL + e[0]).slice(0, 5)} IST` }, geometry: { type: "Point", coordinates: [e[2], e[1]] } }] });
      map.setFilter("live-pts", ["<=", ["get", "t"], t]);
    });
    onTime.push(t => {
      if (!map || state.view !== "follow") return;
      const p = posAt(t);
      if (!map.isMoving()) map.jumpTo({ center: [p[0], p[1]] });
    });

    $$("[data-view]").forEach(b => b.addEventListener("click", () => setView(b.dataset.view)));
    [map.dragRotate, map.touchZoomRotate, map.touchPitch, map.keyboard, map.dragPan].forEach(h => h && h.enable());
    $$("[data-turn]").forEach(b => b.addEventListener("click", () => map.easeTo({ bearing: map.getBearing() + +b.dataset.turn, duration: 700 })));
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
    else if (v === "plan") map.fitBounds([[75.78, 17.68], [76.28, 18.23]], Object.assign({ pitch: 0, bearing: 0, padding: small ? 30 : { top: 40, bottom: 40, left: 320, right: 230 } }, opt));
    else { const p = posAt(state.t); map.flyTo(Object.assign({ center: [p[0], p[1]], zoom: 10.6, pitch: 70, bearing: 20 }, opt)); }
  }

  function setLayer(name, on) {
    if (!map) return;
    const vis = on ? "visible" : "none";
    const ids = { flown: ["flown-all", "flown-played"], pre: ["pre", "pre-lbl", "sim-pre"], live: ["live-trail", "live-pts", "live-now", "live-now-lbl"], hind: ["sim-hind"], limit: ["limit"],
      b25: ["sim-b25", "land-b25", "land-b25-lbl"], b30: ["sim-b30", "land-b30", "land-b30-lbl"] }[name];
    ids.forEach(id => map.getLayer(id) && map.setLayoutProperty(id, "visibility", vis));
    if (layer3d) { layer3d.show[name] = on; map.triggerRepaint(); }
  }

  // Custom WebGL layer: the flown track in 3D, a translucent curtain to the ground, the payload marker,
  // and the simulated paths. Positions are Mercator coordinates with altitude in metres.
  function makeLayer3d() {
    const base = 470;
    const MC = (lon, lat, alt) => mapboxgl.MercatorCoordinate.fromLngLat([lon, lat], alt);
    const n = tr.t.length;
    const line = new Float32Array(n * 4), curtain = new Float32Array(n * 8);
    for (let i = 0; i < n; i++) { const a = MC(tr.lon[i], tr.lat[i], tr.alt[i]), g = MC(tr.lon[i], tr.lat[i], base);
      line.set([a.x, a.y, a.z, 1], i * 4); curtain.set([g.x, g.y, g.z, 0, a.x, a.y, a.z, 1], i * 8); }
    const mkSim = path => { const b = new Float32Array(path.length * 4); path.forEach((p, i) => { const a = MC(p[2], p[1], p[3]); b.set([a.x, a.y, a.z, 1], i * 4); }); return b; };
    const simBuf = { pre: mkSim(F.simPre), hind: mkSim(F.simFlown), b25: mkSim(F.simB25), b30: mkSim(F.simB30) };

    let gl, prog, uM, uC, uB, uS, aP, vao = null, bufs = {}, k = 0, marker = new Float32Array(8), markerDirty = true;
    const L = {
      id: "track3d", type: "custom", renderingMode: "3d",
      show: { flown: true, pre: false, live: true, hind: false, limit: false, b25: false, b30: false }, ready: false,
      setTime(t) {
        k = Math.max(0, idx(tr.t, t));
        const p = posAt(t), a = MC(p[0], p[1], p[2]), g = MC(p[0], p[1], base);
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
        if (L.show.pre) draw(bufs.sim_pre, gl.LINE_STRIP, 0, simBuf.pre.length / 4, [0.95, 0.95, 0.95, 0.55], 1);
        if (L.show.hind) draw(bufs.sim_hind, gl.LINE_STRIP, 0, simBuf.hind.length / 4, [0.8, 0.88, 1.0, 0.85], 1);
        if (L.show.b25) draw(bufs.sim_b25, gl.LINE_STRIP, 0, simBuf.b25.length / 4, [0.95, 0.95, 0.95, 0.75], 1);
        if (L.show.b30) draw(bufs.sim_b30, gl.LINE_STRIP, 0, simBuf.b30.length / 4, [0.95, 0.95, 0.95, 0.5], 1);
        if (L.show.flown) {
          draw(bufs.curtain, gl.TRIANGLE_STRIP, 0, 2 * (k + 1), [0.95, 0.95, 0.95, 0.22], 0);
          draw(bufs.line, gl.LINE_STRIP, 0, n, [0.95, 0.95, 0.95, 0.3], 1);
          draw(bufs.line, gl.LINE_STRIP, 0, k + 1, [1, 1, 1, 1], 1);
        }
        draw(bufs.marker, gl.LINES, 0, 2, [1, 1, 1, 0.9], 0.2);
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

  /* ---------------- onboard AI ---------------- */

  function initAI() {
    const esc = s => s.replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);
    $("#aiTotal").textContent = nf(ANS.total);
    $("#aiFlight").textContent = nf(ANS.inFlight);
    $("#answers").innerHTML = ANS.list.map(a => `<li class="ans"><div class="ans__meta"><b>${nf(a.alt)} m</b>${clock(REL + a.t)} IST<br>${tplus(a.t)}<br>${nf(a.s, 1)} s, ${nf(a.tok, 1)} tok/s</div>
      <div><p class="ans__q">${esc(a.k)}: ${esc(a.q)}</p><p class="ans__a">${esc(a.a)}</p>
      ${a.again ? `<span class="ans__flag">Asked again after the checker caught a contradiction</span>` : ""}
      <div class="ans__act"><button data-t="${a.t}">Show on the map</button></div></div></li>`).join("");
    $("#answers").addEventListener("click", e => { const b = e.target.closest("button[data-t]"); if (b) toMap(+b.dataset.t); });
  }

  /* ---------------- footage ---------------- */

  function initFootage() {
    const v = $("#vid"), read = $("#vidRead");
    const upd = () => {
      const t = CLIP0 + v.currentTime - REL, i = idx(tr.t, t);
      if (i < 0) return;
      read.textContent = `${clock(REL + t)} IST · ${nf(posAt(t)[2])} m · ${t < F.burst ? "climbing" : "falling"} ${nf(Math.abs(tr.vz[i] || 0), 1)} m/s`;
    };
    v.addEventListener("timeupdate", upd); v.addEventListener("loadedmetadata", upd); upd();
    $("#vidMap").addEventListener("click", () => toMap(CLIP0 + v.currentTime - REL));

    const g = $("#gallery");
    g.innerHTML = STILLS.map((s, i) => `<li data-i="${i}"><img src="/hab-1-flight/img/${s.file}-s.jpg" alt="${s.label}, ${nf(s.alt)} m, ${clock(REL + s.t)} IST" loading="lazy" width="640" height="360">
      <div class="g__cap"><span><b>${s.label}</b></span><span>${nf(s.alt)} m · ${clock(REL + s.t)} IST</span></div></li>`).join("");
    const lb = $("#lightbox");
    g.addEventListener("click", e => {
      const li = e.target.closest("li"); if (!li) return;
      const s = STILLS[+li.dataset.i];
      $("#lbImg").src = `/hab-1-flight/img/${s.file}.jpg`; $("#lbImg").alt = li.querySelector("img").alt;
      $("#lbCap").innerHTML = `<b>${s.label}</b><span>${nf(s.alt)} m GPS</span><span>${clock(REL + s.t)} IST</span>
        <span>${s.vz < 0 ? "falling" : "climbing"} ${nf(Math.abs(s.vz), 1)} m/s</span><button class="btn" data-t="${s.t}">Show on the map</button>`;
      lb.showModal();
    });
    $("#lbClose").addEventListener("click", () => lb.close());
    lb.addEventListener("click", e => { if (e.target === lb) lb.close(); const b = e.target.closest("[data-t]"); if (b) { lb.close(); toMap(+b.dataset.t); } });
  }

  initPlayer(); initHud(); initMap(); initAI(); initFootage();
  setT(0);
})();
