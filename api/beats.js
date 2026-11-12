// The "beats made so far" number in the footer.
//   GET  /api/beats   ->  { n }
//   POST /api/beats   ->  counts one beat. The site sends this once a beat has played
//                         for ten seconds without being changed.
// Nothing about the person or the beat is kept, only that one more was made.
// See api/_count.js for how the number is stored.
const { put, list } = require('@vercel/blob');
const crypto = require('node:crypto');
const { root, dayOf, tally } = require('./_count.js');

async function names(prefix) {
  const out = []; let cursor;
  do { const page = await list({ prefix, cursor, limit: 1000 }); for (const b of page.blobs) out.push(b.pathname); cursor = page.hasMore ? page.cursor : undefined; } while (cursor);
  return out;
}

// a light brake on one visitor adding too fast (per running copy of this function)
const recent = new Map();
function tooFast(ip) {
  const now = Date.now(), hits = (recent.get(ip) || []).filter(t => now - t < 60000);
  hits.push(now); recent.set(ip, hits);
  if (recent.size > 5000) recent.clear();
  return hits.length > 12;
}

module.exports = async (req, res) => {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return res.status(501).json({ error: 'the counter is not set up' });
  try {
    const r = root();
    if (req.method === 'GET') {
      const { n } = tally(await names(r), r);
      res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=60, stale-while-revalidate=600');
      return res.status(200).json({ n });
    }
    if (req.method === 'POST') {
      // only the site itself may count a beat
      let from = ''; try { from = new URL(req.headers.origin || req.headers.referer || '').host; } catch {}
      if (!from || from !== req.headers.host) return res.status(403).json({ error: 'forbidden' });
      const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
      if (tooFast(ip)) return res.status(429).json({ error: 'slow down' });
      await put(`${r}d/${dayOf()}/${crypto.randomBytes(8).toString('hex')}`, '1', { access: 'public', contentType: 'text/plain', addRandomSuffix: false });
      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).json({ ok: true });
    }
    return res.status(405).json({ error: 'method not allowed' });
  } catch (err) {
    return res.status(500).json({ error: 'something went wrong' });
  }
};
