// scratch-worklet.js — a record under a hand. Holds one short sound (the phrase) and
// plays it from wherever the hand puts the needle, at whatever speed and direction the
// hand moves. The main thread sends where the needle should be; this chases it smoothly,
// so a jerky stream of touch events still comes out as one continuous sweep.
class Scratch extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buf = null; this.rate = 44100;       // the sound and its own sample rate
    this.pos = 0; this.target = 0; this.v = 0; // needle position and speed, in the sound's samples
    this.held = false; this.g = 0; this.lp = 0;
    this.port.onmessage = ({ data: m }) => {
      if (m.buf) { this.buf = m.buf; this.rate = m.rate; this.pos = this.target = this.buf.length; this.v = 0; }
      if (m.down != null) { this.held = true; this.pos = this.target = m.down * this.rate; this.v = 0; }
      if (m.to != null) this.target = m.to * this.rate;
      if (m.up) this.held = false;
      if (m.peek) this.port.postMessage({ pos: this.pos / this.rate, target: this.target / this.rate, v: this.v / (this.rate / sampleRate), g: this.g, held: this.held, n: this.buf ? this.buf.length / this.rate : 0 });
    };
  }
  process(_, outputs) {
    const out = outputs[0][0], b = this.buf;
    if (!b) { out.fill(0); return true; }
    const n = b.length, normal = this.rate / sampleRate;   // one second of the sound per second
    const lag = 0.016 * sampleRate;                         // how far behind the hand the needle trails
    for (let i = 0; i < out.length; i++) {
      // Under a hand the needle chases the hand. Let go and the record plays on at normal
      // speed to the end of the phrase, the way a released record does.
      const want = this.held ? (this.target - this.pos) / lag : normal;
      this.v += (want - this.v) * (this.held ? 0.035 : 0.004);
      this.pos += this.v;
      let s = 0;
      if (this.pos >= 0 && this.pos < n - 1) { const k = this.pos | 0, f = this.pos - k; s = b[k] + (b[k + 1] - b[k]) * f; }
      // slow movement sounds dull and quiet, fast movement bright and loud, as on vinyl
      const sp = Math.abs(this.v) / normal;
      const gWant = Math.min(1, sp * 2.2) * (this.pos >= 0 && this.pos < n - 1 ? 1 : 0);
      this.g += (gWant - this.g) * 0.01;
      this.lp += (s - this.lp) * Math.min(1, 0.12 + sp * 0.7);
      out[i] = this.lp * this.g;
    }
    return true;
  }
}
registerProcessor('scratch', Scratch);
