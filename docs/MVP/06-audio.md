# 06 — Audio

Scope (confirmed): **full SFX and crowd**, plus organ stingers. **No announcer voice** in the MVP.

## 1. Mix layers

| Bus | Contents |
|-----|----------|
| **Mechanical** | Flipper up/down (coil thunk + rubber), flipper EOS click, slingshots, pop bumpers (three pitch variants), corner kickers, ball-on-rubber, ball-on-metal, ball-on-wood, ball drop into saucer (thock + rattle), drop targets falling and resetting, standup thwack, spinner whirr (rate follows spin speed), VUK pop, pitch kicker, magnet hum, gates, HR gate spin, plunger pull and release, kickback, **ball roll** (playfield, ramp plastic, wireform metal), nudge thump, tilt buzz |
| **Stadium** | Crowd ambience bed (murmur), reactive layers (anticipation swell, cheers tiered by hit type, big HR roar, groan on strikeout, "ooh" on near misses and ramp rollbacks), rally chant, distant vendor calls and PA-style ambience (wordless), fireworks, light-tower clunks |
| **Music / organ** | Original ballpark-organ stingers: inning start, rally riff, HR fanfare, 7th-inning stretch interlude, game over. A subtle attract-mode loop. |
| **UI** | Menu ticks, initials entry, high score jingle |

The organ music must be **original**. No recognisable ballpark tunes, which may be under copyright.

## 2. Behaviour

- **Velocity layering:** impact sounds choose a soft, medium or hard sample by impact speed, with
  gain scaled to impulse. Each play varies pitch by ±3 % and picks a random sample variant to avoid
  machine-gun repetition.
- **Ball roll:** a continuous loop whose gain and playback rate follow ball speed. The surface
  (playfield, ramp or wireform) crossfades between loops. A short "settle" sound plays when the ball
  stops in a saucer.
- **Spatial:** stereo pan follows the ball's x position. A gentle low-pass and level drop follow y,
  so the far end of the table sounds farther away. No HRTF.
- **Crowd intensity model:** one parameter (0–1) driven by game state: runners in scoring position,
  rally count, late innings, two outs. It crossfades crowd layers so tension builds naturally.
  Reactions are triggered by presentation events.
- **Ducking:** stingers briefly duck the crowd bed by about 4 dB.
- **Voice limits:** at most 24 simultaneous voices. Mechanical sounds have priority. Polyphony per
  sound is capped (for example, at most 3 pop bumpers at once).
- **Pause / hidden:** fade out over 150 ms and suspend the AudioContext.

## 3. Implementation

- **Web Audio API** through a small engine: an `AudioContext` with buses (master → mechanical,
  stadium, music, UI) and a `GainNode` per bus tied to the settings sliders.
- **Unlock** the AudioContext on the first user gesture (required on iOS and Chrome). The title screen
  "Tap to Play" provides it.
- **Decoding:** preload `AudioBuffer`s for every SFX. Long crowd beds and music also use
  `AudioBuffer`, with `loopStart`/`loopEnd` for seamless loops. Avoid `<audio>` elements for
  gameplay sounds.
- **Formats:** Opus (`.webm`/`.ogg`) as primary, with AAC (`.m4a`) as fallback, chosen by
  feature detection.
- **Synthesis:** the organ is a Web Audio tonewheel-style additive synth with a Leslie-ish tremolo,
  so stingers are composed as note data, are small, and are easy to iterate. Tilt buzz and some UI
  sounds are also synthesised.
- **Budget:** ≤ 6 MB of compressed audio for the MVP. Crowd beds stream after first play if needed.

## 4. Sourcing and licensing

- **Preferred sources:** CC0 libraries (Freesound with the CC0 filter, Kenney), royalty-free
  bundles whose license allows web-game redistribution (for example, the Sonniss GDC bundles; check
  the terms when used), and our own synthesis or recordings.
- **Real pinball mechanical sounds:** use CC0 recordings where available. Otherwise, layer foley
  (solenoid-like thunks, rubber snaps, steel ball on wood).
- **License manifest:** every file is listed in `assets-src/audio/LICENSES.md` with source, author,
  license and any modifications. Files without a clear license are not used.

## 5. Settings

Master, mechanical/SFX, crowd and music/organ volume sliders. A mute toggle (key **M**). Audio is
muted automatically while the game is paused.
