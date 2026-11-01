// Route sync via a JSON file in the app's own GitHub repo.
// Reading needs no auth (public repo); writing needs a fine-grained token
// with Contents: read & write on that repo, stored only on this device.
import { setting, saveSetting } from './store.js';

// Derive owner/repo from the GitHub Pages URL (owner.github.io/repo/), with a default.
function repoFromLocation() {
  const m = location.hostname.match(/^([\w-]+)\.github\.io$/i);
  const repo = location.pathname.split('/').filter(Boolean)[0];
  if (m && repo) return { owner: m[1], repo };
  return { owner: 'svenweb', repo: 'NSTrails' };
}
export const REPO = repoFromLocation();
const PATH = 'data/routes.json';
const BRANCH = 'main';
const API = `https://api.github.com/repos/${REPO.owner}/${REPO.repo}/contents/${PATH}`;

export const getToken = () => setting('ghToken', '');
export const setToken = (t) => saveSetting('ghToken', t || '');

const b64encode = (s) => {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
};
const b64decode = (s) => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/\s/g, '')), (c) => c.charCodeAt(0)));

function headers() {
  const h = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
  const t = getToken();
  if (t) h.Authorization = `Bearer ${t}`;
  return h;
}

// Returns {routes: [...], sha} from GitHub. Falls back to the copy served by
// GitHub Pages (which the service worker also keeps for offline use).
export async function pull() {
  try {
    const res = await fetch(`${API}?ref=${BRANCH}&t=${Date.now()}`, { headers: headers(), cache: 'no-store' });
    if (res.status === 404) return { routes: [], sha: null, source: 'github' };
    if (!res.ok) throw new Error(`GitHub ${res.status}`);
    const j = await res.json();
    const data = JSON.parse(b64decode(j.content));
    return { routes: data.routes || [], sha: j.sha, source: 'github' };
  } catch (e) {
    const res = await fetch('./data/routes.json', { cache: 'no-cache' }).catch(() => null);
    if (res?.ok) return { routes: (await res.json()).routes || [], sha: null, source: 'pages' };
    throw e;
  }
}

// Apply `mutate(routes) => routes` to the remote file, retrying on conflicts.
export async function update(mutate, message) {
  if (!getToken()) throw new Error('Not connected');
  for (let attempt = 0; attempt < 4; attempt++) {
    const res0 = await fetch(`${API}?ref=${BRANCH}&t=${Date.now()}`, { headers: headers(), cache: 'no-store' });
    let routes = [], sha;
    if (res0.ok) {
      const j = await res0.json();
      sha = j.sha;
      routes = JSON.parse(b64decode(j.content)).routes || [];
    } else if (res0.status !== 404) throw new Error(res0.status === 401 ? 'Token rejected — reconnect sync' : `GitHub ${res0.status}`);
    const next = mutate(routes);
    const body = JSON.stringify({
      message,
      branch: BRANCH,
      content: b64encode(JSON.stringify({ routes: next }, null, 1) + '\n'),
      ...(sha ? { sha } : {}),
    });
    const res = await fetch(API, { method: 'PUT', headers: { ...headers(), 'Content-Type': 'application/json' }, body });
    if (res.ok) return next;
    if (res.status === 409 || res.status === 422) continue; // someone else wrote first: retry
    if (res.status === 401 || res.status === 403) throw new Error('Token rejected — check it has Contents: Read and write on this repo');
    throw new Error(`GitHub ${res.status}`);
  }
  throw new Error('Sync conflict — try again');
}

export async function checkToken(token) {
  const res = await fetch(`https://api.github.com/repos/${REPO.owner}/${REPO.repo}`, {
    headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return { ok: false, msg: res.status === 401 ? 'That token was rejected.' : `GitHub said ${res.status}.` };
  const j = await res.json();
  if (!j.permissions?.push) return { ok: false, msg: 'Token works but cannot write to the repo — give it Contents: Read and write.' };
  return { ok: true };
}
