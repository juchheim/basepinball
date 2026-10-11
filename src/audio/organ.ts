import type { AudioEngine } from './engine';

/**
 * The ballpark organ (docs/MVP/06 § 3): an additive tonewheel-style voice (drawbar partials, a
 * percussion click on the 2nd harmonic, a Leslie-ish tremolo and vibrato) playing stingers written
 * as note data. All of the music is original; no ballpark standards are quoted.
 */

/** [beat, MIDI note(s), length in beats]. */
type Note = [number, number | number[], number];

export interface Stinger {
  bpm: number;
  notes: Note[];
}

// Chord helpers (MIDI): C4 = 60.
const C4 = 60;

export const STINGERS = {
  /** Inning start: a rising F-major call with a turn at the top. */
  inningStart: {
    bpm: 150,
    notes: [
      [0, C4 + 5, 0.5],
      [0.5, C4 + 9, 0.5],
      [1, C4 + 12, 0.5],
      [1.5, C4 + 17, 0.75],
      [2.33, C4 + 16, 0.33],
      [2.66, C4 + 14, 0.33],
      [3, [C4 + 5, C4 + 9, C4 + 12, C4 + 17], 1.5],
      [3, C4 - 7, 1.5],
    ],
  },
  /** Rally riff (rally 3+): a bouncing D figure that climbs. */
  rally: {
    bpm: 168,
    notes: [
      [0, C4 + 2, 0.5],
      [0.5, C4 + 6, 0.5],
      [1, C4 + 9, 0.5],
      [1.5, C4 + 14, 0.5],
      [2, C4 + 12, 0.5],
      [2.5, C4 + 9, 0.5],
      [3, C4 + 11, 0.5],
      [3.5, C4 + 14, 0.5],
      [4, [C4 + 14, C4 + 18, C4 + 21], 1],
      [4, C4 - 10, 1],
    ],
  },
  /** Home-run fanfare: a fast run up, a held chord with a trill, a flourish down. */
  homeRun: {
    bpm: 160,
    notes: [
      [0, C4, 0.25],
      [0.25, C4 + 4, 0.25],
      [0.5, C4 + 7, 0.25],
      [0.75, C4 + 12, 0.25],
      [1, [C4 + 12, C4 + 16, C4 + 19], 2],
      [1, C4 - 12, 2],
      [1.25, C4 + 24, 0.25],
      [1.5, C4 + 26, 0.25],
      [1.75, C4 + 24, 0.25],
      [2, C4 + 26, 0.25],
      [2.25, C4 + 24, 0.25],
      [3, C4 + 19, 0.33],
      [3.33, C4 + 17, 0.33],
      [3.66, C4 + 16, 0.33],
      [4, [C4 + 7, C4 + 12, C4 + 16, C4 + 24], 2],
      [4, C4 - 12, 2],
    ],
  },
  /** Strikeout: three notes slumping down to a low, dark chord. */
  strikeout: {
    bpm: 120,
    notes: [
      [0, C4 + 4, 0.5],
      [0.5, C4 + 3, 0.5],
      [1, C4 + 2, 0.75],
      [1.75, [C4 - 12, C4 - 9, C4 - 5], 1.25],
    ],
  },
  /** Side retired: a short cadence. */
  sideRetired: {
    bpm: 140,
    notes: [
      [0, [C4 + 7, C4 + 11, C4 + 14], 0.5],
      [0.5, [C4 + 5, C4 + 9, C4 + 12], 0.5],
      [1, [C4 + 4, C4 + 7, C4 + 12], 1.5],
      [1, C4 - 12, 1.5],
    ],
  },
  /** 7th-inning stretch: an original waltz phrase in G. */
  stretch: {
    bpm: 168,
    notes: [
      [0, C4 + 7, 1],
      [1, C4 + 11, 1],
      [2, C4 + 14, 1],
      [3, C4 + 16, 1.5],
      [4.5, C4 + 14, 0.5],
      [5, C4 + 11, 1],
      [6, C4 + 12, 1],
      [7, C4 + 9, 1],
      [8, C4 + 6, 1],
      [9, [C4 + 7, C4 + 11, C4 + 14], 3],
      [0, C4 - 17, 3],
      [3, C4 - 20, 3],
      [6, C4 - 22, 3],
      [9, C4 - 17, 3],
    ],
  },
  /** Game over: a falling cadence that resolves home. */
  gameOver: {
    bpm: 110,
    notes: [
      [0, C4 + 7, 0.5],
      [0.5, C4 + 4, 0.5],
      [1, C4, 0.5],
      [1.5, C4 + 5, 0.5],
      [2, C4 + 2, 0.5],
      [2.5, C4 - 1, 0.5],
      [3, [C4 - 12, C4 - 5, C4, C4 + 4], 2],
    ],
  },
  /** High score entry. */
  highScore: {
    bpm: 180,
    notes: [
      [0, C4 + 12, 0.25],
      [0.25, C4 + 16, 0.25],
      [0.5, C4 + 19, 0.25],
      [0.75, C4 + 24, 0.25],
      [1, [C4 + 16, C4 + 19, C4 + 24, C4 + 28], 1.5],
    ],
  },
} satisfies Record<string, Stinger>;

export type StingerName = keyof typeof STINGERS;

/** Drawbar-style partials (ratio to the fundamental, level). */
const PARTIALS: [number, number][] = [
  [0.5, 0.45],
  [1, 0.8],
  [2, 0.55],
  [3, 0.3],
  [4, 0.22],
  [6, 0.1],
  [8, 0.07],
];

/** Length of a stinger in seconds. */
export function stingerLength(s: Stinger): number {
  const beat = 60 / s.bpm;
  return Math.max(...s.notes.map(([b, , d]) => (b + d) * beat)) + 0.3;
}

export function playStinger(a: AudioEngine, name: StingerName): void {
  const s = STINGERS[name];
  const length = stingerLength(s);
  a.duckCrowd(length);
  a.play(`organ.${name}`, 'music', (eng, out, t) => {
    const ctx = eng.ctx!;
    const bus = ctx.createGain();
    bus.gain.value = 0.22;
    // Leslie-ish tremolo on the whole phrase.
    const trem = ctx.createGain();
    trem.gain.value = 0.85;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 6.4;
    const depth = ctx.createGain();
    depth.gain.value = 0.15;
    lfo.connect(depth).connect(trem.gain);
    const tone = ctx.createBiquadFilter();
    tone.type = 'lowpass';
    tone.frequency.value = 5200;
    bus.connect(trem).connect(tone).connect(out);
    lfo.start(t);
    lfo.stop(t + length);
    const beat = 60 / s.bpm;
    for (const [b, n, d] of s.notes) {
      for (const midi of Array.isArray(n) ? n : [n]) {
        organNote(eng, bus, t + b * beat, d * beat * 0.95, midi, lfo);
      }
    }
    return length;
  });
}

function organNote(
  a: AudioEngine,
  out: AudioNode,
  t: number,
  dur: number,
  midi: number,
  vibrato: OscillatorNode,
): void {
  const ctx = a.ctx!;
  const f = 440 * 2 ** ((midi - 69) / 12);
  const g = ctx.createGain();
  // Organ keys: near-instant attack, a short release.
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(1, t + 0.008);
  g.gain.setValueAtTime(1, t + dur);
  g.gain.linearRampToValueAtTime(0, t + dur + 0.06);
  g.connect(out);
  const vib = ctx.createGain();
  vib.gain.value = 6; // cents
  vibrato.connect(vib);
  for (const [ratio, level] of PARTIALS) {
    const freq = f * ratio;
    if (freq > 9000) continue;
    const o = ctx.createOscillator();
    o.frequency.value = freq;
    vib.connect(o.detune);
    const pg = ctx.createGain();
    pg.gain.value = level * 0.18;
    o.connect(pg).connect(g);
    o.start(t);
    o.stop(t + dur + 0.08);
  }
  // Percussion: the 2nd harmonic, decaying fast, gives the key its click.
  const p = ctx.createOscillator();
  p.frequency.value = f * 2;
  const pg = ctx.createGain();
  pg.gain.setValueAtTime(0.12, t);
  pg.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
  p.connect(pg).connect(g);
  p.start(t);
  p.stop(t + 0.22);
}
