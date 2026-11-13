// stage.js — the picture. Everything on screen is circles and straight lines
// on black, with rings echoing out of them, the way the adlib mark is drawn.
// One fragment shader measures the distance from every pixel to the nearest
// shape and paints by that distance: yellow inside, then a red ring, a blue
// ring, then grey rings to the edge. Shapes that come close share their rings.
import { getCtx, on as onBeat, stepDur } from './engine.js';
import { ears, onEar } from './ears.js';
import { onShow, hype } from './hype.js';
import { onWord, isContent } from './words.js';
import { deck, layout as deckLayout, tickDeck } from './decks.js';

const NR = 8, NC = 20, ND = 24, NW = 8;
const reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

let canvas, gl, U = {}, burstsEl, tickerEl, markSpace, W = 0, H = 0, dpr = 1, ok = false;
let decking = false, scratchAt = 0;
let performing = false, phase = 0, phaseTo = 0, markBump = 0, level = 0, chain = 0, chainAt = 0;
let mouth = 0, yell = 0, speakUntil = 0, yellUntil = 0;      // his face: how open, how loud
const rings = new Float32Array(NR * 4), caps = new Float32Array(NC * 4), capR = new Float32Array(NC * 2), discs = new Float32Array(ND * 3), wavesU = new Float32Array(NW * 4);
const hits = [], pending = [], waves = [], bursts = [], count = { n: 0, until: 0 };

const FRAG = `
precision highp float;
uniform vec2 uRes; uniform float uT, uPhase, uFade, uHeat, uDim, uGap;
uniform vec4 uRing[${NR}]; uniform vec4 uCap[${NC}]; uniform vec2 uCapR[${NC}]; uniform vec3 uDisc[${ND}]; uniform vec4 uWave[${NW}];
const vec3 BG = vec3(0.047, 0.043, 0.055), YEL = vec3(0.996, 0.902, 0.004), RED = vec3(0.992, 0.176, 0.333), BLU = vec3(0.176, 0.329, 0.992), GRY = vec3(0.592, 0.573, 0.533);
float seg(vec2 p, vec2 a, vec2 b) { vec2 pa = p - a, ba = b - a; float h = clamp(dot(pa, ba) / max(dot(ba, ba), 0.0001), 0.0, 1.0); return length(pa - ba * h); }
void main() {
  vec2 p = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y);
  float d = 1e6, dh = 1e6, de = 1e6, d0 = 1e6, d1 = 1e6;      // d0: your ring, d1: his mouth
  for (int i = 0; i < ${NR}; i++) { vec4 r = uRing[i]; if (r.w > 0.0) { float s = abs(length(p - r.xy) - r.z) - r.w; d = min(d, s); if (i == 0) d0 = s; if (i == 1) d1 = s; } }
  for (int i = 0; i < ${ND}; i++) { vec3 c = uDisc[i]; if (c.z > 0.0) d = min(d, length(p - c.xy) - c.z); }
  for (int i = 0; i < ${NC}; i++) {
    vec2 k = uCapR[i]; if (k.x <= 0.0) continue;
    float s = seg(p, uCap[i].xy, uCap[i].zw) - k.x;
    if (k.y < 1.5) d = min(d, s); else if (k.y < 2.5) dh = min(dh, s); else de = min(de, s);
  }
  float P = uT * 0.5;                                   // ring spacing is half a stroke, as in the mark
  float D = min(d, dh + P * 2.0 + uT * 0.2);            // words sit in a clearing; grey rings start at its edge
  float u = (D - uT * 0.3667) / P, k = floor(u);
  float colored = 2.0 + 2.0 * floor(uHeat * 3.99);      // more red and blue as it heats up
  float f = k >= colored ? fract(u - uPhase) : fract(u);
  float aa = 1.3 / P, line = smoothstep(0.0, aa, f) * (1.0 - smoothstep(0.3, 0.3 + aa, f));
  vec3 ink = k < colored ? (mod(k, 2.0) < 0.5 ? RED : BLU) : GRY;
  float far = 1.0 - smoothstep(uFade * 0.35, uFade, D);
  float a = k < colored ? 1.0 : mix(uDim, 1.0, far);
  for (int i = 0; i < ${NW}; i++) {                      // pulses travelling out through the rings
    vec4 w = uWave[i]; if (w.y <= 0.0) continue;
    float from = w.w < 0.5 ? D : (w.w < 1.5 ? d0 : d1);      // the beat is everywhere; a voice comes from its owner
    float g = clamp(w.y * exp(-pow((from - w.x) / (P * 1.6), 2.0)), 0.0, 1.0);
    if (k >= colored) { ink = mix(ink, w.z < 0.5 ? vec3(1.0) : (w.z < 1.5 ? RED : BLU), g); a = max(a, g); }
  }
  vec3 col = mix(BG, ink, line * a * step(0.0, u));
  col = mix(col, BG, 1.0 - smoothstep(-1.0, 1.0, dh));  // inside a clearing
  col = mix(YEL, col, smoothstep(-1.0, 1.0, d));        // inside a shape
  col = mix(col, BG, 1.0 - smoothstep(uGap - 1.0, uGap + 1.0, de));   // his eyes: over the rings, a black gap, no rings of their own
  col = mix(YEL, col, smoothstep(-1.0, 1.0, de));
  col += (fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) - 0.5) * 0.018;
  gl_FragColor = vec4(col, 1.0);
}`;

export function initStage() {
  canvas = document.getElementById('field'); burstsEl = document.getElementById('bursts'); tickerEl = document.getElementById('ticker'); markSpace = document.getElementById('markSpace');
  try {
    gl = canvas.getContext('webgl', { antialias: false, alpha: false, powerPreference: 'low-power' });
    const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
    const prog = gl.createProgram();
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, 'attribute vec2 a; void main(){ gl_Position = vec4(a, 0.0, 1.0); }'));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog); if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
    gl.useProgram(prog);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'a'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    for (const n of ['uRes', 'uT', 'uPhase', 'uFade', 'uHeat', 'uDim', 'uGap', 'uRing', 'uCap', 'uCapR', 'uDisc', 'uWave']) U[n] = gl.getUniformLocation(prog, n);
    ok = true;
  } catch (err) { document.body.classList.add('no-field'); console.warn('field off:', err && err.message); }
  resize(); window.addEventListener('resize', resize);
  onBeat('hit', (r, t, vel) => { if (r <= 2) { hits.push({ r, t, vel }); if (hits.length > 100) hits.shift(); } });
  onShow(ev => pending.push(ev));
  onEar('onset', () => { if (performing && !reduced) wave(0.3, 2, 620, 1); });
  onWord(addWord);
  requestAnimationFrame(frame);
}
export function setDecks(on) { decking = on; waves.length = 0; mouth = yell = 0; speakUntil = yellUntil = 0; }
export function setPerforming(on) {
  performing = on; chain = 0; count.n = 0; count.until = 0; waves.length = 0; pending.length = 0; mouth = yell = 0; speakUntil = yellUntil = 0;
  for (const b of bursts) b.el.remove(); bursts.length = 0;
  if (tickerEl) tickerEl.textContent = '';
}
function resize() {
  dpr = Math.min(2, window.devicePixelRatio || 1); W = window.innerWidth; H = window.innerHeight;
  canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
  if (ok) gl.viewport(0, 0, canvas.width, canvas.height);
}
// hue: 0 white, 1 red, 2 blue.  from: 0 every shape (the beat), 1 your ring, 2 his mouth
const wave = (strength, hue, speed = 900, from = 0) => { waves.push({ r: 0, strength, hue, speed, from }); if (waves.length > NW) waves.shift(); };

// ------------------------------------------------------------------ shapes
let nr = 0, nc = 0, nd = 0;
const ring = (x, y, R, h) => { if (nr < NR) rings.set([x * dpr, y * dpr, R * dpr, h * dpr], nr++ * 4); };
const cap = (x1, y1, x2, y2, r, kind = 1) => { if (nc < NC) { caps.set([x1 * dpr, y1 * dpr, x2 * dpr, y2 * dpr], nc * 4); capR.set([r * dpr, kind], nc * 2); nc++; } };
const disc = (x, y, r) => { if (nd < ND) discs.set([x * dpr, y * dpr, r * dpr], nd++ * 3); };

// The letters, on the same grid the mark uses: T is one stroke width, a bowl is
// five strokes across, an ascender eight and a quarter. (x, y) is the left end of the baseline.
function bowlStem(x, y, T, stemLeft, tall) {
  ring(x + 2.5 * T, y - 2.5 * T, 2 * T, 0.5 * T);
  const sx = x + (stemLeft ? 0.5 : 4.5) * T;
  cap(sx, y - (tall ? 7.75 : 4.5) * T, sx, y - 0.5 * T, 0.5 * T);
}
function wordmark(cx, baseline, T) {
  const x = cx - 11 * T, y = baseline;
  bowlStem(x, y, T, false, false);                                   // a
  bowlStem(x + 6.25 * T, y, T, false, true);                         // d
  cap(x + 13 * T, y - 7.75 * T, x + 13 * T, y - 0.5 * T, 0.5 * T);   // l
  cap(x + 15.25 * T, y - 4.5 * T, x + 15.25 * T, y - 0.5 * T, 0.5 * T); disc(x + 15.25 * T, y - 6.5 * T, 0.5 * T);   // i
  bowlStem(x + 17 * T, y, T, true, true);                            // b
}

// ------------------------------------------------------------------ frame
// adlib's face, drawn at the bottom of a scene. Returns the gap his eyes need.
function face(cx, T) {
  // adlib's face, bottom of the screen, drawn from the parts of the mark (see adlib-voice.md, "His face").
  // The mouth is one bowl: small while he listens, wide open when he comes in. It must stay ring 1.
  const F = T * 0.42, fx = cx, fy = H - 48 - 2.5 * F;
  ring(fx, fy, F * (1 + mouth + markBump * 0.25), 0.5 * F);
  // The eyes are straight lines. Short and upright while he listens; when he yells they
  // squeeze shut into > <. They sit over the rings and have none of their own.
  // They ride just above the mouth and move apart as it opens, so they never read as ears.
  const top = F * (1.5 + mouth), spread = F * (1.45 + 0.55 * mouth + 0.65 * yell), ey = fy - top - 2.4 * F, eh = F * (0.5 + 0.5 * yell);
  for (const side of [-1, 1]) {
    const ex = fx + side * (spread + 0.95 * F * yell), vx = fx + side * (spread - 0.95 * F * yell);
    cap(ex, ey - eh, vx, ey, 0.5 * F, 3); cap(vx, ey, ex, ey + eh, 0.5 * F, 3);
  }
  document.documentElement.style.setProperty('--face', Math.round(48 + 9.6 * F) + 'px');
  return 0.38 * F;
}
let lastT = 0;
function frame(ts) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (ts - lastT) / 1000 || 0.016); lastT = ts;
  const ctx = getCtx(), now = ctx ? ctx.currentTime : 0;

  while (ctx && hits.length && hits[0].t <= now) {
    const h = hits.shift();
    if (h.r === 0) { if (!reduced) phaseTo += 1; wave(0.75 * h.vel, 0); }     // kick: every ring steps out
    else wave(0.7 * h.vel, 1, 1100);                                           // snare and clap: a red pulse
  }
  for (let i = pending.length - 1; i >= 0; i--) if (pending[i].at <= now + 0.02) { const ev = pending.splice(i, 1)[0]; if (performing) present(ev, now); }
  phase += (phaseTo - phase) * Math.min(1, dt * 9);
  for (let i = waves.length - 1; i >= 0; i--) { const w = waves[i]; w.r += w.speed * dt; w.strength *= Math.pow(0.12, dt); if (w.strength < 0.02) waves.splice(i, 1); }
  markBump *= Math.pow(0.02, dt);
  mouth += ((now < speakUntil ? 1 : 0) - mouth) * Math.min(1, dt * (now < speakUntil ? 26 : 7));
  yell += ((now < yellUntil ? 1 : 0) - yell) * Math.min(1, dt * 14);
  level += ((ears.on ? ears.level : 0) - level) * Math.min(1, dt * 18);
  if (decking) tickDeck(dt);
  if (!ok) return;

  nr = nc = nd = 0; rings.fill(0); capR.fill(0); discs.fill(0); wavesU.fill(0);
  let T, fade, dim, gap = 0;
  if (decking) {
    // the decks: one big record. Its rim is ring 0, so waves can come out of it; the rings
    // inside the rim are its grooves. A stripe on the label shows it turning.
    const L = deckLayout(W, H); T = L.T;
    ring(L.cx, L.cy, L.R - 0.5 * T, (deck.held || deck.kept ? 0.62 : 0.5) * T);
    gap = face(L.cx, T);
    disc(L.cx, L.cy, 0.85 * T);
    const a = deck.angle, c = Math.cos(a), si = Math.sin(a);
    cap(L.cx + c * 1.9 * T, L.cy + si * 1.9 * T, L.cx + c * 3.4 * T, L.cy + si * 3.4 * T, 0.5 * T);
    // a scratch sends rings out of the record, harder the faster the hand
    // every slice of the phrase sends rings out of the record; backward ones are blue
    while (deck.hits.length && deck.hits[0] <= now) { deck.hits.shift(); if (!reduced) wave(0.45 + Math.min(0.4, Math.abs(deck.speed) * 0.15), deck.speed < -0.4 ? 2 : 0, 1000, 1); }
    if (deck.hits.length > 64) deck.hits.splice(0, deck.hits.length - 64);
    fade = 1e5; dim = 1;
  } else if (!performing) {
    // build view: the name up top, rings fading out behind the drum machine
    const b = markSpace.getBoundingClientRect();
    T = Math.max(6, Math.min(b.width / 30, b.height / 12.5));
    wordmark(b.left + b.width / 2, b.top + b.height / 2 + 4.1 * T, T);
    fade = T * 30; dim = 0.13;
  } else {
    T = Math.max(15, Math.min(34, Math.min(W, H) * 0.05));
    const cx = W / 2, cy = H * 0.46;
    // you: a ring that thickens with your voice
    ring(cx, cy, 2 * T, T * (0.5 + level * 0.95));
    // rhymes you have chained, docked around it
    if (chain > 1 && now - chainAt < stepDur() * 16 * 3) { const n = Math.min(chain, 8); for (let i = 0; i < n; i++) { const a = -Math.PI / 3 + i * 0.5; disc(cx + Math.cos(a) * 4.4 * T, cy + Math.sin(a) * 4.4 * T, 0.5 * T); } }
    else if (chain > 1) chain = 0;
    // count-in: four dots, one per beat
    if (now < count.until) for (let i = 0; i < 4; i++) disc(cx + (i - 1.5) * 2.2 * T, cy - 6 * T, (i < count.n ? 0.62 : 0.2) * T);
    gap = face(cx, T);
    // clearings for the words he throws up
    for (let i = bursts.length - 1; i >= 0; i--) {
      const s = bursts[i], age = now - s.at;
      if (age > 1.75) { s.el.remove(); bursts.splice(i, 1); continue; }
      const grow = Math.min(1, age / 0.1), out = age > 1.45 ? Math.max(0, 1 - (age - 1.45) / 0.3) : 1, r = s.r * grow * out;
      if (r > 1) cap(s.x - s.half, s.y, s.x + s.half, s.y, r, 2);
    }
    fade = 1e5; dim = 1;
  }
  waves.forEach((w, i) => wavesU.set([w.r * dpr, w.strength, w.hue, w.from], i * 4));
  gl.uniform2f(U.uRes, canvas.width, canvas.height); gl.uniform1f(U.uT, T * dpr); gl.uniform1f(U.uPhase, phase % 1); gl.uniform1f(U.uFade, fade * dpr);
  gl.uniform1f(U.uHeat, performing ? hype.heat / 100 : 0); gl.uniform1f(U.uDim, dim);
  gl.uniform4fv(U.uRing, rings); gl.uniform4fv(U.uCap, caps); gl.uniform2fv(U.uCapR, capR); gl.uniform3fv(U.uDisc, discs); gl.uniform4fv(U.uWave, wavesU); gl.uniform1f(U.uGap, gap * dpr);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
}

// ------------------------------------------------------------------ what adlib throws up
const SIZES = { m: [38, 11, 92], l: [48, 15, 132], xl: [60, 20, 180] };       // min px, vw, max px
// clear of the buttons up top, your ring in the middle and your words below
const TALL = [[0.5, 0.25], [0.5, 0.66], [0.42, 0.28], [0.58, 0.68], [0.5, 0.21], [0.5, 0.64]];
const WIDE = [[0.24, 0.34], [0.76, 0.34], [0.24, 0.6], [0.76, 0.6], [0.5, 0.19], [0.22, 0.47], [0.78, 0.47]];
let slot = 0;
const SVGNS = 'http://www.w3.org/2000/svg';
const LAYERS = [['#2D54FD', 0.67], ['#0C0B0E', 0.6], ['#FD2D55', 0.42], ['#0C0B0E', 0.34], ['#FEE601', 0.16]];

function present(ev, now) {
  if (ev.kind === 'count') { count.n = +ev.text; count.until = now + stepDur() * 4 * (5 - count.n) + 0.3; return; }
  // he comes in: mouth open for as long as he makes sound, rings pushing out of it on the hit
  speakUntil = Math.max(speakUntil, now + Math.min(1.6, ev.dur || 0.5)); markBump = 1;
  if (ev.size === 'xl' || ev.sig) yellUntil = now + Math.min(1.8, (ev.dur || 0.6) + 0.4);
  wave(1, 0, 820, 2);
  if (ev.echo || ev.kind === 'wave') {                                         // your voice coming back out of his mouth, in time with the echo
    const sd = stepDur();
    for (let k = 1; k < 3; k++) setTimeout(() => { if (performing) { wave(0.95 - k * 0.28, 2, 760, 2); speakUntil = Math.max(speakUntil, getCtx().currentTime + 0.18); } }, k * sd * 3 * 1000);
  }
  if (ev.chain) { chain = ev.chain; chainAt = now; }
  if (ev.kind !== 'text') return;
  const text = ev.text.toLowerCase(), [min, vw, max] = SIZES[ev.size] || SIZES.m;
  const wide = W > H * 1.1, list = wide ? WIDE : TALL;
  const [fx, fy] = ev.sig ? [0.5, wide ? 0.19 : 0.25] : list[slot++ % list.length];
  const room = W * (wide && fx !== 0.5 ? 0.36 : 0.92);                          // beside your ring there is less room than above it
  let px = Math.max(min, Math.min(max, (Math.min(W, H * 1.2) * vw) / 100));
  px = Math.min(px, room / (text.length * 0.7 + 0.8));
  const reach = (text.length * 0.7 + 0.8) * px / 2;
  const x = Math.max(reach + 6, Math.min(W - reach - 6, fx * W)), y = fy * H;
  const svg = document.createElementNS(SVGNS, 'svg');
  svg.setAttribute('class', 'burst'); svg.setAttribute('width', '1'); svg.setAttribute('height', '1');
  svg.style.left = x + 'px'; svg.style.top = y + 'px'; svg.style.fontSize = px + 'px';
  let last = null;
  for (const [color, w] of LAYERS) {
    const t = document.createElementNS(SVGNS, 'text');
    t.textContent = text; t.setAttribute('stroke', color); t.setAttribute('stroke-width', w + 'em'); t.setAttribute('fill', w < 0.2 ? color : 'none');
    svg.appendChild(t); last = t;
  }
  burstsEl.appendChild(svg);
  let width = text.length * px * 0.62; try { width = last.getComputedTextLength() || width; } catch {}
  bursts.push({ el: svg, x, y, half: Math.max(0, width / 2 - px * 0.3), r: px * 0.74, at: now });
  while (bursts.length > 4) { bursts[0].el.remove(); bursts.shift(); }
  if (ev.ghost) markRhyme(text.replace(/!$/, ''), ev.ghost.toLowerCase());
}

// ------------------------------------------------------------------ your words
function addWord({ w }) {
  if (!performing || !tickerEl || tickerEl.hidden) return;
  const el = document.createElement('span'); el.textContent = w; el.dataset.w = w;
  if (!isContent(w)) el.className = 'soft';
  tickerEl.appendChild(el);
  while (tickerEl.children.length > (W < 600 ? 5 : 9)) tickerEl.firstChild.remove();
}
function markRhyme(a, b) { for (const el of tickerEl.children) if (el.dataset.w === a || el.dataset.w === b) el.classList.add('hit'); }
