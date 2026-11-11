// node test/logic.test.mjs — beat data, share links and rhyme detection.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { song, VIBES, loadVibe, encodeSong, decodeSong, diceAll, diceRow, melody, chordFor, rng } from '../public/js/song.js';
import { parseRhymes, rhymes, tailOf, keywordSlug, isContent } from '../public/js/words.js';

// every vibe is well formed
for (const v of VIBES) {
  assert.equal(v.pat.length, 7, v.id); for (const r of v.pat) assert.equal(r.length, 16, v.id);
  loadVibe(v.id);
  const m = melody(); assert.ok(m.length >= 2 && m.length <= 40, `${v.id} melody ${m.length}`);
  for (const n of m) assert.ok(n.midi > 40 && n.midi < 100 && n.s >= 0 && n.s < 64);
  for (let b = 0; b < 4; b++) { const c = chordFor(b); assert.ok(c.bass808 >= 28 && c.bass808 <= 40); assert.equal(c.keys.length, 4); }
  // share link round trip
  const r = rng(42); diceAll(r); const code = encodeSong(), snap = JSON.stringify(song);
  loadVibe('lofi'); assert.ok(decodeSong(code)); assert.equal(JSON.stringify(song), snap, v.id + ' roundtrip');
  assert.equal(song.pat[0][0], 1, 'kick on the one survives dice');
}
for (const bad of ['', 'x', '2.nope.90.58.12.a.0.3.' + '0'.repeat(28), '2.trap.900.58.12.a.0.3.' + '0'.repeat(28), '2.trap.70.50.12.a.0.3.zz']) assert.equal(decodeSong(bad), false, bad);

// rhyme
parseRhymes(readFileSync(new URL('../public/data/rhymes.txt', import.meta.url), 'utf8'));
const yes = [['cold', 'gold'], ['money', 'funny'], ['flow', 'go'], ['time', 'rhyme'], ['fire', 'higher'], ['night', 'light'], ['day', 'way'], ['real', 'feel'], ['back', 'track'], ['beat', 'street'],
  ['flowing', 'going'], ['spittin', 'hitting'], ['nation', 'station'], ['brain', 'insane'], ['mic', 'like'], ['time', 'mine'], ['cold', 'soul'], ['again', 'pen'], ['bars', 'cars'], ['city', 'gritty']];
const no = [['cold', 'fire'], ['money', 'street'], ['flow', 'night'], ['beat', 'back'], ['real', 'gold'], ['time', 'day'], ['cat', 'dog'], ['mic', 'money']];
let miss = [];
for (const [a, b] of yes) if (!rhymes(a, b)) miss.push(`${a}/${b} (${tailOf(a)} | ${tailOf(b)})`);
for (const [a, b] of no) if (rhymes(a, b)) miss.push(`FALSE ${a}/${b} (${tailOf(a)} | ${tailOf(b)})`);
assert.deepEqual(miss, [], 'rhyme misses');
assert.equal(rhymes('cold', 'cold'), 0);
assert.equal(rhymes('cold', 'gold'), 2); assert.equal(rhymes('time', 'mine'), 1);
assert.ok(tailOf('zxqvy') !== undefined);
assert.equal(keywordSlug('fire'), 'fire'); assert.equal(keywordSlug('money'), 'chaching'); assert.equal(isContent('the'), false); assert.equal(isContent('mic'), true);

// things to say: each one gives the kit a hard hit, something sharp and a vowel
const { SAY, analyze } = await import('../public/js/voicekit.js');
assert.ok(SAY.length >= 50); assert.equal(new Set(SAY).size, SAY.length, 'no repeats');
for (const s of SAY) { assert.match(s, /[bpdgkt]/, s + ' hard hit'); assert.match(s, /[sztkjxcf]/, s + " sharp"); assert.match(s, /[aeiou]/, s + ' vowel'); assert.equal(s, s.toLowerCase()); }

// cutting a word into a kit: a made-up "word" of buh (150 Hz) + ssss + ah + t
{
  const sr = 48000, d = new Float32Array(sr * 1.2); let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
  const tone = (t0, len, f, a) => { for (let i = 0; i < len * sr; i++) { const t = i / sr, env = Math.min(1, t / 0.004) * Math.min(1, (len - t) / 0.03); let v = 0; for (let h = 1; h < 9; h++) v += Math.sin(2 * Math.PI * f * h * t) / h; d[Math.floor(t0 * sr) + i] += a * v * env * 0.4; } };
  const hiss = (t0, len, a) => { let prev = 0; for (let i = 0; i < len * sr; i++) { const n = rnd(), hp = n - prev; prev = n; d[Math.floor(t0 * sr) + i] += a * hp * 0.5 * Math.min(1, i / 60); } };
  tone(0.2, 0.3, 150, 0.6); hiss(0.55, 0.12, 0.4); tone(0.7, 0.2, 150, 0.4); hiss(0.95, 0.03, 0.5);
  const p = analyze(d, sr); assert.ok(p, 'found a word');
  assert.ok(p.pitched && Math.abs(p.f0 - 150) < 6, 'pitch ' + p.f0);
  const sec = x => x / sr;
  assert.ok(sec(p.kick[0]) > 0.17 && sec(p.kick[0]) < 0.23, 'kick at the first hit ' + sec(p.kick[0]));
  const hat = sec(p.hat[0]); assert.ok((hat > 0.53 && hat < 0.67) || (hat > 0.93 && hat < 0.98), 'hat on a hiss ' + hat);
  assert.ok(sec(p.vowel[0]) >= 0.19 && sec(p.vowel[1]) <= 0.52, 'vowel inside the first tone ' + sec(p.vowel[0]) + '-' + sec(p.vowel[1]));
  assert.equal(analyze(new Float32Array(sr), sr), null, 'silence is nothing');
  // same word at 44.1k and at a lower voice: still the right octave
  for (const [rate, f] of [[44100, 150], [44100, 110], [48000, 220]]) {
    const e = new Float32Array(rate); for (let i = 0; i < rate * 0.4; i++) { const tt = i / rate; let v = 0; for (let h = 1; h < 9; h++) v += Math.sin(2 * Math.PI * f * h * tt) / h; e[Math.floor(0.2 * rate) + i] = 0.25 * v * Math.min(1, tt / 0.004); }
    const q = analyze(e, rate); assert.ok(q && Math.abs(q.f0 - f) < f * 0.04, `pitch ${f} at ${rate}: ${q && q.f0}`);
  }
}
console.log('ok');
