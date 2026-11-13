// decks.js — the decks toy. One big record: drag it and it scratches the phrase over the
// beat. The drawing is in stage.js; both use layout() so the record you see is the
// record you touch.
import { getCtx, nodes as N, isPlaying } from './engine.js';
import { voice } from './voicekit.js';

const TURN = 1.8;                 // seconds of sound per full turn: a 33⅓ record
export const deck = { on: false, angle: 0, held: false, speed: 0, ready: false };

// where the record sits for a screen of w x h
export function layout(w, h) {
  const T = Math.max(15, Math.min(34, Math.min(w, h) * 0.05));
  const R = Math.max(5 * T, Math.min(w * 0.44, h * 0.3));
  return { cx: w / 2, cy: h * 0.44, R, T };
}

let node = null, out = null, loaded = false, sentBuf = null, fallback = null;
let lastA = 0, turned = 0, lastMove = 0, pointer = null;

async function sound() {
  // the phrase the beat was made from; with no take, adlib saying his name
  if (voice.ready && voice.bufs.word) return voice.bufs.word;
  if (!fallback) fallback = fetch('audio/boom/adlib_1.mp3').then(r => r.arrayBuffer()).then(b => getCtx().decodeAudioData(b)).catch(() => null);
  return fallback;
}

// cut the silence off both ends, so the loop has no gap in it
function trim(d) {
  let peak = 0; for (let i = 0; i < d.length; i++) peak = Math.max(peak, Math.abs(d[i]));
  const th = peak * 0.04; let a = 0, z = d.length - 1;
  while (a < z && Math.abs(d[a]) < th) a++;
  while (z > a && Math.abs(d[z]) < th) z--;
  const out = d.slice(Math.max(0, a - 64), Math.min(d.length, z + 256)), f = Math.min(64, out.length >> 2);
  for (let i = 0; i < f; i++) { out[i] *= i / f; out[out.length - 1 - i] *= i / f; }
  return out;
}
export async function startDeck(el) {
  const ctx = getCtx(); if (!ctx) return;
  if (!loaded) { await ctx.audioWorklet.addModule('js/scratch-worklet.js'); loaded = true; }
  if (!node) {
    node = new AudioWorkletNode(ctx, 'scratch', { numberOfInputs: 0, outputChannelCount: [1] });
    out = ctx.createGain(); out.gain.value = 1.8;
    node.connect(out).connect(N.master);          // straight to the master: the beat's own effects don't touch it
  }
  const b = await sound();
  if (b && b !== sentBuf) { sentBuf = b; node.port.postMessage({ buf: trim(b.getChannelData(0)), rate: b.sampleRate }); }
  deck.ready = !!b; deck.on = true;
  if (!el.dataset.wired) { wire(el); el.dataset.wired = '1'; }
}
export const peek = () => new Promise(res => { if (!node) return res(null); node.port.onmessage = e => res(e.data); node.port.postMessage({ peek: true }); });
export function stopDeck() {
  deck.on = false; release();
}

const angleAt = e => { const r = layout(innerWidth, innerHeight); return Math.atan2(e.clientY - r.cy, e.clientX - r.cx); };
function onRecord(e) { const r = layout(innerWidth, innerHeight); return Math.hypot(e.clientX - r.cx, e.clientY - r.cy) < r.R * 1.18; }

function wire(el) {
  el.addEventListener('pointerdown', e => {
    if (!deck.on || pointer !== null || !onRecord(e)) return;
    e.preventDefault(); pointer = e.pointerId; try { el.setPointerCapture(e.pointerId); } catch {}
    lastA = angleAt(e); turned = 0; lastMove = performance.now();
    deck.held = true; deck.speed = 0;
    // every touch starts the phrase from the top
    if (node) node.port.postMessage({ down: true });
  });
  el.addEventListener('pointermove', e => {
    if (e.pointerId !== pointer) return;
    const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
    for (const ev of evs.length ? evs : [e]) {
      const a = angleAt(ev); let d = a - lastA;
      if (d > Math.PI) d -= 2 * Math.PI; else if (d < -Math.PI) d += 2 * Math.PI;
      lastA = a; turned += d; deck.angle += d;
      const now = performance.now(), dt = Math.max(1, now - lastMove); lastMove = now;
      deck.speed = deck.speed * 0.6 + (d / (2 * Math.PI) * TURN) / (dt / 1000) * 0.4;   // seconds of sound per second
    }
    if (node) node.port.postMessage({ to: (turned / (2 * Math.PI)) * TURN });
  });
  const end = e => { if (e.pointerId === pointer) release(); };
  el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end);
}
function release() {
  if (pointer === null) return;
  pointer = null; deck.held = false; deck.speed = 0;
  if (node) node.port.postMessage({ up: true });
}

// called every frame by the stage: a record turns at speed while the beat plays
// (measured on its own clock, so a slow frame doesn't slow the record)
let lastTick = 0;
export function tickDeck() {
  const now = performance.now(), dt = lastTick ? Math.min(0.5, (now - lastTick) / 1000) : 0; lastTick = now;
  if (!deck.held && isPlaying()) deck.angle += dt * (2 * Math.PI / TURN);
  if (!deck.held) deck.speed *= Math.pow(0.001, dt);
}
