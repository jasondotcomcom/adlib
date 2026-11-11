// Keeps the 2.4 second voice clip behind a shared beat, so the link can play it.
//   POST /api/voice        body: the clip as a WAV  ->  { id }
//   GET  /api/voice?id=…   ->  the WAV
// Only accepts exactly what the site records: 16-bit mono 32 kHz, at most 2.6 seconds.
// A clip nobody has opened for 30 days is deleted by api/sweep.js.
// Needs a Vercel Blob store connected to the project (BLOB_READ_WRITE_TOKEN).
const { put, head } = require('@vercel/blob');
const crypto = require('node:crypto');

const RATE = 32000, MAX_BYTES = 44 + RATE * 2 * 2.6;
const path = id => `voices/${id}.wav`;
const seen = id => `seen/${id}`;            // a tiny marker, rewritten each time the clip is opened (see sweep.js)

function readBody(req) {
  if (Buffer.isBuffer(req.body)) return Promise.resolve(req.body);
  return new Promise((resolve, reject) => {
    const chunks = []; let n = 0;
    req.on('data', c => { n += c.length; if (n > MAX_BYTES + 1024) { reject(new Error('too big')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks))); req.on('error', reject);
  });
}
function isOurWav(b) {
  if (b.length < 44 + RATE * 0.2 || b.length > MAX_BYTES) return false;
  if (b.toString('ascii', 0, 4) !== 'RIFF' || b.toString('ascii', 8, 12) !== 'WAVE' || b.toString('ascii', 12, 16) !== 'fmt ' || b.toString('ascii', 36, 40) !== 'data') return false;
  return b.readUInt16LE(20) === 1 && b.readUInt16LE(22) === 1 && b.readUInt32LE(24) === RATE && b.readUInt16LE(34) === 16;
}

module.exports = async (req, res) => {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return res.status(501).json({ error: 'voice sharing is not set up' });
  try {
    if (req.method === 'GET') {
      const id = String((req.query && req.query.id) || '');
      if (!/^[a-z0-9]{8,20}$/.test(id)) return res.status(400).json({ error: 'bad id' });
      let meta; try { meta = await head(path(id)); } catch { return res.status(404).json({ error: 'not found' }); }
      const r = await fetch(meta.url); if (!r.ok) return res.status(404).json({ error: 'not found' });
      // note that it was opened, so the monthly sweep knows this one is still wanted
      try { await put(seen(id), String(Date.now()), { access: 'public', contentType: 'text/plain', addRandomSuffix: false, allowOverwrite: true }); } catch {}
      // cached for a day in that browser, so someone who keeps coming back keeps it alive
      res.setHeader('Content-Type', 'audio/wav'); res.setHeader('Cache-Control', 'private, max-age=86400');
      return res.status(200).send(Buffer.from(await r.arrayBuffer()));
    }
    if (req.method === 'POST') {
      // only the site itself may save a clip
      let from = ''; try { from = new URL(req.headers.origin || req.headers.referer || '').host; } catch {}
      if (!from || from !== req.headers.host) return res.status(403).json({ error: 'forbidden' });
      const body = await readBody(req);
      if (!isOurWav(body)) return res.status(400).json({ error: 'not a clip from this site' });
      const id = crypto.randomBytes(9).toString('hex').slice(0, 12);
      await put(path(id), body, { access: 'public', contentType: 'audio/wav', addRandomSuffix: false, cacheControlMaxAge: 31536000 });
      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).json({ id });
    }
    return res.status(405).json({ error: 'method not allowed' });
  } catch (err) {
    return res.status(500).json({ error: 'something went wrong' });
  }
};
// the body arrives as raw audio, not JSON
module.exports.config = { api: { bodyParser: false } };
