// Client for the password-protected save API (Vercel functions + private Blob storage).
// Logging in exchanges the shared password for a signed token kept on this device.
import { setting, saveSetting } from './store.js';

// Same origin when served from Vercel; otherwise (GitHub Pages, localhost) call the Vercel API.
export const API_ORIGIN = location.hostname.endsWith('.vercel.app') ? '' : 'https://nstrails.vercel.app';
const API = `${API_ORIGIN}/api`;

export const isLoggedIn = () => {
  const s = setting('session', null);
  return !!(s && s.expires > Date.now());
};
const token = () => setting('session', null)?.token;
export const logout = () => saveSetting('session', null);

async function call(path, { method = 'GET', body } = {}) {
  const res = await fetch(`${API}/${path}`, {
    method,
    headers: { ...(token() ? { Authorization: `Bearer ${token()}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    cache: 'no-store',
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && path !== 'login') {
    logout();
    window.dispatchEvent(new CustomEvent('nst:logged-out'));
  }
  if (!res.ok) throw Object.assign(new Error(data.error || `Server error ${res.status}`), { status: res.status });
  return data;
}

export async function login(password) {
  const s = await call('login', { method: 'POST', body: { password } });
  saveSetting('session', s);
}

const q = (kind, id) => `item?kind=${kind}&id=${encodeURIComponent(id)}`;
export const listItems = (kind) => call(`items?kind=${kind}`).then((r) => r.items || []);
export const getItem = (kind, id) => call(q(kind, id));
export const putItem = (kind, item) => call(q(kind, item.id), { method: 'PUT', body: item });
export const deleteItem = (kind, id) => call(q(kind, id), { method: 'DELETE' });
