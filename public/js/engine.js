// engine.js — the sound. One AudioContext, a real mix bus, a sample-accurate
// clock, and instruments that read the song in song.js.
import { song, vibe, chordFor, melody, hash, bassStep, harmonyAbove, COMPS, ROWS, STEPS } from './song.js';

let ctx = null;
const N = {};            // audio nodes by name
const kit = {};          // sample name -> AudioBuffer
const listeners = { step: [], hit: [] };
export const on = (ev, fn) => listeners[ev].push(fn);
const emit = (ev, ...a) => { for (const fn of listeners[ev]) fn(...a); };

export const getCtx = () => ctx;
export const nodes = N;
export const mtof = m => 440 * Math.pow(2, (m - 69) / 12);

// A kit made of the player's own voice plugs in here (see voicekit.js). Null until they record one.
let own = null;
export const setOwnKit = k => { own = k; };
const mine = () => song.kit === 'you' && own && own.ready();
// Builds for a voice beat: when the bass, the chords and the full beat come in, how long a
// cycle runs before it breaks down, which bars get the backwards swell, and which bar of
// each four gets the chopped fill (0 for none). The first is the original.
const ARRANGE = [
  { bass: 2, keys: 4, full: 8, cycle: 16, rise: [1, 3, 7], chop: 4 },
  { bass: 1, keys: 2, full: 4, cycle: 8, rise: [3], chop: 0 },              // straight in
  { bass: 3, keys: 1, full: 6, cycle: 16, rise: [5], chop: 2 },             // chords first
  { bass: 2, keys: 6, full: 12, cycle: 16, rise: [5, 11], chop: 0 },        // slow burn
  { bass: 0, keys: 4, full: 8, cycle: 8, rise: [], chop: 4 },               // bass from the top, no swells
];
let arcFrom = 0, under = 0;         // the bar a voice beat started growing from; how much real kit sits under it
export function restartArc() { arcFrom = Math.floor(Math.max(0, nextStep) / STEPS); }

// What the performance is doing right now. The hype brain writes this.
export const perf = { on: false, heat: 0, rapping: false, dropUntilStep: -1 };
// while the decks hold the phrase, the beat's own hook steps aside for them
export const decksHook = { on: false };
// the drums' tuning, in semitones: adlib's mouth on the decks turns it on a regular kit
export const drumTune = { semis: 0 };
export const tuneRatio = () => Math.pow(2, drumTune.semis / 12);

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

  // filters for cleaning up the low end, so the mix holds up on big speakers, not just phones
  const eq = (type, freq, q = 0.7, g = 0) => { const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q; f.gain.value = g; return f; };
  N.master = gain(0.37);
  N.limiter = ctx.createDynamicsCompressor();
  Object.assign(N.limiter.threshold, { value: -5 }); N.limiter.knee.value = 3; N.limiter.ratio.value = 18;
  N.limiter.attack.value = 0.002; N.limiter.release.value = 0.14;
  N.out = gain(0.9);   // after the limiter, so a little louder costs nothing in crunch
  N.analyser = ctx.createAnalyser(); N.analyser.fftSize = 1024; N.analyser.smoothingTimeConstant = 0.7;
  // the master: a dip where boxy low-mids collect, a little air on top
  N.masterMud = eq('peaking', 300, 1, -2.5); N.masterAir = eq('highshelf', 9000, 0.7, 2.5);
  // glue: a slow, gentle compressor that makes the parts sit together; then the limiter, then a
  // soft clipper that rounds off anything over the top, so the whole thing can be louder
  N.glue = ctx.createDynamicsCompressor();
  Object.assign(N.glue.threshold, { value: -18 }); N.glue.knee.value = 10; N.glue.ratio.value = 2; N.glue.attack.value = 0.03; N.glue.release.value = 0.25;
  N.glueIn = gain(1); N.glueBy = gain(0); N.glueMake = gain(1.12);
  N.clip = ctx.createWaveShaper(); N.clip.oversample = '4x';
  { const c = new Float32Array(4097), knee = 0.8, top = 0.97; for (let i = 0; i < c.length; i++) { const x = i / 2048 - 1, a = Math.abs(x); c[i] = Math.sign(x) * (a <= knee ? a : knee + (top - knee) * Math.tanh((a - knee) / (top - knee))); } N.clip.curve = c; }   // straight line until 0.8, then a soft shoulder
  N.preClip = gain(1);
  N.master.connect(N.masterMud).connect(N.masterAir);
  N.masterAir.connect(N.glueIn).connect(N.glue).connect(N.glueMake).connect(N.limiter);
  N.masterAir.connect(N.glueBy).connect(N.limiter);
  N.limiter.connect(N.preClip).connect(N.clip).connect(N.out).connect(ctx.destination);
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
  N.drumLow = eq('highpass', 32);                // rumble nobody hears but every speaker spends power on
  N.drums.connect(N.drumLow).connect(N.drumSat).connect(N.drumTone).connect(N.drumComp).connect(N.drumOut).connect(N.beat);
  // punch: a hard-squashed copy of the drums blended in underneath, so they hit fuller
  N.par = ctx.createDynamicsCompressor();
  Object.assign(N.par.threshold, { value: -30 }); N.par.knee.value = 0; N.par.ratio.value = 12; N.par.attack.value = 0.003; N.par.release.value = 0.08;
  N.parOut = gain(0); N.drumTone.connect(N.par).connect(N.parOut).connect(N.beat);
  // spread: hats a little left and right of each other, the clap doubled out to the sides
  N.hatL = ctx.createStereoPanner(); N.hatL.pan.value = -0.28; N.hatL.connect(N.drums);
  N.hatR = ctx.createStereoPanner(); N.hatR.pan.value = 0.28; N.hatR.connect(N.drums);
  N.clapWide = gain(0.4); { const d = ctx.createDelay(0.05), p = ctx.createStereoPanner(); d.delayTime.value = 0.014; p.pan.value = 0.7; N.clapWide.connect(d).connect(p).connect(N.drums); }

  // music: sidechain duck -> filter that opens with heat
  N.music = gain(1.05);
  N.duck = gain(1);
  N.musicFilter = ctx.createBiquadFilter(); N.musicFilter.type = 'lowpass'; N.musicFilter.frequency.value = 16000; N.musicFilter.Q.value = 0.5;
  N.musicLow = eq('highpass', 170);              // chords and lead leave the bottom to the kick and bass
  N.music.connect(N.duck).connect(N.musicFilter).connect(N.musicLow).connect(N.beat);
  // Full sound: a chorus spreads the chords and lead out to the sides (two short, slowly
  // wobbling delays, one panned each way); the kick, bass and voices stay in the middle.
  N.chorus = gain(0); N.musicLow.connect(N.chorus);
  for (const [ms, rate, pan] of [[13, 0.31, -0.85], [19, 0.43, 0.85]]) {
    const d = ctx.createDelay(0.05), lfo = ctx.createOscillator(), depth = gain(0.0025), p = ctx.createStereoPanner();
    d.delayTime.value = ms / 1000; lfo.frequency.value = rate; lfo.connect(depth).connect(d.delayTime); lfo.start();
    p.pan.value = pan; N.chorus.connect(d).connect(p).connect(N.beat);
  }
  N.lead = gain(1); N.lead.connect(N.music);
  // the chords drift slowly left and right
  N.keys = gain(1); N.keysPan = ctx.createStereoPanner(); N.keys.connect(N.keysPan).connect(N.music);
  { const lfo = ctx.createOscillator(); lfo.frequency.value = 0.11; N.keysPanDepth = gain(0); lfo.connect(N.keysPanDepth).connect(N.keysPan.pan); lfo.start(); }
  // and an echo on the lead, a dotted eighth long, kept out of the lows and the highs
  N.echo = gain(0); N.echoDelay = ctx.createDelay(2); N.echoFb = gain(0.32);
  const eLp = eq('lowpass', 2200), eHp = eq('highpass', 350), ePan = ctx.createStereoPanner(); ePan.pan.value = 0.3;
  N.lead.connect(N.echo).connect(N.echoDelay).connect(eLp).connect(eHp).connect(N.echoFb).connect(N.echoDelay);
  eHp.connect(ePan).connect(N.music);

  // bass: its own saturation so an 808 still reads on a phone speaker
  N.bass = gain(0.42);
  N.bassSat = ctx.createWaveShaper(); N.bassSat.curve = tanhCurve(1.15); N.bassSat.oversample = '2x';
  N.bassDuck = gain(1);
  N.bassLow = eq('highpass', 30); N.bassMud = eq('peaking', 230, 1.1, -3.5);    // no sub-rumble, and less boom where it muddies
  N.bass.connect(N.bassSat).connect(N.bassLow).connect(N.bassMud).connect(N.bassDuck).connect(N.beat);
  // weight: a driven, band-limited copy of the bass, so its harmonics (150-500 Hz) carry the
  // line on speakers that can't play the low notes themselves
  { const sh = ctx.createWaveShaper(); sh.curve = tanhCurve(2.2); sh.oversample = '4x'; const hp = eq('highpass', 180, 0.7), lp = eq('lowpass', 420, 0.7);
    N.bassHarm = gain(0); N.bass.connect(sh).connect(hp).connect(lp).connect(N.bassHarm).connect(N.bassDuck); }

  // reverb send
  // space: the old reverb was plain noise; the new one has a short gap before it (so the dry
  // note stays clear), early reflections like walls, and a smooth tail that darkens as it fades.
  // Its size follows the style. Kept out of the low end so it adds space, not mud.
  N.rev = gain(1); N.revLow = eq('highpass', 300);
  N.hall = ctx.createConvolver(); N.hall.buffer = makeHall(1.8); hallFor = '';
  N.revOut = gain(0); N.rev.connect(N.hall).connect(N.revLow).connect(N.revOut).connect(N.beat);
  N.revOldConv = ctx.createConvolver(); N.revOldConv.buffer = makeIR(1.7, 0.35);
  N.revOld = gain(0.9); N.rev.connect(N.revOldConv).connect(eq('highpass', 300)).connect(N.revOld).connect(N.beat);
  N.room = ctx.createConvolver(); N.room.buffer = makeHall(0.42, 0.006); N.roomOut = gain(0);
  N.roomIn = gain(1); N.roomIn.connect(N.room).connect(eq('highpass', 250)).connect(N.roomOut).connect(N.drumOut);
  N.musicSend = gain(0.16); N.musicLow.connect(N.musicSend).connect(N.rev);
  N.leadSend = gain(0.3); N.lead.connect(N.leadSend).connect(N.rev);
  N.drumSend = gain(0.05); N.drumOut.connect(N.drumSend).connect(N.rev);

  // the hype man's own bus: never ducked, never filtered
  N.hype = gain(1); N.hypeLow = eq('highpass', 110); N.hype.connect(N.hypeLow).connect(N.master);
  N.hypeSend = gain(0.12); N.hype.connect(N.hypeSend).connect(N.rev);

  // vinyl crackle bed
  N.crackle = gain(0); N.crackle.connect(N.beat);
  startCrackle();

  applyKit(); applyMix();
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

let hallFor = '';
// A reverb tail: a gap before it starts, a handful of early reflections, then decorrelated
// stereo noise that decays and loses its highs as it goes.
function makeHall(seconds, pre = 0.02) {
  const sr = ctx.sampleRate, len = Math.floor(sr * (seconds + pre)), buf = ctx.createBuffer(2, len, sr), p0 = Math.floor(pre * sr);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch); let lp = 0, seed = 1234 + ch * 777;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
    for (let k = 0; k < 9; k++) { const at = p0 + Math.floor((0.004 + k * 0.0075 + rnd() * 0.003) * sr); if (at < len) d[at] += (0.5 - k * 0.04) * (rnd() > 0 ? 1 : -1); }
    for (let i = p0; i < len; i++) {
      const t = (i - p0) / (len - p0), env = Math.exp(-6.9 * t) * Math.min(1, (i - p0) / (0.012 * sr));
      lp += (rnd() - lp) * (0.85 - 0.7 * t);
      d[i] += lp * env * 0.6;
    }
  }
  return buf;
}
const HALL = { lofi: 1.4, soul: 1.9, boombap: 1.3, gfunk: 2.2, afro: 1.7, trap: 2.4, drill: 2.0, jersey: 1.2, hyphy: 1.3, jazzrap: 1.6, phonk: 2.2 };
const KIT_FX = {
  clean: { drive: 1.6, levels: 0, tone: 16000, rate: 1, crackle: 0 },
  dusty: { drive: 2.6, levels: 96, tone: 7800, rate: 0.94, crackle: 0.5 },
  crunch: { drive: 4.2, levels: 40, tone: 11000, rate: 1.03, crackle: 0 },
  you: { drive: 1.8, levels: 0, tone: 16000, rate: 1, crackle: 0 },
};
export function applyKit() {
  if (!ctx) return;
  if (hallFor !== song.vibe) { hallFor = song.vibe; N.hall.buffer = makeHall(HALL[song.vibe] || 1.7); }
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
// Mix stages, each switchable at /testdj?mix so Jason can hear what each one does.
export const mix = { duck: true, bed: true, pan: true, space: true, room: true, punch: true, spread: true, weight: true, master: true };
export function applyMix() {
  if (!ctx) return;
  const t = ctx.currentTime, on = (k, v, off = 0) => (mix[k] ? v : off), set = (p, v) => p.setTargetAtTime(v, t, 0.04);
  set(N.keysPanDepth.gain, on('pan', 0.45));
  set(N.revOut.gain, on('space', 0.75, 0)); set(N.revOld.gain, on('space', 0, 0.9));
  set(N.roomOut.gain, on('room', 0.55));
  set(N.parOut.gain, on('punch', 0.32));
  set(N.bassHarm.gain, on('weight', 0.09));
  set(N.glueIn.gain, on('master', 1, 0)); set(N.glueBy.gain, on('master', 0, 1));
}
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
// Play picks up where a pause left off; after a stop it starts from the top.
let paused = false;
export const isPaused = () => paused;
export function play() {
  if (!ctx || playing) return;
  if (!paused) { nextStep = 0; arcFrom = 0; }
  nextTime = ctx.currentTime + 0.06; playing = true; paused = false; lastBass = null; tick();
}
export function pause() {
  if (!playing) return;
  playing = false; paused = true;
  if (ctx) { const t = ctx.currentTime; N.beat.gain.cancelScheduledValues(t); N.beat.gain.setValueAtTime(1, t); }
}
export function stop() {
  playing = false; paused = false;
  if (ctx) { const t = ctx.currentTime; N.beat.gain.cancelScheduledValues(t); N.beat.gain.setValueAtTime(1, t); }
}

// ------------------------------------------------------------------ step
const HAT_ACC = [1, 0.42, 0.7, 0.42];
function scheduleStep(abs, time) {
  const s = abs % STEPS, bar = Math.floor(abs / STEPS), b4 = bar % 4, v = vibe(), sd = stepDur();
  const t = time + (s % 2 ? swingOffset() : 0);
  emit('step', abs, t);

  { const full = song.tone === 'full', at = ctx.currentTime;
    N.chorus.gain.setTargetAtTime(full ? 0.5 : 0, at, 0.05); N.echo.gain.setTargetAtTime(full ? 0.24 : 0, at, 0.05);
    N.echoDelay.delayTime.setTargetAtTime(Math.min(1.9, sd * 3), at, 0.05); }
  const heat = perf.on ? perf.heat : 0;
  // punchline space: at the end of every 4th bar, when it is hot, the drums step back
  const dropping = perf.on && heat > 55 && b4 === 3 && s >= 14;
  const landing = perf.on && heat > 55 && b4 === 0 && s === 0 && bar > 0;
  const fill = b4 === 3;

  // A beat made of your voice grows instead of looping: two bars of just you, then the
  // bass, then the keys, then on bar nine the real kit drops in underneath and the
  // melody arrives. Every sixteen bars after that it breaks back down to just you.
  // How it builds depends on the beat (beats made before this keep the original build).
  const you = mine(), ab = you ? bar - arcFrom : 0, A = ARRANGE[song.vary ? song.seed % ARRANGE.length : 0];
  const bassIn = !you || ab >= A.bass, keysIn = !you || ab >= A.keys, fullIn = !you || ab >= A.full;
  const bare = you && ab >= A.full && (ab - A.full) % A.cycle === A.cycle - 1;   // the breakdown bar
  under = you && fullIn && !bare ? 0.6 : 0;
  if (you) {
    // Your phrase is the hook. Whole at the top and alone in the breakdown. In between it
    // comes back on the one every four bars: whole when the keys arrive and on the first
    // drop, then trading front half and whole. It stays out while someone is rapping.
    if (s === 0 && !decksHook.on) {
      const c = ab >= A.full ? (ab - A.full) % A.cycle : -1;
      if (ab === 0 || bare) own.tag(t);
      else if (!perf.on) {
        if (ab === A.full) own.tag(t, { gain: 0.8 });
        else if (ab === A.keys || c === 8) own.tag(t, { gain: 0.56, wet: true, sd });
        else if (c === 4 || c === 12) own.tag(t, { gain: 0.56, half: true, wet: true, sd });
      }
    }
    if (s === 0 && ab >= A.full && (ab - A.full) % A.cycle === 0) { crash(t, 0.55); if (kit.deep) sample('deep', t, 0.75, 1, N.drums); }   // the drop
    if (s === 8 && (A.rise.includes(ab) || (bare && A.rise.length))) own.riser(time + 8 * sd, 8 * sd);   // backwards into the change
    if (s >= 12 && keysIn && A.chop && b4 === A.chop - 1 && !bare) own.chop(t, s - 12, sd);          // chopped into the turn
  }

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
  if (song.bass && song.pat[6][s] && !dropping) {
    let len = 1; while (len < 8 && !song.pat[6][(s + len) % STEPS]) len++;
    const ch = chordFor(bar), is808 = v.bass === '808';
    if (you) { if (bassIn && !bare) own.note((is808 ? ch.bass808 + 12 : ch.bassRound) + bassStep(bar, s, false), t, Math.min(len, 4) * sd, 'bass'); }
    else if (song.tone === 'full') fullBass(v.id, (is808 ? ch.bass808 : ch.bassRound) + bassStep(bar, s, is808), t, (is808 ? len : Math.min(len, 3)) * sd, v.glide);
    else if (is808) bass808(ch.bass808 + bassStep(bar, s, true), t, len * sd, 1, v.glide);
    else bassRound(ch.bassRound + bassStep(bar, s, false), t, Math.min(len, 3) * sd, v.glide);
  }

  // ---- keys
  if (song.keys && keysIn && !bare) {
    const ch = chordFor(bar);
    const comp = song.vary ? (COMPS[v.id] || [v.comp])[Math.floor(song.seed / 7) % (COMPS[v.id] || [v.comp]).length] : v.comp;
    const inst = song.tone === 'full' && v.chords ? v.chords : 'piano';
    for (const [cs, len, vel] of comp) if (cs === s) ch.keys.forEach((m, i) => inst === 'piano' ? key(m, t + i * 0.012, len * sd, vel * (i === 3 ? 0.7 : 1), N.keys) : chordNote(inst, m, t + (inst === 'pluck' ? i * 0.018 : 0), len * sd, vel * (i === 3 ? 0.7 : 1)));
    // the pad: three styles always had one; in Full every style gets a soft bed under the chords
    if (s === 0 && (v.pad || (song.tone === 'full' && mix.bed))) pad(ch.pad, t, STEPS * sd, v.pad ? 1 : 0.65);
  }

  // ---- lead (4-bar line)
  if (song.lead && fullIn && !bare) {
    const at = b4 * STEPS + s;
    for (const n of melody()) if (n.s === at) {
      lead(n.midi, t, n.len * sd, v.lead);
      // Full sound: a harmony a third above, in the key, on the longer notes and through the
      // last bar of each phrase, so it lifts in the right places instead of all the time
      if (song.tone === 'full' && !mine() && (n.len >= 3 || b4 === 3)) lead(harmonyAbove(n.midi), t, n.len * sd, v.lead, 0.45);
    }
  }
}

// ------------------------------------------------------------------ drums
const DRUM_SAMPLE = ['kick', 'snare', 'clap', 'hat', 'ohat', 'rim'];
function sample(name, t, vel, rate, dest) {
  const src = ctx.createBufferSource(); src.buffer = kit[name];
  src.playbackRate.value = dest === N.drums ? rate * tuneRatio() : rate;
  const g = gain(vel); src.connect(g).connect(dest); src.start(t);
  return { src, g };
}
let openHat = null, hatSide = false;
function drum(r, t, vel) {
  const name = DRUM_SAMPLE[r], k = KIT_FX[song.kit] || KIT_FX.clean;
  emit('hit', r, t, vel);
  if (r <= 2) { drumLog.push({ t, r }); if (drumLog.length > 64) drumLog.shift(); }
  if (r === 0) sidechain(t);
  if (r === 3 && openHat) { openHat.g.gain.setTargetAtTime(0, t, 0.012); openHat = null; }    // closed hat chokes the open one
  if (mine()) {
    own.drum(r, t, vel);
    if (under && kit[name]) sample(name, t, vel * [1, 0.85, 0.7, 0.34, 0.36, 0.55][r] * under, k.rate, N.drums);   // the real kit, underneath you
    return;
  }
  if (r === 5 && vibe().cowbell) return cowbell(t, vel);
  if (kit[name]) {
    const level = [1, 0.85, 0.7, 0.34, 0.36, 0.55][r];
    const rate = k.rate * (r === 3 ? 0.98 + Math.random() * 0.04 : 1);
    const human = r >= 3 ? 0.9 + Math.random() * 0.14 : 1;             // hats and percussion never hit exactly the same twice
    const dest = mix.spread && (r === 3 || r === 4) ? ((hatSide = !hatSide) ? N.hatL : N.hatR) : N.drums;
    const h = sample(name, t, vel * level * human, rate, dest);
    if (mix.spread && r === 2) h.g.connect(N.clapWide);
    if (r === 1 || r === 2) h.g.connect(N.roomIn);
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
  // the music dips under each kick; gently, with a 5 ms fall so it doesn't click
  const md = mix.duck ? 0.72 : 0.45, bd = mix.duck ? 0.78 : 0.72;
  for (const [g, depth, rel] of [[N.duck.gain, md, 0.22], [N.bassDuck.gain, bd, 0.12]]) {
    g.cancelScheduledValues(t); g.setValueAtTime(g.value, Math.max(ctx.currentTime, t - 0.005)); g.linearRampToValueAtTime(depth, t); g.linearRampToValueAtTime(1, t + rel);
  }
}
export function audition(row) {
  if (!ctx) return;
  const t = ctx.currentTime + 0.01;
  if (row < 6) drum(row, t, 1);
  else if (mine()) own.note(chordFor(0).bassRound, t, 0.3, 'bass');
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


// ------------------------------------------------------------------ full bass
// One instrument per style, picked with the Bass sound control. Classic is bass808 and
// bassRound above. These are starting recipes, tuned by ear.
let noiseBuf = null, driveCurve = null;   // for the Full bass
function bassNoise() {
  if (!noiseBuf) { noiseBuf = ctx.createBuffer(1, Math.round(ctx.sampleRate * 0.05), ctx.sampleRate); const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; }
  return noiseBuf;
}
function thump(t, freq, len, level) {                  // a short burst of filtered noise, for the attack
  const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = gain(0);
  s.buffer = bassNoise(); f.type = freq > 1000 ? 'highpass' : 'lowpass'; f.frequency.value = freq;
  g.gain.setValueAtTime(level, t); g.gain.exponentialRampToValueAtTime(0.001, t + len);
  s.connect(f).connect(g).connect(N.bass); s.start(t); s.stop(t + len + 0.01);
}
const osc = (type, f, t) => { const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(f, t); return o; };
// measured trims, so the six Full basses come out equally loud (each about -15 dB on its own)
const BASS_TRIM = { hyphy: 1.36, phonk: 1.36, jazzrap: 0.71, trap: 0.74, drill: 1.36, jersey: 1.36, gfunk: 1.32, boombap: 0.71, soul: 0.71, lofi: 0.97, afro: 1.33 };
function fullBass(id, midi, t, dur, glide) {
  const f = mtof(midi), oscs = [], out = gain(0);
  const ringing = lastBass && lastBass.end > t + 0.005, from = lastBass ? lastBass.f : f;
  if (lastBass) { lastBass.g.gain.cancelScheduledValues(t); lastBass.g.gain.setTargetAtTime(0, t, 0.012); for (const o of lastBass.os || [lastBass.o]) o.stop(t + 0.15); }
  const slide = (o, mul = 1) => { if (glide && ringing && from !== f) { o.frequency.setValueAtTime(from * mul, t); o.frequency.exponentialRampToValueAtTime(f * mul, t + 0.08); } };
  let hold = Math.max(0.12, dur * 0.85), tail = 0.08, level = 0.8;
  if (id === 'trap') {
    // 808 with drive: a sharp knock down to the note, a click, a long tail
    const o = osc('sine', f, t), sh = ctx.createWaveShaper();
    if (!driveCurve) driveCurve = tanhCurve(1.25);
    sh.curve = driveCurve; sh.oversample = '2x';
    if (glide && ringing && from !== f) slide(o); else { o.frequency.setValueAtTime(f * 3.2, t); o.frequency.exponentialRampToValueAtTime(f, t + 0.03); }
    o.connect(sh).connect(out); oscs.push(o); thump(t, 3000, 0.006, 0.35);
    hold = Math.max(0.2, dur * 0.95); tail = 0.32; level = 0.72;
  } else if (id === 'drill' || id === 'jersey' || id === 'phonk' || id === 'hyphy') {
    // detuned saws growling through a moving filter, with a sine under them
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 3;
    lp.frequency.setValueAtTime(1500, t); lp.frequency.exponentialRampToValueAtTime(380, t + 0.25);
    for (const c of [-12, 12]) { const o = osc('sawtooth', f, t); o.detune.value = c; slide(o); const g = gain(0.28); o.connect(g).connect(lp); oscs.push(o); }
    const sub = osc('sine', f, t); slide(sub); sub.connect(gain(0.48)).connect(out); oscs.push(sub);
    lp.connect(out); tail = 0.12; level = 0.75;
  } else if (id === 'gfunk') {
    // the Moog-style lead bass: saw and square through a resonant, sweeping filter
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 9;
    lp.frequency.setValueAtTime(2400, t); lp.frequency.exponentialRampToValueAtTime(480, t + 0.2);
    for (const [ty, l] of [['sawtooth', 0.32], ['square', 0.2]]) { const o = osc(ty, f, t); slide(o); o.connect(gain(l)).connect(lp); oscs.push(o); }
    const sub = osc('sine', f, t); slide(sub); sub.connect(gain(0.5)).connect(out); oscs.push(sub);
    lp.connect(out); tail = 0.1; level = 0.7;
  } else if (id === 'boombap' || id === 'soul' || id === 'jazzrap') {
    // a finger bass: a soft thump, then a round note that closes fast
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 1;
    lp.frequency.setValueAtTime(1300, t); lp.frequency.exponentialRampToValueAtTime(340, t + 0.08);
    const o = osc('sine', f, t), tri = osc('triangle', f, t); slide(o); slide(tri);
    o.connect(lp); tri.connect(gain(0.35)).connect(lp); lp.connect(out); oscs.push(o, tri);
    thump(t, 280, 0.018, 0.5); hold = Math.min(hold, 0.5); tail = 0.07; level = 0.95;
  } else if (id === 'lofi') {
    // rounder and woodier: a sine with a soft second harmonic, a slow start and a little wobble
    const o = osc('sine', f, t), h = osc('sine', f * 2, t), lfo = osc('sine', 5, t), dep = gain(f * 0.0035);
    lfo.connect(dep); dep.connect(o.frequency); dep.connect(h.frequency);
    slide(o); slide(h, 2);
    o.connect(out); h.connect(gain(0.15)).connect(out); oscs.push(o, h, lfo);
    tail = 0.12; level = 0.9;
    out.gain.setValueAtTime(0, t); out.gain.linearRampToValueAtTime(level * BASS_TRIM.lofi, t + 0.025);
  } else {
    // afro: a log drum, a hollow knock that drops in pitch and dies quickly
    const o = osc('sine', f * 1.7, t), hol = osc('triangle', f * 2, t);
    o.frequency.exponentialRampToValueAtTime(f, t + 0.05);
    hol.frequency.exponentialRampToValueAtTime(f * 1.5, t + 0.08);
    o.connect(out); hol.connect(gain(0.18)).connect(out); oscs.push(o, hol);
    thump(t, 900, 0.01, 0.25); hold = Math.min(hold, 0.14); tail = 0.09; level = 0.95;
  }
  level *= BASS_TRIM[id] || 1;
  if (id !== 'lofi') { out.gain.setValueAtTime(0, t); out.gain.linearRampToValueAtTime(level, t + 0.004); }
  out.gain.setValueAtTime(level, t + hold * 0.5); out.gain.setTargetAtTime(0, t + hold * 0.5, Math.max(0.03, tail));
  out.connect(N.bass);
  const end = t + hold + tail * 6 + 0.1;
  for (const o of oscs) { o.start(t); o.stop(end); }
  lastBass = { o: oscs[0], os: oscs, g: out, f, end: t + hold };
}
export { fullBass };



// ------------------------------------------------------------------ chord instruments
// On the Full sound each style plays its chords on its own instrument (Classic is the piano).
function chordNote(inst, midi, t, dur, vel) {
  const f = mtof(midi), out = gain(0), oscs = [], d = Math.max(0.12, dur);
  const o = (type, fr, l, det = 0) => { const x = ctx.createOscillator(); x.type = type; x.frequency.value = fr; x.detune.value = det; const g = gain(l); x.connect(g); oscs.push(x); return g; };
  let end = t + d + 0.4, level = 0.1 * vel;
  if (inst === 'ep') {                 // electric piano: a soft bell on a sine, the bell fading first
    const car = ctx.createOscillator(), mod = ctx.createOscillator(), idx = gain(0); car.frequency.value = f; mod.frequency.value = f;
    idx.gain.setValueAtTime(f * 1.4, t); idx.gain.exponentialRampToValueAtTime(f * 0.08, t + 0.35); mod.connect(idx).connect(car.frequency);
    car.connect(out); oscs.push(car, mod); level = 0.16 * vel;
    out.gain.setValueAtTime(0, t); out.gain.linearRampToValueAtTime(level, t + 0.006); out.gain.setTargetAtTime(level * 0.5, t + 0.05, 0.3); out.gain.setTargetAtTime(0, t + d, 0.12);
  } else if (inst === 'organ') {       // organ: three drawbars, a slow wobble, held the whole length
    o('sine', f, 0.5).connect(out); o('sine', f * 2, 0.28).connect(out); o('sine', f * 3, 0.14).connect(out);
    const lfo = ctx.createOscillator(), dep = gain(0.18); lfo.frequency.value = 5.8; lfo.connect(dep).connect(out.gain); oscs.push(lfo);
    level = 0.075 * vel; out.gain.setValueAtTime(0, t); out.gain.linearRampToValueAtTime(level, t + 0.02); out.gain.setValueAtTime(level, t + d - 0.03); out.gain.linearRampToValueAtTime(0, t + d + 0.06); end = t + d + 0.1;
  } else if (inst === 'synth') {       // g-funk synth chords: saw and square through a soft filter that opens and settles
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 2; lp.frequency.setValueAtTime(700, t); lp.frequency.linearRampToValueAtTime(2200, t + 0.08); lp.frequency.setTargetAtTime(1100, t + 0.1, 0.3);
    o('sawtooth', f, 0.3, -5).connect(lp); o('square', f, 0.18, 5).connect(lp); lp.connect(out);
    level = 0.06 * vel; out.gain.setValueAtTime(0, t); out.gain.linearRampToValueAtTime(level, t + 0.015); out.gain.setValueAtTime(level, t + d - 0.05); out.gain.linearRampToValueAtTime(0, t + d + 0.15); end = t + d + 0.2;
  } else if (inst === 'pluck') {       // a guitar-like pluck: bright, quick to fade, strummed
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.setValueAtTime(3800, t); lp.frequency.exponentialRampToValueAtTime(900, t + 0.18);
    o('triangle', f, 0.6).connect(lp); o('sawtooth', f * 2, 0.08).connect(lp); lp.connect(out);
    level = 0.12 * vel; out.gain.setValueAtTime(0, t); out.gain.linearRampToValueAtTime(level, t + 0.003); out.gain.exponentialRampToValueAtTime(0.0005, t + Math.min(0.9, d + 0.3)); end = t + Math.min(0.9, d + 0.3) + 0.05;
  } else if (inst === 'strings') {     // dark strings: detuned saws, slow to swell, filtered down
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1500; lp.Q.value = 0.5;
    o('sawtooth', f, 0.25, -9).connect(lp); o('sawtooth', f, 0.25, 9).connect(lp); lp.connect(out);
    level = 0.05 * vel; out.gain.setValueAtTime(0, t); out.gain.linearRampToValueAtTime(level, t + Math.min(0.25, d * 0.5)); out.gain.setValueAtTime(level, t + d); out.gain.linearRampToValueAtTime(0, t + d + 0.35); end = t + d + 0.4;
  } else {                             // stab: a short square chord, cut off fast
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.setValueAtTime(3000, t); lp.frequency.exponentialRampToValueAtTime(600, t + 0.1);
    o('square', f, 0.3).connect(lp); o('sawtooth', f, 0.2, 7).connect(lp); lp.connect(out);
    level = 0.06 * vel; const L = Math.min(d, 0.16); out.gain.setValueAtTime(0, t); out.gain.linearRampToValueAtTime(level, t + 0.003); out.gain.setValueAtTime(level, t + L * 0.6); out.gain.linearRampToValueAtTime(0, t + L); end = t + L + 0.05;
  }
  out.connect(N.keys);
  for (const x of oscs) { x.start(t); x.stop(end); }
}
// a cowbell, for phonk: two squares a fifth-ish apart through a band filter
function cowbell(t, vel) {
  const out = gain(0), bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 800; bp.Q.value = 1.2;
  for (const fr of [540, 800]) { const x = ctx.createOscillator(); x.type = 'square'; x.frequency.value = fr; x.connect(bp); x.start(t); x.stop(t + 0.4); }
  out.gain.setValueAtTime(0.32 * vel, t); out.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
  bp.connect(out).connect(N.drums);
}

// ------------------------------------------------------------------ full lead
// The Classic lead is one plain waveform per note, the way old game consoles made music.
// Full layers detuned copies so the note has width and movement, adds a breath of noise
// at the start, and lets the filter and pitch drift a little.
function fullLead(type, midi, t, dur, vel) {
  const up = type === 'whistle' ? 12 : 12, f = mtof(midi + up), out = gain(0), lp = ctx.createBiquadFilter(), oscs = [];
  lp.type = 'lowpass'; lp.Q.value = 0.8;
  let atk = 0.006, len = Math.max(0.25, dur + 0.2), level = 0.16 * vel;
  const voice = (wave, detune, l) => { const o = ctx.createOscillator(); o.type = wave; o.frequency.value = f; o.detune.value = detune; o.connect(gain(l)).connect(lp); oscs.push(o); return o; };
  if (type === 'horn') {
    // a muted horn: a saw and a triangle under a dark lowpass, a slow breath in, a little vibrato
    voice('sawtooth', -3, 0.35); voice('triangle', 3, 0.5);
    const vib = ctx.createOscillator(), vd = gain(0); vib.frequency.value = 5; vd.gain.setValueAtTime(0, t); vd.gain.linearRampToValueAtTime(7, t + 0.3); vib.connect(vd); for (const x of oscs) vd.connect(x.detune); oscs.push(vib);
    lp.frequency.value = Math.min(1500, f * 2.5); lp.Q.value = 0.5; atk = 0.05; len = dur + 0.1; level = 0.14 * vel;
  } else if (type === 'bell') {
    // a soft electric piano bell: two FM pairs a few cents apart, plus a sine an octave down
    for (const d of [-6, 6]) {
      const car = voice('sine', d, 0.5), mod = ctx.createOscillator(), idx = gain(0);
      mod.frequency.value = f * 2; mod.detune.value = d; idx.gain.setValueAtTime(f * 1.6, t); idx.gain.exponentialRampToValueAtTime(f * 0.05, t + 0.5);
      mod.connect(idx).connect(car.frequency); oscs.push(mod);
    }
    const low = voice('sine', 0, 0.35); low.frequency.value = f / 2;
    lp.frequency.value = 6000; len = 1.1; level = 0.22 * vel;
  } else if (type === 'whistle') {
    // the g-funk lead: a sine and a soft triangle, a little apart, with a slow vibrato that eases in
    const a = voice('sine', -4, 0.6), b = voice('triangle', 5, 0.35), vib = ctx.createOscillator(), vd = gain(0);
    vib.frequency.value = 5.4; vd.gain.setValueAtTime(0, t); vd.gain.linearRampToValueAtTime(9, t + 0.25);
    vib.connect(vd); vd.connect(a.detune); vd.connect(b.detune); oscs.push(vib);
    lp.frequency.value = 3500; atk = 0.03; len = dur + 0.12; level = 0.2 * vel;
  } else {
    // the pluck: three detuned saws through a filter that closes, like a plucked synth string
    // one saw and two softer triangles: the body of a pluck without the buzz
    voice('sawtooth', 0, 0.22); voice('triangle', -7, 0.4); voice('triangle', 7, 0.4);
    lp.frequency.setValueAtTime(2600, t); lp.frequency.exponentialRampToValueAtTime(700, t + 0.2);
    level = 0.14 * vel;
  }
  // a breath of noise at the very start
  const n = ctx.createBufferSource(), nf = eq2('bandpass', f * 3, 1.2), ng = gain(0);
  n.buffer = bassNoise(); ng.gain.setValueAtTime(0.018 * vel, t); ng.gain.exponentialRampToValueAtTime(0.0005, t + 0.03);
  n.connect(nf).connect(ng).connect(N.lead); n.start(t); n.stop(t + 0.05);
  out.gain.setValueAtTime(0, t); out.gain.linearRampToValueAtTime(level, t + atk);
  if (type === 'whistle' || type === 'horn') { out.gain.setValueAtTime(level, t + Math.max(atk, len - 0.1)); out.gain.linearRampToValueAtTime(0, t + len); }
  else out.gain.exponentialRampToValueAtTime(0.0005, t + len);
  lp.connect(out).connect(N.lead);
  for (const o of oscs) { o.start(t); o.stop(t + len + 0.05); }
}
const eq2 = (type, freq, q) => { const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = Math.min(2500, freq); f.Q.value = q; return f; };

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
function pad(midis, t, dur, lvl = 1) {
  const lp = ctx.createBiquadFilter(), g = gain(0), full = song.tone === 'full' && mix.bed, v = 0.085 * lvl;
  lp.type = 'lowpass'; lp.frequency.value = (full ? 1500 : 650) + (perf.on ? perf.heat * 9 : 300); lp.Q.value = 0.6;
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(v, t + 0.3);
  g.gain.setValueAtTime(v, t + dur - 0.1); g.gain.linearRampToValueAtTime(0, t + dur + 0.5);
  for (const m of midis) for (const det of [-8, 7]) {
    const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = mtof(m); o.detune.value = det;
    o.connect(lp); o.start(t); o.stop(t + dur + 0.6);
  }
  lp.connect(g).connect(N.keys);
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
function lead(midi, t, dur, type, vel = 1) {
  if (mine()) return own.note(midi, t, dur + 0.05, 'lead');
  if (song.tone === 'full' && type !== 'keys') return fullLead(type, midi, t, dur, vel);
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
