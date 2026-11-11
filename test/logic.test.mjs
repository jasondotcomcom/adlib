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
console.log('ok');
