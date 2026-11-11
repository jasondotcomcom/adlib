// node test/logic.test.mjs — beat data, share links and rhyme detection.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { song, VIBES, vibeById, loadVibe, encodeSong, decodeSong, diceAll, diceRow, melody, chordFor, rng, rollBeat } from '../public/js/song.js';
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
const { SAY, analyze, halfCut } = await import('../public/js/voicekit.js');
assert.ok(SAY.length >= 50); assert.equal(new Set(SAY).size, SAY.length, 'no repeats');
for (const s of SAY) { assert.match(s, /[bpdgkt]/, s + ' hard hit'); assert.match(s, /[sztkjxcf]/, s + " sharp"); assert.match(s, /[aeiou]/, s + ' vowel'); assert.equal(s, s.toLowerCase()); }

// cutting a word into a kit: a made-up "word" of buh (150 Hz) + ssss + ah + t
{
  const sr = 48000, d = new Float32Array(sr * 1.2); let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
  const tone = (t0, len, f, a) => { for (let i = 0; i < len * sr; i++) { const t = i / sr, env = Math.min(1, t / 0.004) * Math.min(1, (len - t) / 0.03); let v = 0; for (let h = 1; h < 9; h++) v += Math.sin(2 * Math.PI * f * h * t) / h; d[Math.floor(t0 * sr) + i] += a * v * env * 0.4; } };
  const hiss = (t0, len, a) => { let prev = 0; for (let i = 0; i < len * sr; i++) { const n = rnd(), hp = n - prev; prev = n; d[Math.floor(t0 * sr) + i] += a * hp * 0.5 * Math.min(1, i / 60); } };
  tone(0.2, 0.3, 150, 0.6); hiss(0.55, 0.12, 0.4); tone(0.7, 0.2, 150, 0.4); hiss(0.95, 0.03, 0.5);
  const p = analyze(d, sr); assert.ok(p, 'found a word');
  { const w0 = p.word[0] / sr, len = (p.word[1] - p.word[0]) / sr, h = halfCut(p, sr); assert.ok(h > len * 0.25 && h < len * 0.75, 'the front half ends near the middle ' + h + ' of ' + len); assert.ok(p.events.some(e => Math.abs(e.t - w0 - 0.015 - h) < 0.001) || Math.abs(h - len / 2) < 0.001, 'and on a syllable when there is one'); }
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

// the beat comes out of the voice: how it is said picks the vibe, the tempo, the rhythm and the key
{
  const { beatFromVoice } = await import('../public/js/song.js');
  const say = (gaps, kinds, f0, sharp) => { let t = 0; const events = kinds.map((k, i) => ({ t: (t += i ? gaps[(i - 1) % gaps.length] : 0), kind: k })); const dur = t + 0.15; return { events, dur, pace: events.length / Math.max(0.3, dur), sharp, f0, pitched: true }; };
  const slow = beatFromVoice(say([0.42], ['low', 'low', 'low'], 125, 0.12)), slowPat = song.pat[0].join('');
  assert.ok(['lofi', 'boombap', 'soul'].includes(slow.id), 'slow and low: ' + slow.id);
  const fast = beatFromVoice(say([0.13], ['low', 'sharp', 'low', 'sharp', 'low', 'low', 'sharp'], 170, 0.3));
  assert.ok(['jersey', 'afro'].includes(fast.id), 'fast: ' + fast.id);
  const hissy = beatFromVoice(say([0.2, 0.25], ['sharp', 'low', 'sharp', 'sharp', 'low'], 100, 0.42));
  assert.ok(['trap', 'drill'].includes(hissy.id), 'low and sharp: ' + hissy.id);
  assert.notEqual(song.pat[0].join(''), slowPat, 'a different word writes a different kick');
  for (const r of song.pat) assert.equal(r.length, 16);
  assert.equal(song.pat[0][0], 1); assert.deepEqual(song.pat[0], song.pat[6], 'bass rides the kick');
  assert.ok(song.pat[5].some(Boolean), 'sharp sounds became the rim');
  assert.ok(song.key >= -6 && song.key <= 6 && song.bpm >= 50 && song.bpm <= 180 && song.seed > 0);
  const a440 = beatFromVoice(say([0.3], ['low', 'low'], 110, 0.1)); assert.equal((((vibeById(a440.id).key + song.key) % 12) + 12) % 12, 9, 'said on an A, in A');
  assert.ok(decodeSong(encodeSong()), 'still a valid link');
  // and the cutter reports how the made-up word was said
  const sr = 48000, d = new Float32Array(sr); for (let i = 0; i < sr * 0.3; i++) d[9600 + i] = 0.3 * Math.sin(2 * Math.PI * 150 * i / sr) * Math.min(1, i / 200);
  const p = analyze(d, sr); assert.ok(p.events.length >= 1 && p.events[0].kind === 'low' && p.pace > 0 && p.sharp < 0.1);
}

// a take survives the trip through a share link bit for bit, so both ends cut the same kit
{
  const { packTake, unpack, toWav, fromWav, TAKE_RATE } = await import('../public/js/voicekit.js');
  const sr = 44100, d = new Float32Array(sr * 2.4); for (let i = 0; i < sr * 0.4; i++) d[sr * 0.3 + i] = 0.4 * Math.sin(2 * Math.PI * 180 * i / sr) * Math.min(1, i / 300);
  const pcm = packTake(d, sr); assert.ok(pcm && Math.abs(pcm.length - TAKE_RATE * 2.4) < 4);
  const wav = toWav(pcm); assert.ok(wav.byteLength < 44 + TAKE_RATE * 2 * 2.6, 'small enough for the server');
  const back = fromWav(wav); assert.deepEqual(Array.from(back.slice(9000, 9050)), Array.from(pcm.slice(9000, 9050))); assert.equal(back.length, pcm.length);
  const a1 = analyze(unpack(pcm), TAKE_RATE), a2 = analyze(unpack(back), TAKE_RATE);
  assert.deepEqual(a1.kick, a2.kick); assert.equal(a1.f0, a2.f0); assert.ok(Math.abs(a1.f0 - 180) < 6, 'pitch survives 32k: ' + a1.f0);
  assert.equal(fromWav(new ArrayBuffer(10)), null); assert.equal(packTake(new Float32Array(100), sr), null);
}
// rolling a beat moves between styles, sometimes stays, and keeps a voice kit
{
  loadVibe('boombap'); const seen = new Set(); let stayed = 0, moved = 0;
  for (let i = 0; i < 300; i++) { const was = song.vibe; rollBeat(); seen.add(song.vibe); song.vibe === was ? stayed++ : moved++; assert.ok(song.pat.length === 7 && song.pat[0].length === 16); assert.equal(decodeSong(encodeSong()), true, 'a rolled beat survives its link'); }
  assert.equal(seen.size, VIBES.length, 'every style comes up'); assert.ok(stayed > 25 && moved > 200, `stays sometimes, moves more: ${stayed}/${moved}`);
  song.kit = 'you'; for (let i = 0; i < 20; i++) rollBeat(); assert.equal(song.kit, 'you', 'the voice kit survives a roll');
}
console.log('ok');
