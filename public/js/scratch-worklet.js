// scratch-worklet.js — the phrase under a hand. While held, the phrase plays on a loop at
// its normal speed, and the hand bends it: turn the record forward and it speeds up and
// rises, turn it back and it slows, drops and runs backward. A quick back-and-forth is a
// scratch. The main thread sends how far the hand has turned the record (in seconds of
// sound); this chases that smoothly, so uneven touch events still come out as one sweep.
class Scratch extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buf = null; this.rate = 44100;
    this.pos = 0; this.v = 0;          // needle position and speed, in the sound's samples
    this.clock = 0; this.hand = 0;     // the phrase's own drift since touch, and the hand's offset
    this.held = false; this.end = 0; this.g = 0; this.lp = 0;
    this.port.onmessage = ({ data: m }) => {
      if (m.buf) { this.buf = m.buf; this.rate = m.rate; this.held = false; this.end = this.pos = 0; this.g = 0; }
      if (m.down) { this.held = true; this.pos = this.clock = this.hand = 0; this.v = this.rate / sampleRate; }
      if (m.to != null) this.hand = m.to * this.rate;
      if (m.up) { this.held = false; const n = this.buf ? this.buf.length : 1; this.end = (Math.floor(this.pos / n) + 1) * n; }   // finish this pass of the phrase
      if (m.peek) this.port.postMessage({ pos: this.pos / this.rate, v: this.v / (this.rate / sampleRate), g: this.g, held: this.held });
    };
  }
  process(_, outputs) {
    const out = outputs[0][0], b = this.buf;
    if (!b) { out.fill(0); return true; }
    const n = b.length, normal = this.rate / sampleRate, lag = 0.03 * sampleRate;
    for (let i = 0; i < out.length; i++) {
      let want, live;
      if (this.held) { this.clock += normal; want = (this.clock + this.hand - this.pos) / lag + normal; live = true; }
      else { want = normal; live = this.pos < this.end; }
      this.v += (want - this.v) * (this.held ? 0.02 : 0.004);
      this.pos += this.v;
      const p = ((this.pos % n) + n) % n, k = p | 0, f = p - k;
      const s = b[k] + (b[(k + 1) % n] - b[k]) * f;
      const sp = Math.abs(this.v) / normal;
      this.g += ((live ? Math.min(1, 0.2 + sp * 1.6) : 0) - this.g) * 0.006;
      this.lp += (s - this.lp) * Math.min(1, 0.3 + sp * 0.6);         // only a crawl goes dull
      out[i] = this.lp * this.g;
    }
    return true;
  }
}
registerProcessor('scratch', Scratch);
