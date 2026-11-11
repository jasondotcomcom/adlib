# adlib

The AI hype man. Build a beat, grab the mic, and he backs you up. Home: [adlib.live](https://adlib.live).

## Run it

```bash
npm run dev     # http://localhost:3000  (the mic needs localhost or https)
npm test        # beat data, share links, rhyme detection
```

No build step. Vercel serves `public/` as it is and runs `api/` as functions.

## How it works

```
public/
  index.html, css/app.css     the page
  js/song.js                  the beat as data: vibes, pattern, share links, dice
  js/engine.js                the sound: clock, mix bus, drums, 808, keys, lead
  js/ears.js + mic-worklet.js the mic: phrases, syllables, the last 10 seconds of you
  js/words.js                 optional speech-to-text, rhyme detection, keyword map
  js/hype.js                  adlib: when he comes in, what he does, how big
  js/stage.js                 the picture: one shader, circles and lines with rings
  js/phrases.js               what each recorded line says (mirrors scripts/phrases.js)
  audio/hype, audio/boom      his recorded voice (ElevenLabs, pre-generated)
  audio/kit                   CC0 TR-808 drums and DX7 keys (see LICENSES.txt)
  data/rhymes.txt             rhyme tails built from the CMU Pronouncing Dictionary
  classic.html                the first version, untouched, at /classic
api/dg-token.js               mints short-lived Deepgram tokens (off until a key is set)
scripts/                      voice generation and the rhyme-table builder
```

**He listens to rhythm first.** The beat clock is ours, so he knows where every bar ends.
`ears.js` finds where your phrases start and stop, and `hype.js` answers in the gap, on the
grid. None of that needs speech-to-text, so it works on iPhone.

**He doubles you.** The tail of your last phrase is sampled from the mic and thrown back on
the beat with a tempo-synced echo.

**Words are a bonus layer.** When a speech engine is running he also puts your word on
screen, answers keywords from the voice bank and calls the rhyme. Engines, best first:

1. Deepgram streaming, if `DEEPGRAM_API_KEY` is set in Vercel. Works on iPhone. Costs money
   per minute of mic time for every visitor, so put a spending limit on the key.
2. The browser's own recognizer (desktop Chrome and Android), fed our echo-cancelled mic
   and run on-device where Chrome supports it.
3. Nothing. Rhythm and doubling still work.

Press the backtick key (or add `?debug`) for a live readout while you tune.

## Voice bank

`scripts/phrases.js` is what he says. `npm run generate` renders it through ElevenLabs into
`public/audio/` (needs `ELEVENLABS_API_KEY` in `.env.local`). If you change a line, change it
in `public/js/phrases.js` too so the screen matches the voice.

## Look

Circles and straight lines, yellow, red and blue on black, with rings echoing out. The
letter grid and ring spacing in `stage.js` are measured from the adlib mark. No fake paint.
