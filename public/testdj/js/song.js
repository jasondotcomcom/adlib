// song.js — the beat as data: vibes, the current pattern, share links, dice.
// No audio in here, so it runs in node for tests.

export const ROWS = ['kick', 'snare', 'clap', 'hat', 'ohat', 'perc', 'bass'];
export const ROW_LABELS = ['Kick', 'Snare', 'Clap', 'Hat', 'Open', 'Rim', 'Bass'];
export const STEPS = 16;

export const SCALES = {
  minor: [0, 2, 3, 5, 7, 8, 10],
  major: [0, 2, 4, 5, 7, 9, 11],
  dorian: [0, 2, 3, 5, 7, 9, 10],
};
// Scale degrees that make the pentatonic for leads (keeps melodies out of trouble)
const PENTA = { minor: [0, 2, 3, 4, 6], dorian: [0, 2, 3, 4, 6], major: [0, 1, 2, 4, 5] };

const p = s => s.replace(/\s/g, '').split('').map(c => (c === 'x' ? 1 : 0));

// Ordered chill to chaotic. `half` vibes run a half-time grid: the number shown
// is the felt tempo (140), the grid step is an 8th note at that tempo.
export const VIBES = [
  {
    id: 'lofi', name: 'Lo-Fi', bpm: 76, swing: 62, key: 51, scale: 'major', prog: [1, 4, 0, 5],
    kit: 'dusty', bass: 'round', lead: 'keys', pad: false, lazy: true, crackle: true, leadDensity: 0.5,
    comp: [[0, 7, 0.8], [10, 5, 0.55]],
    pat: ['x......x..x.....', '....x.......x...', '................', 'x.x.x.x.x.x.x.x.', '...........x....', '..............x.', 'x......x..x.....'],
  },
  {
    id: 'soul', name: 'Soul', bpm: 84, swing: 58, key: 51, scale: 'dorian', prog: [0, 5, 3, 4],
    kit: 'dusty', bass: 'round', lead: 'keys', pad: false, lazy: true, leadDensity: 0.6,
    comp: [[0, 6, 0.8], [6, 2, 0.5], [11, 4, 0.7]],
    pat: ['x.........x..x..', '....x.......x...', '................', 'x.x.x.x.x.x.x.x.', '.............x..', '..x...........x.', 'x.....x...x.....'],
  },
  {
    id: 'boombap', name: 'Boom Bap', bpm: 90, swing: 58, key: 55, scale: 'minor', prog: [0, 0, 5, 4],
    kit: 'dusty', bass: 'round', lead: 'pluck', pad: false, lazy: true, leadDensity: 0.55,
    comp: [[0, 3, 0.9], [7, 2, 0.6], [10, 4, 0.7]],
    pat: ['x.......x.x.....', '....x.......x...', '................', 'x.x.x.x.x.x.x.x.', '.............x..', '...........x....', 'x.......x.x.....'],
  },
  {
    id: 'gfunk', name: 'G-Funk', bpm: 94, swing: 57, key: 56, scale: 'minor', prog: [0, 0, 5, 4],
    kit: 'clean', bass: 'round', glide: true, lead: 'whistle', pad: false, leadDensity: 0.45,
    comp: [[0, 12, 0.7], [14, 2, 0.5]],
    pat: ['x.......x..x....', '....x.......x..x', '....x.......x...', 'x.x.x.x.x.x.x.x.', '.......x........', '...x............', 'x..x....x..x..x.'],
  },
  {
    id: 'afro', name: 'Afro', bpm: 106, swing: 54, key: 55, scale: 'major', prog: [5, 3, 0, 4],
    kit: 'clean', bass: 'round', lead: 'pluck', pad: false, leadDensity: 0.7,
    comp: [[2, 2, 0.7], [6, 2, 0.6], [10, 2, 0.7], [14, 2, 0.6]],
    pat: ['x..x..x...x..x..', '....x.......x...', '................', 'x.x.x.x.x.x.x.x.', '.......x........', '..x......x.x....', 'x..x..x...x.....'],
  },
  {
    id: 'trap', name: 'Trap', bpm: 70, half: true, swing: 50, key: 50, scale: 'minor', prog: [0, 0, 5, 4],
    kit: 'clean', bass: '808', lead: 'bell', pad: true, rolls: true, leadDensity: 0.5,
    comp: [],
    pat: ['x......x..x.....', '................', '....x.......x...', 'xxxxxxxxxxxxxxxx', '......x.........', '...x......x.....', 'x......x..x.....'],
  },
  {
    id: 'drill', name: 'Drill', bpm: 71, half: true, swing: 50, key: 47, scale: 'minor', prog: [0, 5, 4, 0],
    kit: 'clean', bass: '808', glide: true, lead: 'bell', pad: true, rolls: true, leadDensity: 0.4,
    comp: [],
    pat: ['x..x..x...x.....', '....x.........x.', '............x...', 'x.xx.xx.x.xx.xx.', '...............x', '.........x......', 'x..x..x...x..x..'],
  },
  {
    id: 'jersey', name: 'Jersey', bpm: 135, swing: 50, key: 50, scale: 'minor', prog: [0, 3, 0, 4],
    kit: 'crunch', bass: '808', lead: 'pluck', pad: true, rolls: true, leadDensity: 0.6,
    comp: [[0, 2, 0.7], [3, 2, 0.6], [6, 2, 0.6], [10, 2, 0.7], [13, 2, 0.6]],
    pat: ['x...x...x..x..x.', '................', '....x.......x...', 'x.x.x.x.x.x.x.x.', '..x...x...x...x.', '.x.......x......', 'x...x...x..x..x.'],
  },
].map(v => ({ ...v, pat: v.pat.map(p) }));

export const KITS = ['clean', 'dusty', 'crunch', 'you'];      // 'you' is a kit cut from the player's own voice

export const vibeById = id => VIBES.find(v => v.id === id) || VIBES[2];

// The one live song. Everything else reads this.
export const song = {
  vibe: 'boombap', bpm: 90, swing: 58, key: 0, seed: 1, kit: 'dusty',
  keys: true, lead: true, bass: true, walk: false, tone: 'full', vox: 'chops',   // vox: how a voice beat's melody uses your phrase
  pat: ROWS.map(() => new Array(STEPS).fill(0)),
};

export const vibe = () => vibeById(song.vibe);
export const shownBpm = () => (vibe().half ? song.bpm * 2 : song.bpm);

export function loadVibe(id) {
  const v = vibeById(id);
  song.vibe = v.id; song.bpm = v.bpm; song.swing = v.swing; song.kit = v.kit; song.key = 0;
  song.pat = v.pat.map(r => r.slice());
  song.keys = true; song.lead = true; song.bass = true;
  melodyCache = null;
}

// ---------- seeded randomness (so a shared link plays the same melody) ----------
export function rng(seed) {
  let a = (seed >>> 0) || 1;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const hash = (a, b = 0, c = 0) => rng((a * 73856093) ^ (b * 19349663) ^ (c * 83492791) ^ 0x9E3779B9)();

// ---------- harmony ----------
const fold = (m, lo, hi) => { while (m < lo) m += 12; while (m > hi) m -= 12; return m; };

export function chordFor(bar) {
  const v = vibe(), sc = SCALES[v.scale], root = v.key + song.key;
  const deg = v.prog[((bar % 4) + 4) % 4];
  const tone = k => { const d = deg + k; return root + sc[d % 7] + 12 * Math.floor(d / 7); };
  const r = tone(0);
  return {
    deg,
    root: r,
    bass808: fold(r, 28, 40),   // E1..E2, where an 808 lives
    bassRound: fold(r, 33, 45),
    // rootless-ish voicing in the middle of the keyboard: 3rd, 5th, 7th, 9th
    keys: [fold(tone(2), 55, 67), fold(tone(4), 58, 70), fold(tone(6), 60, 72), fold(tone(8), 62, 74)],
    pad: [fold(r, 48, 59), fold(tone(2), 55, 66), fold(tone(4), 55, 66)],
    tones: [tone(0), tone(2), tone(4)],
  };
}

// The bassline's note for a hit, as semitones above the chord's root. The original line is
// the root with the odd fifth (or octave on an 808). A walking line, which New melody turns
// on, moves through tones that fit the chord: root on the one, chord tones on the beats,
// and passing scale steps on the weak sixteenths. Seeded, so a link plays the same line.
export function bassStep(bar, s, is808) {
  const h = hash(((bar % 4) + 4) % 4, s, song.seed + 11);
  if (!song.walk) return s % 4 !== 0 && h < 0.22 ? (is808 ? 12 : 7) : 0;
  if (s === 0) return 0;
  const v = vibe(), sc = SCALES[v.scale], root = v.key + song.key, deg = v.prog[((bar % 4) + 4) % 4];
  const tone = k => { const d = deg + k; return root + sc[((d % 7) + 7) % 7] + 12 * Math.floor(d / 7); };
  const r = tone(0), off = k => tone(k) - r;
  const strong = [0, 0, off(4), 12, off(2), off(6)];          // root, fifth, octave, third, seventh
  const pass = [off(1), off(3), off(-1) + 12, off(5)];          // steps between them
  const pool = s % 2 ? pass.concat(strong) : strong;
  return pool[Math.floor(hash(bar % 4, s, song.seed + 29) * pool.length)];
}

// The note a third above, in the key: two scale steps up from the nearest scale tone.
export function harmonyAbove(midi) {
  const v = vibe(), sc = SCALES[v.scale], root = v.key + song.key;
  const rel = (((midi - root) % 12) + 12) % 12, oct = midi - rel;
  let i = 0; for (let k = 1; k < sc.length; k++) if (Math.abs(sc[k] - rel) < Math.abs(sc[i] - rel)) i = k;
  const j = i + 2; return oct + sc[j % sc.length] + 12 * Math.floor(j / sc.length);
}

// 4-bar lead line: a 2-bar motif, then the same motif with a new ending.
let melodyCache = null;
export function melody() {
  const sig = [song.vibe, song.seed, song.key].join('|');
  if (melodyCache && melodyCache.sig === sig) return melodyCache.notes;
  const v = vibe(), sc = SCALES[v.scale], pent = PENTA[v.scale], root = v.key + song.key + 12;
  const r = rng(song.seed * 7919 + 13);
  const pitch = i => { const o = Math.floor(i / 5), d = pent[((i % 5) + 5) % 5]; return root + sc[d] + 12 * o; };
  const motif = [];
  let idx = 2 + Math.floor(r() * 3);
  for (let s = 0; s < 32; s++) {
    const strong = s % 4 === 0, mid = s % 2 === 0;
    let prob = (strong ? 0.34 : mid ? 0.3 : 0.1) * v.leadDensity * 1.6;
    if (s === 0) prob = 0.85;
    if (s % 16 > 12) prob *= 0.4;                   // leave the end of the bar for the rapper
    if (motif.length && s - motif[motif.length - 1].s < 2) prob *= 0.3;
    if (r() < prob) {
      const step = [-2, -1, -1, 1, 1, 2, 0][Math.floor(r() * 7)];
      idx = Math.max(0, Math.min(8, idx + step));
      motif.push({ s, i: idx, len: 1 + Math.floor(r() * 3) });
    }
  }
  const answer = motif.map(n => ({ ...n, s: n.s + 32 }));
  // new ending: last two notes resolve down toward the root
  for (let k = Math.max(0, answer.length - 2); k < answer.length; k++) answer[k].i = k === answer.length - 1 ? 0 + 5 * (r() < 0.4 ? 1 : 0) : 1 + Math.floor(r() * 2);
  const notes = [...motif, ...answer].map(n => ({ s: n.s, midi: pitch(n.i), len: n.len }));
  melodyCache = { sig, notes };
  return notes;
}

// ---------- dice ----------
// Mutate toward the vibe: anchors stay, everything else gets a weighted roll.
const ADD = [
  s => (s % 2 ? 0.07 : s % 4 ? 0.2 : 0.12),            // kick
  s => (s % 2 ? 0.05 : 0.03),                           // snare ghosts
  () => 0.02,                                            // clap
  s => (s % 2 ? 0.3 : 0.9),                             // hat
  s => (s % 4 === 2 ? 0.16 : 0.03),                     // open hat
  s => (s % 2 ? 0.14 : 0.07),                           // rim
  s => (s % 2 ? 0.07 : s % 4 ? 0.2 : 0.12),             // bass
];
export function diceRow(row, r = Math.random) {
  const base = vibe().pat[row], out = new Array(STEPS).fill(0);
  for (let s = 0; s < STEPS; s++) {
    const anchor = (row === 0 && s === 0) || ((row === 1 || row === 2) && base[s]);
    if (anchor) out[s] = base[s];
    else if (base[s]) out[s] = r() < 0.72 ? 1 : 0;
    else out[s] = r() < ADD[row](s) * (row === 3 && !base.some((x, i) => x && i % 2) ? 0.35 : 1) ? 1 : 0;
  }
  if (row === 0 || row === 6) out[0] = 1;
  song.pat[row] = out;
}
// Roll a new beat. Four rolls in five land on a different style, with that style's tempo
// and feel. A beat made of your voice stays made of your voice.
let stayed = false;
export function rollBeat(r = Math.random) {
  const move = stayed || r() < 0.8; stayed = !move;      // it never stays put twice running
  if (move) {
    const others = VIBES.filter(v => v.id !== song.vibe), mine = song.kit === 'you';
    loadVibe(others[Math.floor(r() * others.length)].id);
    if (mine) song.kit = 'you';
  }
  diceAll(r);
}
export function diceAll(r = Math.random) {
  for (let i = 0; i < ROWS.length; i++) diceRow(i, r);
  // bass mostly rides the kick: that is what makes a beat feel like one instrument
  for (let s = 0; s < STEPS; s++) if (r() < 0.75) song.pat[6][s] = song.pat[0][s];
  song.seed = 1 + Math.floor(r() * 46655);
  melodyCache = null;
}
export function newMelody(r = Math.random) { song.seed = 1 + Math.floor(r() * 46655); song.walk = true; melodyCache = null; }

// ---------- share links ----------
const rowHex = row => parseInt(row.join(''), 2).toString(16).padStart(4, '0');
export function encodeSong() {
  return ['2', song.vibe, song.bpm, song.swing, song.key + 12, song.seed.toString(36), KITS.indexOf(song.kit),
    (song.keys ? 1 : 0) + (song.lead ? 2 : 0) + (song.bass ? 0 : 4) + (song.walk ? 8 : 0), song.pat.map(rowHex).join('')].concat(song.tone === 'full' ? ['f'] : []).join('.');
}
export function decodeSong(str) {
  try {
    const f = String(str).split('.');
    if (f[0] !== '2' || f.length < 9) return false;
    const v = VIBES.find(x => x.id === f[1]); if (!v) return false;
    const bpm = +f[2], swing = +f[3], key = +f[4] - 12, seed = parseInt(f[5], 36), kit = KITS[+f[6]], flags = +f[7], hex = f[8];
    if (!(bpm >= 50 && bpm <= 180) || !(swing >= 50 && swing <= 70) || !(key >= -12 && key <= 12) || !kit || hex.length !== 28 || !(seed > 0)) return false;
    const pat = [];
    for (let i = 0; i < 7; i++) {
      const n = parseInt(hex.slice(i * 4, i * 4 + 4), 16); if (Number.isNaN(n)) return false;
      pat.push(n.toString(2).padStart(16, '0').split('').map(Number));
    }
    Object.assign(song, { vibe: v.id, bpm, swing, key, seed, kit, keys: !!(flags & 1), lead: !!(flags & 2), bass: !(flags & 4), walk: !!(flags & 8), tone: f[9] === 'f' ? 'full' : 'classic', pat });   // links from before the Full bass were Classic
    melodyCache = null;
    return true;
  } catch { return false; }
}

// ---------- a beat that comes out of a voice ----------
// How someone says a word picks the kind of beat and writes its rhythm.
// Where each vibe lives: [sounds per second, pitch in Hz, how much of it is sharp]
const HOME = {
  lofi: [2.5, 130, 0.15], soul: [3.2, 190, 0.12], boombap: [3.8, 120, 0.22], gfunk: [4.0, 210, 0.2],
  afro: [5.0, 180, 0.15], trap: [4.2, 110, 0.4], drill: [5.2, 95, 0.38], jersey: [6.5, 170, 0.3],
};
export function beatFromVoice(v) {
  // 1. the kind of beat: slow and soft lands on lo-fi, fast lands on jersey, low and hissy lands on drill
  const f0 = v.pitched ? v.f0 : 140;
  let id = 'boombap', best = Infinity;
  for (const [k, [pace, hz, sharp]] of Object.entries(HOME)) {
    const d = ((v.pace - pace) / 1.5) ** 2 + (Math.log2(f0 / hz) / 0.6) ** 2 + ((v.sharp - sharp) / 0.12) ** 2;
    if (d < best) { best = d; id = k; }
  }
  loadVibe(id);
  const vb = vibe(), ev = v.events && v.events.length ? v.events : [{ t: 0, kind: 'low' }];

  // 2. the tempo: the gap between your sounds is a 16th, an 8th or a quarter, whichever sits nearest this kind of beat
  const gaps = []; for (let i = 1; i < ev.length; i++) gaps.push(ev[i].t - ev[i - 1].t);
  gaps.sort((a, b) => a - b);
  const u = gaps.length ? gaps[gaps.length >> 1] : 0.2;
  let bpm = vb.bpm, off = Infinity;
  for (const div of [8, 4, 2, 1]) { const c = 60 / (u * div), o = Math.abs(Math.log2(c / vb.bpm)); if (o < off) { off = o; bpm = c; } }
  song.bpm = Math.round(Math.max(vb.bpm * 0.88, Math.min(vb.bpm * 1.14, bpm)));

  // 3. the rhythm: where your sounds landed becomes where the kick, the bass and the rim land
  const sd = 60 / song.bpm / 4, hits = ev.map(e => ({ s: Math.round((e.t - ev[0].t) / sd), low: e.kind === 'low' }));
  const span = hits[hits.length - 1].s + 1, rep = span <= 4 ? 4 : span <= 8 ? 8 : 16;
  const kick = new Array(STEPS).fill(0), rim = new Array(STEPS).fill(0);
  for (let k = 0; k < STEPS; k += rep) hits.forEach((h, i) => {
    const pos = k + h.s; if (pos >= STEPS) return;
    if (rep < STEPS && k + rep >= STEPS && i === hits.length - 1 && hits.length > 2) return;   // last time round, leave the end open
    (h.low ? kick : rim)[pos] = 1;
  });
  kick[0] = 1;
  const thin = (row, max) => { for (const odd of [1, 0]) for (let i = STEPS - 1; i > 0 && row.reduce((a, b) => a + b, 0) > max; i--) if (row[i] && i % 2 === odd) row[i] = 0; };
  thin(kick, 6); thin(rim, 5);
  if (kick.reduce((a, b) => a + b, 0) >= 2) { song.pat[0] = kick; song.pat[6] = kick.slice(); }   // one lone hit is not a pattern; keep the vibe's
  if (rim.some(Boolean)) { song.pat[5] = rim; const lastSharp = rim.lastIndexOf(1); song.pat[4] = new Array(STEPS).fill(0); if (lastSharp % 2) song.pat[4][lastSharp] = 1; }

  // 4. the key: the note you said it on becomes the root, so the bass sits where your voice does
  if (v.pitched) { const k = (((Math.round(69 + 12 * Math.log2(f0 / 440)) - vb.key) % 12) + 12) % 12; song.key = k > 6 ? k - 12 : k; }
  song.seed = 1 + (Math.abs(ev.reduce((a, e, i) => a + Math.round(e.t * 1000) * (i + 7), Math.round(f0))) % 46655);
  melodyCache = null;
  return { id, name: vb.name, bpm: shownBpm() };
}
