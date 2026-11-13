// hype.js — adlib, the hype man. He decides WHEN to come in (on the bar grid, in the
// gaps you leave), WHAT to do (double your voice, say a line, tag your word,
// call the rhyme), and how big (heat). Restraint is the whole trick.
import { getCtx, nodes as N, posAt, nextGrid, stepDur, timeOfStep, on as onBeat, setPerf, isPlaying } from './engine.js';
import { ears, onEar, slice, expectNoise, micRate, setHang, calibrate } from './ears.js';
import { words, onWord, wordsBetween, rhymes, isContent, keywordSlug } from './words.js';
import { PHRASES } from './phrases.js';

export const hype = { live: false, mode: 'hype', heat: 0, readyAt: 0, log: [], fires: 0, phrases: 0 };
const shows = [];
export const onShow = fn => shows.push(fn);
const show = ev => { for (const fn of shows) fn(ev); };
const note = (type, text) => { hype.log.push({ type, text, t: getCtx().currentTime }); if (hype.log.length > 60) hype.log.shift(); };

const rand = Math.random;
const pick = a => a[Math.floor(rand() * a.length)];
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

let lastFire = 0, lastSig = 0, lastNudge = 0, nudged = false, lastKinds = [], ends = [], heatTimer = null, flip = 1;

// ------------------------------------------------------------------ voice bank
const bank = new Map();        // "mode/slug/n" -> AudioBuffer | null (missing) | Promise
const lastTake = {};
function loadTake(mode, slug, n) {
  const k = `${mode}/${slug}/${n}`;
  if (bank.has(k)) return bank.get(k);
  const pr = fetch(`audio/${mode}/${slug}_${n}.mp3`).then(r => (r.ok ? r.arrayBuffer() : Promise.reject()))
    .then(b => getCtx().decodeAudioData(b)).then(buf => { bank.set(k, buf); return buf; }).catch(() => { bank.set(k, null); return null; });
  bank.set(k, pr); return pr;
}
function preload(slugs) { for (const mode of ['hype', 'boom']) if (mode === hype.mode) for (const s of slugs) for (let n = 1; n <= 3; n++) loadTake(mode, s, n); }
const GENERIC = ['ayy', 'yeah', 'sheesh', 'bars', 'whooo', 'wooo', 'talktoem', 'facts'];
const PUNCH = ['yeah', 'ayy', 'wooo', 'whooo'];
const BIG = ['sheesh', 'bars', 'ohhh', 'whooo'];
let lastSlug = '';
const fresh = list => { let s = pick(list); if (s === lastSlug) s = list[(list.indexOf(s) + 1) % list.length]; lastSlug = s; return s; };

// Speak a line at audio time t. Returns the words he said, or null if no take is loaded yet.
function say(slug, t, vol = 1) {
  const takes = [];
  for (let n = 1; n <= 3; n++) { const b = bank.get(`${hype.mode}/${slug}/${n}`); if (b && b.duration) takes.push([n, b]); else if (b === undefined) loadTake(hype.mode, slug, n); }
  if (!takes.length) return null;
  let [n, buf] = pick(takes);
  if (takes.length > 1 && n === lastTake[slug]) [n, buf] = takes[(takes.findIndex(x => x[0] === n) + 1) % takes.length];
  lastTake[slug] = n;
  const ctx = getCtx(), src = ctx.createBufferSource(), g = ctx.createGain();
  src.buffer = buf; g.gain.value = vol;
  src.connect(g).connect(N.hype); src.start(t);
  expectNoise(t, t + buf.duration);
  const line = PHRASES[slug] && PHRASES[slug][hype.mode] && PHRASES[slug][hype.mode][n - 1];
  return { text: (line || slug).toLowerCase(), dur: buf.duration };
}

// ------------------------------------------------------------------ doubling
// Take the tail of what you just said and throw it back on the beat.
function double(p, t, style) {
  const ctx = getCtx(), tB = p.tEnd + 0.07;
  let tA = tB - 0.42;
  for (let k = p.onsets.length - 1; k >= 0; k--) {
    const d = tB - p.onsets[k];
    if (d >= 0.2) { tA = d <= 0.7 ? p.onsets[k] - 0.035 : tB - 0.5; break; }
  }
  const data = slice(tA, tB); if (!data) return null;
  let peak = 0; for (let i = 0; i < data.length; i++) { const a = Math.abs(data[i]); if (a > peak) peak = a; }
  if (peak < 0.004) return null;
  const k = Math.min(14, 0.8 / peak), sr = micRate(), fade = Math.floor(sr * 0.008);
  for (let i = 0; i < data.length; i++) {
    let w = 1; if (i < fade) w = i / fade; else if (i > data.length - fade) w = (data.length - i) / fade;
    data[i] *= k * w;
  }
  const buf = ctx.createBuffer(1, data.length, sr); buf.copyToChannel(data, 0);
  const rate = hype.mode === 'boom' ? 0.82 : (rand() < 0.25 ? 1.12 : 1);
  const sd = stepDur();

  // megaphone tone, a little to one side, into a tempo-synced echo
  const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = hype.mode === 'boom' ? 900 : 1500; bp.Q.value = 0.7;
  const hpf = ctx.createBiquadFilter(); hpf.type = 'highpass'; hpf.frequency.value = 280;
  const out = ctx.createGain(); out.gain.value = 0.85;
  const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null; flip = -flip;
  if (pan) pan.pan.value = 0.35 * flip;
  bp.connect(hpf).connect(out);
  (pan ? out.connect(pan) : out).connect(N.hype);
  let tail = 0;
  if (style !== 'double') {
    const dl = ctx.createDelay(2), fb = ctx.createGain(), lp = ctx.createBiquadFilter(), wet = ctx.createGain();
    dl.delayTime.value = sd * 3; fb.gain.value = style === 'throw' ? 0.42 : 0.3; lp.type = 'lowpass'; lp.frequency.value = 2200; wet.gain.value = 0.55;
    out.connect(dl); dl.connect(lp).connect(fb).connect(dl); lp.connect(wet).connect(N.hype);
    tail = sd * 3 * (style === 'throw' ? 3 : 2);
    setTimeout(() => { try { fb.gain.value = 0; wet.disconnect(); } catch {} }, (t - ctx.currentTime + tail + 2) * 1000);
  }
  const hit = (when, off, dur) => {
    const s = ctx.createBufferSource(); s.buffer = buf; s.playbackRate.value = rate; s.connect(bp);
    if (dur) s.start(when, off, dur); else s.start(when);
  };
  let len = buf.duration / rate;
  if (style === 'stutter') {
    const chop = Math.min(0.11, buf.duration / 2);
    for (let i = 0; i < 3; i++) hit(t + i * sd, 0, chop);
    hit(t + 3 * sd); len += 3 * sd;
  } else hit(t);
  expectNoise(t, t + len + tail * 0.6);

  return { dur: len };
}

// ------------------------------------------------------------------ fx accents
function fx(name, t) {
  const c = getCtx(), m = N.hype;
  const osc = (type, f0, f1, dur, vol, at = t, filt) => {
    const o = c.createOscillator(), g = c.createGain(); o.type = type;
    o.frequency.setValueAtTime(f0, at); if (f1) o.frequency.exponentialRampToValueAtTime(f1, at + dur * 0.8);
    g.gain.setValueAtTime(0, at); g.gain.linearRampToValueAtTime(vol, at + 0.01); g.gain.setValueAtTime(vol, at + dur * 0.7); g.gain.exponentialRampToValueAtTime(0.001, at + dur);
    if (filt) { const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = filt; f.Q.value = 3; o.connect(f).connect(g); } else o.connect(g);
    g.connect(m); o.start(at); o.stop(at + dur + 0.05);
  };
  const burst = (dur, vol, type, freq, at = t) => {
    const b = c.createBuffer(1, Math.floor(c.sampleRate * dur), c.sampleRate), d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 1.6);
    const s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain(); s.buffer = b; f.type = type; f.frequency.value = freq; g.gain.value = vol;
    s.connect(f).connect(g).connect(m); s.start(at);
  };
  if (name === 'airhorn') { for (const f of [233, 349, 466, 470]) osc('sawtooth', f * 0.72, f, 0.75, 0.05); }
  else if (name === 'stab') osc('sawtooth', 660, 880, 0.2, 0.1, t, 1500);
  else if (name === 'scratch') { osc('sawtooth', 900, 140, 0.18, 0.12, t, 1200); osc('sawtooth', 200, 900, 0.14, 0.1, t + 0.2, 1200); }
  else if (name === 'sweep') osc('triangle', 600, 2600, 0.4, 0.06);
  else if (name === 'cash') [1200, 1800, 2400].forEach((f, i) => osc('sine', f, 0, 0.2, 0.08, t + i * 0.06));
  else if (name === 'gun') [0, 0.09, 0.18].forEach(o => burst(0.09, 0.4, 'lowpass', 500, t + o));
  else if (name === 'fire') burst(0.5, 0.16, 'highpass', 2200);
  else if (name === 'choir') [60, 64, 67, 72].forEach(n => osc('sawtooth', 440 * Math.pow(2, (n - 69) / 12), 0, 1, 0.03, t, 700));
}
const SLUG_FX = { fire: 'fire', chaching: 'cash', blat: 'gun', amen: 'choir', allhail: 'choir', bums: 'scratch', nahfr: 'scratch', skrrt: 'scratch', wayup: 'sweep', brrr: 'sweep', represent: 'airhorn', ownit: 'airhorn', bars: 'airhorn' };

// ------------------------------------------------------------------ what he does
const stretch = w => {                                    // COLD -> COOOLD, MONEY -> MONEYYY
  const m = w.match(/^(.*?)([aeiouy]+)([^aeiouy]*)$/i); if (!m || rand() < 0.45) return w;
  const v = m[2]; return m[1] + v + v[v.length - 1].repeat(2) + m[3];
};
const size = () => (hype.heat > 75 ? 'xl' : hype.heat > 45 ? 'l' : 'm');
// One answer at a time, whichever part of him wants to speak.
const busy = t => Math.abs(t - lastFire) < stepDur() * 4;
function fired(kind, text, t) {
  lastFire = t; hype.fires++; lastKinds.push(kind); if (lastKinds.length > 3) lastKinds.shift();
  note(kind, text);
}

function fireVoice(slug, t, opts = {}) {
  if (busy(t)) return false;
  const said = say(slug, t, opts.vol || 0.95);
  const line = PHRASES[slug] && PHRASES[slug][hype.mode];
  if (!said && !(opts.must && line)) return false;
  if (opts.fx === true || (opts.fx !== false && SLUG_FX[slug] && hype.heat > 35)) fx(SLUG_FX[slug] || 'stab', t);
  const text = said ? said.text : line[0].toLowerCase();
  show({ kind: 'text', text, size: opts.size || size(), dur: said ? said.dur : 0.5, at: t });
  fired('voice', text, t); return true;
}
function fireDouble(p, t, word) {
  if (busy(t)) return false;
  const style = hype.heat > 65 && rand() < 0.4 ? 'stutter' : rand() < 0.55 ? 'throw' : 'double';
  const d = double(p, t, style);
  if (!d) return false;
  if (word) show({ kind: 'text', text: stretch(word) + '!', size: size(), echo: true, dur: d.dur, at: t });
  else show({ kind: 'wave', dur: d.dur, at: t });
  fired(word ? 'echo' : 'double', word || '(voice)', t); return true;
}
function fireRhyme(p, a, b, chain, strength, t) {
  if (busy(t)) return;
  const sd = stepDur();
  const d = double(p, t, 'throw');
  show({ kind: 'text', text: a + '!', ghost: b, chain, size: chain >= 3 ? 'xl' : 'l', echo: true, dur: d ? d.dur : 0.5, at: t });
  if (chain >= 3 || strength === 2) { const said = say(fresh(BIG), t + sd * 4, 0.9); if (said) show({ kind: 'text', text: said.text, size: 'm', dur: said.dur, at: t + sd * 4 }); }
  bump(6 + chain * 4);
  fired('rhyme', `${b} / ${a} x${chain}`, t);
}
function signature(t) {
  if (busy(t)) return;
  lastSig = t;
  const said = say('adlib', t, 1);
  fx('airhorn', t); fx('scratch', t + stepDur() * 2);
  show({ kind: 'text', text: said ? said.text.replace(/ad lib/i, 'adlib') : 'adlib!', size: 'xl', sig: true, dur: said ? said.dur : 0.8, at: t });
  fired('signature', 'adlib', t);
  hype.heat = Math.max(40, hype.heat - 25);              // release, then build again
}
export function bump(n) { hype.heat = clamp(hype.heat + n, 0, 100); }

// ------------------------------------------------------------------ the decision
let wordCut = 0, reserved = 0;      // reserved: a reply is already on its way
function onPhraseEnd(p) {
  const ctx = getCtx(), now = ctx.currentTime;
  if (!hype.live || now < hype.readyAt) return;
  if (p.dur < 0.22 && p.onsets.length < 2) return;          // a cough is not a bar
  hype.phrases++; nudged = false;
  bump(clamp(3 + p.dur * 3 + p.onsets.length * 0.7, 3, 16));

  const sd = stepDur(), beat = sd * 4, s = ((posAt(p.tEnd) % 16) + 16) % 16;
  const barEnd = s >= 11 || s < 1.75, half = s >= 6.5 && s < 9, since = now - Math.max(lastFire, reserved);

  let prob = barEnd ? 0.9 : half ? 0.4 : 0.18;
  if (hype.fires < 2) prob = 1;                             // first bar always gets an answer: proof he hears you
  if (since > beat * 8) prob = Math.max(prob, 0.85);
  if (hype.heat > 70) prob *= 0.85;                         // hot = fewer, bigger
  const go = since >= beat * 0.9 && rand() <= prob;         // otherwise only a rhyme gets him to speak

  // A recognizer delivers your last word a beat late. When one is running, land a
  // little later so the word he answers is the word you ended on.
  const hearing = words.engine !== 'none' && words.recent.length > 0;
  if (!go && !hearing) return;
  const t = nextGrid(now + (hearing ? 0.2 : 0.04), hype.heat > 60 && !hearing ? 1 : 2);
  if (go) reserved = t;
  setTimeout(() => choose(p, t, go, barEnd), Math.max(0, (t - now - 0.07) * 1000));
}

function choose(p, t, go, barEnd) {
  if (!hype.live) return;
  const now = getCtx().currentTime;
  // what did he catch? only words he has not already answered
  const heard = wordsBetween(Math.max(p.tStart - 0.4, wordCut), now + 0.3).map(x => x.w).filter(isContent);
  wordCut = now;
  const last = heard[heard.length - 1] || null;
  let rhyme = null;
  if (last) {
    for (let k = ends.length - 1; k >= 0 && k >= ends.length - 4; k--) {
      const r = rhymes(last, ends[k].w); if (r) { rhyme = { b: ends[k].w, chain: ends[k].chain + 1, strength: r }; break; }
    }
    if (barEnd || rhyme) { ends.push({ w: last, chain: rhyme ? rhyme.chain : 1 }); if (ends.length > 8) ends.shift(); }
  }
  if (now - lastKw < stepDur() * 4) return;               // he just answered a word of yours; let it land
  if (hype.heat >= 88 && now - lastSig > 25 && go) return signature(nextGrid(now + 0.04, 4));
  if (rhyme && (go || now - Math.max(lastFire, reserved) > stepDur() * 2)) return fireRhyme(p, last, rhyme.b, rhyme.chain, rhyme.strength, t);
  if (!go) return;

  const kw = [...heard].reverse().map(keywordSlug).find(Boolean);
  const repeat = k => lastKinds.length >= 2 && lastKinds.slice(-2).every(x => x === k);
  if (kw && now - lastKw > stepDur() * 6 && rand() < 0.8 && fireVoice(kw, t, { must: true })) { lastKw = now; return; }
  if (last && rand() < 0.85 && fireDouble(p, t, last)) return;
  if (rand() < 0.5 && !repeat('double') && fireDouble(p, t, null)) return;
  if (fireVoice(fresh(GENERIC), t)) return;
  fireDouble(p, t, last);
}

// The specific stuff. The moment he hears a word he has a line for, he answers it on
// the next 8th note, without waiting for the bar to end. Hit the same theme again inside
// thirty seconds and he steps it up; the third time he throws your own word back, big.
const themes = {};
let lastKw = 0;
function onHeard({ w }) {
  if (!hype.live) return;
  const slug = keywordSlug(w); if (!slug) return;
  const now = getCtx().currentTime; if (now < hype.readyAt) return;
  let m = themes[slug]; if (!m || now - m.t > 30) m = themes[slug] = { n: 0, t: 0 };
  if (m.n && now - m.t < 1.0) return;                      // the same word, still on its way through the recognizer
  if (Math.abs(nextGrid(now + 0.03, 2) - Math.max(lastFire, reserved)) < stepDur() * 3) return;   // he is already answering
  if (now - lastKw < stepDur() * 3) return;                // not every single word
  const t = nextGrid(now + 0.03, 2); if (busy(t)) return;
  m.n++; m.t = now; lastKw = now; reserved = t;
  bump(4 + m.n * 3);
  if (m.n >= 3) {
    fx(SLUG_FX[slug] || 'airhorn', t);
    say(slug, t + stepDur() * 2, 0.95);
    show({ kind: 'text', text: `${stretch(w)}! ${w}!`, size: 'xl', echo: true, dur: 0.9, at: t });
    fired('throwback', `${w} x${m.n}`, t); m.n = 0;
  } else fireVoice(slug, t, { size: m.n === 2 ? 'l' : 'm', fx: m.n === 2, must: true });
}

// Mid-flow: when you never leave a gap, he punches in on the "and" of four anyway.
function onStep(abs, t) {
  if (!hype.live) return;
  const s = abs % 16, ctx = getCtx(), sd = stepDur(), bar = sd * 16;
  if (s === 12) {
    const now = ctx.currentTime;
    if (now >= hype.readyAt && ears.inPhrase && now - ears.phraseStart > bar * 1.4 && now - lastFire > bar * 1.6) {
      const at = t + sd * 2;
      setTimeout(() => {
        if (!hype.live || !ears.inPhrase) return;
        const recent = wordsBetween(ctx.currentTime - 2, ctx.currentTime + 0.1).map(x => x.w).filter(isContent);
        const kw = [...recent].reverse().map(keywordSlug).find(Boolean);
        if (kw && fireVoice(kw, at, { vol: 0.8, size: 'm' })) return;
        if (recent.length && rand() < 0.8) { show({ kind: 'text', text: recent[recent.length - 1] + '!', size: 'm', dur: 0.4, at }); fx('stab', at); fired('echo', recent[recent.length - 1], at); return; }
        fireVoice(fresh(PUNCH), at, { vol: 0.75, size: 'm', fx: false });
      }, Math.max(0, (at - now - 0.1) * 1000));
    }
  }
  if (s === 0) {
    const now = ctx.currentTime;
    // you went quiet: one invitation, then he waits
    const quiet = now - Math.max(ears.lastVoiceT, hype.readyAt);
    if (now >= hype.readyAt && !ears.inPhrase && !nudged && quiet > bar * (hype.phrases ? 2.5 : 3) && now - lastNudge > bar * 6) {
      nudged = true; lastNudge = now;
      fireVoice(hype.phrases ? 'talktoem' : 'gooff', t, { fx: false, size: 'm' });
    }
  }
}

// ------------------------------------------------------------------ lifecycle
export function startHype() {
  const ctx = getCtx();
  hype.live = true; hype.heat = 0; hype.fires = 0; hype.phrases = 0; hype.log = [];
  lastFire = 0; lastSig = ctx.currentTime; lastNudge = 0; nudged = false; lastKinds = []; ends = []; wordCut = 0; reserved = 0; lastKw = 0; for (const k in themes) delete themes[k];
  preload(['gooff', 'adlib', ...GENERIC, ...BIG]);
  setTimeout(() => hype.live && preload(Object.keys(PHRASES)), 2500);

  // Count-in: one bar where he listens to the room, counted in dots, then go.
  const sd = stepDur(), now = ctx.currentTime;
  const start = isPlaying() ? timeOfStep(Math.ceil((posAt(now + 0.25)) / 16) * 16) : now + 0.3;
  hype.readyAt = start + sd * 16;
  calibrate(hype.readyAt - 0.05);
  for (let b = 0; b < 4; b++) show({ kind: 'count', text: String(b + 1), at: start + b * sd * 4 });
  setTimeout(() => {
    if (!hype.live) return;
    const t = hype.readyAt;
    fx('airhorn', t);
    const said = say('gooff', t, 1);
    show({ kind: 'text', text: said ? said.text : 'go off!', size: 'l', dur: said ? said.dur : 0.6, at: t });
    note('ready', 'go');
  }, Math.max(0, (hype.readyAt - now - 0.15) * 1000));

  clearInterval(heatTimer);
  let last = ctx.currentTime;
  heatTimer = setInterval(() => {
    const t = ctx.currentTime, dt = t - last; last = t;
    const voiceAgo = t - ears.lastVoiceT;
    hype.heat = clamp(hype.heat - dt * (ears.inPhrase ? 0.8 : voiceAgo < 1.2 ? 1.5 : 6), 0, 100);
    setHang(stepDur() * 0.95);
    setPerf({ on: true, heat: hype.heat, rapping: ears.inPhrase || voiceAgo < 0.35 });
  }, 120);
}
export function stopHype() {
  hype.live = false; clearInterval(heatTimer); hype.heat = 0;
  setPerf({ on: false, heat: 0, rapping: false });
}
export function setMode(mode) { hype.mode = mode; if (hype.live) preload(['gooff', 'adlib', ...GENERIC, ...BIG]); }

onEar('phraseEnd', onPhraseEnd);
onWord(onHeard);
onEar('onset', () => { if (hype.live && getCtx().currentTime >= hype.readyAt) bump(0.5); });
onBeat('step', onStep);
