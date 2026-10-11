/**
 * The audio engine (docs/MVP/06 § 3): one AudioContext with a bus per mix layer
 * (master → mechanical, stadium, music, UI), a 24-voice limit with per-sound polyphony caps,
 * stereo pan and distance from the ball's position, ducking, and a fade-and-suspend on pause.
 *
 * Every sound is synthesised (see sfx.ts, crowd.ts, organ.ts), so the game ships no audio files.
 * The context starts on the first user gesture (the title screen's "press Enter or tap").
 */

export type BusName = 'mech' | 'stadium' | 'music' | 'ui';

export interface Volumes {
  master: number;
  mech: number;
  stadium: number;
  music: number;
  ui: number;
  muted: boolean;
}

export const DEFAULT_VOLUMES: Volumes = {
  master: 0.8,
  mech: 1,
  stadium: 0.7,
  music: 0.6,
  ui: 0.7,
  muted: false,
};

/** Where a sound comes from: playfield fractions (x 0 = left, y 0 = flippers, 1 = top). */
export interface Place {
  x: number;
  y: number;
}

export interface VoiceOptions {
  /** Max simultaneous voices of this sound (e.g. 3 pop bumpers). */
  poly?: number;
  /** Spatialise from a playfield position. */
  at?: Place;
  /** Overall gain multiplier. */
  gain?: number;
}

/**
 * A sound recipe: builds nodes into `out` starting at time `t` and returns its length (s).
 * `rnd` is a 0-1 random number per play, for variation.
 */
export type Recipe = (a: AudioEngine, out: AudioNode, t: number, rnd: () => number) => number;

const MAX_VOICES = 24;
const STORAGE_KEY = 'bp.audio.v1';

export class AudioEngine {
  ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private readonly buses = new Map<BusName, GainNode>();
  private duck: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private readonly ends: { key: string; bus: BusName; end: number }[] = [];
  private readonly startHooks: ((a: AudioEngine) => void)[] = [];
  volumes: Volumes;
  private paused = false;

  constructor() {
    this.volumes = loadVolumes();
  }

  get ready(): boolean {
    return this.ctx !== null && this.ctx.state === 'running';
  }

  get now(): number {
    return this.ctx?.currentTime ?? 0;
  }

  /** Runs once the context exists (crowd bed, roll loop). */
  onStart(hook: (a: AudioEngine) => void): void {
    this.startHooks.push(hook);
    if (this.ctx) hook(this);
  }

  /** Create or resume the context. Must be called from a user gesture the first time. */
  unlock(): void {
    if (typeof AudioContext === 'undefined') return;
    if (!this.ctx) {
      const ctx = new AudioContext({ latencyHint: 'interactive' });
      this.ctx = ctx;
      const master = ctx.createGain();
      // A gentle limiter so stacked impacts never clip.
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -10;
      comp.knee.value = 8;
      comp.ratio.value = 6;
      comp.attack.value = 0.003;
      comp.release.value = 0.12;
      master.connect(comp).connect(ctx.destination);
      this.master = master;
      this.duck = ctx.createGain();
      this.duck.connect(master);
      for (const name of ['mech', 'stadium', 'music', 'ui'] as BusName[]) {
        const g = ctx.createGain();
        // The crowd bed ducks under stingers; everything else goes straight to the master.
        g.connect(name === 'stadium' ? this.duck : master);
        this.buses.set(name, g);
      }
      this.applyVolumes();
      for (const hook of this.startHooks) hook(this);
    }
    if (this.ctx.state === 'suspended' && !this.paused) void this.ctx.resume();
  }

  bus(name: BusName): AudioNode | null {
    return this.buses.get(name) ?? null;
  }

  /** Play a recipe on a bus, within the voice limits. */
  play(key: string, bus: BusName, recipe: Recipe, opts: VoiceOptions = {}): void {
    const ctx = this.ctx;
    const dest = this.buses.get(bus);
    if (!ctx || !dest || ctx.state !== 'running') return;
    const t = ctx.currentTime;
    for (let i = this.ends.length - 1; i >= 0; i--)
      if (this.ends[i]!.end < t) this.ends.splice(i, 1);
    if (opts.poly && this.ends.filter((e) => e.key === key).length >= opts.poly) return;
    // Mechanical sounds have priority: others give way when the voices are nearly used up.
    const limit = bus === 'mech' ? MAX_VOICES : MAX_VOICES - 4;
    if (this.ends.length >= limit) return;

    let out: AudioNode = dest;
    const gain = opts.gain ?? 1;
    if (opts.at || gain !== 1) {
      const g = ctx.createGain();
      let level = gain;
      if (opts.at) {
        // Pan follows x; the far end of the table is quieter and duller.
        const pan = ctx.createStereoPanner();
        pan.pan.value = clamp((opts.at.x - 0.5) * 1.4, -0.8, 0.8);
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.value = 16000 - clamp(opts.at.y, 0, 1) * 10000;
        level *= 1 - clamp(opts.at.y, 0, 1) * 0.35;
        g.connect(lp).connect(pan).connect(dest);
      } else {
        g.connect(dest);
      }
      g.gain.value = level;
      out = g;
    }
    const length = recipe(this, out, t + 0.002, Math.random);
    this.ends.push({ key, bus, end: t + length });
  }

  /** Dip the crowd bed (about 4 dB) under a stinger. */
  duckCrowd(seconds: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.duck) return;
    const g = this.duck.gain;
    const t = ctx.currentTime;
    g.cancelScheduledValues(t);
    g.setTargetAtTime(0.63, t, 0.05);
    g.setTargetAtTime(1, t + seconds, 0.4);
  }

  /** Fade out over 150 ms and suspend (pause, hidden tab), or resume. */
  setPaused(paused: boolean): void {
    this.paused = paused;
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const g = this.master.gain;
    const t = ctx.currentTime;
    g.cancelScheduledValues(t);
    if (paused) {
      g.setTargetAtTime(0, t, 0.05);
      setTimeout(() => {
        if (this.paused) void ctx.suspend();
      }, 160);
    } else {
      void ctx.resume().then(() => {
        g.setTargetAtTime(this.masterLevel(), ctx.currentTime, 0.05);
      });
    }
  }

  toggleMute(): boolean {
    this.volumes = { ...this.volumes, muted: !this.volumes.muted };
    this.applyVolumes();
    saveVolumes(this.volumes);
    return this.volumes.muted;
  }

  setVolumes(v: Partial<Volumes>): void {
    this.volumes = { ...this.volumes, ...v };
    this.applyVolumes();
    saveVolumes(this.volumes);
  }

  /** Two seconds of white noise, shared by every noisy recipe. */
  noise(): AudioBuffer {
    const ctx = this.ctx!;
    if (!this.noiseBuffer) {
      const len = ctx.sampleRate * 2;
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
      this.noiseBuffer = buf;
    }
    return this.noiseBuffer;
  }

  private masterLevel(): number {
    return this.volumes.muted ? 0 : this.volumes.master;
  }

  private applyVolumes(): void {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const t = ctx.currentTime;
    if (!this.paused) this.master.gain.setTargetAtTime(this.masterLevel(), t, 0.02);
    for (const [name, g] of this.buses) g.gain.setTargetAtTime(this.volumes[name], t, 0.02);
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function loadVolumes(): Volumes {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { ...DEFAULT_VOLUMES, ...(JSON.parse(raw) as Partial<Volumes>) };
  } catch {
    // Storage unavailable: defaults.
  }
  return { ...DEFAULT_VOLUMES };
}

function saveVolumes(v: Volumes): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(v));
  } catch {
    // Not critical.
  }
}
