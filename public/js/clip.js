// clip.js — records a short vertical video of the beat for Instagram and TikTok.
// The picture is the 9:16 scene stage.js draws while this runs; the sound is the engine's
// own output, recorded clean (not through the mic). The beat starts from the top so a voice
// beat opens with your phrase, and the clip always ends on a bar line, at most a minute in.
// Everything happens in the browser; nothing is uploaded.
import * as engine from './engine.js';
import { startClipScene, stopClipScene } from './stage.js';

export const MAX_SECS = 60;
const TYPES = ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4;codecs=avc1,mp4a', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
const pickType = () => { if (!window.MediaRecorder) return null; for (const t of TYPES) { try { if (MediaRecorder.isTypeSupported(t)) return t; } catch {} } return null; };
export const canClip = () => !!(pickType() && HTMLCanvasElement.prototype.captureStream);

let rec = null;
export const clipping = () => !!rec;

// the clip ends on the first bar line after you ask it to stop
let listening = false;
function listen() {
  if (listening) return; listening = true;
  engine.on('step', (abs, t) => {
    if (!rec || !rec.stopping || rec.endAt || abs % 16) return;
    rec.endAt = t; const r = rec, ctx = engine.getCtx();
    setTimeout(() => { if (r.mr.state !== 'inactive') r.mr.stop(); }, Math.max(0, (t - ctx.currentTime) * 1000 + 80));
  });
}

export function startClip({ out, phrase, line, onTick, onDone }) {
  const type = pickType(), audio = engine.clipAudio();
  if (!type || !audio || !startClipScene(out, { phrase, line })) return false;
  listen();
  const stream = new MediaStream([...out.captureStream(30).getVideoTracks(), ...audio.getAudioTracks()]);
  const chunks = [], mr = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: 6e6, audioBitsPerSecond: 160000 });
  mr.ondataavailable = e => { if (e.data && e.data.size) chunks.push(e.data); };
  mr.onstop = () => {
    clearInterval(r.timer); stopClipScene(); stream.getVideoTracks().forEach(t => t.stop());
    const cancelled = r.cancelled; rec = null;
    if (!cancelled) onDone(new Blob(chunks, { type: type.split(';')[0] }), type.includes('mp4') ? 'mp4' : 'webm');
  };
  const r = rec = { mr, t0: performance.now(), stopping: false, endAt: 0, cancelled: false, timer: 0 };
  engine.stop(); mr.start(500); engine.play();
  r.timer = setInterval(() => {
    const secs = (performance.now() - r.t0) / 1000;
    onTick(secs);
    if (!r.stopping && secs >= MAX_SECS - engine.stepDur() * 16 - 0.3) stopClip();   // the last bar has to fit inside the minute
  }, 250);
  return true;
}
export function stopClip() { if (rec) rec.stopping = true; }
export function cancelClip() { if (!rec) return; rec.cancelled = true; if (rec.mr.state !== 'inactive') rec.mr.stop(); }
