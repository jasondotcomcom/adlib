// main.js — the page. Two views of one beat: build it, then rap on it.
import { song, vibe, VIBES, KITS, ROWS, ROW_LABELS, STEPS, loadVibe, diceRow, diceAll, rollBeat, newMelody, encodeSong, decodeSong, shownBpm, chordFor, beatFromVoice } from './song.js';
import * as engine from './engine.js';
import { ears, startEars, stopEars, slice, micRate } from './ears.js';
import { voice, buildVoice, voiceDrum, voiceNote, voiceTag, voiceChop, voiceRiser, rollSay, packTake, unpack, toWav, fromWav, TAKE_RATE } from './voicekit.js';
import { words, startWords, stopWords, onWord, feed } from './words.js';
import { hype, startHype, stopHype, setMode } from './hype.js';
import { initStage, setPerforming, setDecks } from './stage.js';
import { deck, startDeck, stopDeck } from './decks.js';

const $ = id => document.getElementById(id);
const NOTE = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
let cells = [], tape = [], view = 'build', lastStepEl = -1;
const DIE = '<svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true"><rect x="2" y="2" width="16" height="16" rx="3" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="6.6" cy="6.6" r="1.5"/><circle cx="13.4" cy="6.6" r="1.5"/><circle cx="10" cy="10" r="1.5"/><circle cx="6.6" cy="13.4" r="1.5"/><circle cx="13.4" cy="13.4" r="1.5"/></svg>';

// ------------------------------------------------------------------ build view
function buildVibes() {
  const nav = $('vibes'); nav.textContent = '';
  for (const v of VIBES) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'vibe'; b.textContent = v.name; b.dataset.id = v.id;
    b.addEventListener('click', async () => { await wake(); const mine = song.kit === 'you'; loadVibe(v.id); if (mine) song.kit = 'you'; engine.applyKit(); tell('you picked'); render(); if (!engine.isPlaying()) engine.play(); syncPlay(); });
    nav.appendChild(b);
  }
}
function buildGrid() {
  const grid = $('grid'); grid.textContent = ''; cells = [];
  ROWS.forEach((name, r) => {
    const row = document.createElement('div'); row.className = 'row'; row.dataset.row = name;
    const label = document.createElement('button'); label.type = 'button'; label.className = 'label'; label.textContent = ROW_LABELS[r];
    label.title = `Hear the ${ROW_LABELS[r].toLowerCase()}`;
    label.addEventListener('click', async () => { await wake(); engine.audition(r); });
    row.appendChild(label);
    const lane = document.createElement('div'); lane.className = 'lane'; cells[r] = [];
    for (let s = 0; s < STEPS; s++) {
      const c = document.createElement('button'); c.type = 'button'; c.className = 'cell'; c.dataset.r = r; c.dataset.s = s;
      c.setAttribute('aria-label', `${ROW_LABELS[r]} step ${s + 1}`);
      lane.appendChild(c); cells[r][s] = c;
    }
    row.appendChild(lane);
    const dice = document.createElement('button'); dice.type = 'button'; dice.className = 'dice'; dice.innerHTML = DIE;
    dice.title = `Roll the ${ROW_LABELS[r].toLowerCase()}`; dice.setAttribute('aria-label', dice.title);
    dice.addEventListener('click', async () => { await wake(); diceRow(r); render(); saveHash(); });
    row.appendChild(dice);
    grid.appendChild(row);
  });

  // tap or drag to paint
  let painting = null;
  const cellAt = e => { const el = document.elementFromPoint(e.clientX, e.clientY); return el && el.classList.contains('cell') ? el : null; };
  const paint = el => {
    const r = +el.dataset.r, s = +el.dataset.s;
    if (song.pat[r][s] === painting.to) return;
    song.pat[r][s] = painting.to; el.classList.toggle('on', !!painting.to); el.setAttribute('aria-pressed', !!painting.to);
    if (painting.to) engine.audition(r);
  };
  grid.addEventListener('pointerdown', async e => {
    const el = cellAt(e); if (!el) return;
    e.preventDefault(); await wake();
    painting = { to: song.pat[+el.dataset.r][+el.dataset.s] ? 0 : 1, row: +el.dataset.r };
    paint(el);
  });
  grid.addEventListener('pointermove', e => { if (!painting) return; const el = cellAt(e); if (el && +el.dataset.r === painting.row) paint(el); });
  const end = () => { if (painting) { painting = null; saveHash(); } };
  window.addEventListener('pointerup', end); window.addEventListener('pointercancel', end);
  // keyboard: buttons toggle with Enter/Space
  grid.addEventListener('click', async e => {
    if (e.detail !== 0) return;                              // real pointer clicks were handled above
    const el = e.target.closest('.cell'); if (!el) return;
    await wake(); const r = +el.dataset.r, s = +el.dataset.s;
    song.pat[r][s] = song.pat[r][s] ? 0 : 1; if (song.pat[r][s]) engine.audition(r); render(); saveHash();
  });
}
function buildTape() {
  const el = $('tape'); el.textContent = ''; tape = [];
  for (let s = 0; s < STEPS; s++) { const d = document.createElement('i'); el.appendChild(d); tape.push(d); }
}

function render() {
  const v = vibe();
  for (const b of $('vibes').children) b.setAttribute('aria-pressed', b.dataset.id === song.vibe);
  for (let r = 0; r < ROWS.length; r++) for (let s = 0; s < STEPS; s++) { const on = !!song.pat[r][s]; cells[r][s].classList.toggle('on', on); cells[r][s].setAttribute('aria-pressed', on); }
  for (let s = 0; s < STEPS; s++) { let n = 0; for (let r = 0; r < 3; r++) n += song.pat[r][s]; tape[s].dataset.n = n; }
  $('bpm').textContent = shownBpm();
  $('swing').value = song.swing; $('swingVal').textContent = song.swing === 50 ? 'straight' : `${song.swing}%`;
  $('key').textContent = NOTE[((chordFor(0).root % 12) + 12) % 12] + (v.scale === 'major' ? '' : 'm');
  for (const b of $('kit').children) { b.setAttribute('aria-pressed', b.dataset.kit === song.kit); if (b.dataset.kit === 'you') b.hidden = !voice.ready; }
  $('bassBtn').setAttribute('aria-pressed', song.bass); $('keysBtn').setAttribute('aria-pressed', song.keys); $('leadBtn').setAttribute('aria-pressed', song.lead);
  if (!/^didn't/.test($('sayLine').textContent)) tell();
}
function syncPlay() { const on = engine.isPlaying(); $('playBtn').setAttribute('aria-label', on ? 'Pause' : 'Play'); $('playBtn').setAttribute('aria-pressed', on); }
const withVoice = () => song.kit === 'you' && voice.ready && voice.id;
function saveHash() { try { history.replaceState(null, '', '#b=' + encodeSong() + (withVoice() ? '&v=' + voice.id : '')); } catch {} }

// the front door shows only the voice row. the machine opens under it once there is a beat.
const simple = () => document.body.hasAttribute('data-start');
function openUp() { if (!simple()) return; document.body.removeAttribute('data-start'); document.body.classList.add('opened'); fitSay(); }

// ------------------------------------------------------------------ beats made so far
// A beat counts once it has played for ten seconds without being changed, however it was
// made: a voice take, a roll, a style tap or by hand. Each beat counts once, and one that
// arrived in a link is somebody else's until it is changed.
const COUNT_AFTER = 10000;
const counted = new Set();
let total = null, takeNo = 0, beatKey = '', beatSince = 0;
const keyNow = () => encodeSong() + (song.kit === 'you' ? '|take' + takeNo : '');
function showTotal() {
  if (total == null) return;
  const el = $('beatCount'); el.textContent = `${total.toLocaleString('en-US')} ${total === 1 ? 'beat' : 'beats'} made so far.`; el.hidden = false;
}
function watchBeats() {
  fetch('/api/beats').then(r => (r.ok ? r.json() : null)).then(j => { if (j && Number.isFinite(j.n)) { total = j.n; showTotal(); } }).catch(() => {});
  setInterval(() => {
    if (!engine.isPlaying()) { beatSince = 0; return; }
    const k = keyNow(), now = performance.now();
    if (k !== beatKey || !beatSince) { beatKey = k; beatSince = now; return; }
    if (now - beatSince < COUNT_AFTER || counted.has(k)) return;
    counted.add(k);
    fetch('/api/beats', { method: 'POST' }).then(r => { if (r.ok && total != null) { total++; showTotal(); } }).catch(() => {});
  }, 500);
}

let incoming = null;                 // { id, data } promise for a voice that came with the link
async function wake() {
  await engine.initAudio();
  if (!incoming) return;
  const job = incoming; incoming = null;
  const got = await job;
  if (got && buildVoice(unpack(got.pcm), TAKE_RATE)) { voice.pcm = got.pcm; voice.id = got.id; song.kit = 'you'; counted.add(keyNow()); engine.applyKit(); render(); }
}

function wireControls() {
  $('playBtn').addEventListener('click', async () => { await wake(); engine.isPlaying() ? engine.pause() : engine.play(); syncPlay(); });
  $('stopBtn').addEventListener('click', () => { engine.stop(); syncPlay(); });
  const tempo = d => { song.bpm = Math.max(50, Math.min(180, song.bpm + d)); render(); saveHash(); };
  hold($('bpmDown'), () => tempo(-1)); hold($('bpmUp'), () => tempo(1));
  $('swing').addEventListener('input', e => { song.swing = +e.target.value; render(); }); $('swing').addEventListener('change', saveHash);
  $('keyDown').addEventListener('click', () => { song.key = Math.max(-6, song.key - 1); newKey(); });
  $('keyUp').addEventListener('click', () => { song.key = Math.min(6, song.key + 1); newKey(); });
  const newKey = () => { render(); saveHash(); };
  for (const k of KITS) {
    const b = document.createElement('button'); b.type = 'button'; b.dataset.kit = k; b.textContent = k[0].toUpperCase() + k.slice(1);
    if (k === 'you') b.hidden = true;
    b.addEventListener('click', async () => { await wake(); song.kit = k; engine.applyKit(); if (k === 'you') engine.restartArc(); render(); saveHash(); });
    $('kit').appendChild(b);
  }
  $('bassBtn').addEventListener('click', () => { song.bass = !song.bass; render(); saveHash(); });
  $('keysBtn').addEventListener('click', () => { song.keys = !song.keys; render(); saveHash(); });
  $('leadBtn').addEventListener('click', () => { song.lead = !song.lead; render(); saveHash(); });
  $('melodyBtn').addEventListener('click', async () => { await wake(); newMelody(); song.lead = true; song.bass = true; render(); saveHash(); });
  $('rollBtn').addEventListener('click', async () => { await wake(); const was = song.vibe; rollBeat(); engine.applyKit(); tell('i rolled', song.vibe === was); render(); saveHash(); if (!engine.isPlaying()) { engine.play(); syncPlay(); } });
  $('clearBtn').addEventListener('click', () => { song.pat = ROWS.map(() => new Array(STEPS).fill(0)); render(); saveHash(); });
  $('shareBtn').addEventListener('click', share);
  $('micBtn').addEventListener('click', perform);
  $('sayRoll').innerHTML = DIE; $('sayWord').value = rollSay(); fitSay();
  $('sayRoll').addEventListener('click', () => { $('sayWord').value = rollSay(); fitSay(); });
  $('sayWord').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); } });   // type your own thing to say
  $('sayWord').addEventListener('input', e => { if (/[\r\n]/.test(e.target.value)) e.target.value = e.target.value.replace(/\s*[\r\n]+\s*/g, ' '); fitSay(); });
  $('sayWord').addEventListener('blur', e => { e.target.value = e.target.value.trim() || rollSay(); fitSay(); });
  window.addEventListener('resize', fitSay);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(fitSay);
  $('sayBtn').addEventListener('click', sayIt);
  $('skipBtn').addEventListener('click', async () => { openUp(); tell('i picked'); await wake(); if (!engine.isPlaying()) engine.play(); syncPlay(); saveHash(); });
  $('shareVoice').addEventListener('click', shareWithVoice);
  $('sharePlain').addEventListener('click', () => { $('shareSheet').hidden = true; sendLink(true); });
  $('shareCancel').addEventListener('click', () => { $('shareSheet').hidden = true; });
  $('backBtn').addEventListener('click', backToBeat);
  $('decksLink').addEventListener('click', e => { e.preventDefault(); decks(); });
  $('decksBack').addEventListener('click', leaveDecks);
  $('modeBtn').addEventListener('click', () => { const m = hype.mode === 'hype' ? 'boom' : 'hype'; setMode(m); $('modeBtn').textContent = m === 'hype' ? 'Hype voice' : 'Boom voice'; });
  $('phonesBtn').addEventListener('click', async () => {
    const on = $('phonesBtn').getAttribute('aria-pressed') !== 'true'; $('phonesBtn').setAttribute('aria-pressed', on);
    if (view === 'perform') await listen(on);
  });
  $('wordsBtn').addEventListener('click', () => { const on = $('wordsBtn').getAttribute('aria-pressed') !== 'true'; $('wordsBtn').setAttribute('aria-pressed', on); $('ticker').hidden = !on; });
  $('retryMic').addEventListener('click', () => listen($('phonesBtn').getAttribute('aria-pressed') === 'true'));
  document.addEventListener('keydown', e => {
    if (e.target.closest('input,textarea')) return;
    if (e.code === 'Space' && !simple() && !e.target.closest('button')) { e.preventDefault(); $('playBtn').click(); }
    if (e.key === 'Escape' && view === 'perform') backToBeat();
    if (e.key === 'Escape' && view === 'decks') leaveDecks();
    if (e.key === '`') $('debug').hidden = !$('debug').hidden;
  });
  engine.on('step', (abs, t) => { stepQueue.push({ s: abs % STEPS, t }); if (stepQueue.length > 64) stepQueue.shift(); });
}
// The phrase to say always shows whole. It shrinks to fit on one line, and once it
// reaches 16px (any smaller and iPhones zoom the page when you tap it) it wraps instead.
let pen = null;
function fitSay() {
  const el = $('sayWord'); el.style.fontSize = ''; el.style.height = '';
  const cs = getComputedStyle(el), full = parseFloat(cs.fontSize), room = el.clientWidth; if (!room) return;
  pen = pen || document.createElement('canvas').getContext('2d'); pen.font = `${cs.fontWeight} ${full}px ${cs.fontFamily}`;
  const need = pen.measureText(el.value.toLowerCase()).width + 3;
  el.style.fontSize = Math.max(16, Math.min(full, Math.floor((full * room / need) * 10) / 10)) + 'px';
  el.style.height = 'auto'; el.style.height = el.scrollHeight + 'px';
}
function hold(btn, fn) {
  let timer = null, rep = null;
  const stop = () => { clearTimeout(timer); clearInterval(rep); };
  btn.addEventListener('pointerdown', () => { fn(); timer = setTimeout(() => { rep = setInterval(fn, 60); }, 350); });
  for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) btn.addEventListener(ev, stop);
  btn.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') fn(); });
}

// playhead, drawn when the step is actually heard
const stepQueue = [];
function playhead() {
  requestAnimationFrame(playhead);
  const ctx = engine.getCtx(); if (!ctx) return;
  let s = -1;
  while (stepQueue.length && stepQueue[0].t <= ctx.currentTime) s = stepQueue.shift().s;
  if (!engine.isPlaying()) { if (lastStepEl !== -1) { mark(lastStepEl, false); lastStepEl = -1; } stepQueue.length = 0; return; }
  if (s < 0 || s === lastStepEl) return;
  if (lastStepEl !== -1) mark(lastStepEl, false);
  mark(s, true); lastStepEl = s;
}
function mark(s, on) { for (let r = 0; r < ROWS.length; r++) cells[r][s].classList.toggle('now', on); tape[s].classList.toggle('now', on); }

async function share() {
  if (song.kit === 'you' && voice.ready && !voice.id) { $('shareSheet').hidden = false; return; }   // sharing your voice saves your clip: ask first
  sendLink();
}
async function shareWithVoice() {
  const btn = $('shareVoice'); btn.disabled = true; btn.textContent = 'Saving';
  try {
    const r = await fetch('/api/voice', { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: toWav(voice.pcm) });
    if (!r.ok) throw new Error(r.status);
    voice.id = (await r.json()).id;
  } catch { toast("couldn't save your voice. sharing the beat without it."); }
  btn.disabled = false; btn.textContent = 'With my voice'; $('shareSheet').hidden = true;
  sendLink();
}
async function sendLink(plain) {
  saveHash();
  const url = plain ? location.href.replace(/&v=[a-z0-9]+/, '') : location.href;
  try {
    if (navigator.share && /Mobi|Android/i.test(navigator.userAgent)) await navigator.share({ title: 'adlib', text: 'Rap on my beat.', url });
    else { await navigator.clipboard.writeText(url); toast('Beat link copied'); }
  } catch { toast('Copy the link from the address bar'); }
}
let toastTimer = null;
function toast(msg) { const t = $('toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2200); }

// ------------------------------------------------------------------ say a word, get a beat
const SAY_LINE = "say it loud. your voice is the beat.";
const TAKE = 2.4;
let taking = false;
// The line over the voice row says where the beat came from and keeps up with it:
// "i heard boom bap. 86 bpm.", "i rolled trap. 140 bpm.", "you picked soul. 84 bpm."
let told = null, again = false;
function tell(who, same) {
  if (who !== undefined) { told = who; again = !!same; }
  if (told && !taking) $('sayLine').textContent = `${told} ${vibe().name.toLowerCase()}${again ? ' again' : ''}. ${shownBpm()} bpm.`;
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function sayIt() {
  if (taking) return; taking = true;
  const btn = $('sayBtn'), line = $('sayLine');
  await wake();
  const ctx = engine.getCtx(), was = engine.isPlaying();
  if (was) { engine.stop(); syncPlay(); }                    // quiet, so the only thing in the recording is you
  try { await startEars({ headphones: true }); }             // raw mic: no noise suppression chewing the consonants
  catch { line.textContent = 'the mic is blocked. allow it and try again.'; taking = false; if (was) { engine.play(); syncPlay(); } return; }
  await sleep(350);                                          // let the mic settle
  const t0 = ctx.currentTime;
  btn.style.setProperty('--take', TAKE + 's'); btn.classList.add('live'); line.textContent = 'say it';
  await sleep(TAKE * 1000);
  const data = slice(t0, ctx.currentTime), sr = micRate();
  stopEars(); btn.classList.remove('live');
  const pcm = data && packTake(data, sr), ok = pcm && buildVoice(unpack(pcm), TAKE_RATE);
  if (ok) { voice.pcm = pcm; voice.id = null; }
  if (ok) { const made = beatFromVoice(voice.parts); takeNo++; song.kit = 'you'; engine.applyKit(); openUp(); told = 'i heard'; again = false; line.textContent = `i heard ${made.name.toLowerCase()}. ${made.bpm} bpm.`; }
  else line.textContent = "didn't catch that. say it louder.";
  render(); saveHash();
  if (ok || was) { if (!engine.isPlaying()) engine.play(); else engine.restartArc(); syncPlay(); }
  if (!ok) setTimeout(() => { if (taking) return; if (told) tell(); else line.textContent = SAY_LINE; }, 5000);
  taking = false;
}

// ------------------------------------------------------------------ perform view
async function perform() {
  await wake();
  if (!engine.isPlaying()) { engine.play(); syncPlay(); }
  view = 'perform'; document.body.dataset.view = 'perform'; setPerforming(true);
  $('status').textContent = 'let me hear you. allow the mic.';
  await listen($('phonesBtn').getAttribute('aria-pressed') === 'true');
}
async function listen(headphones) {
  $('micHelp').hidden = true;
  stopHype(); stopWords();
  try { await startEars({ headphones }); }
  catch (err) {
    $('status').textContent = '';
    $('micHelpText').textContent = err && err.name === 'NotAllowedError'
      ? 'the mic is blocked. allow it in your browser\'s site settings and try again.'
      : 'i can\'t find a mic. check your input and try again.';
    $('micHelp').hidden = false; return;
  }
  if (view !== 'perform') return stopEars();
  startHype();
  $('status').textContent = 'give me one bar';
  startWords().then(() => { if (view === 'perform') statusSoon(); });
  statusSoon();
}
function statusSoon() {
  const ctx = engine.getCtx(), wait = Math.max(0, hype.readyAt - ctx.currentTime);
  clearTimeout(statusSoon.t);
  statusSoon.t = setTimeout(() => {
    if (view !== 'perform' || !ears.on) return;
    $('status').textContent = words.recent.length ? 'i hear every word' : 'i hear you';
  }, wait * 1000 + 50);
}
onWord(() => { if (view === 'perform' && words.recent.length === 1 && engine.getCtx().currentTime > hype.readyAt) $('status').textContent = 'i hear every word'; });
function backToBeat() {
  view = 'build'; document.body.dataset.view = 'build';
  stopHype(); stopWords(); stopEars(); setPerforming(false);
  $('micHelp').hidden = true;
}

// ------------------------------------------------------------------ decks view
async function decks() {
  openUp(); await wake();
  if (!engine.isPlaying()) { engine.play(); syncPlay(); }
  view = 'decks'; document.body.dataset.view = 'decks'; scrollTo(0, 0); setDecks(true);
  await startDeck($('decks'), $('keepBtn'), () => { render(); saveHash(); });
}
function leaveDecks() {
  view = 'build'; document.body.dataset.view = 'build';
  stopDeck(); setDecks(false);
}

// ------------------------------------------------------------------ debug (press `)
function debugLoop() {
  const el = $('debug');
  setInterval(() => {
    if (el.hidden) return;
    const l = hype.log.slice(-8).map(x => `${x.t.toFixed(1)} ${x.type} ${x.text}`).join('\n');
    el.textContent = `heat ${hype.heat.toFixed(0)}  level ${ears.level.toFixed(2)}  thr ${ears.thr.toFixed(3)}  bleed ${ears.bleed.toFixed(3)}  floor ${ears.floor.toFixed(4)}\n` +
      `phrase ${ears.inPhrase ? 'YES' : 'no'}  phrases ${hype.phrases}  fires ${hype.fires}  words: ${words.engine} (${words.status})\n` +
      `heard: ${words.recent.slice(-8).map(x => x.w).join(' ')}\n${l}`;
  }, 200);
}

// ------------------------------------------------------------------ boot
function boot() {
  const m = location.hash.match(/b=([^&]+)/);
  const came = !!(m && decodeSong(decodeURIComponent(m[1])));
  if (came) document.body.removeAttribute('data-start');
  else { loadVibe('boombap'); document.body.setAttribute('data-start', ''); }
  if (song.kit === 'you') song.kit = vibe().kit;             // until the voice itself has arrived
  if (came) counted.add(keyNow());                           // a beat from a link is not one made here
  const vm = location.hash.match(/[&#]v=([a-z0-9]{8,20})/);
  if (vm) {
    incoming = fetch('/api/voice?id=' + vm[1]).then(r => (r.ok ? r.arrayBuffer() : null)).then(b => { const pcm = b && fromWav(b); return pcm ? { id: vm[1], pcm } : null; }).catch(() => null);
    $('sayLine').textContent = 'this beat is made of a voice. hit play.';
  }
  engine.setOwnKit({ ready: () => voice.ready, drum: voiceDrum, note: voiceNote, tag: voiceTag, chop: voiceChop, riser: voiceRiser });
  buildVibes(); buildGrid(); buildTape(); wireControls(); render(); initStage(); playhead(); debugLoop(); watchBeats();
  if (new URLSearchParams(location.search).has('debug')) $('debug').hidden = false;
  if (/^\/testdj\/?$/.test(location.pathname)) $('decksLink').hidden = false;   // the decks are only reachable here while they're being tested
  window.adlib = { song, engine, ears, words, hype, feed, voice, buildVoice, deck };
}
boot();
