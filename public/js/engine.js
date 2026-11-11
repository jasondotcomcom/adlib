// engine.js — the sound. One AudioContext, a real mix bus, a sample-accurate
// clock, and instruments that read the song in song.js.
import { song, vibe, chordFor, melody, hash, ROWS, STEPS } from './song.js';

let ctx = null;
const N = {};            // audio nodes by name
const kit = {};          // sample name -> AudioBuffer
const listeners = { step: [], hit: [] };
export const on = (ev, fn) => listeners[ev].push(fn);
const emit = (ev, ...a) => { for (const fn of listeners[ev]) fn(...a); };

export const getCtx = () => ctx;
export const nodes = N;
export const mtof = m => 440 * Math.pow(2, (m - 69) / 12);

// What the performance is doing right now. The hype brain writes this.
export const perf = { on: false, heat: 0, rapping: false, dropUntilStep: -1 };

// Recent kick/snare times, so the ears can tell our own beat from a voice.
export const drumLog = [];

// ------------------------------------------------------------------ graph
function tanhCurve(drive, levels = 0) {
  const n = 2048, c = new Float32Array(n), norm = Math.tanh(drive);
  for (let i = 0; i < n; i++) {
    let x = (i / (n - 1)) * 2 - 1;
    let y = Math.tanh(x * drive) / norm;
    if (levels) y = Math.round(y * levels) / levels;      // bit-depth grit for the dusty kit
    c[i] = y;
  }
  return c;
}
function makeIR(seconds, damp) {
  const len = Math.floor(ctx.sampleRate * seconds), buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch); let lp = 0;
    for (let i = 0; i < len; i++) {
      const t = i / len, env = Math.pow(1 - t, 2.6);
      lp += ((Math.random() * 2 - 1) - lp) * (damp + (1 - damp) * (1 - t) * 0.5);
      d[i] = lp * env;
    }
  }
  return buf;
}
const gain = v => { const g = ctx.createGain(); g.gain.value = v; return g; };

export async function initAudio() {
  if (ctx) { if (ctx.state !== 'running') await ctx.resume().catch(() => {}); return ctx; }
  const AC = window.AudioContext || window.webkitAudioContext;
  ctx = new AC({ latencyHint: 'interactive' });

  N.master = gain(0.62);
  N.limiter = ctx.createDynamicsCompressor();
  Object.assign(N.limiter.threshold, { value: -5 }); N.limiter.knee.value = 3; N.limiter.ratio.value = 18;
  N.limiter.attack.value = 0.002; N.limiter.release.value = 0.14;
  N.out = gain(0.8);
  N.analyser = ctx.createAnalyser(); N.analyser.fftSize = 1024; N.analyser.smoothingTimeConstant = 0.7;
  N.master.connect(N.limiter).connect(N.out).connect(ctx.destination);
  N.out.connect(N.analyser);

  N.beat = gain(1);                        // everything that is "the beat"
  N.beat.connect(N.master);

  // drums: saturation -> tone -> glue
  N.drums = gain(0.95);
  N.drumSat = ctx.createWaveShaper(); N.drumSat.oversample = '2x';
  N.drumTone = ctx.createBiquadFilter(); N.drumTone.type = 'lowpass'; N.drumTone.frequency.value = 16000; N.drumTone.Q.value = 0.4;
  N.drumComp = ctx.createDynamicsCompressor();
  N.drumComp.threshold.value = -16; N.drumComp.knee.value = 8; N.drumComp.ratio.value = 3.5;
  N.drumComp.attack.value = 0.012; N.drumComp.release.value = 0.16;
  N.drumOut = gain(1.1);
  N.drums.connect(N.drumSat).connect(N.drumTone).connect(N.drumComp).connect(N.drumOut).connect(N.beat);

  // music: sidechain duck -> filter that opens with heat
  N.music = gain(0.8);
  N.duck = gain(1);
  N.musicFilter = ctx.createBiquadFilter(); N.musicFilter.type = 'lowpass'; N.musicFilter.frequency.value = 16000; N.musicFilter.Q.value = 0.5;
  N.music.connect(N.duck).connect(N.musicFilter).connect(N.beat);
  N.lead = gain(1); N.lead.connect(N.music);

  // bass: its own saturation so an 808 still reads on a phone speaker
  N.bass = gain(0.9);
  N.bassSat = ctx.createWaveShaper(); N.bassSat.curve = tanhCurve(2.6); N.bassSat.oversample = '2x';
  N.bassDuck = gain(1);
  N.bass.connect(N.bassSat).connect(N.bassDuck).connect(N.beat);

  // reverb send
  N.rev = ctx.createConvolver(); N.rev.buffer = makeIR(1.7, 0.35);
  N.revOut = gain(0.9); N.rev.connect(N.revOut).connect(N.beat);
  N.musicSend = gain(0.16); N.musicFilter.connect(N.musicSend).connect(N.rev);
  N.leadSend = gain(0.3); N.lead.connect(N.leadSend).connect(N.rev);
  N.drumSend = gain(0.05); N.drumOut.connect(N.drumSend).connect(N.rev);

  // the hype man's own bus: never ducked, never filtered
  N.hype = gain(1); N.hype.connect(N.master);
  N.hypeSend = gain(0.12); N.hype.connect(N.hypeSend).connect(N.rev);

  // vinyl crackle bed
  N.crackle = gain(0); N.crackle.connect(N.beat);
  startCrackle();

  applyKit();
  loadKit();
  startTimer();
  return ctx;
}

const KIT_FILES = ['kick', 'deep', 'snare', 'clap', 'hat', 'ohat', 'rim', 'keys_48', 'keys_60', 'keys_72'];
let kitPromise = null;
export function loadKit() {
  if (kitPromise) return kitPromise;
  kitPromise = Promise.all(KIT_FILES.map(async name => {
    try {
      const r = await fetch(`audio/kit/${name}.wav`); if (!r.ok) return;
      kit[name] = await ctx.decodeAudioData(await r.arrayBuffer());
    } catch { /* synth fallback covers it */ }
  }));
  return kitPromise;
}

const KIT_FX = {
  clean: { drive: 1.6, levels: 0, tone: 16000, rate: 1, crackle: 0 },
  dusty: { drive: 2.6, levels: 96, tone: 7800, rate: 0.94, crackle: 0.5 },
  crunch: { drive: 4.2, levels: 40, tone: 11000, rate: 1.03, crackle: 0 },
};
export function applyKit() {
  if (!ctx) return;
  const k = KIT_FX[song.kit] || KIT_FX.clean, t = ctx.currentTime;
  N.drumSat.curve = tanhCurve(k.drive, k.levels);
  N.drumTone.frequency.setTargetAtTime(k.tone, t, 0.05);
  N.crackle.gain.setTargetAtTime((vibe().crackle || song.kit === 'dusty') ? k.crackle * 0.6 + (vibe().crackle ? 0.3 : 0) : 0, t, 0.2);
}

function startCrackle() {
  const len = ctx.sampleRate * 3, buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * 0.012;
  for (let k = 0; k < 70; k++) {                       // pops
    const at = Math.floor(Math.random() * (len - 200)), a = 0.15 + Math.random() * 0.5;
    for (let j = 0; j < 60; j++) d[at + j] += (Math.random() * 2 - 1) * a * Math.exp(-j / 9);
  }
  const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
  const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 2800; bp.Q.value = 0.4;
  src.connect(bp).connect(N.crackle); src.start();
}

// ------------------------------------------------------------------ clock
let nextStep = 0, nextTime = 0, playing = false, timer = null;
export const isPlaying = () => playing;
export const stepDur = () => 60 / song.bpm / 4;
const swingOffset = () => ((song.swing - 50) / 50) * stepDur();

// absolute step position (float) at an audio time
export const posAt = t => nextStep + (t - nextTime) / stepDur();
// time of the next grid line at or after t. div is in 16th steps (2 = 8th note)
export function nextGrid(t, div = 2) {
  const pos = posAt(t), g = Math.ceil(pos / div - 1e-6) * div;
  return nextTime + (g - nextStep) * stepDur() + (g % 2 ? swingOffset() : 0);
}
export const timeOfStep = abs => nextTime + (abs - nextStep) * stepDur();

function startTimer() {
  if (timer) return;
  // A worker keeps ticking when the tab is in the background; setInterval does not.
  try {
    const w = new Worker(URL.createObjectURL(new Blob(['setInterval(()=>postMessage(0),25)'], { type: 'text/javascript' })));
    w.onmessage = tick; timer = w;
  } catch { timer = setInterval(tick, 25); }
}
function tick() {
  if (!playing || !ctx) return;
  const ahead = ctx.currentTime + 0.13;
  let guard = 0;
  while (nextTime < ahead && guard++ < 64) {
    if (nextTime > ctx.currentTime - 0.05) scheduleStep(nextStep, nextTime);
    nextTime += stepDur(); nextStep++;
  }
}
export function play() {
  if (!ctx || playing) return;
  nextStep = 0; nextTime = ctx.currentTime + 0.06; playing = true; lastBass = null; tick();
}
export function stop() {
  playing = false;
  if (ctx) { const t = ctx.currentTime; N.beat.gain.cancelScheduledValues(t); N.beat.gain.setValueAtTime(1, t); }
}

// ------------------------------------------------------------------ step
const HAT_ACC = [1, 0.42, 0.7, 0.42];
function scheduleStep(abs, time) {
  const s = abs % STEPS, bar = Math.floor(abs / STEPS), b4 = bar % 4, v = vibe(), sd = stepDur();
  const t = time + (s % 2 ? swingOffset() : 0);
  emit('step', abs, t);

  const heat = perf.on ? perf.heat : 0;
  // punchline space: at the end of every 4th bar, when it is hot, the drums step back
  const dropping = perf.on && heat > 55 && b4 === 3 && s >= 14;
  const landing = perf.on && heat > 55 && b4 === 0 && s === 0 && bar > 0;
  const fill = b4 === 3;

  // ---- drums
  for (let r = 0; r < 6; r++) {
    let hit = song.pat[r][s];
    if (r === 1 && fill && s === 15 && !hit && song.pat[1].some(Boolean) && hash(bar, 15, song.seed) < 0.45) hit = 0.55;   // ghost snare into the turn
    if (r === 3 && !hit && heat > 75 && song.pat[3].some(Boolean) && s % 2) hit = 0.3;                                        // hats fill in when it is hot
    if (r === 4 && !hit && heat > 60 && fill && s === 14) hit = 0.8;
    if (!hit) continue;
    if (dropping && r !== 4) continue;
    let vel = hit === 1 ? 1 : hit;
    let when = t;
    if (r === 0) vel *= s % 8 === 0 ? 1 : 0.86;
    if (r === 1 && v.lazy) when += 0.007;
    if (r === 3) { vel *= HAT_ACC[s % 4] * (0.9 + Math.random() * 0.2); when += (Math.random() - 0.5) * 0.006; }
    if (r === 5) { vel *= 0.75; when += (Math.random() - 0.5) * 0.006; }
    drum(r, when, vel);
    // hat rolls
    if (r === 3 && v.rolls && song.pat[3][s]) {
      const roll = hash(bar % 4, s, song.seed + 5), chance = 0.1 + heat / 220;
      if (roll < chance) {
        const n = roll < chance / 3 ? 3 : 2;
        for (let k = 1; k < n; k++) drum(3, t + (sd * k) / n, 0.35 + 0.2 * (k / n));
      }
    }
  }
  if (landing) { crash(t, 0.5); if (kit.deep) sample('deep', t, 0.7, 1, N.drums); }

  // ---- bass
  if (song.pat[6][s] && !dropping) {
    let len = 1; while (len < 8 && !song.pat[6][(s + len) % STEPS]) len++;
    const ch = chordFor(bar), alt = s % 4 !== 0 && hash(bar % 4, s, song.seed + 11) < 0.22;
    if (v.bass === '808') bass808(ch.bass808 + (alt ? 12 : 0), t, len * sd, 1, v.glide);
    else bassRound(ch.bassRound + (alt ? 7 : 0), t, Math.min(len, 3) * sd, v.glide);
  }

  // ---- keys
  if (song.keys) {
    const ch = chordFor(bar);
    for (const [cs, len, vel] of v.comp) if (cs === s) ch.keys.forEach((m, i) => key(m, t + i * 0.012, len * sd, vel * (i === 3 ? 0.7 : 1)));
    if (v.pad && s === 0) pad(ch.pad, t, STEPS * sd);
  }

  // ---- lead (4-bar line)
  if (song.lead) {
    const at = b4 * STEPS + s;
    for (const n of melody()) if (n.s === at) lead(n.midi, t, n.len * sd, v.lead);
  }
}

// ------------------------------------------------------------------ drums
const DRUM_SAMPLE = ['kick', 'snare', 'clap', 'hat', 'ohat', 'rim'];
function sample(name, t, vel, rate, dest) {
  const src = ctx.createBufferSource(); src.buffer = kit[name]; src.playbackRate.value = rate;
  const g = gain(vel); src.connect(g).connect(dest); src.start(t);
  return { src, g };
}
let openHat = null;
function drum(r, t, vel) {
  const name = DRUM_SAMPLE[r], k = KIT_FX[song.kit] || KIT_FX.clean;
  emit('hit', r, t, vel);
  if (r <= 2) { drumLog.push({ t, r }); if (drumLog.length > 64) drumLog.shift(); }
  if (r === 0) sidechain(t);
  if (r === 3 && openHat) { openHat.g.gain.setTargetAtTime(0, t, 0.012); openHat = null; }    // closed hat chokes the open one
  if (kit[name]) {
    const level = [1, 0.85, 0.7, 0.34, 0.36, 0.55][r];
    const rate = k.rate * (r === 3 ? 0.98 + Math.random() * 0.04 : 1);
    const h = sample(name, t, vel * level, rate, N.drums);
    if (r === 4) openHat = h;
    return;
  }
  synthDrum(r, t, vel);
}
function noise(dur) {
  const b = ctx.createBuffer(1, Math.floor(ctx.sampleRate * dur), ctx.sampleRate), d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  const s = ctx.createBufferSource(); s.buffer = b; return s;
}
function synthDrum(r, t, vel) {
  if (r === 0) {
    const o = ctx.createOscillator(), g = gain(0);
    o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(48, t + 0.09);
    g.gain.setValueAtTime(vel, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
    o.connect(g).connect(N.drums); o.start(t); o.stop(t + 0.32);
  } else {
    const dur = [0, 0.18, 0.16, 0.04, 0.2, 0.03][r], s = noise(dur), f = ctx.createBiquadFilter(), g = gain(0);
    f.type = r <= 2 ? 'bandpass' : 'highpass'; f.frequency.value = [0, 1800, 1400, 8000, 7000, 2500][r];
    g.gain.setValueAtTime(vel * 0.6, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    s.connect(f).connect(g).connect(N.drums); s.start(t);
  }
}
function crash(t, vel) {
  const s = noise(1.4), f = ctx.createBiquadFilter(), g = gain(0);
  f.type = 'highpass'; f.frequency.value = 5200;
  g.gain.setValueAtTime(vel * 0.3, t); g.gain.exponentialRampToValueAtTime(0.001, t + 1.3);
  s.connect(f).connect(g).connect(N.drums); s.start(t);
}
function sidechain(t) {
  for (const [g, depth, rel] of [[N.duck.gain, 0.45, 0.22], [N.bassDuck.gain, 0.72, 0.12]]) {
    g.cancelScheduledValues(t); g.setValueAtTime(depth, t); g.linearRampToValueAtTime(1, t + rel);
  }
}
export function audition(row) {
  if (!ctx) return;
  const t = ctx.currentTime + 0.01;
  if (row < 6) drum(row, t, 1);
  else { const ch = chordFor(0); vibe().bass === '808' ? bass808(ch.bass808, t, 0.4, 1, false) : bassRound(ch.bassRound, t, 0.25, false); }
}

// ------------------------------------------------------------------ bass
let lastBass = null;
function bass808(midi, t, dur, vel, glide) {
  const f = mtof(midi), o = ctx.createOscillator(), g = gain(0);
  o.type = 'sine';
  const ringing = lastBass && lastBass.end > t + 0.005;
  if (lastBass) { lastBass.g.gain.cancelScheduledValues(t); lastBass.g.gain.setTargetAtTime(0, t, 0.012); lastBass.o.stop(t + 0.15); }
  if (glide && ringing && lastBass.f !== f) {
    o.frequency.setValueAtTime(lastBass.f, t); o.frequency.exponentialRampToValueAtTime(f, t + 0.085);      // the slide
  } else {
    o.frequency.setValueAtTime(f * 2.4, t); o.frequency.exponentialRampToValueAtTime(f, t + 0.045);         // the knock
  }
  const hold = Math.max(0.12, dur * 0.85);
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vel * 0.95, t + 0.004);
  g.gain.setValueAtTime(vel * 0.95, t + hold * 0.5); g.gain.setTargetAtTime(0, t + hold * 0.5, Math.max(0.06, hold * 0.3));
  o.connect(g).connect(N.bass);
  o.start(t); const end = t + hold + 0.9; o.stop(end);
  lastBass = { o, g, f, end: t + hold };
}
function bassRound(midi, t, dur, glide) {
  const f = mtof(midi), o1 = ctx.createOscillator(), o2 = ctx.createOscillator(), lp = ctx.createBiquadFilter(), g = gain(0);
  o1.type = 'sawtooth'; o2.type = 'sine';
  if (glide && lastBass && lastBass.f !== f && lastBass.end > t - 0.12) {
    for (const o of [o1, o2]) { o.frequency.setValueAtTime(lastBass.f, t); o.frequency.exponentialRampToValueAtTime(f, t + 0.06); }
  } else { o1.frequency.value = f; o2.frequency.value = f; }
  lp.type = 'lowpass'; lp.Q.value = 2; lp.frequency.setValueAtTime(900, t); lp.frequency.exponentialRampToValueAtTime(260, t + 0.16);
  const d = Math.max(0.14, dur);
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.62, t + 0.006); g.gain.setTargetAtTime(0, t + d * 0.7, 0.07);
  const g1 = gain(0.45); o1.connect(g1).connect(lp); o2.connect(lp); lp.connect(g).connect(N.bass);
  const end = t + d + 0.5; o1.start(t); o2.start(t); o1.stop(end); o2.stop(end);
  lastBass = { o: o1, g, f, end: t + d };
}

// ------------------------------------------------------------------ keys, pad, lead
function key(midi, t, dur, vel, dest = N.music) {
  const base = midi < 54 ? 48 : midi < 66 ? 60 : 72, buf = kit['keys_' + base];
  if (!buf) return pluck(midi, t, dur, vel * 0.6, dest);
  const src = ctx.createBufferSource(); src.buffer = buf;
  const rate = Math.pow(2, (midi - base) / 12);
  src.playbackRate.setValueAtTime(rate, t);
  if (song.kit === 'dusty') {                              // tape wobble
    const w = 0.0035 * rate;
    for (let k = 1; k <= 6; k++) src.playbackRate.linearRampToValueAtTime(rate + (k % 2 ? w : -w), t + k * 0.21);
  }
  const g = gain(0); g.gain.setValueAtTime(vel * 0.42, t); g.gain.setTargetAtTime(0, t + dur, 0.09);
  src.connect(g).connect(dest); src.start(t); src.stop(t + dur + 0.7);
}
function pad(midis, t, dur) {
  const lp = ctx.createBiquadFilter(), g = gain(0);
  lp.type = 'lowpass'; lp.frequency.value = 650 + (perf.on ? perf.heat * 9 : 300); lp.Q.value = 0.6;
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.085, t + 0.3);
  g.gain.setValueAtTime(0.085, t + dur - 0.1); g.gain.linearRampToValueAtTime(0, t + dur + 0.5);
  for (const m of midis) for (const det of [-8, 7]) {
    const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = mtof(m); o.detune.value = det;
    o.connect(lp); o.start(t); o.stop(t + dur + 0.6);
  }
  lp.connect(g).connect(N.music);
}
function pluck(midi, t, dur, vel, dest = N.lead) {
  const o = ctx.createOscillator(), lp = ctx.createBiquadFilter(), g = gain(0);
  o.type = 'triangle'; o.frequency.value = mtof(midi);
  lp.type = 'lowpass'; lp.frequency.setValueAtTime(4200, t); lp.frequency.exponentialRampToValueAtTime(700, t + 0.2);
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vel * 0.5, t + 0.004); g.gain.exponentialRampToValueAtTime(0.001, t + Math.max(0.25, dur + 0.2));
  o.connect(lp).connect(g).connect(dest); o.start(t); o.stop(t + Math.max(0.3, dur + 0.25));
}
function bell(midi, t, vel) {
  const f = mtof(midi), car = ctx.createOscillator(), mod = ctx.createOscillator(), idx = gain(0), g = gain(0);
  mod.frequency.value = f * 3.01; car.frequency.value = f;
  idx.gain.setValueAtTime(f * 2.2, t); idx.gain.exponentialRampToValueAtTime(1, t + 0.3);
  mod.connect(idx).connect(car.frequency);
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vel * 0.2, t + 0.003); g.gain.exponentialRampToValueAtTime(0.001, t + 0.9);
  car.connect(g).connect(N.lead); car.start(t); mod.start(t); car.stop(t + 1); mod.stop(t + 1);
}
let whistle = null;
function whistleNote(midi, t, dur) {
  const f = mtof(midi + 12);
  if (!whistle || whistle.dead < t) {
    const o = ctx.createOscillator(), g = gain(0), lfo = ctx.createOscillator(), lg = gain(5);
    o.type = 'sine'; o.frequency.setValueAtTime(f, t); lfo.frequency.value = 5.6; lfo.connect(lg).connect(o.detune);
    o.connect(g).connect(N.lead); o.start(t); lfo.start(t);
    whistle = { o, g, lfo, dead: 0 };
  } else { whistle.o.frequency.cancelScheduledValues(t); whistle.o.frequency.setTargetAtTime(f, t, 0.035); }    // portamento
  const w = whistle;
  w.g.gain.cancelScheduledValues(t); w.g.gain.setTargetAtTime(0.11, t, 0.02); w.g.gain.setTargetAtTime(0, t + dur + 0.05, 0.09);
  w.dead = t + dur + 0.6;
  // retire the oscillator once it has been quiet for a while
  clearTimeout(w.timer); w.timer = setTimeout(() => { if (whistle === w && ctx.currentTime > w.dead) { try { w.o.stop(); w.lfo.stop(); } catch {} whistle = null; } }, (dur + 1.2) * 1000 + Math.max(0, (t - ctx.currentTime) * 1000));
}
function lead(midi, t, dur, type) {
  if (type === 'bell') bell(midi + 12, t, 0.9);
  else if (type === 'whistle') whistleNote(midi, t, dur);
  else if (type === 'keys') key(midi + 12, t, dur + 0.15, 0.75, N.lead);
  else pluck(midi + 12, t, dur, 0.7);
}

// ------------------------------------------------------------------ performance hooks
// The beat makes room while you rap and opens up as you heat up.
export function setPerf({ on: isOn, heat, rapping }) {
  if (isOn !== undefined) perf.on = isOn;
  if (heat !== undefined) perf.heat = heat;
  if (rapping !== undefined) perf.rapping = rapping;
  if (!ctx) return;
  const t = ctx.currentTime;
  N.musicFilter.frequency.setTargetAtTime(perf.on ? 1500 + perf.heat * 150 : 16000, t, 0.25);
  N.lead.gain.setTargetAtTime(perf.on && perf.rapping ? 0.12 : 1, t, perf.rapping ? 0.08 : 0.6);
  N.music.gain.setTargetAtTime(perf.on && perf.rapping ? 0.62 : 0.8, t, 0.2);
}
export const levelOf = (() => { let buf = null; return () => {
  if (!ctx) return 0; if (!buf) buf = new Uint8Array(N.analyser.fftSize);
  N.analyser.getByteTimeDomainData(buf); let s = 0;
  for (let i = 0; i < buf.length; i++) { const v = (buf[i] - 128) / 128; s += v * v; }
  return Math.sqrt(s / buf.length);
}; })();
export { ROWS };
