// GET /api/items?kind=routes  -> {items:[full route objects]}
// GET /api/items?kind=tracks  -> {items:[track summaries (no points)]}
import { list, get } from '@vercel/blob';
import { handle, requireAuth, KINDS, readJson } from './_lib.js';

export default (req, res) =>
  handle(req, res, async () => {
    if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });
    requireAuth(req);
    const kind = req.query.kind;
    if (!KINDS.has(kind)) return res.status(400).json({ error: 'Unknown kind' });
    const prefix = kind === 'tracks' ? 'tracks-meta/' : 'routes/';
    const blobs = [];
    let cursor;
    do {
      const page = await list({ prefix, cursor, limit: 1000 });
      blobs.push(...page.blobs);
      cursor = page.hasMore ? page.cursor : undefined;
    } while (cursor);
    const items = (
      await Promise.all(blobs.map((b) => get(b.pathname, { access: 'private', useCache: false }).then(readJson).catch(() => null)))
    ).filter(Boolean);
    res.status(200).json({ items });
  });
