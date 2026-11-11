// Mints a 30-second Deepgram token so the browser can open a live transcription
// socket without ever seeing the real key. Off (404) until DEEPGRAM_API_KEY is
// set in the Vercel project, and the site falls back to the browser's recognizer.
const ALLOWED = /(^|\.)adlib\.live$|\.vercel\.app$|^localhost$/;

module.exports = async (req, res) => {
  const key = process.env.DEEPGRAM_API_KEY;
  if (!key) return res.status(404).json({ error: 'not configured' });
  let host = '';
  try { host = new URL(req.headers.origin || req.headers.referer || '').hostname; } catch {}
  if (!ALLOWED.test(host)) return res.status(403).json({ error: 'forbidden' });
  try {
    const r = await fetch('https://api.deepgram.com/v1/auth/grant', {
      method: 'POST',
      headers: { Authorization: `Token ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ttl_seconds: 30 }),
    });
    if (!r.ok) return res.status(502).json({ error: 'token request failed' });
    const { access_token } = await r.json();
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({ token: access_token });
  } catch {
    return res.status(502).json({ error: 'token request failed' });
  }
};
