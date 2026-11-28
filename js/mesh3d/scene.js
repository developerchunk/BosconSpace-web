// Boscon Mesh, scroll story for boscon.space.
// One scene, driven by a single number: scroll progress p in [0, 1].
//   p 0.00 to 0.18  Earth and the fleet in slow motion; grey links fade in
//   p 0.18 to 0.48  an instruction leaves Solapur, climbs to the nearest satellite, hops to an AI node
//   p 0.48 to 0.62  close on the AI node while it processes
//   p 0.62 to 0.82  the result hops back across the mesh and lands at Solapur
//   p 0.82 to 1.00  pull back to the whole Earth
// Earth: NASA Blue Marble NG and VIIRS City Lights via NASA GIBS. Orbits: circular, Kepler.
import * as THREE from 'three';
import { LAYERS, paintGlobal } from './tiles.js?v=1';
import {
  makeMaterials, sunUniform, buildRelay, buildAINode, buildResearchCentre,
  buildThirdPartyEO, buildThirdPartyFlat, buildGroundStation,
} from './models.js?v=1';

const RE_KM = 6371.0;
const MU = 398600.4418;
const OMEGA_E = 7.2921159e-5;
const DEG = Math.PI / 180;
const MODEL_K = 12000 / (RE_KM * 1000);  // spacecraft drawn 12,000x life size
const GS_K = 5000 / (RE_KM * 1000);
const BG = 0x0a0a0b;                      // site background, --bg

const CFG = {
  relay: { planes: 6, perPlane: 10, altKm: 1200, incDeg: 60 },
  ai: { count: 8, altKm: 650 },
  rc: { count: 2, altKm: 1000 },
  tp: 18,
  islMaxKm: 6000, grazeKm: 100, elevMaskDeg: 10,
  terminals: { relay: 4, ai: 6, rc: 6 },
};
const HOME = { lat: 17.66, lon: 75.91 }; // Solapur
const SUBSOLAR = { lat: -21, lon: 10 };   // fixed lighting: India in late-afternoon light, near the terminator where the AI nodes fly

const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const ease = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
const ramp = (a, b, x) => Math.min(1, Math.max(0, (x - a) / (b - a)));
const latlon = (lat, lon, out = new THREE.Vector3()) =>
  out.set(Math.cos(lat * DEG) * Math.cos(lon * DEG), Math.sin(lat * DEG), -Math.cos(lat * DEG) * Math.sin(lon * DEG));
function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

export function createOrbitStory(canvas, { onReady } = {}) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  const maxPR = Math.min(window.devicePixelRatio || 1, 1.75);
  let pixelRatio = maxPR;
  renderer.setPixelRatio(pixelRatio);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setClearColor(BG, 1);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(35, 1, 0.0005, 300);
  const sunDir = latlon(SUBSOLAR.lat, SUBSOLAR.lon);
  sunUniform.value.copy(sunDir);

  // ---------------------------------------------------------------- light and environment
  {
    const env = new THREE.Scene();
    env.add(new THREE.Mesh(new THREE.SphereGeometry(10, 48, 24), new THREE.ShaderMaterial({
      side: THREE.BackSide, uniforms: { uSun: { value: sunDir.clone() } },
      vertexShader: 'varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
      fragmentShader: `uniform vec3 uSun; varying vec3 vD; void main(){ float s = max(dot(normalize(vD), uSun), 0.0);
        vec3 c = vec3(0.05,0.055,0.065) + vec3(1.0,0.97,0.93)*pow(s,200.0)*14.0 + vec3(0.36)*pow(s,6.0)*0.8 + vec3(0.04,0.06,0.1)*(1.0-abs(vD.y));
        gl_FragColor = vec4(c,1.0); }`,
    })));
    const pm = new THREE.PMREMGenerator(renderer);
    scene.environment = pm.fromScene(env, 0, 0.1, 100).texture;
    pm.dispose();
  }
  const sunLight = new THREE.DirectionalLight(0xfff6ec, 3.3);
  sunLight.position.copy(sunDir).multiplyScalar(10);
  scene.add(sunLight, sunLight.target, new THREE.AmbientLight(0x2b3340, 0.25));

  // ---------------------------------------------------------------- stars, neutral and sparse
  const starMat = new THREE.ShaderMaterial({
    uniforms: { uPx: { value: pixelRatio } },
    vertexShader: 'attribute float aSize; uniform float uPx; varying vec3 vC; void main(){ vC = color; gl_PointSize = aSize*uPx; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
    fragmentShader: 'varying vec3 vC; void main(){ float r = length(gl_PointCoord-0.5)*2.0; gl_FragColor = vec4(vC*smoothstep(1.0,0.0,r),1.0); }',
    vertexColors: true, depthWrite: false, transparent: true, blending: THREE.AdditiveBlending,
  });
  {
    const N = 4200, r = rng(3);
    const pos = new Float32Array(N * 3), col = new Float32Array(N * 3), size = new Float32Array(N);
    const v = new THREE.Vector3();
    for (let i = 0; i < N; i++) {
      do { v.set(r() * 2 - 1, r() * 2 - 1, r() * 2 - 1); } while (v.lengthSq() > 1 || v.lengthSq() < 0.01);
      v.normalize().multiplyScalar(150).toArray(pos, i * 3);
      const m = Math.pow(r(), 5), w = 0.28 + 0.6 * m, t = r() * 0.08;
      col[i * 3] = w * (1 - t); col[i * 3 + 1] = w; col[i * 3 + 2] = w * (1 + t);
      size[i] = 0.6 + m * 2.2;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    const stars = new THREE.Points(g, starMat);
    stars.frustumCulled = false; stars.renderOrder = -2;
    scene.add(stars);
  }

  // ---------------------------------------------------------------- Earth
  const earth = new THREE.Group();
  scene.add(earth);
  const aniso = renderer.capabilities.getMaxAnisotropy();
  const W = Math.min(5120, renderer.capabilities.maxTextureSize);
  const mkCanvas = (w, fill) => { const c = document.createElement('canvas'); c.width = w; c.height = w / 2; const g = c.getContext('2d'); g.fillStyle = fill; g.fillRect(0, 0, w, w / 2); return c; };
  const dayCanvas = mkCanvas(W, '#0b1a33'), nightCanvas = mkCanvas(Math.min(4096, W), '#000');
  const ctex = (c) => { const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = aniso; t.wrapS = THREE.RepeatWrapping; return t; };
  const dayTex = ctex(dayCanvas), nightTex = ctex(nightCanvas);
  const cloudTex = new THREE.TextureLoader().load('https://cdn.jsdelivr.net/gh/mrdoob/three.js@r160/examples/textures/planets/earth_clouds_1024.png');
  cloudTex.wrapS = THREE.RepeatWrapping; cloudTex.anisotropy = aniso;

  const earthU = { uDay: { value: dayTex }, uNight: { value: nightTex }, uClouds: { value: cloudTex }, uSun: sunUniform, uCloudShift: { value: 0 } };
  earth.add(new THREE.Mesh(new THREE.SphereGeometry(1, 192, 96), new THREE.ShaderMaterial({
    uniforms: earthU,
    vertexShader: `varying vec2 vUv; varying vec3 vN; varying vec3 vP;
      void main(){ vUv = uv; vec4 wp = modelMatrix*vec4(position,1.0); vP = wp.xyz; vN = normalize(mat3(modelMatrix)*normal); gl_Position = projectionMatrix*viewMatrix*wp; }`,
    fragmentShader: `precision highp float;
      uniform sampler2D uDay, uNight, uClouds; uniform vec3 uSun; uniform float uCloudShift;
      varying vec2 vUv; varying vec3 vN; varying vec3 vP;
      void main(){
        vec3 day = texture2D(uDay, vUv).rgb;
        vec3 N = normalize(vN), L = normalize(uSun), V = normalize(cameraPosition - vP);
        float ndl = dot(N, L);
        float dayF = smoothstep(-0.10, 0.20, ndl);
        float water = smoothstep(1.5, 2.6, day.b/(max(day.r, day.g) + 0.004)) * (1.0 - smoothstep(0.12, 0.3, dot(day, vec3(0.3,0.59,0.11))));
        float cloud = texture2D(uClouds, vec2(fract(vUv.x - uCloudShift), vUv.y)).a;
        vec3 col = day * (0.015 + 1.35*pow(max(ndl, 0.0), 0.8));
        col *= 1.0 - 0.42*smoothstep(0.1, 0.8, cloud);
        vec3 H = normalize(L + V); float nh = max(dot(N, H), 0.0);
        col += vec3(1.0, 0.92, 0.8) * water * (pow(nh, 120.0)*1.4 + pow(nh, 14.0)*0.07) * smoothstep(0.0, 0.12, ndl);
        float nightF = 1.0 - smoothstep(-0.16, 0.04, ndl);
        col += texture2D(uNight, vUv).rgb * vec3(1.0, 0.8, 0.58) * 2.2 * nightF * (1.0 - 0.7*cloud);
        float term = smoothstep(-0.12, 0.04, ndl) * (1.0 - smoothstep(0.04, 0.32, ndl));
        col *= mix(vec3(1.0), vec3(1.18, 0.88, 0.72), term*0.6);
        float fres = pow(1.0 - max(dot(N, V), 0.0), 2.6);
        col += vec3(0.18, 0.36, 0.8) * fres * (0.08 + 0.92*dayF) * 0.7;
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  })));
  const clouds = new THREE.Mesh(new THREE.SphereGeometry(1.0045, 160, 80), new THREE.ShaderMaterial({
    uniforms: { uClouds: { value: cloudTex }, uSun: sunUniform }, transparent: true, depthWrite: false,
    vertexShader: `varying vec2 vUv; varying vec3 vN; varying vec3 vO;
      void main(){ vUv = uv; vO = position; vN = normalize(mat3(modelMatrix)*normal); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
    fragmentShader: `precision highp float; uniform sampler2D uClouds; uniform vec3 uSun; varying vec2 vUv; varying vec3 vN; varying vec3 vO;
      float hash(vec3 p){ p = fract(p*0.3183099 + 0.1); p *= 17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
      float noise(vec3 x){ vec3 i = floor(x), f = fract(x); f = f*f*(3.0-2.0*f);
        return mix(mix(mix(hash(i), hash(i+vec3(1,0,0)), f.x), mix(hash(i+vec3(0,1,0)), hash(i+vec3(1,1,0)), f.x), f.y),
                   mix(mix(hash(i+vec3(0,0,1)), hash(i+vec3(1,0,1)), f.x), mix(hash(i+vec3(0,1,1)), hash(i+vec3(1,1,1)), f.x), f.y), f.z); }
      float fbm(vec3 p){ float a = 0.5, s = 0.0; for (int i = 0; i < 4; i++){ s += a*noise(p); p *= 2.07; a *= 0.5; } return s; }
      void main(){
        float base = texture2D(uClouds, vUv).a;
        float n = fbm(vO*26.0);
        float a = smoothstep(0.14, 0.8, base + (n - 0.5)*0.5*smoothstep(0.02, 0.45, base));
        float ndl = dot(normalize(vN), normalize(uSun));
        float lit = smoothstep(-0.18, 0.3, ndl);
        float term = smoothstep(-0.15, 0.05, ndl)*(1.0 - smoothstep(0.05, 0.35, ndl));
        vec3 c = mix(vec3(0.015, 0.018, 0.025), vec3(0.96), lit) * mix(vec3(1.0), vec3(1.25, 0.85, 0.65), term*0.6) * (0.84 + 0.22*n);
        gl_FragColor = vec4(c, a*mix(0.6, 0.92, lit));
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  }));
  clouds.renderOrder = 1;
  earth.add(clouds);
  const atmo = new THREE.Mesh(new THREE.SphereGeometry(1.05, 96, 48), new THREE.ShaderMaterial({
    uniforms: { uSun: sunUniform }, side: THREE.BackSide, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: 'varying vec3 vP; void main(){ vec4 wp = modelMatrix*vec4(position,1.0); vP = wp.xyz; gl_Position = projectionMatrix*viewMatrix*wp; }',
    fragmentShader: `uniform vec3 uSun; varying vec3 vP;
      void main(){ vec3 ro = cameraPosition, rd = normalize(vP - ro);
        vec3 pc = ro + rd*max(-dot(ro, rd), 0.0); float h = max(length(pc) - 1.0, 0.0);
        float dens = exp(-h/0.0095)*(1.0 - smoothstep(0.035, 0.05, h));
        float s = dot(normalize(pc), normalize(uSun)); float day = smoothstep(-0.32, 0.22, s);
        vec3 col = mix(vec3(0.3, 0.55, 1.0), vec3(1.0, 0.55, 0.3), smoothstep(0.35, -0.15, s));
        gl_FragColor = vec4(col*dens*day*1.4, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  }));
  atmo.renderOrder = 2;
  scene.add(atmo);

  let ready = false;
  (async () => {
    const n = await paintGlobal(LAYERS.day, 2, dayCanvas);
    dayTex.needsUpdate = true;
    ready = true;
    onReady && onReady(n > 0);
    await paintGlobal(LAYERS.night, 2, nightCanvas);
    nightTex.needsUpdate = true;
    await paintGlobal(LAYERS.day, 3, dayCanvas);
    dayTex.needsUpdate = true;
    await paintGlobal(LAYERS.night, 3, nightCanvas);
    nightTex.needsUpdate = true;
  })();

  // ---------------------------------------------------------------- orbits and fleet
  const ssoInc = (h) => Math.acos(-Math.pow((RE_KM + h) / 12352, 3.5)) / DEG;
  const orbit = (altKm, incDeg, raan, u0) => { const a = RE_KM + altKm; return { r: a / RE_KM, inc: incDeg * DEG, raan, u0, n: Math.sqrt(MU / (a * a * a)) }; };
  function orbitState(o, t, pos, vel) {
    const u = o.u0 + o.n * t, cu = Math.cos(u), su = Math.sin(u), cO = Math.cos(o.raan), sO = Math.sin(o.raan), ci = Math.cos(o.inc), si = Math.sin(o.inc);
    pos.set(cO * cu - sO * su * ci, su * si, -(sO * cu + cO * su * ci)).multiplyScalar(o.r);
    vel.set(-cO * su - sO * cu * ci, cu * si, -(-sO * su + cO * cu * ci));
  }
  const sats = [];
  const add = (kind, model, orb) => sats.push({ id: sats.length, kind, model, orb, boscon: kind !== 'tp', pos: new THREE.Vector3(), vel: new THREE.Vector3(), x: new THREE.Vector3(), y: new THREE.Vector3(), z: new THREE.Vector3() });
  {
    const R = CFG.relay, total = R.planes * R.perPlane;
    for (let p = 0; p < R.planes; p++) for (let i = 0; i < R.perPlane; i++)
      add('relay', 'relay', orbit(R.altKm, R.incDeg, (p * 360 / R.planes) * DEG, ((i * 360) / R.perPlane + (p * 360) / total) * DEG));
    const raSun = Math.atan2(-sunDir.z, sunDir.x);
    const dawnDusk = raSun + Math.PI / 2; // orbit normal toward the Sun: always in sunlight
    for (let i = 0; i < CFG.ai.count; i++) add('ai', 'ai', orbit(CFG.ai.altKm, ssoInc(CFG.ai.altKm), dawnDusk, (i * 360 / CFG.ai.count + 10) * DEG));
    for (let i = 0; i < CFG.rc.count; i++) add('rc', 'rc', orbit(CFG.rc.altKm, ssoInc(CFG.rc.altKm), dawnDusk, (32.5 + i * 180) * DEG));
    const r = rng(7);
    for (let i = 0; i < CFG.tp; i++) {
      const g = i % 3, inc = g === 0 ? 97.5 : g === 1 ? 53 : 30 + r() * 55, alt = g === 0 ? 500 + r() * 100 : g === 1 ? 540 + r() * 30 : 450 + r() * 300;
      add('tp', r() < 0.45 ? 'tpFlat' : 'tpEO', orbit(alt, inc, r() * Math.PI * 2, r() * Math.PI * 2));
    }
  }
  const boscon = sats.filter((s) => s.boscon);

  const mats = makeMaterials(renderer);
  const MODELS = { relay: buildRelay(), ai: buildAINode(), rc: buildResearchCentre(), tpEO: buildThirdPartyEO(), tpFlat: buildThirdPartyFlat() };
  const fleets = [];
  for (const [key, model] of Object.entries(MODELS)) {
    const list = sats.filter((s) => s.model === key);
    list.forEach((s, i) => { s.inst = i; s.sizeR = Math.max(model.body.radius, model.wings.radius) * MODEL_K; });
    const mk = (b) => b.parts.map(({ mat, geo }) => { const m = new THREE.InstancedMesh(geo, mats[mat], list.length); m.frustumCulled = false; m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); scene.add(m); return m; });
    fleets.push({ list, axis: model.axis, body: mk(model.body), wings: mk(model.wings) });
  }

  // ---------------------------------------------------------------- Solapur ground station
  const homeLocal = latlon(HOME.lat, HOME.lon);
  const gs = buildGroundStation(mats);
  gs.root.position.copy(homeLocal).multiplyScalar(1.0002);
  gs.root.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), homeLocal);
  gs.root.scale.setScalar(GS_K);
  earth.add(gs.root);
  const home = { id: 1000, world: new THREE.Vector3(), up: new THREE.Vector3() };

  // ---------------------------------------------------------------- points (glows, packet, rings) and lines
  function points(max, frag) {
    const g = new THREE.BufferGeometry();
    for (const [k, n] of [['position', 3], ['aSize', 1], ['aAlpha', 1], ['aModel', 1], ['aT', 1]]) g.setAttribute(k, new THREE.BufferAttribute(new Float32Array(max * n), n).setUsage(THREE.DynamicDrawUsage));
    g.setDrawRange(0, 0);
    const m = new THREE.ShaderMaterial({
      uniforms: { uPx: { value: pixelRatio }, uProj: { value: 1 } },
      vertexShader: `attribute float aSize; attribute float aAlpha; attribute float aModel; attribute float aT; uniform float uPx; uniform float uProj;
        varying float vA; varying float vT;
        void main(){ vec4 mv = modelViewMatrix*vec4(position,1.0); gl_Position = projectionMatrix*mv;
          float px = aModel*uProj/max(-mv.z, 1e-5); float f = aModel > 0.0 ? 1.0 - smoothstep(14.0, 40.0, px) : 1.0;
          gl_PointSize = aSize*uPx; vA = aAlpha*f; vT = aT; }`,
      fragmentShader: `varying float vA; varying float vT; ${frag}`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
    });
    const p = new THREE.Points(g, m); p.frustumCulled = false; p.renderOrder = 6; scene.add(p);
    return { g, m, a: g.attributes, max };
  }
  const DOT = 'void main(){ float r = length(gl_PointCoord-0.5)*2.0; float a = (smoothstep(0.36,0.06,r) + exp(-r*r*6.0)*0.55)*vA; if (a < 0.004) discard; gl_FragColor = vec4(vec3(0.96,0.96,0.95)*a, a); }';
  const RING = 'void main(){ float r = length(gl_PointCoord-0.5)*2.0; float a = exp(-pow((r-0.84)*10.0,2.0))*vA; if (a < 0.004) discard; gl_FragColor = vec4(vec3(0.96,0.96,0.95)*a, a); }';
  const glow = points(sats.length, DOT);
  const pkt = points(24, DOT);
  const rings = points(8, RING);
  rings.m.depthTest = false;
  const occluded = (q) => { _o.subVectors(q, camera.position); const L = _o.length(); _o.divideScalar(L); const b = camera.position.dot(_o); const d = b * b - (camera.position.lengthSq() - 0.997 * 0.997); if (d < 0) return false; const t = -b - Math.sqrt(d); return t > 0 && t < L - 1e-4; };
  const _o = new THREE.Vector3();
  function lines(max, opacityScale) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(max * 6), 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aA', new THREE.BufferAttribute(new Float32Array(max * 2), 1).setUsage(THREE.DynamicDrawUsage));
    g.setDrawRange(0, 0);
    const m = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color(0xf3f3f1) }, uOp: { value: opacityScale } },
      vertexShader: 'attribute float aA; varying float vA; void main(){ vA = aA; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
      fragmentShader: 'uniform vec3 uColor; uniform float uOp; varying float vA; void main(){ float a = vA*uOp; gl_FragColor = vec4(uColor*a, a); }',
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
    });
    const l = new THREE.LineSegments(g, m); l.frustumCulled = false; l.renderOrder = 4; scene.add(l);
    return { g, m, max, n: 0, put(a, b, al) { if (this.n >= max) return; a.toArray(g.attributes.position.array, this.n * 6); b.toArray(g.attributes.position.array, this.n * 6 + 3); g.attributes.aA.array[this.n * 2] = al; g.attributes.aA.array[this.n * 2 + 1] = al; this.n++; }, flush() { g.setDrawRange(0, this.n * 2); g.attributes.position.needsUpdate = g.attributes.aA.needsUpdate = true; this.n = 0; } };
  }
  const meshLines = lines(500, 1);
  meshLines.m.uniforms.uColor.value.set(0xa7adb5); // grey
  const routeLines = lines(24, 1);

  // ---------------------------------------------------------------- links: line of sight, range, laser terminals
  const GRAZE = 1 + CFG.grazeKm / RE_KM, ISL = CFG.islMaxKm / RE_KM, SIN_MASK = Math.sin(CFG.elevMaskDeg * DEG);
  const _a = new THREE.Vector3(), _b = new THREE.Vector3();
  const los = (p, q) => { _a.subVectors(q, p); const t = THREE.MathUtils.clamp(-p.dot(_a) / _a.lengthSq(), 0, 1); return _b.copy(p).addScaledVector(_a, t).length() > GRAZE; };
  const elev = (p) => { _a.subVectors(p, home.world); return _a.dot(home.up) / _a.length(); };
  const key = (a, b) => (a < b ? a + '|' + b : b + '|' + a);
  const links = new Map();
  let lastCand = -9;
  const nodePos = (id) => (id === 1000 ? home.world : sats[id].pos);
  function updateLinks(now) {
    const used = new Map();
    for (const [k, L] of links) {
      const pa = nodePos(L.a), pb = nodePos(L.b);
      const ok = L.ground ? elev(pb) > SIN_MASK * 0.95 : pa.distanceTo(pb) < ISL * 1.03 && los(pa, pb);
      if (!ok) { links.delete(k); continue; }
      if (!L.ground) { used.set(L.a, (used.get(L.a) || 0) + 1); used.set(L.b, (used.get(L.b) || 0) + 1); }
    }
    if (now - lastCand < 0.25) return;
    lastCand = now;
    const free = (s) => (used.get(s.id) || 0) < CFG.terminals[s.kind];
    const cand = [];
    for (let i = 0; i < boscon.length; i++) {
      const s = boscon[i]; if (!free(s)) continue;
      for (let j = i + 1; j < boscon.length; j++) {
        const t = boscon[j]; if (!free(t) || links.has(key(s.id, t.id))) continue;
        const d = s.pos.distanceTo(t.pos);
        if (d < ISL && los(s.pos, t.pos)) cand.push([d, s, t]);
      }
    }
    cand.sort((x, y) => x[0] - y[0]);
    for (const [, s, t] of cand) {
      if (!free(s) || !free(t)) continue;
      links.set(key(s.id, t.id), { a: s.id, b: t.id });
      used.set(s.id, (used.get(s.id) || 0) + 1); used.set(t.id, (used.get(t.id) || 0) + 1);
    }
    let g = 0;
    for (const L of links.values()) if (L.ground) g++;
    if (g < 2) {
      const vis = boscon.filter((s) => !links.has(key(1000, s.id)) && elev(s.pos) > SIN_MASK).sort((p, q) => elev(q.pos) - elev(p.pos));
      for (const s of vis.slice(0, 2 - g)) links.set(key(1000, s.id), { a: 1000, b: s.id, ground: true });
    }
  }
  function route(src, goal) {
    const adj = new Map();
    const push = (u, v) => { if (!adj.has(u)) adj.set(u, []); adj.get(u).push(v); };
    for (const L of links.values()) { push(L.a, L.b); push(L.b, L.a); }
    const dist = new Map([[src, 0]]), prev = new Map(), done = new Set(), open = [src];
    while (open.length) {
      let bi = 0; for (let i = 1; i < open.length; i++) if (dist.get(open[i]) < dist.get(open[bi])) bi = i;
      const u = open.splice(bi, 1)[0];
      if (done.has(u)) continue; done.add(u);
      if (u !== src && goal(u)) { const path = [u]; while (prev.has(path[0])) path.unshift(prev.get(path[0])); return path; }
      if (u === 1000 && u !== src) continue;
      for (const v of adj.get(u) || []) { const nd = dist.get(u) + nodePos(u).distanceTo(nodePos(v)); if (!dist.has(v) || nd < dist.get(v)) { dist.set(v, nd); prev.set(v, u); open.push(v); } }
    }
    return null;
  }
  let story = null; // { up: [ids], down: [ids], ai }
  function planStory() {
    const up = route(1000, (id) => id !== 1000 && sats[id].kind === 'ai');
    if (!up) return;
    const ai = up[up.length - 1];
    const down = route(ai, (id) => id === 1000);
    if (down) story = { up, down, ai };
  }

  // ---------------------------------------------------------------- per-frame state
  let simT = 0, now = 0, pTarget = 0, p = 0, visible = false, raf = 0, lastTime = 0, w = 1, h = 1;
  const _m = new THREE.Matrix4(), _r = new THREE.Matrix4(), _wm = new THREE.Matrix4(), _s = new THREE.Matrix4().makeScale(MODEL_K, MODEL_K, MODEL_K);
  const Y = new THREE.Vector3(0, 1, 0);

  function updateFleet() {
    for (const s of sats) {
      orbitState(s.orb, simT, s.pos, s.vel);
      s.z.copy(s.pos).normalize(); s.x.copy(s.vel).normalize(); s.y.crossVectors(s.z, s.x).normalize();
    }
    for (const f of fleets) {
      for (const s of f.list) {
        _m.makeBasis(s.x, s.y, s.z).setPosition(s.pos).multiply(_s);
        for (const m of f.body) m.setMatrixAt(s.inst, _m);
        const sx = sunDir.dot(s.x), sy = sunDir.dot(s.y), sz = sunDir.dot(s.z);
        if (f.axis === 'y') _r.makeRotationY(Math.atan2(sx, sz)); else _r.makeRotationX(Math.atan2(-sy, sz));
        _wm.multiplyMatrices(_m, _r);
        for (const m of f.wings) m.setMatrixAt(s.inst, _wm);
      }
      for (const m of [...f.body, ...f.wings]) m.instanceMatrix.needsUpdate = true;
    }
  }

  // position along a chain of moving nodes, u in [0, 1] by arc length
  function along(ids, u, out) {
    let total = 0;
    for (let i = 0; i < ids.length - 1; i++) total += nodePos(ids[i]).distanceTo(nodePos(ids[i + 1]));
    let d = Math.min(Math.max(u, 0), 1) * total;
    for (let i = 0; i < ids.length - 1; i++) {
      const a = nodePos(ids[i]), b = nodePos(ids[i + 1]), L = a.distanceTo(b);
      if (d <= L || i === ids.length - 2) return { pos: out.copy(a).lerp(b, L > 0 ? Math.min(d / L, 1) : 0), hop: i, frac: L > 0 ? d / L : 0 };
      d -= L;
    }
    return { pos: out.copy(nodePos(ids[0])), hop: 0, frac: 0 };
  }

  // ---------------------------------------------------------------- camera keyframes
  const halfFov = () => {
    const v = (camera.fov * DEG) / 2;
    return Math.min(v, Math.atan(Math.tan(v) * camera.aspect));
  };
  function kEarth(fit, yaw, pitch) {
    const dir = home.world.clone().normalize();
    const side = new THREE.Vector3().crossVectors(Y, dir).normalize();
    dir.applyAxisAngle(Y, yaw).applyAxisAngle(side, -pitch).normalize();
    return { target: new THREE.Vector3(), pos: dir.multiplyScalar(fit / Math.sin(halfFov())) };
  }
  function kPath(ids) {
    const c = new THREE.Vector3();
    for (const id of ids) c.add(nodePos(id));
    c.normalize();
    const target = c.clone().multiplyScalar(1.02);
    let lat = 0.25;
    for (const id of ids) { const q = nodePos(id); const along = q.clone().sub(target); const t = along.dot(c); lat = Math.max(lat, along.addScaledVector(c, -t).length()); }
    const side = new THREE.Vector3().crossVectors(Y, c).normalize();
    const view = c.clone().multiplyScalar(Math.cos(0.42)).addScaledVector(side, Math.sin(0.42)).addScaledVector(Y, -0.12).normalize();
    const dist = Math.max((lat * 1.25) / Math.tan(halfFov()) + 0.25, 0.8);
    return { target, pos: target.clone().addScaledVector(view, dist) };
  }
  function kSat(s) {
    const k = s.sizeR;
    return { target: s.pos.clone(), pos: s.pos.clone().addScaledVector(s.x, -2.5 * k).addScaledVector(s.y, 1.6 * k).addScaledVector(s.z, 0.75 * k) };
  }
  const mix = (A, B, t) => ({ pos: A.pos.clone().lerp(B.pos, t), target: A.target.clone().lerp(B.target, t) });
  function cameraAt(pp) {
    const start = kEarth(1.32, 0.42, 0.18);
    const end = kEarth(1.5, -0.28, 0.14);
    if (!story) return mix(start, end, ease(smooth(0.8, 0.95, pp)));
    const up = kPath(story.up), down = kPath(story.down), ai = kSat(sats[story.ai]);
    if (pp < 0.16) return start;
    if (pp < 0.28) return mix(start, up, ease(ramp(0.16, 0.28, pp)));
    if (pp < 0.44) return up;
    if (pp < 0.52) return mix(up, ai, ease(ramp(0.44, 0.52, pp)));
    if (pp < 0.6) return ai;
    if (pp < 0.68) return mix(ai, down, ease(ramp(0.6, 0.68, pp)));
    if (pp < 0.8) return down;
    if (pp < 0.93) return mix(down, end, ease(ramp(0.8, 0.93, pp)));
    return end;
  }

  // ---------------------------------------------------------------- frame
  const tmp = new THREE.Vector3(), tmp2 = new THREE.Vector3();
  function frame(t, dtStep) {
    let dt;
    if (dtStep === undefined) {
      raf = visible ? requestAnimationFrame(frame) : 0;
      dt = Math.min(Math.max((t - (lastTime || t)) / 1000, 0), 0.05);
      lastTime = t;
    } else dt = dtStep;
    now += dt;
    if (visible) guard(dt);
    p += (pTarget - p) * (1 - Math.exp(-dt * 7));
    if (Math.abs(pTarget - p) < 1e-4) p = pTarget;

    // slow drift at either end of the story, nearly still while data is moving
    const inStory = smooth(0.14, 0.24, p) * (1 - smooth(0.82, 0.92, p));
    simT += dt * (24 - 22 * inStory);
    const t2 = simT + p * 360;
    const theta = OMEGA_E * p * 360; // Earth turns only with scroll, so the light on India stays as designed
    earth.rotation.y = theta;
    clouds.rotation.y = t2 * 4e-6;
    earthU.uCloudShift.value = clouds.rotation.y / (Math.PI * 2);
    home.world.copy(homeLocal).applyAxisAngle(Y, theta);
    home.up.copy(home.world).normalize();
    const saveT = simT; simT = t2; updateFleet(); simT = saveT;
    updateLinks(now);
    if (p < 0.17 || !story) { if (now % 1 < dt || !story) planStory(); }

    // camera
    const k = cameraAt(p);
    camera.position.copy(k.pos);
    camera.lookAt(k.target);
    const dist = camera.position.distanceTo(k.target);
    const near = THREE.MathUtils.clamp(dist * 0.02, 0.00005, 0.05);
    if (Math.abs(near - camera.near) / camera.near > 0.15) { camera.near = near; camera.updateProjectionMatrix(); }

    // grey mesh links: fade in during the first step, quiet while the route is shown
    const meshA = smooth(0.03, 0.14, p) * (1 - 0.45 * inStory);
    if (meshA > 0.005) {
      for (const L of links.values()) meshLines.put(nodePos(L.a), nodePos(L.b), (L.ground ? 0.85 : 0.6) * meshA);
    }
    meshLines.flush();

    // glows
    let n = 0;
    const proj = h / (2 * Math.tan((camera.fov * DEG) / 2));
    glow.m.uniforms.uProj.value = proj;
    for (const s of sats) {
      s.pos.toArray(glow.a.position.array, n * 3);
      glow.a.aSize.array[n] = s.kind === 'tp' ? 12 : s.kind === 'relay' ? 15 : 21;
      glow.a.aAlpha.array[n] = s.kind === 'tp' ? 0.55 : 1.0;
      glow.a.aModel.array[n] = s.sizeR;
      n++;
    }
    glow.g.setDrawRange(0, n);
    for (const a of ['position', 'aSize', 'aAlpha', 'aModel']) glow.a[a].needsUpdate = true;

    // the instruction and the result
    let pn = 0, rn = 0;
    const ring = (pos, phase, size, alpha) => {
      if (rn >= rings.max || alpha <= 0.003 || occluded(pos)) return;
      pos.toArray(rings.a.position.array, rn * 3);
      rings.a.aSize.array[rn] = size * (0.25 + 0.75 * phase);
      rings.a.aAlpha.array[rn] = alpha * (1 - phase);
      rings.a.aModel.array[rn] = 0;
      rn++;
    };
    const packet = (ids, u, alpha) => {
      if (alpha <= 0.003) return;
      for (let j = 0; j < 9 && pn < pkt.max; j++) {
        const r = along(ids, u - j * 0.012, tmp);
        if (u - j * 0.012 < 0) break;
        r.pos.toArray(pkt.a.position.array, pn * 3);
        pkt.a.aSize.array[pn] = j === 0 ? 17 : 11 - j;
        pkt.a.aAlpha.array[pn] = alpha * (j === 0 ? 1.2 : 0.5 * (1 - j / 9));
        pkt.a.aModel.array[pn] = 0;
        pn++;
      }
    };
    const routeLine = (ids, u, alpha) => {
      if (alpha <= 0.003) return;
      const r = along(ids, u, tmp2);
      for (let i = 0; i < ids.length - 1; i++) {
        const a = nodePos(ids[i]), b = nodePos(ids[i + 1]);
        if (i < r.hop) routeLines.put(a, b, 0.75 * alpha);
        else if (i === r.hop) { routeLines.put(a, r.pos, 0.75 * alpha); routeLines.put(r.pos, b, 0.18 * alpha); }
        else routeLines.put(a, b, 0.18 * alpha);
      }
    };
    if (story) {
      const uUp = ease(ramp(0.27, 0.46, p));
      const uDown = ease(ramp(0.62, 0.8, p));
      const upA = smooth(0.22, 0.27, p) * (1 - smooth(0.6, 0.66, p));
      const downA = smooth(0.58, 0.63, p) * (1 - smooth(0.86, 0.92, p));
      routeLine(story.up, uUp, upA);
      routeLine(story.down, uDown, downA);
      packet(story.up, uUp, smooth(0.25, 0.28, p) * (1 - smooth(0.46, 0.49, p)));
      packet(story.down, uDown, smooth(0.61, 0.63, p) * (1 - smooth(0.8, 0.83, p)));
      // leaving the ground, processing on the AI node, landing
      const send = ramp(0.25, 0.32, p);
      if (send > 0 && send < 1) ring(home.world, send, 70, 1);
      const aiPos = sats[story.ai].pos;
      for (let i = 0; i < 3; i++) {
        const ph = (ramp(0.46, 0.62, p) * 3 + i / 3) % 1;
        if (p > 0.46 && p < 0.62) ring(aiPos, ph, 240, 0.6 * smooth(0.46, 0.49, p) * (1 - smooth(0.59, 0.62, p)));
      }
      // quiet markers: the station, and the AI node the instruction is heading for
      ring(home.world, 0.4, 34, 0.7 * smooth(0.18, 0.24, p) * (1 - smooth(0.86, 0.92, p)));
      ring(aiPos, 0.4, 40, 0.8 * smooth(0.22, 0.27, p) * (1 - smooth(0.44, 0.47, p)));
      const land = ramp(0.8, 0.87, p);
      if (land > 0 && land < 1) ring(home.world, land, 70, 1);
      mats.ledB.color.setScalar(1 + 4 * smooth(0.47, 0.5, p) * (1 - smooth(0.58, 0.62, p)));
    }
    routeLines.flush();
    pkt.g.setDrawRange(0, pn);
    rings.g.setDrawRange(0, rn);
    for (const L of [pkt, rings]) for (const a of ['position', 'aSize', 'aAlpha', 'aModel']) L.a[a].needsUpdate = true;

    // ground station dish follows its highest linked satellite
    let best = null, be = -2;
    for (const L of links.values()) if (L.ground) { const e = elev(sats[L.b].pos); if (e > be) { be = e; best = sats[L.b].pos; } }
    earth.updateMatrixWorld(true);
    gs.head.lookAt(best || tmp.copy(home.world).multiplyScalar(2));

    renderer.render(scene, camera);
  }

  function resize() {
    const r = canvas.getBoundingClientRect();
    w = Math.max(1, r.width); h = Math.max(1, r.height);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    // desktop: the planet sits right of centre, leaving the left for the copy; phone: lifted above the copy
    if (w > 960) camera.setViewOffset(w, h, -w * 0.13, 0, w, h);
    else camera.setViewOffset(w, h, 0, h * 0.1, w, h);
    camera.updateProjectionMatrix();
  }
  const ro = new ResizeObserver(resize);
  ro.observe(canvas);
  resize();

  // quality guard: drop resolution if frames run slow while the section is on screen.
  // Frames over 50 ms are skipped: they come from a hidden or throttled tab.
  let slowAcc = 0, slowN = 0;
  function guard(dt) {
    if (dt <= 0 || dt >= 0.05 || document.hidden) return;
    slowAcc += dt; slowN++;
    if (slowN < 120) return;
    if (slowAcc / slowN > 0.022 && pixelRatio > 1) {
      pixelRatio = Math.max(1, pixelRatio - 0.25); renderer.setPixelRatio(pixelRatio); resize();
      for (const m of [glow.m, pkt.m, rings.m, starMat]) m.uniforms.uPx.value = pixelRatio;
    }
    slowAcc = 0; slowN = 0;
  }

  return {
    setProgress(v) { pTarget = Math.min(1, Math.max(0, v)); },
    setVisible(v) {
      visible = v;
      if (v && !raf) { lastTime = 0; raf = requestAnimationFrame(frame); }
    },
    get ready() { return ready; },
    debug: { step(n = 1, dt = 1 / 60) { for (let i = 0; i < n; i++) frame(0, dt); }, sats, links, camera, nodePos, home, get story() { return story; }, get p() { return p; }, renderer },
  };
}
