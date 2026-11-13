// decks.js — the decks toy. Two records, one under each thumb.
// The top record is your voice: hold it and your phrase plays on the beat a sixteenth at a
// time, in place of the beat's own hook. Turn it to move through the phrase faster or
// slower, up or down in pitch, or backward; flick it and the slice stutters.
// The bottom record is adlib's mouth, and it holds the drums and bass: hold it and the beat
// you grabbed repeats as a roll, turn it to move through the bar so the drums land in a new
// order, pull it back to run them in reverse, flick it to stutter.
// Everything starts on the grid, so whatever the hands do lands in the groove.
// "keep it" keeps the last bar: the voice moves loop in the beat until tapped off, and the
// beat moves are written into the beat itself.
// The drawing is in stage.js; both use layout() so the record you see is the record you touch.
import { getCtx, nodes as N, isPlaying, on as onBeat, stepDur, decksHook, beatDeck } from './engine.js';
import { voice } from './voicekit.js';
import { song, STEPS } from './song.js';

const TURN = 1.8;                 // seconds of sound per full turn: a 33⅓ record
const rec = () => ({ angle: 0, held: false, speed: 0, turned: 0, lastA: 0, lastMove: 0, pointer: null, used: -99 });
export const deck = { on: false, ready: false, kept: false, hits: [], voice: rec(), beat: rec() };

export function layout(w, h) {
  const T = Math.max(14, Math.min(30, Math.min(w, h) * 0.045));
  const R = Math.max(4 * T, Math.min(w * 0.36, h * 0.17));
  return { T, R, voice: { cx: w / 2, cy: h * 0.25 }, beat: { cx: w / 2, cy: h * 0.69 } };
}

let fwd = null, rev = null, fallback = null, srcBuf = null;
let keepBtn = null;
let pos = 0;                                   // where in the phrase the needle is, in seconds
const recent = [], kept = [];                  // the last 16 steps played, and the bar being looped

// ------------------------------------------------------------------ the sound
async function sound() {
  if (voice.ready && voice.bufs.word) return voice.bufs.word;
  if (!fallback) fallback = fetch('audio/boom/adlib_1.mp3').then(r => r.arrayBuffer()).then(b => getCtx().decodeAudioData(b)).catch(() => null);
  return fallback;
}
// trim silence off both ends and make a reversed copy, so the phrase starts on the hit
function prepare(b) {
  const ctx = getCtx(), d = b.getChannelData(0);
  let peak = 0; for (let i = 0; i < d.length; i++) peak = Math.max(peak, Math.abs(d[i]));
  const th = peak * 0.04; let a = 0, z = d.length - 1;
  while (a < z && Math.abs(d[a]) < th) a++;
  while (z > a && Math.abs(d[z]) < th) z--;
  const out = d.slice(Math.max(0, a - 32), Math.min(d.length, z + 256)), g = peak > 0.001 ? 0.9 / peak : 1;
  for (let i = 0; i < out.length; i++) out[i] *= g;
  fwd = ctx.createBuffer(1, out.length, b.sampleRate); fwd.copyToChannel(out, 0);
  rev = ctx.createBuffer(1, out.length, b.sampleRate); rev.copyToChannel(out.slice().reverse(), 0);
}

// one slice of the phrase: from `at` seconds in, at `rate` (negative runs it backward)
function slice(t, at, rate, len) {
  const ctx = getCtx(), r = Math.abs(rate), buf = rate < 0 ? rev : fwd, n = buf.duration;
  const off = rate < 0 ? n - at : at;
  const src = ctx.createBufferSource(), g = ctx.createGain(), f = ctx.createBiquadFilter();
  src.buffer = buf; src.playbackRate.value = r;
  f.type = 'highpass'; f.frequency.value = 140;
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.95, t + 0.004);
  g.gain.setValueAtTime(0.95, t + len - 0.006); g.gain.linearRampToValueAtTime(0, t + len);
  src.connect(f).connect(g).connect(N.lead);
  src.start(t, Math.max(0, Math.min(n - 0.01, off))); src.stop(t + len + 0.02);
  deck.hits.push(t);
}

// the hand, read as a playback rate: still is normal speed; snapped to semitones
const SEMI = Math.pow(2, 1 / 12);
export function rateFor(speed) {
  let r = 1 + speed * 1.2;
  if (Math.abs(r) < 0.3) r = r < 0 ? -0.3 : 0.3;
  r = Math.max(-2.5, Math.min(2.5, r));
  const st = Math.round(Math.log(Math.abs(r)) / Math.log(SEMI));
  return Math.sign(r) * Math.pow(SEMI, st);
}
export const isFlick = speed => Math.abs(speed) > 2.6;

// every 16th, while the record is held (or a kept bar is looping), play the next slice
function onStep(abs, t) {
  if (!deck.on || !fwd) return;
  const v = deck.voice, s = abs % 16, sd = stepDur(), n = fwd.duration;
  if (v.held) v.used = abs;
  let ev = null;
  if (v.held) {
    const rate = rateFor(v.speed), stut = isFlick(v.speed);
    ev = { at: pos, rate, stut };
    pos = (((pos + (stut ? 0 : rate * sd)) % n) + n) % n;
  } else if (deck.kept && kept[s]) ev = kept[s];
  recent[s] = v.held ? ev : null;
  if (!ev) return;
  if (ev.stut) { slice(t, ev.at, ev.rate, sd / 2); slice(t + sd / 2, ev.at, ev.rate, sd / 2); }
  else slice(t, ev.at, ev.rate, sd);
}

// The beat record. While held, each step of the drums and bass plays from somewhere else in
// the bar: a one-beat window from where you grabbed it, repeating (a roll), slid along the
// bar as you turn the record (a full turn is a whole bar), played backward when you pull
// back, stuttered when you flick.
let anchor = 0, since = 0;
const recentBeat = [];
function beatMap(abs) {
  const b = deck.beat, s = abs % STEPS;
  if (!b.held) { recentBeat[s] = null; return null; }
  if (since < 0) { since = 0; anchor = s - (s % 4); }
  const w = since++ % 4, back = b.speed < -0.4;
  const off = Math.round((b.turned / (2 * Math.PI)) * STEPS);
  const src = ((anchor + off + (back ? 3 - w : w)) % STEPS + STEPS) % STEPS;
  const ev = { src, stut: isFlick(b.speed) };
  recentBeat[s] = ev; b.used = abs;
  return ev;
}

// ------------------------------------------------------------------ on and off
let onRewrite = () => {};
export async function startDeck(el, btn, rewrote) {
  const ctx = getCtx(); if (!ctx) return;
  if (rewrote) onRewrite = rewrote;
  const b = await sound();
  if (b && b !== srcBuf) { srcBuf = b; prepare(b); deck.kept = false; kept.length = 0; }
  deck.ready = !!fwd; deck.on = true; beatDeck.map = beatMap;
  if (!el.dataset.wired) { wire(el); onBeat('step', onStep); el.dataset.wired = '1'; }
  keepBtn = btn; if (btn && !btn.dataset.wired) { btn.addEventListener('click', keep); btn.dataset.wired = '1'; }
  sync();
}
export function stopDeck() { deck.on = false; release('voice'); release('beat'); beatDeck.map = null; deck.kept = false; kept.length = 0; sync(); }

// keep the last bar of whichever records were played in it
function keep() {
  const now = lastStep(), fresh = r => now - deck[r].used <= STEPS;
  let did = false;
  if (fresh('beat') && recentBeat.some(Boolean)) {
    // the drums and bass, rewritten in the order you just played them
    const old = song.pat.map(row => row.slice());
    for (let s = 0; s < STEPS; s++) { const ev = recentBeat[s]; if (ev) for (let r = 0; r < 7; r++) song.pat[r][s] = old[r][ev.src]; }
    recentBeat.length = 0; deck.beat.used = -99; did = true; onRewrite();
  }
  if (deck.kept && !did) { deck.kept = false; kept.length = 0; return sync(); }
  if (fresh('voice') && recent.some(Boolean)) { for (let s = 0; s < 16; s++) kept[s] = recent[s] || null; deck.kept = true; did = true; }
  if (did) flash();
  sync();
}
let stepNow = 0; onBeat('step', abs => { stepNow = abs; });
const lastStep = () => stepNow;
function flash() { if (!keepBtn) return; keepBtn.classList.remove('kept'); void keepBtn.offsetWidth; keepBtn.classList.add('kept'); }
function sync() {
  decksHook.on = deck.on && (deck.voice.held || deck.kept);
  if (keepBtn) keepBtn.setAttribute('aria-pressed', String(deck.kept));
}

// ------------------------------------------------------------------ the hands
const which = e => {
  const L = layout(innerWidth, innerHeight);
  for (const r of ['voice', 'beat']) if (Math.hypot(e.clientX - L[r].cx, e.clientY - L[r].cy) < L.R * 1.2) return r;
  return null;
};
const angleAt = (e, r) => { const L = layout(innerWidth, innerHeight); return Math.atan2(e.clientY - L[r].cy, e.clientX - L[r].cx); };
const owner = id => (deck.voice.pointer === id ? 'voice' : deck.beat.pointer === id ? 'beat' : null);

function wire(el) {
  el.addEventListener('pointerdown', e => {
    const r = deck.on && which(e); if (!r || deck[r].pointer !== null) return;
    const d = deck[r];
    e.preventDefault(); d.pointer = e.pointerId; try { el.setPointerCapture(e.pointerId); } catch {}
    d.lastA = angleAt(e, r); d.lastMove = performance.now(); d.held = true; d.speed = 0; d.turned = 0;
    if (r === 'voice') pos = 0;                   // every touch starts the phrase from the top
    else since = -1;                              // and the beat from the beat you're on
    sync();
  });
  el.addEventListener('pointermove', e => {
    const r = owner(e.pointerId); if (!r) return;
    const d = deck[r], evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [];
    for (const ev of evs.length ? evs : [e]) {
      const a = angleAt(ev, r); let da = a - d.lastA;
      if (da > Math.PI) da -= 2 * Math.PI; else if (da < -Math.PI) da += 2 * Math.PI;
      d.lastA = a; d.angle += da; d.turned += da;
      const now = performance.now(), dt = Math.max(1, now - d.lastMove); d.lastMove = now;
      d.speed = d.speed * 0.6 + (da / (2 * Math.PI) * TURN) / (dt / 1000) * 0.4;   // seconds of sound per second
    }
  });
  const end = e => { const r = owner(e.pointerId); if (r) release(r); };
  el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end);
}
function release(r) {
  const d = deck[r]; if (d.pointer === null) return;
  d.pointer = null; d.held = false; d.speed = 0; sync();
}

// every frame: records turn at speed while the beat plays, and a hand that has stopped
// moving stops bending (on its own clock, so a slow frame changes nothing)
let lastTick = 0;
export function tickDeck() {
  const now = performance.now(), dt = lastTick ? Math.min(0.5, (now - lastTick) / 1000) : 0; lastTick = now;
  for (const r of ['voice', 'beat']) {
    const d = deck[r];
    if (!d.held && isPlaying()) d.angle += dt * (2 * Math.PI / TURN);
    if (!d.held || now - d.lastMove > 60) d.speed *= Math.pow(0.0005, dt);
  }
}
