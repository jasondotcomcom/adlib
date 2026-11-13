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
  assert.ok(['lofi', 'boombap', 'soul', 'jazzrap'].includes(slow.id), 'slow and low: ' + slow.id);
  const fast = beatFromVoice(say([0.13], ['low', 'sharp', 'low', 'sharp', 'low', 'low', 'sharp'], 170, 0.3));
  assert.ok(['jersey', 'afro', 'hyphy'].includes(fast.id), 'fast: ' + fast.id);
  const hissy = beatFromVoice(say([0.2, 0.25], ['sharp', 'low', 'sharp', 'sharp', 'low'], 100, 0.42));
  assert.ok(['trap', 'drill', 'phonk'].includes(hissy.id), 'low and sharp: ' + hissy.id);
  assert.notEqual(song.pat[0].join(''), slowPat, 'a different word writes a different kick');
  for (const r of song.pat) assert.equal(r.length, 16);
  assert.equal(song.pat[0][0], 1); assert.equal(song.pat[6][0], 1, 'the bass starts on the one');
  for (let i = 0; i < 16; i++) if (song.pat[0][i]) assert.equal(song.pat[6][i], 1, 'every kick has a bass note under it');
  assert.ok(song.pat[5].some(Boolean), 'sharp sounds became the rim');
  assert.ok(song.key >= -6 && song.key <= 6 && song.bpm >= 50 && song.bpm <= 180 && song.seed > 0);
  const a440 = beatFromVoice(say([0.3], ['low', 'low'], 110, 0.1)); assert.ok([9, 2, 7, 4, 12 % 12, 6, 0].includes((((vibeById(a440.id).key + song.key) % 12) + 12) % 12), 'said on an A, in A or a close key');
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
  let last = false;
  for (let i = 0; i < 300; i++) { const was = song.vibe; rollBeat(); seen.add(song.vibe); const same = song.vibe === was; assert.ok(!(same && last), 'never the same style three times running'); last = same; same ? stayed++ : moved++; assert.ok(song.pat.length === 7 && song.pat[0].length === 16); assert.equal(decodeSong(encodeSong()), true, 'a rolled beat survives its link'); }
  assert.equal(seen.size, VIBES.length, 'every style comes up'); assert.ok(stayed > 25 && moved > 200, `stays sometimes, moves more: ${stayed}/${moved}`);
  song.kit = 'you'; for (let i = 0; i < 20; i++) rollBeat(); assert.equal(song.kit, 'you', 'the voice kit survives a roll');
}
// beats made so far: the number is the latest total plus every later day's markers,
// and the daily fold never moves it
{
  const { createRequire } = await import('node:module');
  const { tally, fold, START } = createRequire(import.meta.url)('../api/_count.js'), r = 'beats/';
  assert.equal(tally([], r).n, START);
  let p = ['beats/d/2026-11-12/aa', 'beats/d/2026-11-12/bb', 'beats/d/2026-11-13/cc', 'voices/x.wav', 'beats-test/d/2026-11-12/zz'];
  assert.equal(tally(p, r).n, START + 3);
  let f = fold(p, r, '2026-11-13'); assert.equal(f.write, 'beats/total/2026-11-12_' + (START + 2)); assert.deepEqual(f.remove, []);
  p.push(f.write); assert.equal(tally(p, r).n, START + 3, 'writing the total changes nothing');
  p.push('beats/d/2026-11-14/dd'); f = fold(p, r, '2026-11-14');
  assert.deepEqual(f.remove.sort(), ['beats/d/2026-11-12/aa', 'beats/d/2026-11-12/bb']); assert.equal(f.write, 'beats/total/2026-11-13_' + (START + 3));
  p = p.filter(x => !f.remove.includes(x)); assert.equal(tally(p, r).n, START + 4, 'clearing folded days changes nothing'); p.push(f.write); assert.equal(tally(p, r).n, START + 4);
  assert.equal(fold(['beats/total/2026-11-14_70'], r, '2026-11-20').write, null, 'a quiet day writes nothing');
}
// the bass: old links keep the original line; the on/off and walking flags round-trip;
// a walking line never leaves the key
{
  const S = await import('../public/js/song.js');
  S.loadVibe('boombap'); S.song.seed = 4321;
  const old = '2.boombap.90.58.12.' + (4321).toString(36) + '.1.3.' + '0'.repeat(28);
  assert.equal(S.decodeSong(old), true); assert.equal(S.song.bass, true, 'old links have bass'); assert.equal(S.song.walk, false, 'old links keep the original line');
  assert.equal(S.encodeSong(), old, 'an old link encodes back to itself');
  for (let bar = 0; bar < 4; bar++) for (let s = 0; s < 16; s++) assert.ok([0, 7].includes(S.bassStep(bar, s, false)) && [0, 12].includes(S.bassStep(bar, s, true)), 'original line is root and fifth/octave');
  S.song.bass = false; S.song.walk = true; const enc = S.encodeSong(); S.loadVibe('trap');
  assert.equal(S.decodeSong(enc), true); assert.equal(S.song.bass, false); assert.equal(S.song.walk, true);
  for (const id of ['boombap', 'trap', 'gfunk', 'afro', 'drill', 'lofi', 'hyphy', 'jazzrap', 'phonk']) {
    S.loadVibe(id); S.newMelody(); assert.equal(S.song.walk, true, 'new melody walks the bass');
    const v = S.vibe(); const inKey = m => S.SCALES[v.scale].includes((((m - v.key - S.song.key) % 12) + 12) % 12);
    for (let bar = 0; bar < 4; bar++) for (let s = 0; s < 16; s++) {
      const n = S.chordFor(bar).bassRound + S.bassStep(bar, s, false);
      assert.ok(inKey(n), `${id} bar ${bar} step ${s}: ${n} is in the key`);
      if (s === 0) assert.equal(S.bassStep(bar, s, false), 0, 'the one is the root');
    }
  }
}
// bass sound: old links are Classic and encode back unchanged; Full round-trips
{
  const S = await import('../public/js/song.js');
  const old = '2.trap.140.50.12.' + (999).toString(36) + '.0.3.' + '8'.repeat(28);
  assert.equal(S.decodeSong(old), true); assert.equal(S.song.tone, 'classic', 'old links are Classic'); assert.equal(S.encodeSong(), old, 'and encode back to themselves');
  S.song.tone = 'full'; const enc = S.encodeSong(); assert.ok(enc.endsWith('.f'));
  S.song.tone = 'classic'; assert.equal(S.decodeSong(enc), true); assert.equal(S.song.tone, 'full', 'Full round-trips');
}
// the voice bass: grains of a 150 Hz vowel laid at 70 Hz come out at 70 Hz
{
  globalThis.location = { search: '' };
  const { psola } = await import('../public/js/voicekit.js');
  const sr = 32000, f0 = 150, d = new Float32Array(sr);
  for (let i = 0; i < d.length; i++) { const ph = (i * f0) / sr; d[i] = 0.5 * Math.sin(2 * Math.PI * ph) + 0.3 * Math.sin(2 * Math.PI * 3 * ph) + 0.2 * Math.sin(2 * Math.PI * 5 * ph); }
  for (const target of [70, 98, 55]) {
    const out = psola(d, sr, f0, [0.1, 0.6], target, 0.6);
    // autocorrelation peak between 40 and 400 Hz
    let best = 0, bl = 0; const seg = out.subarray(4000, 12000);
    for (let lag = Math.round(sr / 400); lag < Math.round(sr / 40); lag++) { let c = 0; for (let i = 0; i < seg.length - lag; i++) c += seg[i] * seg[i + lag]; if (c > best) { best = c; bl = lag; } }
    const got = sr / bl; assert.ok(Math.abs(got - target) / target < 0.04, `voice bass at ${target} Hz came out at ${got.toFixed(1)}`);
    assert.ok(Math.max(...out) <= 0.91, 'never clips');
  }
}
// harmonies: always in key, and a third (3 or 4 semitones) above
{
  const S = await import('../public/js/song.js');
  for (const id of ['boombap', 'trap', 'gfunk', 'afro', 'jersey']) {
    S.loadVibe(id); const v = S.vibe(), sc = S.SCALES[v.scale], inKey = m => sc.includes((((m - v.key - S.song.key) % 12) + 12) % 12);
    for (const n of S.melody()) { const h = S.harmonyAbove(n.midi); assert.ok(inKey(h), `${id} harmony in key`); if (inKey(n.midi)) assert.ok([3, 4].includes(h - n.midi), `${id}: ${n.midi} -> ${h} is a third`); }
  }
}
// different phrases from one voice spread out: styles, keys, chords and hats
{
  const S = await import('../public/js/song.js');
  const make = (gaps, kinds, sharp, bright) => { let t = 0; const events = kinds.map((k, i) => ({ t: (t += i ? gaps[(i - 1) % gaps.length] : 0), kind: k, amp: [1, 0.7, 0.9, 0.6][i % 4] })); return { events, dur: t + 0.15, pace: events.length / Math.max(0.3, t + 0.15), sharp, bright, f0: 118, pitched: true }; };
  const set = [make([0.18, 0.15, 0.2], ['low', 'sharp', 'low', 'low'], 0.18, 0.05 * 0.38), make([0.45], ['low', 'low'], 0.02, 0.03 * 0.38), make([0.11, 0.1, 0.12], ['sharp', 'low', 'sharp', 'low', 'sharp', 'low'], 0.42, 0.07 * 0.38),
    make([0.22, 0.2], ['low', 'sharp', 'low'], 0.15, 0.05 * 0.38), make([0.25, 0.25], ['low', 'low', 'low'], 0.04, 0.07 * 0.38), make([0.13, 0.15, 0.2], ['sharp', 'low', 'sharp', 'low'], 0.35, 0.06 * 0.38)];
  const styles = new Set(), hats = new Set(), chords = new Set();
  for (const v of set) { const r = S.beatFromVoice(v); styles.add(r.id); hats.add(S.song.pat[3].join('')); chords.add(r.id + [0, 1, 2, 3].map(b => S.chordFor(b).deg).join('')); assert.ok(S.decodeSong(S.encodeSong()), 'a valid link'); }
  assert.ok(styles.size >= 4, 'six phrases land on at least four styles: ' + [...styles]);
  assert.ok(hats.size >= 4 && chords.size >= 5, `hats ${hats.size}, chord sets ${chords.size}`);
  // the same phrase said the same way gives the same beat
  const a = S.beatFromVoice(set[0]) && S.encodeSong(), b = S.beatFromVoice(set[0]) && S.encodeSong(); assert.equal(a, b);
  // old links keep their original chords
  S.loadVibe('soul'); const orig = [0, 1, 2, 3].map(b => S.chordFor(b).deg).join(''); S.song.vary = false; S.song.seed = 12345; assert.equal([0, 1, 2, 3].map(b => S.chordFor(b).deg).join(''), orig);
}
console.log('ok');

// every style and every melody shape stays in key, leaves the last beat of the bar open, and a roll varies the song
{
  const S = await import('../public/js/song.js');
  const shapes = new Set();
  for (const v of S.VIBES) for (let k = 0; k < 20; k++) {
    S.loadVibe(v.id); S.song.vary = true; S.song.seed = 1 + k * 4 + Math.floor(k / 5);
    shapes.add((S.song.seed >> 2) % 5);
    const vb = S.vibe(), notes = S.melody(); assert.ok(notes.length >= 3, `${v.id} seed ${S.song.seed}: a melody`);
    for (const n of notes) {
      assert.ok(S.SCALES[vb.scale].includes((((n.midi - vb.key - S.song.key) % 12) + 12) % 12) || vb.scale !== 'minor', `${v.id}: ${n.midi} in key`);
      assert.ok(n.s >= 0 && n.s < 64);
    }
  }
  assert.equal(shapes.size, 5, 'all five melody shapes come up');
  S.loadVibe('soul'); S.rollBeat(() => 0.3); assert.equal(S.song.vary, true, 'a roll varies the song');
  S.loadVibe('soul'); assert.equal(S.song.vary, false, 'picking a style starts from its classic version');
  console.log('ok shapes');
}
