// How the "beats made so far" number is kept, without a database.
// Every counted beat leaves one tiny marker in the Blob store, filed under its day:
//   <root>d/2026-11-12/<random id>
// Once a day (api/sweep.js) the finished days are folded into a single total marker,
//   <root>total/2026-11-11_1204        "1,204 beats through the 11th"
// and the markers already folded are cleared out. The number is the latest total plus
// every marker from a day after it. Only names are read, never contents, and each name
// is written once, so two people finishing a beat at the same moment can't collide.
const START = 58;        // Jason's own beats from before the counter existed

const root = () => (process.env.VERCEL_ENV === 'production' ? 'beats/' : 'beats-test/');
const dayOf = (ms = Date.now()) => new Date(ms).toISOString().slice(0, 10);

function tally(paths, r) {
  let base = START, through = ''; const days = {};
  for (const p of paths) {
    if (!p.startsWith(r)) continue;
    const rest = p.slice(r.length);
    let m = /^total\/(\d{4}-\d{2}-\d{2})_(\d+)$/.exec(rest);
    if (m) { if (m[1] > through) { through = m[1]; base = +m[2]; } continue; }
    m = /^d\/(\d{4}-\d{2}-\d{2})\/[a-z0-9]+$/.exec(rest);
    if (m) days[m[1]] = (days[m[1]] || 0) + 1;
  }
  let live = 0; for (const d in days) if (d > through) live += days[d];
  return { n: base + live, base, through, days };
}

// What the daily job should do: which names to clear, and the new total to write (if any).
function fold(paths, r, today) {
  const t = tally(paths, r), remove = [];
  for (const p of paths) {
    if (!p.startsWith(r)) continue;
    const rest = p.slice(r.length);
    let m = /^d\/(\d{4}-\d{2}-\d{2})\//.exec(rest);
    if (m && m[1] <= t.through) { remove.push(p); continue; }           // folded on an earlier run
    m = /^total\/(\d{4}-\d{2}-\d{2})_/.exec(rest);
    if (m && m[1] < t.through) remove.push(p);                          // an older total
  }
  let add = 0, upto = '';
  for (const d in t.days) if (d > t.through && d < today) { add += t.days[d]; if (d > upto) upto = d; }
  return { remove, write: add ? `${r}total/${upto}_${t.base + add}` : null, n: t.n };
}

module.exports = { START, root, dayOf, tally, fold };
