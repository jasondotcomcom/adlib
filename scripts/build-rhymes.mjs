// Builds public/data/rhymes.txt from the CMU Pronouncing Dictionary.
// One line per rhyme tail: "<tail phonemes>\t<word> <word> ..."
// The tail runs from the last stressed vowel to the end of the word, which is
// what two words share when they rhyme. Run: node scripts/build-rhymes.mjs
// (needs: npm i --no-save cmu-pronouncing-dictionary)
import { dictionary } from 'cmu-pronouncing-dictionary';
import { writeFileSync } from 'node:fs';

const groups = new Map();
let n = 0;
for (const [word, pron] of Object.entries(dictionary)) {
  if (!/^[a-z]{2,9}$/.test(word)) continue;          // skip variants, apostrophes, long words
  const ph = pron.split(' ');
  let i = -1;
  for (let k = ph.length - 1; k >= 0; k--) if (/1$/.test(ph[k])) { i = k; break; }
  if (i < 0) for (let k = ph.length - 1; k >= 0; k--) if (/2$/.test(ph[k])) { i = k; break; }
  if (i < 0) for (let k = ph.length - 1; k >= 0; k--) if (/\d$/.test(ph[k])) { i = k; break; }
  if (i < 0) continue;
  const tail = ph.slice(i).map(p => p.replace(/\d/, '')).join(' ');
  if (!groups.has(tail)) groups.set(tail, []);
  groups.get(tail).push(word); n++;
}
const lines = [...groups.entries()].sort((a, b) => b[1].length - a[1].length)
  .map(([tail, words]) => tail + '\t' + words.join(' '));
writeFileSync(new URL('../public/data/rhymes.txt', import.meta.url), lines.join('\n'));
console.log(n, 'words,', groups.size, 'tails');
