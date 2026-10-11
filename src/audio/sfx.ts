import type { MaterialName } from '../physics/params';
import type { AudioEngine, Recipe } from './engine';

/**
 * Synthesised sound effects (docs/MVP/06 § 1, Mechanical bus): solenoid thunks, rubber snaps,
 * metal pings, the spinner, saucers, the drain, fireworks. Each recipe varies pitch by about ±3 %
 * per play so repeated hits don't machine-gun.
 */

type Wave = OscillatorType;

/** An oscillator with an exponential pitch sweep and a fast-attack, exponential-decay envelope. */
function tone(
  a: AudioEngine,
  out: AudioNode,
  t: number,
  wave: Wave,
  f0: number,
  f1: number,
  dur: number,
  peak: number,
  attack = 0.002,
): void {
  const ctx = a.ctx!;
  const o = ctx.createOscillator();
  o.type = wave;
  o.frequency.setValueAtTime(f0, t);
  if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(out);
  o.start(t);
  o.stop(t + dur + 0.02);
}

interface NoiseOpts {
  filter: BiquadFilterType;
  freq: number;
  freqEnd?: number;
  q?: number;
  dur: number;
  peak: number;
  attack?: number;
}

/** A filtered noise burst. */
function noise(a: AudioEngine, out: AudioNode, t: number, o: NoiseOpts): void {
  const ctx = a.ctx!;
  const src = ctx.createBufferSource();
  src.buffer = a.noise();
  const f = ctx.createBiquadFilter();
  f.type = o.filter;
  f.frequency.setValueAtTime(o.freq, t);
  if (o.freqEnd) f.frequency.exponentialRampToValueAtTime(o.freqEnd, t + o.dur);
  f.Q.value = o.q ?? 0.8;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, o.peak), t + (o.attack ?? 0.001));
  g.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);
  src.connect(f).connect(g).connect(out);
  src.start(t, Math.random() * 1.5);
  src.stop(t + o.dur + 0.02);
}

const vary = (rnd: () => number): number => 0.97 + rnd() * 0.06;

// ---------------------------------------------------------------- coils and devices

export const flipperUp: Recipe = (a, out, t, rnd) => {
  const v = vary(rnd);
  tone(a, out, t, 'sine', 115 * v, 52, 0.1, 0.9);
  tone(a, out, t, 'square', 62 * v, 60, 0.05, 0.08);
  noise(a, out, t, { filter: 'highpass', freq: 2600, dur: 0.025, peak: 0.3 });
  return 0.12;
};

export const flipperDown: Recipe = (a, out, t, rnd) => {
  tone(a, out, t, 'sine', 85 * vary(rnd), 50, 0.07, 0.3);
  noise(a, out, t, { filter: 'highpass', freq: 2000, dur: 0.015, peak: 0.12 });
  return 0.08;
};

export const sling: Recipe = (a, out, t, rnd) => {
  const v = vary(rnd);
  noise(a, out, t, { filter: 'bandpass', freq: 1900 * v, q: 1.2, dur: 0.05, peak: 0.7 });
  tone(a, out, t, 'sine', 150 * v, 70, 0.09, 0.65);
  return 0.1;
};

/** Pop bumpers: three pitch variants (docs/MVP/06 § 1). */
export const pop =
  (variant: number): Recipe =>
  (a, out, t, rnd) => {
    const v = vary(rnd) * [1, 1.12, 1.26][variant % 3]!;
    tone(a, out, t, 'sine', 170 * v, 60, 0.13, 0.9);
    noise(a, out, t, { filter: 'bandpass', freq: 950 * v, q: 1, dur: 0.06, peak: 0.5 });
    tone(a, out, t + 0.004, 'triangle', 540 * v, 500 * v, 0.16, 0.08);
    return 0.17;
  };

export const kicker: Recipe = (a, out, t, rnd) => {
  const v = vary(rnd);
  tone(a, out, t, 'sine', 125 * v, 50, 0.11, 0.85);
  tone(a, out, t, 'sine', 1460 * v, 1450 * v, 0.26, 0.07);
  tone(a, out, t, 'sine', 2310 * v, 2300 * v, 0.18, 0.05);
  noise(a, out, t, { filter: 'bandpass', freq: 1200, dur: 0.04, peak: 0.35 });
  return 0.28;
};

export const dropTarget: Recipe = (a, out, t, rnd) => {
  const v = vary(rnd);
  noise(a, out, t, { filter: 'bandpass', freq: 1400 * v, q: 1.5, dur: 0.035, peak: 0.6 });
  tone(a, out, t, 'sine', 210 * v, 120, 0.06, 0.45);
  return 0.08;
};

export const dropReset: Recipe = (a, out, t, rnd) => {
  tone(a, out, t, 'sine', 95, 45, 0.12, 0.6);
  for (const dt of [0.01, 0.025, 0.04]) {
    noise(a, out, t + dt, {
      filter: 'bandpass',
      freq: 1700 * vary(rnd),
      q: 2,
      dur: 0.03,
      peak: 0.4,
    });
  }
  return 0.14;
};

export const standup: Recipe = (a, out, t, rnd) => {
  const v = vary(rnd);
  noise(a, out, t, { filter: 'bandpass', freq: 2200 * v, q: 2, dur: 0.03, peak: 0.55 });
  tone(a, out, t, 'sine', 270 * v, 180, 0.045, 0.3);
  return 0.06;
};

export const spinnerTick: Recipe = (a, out, t, rnd) => {
  noise(a, out, t, { filter: 'highpass', freq: 3200 * vary(rnd), dur: 0.01, peak: 0.28 });
  tone(a, out, t, 'square', 1800 * vary(rnd), 1700, 0.008, 0.04);
  return 0.015;
};

export const saucerCatch: Recipe = (a, out, t, rnd) => {
  const v = vary(rnd);
  tone(a, out, t, 'sine', 150 * v, 90, 0.13, 0.75);
  noise(a, out, t, { filter: 'bandpass', freq: 360 * v, q: 1.2, dur: 0.09, peak: 0.5 });
  for (const dt of [0.05, 0.09, 0.12]) {
    noise(a, out, t + dt, { filter: 'highpass', freq: 2500, dur: 0.008, peak: 0.12 });
  }
  return 0.16;
};

/** The ball lift in the mound (VUK) and the pitch kicker. */
export const pitchRelease: Recipe = (a, out, t, rnd) => {
  tone(a, out, t, 'sine', 105 * vary(rnd), 55, 0.08, 0.55);
  noise(a, out, t, { filter: 'lowpass', freq: 700, dur: 0.05, peak: 0.35 });
  return 0.1;
};

export const drain: Recipe = (a, out, t, rnd) => {
  tone(a, out, t, 'sine', 72, 40, 0.25, 0.55);
  // The ball rattling down the trough.
  let dt = 0.08;
  for (let i = 0; i < 6; i++) {
    noise(a, out, t + dt, {
      filter: 'bandpass',
      freq: 2600 * vary(rnd),
      q: 3,
      dur: 0.01,
      peak: 0.18 * (1 - i / 7),
    });
    dt += 0.07 - i * 0.006;
  }
  return 0.55;
};

export const plunger: Recipe = (a, out, t, rnd) => {
  noise(a, out, t, { filter: 'bandpass', freq: 1300, freqEnd: 500, q: 1, dur: 0.05, peak: 0.5 });
  tone(a, out, t, 'sine', 310 * vary(rnd), 120, 0.06, 0.4);
  tone(a, out, t + 0.01, 'triangle', 185, 165, 0.3, 0.06);
  return 0.32;
};

export const kickback: Recipe = (a, out, t) => {
  tone(a, out, t, 'sine', 95, 40, 0.2, 1);
  noise(a, out, t, { filter: 'lowpass', freq: 900, dur: 0.1, peak: 0.6 });
  return 0.22;
};

export const gateFlap: Recipe = (a, out, t, rnd) => {
  for (const dt of [0, 0.07, 0.13]) {
    noise(a, out, t + dt, {
      filter: 'bandpass',
      freq: 2400 * vary(rnd),
      q: 3,
      dur: 0.02,
      peak: 0.25,
    });
  }
  return 0.16;
};

export const magnetHum =
  (seconds: number): Recipe =>
  (a, out, t) => {
    const ctx = a.ctx!;
    const g = ctx.createGain();
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 500;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.18, t + 0.02);
    g.gain.setValueAtTime(0.18, t + seconds);
    g.gain.exponentialRampToValueAtTime(0.0001, t + seconds + 0.05);
    lp.connect(g).connect(out);
    for (const f of [120, 240]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = f;
      o.connect(lp);
      o.start(t);
      o.stop(t + seconds + 0.08);
    }
    return seconds + 0.08;
  };

export const tiltBuzz =
  (seconds: number): Recipe =>
  (a, out, t) => {
    const ctx = a.ctx!;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1400;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.28, t + 0.01);
    g.gain.setValueAtTime(0.28, t + seconds - 0.05);
    g.gain.exponentialRampToValueAtTime(0.0001, t + seconds);
    lp.connect(g).connect(out);
    for (const f of [98, 104]) {
      const o = ctx.createOscillator();
      o.type = 'square';
      o.frequency.value = f;
      o.connect(lp);
      o.start(t);
      o.stop(t + seconds + 0.02);
    }
    return seconds;
  };

export const nudge: Recipe = (a, out, t) => {
  tone(a, out, t, 'sine', 62, 35, 0.13, 0.7);
  noise(a, out, t, { filter: 'lowpass', freq: 320, dur: 0.08, peak: 0.4 });
  return 0.14;
};

// ---------------------------------------------------------------- ball impacts

/** Ball-on-surface impacts, chosen by material and scaled by impact speed (velocity layering). */
export function impact(material: MaterialName, speed: number): Recipe | null {
  const level = Math.min(1, speed / 2.5);
  if (level < 0.06) return null;
  switch (material) {
    case 'metal':
    case 'wire':
      return (a, out, t, rnd) => {
        const v = vary(rnd);
        noise(a, out, t, { filter: 'highpass', freq: 4000, dur: 0.005, peak: 0.3 * level });
        tone(a, out, t, 'sine', 2900 * v, 2880 * v, 0.12 + 0.18 * level, 0.12 * level);
        tone(a, out, t, 'sine', 4130 * v, 4100 * v, 0.1 + 0.1 * level, 0.07 * level);
        return 0.3;
      };
    case 'wood':
      return (a, out, t, rnd) => {
        tone(a, out, t, 'sine', 330 * vary(rnd), 250, 0.06, 0.4 * level);
        noise(a, out, t, { filter: 'bandpass', freq: 750, q: 1.5, dur: 0.04, peak: 0.3 * level });
        return 0.07;
      };
    case 'plastic':
      return (a, out, t, rnd) => {
        noise(a, out, t, {
          filter: 'bandpass',
          freq: 2600 * vary(rnd),
          q: 2,
          dur: 0.02,
          peak: 0.3 * level,
        });
        tone(a, out, t, 'triangle', 1100 * vary(rnd), 1000, 0.03, 0.08 * level);
        return 0.04;
      };
    case 'glass':
      return (a, out, t) => {
        tone(a, out, t, 'sine', 3800, 3800, 0.2, 0.08 * level);
        tone(a, out, t, 'sine', 5230, 5230, 0.15, 0.05 * level);
        return 0.2;
      };
    case 'playfield':
      // Only real landings (from a ramp or a jump), not rolling.
      if (speed < 0.35) return null;
      return (a, out, t) => {
        tone(a, out, t, 'sine', 95, 58, 0.09, 0.6 * level);
        noise(a, out, t, { filter: 'lowpass', freq: 500, dur: 0.05, peak: 0.35 * level });
        return 0.1;
      };
    default:
      // Rubber, flipper rubber, targets, the glove backstops: a dull thud.
      return (a, out, t, rnd) => {
        tone(a, out, t, 'sine', 230 * vary(rnd), 120, 0.06, 0.45 * level);
        noise(a, out, t, { filter: 'lowpass', freq: 1300, dur: 0.035, peak: 0.25 * level });
        return 0.07;
      };
  }
}

// ---------------------------------------------------------------- stadium effects

export const fireworkLaunch: Recipe = (a, out, t, rnd) => {
  tone(a, out, t, 'sine', 700 + rnd() * 200, 1700, 0.55, 0.05, 0.05);
  noise(a, out, t, { filter: 'highpass', freq: 3000, dur: 0.5, peak: 0.05, attack: 0.05 });
  return 0.6;
};

export const fireworkBoom: Recipe = (a, out, t, rnd) => {
  noise(a, out, t, { filter: 'lowpass', freq: 520, freqEnd: 120, dur: 1.3, peak: 0.85 });
  tone(a, out, t, 'sine', 55, 30, 0.5, 0.7);
  // Crackle as the stars burn out.
  for (let i = 0; i < 14; i++) {
    noise(a, out, t + 0.35 + rnd() * 0.9, {
      filter: 'highpass',
      freq: 2500 + rnd() * 3000,
      dur: 0.008,
      peak: 0.07 + rnd() * 0.06,
    });
  }
  return 1.4;
};

/** Light-tower banks switching on: a relay clunk and the hum of the lamps warming up. */
export const towerClunk: Recipe = (a, out, t) => {
  tone(a, out, t, 'sine', 70, 38, 0.3, 0.9);
  noise(a, out, t, { filter: 'lowpass', freq: 1200, dur: 0.12, peak: 0.6 });
  tone(a, out, t + 0.05, 'sawtooth', 120, 120, 1.4, 0.03, 0.6);
  return 1.5;
};

// ---------------------------------------------------------------- UI

export const uiTick: Recipe = (a, out, t) => {
  tone(a, out, t, 'sine', 1250, 1200, 0.04, 0.15);
  return 0.05;
};

export const uiConfirm: Recipe = (a, out, t) => {
  tone(a, out, t, 'sine', 880, 880, 0.08, 0.15);
  tone(a, out, t + 0.07, 'sine', 1320, 1320, 0.12, 0.15);
  return 0.2;
};

// ---------------------------------------------------------------- the rolling ball

/**
 * The ball-roll loop (docs/MVP/06 § 2): noise through a filter per surface, crossfaded by what
 * the ball is rolling on, with gain and brightness following its speed.
 */
export class RollSound {
  private readonly layers: Record<
    'floor' | 'ramp' | 'wire',
    { gain: GainNode; filter: BiquadFilterNode }
  >;
  private readonly pan: StereoPannerNode;

  constructor(
    private readonly a: AudioEngine,
    out: AudioNode,
  ) {
    const ctx = a.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = a.noise();
    src.loop = true;
    this.pan = ctx.createStereoPanner();
    this.pan.connect(out);
    const layer = (type: BiquadFilterType, freq: number, q: number) => {
      const filter = ctx.createBiquadFilter();
      filter.type = type;
      filter.frequency.value = freq;
      filter.Q.value = q;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      src.connect(filter).connect(gain).connect(this.pan);
      return { gain, filter };
    };
    this.layers = {
      floor: layer('lowpass', 500, 0.7),
      ramp: layer('bandpass', 1500, 0.9),
      wire: layer('bandpass', 3300, 4),
    };
    src.start();
  }

  update(speed: number, surface: MaterialName, x: number, y: number, active: boolean): void {
    const ctx = this.a.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const s = active ? Math.min(1, speed / 3) : 0;
    const which = surface === 'plastic' ? 'ramp' : surface === 'wire' ? 'wire' : 'floor';
    const base = s * s * (1 - y * 0.35);
    for (const key of ['floor', 'ramp', 'wire'] as const) {
      const level = key === which ? base * (key === 'wire' ? 0.3 : key === 'ramp' ? 0.5 : 0.7) : 0;
      this.layers[key].gain.gain.setTargetAtTime(level, t, 0.04);
    }
    this.layers.floor.filter.frequency.setTargetAtTime(300 + s * 900, t, 0.05);
    this.pan.pan.setTargetAtTime(Math.max(-0.8, Math.min(0.8, (x - 0.5) * 1.4)), t, 0.05);
  }
}

// ---------------------------------------------------------------- switches and awards

export const rollover: Recipe = (a, out, t, rnd) => {
  noise(a, out, t, { filter: 'bandpass', freq: 1600 * vary(rnd), q: 2, dur: 0.02, peak: 0.25 });
  return 0.03;
};

/** Pitch-type tell: a soft bell, pitched by the pitch type (FB high, CH middle, CB low). */
export const tell =
  (semitones: number): Recipe =>
  (a, out, t) => {
    const f = 880 * 2 ** (semitones / 12);
    tone(a, out, t, 'sine', f, f, 0.5, 0.12);
    tone(a, out, t, 'sine', f * 2.01, f * 2.01, 0.25, 0.04);
    return 0.5;
  };

/** Something lit (Hot Bat, Steal, kickback, skill shot): a bright three-note chime. */
export const award: Recipe = (a, out, t) => {
  for (const [i, f] of [1046, 1318, 1568].entries()) {
    tone(a, out, t + i * 0.07, 'sine', f, f, 0.35, 0.14);
    tone(a, out, t + i * 0.07, 'triangle', f * 2, f * 2, 0.15, 0.03);
  }
  return 0.5;
};

/** A ramp made without an award (an R-U-N letter spotted): a rising two-note chime. */
export const rampMade: Recipe = (a, out, t) => {
  tone(a, out, t, 'sine', 784, 784, 0.25, 0.12);
  tone(a, out, t + 0.08, 'sine', 1175, 1175, 0.3, 0.12);
  return 0.4;
};

/** A runner sliding into the bag. */
export const slide: Recipe = (a, out, t) => {
  noise(a, out, t, {
    filter: 'lowpass',
    freq: 2400,
    freqEnd: 300,
    dur: 0.45,
    peak: 0.35,
    attack: 0.04,
  });
  return 0.5;
};

/** Ball search: the coils pulse in turn. */
export const searchPulses: Recipe = (a, out, t) => {
  for (let i = 0; i < 6; i++) tone(a, out, t + i * 0.09, 'sine', 110, 50, 0.08, 0.4);
  return 0.6;
};
