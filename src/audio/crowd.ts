import type { AudioEngine } from './engine';

/**
 * The crowd (docs/MVP/06 § 1, Stadium bus): a murmuring bed whose level and excitement follow one
 * intensity parameter (0-1, from runners in scoring position, rally, late innings, two outs), and
 * one-shot reactions: cheers tiered by hit, the home-run roar, a groan, an "ooh", rally claps.
 * All of it is shaped noise and voice-like formants, so there are no recordings to license.
 */
export class Crowd {
  private murmur: GainNode | null = null;
  private buzz: GainNode | null = null;
  private intensity = 0.2;

  constructor(private readonly a: AudioEngine) {}

  /** Build the continuous bed (once the context exists). */
  start(): void {
    const ctx = this.a.ctx!;
    const out = this.a.bus('stadium')!;
    const bed = (freq: number, q: number, lfoRate: number) => {
      const src = ctx.createBufferSource();
      src.buffer = this.a.noise();
      src.loop = true;
      src.playbackRate.value = 0.5 + Math.random() * 0.1;
      const f = ctx.createBiquadFilter();
      f.type = 'bandpass';
      f.frequency.value = freq;
      f.Q.value = q;
      // Slow swells, so the bed breathes like a crowd rather than hissing.
      const swell = ctx.createGain();
      swell.gain.value = 0.7;
      const lfo = ctx.createOscillator();
      lfo.frequency.value = lfoRate;
      const depth = ctx.createGain();
      depth.gain.value = 0.3;
      lfo.connect(depth).connect(swell.gain);
      const level = ctx.createGain();
      level.gain.value = 0;
      src.connect(f).connect(swell).connect(level).connect(out);
      src.start();
      lfo.start();
      return level;
    };
    this.murmur = bed(520, 0.6, 0.23);
    this.buzz = bed(1500, 0.9, 0.41);
    this.setIntensity(this.intensity);
  }

  /** 0 = quiet early innings, 1 = bases loaded, two outs, bottom of the ninth. */
  setIntensity(v: number): void {
    this.intensity = Math.max(0, Math.min(1, v));
    const ctx = this.a.ctx;
    if (!ctx || !this.murmur || !this.buzz) return;
    const t = ctx.currentTime;
    this.murmur.gain.setTargetAtTime(0.1 + this.intensity * 0.1, t, 0.8);
    this.buzz.gain.setTargetAtTime(0.02 + this.intensity * 0.09, t, 0.8);
  }

  /** A cheer: `level` 0.3 (single) to 1 (home run). */
  cheer(level: number, seconds = 1.6 + level * 1.6): void {
    this.a.play(
      'cheer',
      'stadium',
      (a, out, t, rnd) => {
        swell(a, out, t, 900, 0.7, seconds, 0.5 * level, 0.12);
        swell(a, out, t, 2400, 1.2, seconds * 0.8, 0.25 * level, 0.1);
        // A few whistles in the bigger cheers.
        const whistles = Math.round(level * 4);
        for (let i = 0; i < whistles; i++) {
          const at = t + 0.1 + rnd() * seconds * 0.5;
          voice(a, out, at, 'sine', 1900 + rnd() * 700, 2400 + rnd() * 600, 0.35, 0.04);
        }
        clap(a, out, t + 0.2, seconds * 0.9, 18 + level * 40, 0.12 * level, rnd);
        return seconds + 0.2;
      },
      { poly: 2 },
    );
  }

  /** The home-run roar: louder, longer, brighter. */
  roar(): void {
    this.a.play(
      'roar',
      'stadium',
      (a, out, t, rnd) => {
        swell(a, out, t, 700, 0.5, 4, 0.7, 0.25);
        swell(a, out, t, 2000, 0.8, 3.6, 0.4, 0.25);
        for (let i = 0; i < 6; i++) {
          voice(
            a,
            out,
            t + 0.2 + rnd() * 2,
            'sine',
            2000 + rnd() * 600,
            2600 + rnd() * 500,
            0.4,
            0.05,
          );
        }
        clap(a, out, t + 0.4, 3.5, 70, 0.14, rnd);
        return 4.2;
      },
      { poly: 1 },
    );
  }

  /** A groan (strikeout, foul out with runners on). */
  groan(): void {
    this.a.play(
      'groan',
      'stadium',
      (a, out, t) => {
        formant(a, out, t, 1.3, [150, 110], [480, 300], 0.32);
        return 1.4;
      },
      { poly: 1 },
    );
  }

  /** "Ooh" for near misses and ramp rollbacks. */
  ooh(): void {
    this.a.play(
      'ooh',
      'stadium',
      (a, out, t) => {
        formant(a, out, t, 0.9, [190, 175], [420, 650], 0.26);
        return 1;
      },
      { poly: 1 },
    );
  }

  /** Rally clapping: clap, clap, clap-clap-clap. */
  rallyClap(): void {
    this.a.play(
      'rallyClap',
      'stadium',
      (a, out, t, rnd) => {
        for (const beat of [0, 0.42, 0.84, 1.05, 1.26]) clapBurst(a, out, t + beat, 0.2, rnd);
        return 1.5;
      },
      { poly: 1 },
    );
  }
}

/** A swelling band of noise (a crowd "roar" layer). */
function swell(
  a: AudioEngine,
  out: AudioNode,
  t: number,
  freq: number,
  q: number,
  seconds: number,
  peak: number,
  attack: number,
): void {
  const ctx = a.ctx!;
  const src = ctx.createBufferSource();
  src.buffer = a.noise();
  src.loop = true;
  const f = ctx.createBiquadFilter();
  f.type = 'bandpass';
  f.frequency.value = freq;
  f.Q.value = q;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + attack);
  g.gain.setTargetAtTime(peak * 0.6, t + attack, seconds * 0.3);
  g.gain.setTargetAtTime(0.0001, t + seconds * 0.6, seconds * 0.15);
  src.connect(f).connect(g).connect(out);
  src.start(t, Math.random());
  src.stop(t + seconds + 0.3);
}

/** A single voice-like glide (a whistle). */
function voice(
  a: AudioEngine,
  out: AudioNode,
  t: number,
  wave: OscillatorType,
  f0: number,
  f1: number,
  dur: number,
  peak: number,
): void {
  const ctx = a.ctx!;
  const o = ctx.createOscillator();
  o.type = wave;
  o.frequency.setValueAtTime(f0, t);
  o.frequency.linearRampToValueAtTime(f1, t + dur * 0.4);
  o.frequency.linearRampToValueAtTime(f0, t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + 0.04);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(out);
  o.start(t);
  o.stop(t + dur + 0.02);
}

/**
 * Many slightly detuned voices through a moving vowel formant: a crowd going "ooh" or groaning.
 * `pitch` and `vowel` are [start, end] in Hz.
 */
function formant(
  a: AudioEngine,
  out: AudioNode,
  t: number,
  seconds: number,
  pitch: [number, number],
  vowel: [number, number],
  peak: number,
): void {
  const ctx = a.ctx!;
  const f = ctx.createBiquadFilter();
  f.type = 'bandpass';
  f.Q.value = 2.5;
  f.frequency.setValueAtTime(vowel[0], t);
  f.frequency.linearRampToValueAtTime(vowel[1], t + seconds * 0.7);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + 0.18);
  g.gain.setTargetAtTime(0.0001, t + seconds * 0.55, seconds * 0.15);
  f.connect(g).connect(out);
  for (let i = 0; i < 8; i++) {
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    const d = 0.94 + Math.random() * 0.12;
    o.frequency.setValueAtTime(pitch[0] * d, t);
    o.frequency.linearRampToValueAtTime(pitch[1] * d, t + seconds);
    const og = ctx.createGain();
    og.gain.value = 0.12;
    o.connect(og).connect(f);
    o.start(t);
    o.stop(t + seconds + 0.3);
  }
}

/** Scattered applause: `perSecond` claps over `seconds`. */
function clap(
  a: AudioEngine,
  out: AudioNode,
  t: number,
  seconds: number,
  perSecond: number,
  peak: number,
  rnd: () => number,
): void {
  const n = Math.min(160, Math.round(seconds * perSecond));
  for (let i = 0; i < n; i++) {
    const at = t + rnd() * seconds;
    // Thinning out towards the end.
    const fade = 1 - (at - t) / seconds;
    clapOne(a, out, at, peak * (0.5 + rnd() * 0.5) * fade);
  }
}

/** A tight burst of claps on one beat. */
function clapBurst(
  a: AudioEngine,
  out: AudioNode,
  t: number,
  peak: number,
  rnd: () => number,
): void {
  for (let i = 0; i < 14; i++) clapOne(a, out, t + rnd() * 0.04, peak * (0.4 + rnd() * 0.6));
}

function clapOne(a: AudioEngine, out: AudioNode, t: number, peak: number): void {
  if (peak < 0.005) return;
  const ctx = a.ctx!;
  const src = ctx.createBufferSource();
  src.buffer = a.noise();
  const f = ctx.createBiquadFilter();
  f.type = 'bandpass';
  f.frequency.value = 1100 + Math.random() * 900;
  f.Q.value = 1.5;
  const g = ctx.createGain();
  g.gain.setValueAtTime(peak, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.03);
  src.connect(f).connect(g).connect(out);
  src.start(t, Math.random() * 1.5);
  src.stop(t + 0.04);
}
