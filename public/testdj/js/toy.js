// toy.js — the pads screen. Six big pads that play themselves: each flashes yellow when the
// beat plays it, and red when you do. Flip them from drums to words (the syllables of your
// phrase). "keep it" puts what you just played into the beat. adlib's face sits in the dock
// as a small record: hold and turn him to scratch the phrase.
// The brief is claude/adlib-toy-brief.md in the project.
import * as engine from './engine.js';
import { song, ROW_LABELS, SCALES, vibe } from './song.js';
import { voice, pads as padCount, playPad, onPadLight, padBuf, padStops, padLength, prerenderPads } from './voicekit.js';
import { clampStop, stepsToSemis } from './bend.js';

const $ = id => document.getElementById(id);
const SLOTS = 6;
const reduced = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
let side = 'drums', phrase = '', built = '', changed = () => {}, wake = async () => {};
let els = [];
const held = new Map();                       // pointer -> { k, el, y0, semis, at, last }
const playedDrums = new Map(), playedWords = new Map();   // absolute 16th -> what you played there
let keptDrums = null;                         // { before, pat, cells } while kept hits sit in the pattern
let stealUntil = -1;                          // adlib's hook steps aside until this 16th while you play words

const ctxNow = () => { const c = engine.getCtx(); return c ? c.currentTime : 0; };
const at = (t, fn) => setTimeout(fn, Math.max(0, (t - ctxNow()) * 1000));
export const wordsReady = () => song.kit === 'you' && voice.ready && padCount() >= 2;
export const toy = { get side() { return side; }, playedDrums, playedWords, get keptDrums() { return keptDrums; } };

// ------------------------------------------------------------------ labels
// the typed phrase split into syllables, used only when the count matches the sound
function syllabify(text, n) {
  const parts = (text.toLowerCase().match(/[a-z']+/g) || []).flatMap(w => w.match(/[^aeiouy]*[aeiouy]+(?:[^aeiouy]*$|[^aeiouy](?=[^aeiouy]))?/g) || [w]);
  return parts.length === n ? parts : null;
}
// a small drawing of one syllable's sound, for when the letters can't be trusted
function wave(k) {
  const b = padBuf(k); if (!b) return '';
  const d = b.getChannelData(0), n = 16, step = Math.max(1, Math.floor(d.length / n)), pk = [];
  let top = 0;
  for (let i = 0; i < n; i++) { let m = 0; for (let j = i * step; j < Math.min(d.length, (i + 1) * step); j++) m = Math.max(m, Math.abs(d[j])); pk.push(m); top = Math.max(top, m); }
  const h = pk.map(v => (top ? v / top : 0));
  const pts = h.map((v, i) => `${(i * 30 / (n - 1)).toFixed(1)},${(10 - v * 9 * (i % 2 ? 1 : -1)).toFixed(1)}`).join(' ');
  return `<svg viewBox="0 0 30 20" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="${pts}"/></svg>`;
}

// ------------------------------------------------------------------ the pads
function buildPads() {
  const box = $('pads'); box.textContent = ''; els = [];
  for (let k = 0; k < SLOTS; k++) {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'pad'; b.dataset.k = k;
    b.innerHTML = '<span class="ptr"></span><span class="lab"></span><span class="semi"></span>';
    box.appendChild(b); els.push(b);
  }
}
export function syncToy() {
  if (!els.length) return;
  if (side === 'words' && !wordsReady()) side = 'drums';
  const n = side === 'words' ? Math.min(SLOTS, padCount()) : SLOTS;
  const key = side + '|' + n + '|' + (voice.pcm ? voice.pcm.length : 0) + '|' + phrase;
  if (key !== built) {
    built = key;
    const labels = side === 'words' ? syllabify(phrase, Math.min(padCount(), 99)) : null;
    els.forEach((el, k) => {
      el.classList.remove('lit', 'you', 'loud', 'held');
      el.classList.toggle('empty', k >= n);
      const lab = el.querySelector('.lab');
      if (k >= n) { lab.innerHTML = ''; el.setAttribute('aria-label', 'empty'); el.tabIndex = -1; return; }
      el.tabIndex = 0;
      if (side === 'drums') { lab.textContent = ROW_LABELS[k]; el.setAttribute('aria-label', ROW_LABELS[k]); }
      else if (labels && labels[k]) { lab.textContent = labels[k]; el.setAttribute('aria-label', labels[k]); }
      else { lab.innerHTML = wave(k); el.setAttribute('aria-label', `syllable ${k + 1}`); }
    });
  }
  for (const b of $('flip').children) {
    b.setAttribute('aria-pressed', b.dataset.side === side);
    if (b.dataset.side === 'words') b.hidden = !wordsReady();
  }
  if (keptDrums && song.pat !== keptDrums.pat) keptDrums = null;     // the pattern was replaced (roll, new take, clear)
  if (wordsReady() && Math.abs(engine.stepDur() - lastSd) > 1e-4) { lastSd = engine.stepDur(); prerenderPads(); }   // lengths re-fit to the tempo
  drawBends();
  const kept = side === 'drums' ? !!keptDrums : !!song.pads;
  const any = side === 'drums' ? playedDrums.size : playedWords.size;
  $('keepBtn').setAttribute('aria-pressed', kept);
  $('keepBtn').disabled = !kept && !any;
}
// after a new take: a fresh phrase, nothing kept, back on drums (the busiest side)
// ------------------------------------------------------------------ the word bend
// On the words side every pad is also a knob for its own word (adlib-word-bend-brief.md): hold it
// and drag, up and down for pitch (steps on the beat's key), sideways for length (five stops, left
// longer). It stays where you leave it. A new take clears every bend.
const bends = new Map();                                    // pad -> { steps, stop }
const bendOf = k => bends.get(k) || { steps: 0, stop: 0 };
const semisFor = steps => { const v = vibe(); return stepsToSemis(steps, voice.f0 || 140, v.key + song.key, SCALES[v.scale] || SCALES.minor); };
const ANGLE = 34;                                           // degrees per length stop, left for longer
function drawBend(k, released) {
  const el = els[k]; if (!el) return;
  const grabbed = !released && [...held.values()].some(h => h.el === el);
  const b = side === 'words' ? bendOf(k) : { steps: 0, stop: 0 }, ptr = el.querySelector('.ptr');
  ptr.style.transform = `rotate(${-b.stop * ANGLE}deg)`;
  ptr.hidden = !(b.steps || b.stop);
  el.style.setProperty('--rs', String(1 + 0.4 * b.stop));    // repeat rings spread wide when long, pack tight when short
  if (side === 'words' && !grabbed) el.querySelector('.semi').textContent = b.steps ? (b.steps > 0 ? '+' : '') + b.steps : '';
  else if (side === 'drums' && !grabbed) el.querySelector('.semi').textContent = '';
}
const drawBends = () => els.forEach((_, k) => drawBend(k));
let lastSd = 0;
export const toyBends = bends;

export function newPhrase(text) {
  bends.clear();
  phrase = text || ''; side = 'drums'; keptDrums = null; song.pads = null;
  playedDrums.clear(); playedWords.clear(); built = ''; syncToy();
  lastSd = engine.stepDur(); setTimeout(prerenderPads, 400);
}

function flash(k, who, loud) {
  const el = els[k]; if (!el || el.classList.contains('empty')) return;
  const cls = who === 'you' ? 'you' : 'lit';
  el.classList.remove('lit', 'you', 'loud'); void el.offsetWidth;
  el.classList.add(cls); if (loud && !reduced) el.classList.add('loud');
  clearTimeout(el._off); el._off = setTimeout(() => el.classList.remove('lit', 'you', 'loud'), who === 'you' ? 150 : 110);
}
function invite(which) {
  const b = [...$('flip').children].find(x => x.dataset.side === which);
  if (!b || b.hidden || reduced) return;
  b.classList.remove('pulse'); void b.offsetWidth; b.classList.add('pulse');
}
const keptCell = (r, t) => keptDrums && keptDrums.cells.has(r + ':' + (((Math.round(engine.posAt(t)) % 16) + 16) % 16));

// ------------------------------------------------------------------ playing
function play(k, t, semis) {
  if (side === 'drums') engine.hitDrum(k, t, 0.9, semis);
  else {
    const b = bendOf(k); playPad(k, t, semisFor(b.steps), b.stop);
    if (engine.isPlaying()) { stealUntil = (Math.floor(engine.posAt(t) / 16) + 1) * 16; engine.decksHook.on = true; }
  }
}
function record(k, t, semis) {
  if (!engine.isPlaying()) return;
  const abs = Math.round(engine.posAt(t));
  if (side === 'drums') { if (!playedDrums.has(abs)) playedDrums.set(abs, new Set()); playedDrums.get(abs).add(k); prune(playedDrums, abs); }
  else { const b = bendOf(k); playedWords.set(abs, [k + 1, semisFor(b.steps), b.stop]); prune(playedWords, abs); }
  if ($('keepBtn').disabled) syncToy();
}
const prune = (m, abs) => { for (const a of m.keys()) if (a <= abs - 64) m.delete(a); };
function fire(k, semis) {
  const now = ctxNow();
  const t = engine.isPlaying() ? engine.nextGrid(now + 0.004, 1) : now;
  play(k, t, semis); record(k, t, semis);
}

// a held word pad is grabbed after a quarter second; from then its finger is a knob
const grab = h => { if (h.grabbed || side !== 'words') return; h.grabbed = true; h.gx = h.cx; h.gy = h.cy; h.moved = false; const b = bendOf(h.k); h.b0 = { ...b }; };
function wirePads() {
  const box = $('pads');
  box.addEventListener('pointerdown', async e => {
    const el = e.target.closest('.pad'); if (!el || el.classList.contains('empty')) return;
    e.preventDefault(); try { box.setPointerCapture(e.pointerId); } catch {}
    await wake();
    const h = { k: +el.dataset.k, el, y0: e.clientY, cx: e.clientX, cy: e.clientY, semis: 0, at: performance.now(), last: -1, grabbed: false };
    held.set(e.pointerId, h); el.classList.add('held');
    fire(h.k, 0);
  });
  const bendMove = h => {
    const dx = h.cx - h.gx, dy = h.cy - h.gy;
    if (!h.moved && Math.hypot(dx, dy) < 12) return;          // a dead zone, so holding to repeat doesn't detune
    h.moved = true;
    const rs = h.b0.steps - dy / 22, rl = h.b0.stop - dx / 40;  // up is higher, left is longer; both magnetic at the middle
    const steps = Math.abs(rs) < 0.6 ? 0 : Math.max(-7, Math.min(7, Math.round(rs)));
    const stops = padStops(h.k), stop = clampStop(Math.abs(rl) < 0.6 ? 0 : Math.max(-2, Math.min(2, Math.round(rl))), stops);
    const was = bendOf(h.k);
    if (steps === was.steps && stop === was.stop) return;
    bends.set(h.k, { steps, stop });
    h.el.querySelector('.semi').textContent = steps ? (steps > 0 ? '+' : '') + steps : '';
    drawBend(h.k);
    if (stop !== was.stop && !reduced) { h.el.classList.remove('click'); void h.el.offsetWidth; h.el.classList.add('click'); }   // a click between stops
  };
  box.addEventListener('pointermove', e => {
    const h = held.get(e.pointerId); if (!h) return;
    h.cx = e.clientX; h.cy = e.clientY;
    if (side === 'words') { if (!h.grabbed && performance.now() - h.at >= 250) grab(h); if (h.grabbed) { bendMove(h); return; } }
    const over = document.elementFromPoint(e.clientX, e.clientY), el = over && over.closest('.pad');
    if (el && el !== h.el && box.contains(el) && !el.classList.contains('empty')) {     // slid across: play the next one
      letGo(h); Object.assign(h, { k: +el.dataset.k, el, y0: e.clientY, semis: 0, at: performance.now(), last: -1, grabbed: false });
      el.classList.add('held'); fire(h.k, 0); return;
    }
    if (side === 'words') return;                            // words bend only once grabbed
    const semis = Math.max(-12, Math.min(12, Math.round((h.y0 - e.clientY) / 22)));
    if (semis !== h.semis) { h.semis = semis; h.el.querySelector('.semi').textContent = semis ? (semis > 0 ? '+' : '') + semis : ''; }
  });
  const up = e => { const h = held.get(e.pointerId); if (!h) return; held.delete(e.pointerId); letGo(h); };
  box.addEventListener('pointerup', up); box.addEventListener('pointercancel', up);
  box.addEventListener('contextmenu', e => e.preventDefault());
  // keyboard: Enter or Space on a focused pad plays it
  box.addEventListener('click', async e => { if (e.detail !== 0) return; const el = e.target.closest('.pad'); if (!el || el.classList.contains('empty')) return; await wake(); fire(+el.dataset.k, 0); });
}
const letGo = h => { h.el.classList.remove('held'); h.el.querySelector('.semi').textContent = ''; if (side === 'words') drawBend(+h.el.dataset.k, h.el); };

// ------------------------------------------------------------------ keep it
function keep() {
  if (side === 'drums') {
    if (keptDrums) { song.pat = keptDrums.before; keptDrums = null; }
    else {
      if (!playedDrums.size) return;
      const last = Math.max(...playedDrums.keys()), before = song.pat.map(r => r.slice()), cells = new Set();
      for (const [a, rows] of playedDrums) if (a > last - 32) for (const r of rows) { song.pat[r][((a % 16) + 16) % 16] = 1; cells.add(r + ':' + (((a % 16) + 16) % 16)); }
      keptDrums = { before, pat: song.pat, cells }; laugh();
    }
  } else {
    if (song.pads) song.pads = null;
    else {
      if (!playedWords.size) return;
      const last = Math.max(...playedWords.keys()), out = new Array(32).fill(null);
      for (const [a, e] of playedWords) if (a > last - 32) out[((a % 32) + 32) % 32] = e;
      song.pads = out; laugh();
    }
  }
  changed();
}

// ------------------------------------------------------------------ adlib's face, the record in the dock
// His six faces, drawn from the measurements in adlib-voice.md (in strokes, y flipped for SVG).
const EYES = {
  relaxed: 'M-3.728-4.39A1.2 1.2 0 0 0-1.472-4.39M1.472-4.39A1.2 1.2 0 0 0 3.728-4.39',
  squeezed: 'M-3.6-5.9L-1.7-4.9L-3.6-3.9M3.6-5.9L1.7-4.9L3.6-3.9',
  up: 'M-3.728-4.51A1.2 1.2 0 0 1-1.472-4.51M1.472-4.51A1.2 1.2 0 0 1 3.728-4.51',
  flat: 'M-3.5-4.9L-1.7-4.9M1.7-4.9L3.5-4.9',
};
const MOUTH = {
  flat: { d: 'M-1.2-0.6L1.2-0.6' },
  small: { c: [0, -0.5, 0.84] },
  big: { c: [0, 0, 2] },
  d: { d: 'M-2-1.1L2-1.1A2 2 0 0 1-2-1.1', c0: [0, -1.1, 2] },
  open: { c: [0, 0.2, 2.2] },
};
const FACES = {
  listening: ['relaxed', 'flat', 0], feeling: ['relaxed', 'small', 4], ooh: ['squeezed', 'small', 9],
  hype: ['squeezed', 'big', 8], laughing: ['up', 'd', 7], speechless: ['flat', 'open', 0],
};
let faceNow = '', faceTemp = null, faceUntil = 0;
function drawFace(name) {
  if (name === faceNow) return; faceNow = name;
  const [eyes, mouth, rings] = FACES[name], m = MOUTH[mouth], svg = $('faceRec');
  const ctr = m.c || m.c0, rr = [];
  for (let k = 0; k < rings && ctr; k++) {
    const r = ctr[2] + 0.96 + 0.5 * k; if (r > 7.6) break;
    const col = k === 0 ? '#FD2D55' : k === 1 ? '#2D54FD' : '#F3EFE6', op = k < 2 ? 1 : Math.max(0.16, 0.75 - (k - 2) * 0.1);
    rr.push(`<circle cx="${ctr[0]}" cy="${ctr[1]}" r="${r}" fill="none" stroke="${col}" stroke-opacity="${op}" stroke-width="0.16"/>`);
  }
  svg.querySelector('.rings').innerHTML = '<circle r="7.7" fill="#0C0B0E" stroke="#979288" stroke-width="0.28"/>' + rr.join('');
  const mouthEl = m.d ? `<path d="${m.d}" fill="none" stroke="#FEE601" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"/>` : `<circle cx="${m.c[0]}" cy="${m.c[1]}" r="${m.c[2]}" fill="none" stroke="#FEE601" stroke-width="1"/>`;
  svg.querySelector('.face').innerHTML = mouthEl +
    `<path d="${EYES[eyes]}" fill="none" stroke="#0C0B0E" stroke-width="1.76" stroke-linecap="round" stroke-linejoin="round"/>` +
    `<path d="${EYES[eyes]}" fill="none" stroke="#FEE601" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"/>`;
}
function showFace(name, secs) { faceTemp = name; faceUntil = performance.now() + secs * 1000; updateFace(); }
const laugh = () => showFace('laughing', Math.max(0.6, engine.stepDur() * 8));
function updateFace() {
  const now = performance.now();
  if (faceTemp && now > faceUntil) faceTemp = null;
  drawFace(rec.held ? 'hype' : faceTemp || (engine.isPlaying() ? 'feeling' : 'listening'));
}

// ------------------------------------------------------------------ scratching him: the phrase, a 16th at a time
const TURN = 1.8, SEMI = Math.pow(2, 1 / 12);
const rec = { held: false, pointer: null, lastA: 0, lastMove: 0, speed: 0, angle: 0 };
let fwd = null, rev = null, srcBuf = null, fallback = null, pos = 0;
async function sound() {
  if (voice.ready && voice.bufs.word) return voice.bufs.word;
  if (!fallback) fallback = fetch('audio/boom/adlib_1.mp3').then(r => r.arrayBuffer()).then(b => engine.getCtx().decodeAudioData(b)).catch(() => null);
  return fallback;
}
function prepare(b) {
  const ctx = engine.getCtx(), d = b.getChannelData(0);
  let peak = 0; for (let i = 0; i < d.length; i++) peak = Math.max(peak, Math.abs(d[i]));
  const th = peak * 0.04; let a = 0, z = d.length - 1;
  while (a < z && Math.abs(d[a]) < th) a++;
  while (z > a && Math.abs(d[z]) < th) z--;
  const out = d.slice(Math.max(0, a - 32), Math.min(d.length, z + 256)), g = peak > 0.001 ? 0.9 / peak : 1;
  for (let i = 0; i < out.length; i++) out[i] *= g;
  fwd = ctx.createBuffer(1, out.length, b.sampleRate); fwd.copyToChannel(out, 0);
  rev = ctx.createBuffer(1, out.length, b.sampleRate); rev.copyToChannel(out.slice().reverse(), 0);
}
function slice(t, at0, rate, len) {
  const ctx = engine.getCtx(), r = Math.abs(rate), buf = rate < 0 ? rev : fwd, n = buf.duration, off = rate < 0 ? n - at0 : at0;
  const src = ctx.createBufferSource(), g = ctx.createGain(), f = ctx.createBiquadFilter();
  src.buffer = buf; src.playbackRate.value = r; f.type = 'highpass'; f.frequency.value = 140;
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.95, t + 0.004);
  g.gain.setValueAtTime(0.95, t + len - 0.006); g.gain.linearRampToValueAtTime(0, t + len);
  src.connect(f).connect(g).connect(engine.nodes.lead);
  src.start(t, Math.max(0, Math.min(n - 0.01, off))); src.stop(t + len + 0.02);
}
function rateFor(speed) {
  let r = 1 + speed * 1.2;
  if (Math.abs(r) < 0.3) r = r < 0 ? -0.3 : 0.3;
  r = Math.max(-2.5, Math.min(2.5, r));
  return Math.sign(r) * Math.pow(SEMI, Math.round(Math.log(Math.abs(r)) / Math.log(SEMI)));
}
const isFlick = speed => Math.abs(speed) > 2.6;
const angleAt = e => { const b = $('faceRec').getBoundingClientRect(); return Math.atan2(e.clientY - (b.top + b.height / 2), e.clientX - (b.left + b.width / 2)); };
function spin() { $('faceRec').querySelector('svg').style.transform = rec.held ? `rotate(${(rec.angle * 180) / Math.PI}deg)` : ''; }

function wireFace() {
  const el = $('faceRec');
  el.addEventListener('pointerdown', async e => {
    if (rec.pointer !== null) return;
    e.preventDefault(); rec.pointer = e.pointerId; try { el.setPointerCapture(e.pointerId); } catch {}
    rec.lastA = angleAt(e); rec.lastMove = performance.now(); rec.speed = 0; rec.angle = 0; rec.held = true; pos = 0;
    el.classList.add('held'); engine.decksHook.on = true; updateFace();
    await wake();
    const b = await sound(); if (b && b !== srcBuf) { srcBuf = b; prepare(b); }
    if (rec.held && !engine.isPlaying()) { engine.play(); changed('play'); }
    tick();
  });
  el.addEventListener('pointermove', e => {
    if (e.pointerId !== rec.pointer) return;
    const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [];
    for (const ev of evs.length ? evs : [e]) {
      const a = angleAt(ev); let da = a - rec.lastA;
      if (da > Math.PI) da -= 2 * Math.PI; else if (da < -Math.PI) da += 2 * Math.PI;
      rec.lastA = a; rec.angle += da;
      const now = performance.now(), dt = Math.max(1, now - rec.lastMove); rec.lastMove = now;
      rec.speed = rec.speed * 0.6 + ((da / (2 * Math.PI)) * TURN) / (dt / 1000) * 0.4;
    }
    spin();
  });
  const end = e => {
    if (e.pointerId !== rec.pointer) return;
    rec.pointer = null; rec.held = false; rec.speed = 0; el.classList.remove('held');
    engine.decksHook.on = engine.isPlaying() && Math.round(engine.posAt(ctxNow())) < stealUntil;
    spin(); updateFace();
  };
  el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end);
  el.addEventListener('contextmenu', e => e.preventDefault());
}
let lastTick = 0;
function tick() {                         // a hand that has stopped moving stops bending
  if (!rec.held) { lastTick = 0; return; }
  const now = performance.now(), dt = lastTick ? Math.min(0.5, (now - lastTick) / 1000) : 0; lastTick = now;
  if (now - rec.lastMove > 60) rec.speed *= Math.pow(0.0005, dt);
  requestAnimationFrame(tick);
}

// ------------------------------------------------------------------ the beat, heard by the pads and the face
function listen() {
  engine.on('hit', (r, t, vel, byYou) => {
    if (r === 0) at(t, () => { const f = $('faceRec'); f.classList.add('nod'); setTimeout(() => f.classList.remove('nod'), 110); });
    if (side === 'drums') { if (r < SLOTS) at(t, () => flash(r, byYou || keptCell(r, t) ? 'you' : 'adlib', vel > 0.85)); }
    else if (r === 0) at(t, () => invite('drums'));
  });
  onPadLight((k, t, who) => {
    if (side === 'words') { if (k < SLOTS) at(t, () => flash(k, who, false)); }
    else if (who === 'adlib' && wordsReady()) at(t, () => invite('words'));
  });
  engine.on('hook', (t, o) => at(t, () => showFace(o && o.half ? 'ooh' : 'hype', o && o.half ? 0.7 : 1.3)));
  engine.on('step', (abs, t) => {
    const now = performance.now();
    for (const h of held.values()) {                        // held: roll on sixteenths (words: at the word's length)
      if (side === 'words' && now - h.at >= 250) grab(h);
      const every = side === 'words' ? Math.max(1, Math.round((padLength(h.k, bendOf(h.k).stop) || 0) / engine.stepDur())) : 1;
      if (now - h.at > 250 && (h.last < 0 || abs - h.last >= every)) { h.last = abs; play(h.k, t, h.semis); record(h.k, t, h.semis); }
    }
    if (rec.held && fwd) {                                  // scratching: the next slice of the phrase
      const sd = engine.stepDur(), n = fwd.duration, rate = rateFor(rec.speed), stut = isFlick(rec.speed);
      if (stut) { slice(t, pos, rate, sd / 2); slice(t + sd / 2, pos, rate, sd / 2); }
      else { slice(t, pos, rate, sd); pos = (((pos + rate * sd) % n) + n) % n; }
    }
    if (!rec.held && stealUntil >= 0 && abs >= stealUntil) { stealUntil = -1; engine.decksHook.on = false; }
  });
  setInterval(updateFace, 120);
}

// ------------------------------------------------------------------ the bar count
// Sixteen dots in fours under the pads. One fills at the start of each bar while the beat plays,
// so whoever is playing or rapping knows where they are in a 16. Empty again when it stops.
let barDots = [], barsLit = -1;
function buildBars() {
  const box = $('barDots'); box.textContent = ''; barDots = [];
  for (let g = 0; g < 4; g++) { const grp = document.createElement('span'); grp.className = 'g'; for (let i = 0; i < 4; i++) { const d = document.createElement('i'); grp.appendChild(d); barDots.push(d); } box.appendChild(grp); }
}
function showBars(n) {
  if (n === barsLit) return; barsLit = n;
  barDots.forEach((d, i) => { d.classList.toggle('on', i < n); d.classList.toggle('now', i === n - 1); });
}

// ------------------------------------------------------------------ setup
export function initToy(opts) {
  changed = opts.changed || changed; wake = opts.wake || wake;
  buildPads(); buildBars(); wirePads(); wireFace(); listen(); drawFace('listening');
  engine.on('step', (abs, t) => { if (abs % 16 === 0) at(t, () => showBars((((abs / 16) % 16) + 16) % 16 + 1)); });
  setInterval(() => { if (!engine.isPlaying()) showBars(0); }, 250);
  for (const b of $('flip').children) b.addEventListener('click', () => { if (b.hidden) return; side = b.dataset.side; built = ''; syncToy(); });
  $('keepBtn').addEventListener('click', keep);
  // desktop: Q W E over A S D plays the six pads
  const KEYS = { q: 0, w: 1, e: 2, a: 3, s: 4, d: 5 };
  document.addEventListener('keydown', async e => {
    if (e.repeat || e.metaKey || e.ctrlKey || e.altKey || e.target.closest('input,textarea,select')) return;
    if (document.body.dataset.view !== 'build' || document.body.dataset.mode !== 'pads' || document.body.hasAttribute('data-start')) return;
    const k = KEYS[e.key.toLowerCase()]; if (k === undefined || !els[k] || els[k].classList.contains('empty')) return;
    e.preventDefault(); await wake(); fire(k, 0);
  });
  syncToy();
}
