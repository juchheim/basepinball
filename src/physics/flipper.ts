import { dcos, dsin, DEG } from '../core/dmath';
import type { FlipperDef } from '../table/schema';
import type { FlipperParams } from './params';

/**
 * A flipper bat: a rigid tapered capsule rotating about its pivot, with finite inertia, driven
 * by a two-stage coil (full power to end-of-stroke, then hold) and a return spring
 * (docs/MVP/03-physics.md § 4). Ball impacts push back on it through `applyImpulse`.
 */
export class Flipper {
  readonly id: string;
  /** +1 for a left flipper (stroke is counter-clockwise), -1 for a right flipper. */
  readonly dir: 1 | -1;
  readonly px: number;
  readonly py: number;
  readonly length: number;
  readonly baseRadius: number;
  readonly tipRadius: number;
  readonly height: number;
  readonly restAngle: number;
  readonly stroke: number;

  theta: number;
  omega = 0;
  prevTheta: number;
  pressed = false;
  /** End-of-stroke switch. */
  eos = false;

  inertia = 1;
  invInertia = 1;

  // Cached geometry for the current angle.
  private cos = 1;
  private sin = 0;
  private readonly capB: number;
  private readonly capA: number;

  constructor(def: FlipperDef) {
    const mm = 0.001;
    this.id = def.id;
    this.dir = def.side === 'left' ? 1 : -1;
    this.px = def.x * mm;
    this.py = def.y * mm;
    this.length = def.length * mm;
    this.baseRadius = def.baseRadius * mm;
    this.tipRadius = def.tipRadius * mm;
    this.height = (def.height ?? 25) * mm;
    this.restAngle = def.restAngle * DEG;
    this.stroke = def.stroke * DEG;
    this.theta = this.prevTheta = this.restAngle;
    this.capB = (this.baseRadius - this.tipRadius) / this.length;
    this.capA = Math.sqrt(1 - this.capB * this.capB);
    this.updateTrig();
  }

  setParams(p: FlipperParams): void {
    // Uniform bar about one end.
    this.inertia = (p.mass * this.length * this.length) / 3;
    this.invInertia = 1 / this.inertia;
  }

  /** Stroke position in [0, stroke]. */
  get phase(): number {
    return this.dir * (this.theta - this.restAngle);
  }

  integrate(h: number, p: FlipperParams): void {
    const phase = this.phase;
    let torque: number;
    if (this.pressed) {
      torque = phase >= this.stroke - 1e-4 ? p.holdTorque : p.coilTorque;
    } else {
      torque = -p.returnTorque;
    }
    this.omega += this.dir * torque * this.invInertia * h;
    this.theta += this.omega * h;

    const ph = this.phase;
    if (ph > this.stroke) {
      this.theta = this.restAngle + this.dir * this.stroke;
      if (this.dir * this.omega > 0) this.omega = -this.omega * p.eosBounce;
    } else if (ph < 0) {
      this.theta = this.restAngle;
      if (this.dir * this.omega < 0) this.omega = -this.omega * p.restBounce;
    }
    this.eos = this.phase >= this.stroke - 0.01;
    this.updateTrig();
  }

  /**
   * True if an angular impulse with the sign of `dOmega` would drive the bat into the stop it is
   * resting against (rest stop, or end-of-stroke stop while held).
   */
  pushesIntoStop(dOmega: number): boolean {
    const toward = this.dir * dOmega;
    const ph = this.phase;
    if (ph <= 1e-6 && toward < 0) return true;
    if (this.pressed && ph >= this.stroke - 1e-6 && toward > 0) return true;
    return false;
  }

  /** Max speed (m/s) of any point on the bat; used to choose the substep count. */
  tipSpeed(): number {
    return Math.abs(this.omega) * (this.length + this.tipRadius);
  }

  private updateTrig(): void {
    this.cos = dcos(this.theta);
    this.sin = dsin(this.theta);
  }

  /**
   * Signed distance from point (x, y) to the bat outline and the outward normal.
   * The bat is the convex hull of the base and tip circles (an "uneven capsule").
   */
  distance(x: number, y: number, out: { d: number; nx: number; ny: number }): void {
    const dx = x - this.px;
    const dy = y - this.py;
    // Local frame: u along the bat, v perpendicular.
    const u = dx * this.cos + dy * this.sin;
    const v = -dx * this.sin + dy * this.cos;
    const sv = v < 0 ? -1 : 1;
    const pxl = v * sv; // |v|
    const pyl = u;
    const b = this.capB;
    const a = this.capA;
    const h = this.length;
    const k = -b * pxl + a * pyl;
    let lnx: number;
    let lny: number;
    if (k < 0) {
      const len = Math.sqrt(pxl * pxl + pyl * pyl);
      out.d = len - this.baseRadius;
      lnx = len > 1e-12 ? pxl / len : 1;
      lny = len > 1e-12 ? pyl / len : 0;
    } else if (k > a * h) {
      const qy = pyl - h;
      const len = Math.sqrt(pxl * pxl + qy * qy);
      out.d = len - this.tipRadius;
      lnx = len > 1e-12 ? pxl / len : 1;
      lny = len > 1e-12 ? qy / len : 0;
    } else {
      out.d = pxl * a + pyl * b - this.baseRadius;
      lnx = a;
      lny = b;
    }
    // Back to world: v axis = (-sin, cos), u axis = (cos, sin).
    const lv = lnx * sv;
    out.nx = lny * this.cos - lv * this.sin;
    out.ny = lny * this.sin + lv * this.cos;
  }

  /** Apply an impulse (jx, jy) at world point (cx, cy) to the bat. */
  applyImpulse(cx: number, cy: number, jx: number, jy: number): void {
    const rx = cx - this.px;
    const ry = cy - this.py;
    this.omega += (rx * jy - ry * jx) * this.invInertia;
  }

  /** Tip position for rendering/debug. */
  tip(theta = this.theta): { x: number; y: number } {
    return {
      x: this.px + this.length * dcos(theta),
      y: this.py + this.length * dsin(theta),
    };
  }
}
