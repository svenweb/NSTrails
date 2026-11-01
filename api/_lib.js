// Shared helpers for the save API. Files starting with "_" are not deployed as endpoints.
import { createHmac, timingSafeEqual } from 'node:crypto';

const ALLOWED_ORIGINS = [/^https:\/\/svenweb\.github\.io$/, /^http:\/\/localhost(:\d+)?$/, /^http:\/\/127\.0\.0\.1(:\d+)?$/];
export const KINDS = new Set(['routes', 'tracks']);
export const ID_RE = /^[a-z0-9_-]{1,64}$/i;
const TOKEN_DAYS = 365;

export function cors(req, res) {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.some((re) => re.test(origin))) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'GET, PUT, POST, DELETE, OPTIONS');
    res.setHeader('Access-Control-Max-Age', '86400');
  }
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return true;
  }
  return false;
}

function password() {
  const p = process.env.APP_PASSWORD;
  if (!p || p === 'CHANGE_ME') throw Object.assign(new Error('Server password not set (APP_PASSWORD).'), { status: 503 });
  return p;
}

// Tokens are signed with the password itself, so changing APP_PASSWORD logs everyone out.
const sign = (msg) => createHmac('sha256', `nst:${password()}`).update(msg).digest('base64url');

export function checkPassword(given) {
  const a = Buffer.from(String(given ?? ''));
  const b = Buffer.from(password());
  return a.length === b.length && timingSafeEqual(a, b);
}

export function issueToken() {
  const exp = Date.now() + TOKEN_DAYS * 86400000;
  return { token: `${exp}.${sign(`v1.${exp}`)}`, expires: exp };
}

export function requireAuth(req) {
  const m = /^Bearer (\d+)\.([\w-]+)$/.exec(req.headers.authorization || '');
  if (m && +m[1] > Date.now()) {
    const want = Buffer.from(sign(`v1.${m[1]}`));
    const got = Buffer.from(m[2]);
    if (want.length === got.length && timingSafeEqual(want, got)) return;
  }
  throw Object.assign(new Error('Please log in again.'), { status: 401 });
}

export async function handle(req, res, fn) {
  if (cors(req, res)) return;
  try {
    await fn();
  } catch (e) {
    const status = e.status || 500;
    if (status === 500) console.error(e);
    res.status(status).json({ error: e.message || 'Server error' });
  }
}

export async function readJson(result) {
  if (!result || result.statusCode !== 200) return null;
  return JSON.parse(await new Response(result.stream).text());
}
