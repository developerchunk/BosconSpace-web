// NASA GIBS imagery, EPSG:4326 tile grid.
// Level z tile spans 288 / 2^z degrees, origin at (-180 lon, +90 lat), 512 px tiles.
// Level 7 is the finest for these layers: 2.25 deg per tile, about 0.49 km per pixel at the equator.
// Imagery is public domain (NASA). The server sends Access-Control-Allow-Origin: *.
import * as THREE from 'three';

const GIBS = 'https://gibs.earthdata.nasa.gov/wmts/epsg4326/best';

export const LAYERS = {
  day: { path: 'BlueMarble_NextGeneration/default/2004-08-01/500m', ext: 'jpeg', maxZ: 7 },
  night: { path: 'VIIRS_CityLights_2012/default/2012-01-01/500m', ext: 'jpg', maxZ: 7 },
};

export const tileDeg = (z) => 288 / (1 << z);
export function gridSize(z) {
  const d = tileDeg(z);
  return { cols: Math.ceil(360 / d), rows: Math.ceil(180 / d) };
}

// ---- fetch queue with priority and an LRU of compressed blobs (about 40 kB each) ----
const MAX_ACTIVE = 6;
const MAX_CACHE = 500;
const cache = new Map();
const queue = [];
let active = 0;

function pump() {
  while (active < MAX_ACTIVE && queue.length) {
    const job = queue.shift();
    if (job.stale && job.stale()) { job.resolve(null); continue; }
    active++;
    fetch(job.url, { mode: 'cors' })
      .then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.blob(); })
      .then(job.resolve, job.reject)
      .finally(() => { active--; pump(); });
  }
}

export function getTile(layer, z, y, x, { high = false, stale = null } = {}) {
  const key = `${layer.path}/${z}/${y}/${x}`;
  const hit = cache.get(key);
  if (hit) { cache.delete(key); cache.set(key, hit); return hit; }
  const url = `${GIBS}/${layer.path}/${z}/${y}/${x}.${layer.ext}`;
  const p = new Promise((resolve, reject) => {
    const job = { url, resolve, reject, stale };
    if (high) queue.unshift(job); else queue.push(job);
    pump();
  });
  cache.set(key, p);
  p.then((b) => { if (!b) cache.delete(key); }, () => cache.delete(key));
  if (cache.size > MAX_CACHE) cache.delete(cache.keys().next().value);
  return p;
}

// Paint a whole layer at level z into an equirectangular canvas (360 x 180 degrees).
export async function paintGlobal(layer, z, canvas, onTile) {
  const d = tileDeg(z);
  const { cols, rows } = gridSize(z);
  const ctx = canvas.getContext('2d');
  const ts = d * (canvas.width / 360);
  let ok = 0;
  const jobs = [];
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      jobs.push(
        getTile(layer, z, y, x)
          .then((b) => b && createImageBitmap(b))
          .then((bm) => {
            if (!bm) return;
            ctx.drawImage(bm, x * ts, y * ts, ts, ts);
            bm.close();
            ok++;
            onTile && onTile(ok, rows * cols);
          })
          .catch(() => {})
      );
    }
  }
  await Promise.all(jobs);
  return ok;
}

// A movable high-resolution window of imagery (N x N tiles) around the point the camera looks at.
// Two slots ping-pong: the visible one stays up while the next one fills.
export class DetailWindow {
  constructor(layer, baseCanvas, renderer, N = 6) {
    this.layer = layer;
    this.base = baseCanvas;
    this.N = N;
    this.gen = 0;
    this.key = '';
    this.front = null;
    this.onSwap = null;
    const aniso = renderer.capabilities.getMaxAnisotropy();
    this.slots = [0, 1].map(() => {
      const c = document.createElement('canvas');
      c.width = c.height = N * 512;
      const tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = aniso;
      tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
      return { canvas: c, tex, rect: null };
    });
  }

  clear() { this.key = ''; this.gen++; this.front = null; }

  request(z, latC, lonC) {
    const N = this.N;
    const d = tileDeg(z);
    const { cols, rows } = gridSize(z);
    let col0 = Math.floor((lonC + 180) / d) - Math.floor(N / 2);
    let row0 = Math.floor((90 - latC) / d) - Math.floor(N / 2);
    row0 = Math.max(0, Math.min(rows - N, row0));
    col0 = ((col0 % cols) + cols) % cols;
    const key = `${z}/${row0}/${col0}`;
    if (key === this.key) return;
    this.key = key;
    const gen = ++this.gen;
    const slot = this.slots.find((s) => s !== this.front);
    const ctx = slot.canvas.getContext('2d');
    const span = N * d;
    const lonMin = -180 + col0 * d;
    const latMax = 90 - row0 * d;
    const S = slot.canvas.width;

    // Underlay: upsample the global canvas so tiles that fail still show imagery.
    const W = this.base.width, H = this.base.height;
    const sx = ((lonMin + 180) / 360) * W;
    const sw = (span / 360) * W;
    const sy = ((90 - latMax) / 180) * H;
    const sh = (span / 180) * H;
    ctx.imageSmoothingQuality = 'high';
    if (sx + sw <= W) {
      ctx.drawImage(this.base, sx, sy, sw, sh, 0, 0, S, S);
    } else {
      const w1 = W - sx;
      ctx.drawImage(this.base, sx, sy, w1, sh, 0, 0, (w1 / sw) * S, S);
      ctx.drawImage(this.base, 0, sy, sw - w1, sh, (w1 / sw) * S, 0, ((sw - w1) / sw) * S, S);
    }

    const stale = () => gen !== this.gen;
    let pending = N * N;
    const done = () => {
      if (--pending > 0 || stale()) return;
      slot.rect = new THREE.Vector4(lonMin, latMax - span, span, span);
      slot.tex.needsUpdate = true;
      this.front = slot;
      this.onSwap && this.onSwap(slot, z);
    };
    // Load from the centre outwards.
    const order = [];
    for (let ty = 0; ty < N; ty++) for (let tx = 0; tx < N; tx++) order.push([ty, tx]);
    const c = (N - 1) / 2;
    order.sort((a, b) => Math.hypot(a[0] - c, a[1] - c) - Math.hypot(b[0] - c, b[1] - c));
    for (const [ty, tx] of order) {
      getTile(this.layer, z, row0 + ty, (col0 + tx) % cols, { high: true, stale })
        .then((b) => (b && !stale() ? createImageBitmap(b) : null))
        .then((bm) => {
          if (!bm) return;
          if (!stale()) ctx.drawImage(bm, tx * 512, ty * 512, 512, 512);
          bm.close();
        })
        .catch(() => {})
        .finally(done);
    }
  }
}
