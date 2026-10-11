import type { World } from '../physics/world';

export interface TimedInput {
  /** DOMHighResTimeStamp (same clock as performance.now()). */
  time: number;
  apply: (world: World) => void;
}

/**
 * Fixed-step driver (docs/MVP/04 § 3). Physics runs at the world's fixed rate regardless of
 * display refresh; each input is applied at the exact step its timestamp falls in, so flipper
 * timing does not jitter with frame timing.
 */
export class FixedLoop {
  /** Wall-clock time (ms) that the current physics state corresponds to. */
  private simWall: number;
  private readonly queue: TimedInput[] = [];
  timeScale = 1;
  paused = false;
  /** Steps run during the last frame and time spent in them (ms). */
  lastSteps = 0;
  lastPhysicsMs = 0;
  /** Interpolation factor between the previous and current physics state. */
  alpha = 0;

  constructor(
    private readonly world: () => World,
    private readonly afterStep: () => void,
    now = performance.now(),
    private readonly maxStepsPerFrame = 50,
  ) {
    this.simWall = now;
  }

  push(input: TimedInput): void {
    this.queue.push(input);
  }

  /** Re-anchor the clock (after a pause or tab switch) so there is no catch-up burst. */
  resync(now = performance.now()): void {
    this.simWall = now;
  }

  frame(now: number): void {
    const w = this.world();
    if (this.paused) {
      // Inputs still apply while paused so flippers respond, but time does not advance.
      for (const i of this.queue.splice(0)) i.apply(w);
      this.simWall = now;
      this.lastSteps = 0;
      this.alpha = 1;
      return;
    }
    const stepMs = 1000 / w.params.rate / this.timeScale;
    const t0 = performance.now();
    let steps = 0;
    while (this.simWall + stepMs <= now) {
      const stepEnd = this.simWall + stepMs;
      // Apply every input whose timestamp falls before the end of this step, in order.
      while (this.queue.length > 0 && this.queue[0]!.time <= stepEnd) this.queue.shift()!.apply(w);
      w.step();
      this.afterStep();
      this.simWall = stepEnd;
      if (++steps >= this.maxStepsPerFrame) {
        // Too far behind (slow device or a long stall): drop the backlog rather than spiral.
        this.simWall = now;
        break;
      }
    }
    this.lastSteps = steps;
    this.lastPhysicsMs = performance.now() - t0;
    this.alpha = Math.min(1, Math.max(0, (now - this.simWall) / stepMs));
  }
}
