// Runs on the audio thread. Hands the mic to the main thread in ~21ms chunks,
// each stamped with the audio-clock time of its first sample.
class MicTap extends AudioWorkletProcessor {
  constructor() {
    super();
    this.size = 1024; this.buf = new Float32Array(this.size); this.n = 0; this.t0 = 0;
  }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;
    let i = 0;
    while (i < ch.length) {
      if (this.n === 0) this.t0 = currentTime + i / sampleRate;
      const take = Math.min(ch.length - i, this.size - this.n);
      this.buf.set(ch.subarray(i, i + take), this.n);
      this.n += take; i += take;
      if (this.n === this.size) {
        const out = this.buf; this.buf = new Float32Array(this.size); this.n = 0;
        this.port.postMessage({ t: this.t0, buf: out }, [out.buffer]);
      }
    }
    return true;
  }
}
registerProcessor('mic-tap', MicTap);
