/**
 * The small animation kit (docs/MVP/05 § 9.1): damped springs for mechanical motion (solenoid
 * attack, overshoot, settle) and a timeline for sequencing celebrations. Driven by wall-clock
 * frame time on the presentation side; nothing here touches the physics or the rules.
 */

export class Spring {
  x = 0;
  v = 0;
  target = 0;

  /** `freq` in Hz; `damping` 1 = critical, < 1 overshoots. */
  constructor(
    private readonly freq = 12,
    private readonly damping = 0.35,
  ) {}

  /** An impulse (units per second), like a coil firing. */
  kick(v: number): void {
    this.v += v;
  }

  update(dt: number): void {
    const w = 2 * Math.PI * this.freq;
    // Semi-implicit Euler in small steps keeps stiff springs stable at low frame rates.
    const steps = Math.max(1, Math.ceil(dt / 0.004));
    const h = dt / steps;
    for (let i = 0; i < steps; i++) {
      const a = -w * w * (this.x - this.target) - 2 * this.damping * w * this.v;
      this.v += a * h;
      this.x += this.v * h;
    }
  }

  get settled(): boolean {
    return Math.abs(this.x - this.target) < 1e-4 && Math.abs(this.v) < 1e-3;
  }
}

/** Scheduled callbacks and per-frame tweens, in seconds of presentation time. */
export class Timeline {
  private now = 0;
  private readonly items: { at: number; run: () => void }[] = [];
  private readonly tweens: { from: number; dur: number; fn: (k: number) => void }[] = [];

  after(seconds: number, run: () => void): void {
    this.items.push({ at: this.now + seconds, run });
  }

  /** Calls `fn(k)` every frame with k going 0 → 1 over `seconds` (starting after `delay`). */
  tween(seconds: number, fn: (k: number) => void, delay = 0): void {
    this.tweens.push({ from: this.now + delay, dur: Math.max(1e-3, seconds), fn });
  }

  clear(): void {
    this.items.length = 0;
    this.tweens.length = 0;
  }

  update(dt: number): void {
    this.now += dt;
    for (let i = 0; i < this.items.length;) {
      if (this.items[i]!.at <= this.now) this.items.splice(i, 1)[0]!.run();
      else i++;
    }
    for (let i = 0; i < this.tweens.length;) {
      const tw = this.tweens[i]!;
      if (this.now < tw.from) {
        i++;
        continue;
      }
      const k = Math.min(1, (this.now - tw.from) / tw.dur);
      tw.fn(easeInOut(k));
      if (k >= 1) this.tweens.splice(i, 1);
      else i++;
    }
  }
}

export function easeInOut(k: number): number {
  return k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
}
