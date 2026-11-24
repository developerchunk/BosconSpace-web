// Tests for the /hab-testing PIN gate (website/middleware.js). Every test can fail.
//
//   node website/tools/test_gate.mjs           # all must PASS
//   node website/tools/test_gate.mjs --break   # the PIN compare made to accept anything: must FAIL
//
// Uses a throwaway PIN and secret generated here; the real ones live only in Vercel's settings.
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomInt, randomBytes } from 'node:crypto';

const HERE = dirname(fileURLToPath(import.meta.url));
let src = readFileSync(join(HERE, '..', 'middleware.js'), 'utf8');
if (process.argv.includes('--break')) {
  if (!src.includes('return diff === 0;')) throw new Error('break target not found');
  src = src.replace('return diff === 0;', 'return true;');
}
const tmp = mkdtempSync(join(tmpdir(), 'gate-'));
writeFileSync(join(tmp, 'middleware.mjs'), src);
const mw = (await import(pathToFileURL(join(tmp, 'middleware.mjs')).href)).default;

const PIN = String(randomInt(0, 1e6)).padStart(6, '0');
const WRONG = String((Number(PIN) + 1) % 1e6).padStart(6, '0');
const BASE = 'https://boscon.space';
const env = (pin, secret) => { process.env.HAB_TESTING_PIN = pin; process.env.HAB_TESTING_SECRET = secret; };
env(PIN, randomBytes(32).toString('hex'));

const get = (path, cookie, accept = 'text/html') =>
  mw(new Request(BASE + path, { headers: { accept, ...(cookie ? { cookie } : {}) } }));
const post = (pin, next = '/hab-testing/hab-2-probe') =>
  mw(new Request(BASE + '/hab-testing/unlock', { method: 'POST', body: new URLSearchParams({ pin, next }),
    headers: { 'content-type': 'application/x-www-form-urlencoded' } }));
const cookieFrom = r => (r.headers.get('set-cookie') || '').split(';')[0];

let fails = 0;
const check = (ok, msg) => { if (!ok) fails++; console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${msg}`); };

let r = await get('/hab-testing');
check(r?.status === 401 && (await r.text()).includes('name="pin"'), 'no cookie, a page: 401 and the PIN form');
r = await get('/hab-testing/hab-2-probe/probe_data.js', null, '*/*');
check(r?.status === 401, 'no cookie, a data file: 401');
r = await get('/hab-testing/hab-1/data/flight.json', null, 'application/json');
check(r?.status === 401, 'no cookie, the HAB-1 flight data: 401');

const t0 = Date.now();
r = await post(WRONG);
check(r?.status === 401 && !r.headers.get('set-cookie') && Date.now() - t0 >= 1400, `wrong PIN: 401, no cookie, ${Date.now() - t0} ms delay`);

r = await post(PIN);
const sc = r?.headers.get('set-cookie') || '';
check(r?.status === 303 && r.headers.get('location') === '/hab-testing/hab-2-probe', 'right PIN: 303 back to the page asked for');
check(/HttpOnly/.test(sc) && /Secure/.test(sc) && /Path=\/hab-testing/.test(sc) && /Max-Age=43200/.test(sc),
  'cookie is HttpOnly, Secure, limited to /hab-testing, 12 h');
const good = cookieFrom(r);
check((await get('/hab-testing/hab-2-probe', good)) === undefined, 'with the cookie: passed through to the page');
check((await get('/hab-testing/hab-1/data/flight.json', good, '*/*')) === undefined, 'with the cookie: data files pass');

process.env.HAB_MAPBOX_TOKEN = 'pk.test-token';
r = await get('/hab-testing/config.js', null, '*/*');
check(r?.status === 401, 'config.js (Mapbox token) without the cookie: 401');
r = await get('/hab-testing/config.js', good, '*/*');
check(r?.status === 200 && (await r.text()).includes('"pk.test-token"'), 'config.js with the cookie: the token from the environment');
const [name, val] = good.split('=');
const [exp, sig] = val.split('.');
const flip = sig.slice(0, -1) + (sig.at(-1) === 'A' ? 'B' : 'A');
check((await get('/hab-testing', `${name}=${exp}.${flip}`))?.status === 401, 'tampered signature: 401');
check((await get('/hab-testing', `${name}=${Number(exp) - 2 * 43200}.${sig}`))?.status === 401, 'cookie with another expiry: 401');

env(WRONG, process.env.HAB_TESTING_SECRET);
check((await get('/hab-testing', good))?.status === 401, 'PIN changed: old cookies stop working');
env(PIN, randomBytes(32).toString('hex'));
check((await get('/hab-testing', good))?.status === 401, 'secret changed: old cookies stop working');

for (const next of ['//evil.example/x', 'https://evil.example/', '/elsewhere', '/hab-testing/../x', 'javascript:alert(1)']) {
  r = await post(PIN, next);
  check(r?.headers.get('location') === '/hab-testing', `redirect after unlock stays on /hab-testing (next=${next})`);
}

env('12345', 'x'.repeat(40));
check((await get('/hab-testing'))?.status === 503, '5-digit PIN configured: 503, fails closed');
env(PIN, 'short');
check((await get('/hab-testing'))?.status === 503, 'short secret: 503, fails closed');
env('', '');
check((await get('/hab-testing'))?.status === 503, 'nothing configured: 503, fails closed');

process.env.HAB_MAPBOX_TOKEN = 'pk.test-token';
r = await get('/hab-1-flight/config.js', null, '*/*');
check(r?.status === 200 && (await r.text()).includes('"pk.test-token"'), 'public /hab-1-flight/config.js: token without a PIN, even with the gate unconfigured');

console.log(fails ? `${fails} CHECK(S) FAILED` : 'ALL CHECKS PASS');
process.exit(fails ? 1 : 0);
