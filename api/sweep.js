// Runs once a day (see "crons" in vercel.json). Deletes any shared voice clip that
// nobody has opened for 30 days. "Opened" means the clip was fetched through
// /api/voice, which rewrites a small marker at seen/<id> each time.
// A link whose clip is gone still works: the beat plays on the regular kit.
const { list, del } = require('@vercel/blob');

const KEEP_DAYS = 30;

async function all(prefix) {
  const out = []; let cursor;
  do { const page = await list({ prefix, cursor, limit: 1000 }); out.push(...page.blobs); cursor = page.hasMore ? page.cursor : undefined; } while (cursor);
  return out;
}

module.exports = async (req, res) => {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return res.status(501).json({ error: 'voice sharing is not set up' });
  // if a CRON_SECRET is set on the project, only Vercel's scheduler may run this
  if (process.env.CRON_SECRET && req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) return res.status(401).json({ error: 'unauthorized' });
  try {
    const clips = await all('voices/'), marks = await all('seen/');
    const opened = new Map(marks.map(m => [m.pathname.slice(5), m]));
    const cutoff = Date.now() - KEEP_DAYS * 86400000, gone = [];
    for (const c of clips) {
      const id = c.pathname.slice(7, -4), mark = opened.get(id);
      const last = Math.max(new Date(c.uploadedAt).getTime(), mark ? new Date(mark.uploadedAt).getTime() : 0);
      if (last < cutoff) { gone.push(c.url); if (mark) gone.push(mark.url); }
      opened.delete(id);
    }
    for (const m of opened.values()) gone.push(m.url);            // a marker with no clip left behind it
    for (let i = 0; i < gone.length; i += 100) await del(gone.slice(i, i + 100));
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({ clips: clips.length, deleted: gone.length });
  } catch (err) {
    return res.status(500).json({ error: 'sweep failed' });
  }
};
