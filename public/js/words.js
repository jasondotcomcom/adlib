// words.js — the bonus layer. When a speech engine is available adlib also
// knows WHAT you said: he throws your word up on screen, answers keywords from the
// voice bank, and notices when a rhyme lands. Nothing else depends on this.
//
// Engines, best first:
//   1. Deepgram streaming (only when /api/dg-token is configured). Works on iPhone.
//   2. The browser's own recognizer, fed our echo-cancelled mic and run on-device
//      where Chrome supports it.
//   3. Nothing. Rhythm and doubling still work.
import { getCtx } from './engine.js';
import { ears, onEar } from './ears.js';

export const words = { engine: 'none', status: 'off', recent: [] };   // recent: {w, t, final}
const subs = [];
export const onWord = fn => subs.push(fn);
let active = false;

function push(w, t, final) {
  w = w.toLowerCase().replace(/[^a-z']/g, '');
  if (!w) return;
  const item = { w, t, final };
  words.recent.push(item); if (words.recent.length > 80) words.recent.shift();
  for (const fn of subs) fn(item);
}
// Any other source of words (a new engine, a test) can feed the same pipeline.
export const feed = push;
export const wordsBetween = (t0, t1) => words.recent.filter(x => x.t >= t0 && x.t <= t1);

const IS_IOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

export async function startWords() {
  active = true; words.recent = [];
  loadRhymes();
  if (await startDeepgram()) return words.engine;
  // iOS Safari's recognizer ducks every other sound on the page while it listens,
  // which kills the beat. So on iPhone it stays off unless Deepgram is configured.
  if (!IS_IOS && await startBrowser()) return words.engine;
  words.engine = 'none'; words.status = 'rhythm only';
  return words.engine;
}
export function stopWords() {
  active = false;
  if (rec) drop(rec);
  rec = null;
  try { ws && ws.close(); } catch {}
  ws = null; words.engine = 'none'; words.status = 'off';
}

// ------------------------------------------------------------------ browser recognizer
// Slang the stock model fumbles. Only on-device recognition accepts these hints.
const BIAS = ['bars', 'drip', 'no cap', 'sheesh', 'periodt', 'skrrt', 'racks', 'bands', 'opps', 'glock', 'spittin', 'freestyle', 'cypher', 'ad lib', 'goat', 'finna', 'tryna', 'deadass', 'on god', 'whip'];
let rec = null, useTrack = true, useLocal = false, seen = [], restarts = 0, heardNothing = 0, watchdog = null;
onEar('phraseEnd', p => { if (p.dur > 0.4) heardNothing++; });

async function startBrowser() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) return false;
  try {
    if (SR.available) {
      const a = await SR.available({ langs: ['en-US'], processLocally: true });
      if (a === 'available') useLocal = true;
      else if (a === 'downloadable' || a === 'downloading') SR.install({ langs: ['en-US'], processLocally: true }).catch(() => {});   // ready next visit
    }
  } catch {}
  words.engine = 'browser'; restarts = 0;
  spin(SR);
  // If you are clearly rapping and not one word has come back, the setup is not
  // working on this browser. Step down: first drop our mic track, then on-device.
  heardNothing = 0; clearInterval(watchdog);
  watchdog = setInterval(() => {
    if (!active || words.engine !== 'browser') return clearInterval(watchdog);
    if (words.recent.length || heardNothing < 3) return;
    heardNothing = 0;
    if (useTrack) useTrack = false; else if (useLocal) useLocal = false; else { words.status = 'no words from this browser'; return clearInterval(watchdog); }
    words.status = 'retrying words'; again(SR);
  }, 1500);
  return true;
}
// Let go of a recognizer without waiting on it. One that was handed our mic track and
// never started does not fire 'end' when aborted, so nothing may depend on that event.
function drop(r) {
  r.onstart = r.onresult = r.onerror = r.onend = null;
  try { r.abort(); } catch {}
  try { r.fed && r.fed.stop(); } catch {}
}
function again(SR) { const old = rec; rec = null; if (old) drop(old); setTimeout(() => spin(SR), 80); }
function spin(SR) {
  if (!active) return;
  const r = new SR(); rec = r; seen = []; let started = false;
  r.continuous = true; r.interimResults = true; r.lang = 'en-US'; r.maxAlternatives = 1;
  if (useLocal) {
    try { r.processLocally = true; } catch {}
    try { if (window.SpeechRecognitionPhrase) r.phrases = BIAS.map(p => new window.SpeechRecognitionPhrase(p, 4)); } catch {}
  }
  r.onstart = () => { started = true; words.status = (useLocal ? 'on-device' : 'cloud') + (useTrack ? ', our mic' : ', browser mic'); };
  r.onresult = e => {
    const now = getCtx().currentTime - 0.3;                  // rough recognizer lag
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const res = e.results[i], list = res[0].transcript.trim().split(/\s+/).filter(Boolean);
      const from = seen[i] || 0;
      // hold back the newest interim word: it is the one most likely to change
      let upto = res.isFinal ? list.length : Math.max(from, list.length - 1);
      if (!res.isFinal && list.length > from && keywordSlug(list[list.length - 1].toLowerCase().replace(/[^a-z']/g, ''))) upto = list.length;
      for (let k = from; k < upto; k++) push(list[k], now, res.isFinal);
      seen[i] = Math.max(from, upto);
    }
  };
  r.onerror = e => {
    if (e.error === 'not-allowed' || e.error === 'service-not-allowed') { active && (words.status = 'words blocked'); useTrack ? (useTrack = false) : (active = false); }
    else if (e.error === 'language-not-supported' && useLocal) useLocal = false;
    else if (e.error === 'audio-capture' && useTrack) useTrack = false;
  };
  r.onend = () => { try { r.fed && r.fed.stop(); } catch {} if (active && rec === r && restarts++ < 400) setTimeout(() => spin(SR), 60); };
  // Chrome can take our own mic track, so the recognizer hears the same echo-cancelled
  // signal the rest of adlib does. Some builds accept the track and then never start:
  // no start, no error, no end. So it gets a moment, and then we go without the track.
  const viaTrack = useTrack && ears.track && ears.track.readyState === 'live';
  try {
    if (viaTrack) { r.fed = ears.track.clone(); r.start(r.fed); } else r.start();
  } catch (err) {
    useTrack = false; try { r.fed && r.fed.stop(); } catch {} r.fed = null;
    try { r.start(); } catch { words.engine = 'none'; words.status = 'rhythm only'; }
    return;
  }
  if (viaTrack) setTimeout(() => { if (active && rec === r && !started) { useTrack = false; words.status = 'retrying words'; again(SR); } }, 2200);
}

// ------------------------------------------------------------------ Deepgram streaming
let ws = null, dgT0 = 0, dgUntil = 0, dgCarry = 0, dgTries = 0;
async function startDeepgram() {
  let token;
  try {
    const r = await fetch('/api/dg-token', { cache: 'no-store' });
    if (!r.ok) return false;
    token = (await r.json()).token;
  } catch { return false; }
  if (!token) return false;
  const qs = new URLSearchParams({ model: 'nova-3', language: 'en', encoding: 'linear16', sample_rate: '16000', channels: '1', interim_results: 'true', punctuate: 'false', smart_format: 'false', endpointing: '150' });
  return new Promise(resolve => {
    let settled = false;
    const done = ok => { if (!settled) { settled = true; resolve(ok); } };
    try { ws = new WebSocket('wss://api.deepgram.com/v1/listen?' + qs, ['bearer', token]); } catch { return done(false); }
    const sock = ws; sock.binaryType = 'arraybuffer';
    sock.onopen = () => { words.engine = 'deepgram'; words.status = 'words on (live)'; dgT0 = 0; dgUntil = 0; dgCarry = 0; dgTries = 0; done(true); };
    sock.onerror = () => done(false);
    sock.onclose = () => { done(false); if (active && ws === sock && words.engine === 'deepgram' && dgTries++ < 5) setTimeout(startDeepgram, 500 * dgTries); };
    sock.onmessage = e => {
      let m; try { m = JSON.parse(e.data); } catch { return; }
      if (m.type !== 'Results' || !m.channel) return;
      const alt = m.channel.alternatives && m.channel.alternatives[0]; if (!alt || !alt.words) return;
      for (const w of alt.words) {
        if (w.start < dgUntil - 0.01) continue;
        // interim words are sent again until final; only move past a word once it has had time to settle
        if (!m.is_final && w === alt.words[alt.words.length - 1]) break;
        push(w.word, dgT0 + w.start, !!m.is_final); dgUntil = w.end;
      }
    };
    setTimeout(() => done(false), 4000);
  });
}
// mic chunks -> 16k PCM -> socket
onEar('chunk', ({ buf, t, sr }) => {
  if (!ws || ws.readyState !== 1 || words.engine !== 'deepgram') return;
  if (!dgT0) dgT0 = t;
  const ratio = sr / 16000, out = new Int16Array(Math.floor((buf.length - dgCarry) / ratio) + 1);
  let n = 0, pos = dgCarry;
  for (; pos < buf.length; pos += ratio) {
    const a = Math.floor(pos), b = Math.min(buf.length, Math.floor(pos + ratio));
    let s = 0; for (let i = a; i < b; i++) s += buf[i];
    s = s / Math.max(1, b - a) * 4;                         // box filter, plus some gain after the highpass
    out[n++] = Math.max(-32768, Math.min(32767, s * 32767));
  }
  dgCarry = pos - buf.length;
  ws.send(out.subarray(0, n));
});

// ------------------------------------------------------------------ rhyme
let tails = null, rhymeLoad = null;
export function loadRhymes(url = 'data/rhymes.txt') {
  if (rhymeLoad) return rhymeLoad;
  rhymeLoad = fetch(url).then(r => (r.ok ? r.text() : '')).then(parseRhymes).catch(() => {});
  return rhymeLoad;
}
export function parseRhymes(text) {
  tails = new Map();
  for (const line of text.split('\n')) {
    const tab = line.indexOf('\t'); if (tab < 0) continue;
    const tail = line.slice(0, tab);
    for (const w of line.slice(tab + 1).split(' ')) tails.set(w, tail);
  }
}
// Words rap says differently than the dictionary does.
const SAID = { mic: 'AY K', mics: 'AY K S', yall: 'AO L', finna: 'IH N AH', tryna: 'AY N AH', gonna: 'AH N AH', wanna: 'AA N AH', opps: 'AA P S', skrrt: 'ER T', bae: 'EY', bruh: 'AH', shawty: 'AO T IY', fya: 'AY AH', ayy: 'EY', nah: 'AA' };
const VOWEL = /^(AA|AE|AH|AO|AW|AY|EH|ER|EY|IH|IY|OW|OY|UH|UW)$/;
// Rough spelling-to-sound for words the dictionary has never met (slang, names).
function guessTail(w) {
  const m = w.match(/([aeiouy]+)([^aeiouy]*)(e?)$/); if (!m) return null;
  const [, v, c, e] = m;
  const longV = { a: 'EY', e: 'IY', i: 'AY', o: 'OW', u: 'UW', y: 'AY' }, shortV = { a: 'AE', e: 'EH', i: 'IH', o: 'AA', u: 'AH', y: 'IY' };
  const combo = { ee: 'IY', ea: 'IY', oo: 'UW', ai: 'EY', ay: 'EY', ey: 'IY', oa: 'OW', ow: 'OW', ou: 'AW', oi: 'OY', oy: 'OY', au: 'AO', aw: 'AO', ie: 'IY', igh: 'AY', ue: 'UW', ew: 'UW' };
  const vow = combo[v] || (e && c.length === 1 ? longV[v[v.length - 1]] : !c && !e ? longV[v[v.length - 1]] : shortV[v[v.length - 1]]) || 'AH';
  return (vow + ' ' + c.toUpperCase().split('').join(' ')).trim();
}
export function tailOf(word) {
  let w = word.toLowerCase().replace(/in'$/, 'ing').replace(/[^a-z]/g, '');
  if (!w) return null;
  if (SAID[w]) return SAID[w];
  if (tails) {
    if (tails.has(w)) return tails.get(w);
    if (w.endsWith('in') && tails.has(w + 'g')) return tails.get(w + 'g');                // spittin -> spitting
    if (w.endsWith('s') && tails.has(w.slice(0, -1))) return tails.get(w.slice(0, -1)) + ' Z';
  }
  return guessTail(w);
}
const skeleton = tail => tail.split(' ').filter(p => VOWEL.test(p)).join(' ');
const loose = tail => tail.replace(/ (Z|S)$/, '').replace(/\bNG\b/g, 'N').replace(/\bAO\b/g, 'AA').replace(/ D$/, ' T');
// 2 = it rhymes, 1 = the vowels match (the slant rhyme rap runs on), 0 = no
export function rhymes(a, b) {
  a = a.toLowerCase(); b = b.toLowerCase();
  if (!a || !b || a === b) return 0;
  const ta = tailOf(a), tb = tailOf(b); if (!ta || !tb) return 0;
  if (loose(ta) === loose(tb)) return 2;
  const sa = skeleton(ta), sb = skeleton(tb);
  if (sa && sa === sb) return 1;
  // multi-syllable tail vs a single stressed vowel: "desire" / "fly" style near misses
  const la = sa.split(' '), lb = sb.split(' ');
  if (la.length !== lb.length && la[la.length - 1] === lb[lb.length - 1] && la[0] === lb[0]) return 1;
  return 0;
}

// ------------------------------------------------------------------ vocabulary
export const STOP = new Set(("a an the and or but if so to of in on at by for with from up down out off over into as is are was were be been am do does did " +
  "i me my mine you your yours he him his she her it its we us our they them their this that these those there here what who when where why how " +
  "im ive ill id youre dont cant wont aint isnt didnt gonna gotta wanna tryna finna lemme just like really very too also then than got get gets go goes going " +
  "can could would should will have has had not no yeah yes uh um oh ok okay one two it's i'm i'll don't can't that's let's y'all yall em 'em bout about still even ever every " +
  "say said says know see come came make made take want need put back way thing things some any all more much many").split(' '));
export const isContent = w => w.length > 2 && !STOP.has(w);

// keyword -> voice-bank slug. Same map the first adlib used.
const KW = {
  fire: 'fire flame flames lit hot burn burning blaze blazing heat heater fya fyre',
  wooo: 'hard raw mean sick crazy insane nuts wild dumb stupid bonkers unreal',
  chaching: 'money cash racks bands rich wealth stacks million millions wealthy fortune bread dough bag bags paid dollar dollars bucks bank guap cheddar billion billions hundreds thousands pockets profit paper check checks commas',
  drip: 'flex flexin flexing stuntin stunting drip drippin dripping swag swagger iced jewelry chain chains rolex',
  allhail: 'crown throne reign royal royalty',
  periodt: 'goat king queen legend best undefeated unmatched greatest elite top',
  bums: 'lame weak trash broke fake clown clowns flop mid corny wack',
  nocap: 'cap capping cappin lying lyin lies',
  facts: 'real truth facts fact period deadass frfr straight honest honestly',
  amen: 'god pray blessed amen lord jesus faith heaven holy soul',
  blat: 'gun guns shoot shooting blat pop bang glock drac bust bustin choppa strap',
  hegone: 'kill killed murder bodied dead finish finished done smoke smoked',
  ayy: 'love baby girl shorty bae wifey honey',
  ohhh: 'sexy fine bad badass hottie dimepiece beautiful gorgeous stunning',
  oooh: 'kiss lips curves touch',
  brrr: 'cold ice freeze frozen chill chillin frost arctic',
  gogetit: 'grind hustle work workin working trap trappin move movin moving grindin grinding',
  nosleep: 'woke early sunrise morning noon',
  nightshift: 'midnight late tonight overnight',
  represent: 'block hood streets city town coast side',
  ownit: 'west east north south cali california york atl atlanta chicago chi detroit texas houston miami seattle',
  rightnow: 'time now today clock',
  forlife: 'forever always eternal infinite endless',
  respect: 'young dayone original og vintage classic throwback',
  weoutside: 'fam bro dawg gang crew squad team homies homie brothers sisters',
  sheesh: 'sheesh swear word damn',
  bars: 'bars rhyme rhymes flow spit spittin spitting rap rapper',
  nahfr: 'nah never',
  skrrt: 'ride riding whip car drive driving speed speeding',
  wayup: 'high sky clouds elevated soaring',
  easy: 'slow easy calm soft quiet smooth',
  gooff: 'watch listen check peep yo',
};
const KW_INDEX = new Map();
for (const [slug, list] of Object.entries(KW)) for (const w of list.split(' ')) if (!KW_INDEX.has(w)) KW_INDEX.set(w, slug);
export const keywordSlug = w => KW_INDEX.get(w) || null;
