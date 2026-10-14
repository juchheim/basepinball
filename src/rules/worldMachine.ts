import type { World } from '../physics/world';
import { BULLPEN } from './game';
import type { PitchSpec } from './pitching';
import type { Machine } from './types';

/** A saucer's eject kick (m/s). */
const SAUCER_KICK = 1.4;

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
    for (const b of this.world.balls) b.active = false;
    this.world.releaseSaucers();
  }

  ejectSaucer(id: string): void {
    // Straight back down the table, with a little hop out of the dish.
    this.world.kickOutSaucer(id, SAUCER_KICK, 270);
  }

  parkBullpen(): void {
    this.world.parkBall(BULLPEN);
  }

  ballsInPlay(): number {
    return this.world.activeBalls().length;
  }

  setMagnet(power: number): void {
    this.world.setMagnet('magnet.curve', power);
  }

  setKickback(armed: boolean): void {
    this.world.setKickbackArmed('kickback.L', armed);
  }

  setMoundBumper(raised: boolean): void {
    this.world.setPopRaised('pop.mound', raised);
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
    this.searchFlip = -this.searchFlip;
    for (const b of this.world.activeBalls()) {
      b.vx += 0.25 * this.searchFlip;
      b.vy += 0.35;
      b.vz += 0.3;
    }
  }

  ballInPlay(): boolean {
    return this.world.activeBalls().length > 0;
  }

  ballSpeed(): number {
    let max = 0;
    for (const b of this.world.activeBalls()) max = Math.max(max, b.speed());
    return max;
  }
}
