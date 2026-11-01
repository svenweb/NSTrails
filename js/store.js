// Tiny IndexedDB key/value store with named "tables".
const DB_NAME = 'nst';
const TABLES = ['routes', 'tracks', 'kv'];
let dbp;

function db() {
  if (!dbp) {
    dbp = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        for (const t of TABLES) if (!req.result.objectStoreNames.contains(t)) req.result.createObjectStore(t);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbp;
}

function tx(table, mode, fn) {
  return db().then(
    (d) =>
      new Promise((resolve, reject) => {
        const t = d.transaction(table, mode);
        const store = t.objectStore(table);
        const r = fn(store);
        t.oncomplete = () => resolve(r && 'result' in r ? r.result : undefined);
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error);
      })
  );
}

export const get = (table, key) => tx(table, 'readonly', (s) => s.get(key));
export const put = (table, key, value) => tx(table, 'readwrite', (s) => s.put(value, key));
export const del = (table, key) => tx(table, 'readwrite', (s) => s.delete(key));
export async function all(table) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const out = [];
    const req = d.transaction(table).objectStore(table).openCursor();
    req.onsuccess = () => {
      const c = req.result;
      if (c) {
        out.push({ key: c.key, value: c.value });
        c.continue();
      } else resolve(out);
    };
    req.onerror = () => reject(req.error);
  });
}

// Synchronous settings in localStorage (guarded).
export function setting(key, fallback) {
  try {
    const v = localStorage.getItem('nst:' + key);
    return v == null ? fallback : JSON.parse(v);
  } catch {
    return fallback;
  }
}
export function saveSetting(key, value) {
  try {
    localStorage.setItem('nst:' + key, JSON.stringify(value));
  } catch {}
}
