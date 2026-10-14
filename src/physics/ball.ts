import type { MaterialName } from './params';
/** A steel ball: the only dynamic body in the simulation. Units are SI. */
export class Ball {
  px = 0;
  py = 0;
  pz = 0;
  vx = 0;
  vy = 0;
  vz = 0;
  /** Angular velocity (rad/s). */
  wx = 0;
  wy = 0;
  wz = 0;
  /** Orientation quaternion, used by the renderer to show spin. */
  qx = 0;
  qy = 0;
  qz = 0;
  qw = 1;

  /** State at the start of the last fixed step, for render interpolation. */
  prevPx = 0;
  prevPy = 0;
  prevPz = 0;
  prevQx = 0;
  prevQy = 0;
  prevQz = 0;
  prevQw = 1;

  /** False while captured, drained, or otherwise out of play. */
  active = true;
  /**
   * The saucer a ball is parked in, on show (the souvenir in the Bleachers), or null. A parked
   * ball is not simulated but is drawn, and a ball in play bounces off it.
   */
  parkedIn: string | null = null;
  /** True if the ball touched the playfield floor during the last substep. */
  onFloor = false;
  /** Material of the last surface the ball rolled on (for the rolling sound). */
  surface: MaterialName = 'playfield';

  readonly invMass: number;
  readonly inertia: number;
  readonly invInertia: number;

  constructor(
    readonly radius: number,
    readonly mass: number,
  ) {
    this.invMass = 1 / mass;
    this.inertia = 0.4 * mass * radius * radius;
    this.invInertia = 1 / this.inertia;
  }

  place(x: number, y: number, z = this.radius): void {
    this.px = this.prevPx = x;
    this.py = this.prevPy = y;
    this.pz = this.prevPz = z;
    this.vx = this.vy = this.vz = 0;
    this.wx = this.wy = this.wz = 0;
    this.active = true;
    this.parkedIn = null;
  }

  savePrevious(): void {
    this.prevPx = this.px;
    this.prevPy = this.py;
    this.prevPz = this.pz;
    this.prevQx = this.qx;
    this.prevQy = this.qy;
    this.prevQz = this.qz;
    this.prevQw = this.qw;
  }

  speed(): number {
    return Math.sqrt(this.vx * this.vx + this.vy * this.vy + this.vz * this.vz);
  }

  integrateOrientation(h: number): void {
    const { wx, wy, wz, qx, qy, qz, qw } = this;
    const k = 0.5 * h;
    const nw = qw - k * (wx * qx + wy * qy + wz * qz);
    const nx = qx + k * (qw * wx + (wy * qz - wz * qy));
    const ny = qy + k * (qw * wy + (wz * qx - wx * qz));
    const nz = qz + k * (qw * wz + (wx * qy - wy * qx));
    const inv = 1 / Math.sqrt(nw * nw + nx * nx + ny * ny + nz * nz);
    this.qw = nw * inv;
    this.qx = nx * inv;
    this.qy = ny * inv;
    this.qz = nz * inv;
  }
}
