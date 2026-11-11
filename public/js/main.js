// main.js — the page. Two views of one beat: build it, then rap on it.
import { song, vibe, VIBES, KITS, ROWS, ROW_LABELS, STEPS, loadVibe, diceRow, diceAll, newMelody, encodeSong, decodeSong, shownBpm, chordFor } from './song.js';
import * as engine from './engine.js';
import { ears, startEars, stopEars } from './ears.js';
import { words, startWords, stopWords, onWord, feed } from './words.js';
import { hype, startHype, stopHype, setMode } from './hype.js';
import { initStage, setPerforming } from './stage.js';

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
    b.addEventListener('click', async () => { await wake(); loadVibe(v.id); engine.applyKit(); render(); if (!engine.isPlaying()) engine.play(); syncPlay(); });
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
  for (const b of $('kit').children) b.setAttribute('aria-pressed', b.dataset.kit === song.kit);
  $('keysBtn').setAttribute('aria-pressed', song.keys); $('leadBtn').setAttribute('aria-pressed', song.lead);
}
function syncPlay() { const on = engine.isPlaying(); $('playBtn').textContent = on ? 'Stop' : 'Play'; $('playBtn').setAttribute('aria-pressed', on); }
function saveHash() { try { history.replaceState(null, '', '#b=' + encodeSong()); } catch {} }

async function wake() { await engine.initAudio(); }

function wireControls() {
  $('playBtn').addEventListener('click', async () => { await wake(); engine.isPlaying() ? engine.stop() : engine.play(); syncPlay(); });
  const tempo = d => { song.bpm = Math.max(50, Math.min(180, song.bpm + d)); render(); saveHash(); };
  hold($('bpmDown'), () => tempo(-1)); hold($('bpmUp'), () => tempo(1));
  $('swing').addEventListener('input', e => { song.swing = +e.target.value; render(); }); $('swing').addEventListener('change', saveHash);
  $('keyDown').addEventListener('click', () => { song.key = Math.max(-6, song.key - 1); newKey(); });
  $('keyUp').addEventListener('click', () => { song.key = Math.min(6, song.key + 1); newKey(); });
  const newKey = () => { render(); saveHash(); };
  for (const k of KITS) {
    const b = document.createElement('button'); b.type = 'button'; b.dataset.kit = k; b.textContent = k[0].toUpperCase() + k.slice(1);
    b.addEventListener('click', async () => { await wake(); song.kit = k; engine.applyKit(); render(); saveHash(); });
    $('kit').appendChild(b);
  }
  $('keysBtn').addEventListener('click', () => { song.keys = !song.keys; render(); saveHash(); });
  $('leadBtn').addEventListener('click', () => { song.lead = !song.lead; render(); saveHash(); });
  $('melodyBtn').addEventListener('click', async () => { await wake(); newMelody(); song.lead = true; render(); saveHash(); });
  $('rollBtn').addEventListener('click', async () => { await wake(); diceAll(); render(); saveHash(); if (!engine.isPlaying()) { engine.play(); syncPlay(); } });
  $('clearBtn').addEventListener('click', () => { song.pat = ROWS.map(() => new Array(STEPS).fill(0)); render(); saveHash(); });
  $('shareBtn').addEventListener('click', share);
  $('micBtn').addEventListener('click', perform);
  $('backBtn').addEventListener('click', backToBeat);
  $('modeBtn').addEventListener('click', () => { const m = hype.mode === 'hype' ? 'boom' : 'hype'; setMode(m); $('modeBtn').textContent = m === 'hype' ? 'Hype voice' : 'Boom voice'; });
  $('phonesBtn').addEventListener('click', async () => {
    const on = $('phonesBtn').getAttribute('aria-pressed') !== 'true'; $('phonesBtn').setAttribute('aria-pressed', on);
    if (view === 'perform') await listen(on);
  });
  $('wordsBtn').addEventListener('click', () => { const on = $('wordsBtn').getAttribute('aria-pressed') !== 'true'; $('wordsBtn').setAttribute('aria-pressed', on); $('ticker').hidden = !on; });
  $('retryMic').addEventListener('click', () => listen($('phonesBtn').getAttribute('aria-pressed') === 'true'));
  document.addEventListener('keydown', e => {
    if (e.target.closest('input,textarea')) return;
    if (e.code === 'Space' && !e.target.closest('button')) { e.preventDefault(); $('playBtn').click(); }
    if (e.key === 'Escape' && view === 'perform') backToBeat();
    if (e.key === '`') $('debug').hidden = !$('debug').hidden;
  });
  engine.on('step', (abs, t) => { stepQueue.push({ s: abs % STEPS, t }); if (stepQueue.length > 64) stepQueue.shift(); });
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
  saveHash();
  const url = location.href;
  try {
    if (navigator.share && /Mobi|Android/i.test(navigator.userAgent)) await navigator.share({ title: 'adlib', text: 'Rap on my beat.', url });
    else { await navigator.clipboard.writeText(url); toast('Beat link copied'); }
  } catch { toast('Copy the link from the address bar'); }
}
let toastTimer = null;
function toast(msg) { const t = $('toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2200); }

// ------------------------------------------------------------------ perform view
async function perform() {
  await wake();
  if (!engine.isPlaying()) { engine.play(); syncPlay(); }
  view = 'perform'; document.body.dataset.view = 'perform'; setPerforming(true);
  $('status').textContent = 'Let me hear you. Allow the mic.';
  await listen($('phonesBtn').getAttribute('aria-pressed') === 'true');
}
async function listen(headphones) {
  $('micHelp').hidden = true;
  stopHype(); stopWords();
  try { await startEars({ headphones }); }
  catch (err) {
    $('status').textContent = '';
    $('micHelpText').textContent = err && err.name === 'NotAllowedError'
      ? 'The mic is blocked. Allow it in your browser\'s site settings and try again.'
      : 'I can\'t find a mic. Check your input and try again.';
    $('micHelp').hidden = false; return;
  }
  if (view !== 'perform') return stopEars();
  startHype();
  $('status').textContent = 'Give me one bar.';
  startWords().then(() => { if (view === 'perform') statusSoon(); });
  statusSoon();
}
function statusSoon() {
  const ctx = engine.getCtx(), wait = Math.max(0, hype.readyAt - ctx.currentTime);
  clearTimeout(statusSoon.t);
  statusSoon.t = setTimeout(() => {
    if (view !== 'perform' || !ears.on) return;
    $('status').textContent = words.recent.length ? 'I hear every word' : 'I hear you';
  }, wait * 1000 + 50);
}
onWord(() => { if (view === 'perform' && words.recent.length === 1 && engine.getCtx().currentTime > hype.readyAt) $('status').textContent = 'I hear every word'; });
function backToBeat() {
  view = 'build'; document.body.dataset.view = 'build';
  stopHype(); stopWords(); stopEars(); setPerforming(false);
  $('micHelp').hidden = true;
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
  if (!(m && decodeSong(decodeURIComponent(m[1])))) loadVibe('boombap');
  buildVibes(); buildGrid(); buildTape(); wireControls(); render(); initStage(); playhead(); debugLoop();
  if (new URLSearchParams(location.search).has('debug')) $('debug').hidden = false;
  window.adlib = { song, engine, ears, words, hype, feed };
}
boot();
