// clip.js — records a short vertical video for Instagram and TikTok. The brief is
// claude/adlib-clip-brief.md in the project. A voice beat's clip tells the trick in four parts,
// all on the audio clock: the say (your raw voice, dry, the phrase lighting syllable by
// syllable), the flip (a one-bar count-in of drums cut from your voice, each syllable jumping
// in its drum's colour), the drop (the full beat from its drop, two or four bars) and the tag
// (the name and the line, the beat stopped on one last kick and crash). The drop runs until
// stop, otherwise sixteen bars.
// The picture is the scene stage.js draws from the timeline built here; the sound is the
// engine's own output, recorded clean. Nothing is uploaded.
import * as engine from './engine.js';
import { startClipScene, stopClipScene } from './stage.js';
import { song, ROW_LABELS } from './song.js';
import { voice, drumSyllable } from './voicekit.js';

const TYPES = ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4;codecs=avc1,mp4a', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
const pickType = () => { if (!window.MediaRecorder) return null; for (const t of TYPES) { try { if (MediaRecorder.isTypeSupported(t)) return t; } catch {} } return null; };
export const canClip = () => !!(pickType() && HTMLCanvasElement.prototype.captureStream);
const TAG = 2;                                  // seconds of the name and the line at the end
export const MAX_SECS = 90;                     // the longest clip, start to finish
const COUNT_IN = [[0, 'kick'], [3, 'hat'], [1, 'snare'], [3, 'hat']];

let rec = null, lastTl = null;
export const clipping = () => !!rec;
export const clipTimeline = () => lastTl;      // for checking a clip's parts in tests

export function startClip({ out, phrase, heard, line, pads, onTick, onDone }) {
  const type = pickType(), audio = engine.clipAudio(), ctx = engine.getCtx();
  if (!type || !audio || !ctx) return false;
  const sd = engine.stepDur(), bar = sd * 16, hasVoice = song.kit === 'you' && voice.ready && voice.bufs.word;
  engine.stop();
  const t0 = ctx.currentTime + 0.4;
  const tl = { t0, t1: t0, t2: t0, tEnd: 0, tStop: 0, flip: [], bar, voice: !!hasVoice };
  if (hasVoice) {
    // 1. the say: the take, dry, once, straight to the output so nothing colours it
    const src = ctx.createBufferSource(), g = ctx.createGain();
    src.buffer = voice.bufs.word; g.gain.value = 0.85; src.connect(g).connect(engine.nodes.out); src.start(t0);
    // 2. the flip: kick, hat, snare, hat on the quarter notes, made from the voice; the fourth leads into the drop
    tl.t1 = t0 + voice.bufs.word.duration + 0.18;
    tl.flip = COUNT_IN.map(([r, name], i) => ({ t: tl.t1 + i * 4 * sd, r, k: drumSyllable(name), label: ROW_LABELS[r].toLowerCase() }));
    for (const f of tl.flip) engine.adlibHit(f.r, f.t, 0.95);
    tl.t2 = tl.t1 + bar;
  }
  // 3. the drop: sixteen bars, because rappers count in 16s (long enough that people can take the
  // audio on Instagram and rap on it). Stop ends it sooner, on the next bar line.
  const bars = Math.max(2, Math.min(16, Math.floor((MAX_SECS - (tl.t2 - t0) - TAG) / bar)));
  tl.tEnd = tl.t2 + bars * bar; tl.tStop = tl.tEnd + TAG;
  if (!startClipScene(out, { phrase: hasVoice ? phrase : '', heard, line, pads, tl })) return false;

  const stream = new MediaStream([...out.captureStream(30).getVideoTracks(), ...audio.getAudioTracks()]);
  const chunks = [], mr = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: 3.5e6, audioBitsPerSecond: 160000 });
  mr.ondataavailable = e => { if (e.data && e.data.size) chunks.push(e.data); };
  lastTl = { ...tl, rec0: ctx.currentTime };
  const r = rec = { mr, tl, stopping: false, cancelled: false, timer: 0, ends: [] };
  mr.onstop = () => {
    clearInterval(r.timer); r.ends.forEach(clearTimeout); stopClipScene(); stream.getVideoTracks().forEach(t => t.stop());
    if (engine.isPlaying()) engine.stop();
    const cancelled = r.cancelled; rec = null;
    if (!cancelled) onDone(new Blob(chunks, { type: type.split(';')[0] }), type.includes('mp4') ? 'mp4' : 'webm');
  };
  engine.playAt(tl.t2, { drop: !!hasVoice });
  plan(r);
  requestAnimationFrame(() => requestAnimationFrame(() => { if (r.mr.state === 'inactive' && !r.cancelled) r.mr.start(500); }));   // a drawn first frame, never black
  r.timer = setInterval(() => onTick(Math.max(0, ctx.currentTime - t0)), 250);
  return true;
}
// 4. the tag: the beat stops on the bar line with a last kick and crash, then two seconds and done
function plan(r) {
  const ctx = engine.getCtx(), tl = r.tl, wait = t => Math.max(0, (t - ctx.currentTime) * 1000);
  r.ends.forEach(clearTimeout);
  engine.endAt(Math.round((tl.tEnd - tl.t2) / engine.stepDur()));
  r.ends = [
    setTimeout(() => engine.lastHit(tl.tEnd), wait(tl.tEnd - 0.25)),
    setTimeout(() => { if (r.mr.state !== 'inactive') r.mr.stop(); }, wait(tl.tStop) + 120),
  ];
}
// Stop: end the drop on the next bar line (at least one bar of it) and go to the tag
export function stopClip() {
  if (!rec || rec.stopping) return; rec.stopping = true;
  const tl = rec.tl, now = engine.getCtx().currentTime;
  const next = tl.t2 + Math.max(1, Math.ceil((now + 0.3 - tl.t2) / tl.bar)) * tl.bar;
  if (next < tl.tEnd) { tl.tEnd = next; tl.tStop = next + TAG; plan(rec); }
}
export function cancelClip() {
  if (!rec) return; rec.cancelled = true;
  if (rec.mr.state !== 'inactive') { rec.mr.stop(); return; }
  clearInterval(rec.timer); rec.ends.forEach(clearTimeout); stopClipScene(); if (engine.isPlaying()) engine.stop(); rec = null;   // left before it started recording
}
