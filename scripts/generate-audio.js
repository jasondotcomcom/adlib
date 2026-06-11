#!/usr/bin/env node
/**
 * AD-LIB voice audio generator
 * Generates all hype reaction MP3s using ElevenLabs API.
 *
 * Usage:
 *   1. Put your ElevenLabs API key in .env.local as: ELEVENLABS_API_KEY=xxx
 *   2. node scripts/generate-audio.js                  (generates all hype + boom modes)
 *   3. node scripts/generate-audio.js --mode hype      (only hype)
 *   4. node scripts/generate-audio.js --slug fire      (only one slug, useful for regenerating)
 *   5. node scripts/generate-audio.js --slug fire --mode hype
 *   6. node scripts/generate-audio.js --force          (overwrite existing files)
 *
 * Cost estimate (free tier = 10k chars/month):
 *   ~37 slugs × 3 variants × 1 mode × ~10 chars avg = ~1100 chars per mode
 *   Both modes = ~2200 chars. Well within free tier.
 */

const fs = require('fs');
const path = require('path');
const PHRASES = require('./phrases.js');

// ============= CONFIG =============
const API_KEY = process.env.ELEVENLABS_API_KEY || readEnvFile();
const VOICES = {
  // Free-tier premade voices — confirmed available on this account
  hype: 'TX3LPaxmHKxFdv7VOQHJ',  // Liam — Energetic, Social Media Creator
  boom: 'nPczCjzI2devNBz1zQrb'   // Brian — Deep, Resonant and Comforting
};
const MODEL_ID = 'eleven_turbo_v2_5'; // fast, low-latency, free-tier friendly
const OUTPUT_DIR = path.join(__dirname, '..', 'public', 'audio');

// Voice settings tuned per mode — hype = punchy, boom = slow + commanding
const SETTINGS = {
  hype: {
    stability: 0.30,         // low = more dynamic, more variation between variants
    similarity_boost: 0.70,
    style: 0.85,             // crank style high to push Adam into hype territory
    use_speaker_boost: true
  },
  boom: {
    stability: 0.55,         // steadier, more authoritative
    similarity_boost: 0.80,
    style: 0.45,             // moderate — let Brian's natural depth carry it
    use_speaker_boost: true
  }
};

// ============= HELPERS =============
function readEnvFile() {
  const envPath = path.join(__dirname, '..', '.env.local');
  if (!fs.existsSync(envPath)) return null;
  const content = fs.readFileSync(envPath, 'utf8');
  const match = content.match(/ELEVENLABS_API_KEY\s*=\s*(.+)/);
  return match ? match[1].trim().replace(/['"]/g, '') : null;
}

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { mode: null, slug: null, force: false };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--mode') opts.mode = args[++i];
    else if (args[i] === '--slug') opts.slug = args[++i];
    else if (args[i] === '--force') opts.force = true;
  }
  return opts;
}

async function generateOne(text, voiceId, settings, outPath) {
  const url = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`;
  const body = {
    text,
    model_id: MODEL_ID,
    voice_settings: settings
  };
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'xi-api-key': API_KEY,
      'Content-Type': 'application/json',
      'Accept': 'audio/mpeg'
    },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`API ${res.status}: ${errText}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, buf);
  return buf.length;
}

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ============= MAIN =============
async function main() {
  if (!API_KEY) {
    console.error('❌ No ElevenLabs API key. Set ELEVENLABS_API_KEY env var or put it in .env.local');
    process.exit(1);
  }
  const opts = parseArgs();
  const modesToRun = opts.mode ? [opts.mode] : Object.keys(VOICES);

  let totalChars = 0, totalFiles = 0, skipped = 0, failed = 0;
  const failures = [];

  for (const mode of modesToRun) {
    const voiceId = VOICES[mode];
    if (!voiceId) {
      console.log(`⚠️  Skipping mode "${mode}" — no voice ID configured.`);
      continue;
    }
    console.log(`\n🎤 Generating ${mode.toUpperCase()} mode (voice: ${voiceId})\n`);
    const settings = SETTINGS[mode];

    const slugsToRun = opts.slug ? [opts.slug] : Object.keys(PHRASES);
    for (const slug of slugsToRun) {
      const phraseSet = PHRASES[slug];
      if (!phraseSet || !phraseSet[mode]) {
        console.log(`  skip ${slug} (no ${mode} variants)`);
        continue;
      }
      const variants = phraseSet[mode];
      for (let i = 0; i < variants.length; i++) {
        const text = variants[i];
        const outPath = path.join(OUTPUT_DIR, mode, `${slug}_${i + 1}.mp3`);
        if (fs.existsSync(outPath) && !opts.force) {
          process.stdout.write(`  · ${slug}_${i + 1} (exists, skip)\n`);
          skipped++;
          continue;
        }
        try {
          process.stdout.write(`  → ${slug}_${i + 1}: "${text}" `);
          const bytes = await generateOne(text, voiceId, settings, outPath);
          totalChars += text.length;
          totalFiles++;
          console.log(`✓ ${(bytes / 1024).toFixed(1)}KB`);
          // Be polite — small pause between requests to avoid rate limits
          await sleep(120);
        } catch (e) {
          console.log(`✗ ${e.message}`);
          failed++;
          failures.push({ slug, variant: i + 1, mode, error: e.message });
        }
      }
    }
  }

  console.log(`\n=== DONE ===`);
  console.log(`Generated: ${totalFiles} files`);
  console.log(`Characters used: ${totalChars}`);
  console.log(`Skipped (already exist): ${skipped}`);
  if (failed > 0) {
    console.log(`Failed: ${failed}`);
    failures.forEach(f => console.log(`  - ${f.mode}/${f.slug}_${f.variant}: ${f.error}`));
  }
  console.log(`\nUse --force to regenerate existing files.`);
  console.log(`Use --slug <name> to regenerate just one phrase.`);
}

main().catch(e => { console.error(e); process.exit(1); });
