// ears.js — how adlib hears you without understanding a word.
// One mic stream that we own. It is analysed for when you start and stop
// (phrases) and where your syllables land (onsets), and the last ten seconds
// are kept so he can throw your own voice back at you.
import { getCtx, drumLog } from './engine.js';

const FRAME = 256;                 // ~5ms analysis frames
const RING_SECONDS = 10;

export const ears = {
  on: false, stream: null, track: null, headphones: false,
  level: 0,                        // smoothed 0..1-ish loudness for visuals
  inPhrase: false, phraseStart: 0, lastVoiceT: 0, lastPhraseEnd: 0,
  thr: 0.02, floor: 0.004, bleed: 0, voicePeak: 0.08,
  calibratingUntil: 0,
};

const handlers = { phraseStart: [], phraseEnd: [], onset: [], chunk: [] };
export const onEar = (ev, fn) => handlers[ev].push(fn);
const fire = (ev, a) => { for (const fn of handlers[ev]) fn(a); };

let ring = null, sr = 48000, written = 0, anchorT = 0, anchorN = 0;
let src = null, hp = null, tap = null, sink = null;
let env = 0, slow = 0, voicedRun = 0, quietRun = 0, lastOnsetT = 0, onsets = [], peak = 0;
let calib = [];
const MIN_FRAMES = 94;            // ~0.5s of frames
let mins = new Array(8).fill(Infinity), minNow = Infinity, minCount = 0, minAt = 0;
const loudUntil = [];              // windows where our own hype man is talking

// While adlib is making noise through the speakers, be harder to impress,
// so he does not hype himself.
export function expectNoise(from, to) {
  if (ears.headphones) return;
  loudUntil.push([from - 0.02, to + 0.15]);
  if (loudUntil.length > 12) loudUntil.shift();
}

export async function startEars({ headphones = false } = {}) {
  const ctx = getCtx();
  stopEars();
  ears.headphones = headphones;
  // With speakers we need the browser to subtract our own beat from the mic.
  // With headphones there is nothing to subtract, so take the raw voice.
  const audio = headphones
    ? { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 }
    : { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 };
  const stream = await navigator.mediaDevices.getUserMedia({ audio });
  try { if (navigator.audioSession) navigator.audioSession.type = 'play-and-record'; } catch {}
  ears.stream = stream; ears.track = stream.getAudioTracks()[0];
  sr = ctx.sampleRate;
  ring = new Float32Array(Math.floor(sr * RING_SECONDS)); written = 0;

  if (!ctx.audioWorklet) throw new Error('This browser is too old to hear you.');
  await ctx.audioWorklet.addModule('js/mic-worklet.js');
  src = ctx.createMediaStreamSource(stream);
  hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 160; hp.Q.value = 0.7;   // kick drum lives below this
  tap = new AudioWorkletNode(ctx, 'mic-tap', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
  sink = ctx.createGain(); sink.gain.value = 0;
  src.connect(hp).connect(tap).connect(sink).connect(ctx.destination);
  tap.port.onmessage = e => onChunk(e.data.buf, e.data.t);

  env = slow = 0; voicedRun = quietRun = 0; onsets = []; calib = [];
  mins = new Array(8).fill(Infinity); minNow = Infinity; minCount = 0; minAt = 0;
  Object.assign(ears, { on: true, inPhrase: false, floor: 0.004, bleed: 0, thr: 0.02, voicePeak: headphones ? 0.05 : 0.08, level: 0 });
  return stream;
}

export function stopEars() {
  try { tap && (tap.port.onmessage = null); src && src.disconnect(); hp && hp.disconnect(); tap && tap.disconnect(); sink && sink.disconnect(); } catch {}
  if (ears.stream) ears.stream.getTracks().forEach(t => t.stop());
  src = hp = tap = sink = null;
  Object.assign(ears, { on: false, stream: null, track: null, inPhrase: false, level: 0 });
}

// Listen to one bar of just the beat and learn how loud it is in the mic.
export function calibrate(untilT) { ears.calibratingUntil = untilT; calib = []; }

function onChunk(buf, t) {
  // ring buffer
  const n = buf.length, at = written % ring.length;
  if (at + n <= ring.length) ring.set(buf, at);
  else { const a = ring.length - at; ring.set(buf.subarray(0, a), at); ring.set(buf.subarray(a), 0); }
  anchorT = t; anchorN = written; written += n;
  fire('chunk', { buf, t, sr });
  for (let i = 0; i + FRAME <= n; i += FRAME) {
    let s = 0;
    for (let j = i; j < i + FRAME; j++) s += buf[j] * buf[j];
    frame(Math.sqrt(s / FRAME), t + i / sr);
  }
}

function frame(rms, t) {
  const prev = env;
  env = rms > env ? env + (rms - env) * 0.6 : env + (rms - env) * 0.18;     // fast up, slower down
  slow += (env - slow) * 0.04;
  ears.level += (Math.min(1, env / Math.max(0.05, ears.voicePeak)) - ears.level) * 0.3;

  // room tone: the quietest the mic has been in the last four seconds. A voice
  // always leaves a gap in that time; a fan or a hiss never does.
  if (env < minNow) minNow = env;
  if (++minCount >= MIN_FRAMES) { mins[minAt++ % mins.length] = minNow; minNow = Infinity; minCount = 0; }
  ears.floor = Math.min(minNow, ...mins);
  if (!isFinite(ears.floor)) ears.floor = env;

  if (t < ears.calibratingUntil) { calib.push(env); return; }
  if (calib.length) {
    // the beat as the mic hears it: take a high percentile of that quiet bar
    calib.sort((a, b) => a - b);
    ears.bleed = calib[Math.floor(calib.length * 0.95)] || 0;
    calib = [];
  }

  // our own drums leaking back in, measured whenever you are not rapping
  if (!ears.inPhrase && !ears.headphones) {
    for (let k = drumLog.length - 1; k >= 0 && k > drumLog.length - 6; k--) {
      const dt = t - drumLog[k].t;
      if (dt > 0.01 && dt < 0.11) { if (env > ears.bleed) ears.bleed += (env - ears.bleed) * 0.05; else ears.bleed += (env - ears.bleed) * 0.004; break; }
    }
  }
  let thr = Math.max(ears.floor * 2.5, ears.bleed * 1.9, 0.01);
  thr = Math.min(thr, Math.max(0.02, ears.voicePeak * 0.4));                // never climb out of reach of the voice
  // his own voice in the speakers should not START a phrase. If you are already going, it changes nothing.
  if (!ears.inPhrase) for (const [a, b] of loudUntil) if (t >= a && t <= b) { thr *= 2.6; break; }
  ears.thr = thr;

  // easier to stay in a phrase than to start one, so a soft syllable does not end the bar
  const voiced = env > (ears.inPhrase ? thr * 0.55 : thr);
  if (voiced) {
    voicedRun++; quietRun = 0; ears.lastVoiceT = t;
    if (env > peak) peak = env;
    if (!ears.inPhrase && voicedRun >= 10) {            // ~55ms of steady voice
      ears.inPhrase = true; ears.phraseStart = t - 0.055; onsets = [ears.phraseStart]; lastOnsetT = t; peak = env;
      fire('phraseStart', { t: ears.phraseStart });
    }
    // syllable-ish onset: energy jumps clear of its recent self
    if (ears.inPhrase && env > slow * 1.45 && env > prev * 1.08 && t - lastOnsetT > 0.1) {
      lastOnsetT = t; onsets.push(t); fire('onset', { t, level: env });
    }
  } else {
    voicedRun = 0; quietRun++;
    if (ears.inPhrase && quietRun * FRAME / sr > hang) {
      const tEnd = t - quietRun * FRAME / sr;
      ears.inPhrase = false; ears.lastPhraseEnd = tEnd;
      ears.voicePeak += (Math.max(0.03, peak) - ears.voicePeak) * 0.25;
      fire('phraseEnd', { tStart: ears.phraseStart, tEnd, onsets: onsets.slice(), peak, dur: tEnd - ears.phraseStart });
    }
  }
}
let hang = 0.16;
// A breath between bars is about a 16th note long. Shorter gaps are inside a phrase.
export function setHang(seconds) { hang = Math.max(0.12, Math.min(0.24, seconds)); }

// Copy what the mic heard between two audio-clock times.
export function slice(t0, t1) {
  if (!ring || !written) return null;
  let n0 = Math.round(anchorN + (t0 - anchorT) * sr), n1 = Math.round(anchorN + (t1 - anchorT) * sr);
  n1 = Math.min(n1, written); n0 = Math.max(n0, written - ring.length, 0);
  const len = n1 - n0; if (len < sr * 0.05) return null;
  const out = new Float32Array(len);
  for (let i = 0; i < len; i++) out[i] = ring[(n0 + i) % ring.length];
  return out;
}
export const micRate = () => sr;
