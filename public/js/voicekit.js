// voicekit.js — say one word and the beat is made out of it.
// One short recording is cut into a drum kit: the sharp consonants become the
// hats and snare, the hardest hit is pitched down into the kick, and the vowel
// is stretched across notes for the bass and the melody. Nothing leaves the browser.
import { getCtx, nodes as N, mtof , bendParam, bendAt } from './engine.js';

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

export const voice = { ready: false, f0: 140, pitched: false, parts: null, bufs: {}, pcm: null, id: null, half: 0.5 };

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
export function buildVoice(data, sr) {
  const parts = analyze(data, sr); if (!parts) return false;
  const ctx = getCtx(), bufs = {};
  for (const name of ['kick', 'perc', 'hat', 'ohat', 'snare', 'vowel', 'word']) {
    const [a, b] = parts[name], len = b - a; if (len < 64) return false;
    const out = new Float32Array(len); let pk = 0;
    for (let i = 0; i < len; i++) { out[i] = data[a + i]; pk = Math.max(pk, Math.abs(out[i])); }
    const g = pk > 0.001 ? Math.min(20, 0.9 / pk) : 1, fin = Math.min(len >> 2, Math.round(sr * 0.003)), fout = Math.min(len >> 2, Math.round(sr * (name === 'vowel' ? 0.02 : 0.012)));
    for (let i = 0; i < len; i++) { let w = 1; if (i < fin) w = i / fin; else if (i > len - fout) w = (len - i) / fout; out[i] *= g * w; }
    const buf = ctx.createBuffer(1, len, sr); buf.copyToChannel(out, 0); bufs[name] = buf;
  }
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
function shot(buf, t, { rate = 1, gain = 1, type, freq, q = 0.7, dest = N.drums, glide }) {
  const ctx = getCtx(), src = ctx.createBufferSource(), g = ctx.createGain();
  src.buffer = buf;
  if (dest === N.drums || dest === N.bass) bendParam(src.playbackRate, rate, t); else src.playbackRate.setValueAtTime(rate, t);   // the beat record bends voice drums too
  if (glide && !((dest === N.drums || dest === N.bass) && bendAt(t))) src.playbackRate.exponentialRampToValueAtTime(glide, t + 0.07);
  g.gain.value = gain;
  if (type) { const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q; src.connect(f).connect(g); } else src.connect(g);
  g.connect(dest); src.start(t);
}
// rows: 0 kick, 1 snare, 2 clap, 3 hat, 4 open hat, 5 rim
export function voiceDrum(r, t, vel) {
  const b = voice.bufs, ctx = getCtx(), wob = 0.97 + Math.random() * 0.06;
  if (r === 0) {
    shot(b.kick, t, { rate: 0.85, glide: 0.42, gain: 1.7 * vel, type: 'lowpass', freq: 280, q: 1 });       // your voice, dropped an octave
    shot(b.perc, t, { rate: 1, gain: 0.3 * vel, type: 'highpass', freq: 700 });                             // the consonant, for the click
    const o = ctx.createOscillator(), g = ctx.createGain();                                                 // a little floor under it
    o.frequency.setValueAtTime(120, t); o.frequency.exponentialRampToValueAtTime(50, t + 0.08);
    g.gain.setValueAtTime(0.45 * vel, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
    o.connect(g).connect(N.drums); o.start(t); o.stop(t + 0.22);
  } else if (r === 1) shot(b.snare, t, { rate: voice.parts.ownSnare ? 1 : 0.72, gain: 1.1 * vel, type: 'highpass', freq: 500 });
  else if (r === 2) { shot(b.snare, t, { rate: 1.2, gain: 0.7 * vel, type: 'bandpass', freq: 1700, q: 0.6 }); shot(b.snare, t + 0.013, { rate: 1.25, gain: 0.6 * vel, type: 'bandpass', freq: 1900, q: 0.6 }); }
  else if (r === 3) shot(b.hat, t, { rate: 1.1 * wob, gain: 0.55 * vel, type: 'highpass', freq: 4200 });
  else if (r === 4) shot(b.ohat, t, { rate: 1.05, gain: 0.5 * vel, type: 'highpass', freq: 3800 });
  else shot(b.perc, t, { rate: 1.5 * wob, gain: 0.8 * vel, type: 'highpass', freq: 900 });
}
// the vowel, pitched to a note. role: 'bass' or 'lead'
export function voiceNote(midi, t, dur, role) {
  const ctx = getCtx(), src = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
  src.buffer = voice.bufs.vowel; src.playbackRate.value = Math.max(0.2, Math.min(4, mtof(midi) / voice.f0));
  src.loop = true; src.loopStart = voice.loop[0]; src.loopEnd = voice.loop[1];
  const bass = role === 'bass', level = bass ? 0.95 : 0.4;
  f.type = bass ? 'lowpass' : 'highpass'; f.frequency.value = bass ? 520 : 260; f.Q.value = 0.7;
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
