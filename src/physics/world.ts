import { dcos, dsin, DEG } from '../core/dmath';
import type { TableDef } from '../table/schema';
import { Ball } from './ball';
import { Flipper } from './flipper';
import { restitution, type Material, type MaterialName, type PhysicsParams } from './params';

/**
 * The pinball physics world (docs/MVP/03-physics.md).
 *
 * - Fixed step (default 1 kHz). Each step is split into adaptive substeps so that neither the
 *   ball nor any flipper point moves more than `maxSubstepTravel` (2 mm) per substep. Since every
 *   collider is at least a ball radius thick once inflated, overlap tests on each substep can
 *   never tunnel, including against moving flippers.
 * - Contacts are resolved with impulses: velocity-dependent restitution on the normal,
 *   Coulomb friction on the tangent (which spins the ball up), and finite flipper inertia.
 * - The physics step uses no engine-dependent math (see src/core/dmath.ts).
 */

export type PhysicsEventType = 'sling' | 'pop' | 'drop' | 'saucer' | 'drain' | 'eos' | 'swing';

export interface PhysicsEvent {
  type: PhysicsEventType;
  id: string;
  /** Simulation time (s) of the substep in which the event happened. */
  time: number;
}

type DeviceKind = 'sling' | 'pop' | 'drop' | 'none';

interface StaticCollider {
  kind: 'segment' | 'circle';
  ax: number;
  ay: number;
  bx: number;
  by: number;
  radius: number;
  height: number;
  material: MaterialName;
  device: DeviceKind;
  deviceId: string;
}

interface Saucer {
  id: string;
  cx: number;
  cy: number;
  /** Rim radius. */
  a: number;
  /** Radius of the spherical bowl and its centre height. */
  bowlR: number;
  bowlZ: number;
  settle: number;
  holding: boolean;
}

interface DropTarget {
  id: string;
  down: boolean;
}

const MM = 0.001;

export class World {
  readonly params: PhysicsParams;
  readonly table: TableDef;
  readonly balls: Ball[] = [];
  readonly flippers: Flipper[] = [];
  readonly colliders: StaticCollider[] = [];
  readonly saucers: Saucer[] = [];
  readonly drops = new Map<string, DropTarget>();
  readonly events: PhysicsEvent[] = [];

  /** Simulation time (s). */
  time = 0;
  stepCount = 0;
  /** Substeps taken during the last fixed step. */
  lastSubsteps = 0;
  /** If false, slings and pops do not kick (used by energy tests). */
  actuatorsEnabled = true;

  private readonly cooldowns = new Map<string, number>();
  private readonly swingCooldowns = new Map<string, number>();
  private grid: Grid;
  private gx = 0;
  private gy = 0;
  private gz = 0;
  private readonly drainY: number;
  private readonly tmp = { d: 0, nx: 0, ny: 0 };

  constructor(table: TableDef, params: PhysicsParams) {
    this.table = table;
    this.params = params;
    this.drainY = table.drainY * MM;
    this.build();
    this.grid = new Grid(
      this.colliders,
      table.width * MM,
      table.length * MM,
      0.05,
      params.ballRadius,
    );
    this.applyParams();
  }

  /** Re-derive cached values after `params` were edited (e.g. from the debug panel). */
  applyParams(): void {
    const p = this.params;
    const slope = p.slopeDeg * DEG;
    this.gx = 0;
    this.gy = -p.gravity * dsin(slope);
    this.gz = -p.gravity * dcos(slope);
    for (const f of this.flippers) f.setParams(p.flipper);
  }

  get dt(): number {
    return 1 / this.params.rate;
  }

  addBall(x: number, y: number): Ball {
    const b = new Ball(this.params.ballRadius, this.params.ballMass);
    b.place(x, y);
    this.balls.push(b);
    return b;
  }

  setFlipper(id: string, pressed: boolean): void {
    for (const f of this.flippers) if (f.id === id) f.pressed = pressed;
  }

  resetDropTargets(): void {
    for (const d of this.drops.values()) d.down = false;
  }

  /** Releases a captured ball from a saucer with the given kick. */
  ejectFromSaucer(ball: Ball, saucerId: string, speed: number, angleDeg: number): void {
    const s = this.saucers.find((x) => x.id === saucerId);
    if (!s) return;
    s.holding = false;
    s.settle = 0;
    ball.place(s.cx, s.cy, this.params.ballRadius);
    const a = angleDeg * DEG;
    ball.vx = speed * dcos(a);
    ball.vy = speed * dsin(a);
    ball.vz = 0.4;
  }

  /** Total mechanical energy of the active balls (J). */
  energy(): number {
    let e = 0;
    const g = this.params.gravity;
    const slope = this.params.slopeDeg * DEG;
    const gs = g * dsin(slope);
    const gc = g * dcos(slope);
    for (const b of this.balls) {
      if (!b.active) continue;
      const v2 = b.vx * b.vx + b.vy * b.vy + b.vz * b.vz;
      const w2 = b.wx * b.wx + b.wy * b.wy + b.wz * b.wz;
      e += 0.5 * b.mass * v2 + 0.5 * b.inertia * w2 + b.mass * (gs * b.py + gc * b.pz);
    }
    return e;
  }

  /** Ball energy plus flipper kinetic energy and return-spring potential (J). */
  totalEnergy(): number {
    let e = this.energy();
    for (const f of this.flippers) {
      e += 0.5 * f.inertia * f.omega * f.omega;
      if (!f.pressed) e += this.params.flipper.returnTorque * f.phase;
    }
    return e;
  }

  step(): void {
    const dt = this.dt;
    for (const b of this.balls) b.savePrevious();
    for (const f of this.flippers) f.prevTheta = f.theta;

    let maxSpeed = 0;
    for (const b of this.balls) if (b.active) maxSpeed = Math.max(maxSpeed, b.speed());
    for (const f of this.flippers) {
      // Estimate the bat's speed over this step from its current speed and coil.
      const est = f.tipSpeed() + this.params.flipper.coilTorque * f.invInertia * dt * f.length;
      maxSpeed = Math.max(maxSpeed, est);
    }
    const p = this.params;
    let n = Math.ceil((maxSpeed * dt) / p.maxSubstepTravel);
    if (n < 1) n = 1;
    if (n > p.maxSubsteps) n = p.maxSubsteps;
    this.lastSubsteps = n;

    const h = dt / n;
    for (let i = 0; i < n; i++) {
      this.substep(h);
      this.time += h;
    }
    this.stepCount++;
  }

  private substep(h: number): void {
    const p = this.params;
    for (const f of this.flippers) {
      const wasEos = f.eos;
      f.integrate(h, p.flipper);
      if (f.eos && !wasEos) this.emit('eos', f.id);
    }

    for (const b of this.balls) {
      if (!b.active) continue;
      b.vx += this.gx * h;
      b.vy += this.gy * h;
      b.vz += this.gz * h;
      b.px += b.vx * h;
      b.py += b.vy * h;
      b.pz += b.vz * h;
      b.integrateOrientation(h);

      b.onFloor = false;
      // Two passes let stacked contacts (e.g. ball wedged between flipper and guide) settle.
      for (let pass = 0; pass < 2; pass++) {
        this.collideFloor(b);
        this.collideGlass(b);
        this.collideStatic(b, pass === 0);
        this.collideFlippers(b);
      }
      if (b.onFloor) this.applyRollingResistance(b, h);

      const s = b.speed();
      if (s > p.maxBallSpeed) {
        const k = p.maxBallSpeed / s;
        b.vx *= k;
        b.vy *= k;
        b.vz *= k;
      }

      this.updateSaucers(b, h);
      if (b.active && b.py < this.drainY) {
        b.active = false;
        this.emit('drain', 'drain');
      }
    }
  }

  // ---------------------------------------------------------------- contacts

  private collideFloor(b: Ball): void {
    const r = b.radius;
    for (const s of this.saucers) {
      const dx = b.px - s.cx;
      const dy = b.py - s.cy;
      const hd2 = dx * dx + dy * dy;
      if (hd2 > s.a * s.a) continue;
      // Over the hole: the ball rests on the rim edge and/or the spherical bowl.
      const hd = Math.sqrt(hd2);
      // Rim edge (a circle at z = 0).
      const ux = hd > 1e-9 ? dx / hd : 1;
      const uy = hd > 1e-9 ? dy / hd : 0;
      const qx = s.cx + ux * s.a;
      const qy = s.cy + uy * s.a;
      const ex = b.px - qx;
      const ey = b.py - qy;
      const ez = b.pz;
      const ed = Math.sqrt(ex * ex + ey * ey + ez * ez);
      if (ed < r && ed > 1e-9) {
        this.resolve(b, ex / ed, ey / ed, ez / ed, r - ed, 'playfield', 0, 0, 0, null, 0, 0);
        b.onFloor = true;
      }
      // Bowl: ball inside a sphere of radius bowlR centred at (cx, cy, bowlZ).
      const bx = b.px - s.cx;
      const by = b.py - s.cy;
      const bz = b.pz - s.bowlZ;
      const bd = Math.sqrt(bx * bx + by * by + bz * bz);
      const lim = s.bowlR - r;
      if (bd > lim && bd > 1e-9) {
        // Contact point must lie on the part of the sphere below the playfield.
        const cz = b.pz + (bz / bd) * r;
        if (cz <= 1e-6) {
          this.resolve(b, -bx / bd, -by / bd, -bz / bd, bd - lim, 'playfield', 0, 0, 0, null, 0, 0);
          b.onFloor = true;
        }
      }
      return;
    }
    const depth = r - b.pz;
    if (depth > 0) {
      this.resolve(b, 0, 0, 1, depth, 'playfield', 0, 0, 0, null, 0, 0);
      b.onFloor = true;
    }
  }

  private collideGlass(b: Ball): void {
    const depth = b.pz + b.radius - this.params.glassHeight;
    if (depth > 0) this.resolve(b, 0, 0, -1, depth, 'glass', 0, 0, 0, null, 0, 0);
  }

  private collideStatic(b: Ball, primary: boolean): void {
    const list = this.grid.query(b.px, b.py);
    if (!list) return;
    const r = b.radius;
    for (const c of list) {
      if (b.pz - r > c.height) continue;
      if (c.device === 'drop' && this.drops.get(c.deviceId)?.down) continue;
      let nx: number;
      let ny: number;
      let dist: number;
      if (c.kind === 'circle') {
        nx = b.px - c.ax;
        ny = b.py - c.ay;
        dist = Math.sqrt(nx * nx + ny * ny);
      } else {
        const sx = c.bx - c.ax;
        const sy = c.by - c.ay;
        const len2 = sx * sx + sy * sy;
        let t = ((b.px - c.ax) * sx + (b.py - c.ay) * sy) / len2;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        nx = b.px - (c.ax + sx * t);
        ny = b.py - (c.ay + sy * t);
        dist = Math.sqrt(nx * nx + ny * ny);
      }
      const depth = r + c.radius - dist;
      if (depth <= 0 || dist < 1e-12) continue;
      nx /= dist;
      ny /= dist;
      const vnBefore = b.vx * nx + b.vy * ny;
      this.resolve(b, nx, ny, 0, depth, c.material, 0, 0, 0, null, 0, 0);
      if (primary) this.deviceHit(b, c, nx, ny, -vnBefore);
    }
  }

  private deviceHit(b: Ball, c: StaticCollider, nx: number, ny: number, approach: number): void {
    if (c.device === 'none') return;
    const p = this.params;
    if (c.device === 'drop') {
      if (approach > p.dropThreshold) {
        const d = this.drops.get(c.deviceId);
        if (d && !d.down) {
          d.down = true;
          this.emit('drop', c.deviceId);
        }
      }
      return;
    }
    if (!this.actuatorsEnabled) return;
    const threshold = c.device === 'sling' ? p.slingThreshold : p.popThreshold;
    const kick = c.device === 'sling' ? p.slingKickSpeed : p.popKickSpeed;
    if (approach < threshold) return;
    const ready = this.cooldowns.get(c.deviceId) ?? -1;
    if (this.time < ready) return;
    this.cooldowns.set(c.deviceId, this.time + 0.06);
    const vn = b.vx * nx + b.vy * ny;
    if (vn < kick) {
      b.vx += nx * (kick - vn);
      b.vy += ny * (kick - vn);
    }
    this.emit(c.device, c.deviceId);
  }

  private collideFlippers(b: Ball): void {
    const r = b.radius;
    const out = this.tmp;
    for (const f of this.flippers) {
      if (b.pz - r > f.height) continue;
      // Cheap reject.
      const dx = b.px - f.px;
      const dy = b.py - f.py;
      const reach = f.length + f.baseRadius + r;
      if (dx * dx + dy * dy > reach * reach) continue;
      f.distance(b.px, b.py, out);
      const depth = r - out.d;
      if (depth <= 0) continue;
      const nx = out.nx;
      const ny = out.ny;
      // Contact point on the bat surface and its velocity.
      const cx = b.px - nx * r;
      const cy = b.py - ny * r;
      const rx = cx - f.px;
      const ry = cy - f.py;
      const ux = -f.omega * ry;
      const uy = f.omega * rx;
      this.resolve(b, nx, ny, 0, depth, 'rubberFlipper', ux, uy, 0, f, rx, ry);
      if (f.pressed) {
        const ready = this.swingCooldowns.get(f.id) ?? -1;
        if (this.time >= ready) {
          this.swingCooldowns.set(f.id, this.time + 0.05);
          this.emit('swing', f.id);
        }
      }
    }
  }

  /**
   * Resolve one contact. (nx, ny, nz) points from the surface to the ball centre; (ux, uy, uz)
   * is the surface velocity at the contact point; `flipper` (if any) receives the reaction.
   */
  private resolve(
    b: Ball,
    nx: number,
    ny: number,
    nz: number,
    depth: number,
    matName: MaterialName,
    ux: number,
    uy: number,
    uz: number,
    flipper: Flipper | null,
    rx: number,
    ry: number,
  ): void {
    const p = this.params;
    const mat: Material = p.materials[matName];
    const r = b.radius;

    // Positional correction.
    const corr = depth - p.slop;
    if (corr > 0) {
      b.px += nx * corr;
      b.py += ny * corr;
      b.pz += nz * corr;
    }

    // Contact-point arm from the ball centre.
    const ax = -nx * r;
    const ay = -ny * r;
    const az = -nz * r;

    // Relative velocity at the contact point.
    let vcx = b.vx + (b.wy * az - b.wz * ay) - ux;
    let vcy = b.vy + (b.wz * ax - b.wx * az) - uy;
    let vcz = b.vz + (b.wx * ay - b.wy * ax) - uz;
    const vn = vcx * nx + vcy * ny + vcz * nz;
    if (vn >= 0) return;

    const armN = rx * ny - ry * nx;
    // A flipper resting on a stop is rigid in the direction of that stop: a ball landing on a
    // resting bat, or pushing a held bat further into its end-of-stroke stop, cannot move it.
    const invIf = flipper && !flipper.pushesIntoStop(-armN) ? flipper.invInertia : 0;
    const kN = b.invMass + armN * armN * invIf;
    const e = -vn > p.restingSpeed ? restitution(mat, -vn) : 0;
    const jn = (-(1 + e) * vn) / kN;

    b.vx += nx * jn * b.invMass;
    b.vy += ny * jn * b.invMass;
    b.vz += nz * jn * b.invMass;
    if (flipper && invIf > 0) {
      flipper.omega -= armN * jn * invIf;
      ux = -flipper.omega * ry;
      uy = flipper.omega * rx;
    }

    // Friction.
    vcx = b.vx + (b.wy * az - b.wz * ay) - ux;
    vcy = b.vy + (b.wz * ax - b.wx * az) - uy;
    vcz = b.vz + (b.wx * ay - b.wy * ax) - uz;
    const vn2 = vcx * nx + vcy * ny + vcz * nz;
    let tx = vcx - vn2 * nx;
    let ty = vcy - vn2 * ny;
    let tz = vcz - vn2 * nz;
    const vt = Math.sqrt(tx * tx + ty * ty + tz * tz);
    if (vt < 1e-9) return;
    tx /= vt;
    ty /= vt;
    tz /= vt;
    const armT = rx * ty - ry * tx;
    const kT = b.invMass + r * r * b.invInertia + armT * armT * invIf;
    let jt = vt / kT;
    const maxJt = mat.friction * jn;
    if (jt > maxJt) jt = maxJt;

    // Impulse on the ball is -t * jt at arm a.
    b.vx -= tx * jt * b.invMass;
    b.vy -= ty * jt * b.invMass;
    b.vz -= tz * jt * b.invMass;
    // w += I^-1 (a x (-t jt))
    const k = -jt * b.invInertia;
    b.wx += k * (ay * tz - az * ty);
    b.wy += k * (az * tx - ax * tz);
    b.wz += k * (ax * ty - ay * tx);
    if (flipper && invIf > 0) flipper.omega += armT * jt * invIf;
  }

  private applyRollingResistance(b: Ball, h: number): void {
    const p = this.params;
    const decel = p.rollingResistance * -this.gz * h;
    const s = Math.sqrt(b.vx * b.vx + b.vy * b.vy);
    if (s <= 1e-9) return;
    const k = s > decel ? 1 - decel / s : 0;
    b.vx *= k;
    b.vy *= k;
    b.wx *= k;
    b.wy *= k;
    b.wz *= 1 - 0.5 * h;
  }

  private updateSaucers(b: Ball, h: number): void {
    const p = this.params;
    for (const s of this.saucers) {
      if (s.holding) continue;
      const dx = b.px - s.cx;
      const dy = b.py - s.cy;
      const inside = dx * dx + dy * dy < s.a * 0.6 * (s.a * 0.6) && b.pz < b.radius;
      if (inside && b.speed() < p.saucerCaptureSpeed) {
        s.settle += h;
        if (s.settle >= p.saucerCaptureTime) {
          s.holding = true;
          s.settle = 0;
          b.active = false;
          b.vx = b.vy = b.vz = 0;
          this.emit('saucer', s.id);
        }
      } else {
        s.settle = 0;
      }
    }
  }

  private emit(type: PhysicsEventType, id: string): void {
    this.events.push({ type, id, time: this.time });
  }

  // ---------------------------------------------------------------- build

  private build(): void {
    const t = this.table;
    const p = this.params;
    const seg = (
      a: readonly [number, number],
      b: readonly [number, number],
      radius: number,
      material: MaterialName,
      height = 25,
      device: DeviceKind = 'none',
      deviceId = '',
    ): void => {
      this.colliders.push({
        kind: 'segment',
        ax: a[0] * MM,
        ay: a[1] * MM,
        bx: b[0] * MM,
        by: b[1] * MM,
        radius: radius * MM,
        height: height * MM,
        material,
        device,
        deviceId,
      });
    };
    const circle = (
      x: number,
      y: number,
      radius: number,
      material: MaterialName,
      height = 25,
      device: DeviceKind = 'none',
      deviceId = '',
    ): void => {
      this.colliders.push({
        kind: 'circle',
        ax: x * MM,
        ay: y * MM,
        bx: x * MM,
        by: y * MM,
        radius: radius * MM,
        height: height * MM,
        material,
        device,
        deviceId,
      });
    };

    for (const el of t.elements) {
      switch (el.type) {
        case 'wall': {
          for (let i = 0; i + 1 < el.points.length; i++) {
            seg(el.points[i]!, el.points[i + 1]!, el.radius ?? 1.5, el.material, el.height ?? 25);
          }
          break;
        }
        case 'post':
          circle(el.x, el.y, el.radius, el.material);
          break;
        case 'sling': {
          // Kicking rubber face plus passive sides; rubber-ringed posts at the corners.
          seg(el.top, el.bottom, 3, 'rubberSling', 25, 'sling', el.id);
          seg(el.corner, el.top, 2, 'wood');
          seg(el.corner, el.bottom, 2, 'wood');
          circle(el.top[0], el.top[1], 5, 'rubberPost');
          circle(el.bottom[0], el.bottom[1], 5, 'rubberPost');
          break;
        }
        case 'pop':
          circle(el.x, el.y, el.radius, 'popBumper', 40, 'pop', el.id);
          break;
        case 'drop':
          seg(el.a, el.b, 2.5, 'dropTarget', 30, 'drop', el.id);
          this.drops.set(el.id, { id: el.id, down: false });
          break;
        case 'saucer': {
          const a = el.radius * MM;
          const d = el.depth * MM;
          const bowlR = (a * a + d * d) / (2 * d);
          this.saucers.push({
            id: el.id,
            cx: el.x * MM,
            cy: el.y * MM,
            a,
            bowlR,
            bowlZ: bowlR - d,
            settle: 0,
            holding: false,
          });
          // Rubber-faced back lip (the fielder standee base).
          const la = el.lipAngle * DEG;
          const lx = el.x + (el.radius + 6) * dcos(la);
          const ly = el.y + (el.radius + 6) * dsin(la);
          const half = el.radius * 0.9;
          const tx = -dsin(la) * half;
          const ty = dcos(la) * half;
          seg([lx - tx, ly - ty], [lx + tx, ly + ty], 4, 'rubberPost', 12);
          break;
        }
        case 'flipper': {
          const f = new Flipper(el);
          f.setParams(p.flipper);
          this.flippers.push(f);
          break;
        }
      }
    }
  }

  isSaucerHolding(id: string): boolean {
    return this.saucers.find((s) => s.id === id)?.holding ?? false;
  }

  isDropDown(id: string): boolean {
    return this.drops.get(id)?.down ?? false;
  }
}

/** Uniform grid over the static colliders, each inflated so a centre query finds all contacts. */
class Grid {
  private readonly cells: StaticCollider[][];
  private readonly nx: number;
  private readonly ny: number;
  private readonly x0 = -0.1;
  private readonly y0 = -0.1;

  constructor(
    colliders: StaticCollider[],
    width: number,
    length: number,
    private readonly size: number,
    ballRadius: number,
  ) {
    this.nx = Math.ceil((width + 0.2) / size);
    this.ny = Math.ceil((length + 0.2) / size);
    this.cells = Array.from({ length: this.nx * this.ny }, () => []);
    const pad = ballRadius + 0.004;
    for (const c of colliders) {
      const minX = Math.min(c.ax, c.bx) - c.radius - pad;
      const maxX = Math.max(c.ax, c.bx) + c.radius + pad;
      const minY = Math.min(c.ay, c.by) - c.radius - pad;
      const maxY = Math.max(c.ay, c.by) + c.radius + pad;
      const i0 = this.ix(minX);
      const i1 = this.ix(maxX);
      const j0 = this.iy(minY);
      const j1 = this.iy(maxY);
      for (let j = j0; j <= j1; j++) {
        for (let i = i0; i <= i1; i++) this.cells[j * this.nx + i]!.push(c);
      }
    }
  }

  private ix(x: number): number {
    const i = Math.floor((x - this.x0) / this.size);
    return i < 0 ? 0 : i >= this.nx ? this.nx - 1 : i;
  }

  private iy(y: number): number {
    const j = Math.floor((y - this.y0) / this.size);
    return j < 0 ? 0 : j >= this.ny ? this.ny - 1 : j;
  }

  query(x: number, y: number): StaticCollider[] | undefined {
    return this.cells[this.iy(y) * this.nx + this.ix(x)];
  }
}
