import type { World } from '../physics/world';
import type { PitchSpec } from './pitching';
import type { Machine } from './types';

/** Connects the rules to the physics world, like a table's coil and switch drivers. */
export class WorldMachine implements Machine {
  private searchFlip = 1;

  constructor(private readonly world: World) {}

  serveToPlunger(): void {
    this.world.releaseSaucers();
    this.world.serveBall();
  }

  pitch(spec: PitchSpec): void {
    this.world.releaseSaucers();
    this.world.setMagnet('magnet.curve', 0);
    this.world.pitchBall(spec.targetX, spec.targetY, spec.speed);
  }

  holdBall(): void {
    const b = this.world.balls[0];
    if (b) b.active = false;
  }

  setMagnet(power: number): void {
    this.world.setMagnet('magnet.curve', power);
  }

  setKickback(armed: boolean): void {
    this.world.setKickbackArmed('kickback.L', armed);
  }

  resetDropTargets(): void {
    this.world.resetDropTargets();
  }

  setFlippersEnabled(enabled: boolean): void {
    this.world.flippersEnabled = enabled;
    if (!enabled) for (const f of this.world.flippers) f.pressed = false;
  }

  ballSearch(): void {
    // A real ball search pulses every coil; a small alternating kick frees a wedged ball.
    const b = this.world.balls[0];
    if (!b || !b.active) return;
    this.searchFlip = -this.searchFlip;
    b.vx += 0.25 * this.searchFlip;
    b.vy += 0.35;
    b.vz += 0.3;
  }

  ballInPlay(): boolean {
    return this.world.balls[0]?.active ?? false;
  }

  ballSpeed(): number {
    const b = this.world.balls[0];
    return b && b.active ? b.speed() : 0;
  }
}
