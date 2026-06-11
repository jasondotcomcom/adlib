# AD-LIB

The AI hype man. Live at [adlib.live](https://adlib.live).

## What's in this folder

```
adlib-live/
├── public/
│   ├── index.html        ← the app (replace with adlib-hypeman.html, renamed)
│   └── audio/
│       ├── hype/         ← Melly, hype mode (high energy)
│       └── boom/         ← future second voice (deep mode)
├── scripts/
│   ├── generate-audio.js ← runs locally, hits ElevenLabs, downloads MP3s
│   └── phrases.js        ← the lines AD-LIB will say (edit these to taste)
├── package.json
├── vercel.json
├── .env.example          ← copy to .env.local, add your key
└── .gitignore
```

## Setup (one-time)

```bash
# 1. Install Node 18+ if you don't have it
node --version  # should print v18+ or v20+

# 2. Add your ElevenLabs key
cp .env.example .env.local
# Edit .env.local and paste your real key

# 3. Drop the latest adlib-hypeman.html into public/ as index.html
mv adlib-hypeman.html public/index.html
```

## Generate the audio (one-time, or whenever you tweak phrases)

```bash
# Generate everything (hype mode by default — boom mode skipped until voice is set)
npm run generate

# Generate only hype mode
npm run generate:hype

# Regenerate one specific reaction (e.g. you didn't like how "fire" came out)
node scripts/generate-audio.js --slug fire

# Regenerate one slug in one mode
node scripts/generate-audio.js --slug fire --mode hype

# Force-overwrite all existing files (use sparingly — eats credits)
npm run generate:force
```

## Run locally

```bash
npm run dev
# Opens http://localhost:3000
```

## Deploy to adlib.live

```bash
# First time:
npx vercel link

# Every deploy:
npm run deploy
```

## Cost notes

- Free tier: **10,000 characters/month**
- Full hype-mode generation: ~1,100 characters
- Both modes (when boom voice is added): ~2,200 characters
- You have plenty of headroom for iteration. Regenerate freely.

## Adding the boom voice later

1. Pick a deep, commanding voice in your ElevenLabs library.
2. Copy its voice ID.
3. Open `scripts/generate-audio.js` and update:
   ```js
   const VOICES = {
     hype: '5WvkIGikU7UeqTpLa0HI',
     boom: 'YOUR_BOOM_VOICE_ID_HERE'
   };
   ```
4. Run `npm run generate:boom`.

## Iterating on phrases

`scripts/phrases.js` is the source of truth for what AD-LIB says. Each slug has 3
variants per mode. Edit any line, re-run `--slug <name>` to regenerate just that
one. The HTML auto-picks a random variant each time the reaction fires.
