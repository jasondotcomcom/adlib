// voicekit.js — say one word and the beat is made out of it.
// One short recording is cut into a drum kit: the sharp consonants become the
// hats and snare, the hardest hit is pitched down into the kick, and the vowel
// is stretched across notes for the bass and the melody. Nothing leaves the browser.
import { getCtx, nodes as N, mtof , tuneRatio } from './engine.js';
import { song } from './song.js';

// Things to say. Each has a hard hit (b p d g k t), something sharp (s sh ch t k z j f)
// and an open vowel, so every part of the kit has something to be made from.
// A lot of them are record titles. The rest are just fun in the mouth.
export const SAY = [
  'boots and cats', 'mic check', "don't believe the hype", 'bring the noise', 'fight the power', 'can i kick it',
  'protect ya neck', 'peter piper', 'bust a move', 'push it', 'pass the mic', 'stakes is high',
  'paid in full', 'ante up', 'shook ones', 'tootsie roll', 'kick push', 'the choice is yours', 'pump it up',
  "drop it like it's hot", 'get ur freak on', 'whoomp there it is', 'it takes two', 'the breaks', "rapper's delight",
  'planet rock', 'sucker mcs', 'top billin', 'party up', 'hypnotize', 'bucktown', 'sixteen bars', 'two turntables',
  'boom box', 'cassette tape', 'beat tape', 'back spin', 'kick drum', 'block party', 'double dutch', 'fat laces',
  'bucket hat', 'gold teeth', 'tube socks', 'scratch that', 'pickle juice', 'spaghetti', 'chicken biscuit', 'taco truck',
  'peanut butter', 'pizza party', 'bubble tea', 'chopped cheese', 'hot sauce packet', 'kitchen sink', 'pocket change',
  'skateboard', 'tic tac toe', 'bodega cat', 'ticket booth', 'cheesesteak', 'tater tots', 'ketchup packet',
  'chicken pot pie', 'popsicle stick', 'sticky toffee pudding', 'biscuits and gravy', 'box of chocolates',
];
let lastSay = -1;
export function rollSay() { let i; do { i = Math.floor(Math.random() * SAY.length); } while (i === lastSay); lastSay = i; return SAY[i]; }

export const voice = { ready: false, f0: 140, pitched: false, parts: null, bufs: {}, pcm: null, id: null, half: 0.5, shift: 0 };

// ------------------------------------------------------------------ one format for a take, so a shared link rebuilds the same kit
// Every take is turned into 16-bit mono at 32 kHz before anything is cut from it.
// That is what gets saved when you share, and the kit is built from that same data on both ends.
export const TAKE_RATE = 32000;
export function packTake(data, sr) {
  const n = Math.floor((data.length - 1) * TAKE_RATE / sr); if (n < TAKE_RATE * 0.2) return null;
  const i16 = new Int16Array(n), step = sr / TAKE_RATE;
  for (let i = 0; i < n; i++) { const x = i * step, a = Math.floor(x), v = data[a] + (data[a + 1] - data[a]) * (x - a); i16[i] = Math.max(-32768, Math.min(32767, Math.round(v * 32767))); }
  return i16;
}
export function unpack(i16) { const f = new Float32Array(i16.length); for (let i = 0; i < f.length; i++) f[i] = i16[i] / 32767; return f; }
export function toWav(i16) {
  const b = new ArrayBuffer(44 + i16.length * 2), v = new DataView(b), str = (o, t) => { for (let i = 0; i < t.length; i++) v.setUint8(o + i, t.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + i16.length * 2, true); str(8, 'WAVE'); str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, TAKE_RATE, true); v.setUint32(28, TAKE_RATE * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); str(36, 'data'); v.setUint32(40, i16.length * 2, true);
  new Int16Array(b, 44).set(i16);
  return b;
}
export function fromWav(buf) {
  const v = new DataView(buf); if (buf.byteLength < 46 || v.getUint32(24, true) !== TAKE_RATE || v.getUint16(34, true) !== 16) return null;
  return new Int16Array(buf.slice(44, 44 + ((buf.byteLength - 44) & ~1)));
}

// ------------------------------------------------------------------ cutting it up (no audio API in here, so it runs in tests)
export function analyze(data, sr) {
  const hop = 256, win = 512, n = Math.floor((data.length - win) / hop);
  if (n < 12) return null;
  const rms = new Float32Array(n), zcr = new Float32Array(n);
  let peak = 0;
  for (let i = 0; i < n; i++) {
    let s = 0, z = 0, prev = data[i * hop];
    for (let j = 0; j < win; j++) { const v = data[i * hop + j]; s += v * v; if ((v >= 0) !== (prev >= 0)) z++; prev = v; }
    rms[i] = Math.sqrt(s / win); zcr[i] = z / win; if (rms[i] > peak) peak = rms[i];
  }
  if (peak < 0.012) return null;                                     // nobody said anything
  const floor = Math.max(0.008, peak * 0.12), fr = sec => Math.max(1, Math.round(sec * sr / hop));
  const act = i => rms[i] > floor;
  let first = 0, last = n - 1; while (first < n && !act(first)) first++; while (last > first && !act(last)) last--;
  const at = (frame, pre) => Math.max(0, frame * hop - Math.round(pre * sr));
  const cut = (start, sec) => [start, Math.min(data.length, start + Math.round(sec * sr))];

  // sharp: lots of zero crossings and some level (s, sh, ch, t, k)
  const noisy = i => (act(i) ? zcr[i] * rms[i] : 0);
  let iH = first; for (let i = first; i <= last; i++) if (noisy(i) > noisy(iH)) iH = i;
  let iS = -1; for (let i = first; i <= last; i++) if (Math.abs(i - iH) >= fr(0.1) && (iS < 0 || noisy(i) > noisy(iS))) iS = i;
  const ownSnare = iS >= 0 && noisy(iS) > noisy(iH) * 0.35;
  // while the level is still climbing, step back to where the burst began
  const back = i => { while (i > first && rms[i - 1] > floor && rms[i - 1] < rms[i]) i--; return i; };

  // hard hit: the biggest jump in level that lands on something round, not hissy
  let iK = first, best = 0;
  for (let i = Math.max(first, 2); i <= last; i++) {
    const jump = rms[i] - rms[i - 2]; if (jump <= 0) continue;
    let z = 0, c = 0; for (let k = i; k < Math.min(n, i + 4); k++) { z += zcr[k]; c++; }
    const score = jump * (z / c < 0.15 ? 1 : 0.3);
    if (score > best) { best = score; iK = i; }
  }
  iK = back(iK);

  // vowel: the longest steady stretch that is loud and not hissy
  const tonal = i => (act(i) && zcr[i] < 0.12 ? rms[i] : 0);
  let vmax = 0; for (let i = first; i <= last; i++) vmax = Math.max(vmax, tonal(i));
  let vs = -1, ve = -1, run = -1;
  for (let i = first; i <= last + 1; i++) {
    const on = i <= last && vmax > 0 && tonal(i) > vmax * 0.5;
    if (on && run < 0) run = i;
    if (!on && run >= 0) { if (i - run > ve - vs) { vs = run; ve = i; } run = -1; }
  }
  let vowel;
  if (vs >= 0 && ve - vs >= fr(0.08)) vowel = [vs * hop, Math.min(data.length, Math.min(ve, vs + fr(0.6)) * hop + win)];
  else { let c = first; for (let i = first; i <= last; i++) if (rms[i] > rms[c]) c = i; vowel = cut(at(c, 0.08), 0.22); }

  // pitch of the vowel, by matching the wave against itself
  let f0 = 140, pitched = false;
  const N2 = Math.min(2048, vowel[1] - vowel[0]), mid = Math.floor((vowel[0] + vowel[1] - N2) / 2);
  if (N2 >= 1024) {
    let r0 = 0; for (let j = 0; j < N2; j++) r0 += data[mid + j] * data[mid + j];
    const lo = Math.floor(sr / 400), hi = Math.min(N2 - 64, Math.floor(sr / 70)), rs = new Float32Array(hi + 1);
    let bestLag = 0, bestR = 0;
    for (let lag = lo; lag <= hi; lag++) {
      let r = 0; for (let j = 0; j < N2 - lag; j++) r += data[mid + j] * data[mid + j + lag];
      rs[lag] = r / ((N2 - lag) / N2);
      if (rs[lag] > bestR) { bestR = rs[lag]; bestLag = lag; }
    }
    // two cycles match as well as one, so take the shortest lag that is nearly as good: the real pitch, not an octave under
    for (let lag = lo + 1; lag < bestLag; lag++) if (rs[lag] >= bestR * 0.88 && rs[lag] >= rs[lag - 1] && rs[lag] >= rs[lag + 1]) { bestLag = lag; break; }
    if (bestLag && r0 > 0 && bestR / r0 > 0.35) { f0 = sr / bestLag; pitched = true; }
  }
  // how it was said: each new sound, when it landed and whether it was round or sharp
  const cls = i => (!act(i) ? 0 : zcr[i] > 0.18 ? 2 : 1);
  const events = []; let prevC = 0, lastT = -1, sharpN = 0, actN = 0;
  for (let i = first; i <= last; i++) {
    const c = cls(i); if (c) actN++; if (c === 2) sharpN++;
    const steady = i + 1 > last || cls(i + 1) === c, jump = i >= 2 ? rms[i] - rms[i - 2] : rms[i];
    const fresh = c === 1 && prevC === 1 && jump > peak * 0.3;                 // a new syllable inside a run of voice
    if (c && steady && (c !== prevC || fresh)) { const t = (i * hop) / sr; if (t - lastT >= 0.07) { events.push({ t, kind: c === 2 ? 'sharp' : 'low' }); lastT = t; } }
    if (steady) prevC = c;
  }
  const dur = ((last - first) * hop) / sr;

  const hatStart = at(back(iH), 0.006), kickStart = at(iK, 0.01);
  return {
    events, dur, pace: events.length / Math.max(0.3, dur), sharp: actN ? sharpN / actN : 0,
    word: [at(first, 0.01), Math.min(data.length, last * hop + win)],
    f0, pitched, ownSnare,
    kick: cut(kickStart, 0.18), perc: cut(kickStart, 0.035),
    hat: cut(hatStart, 0.07), ohat: cut(hatStart, 0.22),
    snare: ownSnare ? cut(at(back(iS), 0.008), 0.15) : cut(hatStart, 0.15),
    vowel,
  };
}

// Where the front half of the phrase ends: the start of the syllable nearest the middle,
// so "bring the noise" can come back as just "bring the".
export function halfCut(parts, sr) {
  const t0 = parts.word[0] / sr, len = (parts.word[1] - parts.word[0]) / sr;
  let best = len * 0.5, d = Infinity;
  for (const e of parts.events) { const x = e.t - t0; if (x > len * 0.3 && x < len * 0.72 && Math.abs(x - len / 2) < d) { d = Math.abs(x - len / 2); best = x - 0.015; } }
  return best;
}

// ------------------------------------------------------------------ building the kit
// one slice of the take, levelled and faded so it doesn't click
function cutBuf(data, a, b, sr, name) {
  const len = b - a, out = new Float32Array(len); let pk = 0;
  for (let i = 0; i < len; i++) { out[i] = data[a + i]; pk = Math.max(pk, Math.abs(out[i])); }
  const g = pk > 0.001 ? Math.min(20, 0.9 / pk) : 1, fin = Math.min(len >> 2, Math.round(sr * 0.003)), fout = Math.min(len >> 2, Math.round(sr * (name === 'vowel' ? 0.02 : 0.012)));
  for (let i = 0; i < len; i++) { let w = 1; if (i < fin) w = i / fin; else if (i > len - fout) w = (len - i) / fout; out[i] *= g * w; }
  const buf = getCtx().createBuffer(1, len, sr); buf.copyToChannel(out, 0); return buf;
}
let take = null;
// How many syllables the drums can slide between (0 or 1 means there's nothing to slide to).
export const syllables = () => (voice.parts ? voice.parts.events.length : 0);
// Slide every drum k syllables along the phrase: the kick that said "butt" can say "pea",
// "nut" or "ter". Each drum keeps its own length, so the kit stays varied.
export function voiceShift(k) {
  if (!take || !voice.parts) return;
  const { data, sr } = take, p = voice.parts, on = p.events.map(e => Math.round(e.t * sr)), n = on.length;
  if (n < 2) return;
  for (const name of ['kick', 'perc', 'hat', 'ohat', 'snare']) {
    const [a, b] = p[name], len = b - a;
    let i = 0; for (let j = 1; j < n; j++) if (Math.abs(on[j] - a) < Math.abs(on[i] - a)) i = j;
    const na = on[(((i + k) % n) + n) % n], nb = Math.min(data.length, na + len);
    if (nb - na >= 64) voice.bufs[name] = cutBuf(data, na, nb, sr, name);
  }
  voice.shift = k;
}
export function buildVoice(data, sr) {
  const parts = analyze(data, sr); if (!parts) return false;
  const ctx = getCtx(), bufs = {};
  for (const name of ['kick', 'perc', 'hat', 'ohat', 'snare', 'vowel', 'word']) {
    const [a, b] = parts[name]; if (b - a < 64) return false;
    bufs[name] = cutBuf(data, a, b, sr, name);
  }
  take = { data, sr }; voice.shift = 0; chops = null; chopAt = 0; talk = null;
  const fwd = bufs.word.getChannelData(0), rev = ctx.createBuffer(1, fwd.length, sr), rd = rev.getChannelData(0);
  for (let i = 0; i < fwd.length; i++) rd[i] = fwd[fwd.length - 1 - i];
  bufs.rev = rev;
  // a loop inside the vowel that is a whole number of wave cycles long, so held notes do not click
  const v = bufs.vowel, period = sr / parts.f0, start = Math.round(v.length * 0.3), cycles = Math.max(1, Math.floor((v.length * 0.6) / period));
  voice.loop = [start / sr, (start + Math.round(cycles * period)) / sr];
  Object.assign(voice, { ready: true, f0: parts.f0, pitched: parts.pitched, parts, bufs, half: halfCut(parts, sr) });
  return true;
}

// ------------------------------------------------------------------ playing it
function shot(buf, t, { rate = 1, gain = 1, type, freq, q = 0.7, dest = N.drums, glide, len }) {
  const ctx = getCtx(), src = ctx.createBufferSource(), g = ctx.createGain();
  src.buffer = buf;
  src.playbackRate.setValueAtTime(dest === N.drums ? rate * tuneRatio() : rate, t);
  if (glide) src.playbackRate.exponentialRampToValueAtTime(dest === N.drums ? glide * tuneRatio() : glide, t + 0.07);
  g.gain.value = gain;
  if (len) { g.gain.setValueAtTime(gain, t + len * 0.6); g.gain.setTargetAtTime(0, t + len * 0.6, len * 0.15); }   // cut short
  if (type) { const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q; src.connect(f).connect(g); } else src.connect(g);
  g.connect(dest); src.start(t);
  if (len) src.stop(t + len * 2);
}
// rows: 0 kick, 1 snare, 2 clap, 3 hat, 4 open hat, 5 rim
export function voiceDrum(r, t, vel) {
  const b = voice.bufs, ctx = getCtx(), wob = 0.97 + Math.random() * 0.06;
  if (r === 0) {
    // The kick is a drum first: a fast-falling sine for the body, with your voice only as the
    // front of the hit. The voice is cut short and filtered low so its pitch doesn't read as a note.
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.setValueAtTime(155, t); o.frequency.exponentialRampToValueAtTime(46, t + 0.06);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(1.15 * vel, t + 0.003); g.gain.exponentialRampToValueAtTime(0.001, t + 0.32);
    o.connect(g).connect(N.drums); o.start(t); o.stop(t + 0.34);
    shot(b.kick, t, { rate: 0.7, glide: 0.3, gain: 1.1 * vel, type: 'lowpass', freq: 180, q: 0.5, len: 0.07 });   // your voice, just the thud of it
    shot(b.perc, t, { rate: 1, gain: 0.38 * vel, type: 'highpass', freq: 900 });                            // the consonant, for the click
  } else if (r === 1) shot(b.snare, t, { rate: voice.parts.ownSnare ? 1 : 0.72, gain: 1.1 * vel, type: 'highpass', freq: 500 });
  else if (r === 2) { shot(b.snare, t, { rate: 1.2, gain: 0.7 * vel, type: 'bandpass', freq: 1700, q: 0.6 }); shot(b.snare, t + 0.013, { rate: 1.25, gain: 0.6 * vel, type: 'bandpass', freq: 1900, q: 0.6 }); }
  else if (r === 3) shot(b.hat, t, { rate: 1.1 * wob, gain: 0.55 * vel, type: 'highpass', freq: 4200 });
  else if (r === 4) shot(b.ohat, t, { rate: 1.05, gain: 0.5 * vel, type: 'highpass', freq: 3800 });
  else shot(b.perc, t, { rate: 1.5 * wob, gain: 0.8 * vel, type: 'highpass', freq: 900 });
}
// the vowel, pitched to a note. role: 'bass' or 'lead'
// The voice bass. Slowing the vowel down to reach a low note drags the mouth shape down
// with it (the monster-tape sound). Instead, cut short windowed grains from the vowel at its
// own pitch and lay them down at the new note's rate (PSOLA): the pitch drops, the vowel
// stays. One buffer per note, built once. Add ?oldvoicebass to the address to hear the old way.
const OLD_VOICE_BASS = typeof location !== 'undefined' && /[?&]oldvoicebass\b/.test(location.search);
const PSOLA_LEAD = typeof location !== 'undefined' && /[?&]psolalead\b/.test(location.search);
const PSOLA_BASS = typeof location !== 'undefined' && /[?&]psolabass\b/.test(location.search);
const psolaCache = new Map();
export function psola(data, sr, f0, loop, target, secs = 1.2) {
  const T0 = sr / f0, Tt = sr / target, L = Math.max(16, Math.round(2 * T0)), N = Math.round(secs * sr);
  let a = Math.round(loop[0] * sr), b = Math.round(loop[1] * sr) - L;
  if (b - a < T0) { a = 0; b = data.length - L; }
  const win = new Float32Array(L); for (let i = 0; i < L; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (L - 1));
  const out = new Float32Array(N);
  let src = a;
  for (let pos = 0; pos < N; pos += Tt) {
    const o = Math.round(pos) - (L >> 1), sI = Math.round(src);
    for (let i = 0; i < L; i++) { const k = o + i; if (k >= 0 && k < N) out[k] += data[sI + i] * win[i]; }
    src += Tt; src = a + Math.round((src - a) / T0) * T0;       // move on through the vowel in whole periods
    if (src > b) src = a + ((src - a) % Math.max(T0, b - a));
  }
  let pk = 0; for (let i = 0; i < N; i++) pk = Math.max(pk, Math.abs(out[i]));
  if (pk > 0) for (let i = 0; i < N; i++) out[i] *= 0.9 / pk;
  return out;
}
function bassBuf(midi) {
  const key = midi + '|' + voice.f0 + '|' + voice.loop.join(',');
  if (!psolaCache.has(key)) {
    if (psolaCache.size > 48) psolaCache.clear();
    const vb = voice.bufs.vowel, d = psola(vb.getChannelData(0), vb.sampleRate, voice.f0, voice.loop, mtof(midi));
    const buf = getCtx().createBuffer(1, d.length, vb.sampleRate); buf.copyToChannel(d, 0); psolaCache.set(key, buf);
  }
  return psolaCache.get(key);
}
// ------------------------------------------------------------------ vocal chops
// On the Full sound, a voice beat's melody is played with the syllables of your phrase, the
// way hyphy and g-funk records chop a vocal: each note takes the next syllable, pitched to the
// note and cut short, so your words become the riff. Each syllable is pitched from the voice's
// own pitch and kept within an octave of it, so nothing gets chipmunked.
let chops = null, chopAt = 0;
function chopBufs() {
  if (chops || !take || !voice.parts) return chops;
  const { data, sr } = take, ev = voice.parts.events, out = [];
  for (let i = 0; i < ev.length; i++) {
    const a = Math.round(ev[i].t * sr), next = i + 1 < ev.length ? Math.round(ev[i + 1].t * sr) : a + Math.round(0.3 * sr);
    const b = Math.min(data.length, a + Math.min(next - a, Math.round(0.32 * sr)));
    if (b - a > sr * 0.05) out.push(cutBuf(data, a, b, sr, 'vowel'));
  }
  chops = out.length >= 2 ? out : [];
  return chops;
}
// ------------------------------------------------------------------ talkbox
// The California Love sound: a synth plays the note, and your voice shapes it. Each syllable
// of the phrase is measured once in 16 frequency bands (how loud each band is, moment by
// moment); a synth note then runs through 16 matching filters whose levels follow those
// measurements, so the synth "says" the syllable at the note's pitch.
// For now it's on at /testdj?talkbox, in place of the vocal chops.
const TALKBOX = typeof location !== 'undefined' && /[?&]talkbox\b/.test(location.search);
const BANDS = [180, 260, 360, 480, 620, 780, 960, 1180, 1440, 1750, 2120, 2560, 3080, 3700, 4450, 5350];
let talk = null;
function bandEnv(d, sr, fc, hop) {
  // a simple band-pass (biquad), then the level in each hop-long frame, smoothed
  const w = 2 * Math.PI * fc / sr, q = 4.5, al = Math.sin(w) / (2 * q), a0 = 1 + al;
  const b0 = al / a0, b2 = -al / a0, a1 = -2 * Math.cos(w) / a0, a2 = (1 - al) / a0;
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0, acc = 0; const out = [];
  for (let i = 0; i < d.length; i++) {
    const y = b0 * d[i] + b2 * x2 - a1 * y1 - a2 * y2; x2 = x1; x1 = d[i]; y2 = y1; y1 = y; acc += y * y;
    if ((i + 1) % hop === 0) { out.push(Math.sqrt(acc / hop)); acc = 0; }
  }
  for (let i = 1; i < out.length; i++) out[i] = Math.max(out[i], out[i - 1] * 0.82);   // a short release so it doesn't flutter
  return out;
}
function talkSet() {
  if (talk || !take || !voice.parts) return talk;
  const { data, sr } = take, ev = voice.parts.events, hop = Math.round(sr * 0.008), out = [];
  for (let i = 0; i < ev.length; i++) {
    const a = Math.round(ev[i].t * sr), next = i + 1 < ev.length ? Math.round(ev[i + 1].t * sr) : a + Math.round(0.35 * sr);
    const seg = data.subarray(a, Math.min(data.length, a + Math.min(next - a, Math.round(0.35 * sr))));
    if (seg.length < sr * 0.06) continue;
    const envs = BANDS.map(fc => bandEnv(seg, sr, fc, hop));
    let pk = 1e-6; for (const e of envs) for (const v of e) pk = Math.max(pk, v);
    out.push({ envs: envs.map(e => Float32Array.from(e, v => Math.min(1, v / pk))), dur: seg.length / sr });
  }
  talk = out.length >= 2 ? out : [];
  return talk;
}
let talkAt = 0;
function talkNote(midi, t, dur) {
  const set = talkSet(); if (!set || !set.length) return false;
  const syl = set[talkAt++ % set.length], ctx = getCtx(), len = Math.min(Math.max(dur, 0.12), syl.dur, 0.5);
  // the synth: two saws a little apart, rich in harmonics for the filters to carve
  const mixG = ctx.createGain(); mixG.gain.value = 0.5; const oscs = [];
  for (const d of [-6, 6]) { const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = mtof(midi); o.detune.value = d; o.connect(mixG); oscs.push(o); }
  const out = ctx.createGain(); out.gain.setValueAtTime(0, t); out.gain.linearRampToValueAtTime(0.9, t + 0.01); out.gain.setValueAtTime(0.9, t + len - 0.03); out.gain.linearRampToValueAtTime(0, t + len);
  BANDS.forEach((fc, b) => {
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = fc; f.Q.value = 5;
    const g = ctx.createGain(), env = syl.envs[b], n = Math.max(2, Math.round(env.length * len / syl.dur));
    const curve = new Float32Array(n); for (let i = 0; i < n; i++) curve[i] = env[Math.min(env.length - 1, i)] * (1.4 + b * 0.06);
    g.gain.setValueCurveAtTime(curve, t, len);
    mixG.connect(f).connect(g).connect(out);
  });
  out.connect(N.lead);
  for (const o of oscs) { o.start(t); o.stop(t + len + 0.02); }
  return true;
}

function syllableNote(midi, t, dur) {
  const set = chopBufs(); if (!set || !set.length) return false;
  const buf = set[chopAt++ % set.length], ctx = getCtx();
  const home = 12 * Math.log2(voice.f0 / 440) + 69; while (midi > home + 9) midi -= 12; while (midi < home - 4) midi += 12;
  const src = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
  src.buffer = buf; src.playbackRate.value = Math.max(0.5, Math.min(1.8, mtof(midi) / voice.f0));
  f.type = 'bandpass'; f.frequency.value = 1100; f.Q.value = 0.5;
  const len = Math.min(dur, buf.duration / src.playbackRate.value, 0.3);
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.42, t + 0.004);
  g.gain.setValueAtTime(0.42, t + len * 0.7); g.gain.linearRampToValueAtTime(0, t + len);
  src.connect(f).connect(g).connect(N.lead); src.start(t); src.stop(t + len + 0.02);
  return true;
}

export function voiceNote(midi, t, dur, role) {
  // The voice melody: keep the note within an octave of the voice's own pitch, so it's never
  // sped up into chipmunk range (it used to run 3-4x fast, which is what screeched)
  if (role === 'lead' && voice.f0) { const home = 12 * Math.log2(voice.f0 / 440) + 69; while (midi > home + 10) midi -= 12; while (midi < home - 5) midi += 12; }
  // The bass stays the original way, the vowel slowed down: building it from grains buzzed
  // when the voice dropped that far (the grains end up with gaps between them). ?psolabass to compare.
  if (role === 'bass' && PSOLA_BASS && voice.pitched && voice.loop) return voiceBass(midi, t, dur);
  if (role === 'lead' && PSOLA_LEAD && voice.pitched && voice.loop) return voiceLead(midi, t, dur);
  // how the melody uses your phrase: chopped syllables, the talkbox, or the vowel held (the original)
  const vox = TALKBOX ? 'talk' : song.vox;
  if (role === 'lead' && vox === 'talk' && voice.pitched && talkNote(midi, t, dur)) return;
  if (role === 'lead' && vox === 'chops' && voice.pitched && syllableNote(midi, t, dur)) return;   // grain lead only with ?psolalead
  const ctx = getCtx(), src = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
  src.buffer = voice.bufs.vowel; src.playbackRate.value = Math.max(0.2, Math.min(4, mtof(midi) / voice.f0));
  src.loop = true; src.loopStart = voice.loop[0]; src.loopEnd = voice.loop[1];
  const bass = role === 'bass', level = bass ? 0.95 : 0.3;
  f.type = bass ? 'lowpass' : 'bandpass'; f.frequency.value = bass ? 520 : 900; f.Q.value = bass ? 0.7 : 0.45;   // the melody: no rumble, no hiss
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(level, t + 0.006);
  g.gain.setTargetAtTime(0, t + Math.max(0.06, dur * (bass ? 0.8 : 0.9)), bass ? 0.05 : 0.07);
  src.connect(f).connect(g).connect(bass ? N.bass : N.lead);
  src.start(t); src.stop(t + dur + 0.5);
}

// ------------------------------------------------------------------ the parts that make a loop into a song
// the whole word, said once over the top: your producer tag
// The phrase itself, whole or just its front half. When it comes back mid-song it sits
// a little under the drums and trails an echo three 16ths long.
let echo = null;
function echoIn(sd) {
  const ctx = getCtx();
  if (!echo) {
    const input = ctx.createGain(), d = ctx.createDelay(1.5), lp = ctx.createBiquadFilter(), fb = ctx.createGain(), out = ctx.createGain();
    lp.type = 'lowpass'; lp.frequency.value = 2400; fb.gain.value = 0.36; out.gain.value = 0.5;
    input.connect(d); d.connect(lp); lp.connect(fb); fb.connect(d); lp.connect(out); out.connect(N.lead);
    echo = { input, d, time: 0 };
  }
  const time = Math.min(1.4, sd * 3);
  if (Math.abs(time - echo.time) > 0.001) { echo.d.delayTime.setValueAtTime(time, ctx.currentTime); echo.time = time; }
  return echo.input;
}
export function voiceTag(t, { gain = 0.85, half = false, wet = false, sd = 0.15 } = {}) {
  const ctx = getCtx(), src = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
  src.buffer = voice.bufs.word; f.type = 'highpass'; f.frequency.value = 160; g.gain.setValueAtTime(gain, t);
  src.connect(f).connect(g).connect(N.lead);
  if (wet) g.connect(echoIn(sd));
  src.start(t);
  if (half) { const end = t + voice.half; g.gain.setTargetAtTime(0, end - 0.02, 0.012); src.stop(end + 0.12); }
}
// the vowel chopped on 16ths and climbing, into the turn
const CHOP = [1, 1.12, 1.26, 1.5];
export function voiceChop(t, k, sd) {
  const ctx = getCtx(), src = ctx.createBufferSource(), g = ctx.createGain(), f = ctx.createBiquadFilter();
  src.buffer = voice.bufs.vowel; src.playbackRate.value = CHOP[k % 4];
  f.type = 'highpass'; f.frequency.value = 300;
  const len = Math.min(sd * 0.8, 0.09);
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.5, t + 0.004); g.gain.setTargetAtTime(0, t + len, 0.01);
  src.connect(f).connect(g).connect(N.lead); src.start(t, voice.loop[0]); src.stop(t + len + 0.08);
}
// the word backwards, swelling up so it ends exactly on the next downbeat
export function voiceRiser(tEnd, room) {
  const ctx = getCtx(), buf = voice.bufs.rev, len = Math.min(buf.duration, room), src = ctx.createBufferSource(), g = ctx.createGain(), f = ctx.createBiquadFilter();
  src.buffer = buf; f.type = 'highpass'; f.frequency.value = 400;
  const t = tEnd - len;
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.6, tEnd - 0.01); g.gain.linearRampToValueAtTime(0, tEnd + 0.01);
  src.connect(f).connect(g).connect(N.lead); src.start(t, buf.duration - len); src.stop(tEnd + 0.05);
}

function voiceBass(midi, t, dur) {
  const ctx = getCtx(), src = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
  src.buffer = bassBuf(midi);
  f.type = 'lowpass'; f.frequency.value = 900; f.Q.value = 0.7;
  const len = Math.min(dur, src.buffer.duration - 0.05);
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.85, t + 0.008);
  g.gain.setTargetAtTime(0, t + Math.max(0.06, len * 0.8), 0.05);
  src.connect(f).connect(g).connect(N.bass); src.start(t); src.stop(t + len + 0.4);
  // a quiet sine underneath, for weight
  const o = ctx.createOscillator(), og = ctx.createGain(); o.frequency.value = mtof(midi - 12 * (midi > 52 ? 1 : 0));
  og.gain.setValueAtTime(0, t); og.gain.linearRampToValueAtTime(0.32, t + 0.01); og.gain.setTargetAtTime(0, t + Math.max(0.06, len * 0.8), 0.06);
  o.connect(og).connect(N.bass); o.start(t); o.stop(t + len + 0.45);
}

// The voice lead, made the same way: grains of the vowel laid at the note's rate, so a high
// note sounds like you singing higher, not a sped-up tape.
function voiceLead(midi, t, dur) {
  const ctx = getCtx(), src = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
  src.buffer = bassBuf(midi);
  f.type = 'highpass'; f.frequency.value = 260; f.Q.value = 0.7;
  const len = Math.min(dur, src.buffer.duration - 0.05);
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.38, t + 0.012);
  g.gain.setTargetAtTime(0, t + Math.max(0.06, len * 0.9), 0.07);
  src.connect(f).connect(g).connect(N.lead); src.start(t); src.stop(t + len + 0.5);
}
