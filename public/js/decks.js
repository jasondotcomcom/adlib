// decks.js — the decks toy. One big record: hold it and your phrase plays on the beat,
// a sixteenth at a time, in place of the beat's own hook. Turn the record and you move
// through the phrase faster or slower, up or down in pitch, or backward; flick it and the
// slice stutters. Every slice starts on the grid, so whatever the hand does lands in the
// groove. "keep it" captures the last bar of moves and loops it as part of the beat.
// The drawing is in stage.js; both use layout() so the record you see is the record you touch.
import { getCtx, nodes as N, isPlaying, on as onBeat, stepDur, decksHook } from './engine.js';
import { voice } from './voicekit.js';

const TURN = 1.8;                 // seconds of sound per full turn: a 33⅓ record
export const deck = { on: false, angle: 0, held: false, speed: 0, ready: false, kept: false, hits: [] };

export function layout(w, h) {
  const T = Math.max(15, Math.min(34, Math.min(w, h) * 0.05));
  const R = Math.max(5 * T, Math.min(w * 0.44, h * 0.27));
  return { cx: w / 2, cy: h * 0.4, R, T };
}

let fwd = null, rev = null, fallback = null, srcBuf = null;
let lastA = 0, lastMove = 0, pointer = null, keepBtn = null;
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
  const s = abs % 16, sd = stepDur(), n = fwd.duration;
  let ev = null;
  if (deck.held) {
    const rate = rateFor(deck.speed), stut = isFlick(deck.speed);
    ev = { at: pos, rate, stut };
    pos = (((pos + (stut ? 0 : rate * sd)) % n) + n) % n;
  } else if (deck.kept && kept[s]) ev = kept[s];
  recent[s] = deck.held ? ev : null;
  if (!ev) return;
  if (ev.stut) { slice(t, ev.at, ev.rate, sd / 2); slice(t + sd / 2, ev.at, ev.rate, sd / 2); }
  else slice(t, ev.at, ev.rate, sd);
}

// ------------------------------------------------------------------ on and off
export async function startDeck(el, btn) {
  const ctx = getCtx(); if (!ctx) return;
  const b = await sound();
  if (b && b !== srcBuf) { srcBuf = b; prepare(b); deck.kept = false; kept.length = 0; }
  deck.ready = !!fwd; deck.on = true;
  if (!el.dataset.wired) { wire(el); onBeat('step', onStep); el.dataset.wired = '1'; }
  keepBtn = btn; if (btn && !btn.dataset.wired) { btn.addEventListener('click', keep); btn.dataset.wired = '1'; }
  sync();
}
export function stopDeck() { deck.on = false; release(); deck.kept = false; kept.length = 0; sync(); }

function keep() {
  if (deck.kept) { deck.kept = false; kept.length = 0; return sync(); }
  if (!recent.some(Boolean)) return;            // nothing played in the last bar
  for (let s = 0; s < 16; s++) kept[s] = recent[s] || null;
  deck.kept = true; sync();
}
function sync() {
  decksHook.on = deck.on && (deck.held || deck.kept);
  if (keepBtn) keepBtn.setAttribute('aria-pressed', String(deck.kept));
}

// ------------------------------------------------------------------ the hand
const angleAt = e => { const r = layout(innerWidth, innerHeight); return Math.atan2(e.clientY - r.cy, e.clientX - r.cx); };
function onRecord(e) { const r = layout(innerWidth, innerHeight); return Math.hypot(e.clientX - r.cx, e.clientY - r.cy) < r.R * 1.18; }

function wire(el) {
  el.addEventListener('pointerdown', e => {
    if (!deck.on || pointer !== null || !onRecord(e)) return;
    e.preventDefault(); pointer = e.pointerId; try { el.setPointerCapture(e.pointerId); } catch {}
    lastA = angleAt(e); lastMove = performance.now();
    deck.held = true; deck.speed = 0; pos = 0;      // every touch starts the phrase from the top
    sync();
  });
  el.addEventListener('pointermove', e => {
    if (e.pointerId !== pointer) return;
    const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [];
    for (const ev of evs.length ? evs : [e]) {
      const a = angleAt(ev); let d = a - lastA;
      if (d > Math.PI) d -= 2 * Math.PI; else if (d < -Math.PI) d += 2 * Math.PI;
      lastA = a; deck.angle += d;
      const now = performance.now(), dt = Math.max(1, now - lastMove); lastMove = now;
      deck.speed = deck.speed * 0.6 + (d / (2 * Math.PI) * TURN) / (dt / 1000) * 0.4;   // seconds of sound per second
    }
  });
  const end = e => { if (e.pointerId === pointer) release(); };
  el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end);
}
function release() {
  if (pointer === null) return;
  pointer = null; deck.held = false; deck.speed = 0; sync();
}

// every frame: a record turns at speed while the beat plays, and a hand that has
// stopped moving stops bending (measured on its own clock, so a slow frame changes nothing)
let lastTick = 0;
export function tickDeck() {
  const now = performance.now(), dt = lastTick ? Math.min(0.5, (now - lastTick) / 1000) : 0; lastTick = now;
  if (!deck.held && isPlaying()) deck.angle += dt * (2 * Math.PI / TURN);
  if (!deck.held || now - lastMove > 60) deck.speed *= Math.pow(0.0005, dt);
}
