// PIN gate for /hab-testing (Vercel Routing Middleware, https://vercel.com/docs/routing-middleware).
//
// Runs on the server before the CDN cache, so no file under /hab-testing is sent until the PIN has
// been entered: a PIN checked in the browser alone would leave every page downloadable by its URL.
//
// Vercel environment variables (Project Settings > Environment Variables, Production):
//   HAB_TESTING_PIN     exactly 6 digits
//   HAB_TESTING_SECRET  32 or more random characters; signs the unlock cookie
//   HAB_MAPBOX_TOKEN    the HAB-1 pages' Mapbox public token: /hab-testing/config.js after the PIN, and
//                       /hab-1-flight/config.js for the public page, without one. Never a file in git.
// If either is missing or malformed, /hab-testing answers 503 (fails closed).
//
// After a correct PIN the browser gets a signed, HttpOnly cookie for /hab-testing, valid 12 hours.
// Changing the PIN or the secret invalidates every cookie. A wrong PIN waits 1.5 s before answering.
// Tests: node website/tools/test_gate.mjs (and --break). Local run: node website/tools/dev_server.mjs

export const config = { matcher: ['/hab-testing', '/hab-testing/:path*', '/hab-1-flight/config.js'] };

const COOKIE = 'hab_testing';
const MAX_AGE_S = 12 * 60 * 60;
const FAIL_DELAY_MS = 1500;
const NOSTORE = { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' };
const enc = new TextEncoder();

async function sign(secret, msg) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(msg)));
  return btoa(String.fromCharCode(...sig)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// Compares in time that does not depend on where the strings differ.
function same(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function readCookie(request) {
  for (const part of (request.headers.get('cookie') || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === COOKIE) return part.slice(i + 1).trim();
  }
  return null;
}

async function unlocked(request, pin, secret) {
  const c = readCookie(request);
  if (!c) return false;
  const [exp, sig] = c.split('.');
  if (!/^\d{10}$/.test(exp || '') || Number(exp) < Date.now() / 1000) return false;
  return same(sig, await sign(secret, `${exp}.${pin}`));
}

// Only ever send the browser back to a page under /hab-testing on this site.
// ('.' and '..' segments are refused: a browser turns /hab-testing/../x into /x.)
function safeNext(next) {
  return typeof next === 'string' && /^\/hab-testing(\/[A-Za-z0-9._~-]+)*\/?(\?[A-Za-z0-9=&._~%-]*)?$/.test(next)
    && !next.split('?')[0].split('/').some(s => s === '.' || s === '..')
    ? next : '/hab-testing';
}

const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function form(status, next, error) {
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow"><title>Boscon Space: HAB testing</title>
<style>
:root{--bg:#0a0a0b;--fg:#f3f3f1;--dim:rgba(243,243,241,.6);--rule:rgba(243,243,241,.18);--bad:#ff8a7a}
*{box-sizing:border-box}html,body{margin:0;height:100%;background:var(--bg);color:var(--fg);font:16px/1.5 Inter,"Helvetica Neue",Helvetica,Arial,sans-serif}
main{min-height:100%;display:grid;place-items:center;padding:24px 16px}
form{width:100%;max-width:340px}
h1{font-size:22px;font-weight:500;letter-spacing:-.02em;margin:0 0 6px}p{color:var(--dim);margin:0 0 22px;font-size:14px}
input{width:100%;font:600 28px/1 ui-monospace,Menlo,monospace;letter-spacing:.5em;text-align:center;padding:14px 8px 14px 20px;background:transparent;color:var(--fg);border:1px solid var(--rule);border-radius:10px;outline:none}
input:focus{border-color:var(--fg)}
button{margin-top:14px;width:100%;padding:13px;font:500 15px/1 inherit;background:var(--fg);color:var(--bg);border:0;border-radius:10px;cursor:pointer}
.err{color:var(--bad);font-size:14px;margin:12px 0 0;min-height:1.5em}
</style></head><body><main>
<form method="post" action="/hab-testing/unlock" autocomplete="off">
<h1>HAB testing</h1>
<p>Boscon Space internal pages. Enter the 6-digit PIN.</p>
<input name="pin" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" required autofocus aria-label="6-digit PIN">
<input type="hidden" name="next" value="${esc(next)}">
<button type="submit">Open</button>
<p class="err" role="alert">${esc(error)}</p>
</form></main></body></html>`;
  return new Response(html, { status, headers: { ...NOSTORE, 'Content-Type': 'text/html; charset=utf-8' } });
}

const plain = (status, text) => new Response(text, { status, headers: { ...NOSTORE, 'Content-Type': 'text/plain; charset=utf-8' } });

const tokenJs = cache => new Response(`window.HAB_MAPBOX_TOKEN = ${JSON.stringify(process.env.HAB_MAPBOX_TOKEN || '')};\n`,
  { status: 200, headers: { 'Cache-Control': cache, 'Content-Type': 'text/javascript; charset=utf-8' } });

export default async function middleware(request) {
  // The public HAB-1 page's map token: public by design, no PIN; kept out of git all the same.
  if (new URL(request.url).pathname === '/hab-1-flight/config.js') return tokenJs('public, max-age=300');

  const pin = process.env.HAB_TESTING_PIN || '';
  const secret = process.env.HAB_TESTING_SECRET || '';
  if (!/^\d{6}$/.test(pin) || secret.length < 32) return plain(503, 'hab-testing is not configured');

  const url = new URL(request.url);
  if (url.pathname === '/hab-testing/unlock') {
    if (request.method !== 'POST') return form(401, '/hab-testing', '');
    let data;
    try { data = await request.formData(); } catch { data = new FormData(); }
    const next = safeNext(data.get('next'));
    if (same(String(data.get('pin') || ''), pin)) {
      const exp = Math.floor(Date.now() / 1000) + MAX_AGE_S;
      const cookie = `${COOKIE}=${exp}.${await sign(secret, `${exp}.${pin}`)}; Path=/hab-testing; Max-Age=${MAX_AGE_S}; HttpOnly; Secure; SameSite=Lax`;
      return new Response(null, { status: 303, headers: { ...NOSTORE, Location: next, 'Set-Cookie': cookie } });
    }
    await new Promise(r => setTimeout(r, FAIL_DELAY_MS));
    return form(401, next, 'Wrong PIN.');
  }
  if (url.pathname === '/hab-testing/lock') {
    return new Response(null, { status: 303, headers: { ...NOSTORE, Location: '/hab-testing',
      'Set-Cookie': `${COOKIE}=; Path=/hab-testing; Max-Age=0; HttpOnly; Secure; SameSite=Lax` } });
  }

  if (await unlocked(request, pin, secret)) {
    // The HAB-1 page's Mapbox token: from the Vercel variable HAB_MAPBOX_TOKEN, never a file in git.
    if (url.pathname === '/hab-testing/config.js') {
      return tokenJs('no-store');
    }
    return;                                              // nothing returned: on to the static file
  }

  if (request.method === 'GET' && (request.headers.get('accept') || '').includes('text/html')) {
    return form(401, url.pathname + url.search, '');
  }
  return plain(401, 'Locked');
}
