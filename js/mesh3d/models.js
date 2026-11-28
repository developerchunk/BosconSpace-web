// Procedural spacecraft for the Boscon Mesh section of boscon.space.
// Every part is real geometry with PBR materials and generated textures (no downloads):
// gold and silver MLI with a crinkle normal map, glass-covered solar cells, optical solar
// reflector (OSR) tiles, heat-pipe radiators, phased arrays, parabolic dishes, laser terminals,
// star trackers, thrusters. Parts are merged per material so one InstancedMesh draws a whole
// fleet: about 10 to 14 draw calls per spacecraft type, whatever the fleet size.
// Body frame: +X along velocity, +Y orbit normal, +Z zenith (nadir is -Z). Units: metres.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const PI = Math.PI;

export const sunUniform = { value: new THREE.Vector3(1, 0, 0) };

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------- transforms
export function M(px = 0, py = 0, pz = 0, rx = 0, ry = 0, rz = 0, s = 1) {
  return new THREE.Matrix4().compose(
    V(px, py, pz),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)),
    V(s, s, s)
  );
}
function B(xAxis, yAxis, zAxis, pos = V(0, 0, 0)) {
  return new THREE.Matrix4().makeBasis(xAxis, yAxis, zAxis).setPosition(pos);
}
// Plane facing a given body axis.
const FACE = {
  '+X': (p) => B(V(0, 1, 0), V(0, 0, 1), V(1, 0, 0), p),
  '-X': (p) => B(V(0, -1, 0), V(0, 0, 1), V(-1, 0, 0), p),
  '+Y': (p) => B(V(-1, 0, 0), V(0, 0, 1), V(0, 1, 0), p),
  '-Y': (p) => B(V(1, 0, 0), V(0, 0, 1), V(0, -1, 0), p),
  '+Z': (p) => B(V(1, 0, 0), V(0, 1, 0), V(0, 0, 1), p),
  '-Z': (p) => B(V(1, 0, 0), V(0, -1, 0), V(0, 0, -1), p),
};

class Kit {
  constructor() { this.parts = []; this.stack = [new THREE.Matrix4()]; }
  top() { return this.stack[this.stack.length - 1]; }
  push(m) { this.stack.push(this.top().clone().multiply(m)); return this; }
  pop() { this.stack.pop(); return this; }
  add(geo, mat, m) {
    geo.applyMatrix4(m ? this.top().clone().multiply(m) : this.top());
    this.parts.push({ geo, mat });
    return this;
  }
  bake() {
    const by = new Map();
    for (const { geo, mat } of this.parts) {
      const g = geo.index ? geo.toNonIndexed() : geo;
      for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
      if (!by.has(mat)) by.set(mat, []);
      by.get(mat).push(g);
    }
    const out = [];
    let radius = 0;
    for (const [mat, list] of by) {
      const geo = mergeGeometries(list, false);
      geo.computeBoundingSphere();
      radius = Math.max(radius, geo.boundingSphere.center.length() + geo.boundingSphere.radius);
      out.push({ mat, geo });
    }
    return { parts: out, radius };
  }
}

// ---------------------------------------------------------------- primitives
const box = (x, y, z) => new THREE.BoxGeometry(x, y, z);
const cyl = (rt, rb, h, seg = 20, open = false) => new THREE.CylinderGeometry(rt, rb, h, seg, 1, open);
const flat = (g) => { const n = g.toNonIndexed(); n.computeVertexNormals(); return n; };
function plane(w, h, su = 1, sv = 1) {
  const g = new THREE.PlaneGeometry(w, h);
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv);
  return g;
}
function rod(k, a, b, r, mat, seg = 8) {
  const d = b.clone().sub(a);
  const L = d.length();
  const q = new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), d.normalize());
  k.add(cyl(r, r, L, seg, true), mat, new THREE.Matrix4().compose(a.clone().add(b).multiplyScalar(0.5), q, V(1, 1, 1)));
}
function dishGeo(R, fRatio = 0.42, seg = 40) {
  const f = R * fRatio;
  const pts = [];
  for (let i = 0; i <= 14; i++) { const r = (i / 14) * R; pts.push(new THREE.Vector2(Math.max(r, 0.001), (r * r) / (4 * f))); }
  return { geo: new THREE.LatheGeometry(pts, seg), depth: (R * R) / (4 * f), f };
}
function nozzleGeo(rt, re, L) {
  const pts = [];
  for (let i = 0; i <= 10; i++) { const t = i / 10; pts.push(new THREE.Vector2(rt + (re - rt) * Math.pow(t, 0.7), -L * t)); }
  return new THREE.LatheGeometry(pts, 20);
}

// ---------------------------------------------------------------- textures
function canvas(w, h = w) { const c = document.createElement('canvas'); c.width = w; c.height = h; return [c, c.getContext('2d')]; }

function heightToNormal(src, strength) {
  const w = src.width, h = src.height;
  const s = src.getContext('2d').getImageData(0, 0, w, h).data;
  const [c, g] = canvas(w, h);
  const out = g.createImageData(w, h);
  const H = (x, y) => s[(((y + h) % h) * w + ((x + w) % w)) * 4] / 255;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = (H(x + 1, y) - H(x - 1, y)) * strength;
      const dy = (H(x, y + 1) - H(x, y - 1)) * strength;
      const n = V(-dx, dy, 1).normalize();
      const i = (y * w + x) * 4;
      out.data[i] = (n.x * 0.5 + 0.5) * 255;
      out.data[i + 1] = (n.y * 0.5 + 0.5) * 255;
      out.data[i + 2] = (n.z * 0.5 + 0.5) * 255;
      out.data[i + 3] = 255;
    }
  }
  g.putImageData(out, 0, 0);
  return c;
}

function mliTextures() {
  const r = rng(11);
  const S = 512;
  const [hc, hg] = canvas(S);
  hg.fillStyle = '#808080';
  hg.fillRect(0, 0, S, S);
  // crinkles: many short curved creases, light and dark
  for (let i = 0; i < 1400; i++) {
    const x = r() * S, y = r() * S, a = r() * PI * 2, L = 10 + r() * 60;
    hg.strokeStyle = r() < 0.5 ? `rgba(255,255,255,${0.05 + r() * 0.12})` : `rgba(0,0,0,${0.05 + r() * 0.12})`;
    hg.lineWidth = 1 + r() * 4;
    hg.beginPath();
    hg.moveTo(x, y);
    hg.quadraticCurveTo(x + Math.cos(a + 0.8) * L * 0.5, y + Math.sin(a + 0.8) * L * 0.5, x + Math.cos(a) * L, y + Math.sin(a) * L);
    hg.stroke();
  }
  // soft pillowing between tie points
  for (let i = 0; i < 90; i++) {
    const x = r() * S, y = r() * S, rad = 20 + r() * 50;
    const gr = hg.createRadialGradient(x, y, 0, x, y, rad);
    const v = r() < 0.5 ? 255 : 0;
    gr.addColorStop(0, `rgba(${v},${v},${v},0.10)`);
    gr.addColorStop(1, `rgba(${v},${v},${v},0)`);
    hg.fillStyle = gr;
    hg.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
  const [bc, bg] = canvas(S);
  bg.filter = 'blur(1.2px)';
  bg.drawImage(hc, 0, 0);
  bg.filter = 'none';
  // tape seams and tie points
  bg.strokeStyle = 'rgba(255,255,255,0.35)';
  bg.lineWidth = 6;
  bg.beginPath(); bg.moveTo(0, S * 0.5); bg.lineTo(S, S * 0.5); bg.moveTo(S * 0.5, 0); bg.lineTo(S * 0.5, S); bg.stroke();
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
    bg.fillStyle = 'rgba(40,40,40,0.8)';
    bg.beginPath(); bg.arc(S * (0.125 + i * 0.25), S * (0.125 + j * 0.25), 3, 0, PI * 2); bg.fill();
  }
  const normal = heightToNormal(bc, 3.2);
  const h = bg.getImageData(0, 0, S, S).data;
  const tint = (lo, hi) => {
    const [c, g] = canvas(S);
    const img = g.createImageData(S, S);
    for (let i = 0; i < S * S; i++) {
      const t = Math.pow(h[i * 4] / 255, 1.4) * 1.25;
      for (let k = 0; k < 3; k++) img.data[i * 4 + k] = Math.min(255, lo[k] + (hi[k] - lo[k]) * t);
      img.data[i * 4 + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    return c;
  };
  return {
    gold: tint([150, 96, 22], [255, 208, 110]),
    silver: tint([120, 124, 132], [236, 239, 243]),
    normal,
  };
}

function cellTexture() {
  const S = 1024, n = 8, p = S / n;
  const [c, g] = canvas(S);
  const r = rng(5);
  g.fillStyle = '#c7ccd3';
  g.fillRect(0, 0, S, S);
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    const x = i * p + 3, y = j * p + 3, w = p - 6, cut = 13;
    const v = r() * 10;
    const gr = g.createLinearGradient(x, y, x + w, y + w);
    gr.addColorStop(0, `rgb(${14 + v},${28 + v},${70 + v * 2})`);
    gr.addColorStop(1, `rgb(${8 + v},${18 + v},${48 + v * 2})`);
    g.fillStyle = gr;
    g.beginPath();
    g.moveTo(x + cut, y); g.lineTo(x + w - cut, y); g.lineTo(x + w, y + cut); g.lineTo(x + w, y + w - cut);
    g.lineTo(x + w - cut, y + w); g.lineTo(x + cut, y + w); g.lineTo(x, y + w - cut); g.lineTo(x, y + cut);
    g.closePath(); g.fill();
    g.save(); g.clip();
    g.fillStyle = 'rgba(170,185,215,0.16)';
    for (let f = y + 4; f < y + w; f += 5) g.fillRect(x, f, w, 1);
    g.fillStyle = 'rgba(215,220,230,0.75)';
    for (const bx of [0.25, 0.5, 0.75]) g.fillRect(x + w * bx - 1.5, y, 3, w);
    g.restore();
  }
  return c;
}

function carbonTexture() {
  const S = 256;
  const [c, g] = canvas(S);
  g.fillStyle = '#7c828c'; g.fillRect(0, 0, S, S);
  for (let y = 0; y < S; y += 8) for (let x = 0; x < S; x += 8) {
    const o = ((x + y) / 8) % 2;
    g.fillStyle = o ? '#868c96' : '#737983';
    g.fillRect(x, y, 8, 8);
    g.fillStyle = 'rgba(255,255,255,0.05)';
    g.fillRect(x, y + (o ? 1 : 5), 8, 1);
  }
  g.strokeStyle = 'rgba(200,205,215,0.35)'; g.lineWidth = 2;
  for (let x = 0; x <= S; x += 64) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, S); g.stroke(); }
  return c;
}

function osrTexture() {
  const S = 512, n = 16, p = S / n;
  const [c, g] = canvas(S);
  const r = rng(3);
  g.fillStyle = '#4a4f57'; g.fillRect(0, 0, S, S);
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    const v = 205 + r() * 35;
    g.fillStyle = `rgb(${v},${v + 3},${v + 8})`;
    g.fillRect(i * p + 1.5, j * p + 1.5, p - 3, p - 3);
  }
  return c;
}

function radiatorTexture() {
  const S = 512;
  const [c, g] = canvas(S);
  g.fillStyle = '#e8ebef'; g.fillRect(0, 0, S, S);
  for (let x = 16; x < S; x += 32) {
    const gr = g.createLinearGradient(x - 6, 0, x + 6, 0);
    gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(0.5, 'rgba(80,90,105,0.28)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.fillRect(x - 6, 0, 12, S);
  }
  g.fillStyle = 'rgba(70,75,85,0.6)';
  for (let y = 8; y < S; y += 64) for (let x = 8; x < S; x += 64) { g.beginPath(); g.arc(x, y, 2, 0, PI * 2); g.fill(); }
  g.strokeStyle = 'rgba(60,65,75,0.5)'; g.lineWidth = 3; g.strokeRect(2, 2, S - 4, S - 4);
  return c;
}

function phasedTexture() {
  const S = 256, n = 8, p = S / n;
  const [c, g] = canvas(S);
  g.fillStyle = '#1c2622'; g.fillRect(0, 0, S, S);
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    const x = i * p + p * 0.2, y = j * p + p * 0.2, w = p * 0.6;
    g.fillStyle = '#c9933f'; g.fillRect(x, y, w, w);
    g.fillStyle = '#7a5520'; g.beginPath(); g.arc(x + w * 0.5, y + w * 0.75, 2, 0, PI * 2); g.fill();
  }
  return c;
}

function decalTexture(onReady, src) {
  const [c, g] = canvas(1024, 256);
  const paint = (img) => {
    g.fillStyle = '#eceef1'; g.fillRect(0, 0, 1024, 256);
    g.strokeStyle = '#b9bec6'; g.lineWidth = 6; g.strokeRect(3, 3, 1018, 250);
    if (img) g.drawImage(img, 40, 28, 230, 200);
    g.fillStyle = '#16171a';
    g.font = '700 118px "Helvetica Neue", Helvetica, Arial, sans-serif';
    g.textBaseline = 'middle';
    g.fillText('BOSCON', 300, 132);
  };
  paint(null);
  const img = new Image();
  img.onload = () => { paint(img); onReady(); };
  img.src = src;
  return c;
}

// ---------------------------------------------------------------- materials
export function makeMaterials(renderer, { decalSrc = '/assets/mark-on-light.svg' } = {}) {
  const aniso = renderer.capabilities.getMaxAnisotropy();
  const tex = (cv, srgb = true, rep = true) => {
    const t = new THREE.CanvasTexture(cv);
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = aniso;
    if (rep) t.wrapS = t.wrapT = THREE.RepeatWrapping;
    return t;
  };
  const mli = mliTextures();
  const mliN = tex(mli.normal, false);
  let decalTex;
  decalTex = tex(decalTexture(() => { decalTex.needsUpdate = true; }, decalSrc), true, false);
  const S = (o) => new THREE.MeshStandardMaterial(o);
  const P = (o) => new THREE.MeshPhysicalMaterial(o);
  const mats = {
    mliGold: S({ map: tex(mli.gold), normalMap: mliN, normalScale: new THREE.Vector2(0.9, 0.9), metalness: 0.8, roughness: 0.34 }),
    mliSilver: S({ map: tex(mli.silver), normalMap: mliN, normalScale: new THREE.Vector2(0.9, 0.9), metalness: 0.8, roughness: 0.32 }),
    cells: P({ map: tex(cellTexture()), metalness: 0.3, roughness: 0.4, clearcoat: 1, clearcoatRoughness: 0.05 }),
    carbon: S({ map: tex(carbonTexture()), metalness: 0.25, roughness: 0.6 }),
    alu: S({ color: '#c9ced6', metalness: 1, roughness: 0.3 }),
    black: S({ color: '#17191d', metalness: 0.45, roughness: 0.55 }),
    white: S({ color: '#eceff2', metalness: 0, roughness: 0.55 }),
    osr: S({ map: tex(osrTexture()), metalness: 0.85, roughness: 0.15 }),
    radiator: S({ map: tex(radiatorTexture()), metalness: 0.08, roughness: 0.45 }),
    phased: S({ map: tex(phasedTexture()), metalness: 0.5, roughness: 0.45 }),
    dish: S({ color: '#f1f2f4', metalness: 0.05, roughness: 0.5, side: THREE.DoubleSide }),
    gold: S({ color: '#d8a84e', metalness: 1, roughness: 0.26 }),
    nozzle: S({ color: '#80848b', metalness: 1, roughness: 0.38, side: THREE.DoubleSide }),
    glass: P({ color: '#05121c', metalness: 0, roughness: 0.03, clearcoat: 1, clearcoatRoughness: 0.02, emissive: '#cfe6ff', emissiveIntensity: 0.04 }),
    decal: S({ map: decalTex, metalness: 0, roughness: 0.5 }),
    ledG: new THREE.MeshBasicMaterial({ color: '#e8eef6' }),
    ledB: new THREE.MeshBasicMaterial({ color: '#dfe8f5' }),
    ground: S({ color: '#d9dbde', metalness: 0, roughness: 0.75 }),
  };
  for (const m of Object.values(mats)) if (!(m instanceof THREE.MeshBasicMaterial)) patchEclipse(m);
  return mats;
}

// Earth's shadow: a cylinder of radius 1 (Earth radii) behind the planet along -sun.
// Direct sunlight and most of the reflected sky are removed inside it.
function patchEclipse(mat) {
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uSunDir = sunUniform;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vEclW;')
      .replace('#include <project_vertex>', `#include <project_vertex>
        { vec4 ew = vec4(transformed, 1.0);
          #ifdef USE_INSTANCING
          ew = instanceMatrix * ew;
          #endif
          vEclW = (modelMatrix * ew).xyz; }`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vEclW;\nuniform vec3 uSunDir;')
      .replace('#include <aomap_fragment>', `#include <aomap_fragment>
        { // earthshine: sunlight reflected by Earth (albedo about 0.3) onto faces that look down
          vec3 toEv = normalize((viewMatrix * vec4(-normalize(vEclW), 0.0)).xyz);
          float subLit = smoothstep(-0.15, 0.45, dot(normalize(vEclW), uSunDir));
          float es = max(dot(normal, toEv), 0.0) * (0.03 + 0.22 * subLit);
          reflectedLight.indirectDiffuse += material.diffuseColor * vec3(0.6, 0.75, 1.0) * es;
        }
        { float dd = dot(vEclW, uSunDir);
          float rr = length(vEclW - dd * uSunDir);
          float lit = dd > 0.0 ? 1.0 : smoothstep(0.995, 1.03, rr);
          reflectedLight.directDiffuse *= lit;
          reflectedLight.directSpecular *= lit;
          reflectedLight.indirectSpecular *= mix(0.2, 1.0, lit);
          reflectedLight.indirectDiffuse *= mix(0.35, 1.0, lit);
          #ifdef USE_CLEARCOAT
          clearcoatSpecularDirect *= lit;
          #endif
        }`);
  };
  mat.customProgramCacheKey = () => 'ecl';
}

// ---------------------------------------------------------------- subassemblies
function bus(k, X, Y, Z, side) {
  k.add(box(X, Y, Z), side);
  k.add(box(X + 0.03, Y + 0.03, 0.04), 'white', M(0, 0, Z / 2 + 0.02));
  k.add(box(X + 0.03, Y + 0.03, 0.04), 'alu', M(0, 0, -Z / 2 - 0.02));
  for (const sx of [1, -1]) for (const sy of [1, -1]) k.add(box(0.05, 0.05, Z), 'alu', M(sx * X / 2, sy * Y / 2, 0));
}

function laserTerminal(k, x, y, z, yaw, pitch = 0, flip = false) {
  k.push(M(x, y, z, flip ? PI : 0, 0, yaw));
  k.add(cyl(0.1, 0.11, 0.06, 24), 'black', M(0, 0, 0.03, PI / 2));
  for (const s of [1, -1]) k.add(box(0.03, 0.025, 0.17), 'alu', M(0, s * 0.085, 0.13));
  k.push(M(0, 0, 0.16, 0, -pitch, 0));
  k.add(cyl(0.065, 0.065, 0.26, 24), 'white', M(0, 0, 0, 0, 0, -PI / 2));
  k.add(cyl(0.072, 0.072, 0.03, 24), 'alu', M(0.12, 0, 0, 0, 0, -PI / 2));
  k.add(cyl(0.075, 0.07, 0.09, 24, true), 'black', M(0.175, 0, 0, 0, 0, -PI / 2));
  k.add(new THREE.CircleGeometry(0.058, 24), 'glass', FACE['+X'](V(0.14, 0, 0)));
  k.add(cyl(0.045, 0.05, 0.05, 16), 'black', M(-0.15, 0, 0, 0, 0, -PI / 2));
  k.add(cyl(0.02, 0.02, 0.2, 8), 'alu', M(0, 0, 0));
  k.pop();
  k.pop();
}

function starTracker(k, pos, euler) {
  k.push(M(pos.x, pos.y, pos.z, euler.x, euler.y, euler.z));
  k.add(box(0.11, 0.11, 0.1), 'black', M(0, 0, 0.05));
  k.add(cyl(0.075, 0.045, 0.15, 20, true), 'black', M(0, 0, 0.17, PI / 2));
  k.add(new THREE.CircleGeometry(0.04, 16), 'glass', FACE['+Z'](V(0, 0, 0.101)));
  k.pop();
}

function dish(k, pos, R, faceMatrix) {
  const { geo, depth, f } = dishGeo(R);
  k.push(faceMatrix(pos));
  // local: the dish opens toward +Z
  k.add(geo, 'dish', M(0, 0, 0, PI / 2));
  k.add(new THREE.TorusGeometry(R, R * 0.025, 6, 40), 'alu', M(0, 0, depth));
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * PI * 2 + 0.3;
    rod(k, V(Math.cos(a) * R * 0.95, Math.sin(a) * R * 0.95, depth), V(0, 0, f * 0.95), R * 0.018, 'alu', 6);
  }
  k.add(cyl(R * 0.07, R * 0.12, R * 0.22, 16), 'gold', M(0, 0, f * 0.95, PI / 2));
  k.add(cyl(R * 0.12, R * 0.14, R * 0.12, 16), 'alu', M(0, 0, -R * 0.04, PI / 2));
  k.pop();
}

function solarPanel(k, x, y, L, W, t = 0.035) {
  const cell = 0.13;
  k.add(plane(W, L, W / (8 * cell), L / (8 * cell)), 'cells', FACE['+Z'](V(x, y + L / 2, t / 2)));
  k.add(plane(W, L, W / 1.2, L / 1.2), 'carbon', FACE['-Z'](V(x, y + L / 2, -t / 2)));
  for (const s of [1, -1]) k.add(box(0.035, L, t * 1.3), 'alu', M(x + s * W / 2, y + L / 2, 0));
  for (const yy of [y, y + L]) k.add(box(W + 0.035, 0.035, t * 1.3), 'alu', M(x, yy, 0));
}

// A wing that extends along +Y from y0, cells facing +Z, rotating about the Y axis.
function wing(k, { y0, segs, segLen, width, gap = 0.05, yoke = 0.6, drum = 0.12 }) {
  k.add(cyl(drum, drum, 0.16, 24), 'black', M(0, y0 + 0.08, 0));
  k.add(cyl(drum * 0.55, drum * 0.55, 0.12, 16), 'alu', M(0, y0 + 0.22, 0));
  const hub = V(0, y0 + 0.27, 0);
  rod(k, hub, V(width * 0.4, y0 + yoke, 0), 0.02, 'alu');
  rod(k, hub, V(-width * 0.4, y0 + yoke, 0), 0.02, 'alu');
  rod(k, V(width * 0.4, y0 + yoke, 0), V(-width * 0.4, y0 + yoke, 0), 0.02, 'alu');
  let y = y0 + yoke;
  for (let i = 0; i < segs; i++) {
    solarPanel(k, 0, y, segLen, width);
    if (i < segs - 1) for (const s of [0.3, -0.3]) k.add(cyl(0.022, 0.022, 0.12, 10), 'alu', M(width * s, y + segLen + gap / 2, 0, 0, 0, -PI / 2));
    y += segLen + gap;
  }
  return y;
}

// ---------------------------------------------------------------- spacecraft
// Boscon Mesh relay: store, route and forward. Four optical inter-satellite terminals.
export function buildRelay() {
  const k = new Kit(), w = new Kit();
  const X = 1.6, Y = 1.2, Z = 1.3;
  bus(k, X, Y, Z, 'mliGold');
  for (const s of [1, -1]) k.add(plane(1.3, 1.05), 'osr', FACE[s > 0 ? '+Y' : '-Y'](V(0, s * (Y / 2 + 0.004), -0.05)));
  k.add(plane(1.0, 0.25), 'decal', FACE['+X'](V(X / 2 + 0.004, 0, 0.32)));
  k.add(plane(1.2, 0.5), 'mliSilver', FACE['+X'](V(X / 2 + 0.003, 0, -0.2)));
  for (const s of [1, -1]) k.add(new THREE.SphereGeometry(0.022, 8, 6), 'ledG', M(X / 2 + 0.01, s * 0.55, 0.52));
  for (const sy of [1, -1]) for (const sz of [1, -1]) {
    k.add(nozzleGeo(0.025, 0.07, 0.14), 'nozzle', M(-X / 2 - 0.01, sy * 0.38, sz * 0.38, 0, 0, -PI / 2));
  }
  k.add(cyl(0.22, 0.22, 0.12, 24), 'alu', M(-X / 2 - 0.06, 0, 0, 0, 0, PI / 2));
  const zt = Z / 2 + 0.04;
  laserTerminal(k, 0.55, 0.36, zt, 0);
  laserTerminal(k, -0.55, -0.36, zt, PI);
  laserTerminal(k, 0.55, -0.36, zt, -PI / 2, 0.45);
  laserTerminal(k, -0.55, 0.36, zt, PI / 2, 0.45);
  starTracker(k, V(-0.2, 0.42, zt), V(0.5, 0, 0));
  starTracker(k, V(-0.2, -0.42, zt), V(-0.5, 0, 0));
  k.add(cyl(0.09, 0.09, 0.03, 20), 'white', M(0.1, 0, zt + 0.015, PI / 2));
  // nadir: user-access phased array and a gimballed ground-link dish
  k.add(plane(0.95, 0.75, 4, 3), 'phased', FACE['-Z'](V(-0.25, 0, -Z / 2 - 0.045)));
  k.add(cyl(0.03, 0.03, 0.3, 10), 'alu', M(0.52, 0, -Z / 2 - 0.15, PI / 2));
  dish(k, V(0.52, 0, -Z / 2 - 0.3), 0.3, FACE['-Z']);
  for (const s of [1, -1]) {
    w.push(M(0, 0, 0, 0, 0, s > 0 ? 0 : PI));
    wing(w, { y0: Y / 2, segs: 3, segLen: 1.5, width: 1.15 });
    w.pop();
  }
  return { body: k.bake(), wings: w.bake(), axis: 'y' };
}

// Boscon AI node: an orbital data centre. Three compute modules, edge-on radiators,
// two large arrays rotating about the along-track axis, six optical terminals.
export function buildAINode() {
  const k = new Kit(), w = new Kit();
  const R = 1.05;
  const oct = (r, h, open = false) => flat(cyl(r, r, h, 8, open));
  const mods = [[-1.45, 'white'], [0, 'mliGold'], [1.45, 'white']];
  for (const [z, m] of mods) {
    k.add(oct(R, 1.3), m, M(0, 0, z, PI / 2, PI / 8, 0));
    if (m === 'white') k.add(oct(R + 0.006, 0.85, true), 'osr', M(0, 0, z, PI / 2, PI / 8, 0));
  }
  for (const z of [-0.72, 0.72]) k.add(oct(R + 0.07, 0.12), 'alu', M(0, 0, z, PI / 2, PI / 8, 0));
  for (const z of [-2.15, 2.15]) k.add(oct(R * 0.92, 0.1), 'alu', M(0, 0, z, PI / 2, PI / 8, 0));
  for (const z of [-0.45, 0.45]) k.add(oct(R + 0.012, 0.035, true), 'ledB', M(0, 0, z, PI / 2, PI / 8, 0));
  const ap = R * Math.cos(PI / 8);
  k.add(plane(0.95, 0.24), 'decal', FACE['+Y'](V(0, ap + 0.01, 1.5)));
  k.add(plane(0.95, 0.24), 'decal', FACE['-Y'](V(0, -ap - 0.01, 1.5)));
  // top deck: four terminals and two star trackers
  const zt = 2.22;
  k.add(cyl(0.85, 0.85, 0.06, 32), 'white', M(0, 0, zt - 0.02, PI / 2));
  laserTerminal(k, 0.45, 0, zt, 0, 0.15);
  laserTerminal(k, -0.45, 0, zt, PI, 0.15);
  laserTerminal(k, 0, 0.45, zt, PI / 2, 0.25);
  laserTerminal(k, 0, -0.45, zt, -PI / 2, 0.25);
  starTracker(k, V(0.4, 0.4, zt), V(0.4, -0.4, 0));
  starTracker(k, V(-0.4, -0.4, zt), V(-0.4, 0.4, 0));
  // bottom: two more terminals, phased array and a large ground-link dish
  const zb = -2.2;
  k.add(cyl(0.85, 0.85, 0.06, 32), 'alu', M(0, 0, zb, PI / 2));
  laserTerminal(k, 0.6, 0, zb - 0.03, 0, 0.1, true);
  laserTerminal(k, -0.6, 0, zb - 0.03, PI, 0.1, true);
  k.add(cyl(0.05, 0.05, 0.4, 10), 'alu', M(0, 0, zb - 0.2, PI / 2));
  dish(k, V(0, 0, zb - 0.4), 0.7, FACE['-Z']);
  k.add(plane(0.5, 0.4, 3, 2), 'phased', FACE['-Z'](V(0, 0.56, zb - 0.035)));
  k.add(plane(0.5, 0.4, 3, 2), 'phased', FACE['-Z'](V(0, -0.56, zb - 0.035)));
  // radiators along +-Y, edge-on to the Sun in a dawn-dusk orbit, never facing Earth
  for (const s of [1, -1]) {
    rod(k, V(0, s * ap, 0.6), V(0, s * (ap + 0.55), 0.6), 0.04, 'alu');
    rod(k, V(0, s * ap, -0.6), V(0, s * (ap + 0.55), -0.6), 0.04, 'alu');
    for (let i = 0; i < 2; i++) {
      const y0 = ap + 0.55 + i * 2.45;
      k.add(box(0.05, 2.35, 3.4), 'radiator', M(0, s * (y0 + 1.175), 0));
      k.add(box(0.07, 2.37, 0.05), 'alu', M(0, s * (y0 + 1.175), 1.7));
      k.add(box(0.07, 2.37, 0.05), 'alu', M(0, s * (y0 + 1.175), -1.7));
      k.add(box(0.07, 0.05, 3.4), 'alu', M(0, s * (y0 + 2.35), 0));
    }
  }
  // two big wings along +-X, rotating about X
  for (const s of [1, -1]) {
    w.push(M(0, 0, 0, 0, 0, s > 0 ? -PI / 2 : PI / 2));
    wing(w, { y0: ap, segs: 4, segLen: 2.0, width: 2.6, yoke: 0.75, drum: 0.2 });
    w.pop();
  }
  return { body: k.bake(), wings: w.bake(), axis: 'x' };
}

// Boscon research centre: hosted platform. Two modules, central node, a truss spine,
// four arrays on rotary joints at the truss ends, radiators, docking port.
export function buildResearchCentre() {
  const k = new Kit(), w = new Kit();
  k.add(new THREE.SphereGeometry(1.35, 32, 20), 'white');
  for (const s of [1, -1]) {
    const cx = s * 3.3;
    k.add(cyl(1.5, 1.5, 4.0, 40), 'white', M(cx, 0, 0, 0, 0, PI / 2));
    k.add(cyl(1.52, 1.52, 2.8, 40, true), s > 0 ? 'mliSilver' : 'mliGold', M(cx, 0, 0, 0, 0, PI / 2));
    for (const e of [-2, 2]) k.add(cyl(1.56, 1.56, 0.12, 40), 'alu', M(cx + e, 0, 0, 0, 0, PI / 2));
    const end = new THREE.SphereGeometry(1.5, 32, 12, 0, PI * 2, 0, PI / 2);
    k.add(end, 'white', M(cx + s * 2.0, 0, 0, 0, 0, s > 0 ? -PI / 2 : PI / 2));
    k.add(plane(1.6, 0.4), 'decal', FACE['+Y'](V(cx, 1.53, 0.55)));
    for (const a of [0.9, -0.9]) k.add(plane(2.4, 0.9), 'osr', new THREE.Matrix4().makeRotationX(a).multiply(FACE['+Z'](V(cx, 0, 1.53))));
  }
  // docking port and hatch ring
  k.add(cyl(0.6, 0.6, 0.6, 24), 'alu', M(6.85, 0, 0, 0, 0, PI / 2));
  k.add(new THREE.TorusGeometry(0.62, 0.08, 10, 32), 'alu', M(7.15, 0, 0, 0, PI / 2, 0));
  // truss along Y through the node
  const h = 0.45, L = 8.8, bay = 1.1;
  for (const sx of [1, -1]) for (const sz of [1, -1]) rod(k, V(sx * h, -L, sz * h), V(sx * h, L, sz * h), 0.05, 'alu', 6);
  for (let y = -L; y <= L + 0.01; y += bay) {
    const c = [V(h, y, h), V(-h, y, h), V(-h, y, -h), V(h, y, -h)];
    for (let i = 0; i < 4; i++) rod(k, c[i], c[(i + 1) % 4], 0.03, 'alu', 6);
    if (y + bay <= L + 0.01) {
      const n = [V(h, y + bay, h), V(-h, y + bay, h), V(-h, y + bay, -h), V(h, y + bay, -h)];
      for (let i = 0; i < 4; i++) rod(k, c[i], n[(i + 1) % 4], 0.025, 'alu', 6);
    }
  }
  // radiators: two hang to nadir, two rise to zenith
  for (const s of [1, -1]) {
    for (const [yy, dir] of [[4.4, -1], [6.6, 1]]) {
      k.add(box(0.06, 1.9, 3.6), 'radiator', M(0, s * yy, dir * (h + 1.9)));
      k.add(box(0.08, 1.92, 0.06), 'alu', M(0, s * yy, dir * (h + 3.7)));
    }
  }
  // terminals, trackers, dish
  laserTerminal(k, 3.3, 0, 1.53, 0, 0.3);
  laserTerminal(k, -3.3, 0, 1.53, PI, 0.3);
  laserTerminal(k, 0, 1.2, 0.8, PI / 2, 0.3);
  laserTerminal(k, 0, -1.2, 0.8, -PI / 2, 0.3);
  laserTerminal(k, 0.6, 8.0, h, PI / 2, 0.2);
  laserTerminal(k, -0.6, -8.0, h, -PI / 2, 0.2);
  starTracker(k, V(-2.6, 0.6, 1.4), V(0.4, 0, 0));
  starTracker(k, V(-2.6, -0.6, 1.4), V(-0.4, 0, 0));
  k.add(cyl(0.08, 0.08, 0.6, 10), 'alu', M(0, 0, -1.6, PI / 2));
  dish(k, V(0, 0, -1.9), 1.0, FACE['-Z']);
  // wings: rotary joint at each truss end, two blankets per side, rotating about Y
  for (const s of [1, -1]) {
    w.push(M(0, 0, 0, 0, 0, s > 0 ? 0 : PI));
    w.add(cyl(0.7, 0.7, 0.5, 32), 'alu', M(0, L + 0.3, 0));
    w.add(cyl(0.5, 0.5, 0.2, 24), 'black', M(0, L + 0.65, 0));
    w.add(box(4.2, 0.22, 0.22), 'alu', M(0, L + 0.85, 0));
    for (const bx of [1.55, -1.55]) {
      w.add(box(0.1, 7.6, 0.1), 'alu', M(bx, L + 0.95 + 3.8, -0.06));
      let y = L + 0.98;
      for (let i = 0; i < 5; i++) { solarPanel(w, bx, y, 1.45, 2.4); y += 1.52; }
    }
    w.pop();
  }
  return { body: k.bake(), wings: w.bake(), axis: 'y' };
}

// Generic third-party Earth-observation satellite (any operator).
export function buildThirdPartyEO() {
  const k = new Kit(), w = new Kit();
  const X = 1.0, Y = 1.0, Z = 1.3;
  bus(k, X, Y, Z, 'mliSilver');
  k.add(cyl(0.3, 0.3, 0.75, 32), 'black', M(0.05, 0, -Z / 2 - 0.37, PI / 2));
  k.add(cyl(0.42, 0.31, 0.3, 32, true), 'white', M(0.05, 0, -Z / 2 - 0.88, PI / 2));
  k.add(new THREE.CircleGeometry(0.26, 32), 'glass', FACE['-Z'](V(0.05, 0, -Z / 2 - 0.755)));
  dish(k, V(-0.32, 0.3, -Z / 2 - 0.05), 0.16, FACE['-Z']);
  starTracker(k, V(-0.3, -0.3, Z / 2 + 0.04), V(0.3, 0.3, 0));
  k.add(cyl(0.06, 0.06, 0.03, 16), 'white', M(0.25, 0.2, Z / 2 + 0.05, PI / 2));
  k.add(nozzleGeo(0.02, 0.05, 0.1), 'nozzle', M(-X / 2 - 0.01, 0, 0, 0, 0, -PI / 2));
  wing(w, { y0: Y / 2, segs: 2, segLen: 1.3, width: 1.0 });
  return { body: k.bake(), wings: w.bake(), axis: 'y' };
}

// Generic third-party flat-panel communications satellite.
export function buildThirdPartyFlat() {
  const k = new Kit(), w = new Kit();
  k.add(box(2.4, 1.2, 0.22), 'black');
  k.add(plane(2.36, 1.16, 2, 1), 'mliSilver', FACE['+Z'](V(0, 0, 0.112)));
  for (const x of [-0.6, 0.6]) k.add(plane(1.05, 1.0, 4, 4), 'phased', FACE['-Z'](V(x, 0, -0.112)));
  k.add(box(0.3, 0.2, 0.1), 'alu', M(-1.0, 0.3, 0.16));
  k.add(nozzleGeo(0.02, 0.04, 0.08), 'nozzle', M(-1.21, -0.3, 0, 0, 0, -PI / 2));
  wing(w, { y0: 0.6, segs: 2, segLen: 2.6, width: 1.15, yoke: 0.35, drum: 0.08 });
  return { body: k.bake(), wings: w.bake(), axis: 'y' };
}

// Ground station: pedestal, alt-az yoke and a 9 m class dish. The head aims with lookAt (+Z boresight).
export function buildGroundStation(mats) {
  const base = new Kit(), head = new Kit();
  base.add(cyl(4.5, 5, 0.6, 40), 'ground', M(0, 0.3, 0));
  base.add(cyl(1.2, 1.6, 6, 24), 'ground', M(0, 3.6, 0));
  base.add(cyl(1.7, 1.7, 0.6, 24), 'alu', M(0, 6.7, 0));
  const { geo, depth, f } = dishGeo(4.6, 0.4, 48);
  head.add(geo, 'dish', M(0, 0, -0.6, PI / 2));
  head.add(new THREE.TorusGeometry(4.6, 0.1, 6, 64), 'alu', M(0, 0, depth - 0.6));
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * PI * 2 + PI / 4;
    rod(head, V(Math.cos(a) * 4.3, Math.sin(a) * 4.3, depth - 0.6), V(0, 0, f * 0.95 - 0.6), 0.06, 'alu', 6);
  }
  head.add(cyl(0.3, 0.45, 0.9, 16), 'gold', M(0, 0, f * 0.95 - 0.6, PI / 2));
  head.add(box(0.5, 2.6, 0.5), 'alu', M(1.9, 0, -1.2));
  head.add(box(0.5, 2.6, 0.5), 'alu', M(-1.9, 0, -1.2));
  head.add(box(4.3, 0.6, 0.6), 'alu', M(0, -1.2, -1.4));
  const toGroup = (bk) => {
    const g = new THREE.Group();
    for (const { mat, geo } of bk.parts) g.add(new THREE.Mesh(geo, mats[mat]));
    return g;
  };
  const root = new THREE.Group();
  root.add(toGroup(base.bake()));
  const h = toGroup(head.bake());
  h.position.set(0, 7.6, 0);
  root.add(h);
  return { root, head: h };
}
