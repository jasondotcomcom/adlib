// bend.js — the knob on each word pad (claude/adlib-word-bend-brief.md). Pure functions, no
// audio graph: which lengths a word can click between, how a pitch step lands on the beat's key,
// and the stretch itself (length changes, pitch doesn't; pitch changes, length doesn't).

// Five stops: the word as recorded in the middle, two longer and two shorter, each a beat length
// (a 32nd, 16th, 8th, quarter or half bar at the tempo). Missing stops are left out.
// Returns { '-2': secs?, '-1': secs?, 0: natural, 1: secs?, 2: secs? } (positive is longer).
export function stopsFor(natural, sd) {
  const C = [0.5, 1, 2, 4, 8].map(x => x * sd);
  const longer = C.filter(c => c > natural * 1.12).slice(0, 2);
  const shorter = C.filter(c => c < natural * 0.88).reverse().slice(0, 2);
  const out = { 0: natural };
  longer.forEach((v, i) => { out[i + 1] = v; });
  shorter.forEach((v, i) => { out[-(i + 1)] = v; });
  return out;
}
// the nearest stop that exists, walking back toward the middle
export function clampStop(s, stops) { while (s && stops[s] === undefined) s += s > 0 ? -1 : 1; return s; }

// A pitch step follows the notes of the beat's key, from the scale note nearest the word.
// Returns whole semitones to shift (0 at step 0, so an untouched word is exactly as recorded).
export function stepsToSemis(steps, f0, root, scale) {
  if (!steps) return 0;
  const m0 = Math.round(69 + 12 * Math.log2(Math.max(40, f0) / 440));
  const notes = [];
  for (let o = -3; o <= 3; o++) for (const d of scale) notes.push(m0 - ((m0 - root) % 12 + 12) % 12 + o * 12 + d);
  notes.sort((a, b) => a - b);
  let i = 0, best = Infinity;
  notes.forEach((n, j) => { const d = Math.abs(n - m0); if (d < best || (d === best && n < notes[i])) { best = d; i = j; } });
  let j = Math.max(0, Math.min(notes.length - 1, i + steps));
  while (Math.abs(notes[j] - m0) > 12) j += j > i ? -1 : 1;            // within an octave, and still on the key
  return notes[j] - m0;
}

// WSOLA: overlap-add windows of the source, each nudged to where it lines up best with the last,
// so the sound keeps its pitch while its length changes.
function wsola(y, M) {
  const len = y.length; if (!len || M <= 0) return new Float32Array(Math.max(0, M));
  const a = M / len;
  let W = 1024; while (W > 128 && W * 1.5 > len) W >>= 1;
  if (len < 128) { const o = new Float32Array(M); for (let i = 0; i < M; i++) o[i] = y[Math.min(len - 1, Math.floor(i / a))]; return o; }
  const Hs = W >> 1, D = W >> 2, out = new Float32Array(M + W), norm = new Float32Array(M + W), win = new Float32Array(W);
  for (let i = 0; i < W; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (W - 1));
  let prev = 0;
  for (let k = 0; k * Hs < M; k++) {
    let pos = Math.min(Math.max(0, Math.round((k * Hs) / a)), Math.max(0, len - W));
    if (k > 0) {
      const nat = prev + Hs; let bestC = -Infinity, bestP = pos;
      for (let d = -D; d <= D; d += 4) {
        const p = pos + d; if (p < 0 || p > len - W || nat + W / 2 > len) continue;
        let c = 0; for (let i = 0; i < W / 2; i += 2) c += y[nat + i] * y[p + i];
        if (c > bestC) { bestC = c; bestP = p; }
      }
      pos = bestP;
    }
    const at = k * Hs;
    for (let i = 0; i < W; i++) { const s = pos + i < len ? y[pos + i] : 0; out[at + i] += s * win[i]; norm[at + i] += win[i]; }
    prev = pos;
  }
  const res = new Float32Array(M);
  for (let i = 0; i < M; i++) res[i] = norm[i] > 1e-3 ? out[i] / norm[i] : out[i];
  return res;
}

// One word, rendered to a length (seconds) and a pitch (semitones). The first ~30ms stays as it is
// so the consonant still hits; a word squeezed hard is cut with a short fade instead.
export function render(x, sr, target, semis = 0) {
  let y = x;
  if (semis) {                                         // pitch first (resample), the stretch below puts the length back
    const r = Math.pow(2, semis / 12), n = Math.max(1, Math.floor(x.length / r)); y = new Float32Array(n);
    for (let i = 0; i < n; i++) { const p = i * r, j = Math.floor(p), f = p - j; y[i] = (x[j] || 0) * (1 - f) + (x[j + 1] || 0) * f; }
  }
  const N = Math.max(1, Math.round(target * sr));
  const keep = Math.min(Math.round(0.03 * sr), Math.floor(y.length / 3), N);
  const out = new Float32Array(N);
  out.set(y.subarray(0, keep));
  const rest = y.subarray(keep), M = N - keep;
  if (M > 0) {
    const a = M / Math.max(1, rest.length);
    const body = a < 0.6 ? rest.slice(0, M) : wsola(rest, M);
    out.set(body.subarray(0, M), keep);
  }
  const fo = Math.min(N >> 2, Math.round(0.012 * sr));             // a clean tail
  for (let i = 0; i < fo; i++) out[N - 1 - i] *= i / fo;
  return out;
}
