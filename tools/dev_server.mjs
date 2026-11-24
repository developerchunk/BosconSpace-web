// Local server for the site WITH the /hab-testing PIN gate: runs website/middleware.js the way
// Vercel does (before the static files) and copies vercel.json's cleanUrls and trailingSlash: false.
//
//   node website/tools/dev_server.mjs [port]     (PIN and secret from the environment or website/.env.local)
//
// For local testing only; use a throwaway PIN here, never the production one.
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, dirname, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import middleware, { config } from '../middleware.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// Test values from website/.env.local (git-ignored, not deployed) when not set in the environment.
try {
  for (const line of (await readFile(join(ROOT, '.env.local'), 'utf8')).split('\n')) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
} catch {}
const PORT = Number(process.argv[2] || 8083);
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml',
  '.mp4': 'video/mp4', '.pdf': 'application/pdf', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };
const gated = p => config.matcher.some(m => m.endsWith('/:path*') ? p === m.slice(0, -7) || p.startsWith(m.slice(0, -6)) : p === m);

async function file(p) { try { return (await stat(p)).isFile() ? p : null; } catch { return null; } }

async function send(res, r) {
  const headers = {};
  r.headers.forEach((v, k) => { headers[k] = v; });
  res.writeHead(r.status, headers);
  res.end(Buffer.from(await r.arrayBuffer()));
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  let path = decodeURIComponent(url.pathname);
  if (path.length > 1 && path.endsWith('/')) { res.writeHead(308, { Location: path.slice(0, -1) + url.search }); return res.end(); }
  if (path.endsWith('.html')) { res.writeHead(308, { Location: path.slice(0, -5).replace(/\/index$/, '') + url.search }); return res.end(); }
  if (gated(path)) {
    const body = ['GET', 'HEAD'].includes(req.method) ? undefined : await new Promise(ok => {
      const c = []; req.on('data', d => c.push(d)); req.on('end', () => ok(Buffer.concat(c)));
    });
    const r = await middleware(new Request(url, { method: req.method, headers: req.headers, body }));
    if (r) return send(res, r);
  }
  const base = normalize(join(ROOT, path));
  if (!base.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
  const hit = await file(base) || await file(base + '.html') || await file(join(base, 'index.html'));
  if (!hit) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('404'); }
  res.writeHead(200, { 'Content-Type': TYPES[extname(hit)] || 'application/octet-stream' });
  res.end(await readFile(hit));
}).listen(PORT, '127.0.0.1', () => console.log(`site with the PIN gate on http://localhost:${PORT}/hab-testing`));
