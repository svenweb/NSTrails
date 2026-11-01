// GET    /api/item?kind=tracks&id=…   -> full item
// PUT    /api/item?kind=routes&id=…   body: item JSON
// DELETE /api/item?kind=routes&id=…
import { put, get, del } from '@vercel/blob';
import { handle, requireAuth, KINDS, ID_RE, readJson } from './_lib.js';

const opts = { access: 'private', contentType: 'application/json', addRandomSuffix: false, allowOverwrite: true };

export default (req, res) =>
  handle(req, res, async () => {
    requireAuth(req);
    const { kind, id } = req.query;
    if (!KINDS.has(kind) || !ID_RE.test(id || '')) return res.status(400).json({ error: 'Bad kind or id' });
    const path = `${kind}/${id}.json`;
    const metaPath = `tracks-meta/${id}.json`;

    if (req.method === 'GET') {
      const item = await readJson(await get(path, { access: 'private', useCache: false }));
      return item ? res.status(200).json(item) : res.status(404).json({ error: 'Not found' });
    }
    if (req.method === 'PUT') {
      const item = req.body;
      if (!item || typeof item !== 'object' || item.id !== id) return res.status(400).json({ error: 'Body must be the item with matching id' });
      item.updated = item.updated || Date.now();
      await put(path, JSON.stringify(item), opts);
      if (kind === 'tracks') {
        const { points, ...meta } = item;
        meta.pointCount = Array.isArray(points) ? points.length : 0;
        await put(metaPath, JSON.stringify(meta), opts);
      }
      return res.status(200).json({ ok: true, updated: item.updated });
    }
    if (req.method === 'DELETE') {
      await del(kind === 'tracks' ? [path, metaPath] : [path]).catch((e) => {
        if (!/not.?found/i.test(e.message)) throw e;
      });
      return res.status(200).json({ ok: true });
    }
    res.status(405).json({ error: 'Method not allowed' });
  });
