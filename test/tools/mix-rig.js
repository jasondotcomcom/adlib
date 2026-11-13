// Measure 8 bars of the master per style: loudness, peak, band levels (dB), stereo width, mono loss.
const { chromium } = require('playwright');
const base = process.argv[2] || 'http://localhost:8765/index.html', tag = process.argv[3] || '';
(async () => {
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--autoplay-policy=no-user-gesture-required', '--no-sandbox', '--disable-webgl'] });
  const page = await (await browser.newContext({ viewport: { width: 390, height: 760 } })).newPage(); const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  await page.goto(base, { waitUntil: 'domcontentloaded' }); await page.waitForTimeout(900);
  await page.click('#skipBtn'); await page.waitForTimeout(800);
  const rows = [];
  for (const vibe of ['lofi', 'soul', 'boombap', 'gfunk', 'afro', 'trap', 'drill', 'jersey']) {
    rows.push(await page.evaluate(async ([vibe, tag]) => {
      const S = await import('./js/song.js'), eng = adlib.engine, ctx = eng.getCtx();
      eng.stop(); S.loadVibe(vibe); if ('tone' in S.song) S.song.tone = 'full'; S.song.seed = 77; eng.applyKit();
      if (!window.__rig) {
        const sp = ctx.createChannelSplitter(2), aL = ctx.createAnalyser(), aR = ctx.createAnalyser(), aM = ctx.createAnalyser();
        for (const a of [aL, aR, aM]) { a.fftSize = 8192; a.smoothingTimeConstant = 0; }
        eng.nodes.out.connect(sp); sp.connect(aL, 0); sp.connect(aR, 1); eng.nodes.out.connect(aM);
        window.__rig = { aL, aR, aM };
      }
      const { aL, aR, aM } = window.__rig, L = new Float32Array(8192), R = new Float32Array(8192), F = new Float32Array(4096), bin = ctx.sampleRate / 8192;
      eng.play(); await new Promise(z => setTimeout(z, 1500));
      const bars = 8, ms = bars * 16 * eng.stepDur() * 1000, end = performance.now() + Math.min(ms, 14000);
      let ss = 0, n = 0, peak = 0, side = 0, mid = 0, lr = 0; const band = { sub: 0, bass: 0, lowmid: 0, mid: 0, top: 0 }, edges = { sub: [20, 60], bass: [60, 150], lowmid: [150, 500], mid: [500, 2000], top: [2000, 12000] };
      while (performance.now() < end) {
        aL.getFloatTimeDomainData(L); aR.getFloatTimeDomainData(R);
        for (let i = 0; i < 8192; i++) { const l = L[i], r = R[i]; ss += (l * l + r * r) / 2; n++; peak = Math.max(peak, Math.abs(l), Math.abs(r)); side += ((l - r) / 2) ** 2; mid += ((l + r) / 2) ** 2; lr += (l * l + r * r) / 2; }
        aM.getFloatFrequencyData(F);
        for (const [k, [lo, hi]] of Object.entries(edges)) for (let i = Math.ceil(lo / bin); i < hi / bin; i++) band[k] += 10 ** (F[i] / 10);
        await new Promise(z => setTimeout(z, 90));
      }
      eng.stop();
      const db = x => +(10 * Math.log10(x)).toFixed(1), tot = Object.values(band).reduce((a, b) => a + b, 0), out = { style: vibe };
      out.rms = db(ss / n); out.peak = +(20 * Math.log10(peak)).toFixed(1);
      for (const k in band) out[k] = db(band[k] / tot);
      out.width = +(Math.sqrt(side / Math.max(1e-9, mid))).toFixed(2); out.monoLoss = +(db(lr / n) - db(mid / n)).toFixed(1);
      return out;
    }, [vibe, tag]));
  }
  const cols = ['style', 'rms', 'peak', 'sub', 'bass', 'lowmid', 'mid', 'top', 'width', 'monoLoss'];
  console.log(tag + '\n' + cols.map(c => c.padStart(8)).join(''));
  for (const r of rows) console.log(cols.map(c => String(r[c]).padStart(8)).join(''));
  if (errs.length) console.log('ERR', JSON.stringify(errs));
  await browser.close();
})();
