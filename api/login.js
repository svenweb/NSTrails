// POST /api/login  {password}  ->  {token, expires}
import { handle, checkPassword, issueToken } from './_lib.js';

export default (req, res) =>
  handle(req, res, async () => {
    if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
    const ok = checkPassword(req.body?.password);
    if (!ok) {
      await new Promise((r) => setTimeout(r, 800)); // slow down guessing
      return res.status(401).json({ error: 'Wrong password.' });
    }
    res.status(200).json(issueToken());
  });
