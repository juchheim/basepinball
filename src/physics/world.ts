import { dcos, dsin, DEG } from '../core/dmath';
import { Rng } from '../core/rng';
import { FACE_RADIUS, rampBumperMesh } from '../table/rampBumper';
import type { SaucerDef, TableDef, Vec3 } from '../table/schema';
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
 * - Geometry is fully 3D where it matters: ramps are triangle surfaces and wireforms are
 *   capsule rails, so a ball can roll under an elevated ramp and over playfield walls.
 * - The physics step uses no engine-dependent math (see src/core/dmath.ts).
 */

export type PhysicsEventType =
  | 'sling'
  | 'pop'
  | 'drop'
  | 'standup'
  | 'kicker'
  | 'saucer'
  | 'drain'
  | 'eos'
  | 'swing'
  | 'sensor'
  | 'spinner'
  | 'kickback'
  | 'plunger'
  /** A ball in play touched a ball parked in a saucer (id: the saucer). */
  | 'parkedHit'
  | 'tiltBob';

/**
 * A ball impact, for presentation only (sound): kept apart from switch events and never read by
 * the rules, so it cannot affect the game.
 */
export interface Impact {
  /** Approach speed along the contact normal (m/s). */
  speed: number;
  material: MaterialName;
  x: number;
  y: number;
  z: number;
}

export interface PhysicsEvent {
  type: PhysicsEventType;
  id: string;
  /** Simulation time (s) of the substep in which the event happened. */
  time: number;
}

type DeviceKind = 'none' | 'sling' | 'pop' | 'drop' | 'standup' | 'kicker' | 'gate';

/** One static collider. Unused coordinates are 0. */
export interface StaticCollider {
  kind: 'segment' | 'circle' | 'triangle' | 'capsule';
  ax: number;
  ay: number;
  az: number;
  bx: number;
  by: number;
  bz: number;
  cx: number;
  cy: number;
  cz: number;
  /** Segment/circle/capsule radius. */
  radius: number;
  /** Top of a segment/circle wall (it extends down to the playfield). */
  height: number;
  material: MaterialName;
  device: DeviceKind;
  deviceId: string;
  /** One-way gate: allowed travel direction. */
  gnx: number;
  gny: number;
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
  /** The ball settling in the dish (multiball: only that ball's time counts). */
  settling: Ball | null;
  holding: boolean;
  /** The ball the saucer is holding, so it can kick that one back out. */
  ball: Ball | null;
}

/** A smooth hump: z = height · (1 − (h/a)²)², flat-tangent at its rim so balls roll over it. */
interface Dome {
  id: string;
  cx: number;
  cy: number;
  a: number;
  height: number;
}

interface Sensor {
  id: string;
  ax: number;
  ay: number;
  bx: number;
  by: number;
  zMin: number;
  zMax: number;
  spinner: boolean;
  /** Each ball's side of the line at the last substep (by index in `balls`; unset until seen). */
  sides: number[];
}

export interface SpinnerState {
  id: string;
  angle: number;
  omega: number;
  revs: number;
  ax: number;
  ay: number;
  bx: number;
  by: number;
}

export interface Magnet {
  id: string;
  cx: number;
  cy: number;
  radius: number;
  /** 0..1, set by game logic (curveballs). */
  power: number;
}

export interface Kickback {
  id: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  angle: number;
  armed: boolean;
}

export interface Plunger {
  id: string;
  x0: number;
  x1: number;
  tipY: number;
  /** 0..1 pull-back. */
  pull: number;
  /** How far the player is pulling (1 = all the way; a touch drag can hold it part way). */
  pullTarget: number;
  pressed: boolean;
}

interface DropTarget {
  id: string;
  down: boolean;
}

const MM = 0.001;

/** Restitution of one steel ball striking another. */
const BALL_RESTITUTION = 0.9;

/** Seconds a retractable device takes to rise and to sink. */
const POP_RISE_TIME = 0.15;
const POP_SINK_TIME = 0.1;
/** Lift (0-1) from which the device is solid; below it the ball rolls over where it will stand. */
const POP_SOLID = 0.9;
/**
 * A ramp-and-bumper's wall pieces push the ball only along a contact normal within this (cosine)
 * of the piece's outward face; round the end of the wall the ball meets the ramp instead.
 */
const POP_FACE_COS = 0.9;
/** A ball whose lowest point is below this height (m) is low enough to be caught by a rising device. */
const POP_CATCH_Z = 0.012;

interface RetractablePop {
  id: string;
  x: number;
  y: number;
  radius: number;
  /** Colliders that switch on together, each with the height it has when solid. */
  parts: { c: StaticCollider; h: number }[];
  /** 0 = lowered flush with the playfield, 1 = fully raised. */
  lift: number;
  /** Commanded state. A raise waits while a ball sits over the device. */
  raised: boolean;
}

export class World {
  readonly params: PhysicsParams;
  readonly table: TableDef;
  readonly balls: Ball[] = [];
  readonly flippers: Flipper[] = [];
  readonly colliders: StaticCollider[] = [];
  readonly saucers: Saucer[] = [];
  readonly domes: Dome[] = [];
  readonly sensors: Sensor[] = [];
  readonly spinners = new Map<string, SpinnerState>();
  readonly magnets: Magnet[] = [];
  readonly kickbacks: Kickback[] = [];
  readonly drops = new Map<string, DropTarget>();
  readonly retractables: RetractablePop[] = [];
  plunger: Plunger | null = null;
  readonly events: PhysicsEvent[] = [];
  /** Ball impacts since the presentation last cleared them (capped; see {@link Impact}). */
  readonly impacts: Impact[] = [];
  /** Per-bumper kick speeds (m/s) that override the global `popKickSpeed`. */
  private readonly popKicks = new Map<string, number>();
  /** Tilt bob displacement (m) and velocity; nudges swing it. */
  readonly bob = { x: 0, y: 0, vx: 0, vy: 0 };

  /** Simulation time (s). */
  time = 0;
  stepCount = 0;
  /** Substeps taken during the last fixed step. */
  lastSubsteps = 0;
  /** If false, slings, pops and kickers do not kick (used by energy tests). */
  actuatorsEnabled = true;
  /** If false, flipper buttons do nothing (tilt). */
  flippersEnabled = true;

  private readonly cooldowns = new Map<string, number>();
  private readonly rng: Rng;
  private grid: Grid;
  private gx = 0;
  private gy = 0;
  private gz = 0;
  private readonly drainY: number;
  private readonly tmp = { d: 0, nx: 0, ny: 0 };
  private readonly q = { x: 0, y: 0, z: 0 };
  private onSurface = false;

  constructor(table: TableDef, params: PhysicsParams, seed = 1) {
    this.table = table;
    this.params = params;
    this.rng = new Rng(seed);
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

  // ---------------------------------------------------------------- commands

  addBall(x: number, y: number, z = this.params.ballRadius): Ball {
    const b = new Ball(this.params.ballRadius, this.params.ballMass);
    b.place(x, y, z);
    this.balls.push(b);
    return b;
  }

  /** The main ball, created on demand: serves and pitches use it. Never a parked ball. */
  ball(): Ball {
    return this.balls.find((b) => !b.parkedIn) ?? this.addBall(0, 0);
  }

  /** The balls on the playfield (multiball can have more than one). */
  activeBalls(): Ball[] {
    return this.balls.filter((b) => b.active);
  }

  /** A ball that is neither in play nor held in a saucer, created if every ball is busy. */
  spareBall(): Ball {
    const held = new Set(this.saucers.map((s) => s.ball));
    return this.balls.find((b) => !b.active && !held.has(b)) ?? this.addBall(0, 0);
  }

  setFlipper(id: string, pressed: boolean): void {
    for (const f of this.flippers) if (f.id === id) f.pressed = pressed && this.flippersEnabled;
  }

  resetDropTargets(): void {
    for (const d of this.drops.values()) d.down = false;
  }

  /** Raise or lower a retractable bumper. It moves over the next few steps. */
  setPopRaised(id: string, raised: boolean): void {
    for (const r of this.retractables) if (r.id === id) r.raised = raised;
  }

  /** How far up a retractable device is, 0 (flush) to 1 (fully raised). */
  popLift(id: string): number {
    return this.retractables.find((x) => x.id === id)?.lift ?? 0;
  }

  private setLift(r: RetractablePop, lift: number): void {
    r.lift = lift;
    // A collider whose top is below the playfield is never touched.
    const on = lift >= POP_SOLID;
    for (const p of r.parts) p.c.height = on ? p.h : -1;
  }

  setKickbackArmed(id: string, armed: boolean): void {
    for (const k of this.kickbacks) if (k.id === id) k.armed = armed;
  }

  setMagnet(id: string, power: number): void {
    for (const m of this.magnets) if (m.id === id) m.power = power;
  }

  /** Put the ball on the plunger tip in the shooter lane. */
  serveBall(): Ball | null {
    const pl = this.plunger;
    if (!pl) return null;
    const b = this.ball();
    b.place((pl.x0 + pl.x1) / 2, pl.tipY + b.radius + 0.001);
    return b;
  }

  setPlunger(pressed: boolean): void {
    const pl = this.plunger;
    if (!pl) return;
    if (pl.pressed && !pressed) this.releasePlunger(pl);
    pl.pressed = pressed;
    pl.pullTarget = 1;
  }

  /** Hold the plunger pulled back to `amount` (0-1), e.g. dragging the knob on a touch screen. */
  setPlungerPull(amount: number): void {
    const pl = this.plunger;
    if (!pl) return;
    pl.pressed = true;
    pl.pullTarget = Math.max(0, Math.min(1, amount));
  }

  /**
   * Pitch from the mound: the ball appears at the pitch spot and is kicked toward (tx, ty) (m). The
   * main ball unless another is given (a second ball for multiball).
   */
  pitchBall(tx: number, ty: number, speed: number, ball: Ball = this.ball()): Ball | null {
    const spot = this.table.pitchSpot;
    if (!spot) return null;
    const b = ball;
    const x = spot.x * MM;
    const y = spot.y * MM;
    // The ball comes up through the mound, so a bumper there drops out of its way.
    for (const r of this.retractables) this.setLift(r, 0);
    b.place(x, y, this.floorHeightAt(x, y) + b.radius);
    const dx = tx - x;
    const dy = ty - y;
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    b.vx = (dx / len) * speed;
    b.vy = (dy / len) * speed;
    return b;
  }

  /** Bump the cabinet: the ball gets a velocity change in direction (dx, dy), the bob swings. */
  nudge(dx: number, dy: number): void {
    const p = this.params;
    for (const b of this.balls) {
      if (!b.active) continue;
      b.vx += dx * p.nudgeSpeed;
      b.vy += dy * p.nudgeSpeed;
    }
    this.bob.vx -= dx * p.tilt.kick;
    this.bob.vy -= dy * p.tilt.kick;
  }

  /** Releases a captured ball from a saucer with the given kick. */
  ejectFromSaucer(ball: Ball, saucerId: string, speed: number, angleDeg: number): void {
    const s = this.saucers.find((x) => x.id === saucerId);
    if (!s) return;
    s.holding = false;
    s.settle = 0;
    s.settling = null;
    s.ball = null;
    ball.place(s.cx, s.cy, this.params.ballRadius);
    const a = angleDeg * DEG;
    ball.vx = speed * dcos(a);
    ball.vy = speed * dsin(a);
    ball.vz = 0.4;
  }

  /** Back to a fresh table for a new game (geometry is kept). */
  reset(): void {
    this.balls.length = 0;
    this.events.length = 0;
    this.impacts.length = 0;
    this.resetDropTargets();
    for (const s of this.saucers) {
      s.holding = false;
      s.settle = 0;
      s.settling = null;
      s.ball = null;
    }
    for (const r of this.retractables) {
      r.raised = false;
      this.setLift(r, 0);
    }
    for (const k of this.kickbacks) k.armed = true;
    for (const m of this.magnets) m.power = 0;
    for (const f of this.flippers) f.pressed = false;
    this.flippersEnabled = true;
    if (this.plunger) {
      this.plunger.pull = 0;
      this.plunger.pressed = false;
    }
    this.bob.x = this.bob.y = this.bob.vx = this.bob.vy = 0;
  }

  /**
   * Kicks the ball a saucer is holding back into play (a scoop's eject, or a fielder's throw back
   * during multiball). Nothing happens if the saucer is empty.
   */
  kickOutSaucer(saucerId: string, speed: number, angleDeg: number): boolean {
    const s = this.saucers.find((x) => x.id === saucerId);
    if (!s?.holding || !s.ball) return false;
    this.ejectFromSaucer(s.ball, saucerId, speed, angleDeg);
    return true;
  }

  /**
   * Parks a ball on show in a saucer (the Bullpen's reliever): it sits in the dish, drawn but not
   * simulated, and a ball in play that strikes it fires `parkedHit`. Kick it out to put it in play.
   */
  parkBall(saucerId: string): void {
    const s = this.saucers.find((x) => x.id === saucerId);
    if (!s || s.holding) return;
    const b = this.spareBall();
    // Resting at the bottom of the dish.
    b.place(s.cx, s.cy, s.bowlZ - (s.bowlR - b.radius));
    b.active = false;
    b.parkedIn = saucerId;
    s.holding = true;
    s.settle = 0;
    s.settling = null;
    s.ball = b;
  }

  /** Clears saucer holds (the ball was routed elsewhere). A parked ball stays where it is. */
  releaseSaucers(): void {
    for (const s of this.saucers) {
      if (s.ball?.parkedIn) continue;
      s.holding = false;
      s.settle = 0;
      s.settling = null;
      s.ball = null;
    }
  }

  isSaucerHolding(id: string): boolean {
    return this.saucers.find((s) => s.id === id)?.holding ?? false;
  }

  isDropDown(id: string): boolean {
    return this.drops.get(id)?.down ?? false;
  }

  // ---------------------------------------------------------------- energy

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

  // ---------------------------------------------------------------- stepping

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
    this.updateDevices(dt);
    this.stepCount++;
  }

  private substep(h: number): void {
    const p = this.params;
    for (const f of this.flippers) {
      const wasEos = f.eos;
      f.integrate(h, p.flipper);
      if (f.eos && !wasEos) this.emit('eos', f.id);
    }

    for (let bi = 0; bi < this.balls.length; bi++) {
      const b = this.balls[bi]!;
      if (!b.active) continue;
      b.vx += this.gx * h;
      b.vy += this.gy * h;
      b.vz += this.gz * h;
      for (const m of this.magnets) this.applyMagnet(b, m, h);
      b.px += b.vx * h;
      b.py += b.vy * h;
      b.pz += b.vz * h;
      b.integrateOrientation(h);

      b.onFloor = false;
      this.onSurface = false;
      // Two passes let stacked contacts (e.g. ball wedged between flipper and guide) settle.
      for (let pass = 0; pass < 2; pass++) {
        this.collideFloor(b);
        this.collideGlass(b);
        this.collideStatic(b, pass === 0);
        this.collideFlippers(b);
      }
      if (b.onFloor || this.onSurface) this.applyRollingResistance(b, h);

      const s = b.speed();
      if (s > p.maxBallSpeed) {
        const k = p.maxBallSpeed / s;
        b.vx *= k;
        b.vy *= k;
        b.vz *= k;
      }

      this.updateSensors(b, bi);
      this.updateKickbacks(b);
      this.updateSaucers(b, h);
      if (b.active && b.py < this.drainY && b.pz < 0.05) {
        b.active = false;
        this.emit('drain', 'drain');
      }
    }
    if (this.balls.length > 1) this.collideBalls();
  }

  /**
   * Multiball: steel on steel. Equal masses, so overlapping balls are pushed apart equally and
   * swap the approaching part of their velocities (less a little for restitution).
   */
  private collideBalls(): void {
    const balls = this.balls;
    for (let i = 0; i < balls.length; i++) {
      const a = balls[i]!;
      if (!a.active && !a.parkedIn) continue;
      for (let j = i + 1; j < balls.length; j++) {
        const b = balls[j]!;
        if (!b.active && !b.parkedIn) continue;
        if (!a.active && !b.active) continue;
        const dx = b.px - a.px;
        const dy = b.py - a.py;
        const dz = b.pz - a.pz;
        const min = a.radius + b.radius;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 >= min * min || d2 < 1e-12) continue;
        const d = Math.sqrt(d2);
        const nx = dx / d;
        const ny = dy / d;
        const nz = dz / d;
        // A parked ball does not move: the ball in play takes the whole push and bounce.
        const wa = !a.active ? 0 : !b.active ? 1 : 0.5;
        const wb = 1 - wa;
        const push = min - d;
        a.px -= nx * push * wa;
        a.py -= ny * push * wa;
        a.pz -= nz * push * wa;
        b.px += nx * push * wb;
        b.py += ny * push * wb;
        b.pz += nz * push * wb;
        const vn = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny + (a.vz - b.vz) * nz;
        if (vn <= 0) continue;
        if (vn > 0.12 && this.impacts.length < 64) {
          this.impacts.push({
            speed: vn,
            material: 'metal',
            x: a.px + nx * a.radius,
            y: a.py + ny * a.radius,
            z: a.pz,
          });
        }
        const parked = !a.active ? a : !b.active ? b : null;
        if (parked?.parkedIn) {
          const ready = this.cooldowns.get(parked.parkedIn) ?? -1;
          if (this.time >= ready) this.emit('parkedHit', parked.parkedIn);
          this.cooldowns.set(parked.parkedIn, this.time + 0.3);
        }
        const k = (1 + BALL_RESTITUTION) * vn;
        a.vx -= nx * k * wa;
        a.vy -= ny * k * wa;
        a.vz -= nz * k * wa;
        b.vx += nx * k * wb;
        b.vy += ny * k * wb;
        b.vz += nz * k * wb;
      }
    }
  }

  /** Per-step device updates that do not need substep resolution. */
  private updateDevices(dt: number): void {
    const p = this.params;
    for (const s of this.spinners.values()) {
      if (s.omega === 0) continue;
      s.angle += s.omega * dt;
      s.omega *= 1 - p.spinnerDecay * dt;
      if (Math.abs(s.omega) < 0.3) s.omega = 0;
      const revs = Math.floor(Math.abs(s.angle) / (2 * Math.PI));
      if (revs > s.revs) {
        s.revs = revs;
        this.emit('spinner', s.id);
      }
    }
    for (const r of this.retractables) {
      if (r.raised && r.lift < 1) {
        // Never rise under a ball: it waits until the ball has rolled off (or been pitched away).
        if (r.lift >= POP_SOLID || !this.ballOver(r)) {
          this.setLift(r, Math.min(1, r.lift + dt / POP_RISE_TIME));
        }
      } else if (!r.raised && r.lift > 0) {
        this.setLift(r, Math.max(0, r.lift - dt / POP_SINK_TIME));
      }
    }
    const pl = this.plunger;
    if (pl) {
      if (pl.pressed) {
        // The spring takes time to pull back, and eases forward if the player lets it.
        pl.pull =
          pl.pull < pl.pullTarget
            ? Math.min(pl.pullTarget, pl.pull + dt / p.plungerPullTime)
            : Math.max(pl.pullTarget, pl.pull - dt / p.plungerPullTime);
      } else pl.pull = Math.max(0, pl.pull - dt * 40);
    }
    // Tilt bob: a damped pendulum.
    const w0 = 2 * Math.PI * p.tilt.frequency;
    const bob = this.bob;
    bob.vx += (-w0 * w0 * bob.x - 2 * p.tilt.damping * w0 * bob.vx) * dt;
    bob.vy += (-w0 * w0 * bob.y - 2 * p.tilt.damping * w0 * bob.vy) * dt;
    bob.x += bob.vx * dt;
    bob.y += bob.vy * dt;
    if (bob.x * bob.x + bob.y * bob.y > p.tilt.warnRadius * p.tilt.warnRadius) {
      const ready = this.cooldowns.get('tiltBob') ?? -1;
      if (this.time >= ready) {
        this.cooldowns.set('tiltBob', this.time + 0.5);
        this.emit('tiltBob', 'tilt');
      }
    }
  }

  /** Is a ball on the playfield close enough to a retractable device's footprint to be caught by it? */
  private ballOver(r: RetractablePop): boolean {
    for (const b of this.balls) {
      if (!b.active || b.pz - b.radius > POP_CATCH_Z) continue;
      const reach = r.radius + b.radius + 0.002;
      const dx = b.px - r.x;
      const dy = b.py - r.y;
      if (dx * dx + dy * dy < reach * reach) return true;
    }
    return false;
  }

  private releasePlunger(pl: Plunger): void {
    const p = this.params;
    let fired = false;
    for (const b of this.balls) {
      if (!b.active) continue;
      const inLane = b.px > pl.x0 && b.px < pl.x1;
      const onTip = b.py < pl.tipY + b.radius + 0.008 && b.pz < 0.03;
      if (inLane && onTip) {
        // A touch of seeded randomness, as real plunger springs vary.
        const speed = pl.pull * p.plungerMaxSpeed * (1 + this.rng.range(-0.01, 0.01));
        b.vy = Math.max(b.vy, speed);
        fired = true;
      }
    }
    if (fired) this.emit('plunger', pl.id);
  }

  // ---------------------------------------------------------------- contacts

  /** Height of the playfield surface (m) at (x, y), including the mound. */
  floorHeightAt(x: number, y: number): number {
    for (const d of this.domes) {
      const dx = x - d.cx;
      const dy = y - d.cy;
      const h2 = dx * dx + dy * dy;
      if (h2 < d.a * d.a) {
        const u = 1 - h2 / (d.a * d.a);
        return d.height * u * u;
      }
    }
    return 0;
  }

  private collideFloor(b: Ball): void {
    const r = b.radius;
    for (const s of this.saucers) {
      const dx = b.px - s.cx;
      const dy = b.py - s.cy;
      const hd2 = dx * dx + dy * dy;
      if (hd2 > s.a * s.a) continue;
      // A fast ball skims across (the hole stays "closed") unless it has already dipped in.
      const hSpeed = Math.sqrt(b.vx * b.vx + b.vy * b.vy);
      if (hSpeed > this.params.saucerSkimSpeed && b.pz > r - 0.0005) break;
      // Over the hole: the ball rests on the rim edge and/or the spherical bowl.
      const hd = Math.sqrt(hd2);
      const ux = hd > 1e-9 ? dx / hd : 1;
      const uy = hd > 1e-9 ? dy / hd : 0;
      const ex = b.px - (s.cx + ux * s.a);
      const ey = b.py - (s.cy + uy * s.a);
      const ez = b.pz;
      const ed = Math.sqrt(ex * ex + ey * ey + ez * ez);
      if (ed < r && ed > 1e-9) {
        this.resolve(b, ex / ed, ey / ed, ez / ed, r - ed, 'playfield', 0, 0, 0, null, 0, 0);
        b.onFloor = true;
      }
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
    for (const d of this.domes) {
      const dx = b.px - d.cx;
      const dy = b.py - d.cy;
      const h2 = dx * dx + dy * dy;
      if (h2 >= d.a * d.a) continue;
      // Gentle slopes (< 12°): use the surface normal under the ball centre.
      const h = Math.sqrt(h2);
      const u = 1 - h2 / (d.a * d.a);
      const surf = d.height * u * u;
      const slope = (-4 * d.height * u * h) / (d.a * d.a); // dz/dh
      const inv = 1 / Math.sqrt(1 + slope * slope);
      const nx = h > 1e-9 ? ((-slope * dx) / h) * inv : 0;
      const ny = h > 1e-9 ? ((-slope * dy) / h) * inv : 0;
      const nz = inv;
      const depth = r - (b.pz - surf) * nz;
      if (depth > 0) {
        this.resolve(b, nx, ny, nz, depth, 'playfield', 0, 0, 0, null, 0, 0);
        b.onFloor = true;
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
    const q = this.q;
    for (const c of list) {
      let nx: number;
      let ny: number;
      let nz = 0;
      let dist: number;
      switch (c.kind) {
        case 'circle': {
          if (b.pz - r > c.height) continue;
          nx = b.px - c.ax;
          ny = b.py - c.ay;
          dist = Math.sqrt(nx * nx + ny * ny);
          break;
        }
        case 'segment': {
          if (b.pz - r > c.height) continue;
          if (c.device === 'drop' && this.drops.get(c.deviceId)?.down) continue;
          const sx = c.bx - c.ax;
          const sy = c.by - c.ay;
          if (
            (c.device === 'gate' || c.device === 'pop') &&
            (b.px - c.ax) * c.gnx + (b.py - c.ay) * c.gny < 0
          )
            continue;
          const len2 = sx * sx + sy * sy;
          let t = ((b.px - c.ax) * sx + (b.py - c.ay) * sy) / len2;
          t = t < 0 ? 0 : t > 1 ? 1 : t;
          nx = b.px - (c.ax + sx * t);
          ny = b.py - (c.ay + sy * t);
          dist = Math.sqrt(nx * nx + ny * ny);
          // A bumper wall piece is hit only on its face: round its end the ball is beside the
          // wall (on the ramp, or climbing it), not in front of it.
          if (c.device === 'pop' && nx * c.gnx + ny * c.gny < POP_FACE_COS * dist) continue;
          break;
        }
        case 'triangle': {
          if (c.height < 0) continue;
          closestOnTriangle(b.px, b.py, b.pz, c, q);
          nx = b.px - q.x;
          ny = b.py - q.y;
          nz = b.pz - q.z;
          dist = Math.sqrt(nx * nx + ny * ny + nz * nz);
          break;
        }
        case 'capsule': {
          const sx = c.bx - c.ax;
          const sy = c.by - c.ay;
          const sz = c.bz - c.az;
          const len2 = sx * sx + sy * sy + sz * sz;
          let t = ((b.px - c.ax) * sx + (b.py - c.ay) * sy + (b.pz - c.az) * sz) / len2;
          t = t < 0 ? 0 : t > 1 ? 1 : t;
          nx = b.px - (c.ax + sx * t);
          ny = b.py - (c.ay + sy * t);
          nz = b.pz - (c.az + sz * t);
          dist = Math.sqrt(nx * nx + ny * ny + nz * nz);
          break;
        }
      }
      const depth = r + c.radius - dist;
      if (depth <= 0 || dist < 1e-12) continue;
      nx /= dist;
      ny /= dist;
      nz /= dist;
      if (nz > 0.5) this.onSurface = true;
      const vnBefore = b.vx * nx + b.vy * ny + b.vz * nz;
      // The mound's bumper wall fires only at a ball coming down the table. One going up it that
      // clips the back of the wall from the side glances off it as off a plain wall.
      const passive = c.kind === 'segment' && c.device === 'pop' && b.vy > 0;
      this.resolve(b, nx, ny, nz, depth, c.material, 0, 0, 0, null, 0, 0);
      if (primary && !passive) this.deviceHit(b, c, nx, ny, -vnBefore);
    }
  }

  private deviceHit(b: Ball, c: StaticCollider, nx: number, ny: number, approach: number): void {
    if (c.device === 'none' || c.device === 'gate') return;
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
    if (c.device === 'standup') {
      if (approach > p.standupThreshold && this.ready(c.deviceId, 0.08))
        this.emit('standup', c.deviceId);
      return;
    }
    if (!this.actuatorsEnabled) return;
    if (c.device === 'kicker') {
      // The switch closes on any real contact; the coil only boosts a firm hit, so a ball
      // gently hugging the arch (a soft plunge) is not flung round the loop.
      if (approach < 0.05 || !this.ready(c.deviceId, 0.06)) return;
      this.emit('kicker', c.deviceId);
      if (approach < p.kickerThreshold) return;
      // Speed the ball along the face in the direction it is already travelling.
      const sx = c.bx - c.ax;
      const sy = c.by - c.ay;
      const len = Math.sqrt(sx * sx + sy * sy);
      const tx = sx / len;
      const ty = sy / len;
      const vt = b.vx * tx + b.vy * ty;
      const target = vt >= 0 ? p.kickerSpeed : -p.kickerSpeed;
      if (Math.abs(vt) < p.kickerSpeed) {
        b.vx += tx * (target - vt);
        b.vy += ty * (target - vt);
      }
      return;
    }
    const threshold = c.device === 'sling' ? p.slingThreshold : p.popThreshold;
    const kick =
      c.device === 'sling' ? p.slingKickSpeed : (this.popKicks.get(c.deviceId) ?? p.popKickSpeed);
    // A pop's skirt switch also closes under a ball resting against it (wedged by a wall).
    const pressed = approach >= threshold || (c.device === 'pop' && b.speed() < 0.05);
    if (!pressed || !this.ready(c.deviceId, 0.06)) return;
    const vn = b.vx * nx + b.vy * ny;
    if (vn < kick) {
      b.vx += nx * (kick - vn);
      b.vy += ny * (kick - vn);
    }
    this.emit(c.device, c.deviceId);
  }

  private ready(id: string, cooldown: number): boolean {
    const at = this.cooldowns.get(id) ?? -1;
    if (this.time < at) return false;
    this.cooldowns.set(id, this.time + cooldown);
    return true;
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
      if (f.pressed && this.ready(`swing:${f.id}`, 0.05)) this.emit('swing', f.id);
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
    if (nz > 0.5) b.surface = matName;
    if (-vn > 0.12 && this.impacts.length < 64) {
      this.impacts.push({ speed: -vn, material: matName, x: b.px, y: b.py, z: b.pz });
    }

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

  private applyMagnet(b: Ball, m: Magnet, h: number): void {
    if (m.power <= 0 || b.pz > 0.03) return;
    const dx = m.cx - b.px;
    const dy = m.cy - b.py;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d >= m.radius || d < 1e-6) return;
    const a = this.params.magnetStrength * m.power * (1 - d / m.radius);
    b.vx += (dx / d) * a * h;
    b.vy += (dy / d) * a * h;
  }

  // ---------------------------------------------------------------- sensors & devices

  private updateSensors(b: Ball, bi: number): void {
    for (const s of this.sensors) {
      const sx = s.bx - s.ax;
      const sy = s.by - s.ay;
      const side = sx * (b.py - s.ay) - sy * (b.px - s.ax);
      const prev = s.sides[bi] ?? NaN;
      s.sides[bi] = side;
      if (Number.isNaN(prev) || prev < 0 === side < 0) continue;
      if (b.pz < s.zMin || b.pz > s.zMax) continue;
      const len2 = sx * sx + sy * sy;
      const t = ((b.px - s.ax) * sx + (b.py - s.ay) * sy) / len2;
      if (t < 0 || t > 1) continue;
      if (s.spinner) {
        const st = this.spinners.get(s.id);
        if (st) {
          st.omega = (side > 0 ? 1 : -1) * this.params.spinnerGain * b.speed();
          st.angle = 0;
          st.revs = 0;
        }
        // The plate takes a little energy from the ball.
        b.vx *= 0.97;
        b.vy *= 0.97;
      }
      this.emit(s.spinner ? 'spinner' : 'sensor', s.id);
    }
  }

  private updateKickbacks(b: Ball): void {
    for (const k of this.kickbacks) {
      if (!k.armed) continue;
      if (b.px < k.x0 || b.px > k.x1 || b.py < k.y0 || b.py > k.y1) continue;
      const a = k.angle * DEG;
      b.vx = this.params.kickbackSpeed * dcos(a);
      b.vy = this.params.kickbackSpeed * dsin(a);
      k.armed = false;
      this.emit('kickback', k.id);
    }
  }

  private updateSaucers(b: Ball, h: number): void {
    const p = this.params;
    for (const s of this.saucers) {
      if (s.holding) continue;
      const dx = b.px - s.cx;
      const dy = b.py - s.cy;
      const inside = dx * dx + dy * dy < s.a * 0.6 * (s.a * 0.6) && b.pz < b.radius;
      if (inside && b.speed() < p.saucerCaptureSpeed) {
        if (s.settling !== b) {
          s.settling = b;
          s.settle = 0;
        }
        s.settle += h;
        if (s.settle >= p.saucerCaptureTime) {
          s.holding = true;
          s.settle = 0;
          s.ball = b;
          b.active = false;
          b.vx = b.vy = b.vz = 0;
          this.emit('saucer', s.id);
        }
      } else if (s.settling === b) {
        s.settle = 0;
        s.settling = null;
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
    const base = (): StaticCollider => ({
      kind: 'segment',
      ax: 0,
      ay: 0,
      az: 0,
      bx: 0,
      by: 0,
      bz: 0,
      cx: 0,
      cy: 0,
      cz: 0,
      radius: 0,
      height: 0,
      material: 'metal',
      device: 'none',
      deviceId: '',
      gnx: 0,
      gny: 0,
    });
    const seg = (
      a: readonly [number, number],
      b: readonly [number, number],
      radius: number,
      material: MaterialName,
      height = 25,
      device: DeviceKind = 'none',
      deviceId = '',
    ): StaticCollider => {
      const c = base();
      c.ax = a[0] * MM;
      c.ay = a[1] * MM;
      c.bx = b[0] * MM;
      c.by = b[1] * MM;
      c.radius = radius * MM;
      c.height = height * MM;
      c.material = material;
      c.device = device;
      c.deviceId = deviceId;
      this.colliders.push(c);
      return c;
    };
    const circle = (
      x: number,
      y: number,
      radius: number,
      material: MaterialName,
      height = 25,
      device: DeviceKind = 'none',
      deviceId = '',
    ): StaticCollider => {
      const c = base();
      c.kind = 'circle';
      c.ax = c.bx = x * MM;
      c.ay = c.by = y * MM;
      c.radius = radius * MM;
      c.height = height * MM;
      c.material = material;
      c.device = device;
      c.deviceId = deviceId;
      this.colliders.push(c);
      return c;
    };
    const tri = (a: Vec3, b: Vec3, cc: Vec3, material: MaterialName): void => {
      const c = base();
      c.kind = 'triangle';
      [c.ax, c.ay, c.az] = [a[0] * MM, a[1] * MM, a[2] * MM];
      [c.bx, c.by, c.bz] = [b[0] * MM, b[1] * MM, b[2] * MM];
      [c.cx, c.cy, c.cz] = [cc[0] * MM, cc[1] * MM, cc[2] * MM];
      c.material = material;
      this.colliders.push(c);
    };
    const capsule = (a: Vec3, b: Vec3, radius: number, material: MaterialName): void => {
      const c = base();
      c.kind = 'capsule';
      [c.ax, c.ay, c.az] = [a[0] * MM, a[1] * MM, a[2] * MM];
      [c.bx, c.by, c.bz] = [b[0] * MM, b[1] * MM, b[2] * MM];
      c.radius = radius * MM;
      c.material = material;
      this.colliders.push(c);
    };
    const sensor = (
      id: string,
      a: readonly [number, number],
      b: readonly [number, number],
      zMin: number,
      zMax: number,
      spinner = false,
    ): void => {
      this.sensors.push({
        id,
        ax: a[0] * MM,
        ay: a[1] * MM,
        bx: b[0] * MM,
        by: b[1] * MM,
        zMin: zMin * MM,
        zMax: zMax * MM,
        spinner,
        sides: [],
      });
    };

    for (const el of t.elements) {
      switch (el.type) {
        case 'wall':
          for (let i = 0; i + 1 < el.points.length; i++) {
            seg(el.points[i]!, el.points[i + 1]!, el.radius ?? 1.5, el.material, el.height ?? 25);
          }
          break;
        case 'post':
          circle(el.x, el.y, el.radius, el.material, el.height ?? 25);
          break;
        case 'sling':
          // Kicking rubber face plus passive sides; rubber-ringed posts at the corners.
          seg(el.top, el.bottom, 3, 'rubberSling', el.height ?? 25, 'sling', el.id);
          seg(el.corner, el.top, 2, 'wood', el.height ?? 25);
          seg(el.corner, el.bottom, 2, 'wood', el.height ?? 25);
          circle(el.top[0], el.top[1], 5, 'rubberPost', el.height ?? 25);
          circle(el.bottom[0], el.bottom[1], 5, 'rubberPost', el.height ?? 25);
          break;
        case 'pop':
          circle(el.x, el.y, el.radius, 'popBumper', 40, 'pop', el.id);
          if (el.kick !== undefined) this.popKicks.set(el.id, el.kick);
          break;
        case 'rampBumper': {
          // The bumper wall (a pop wall just under the top, so a ball riding over the top passes
          // above it) and the ramp (triangles). The wall goes first: a ball is resolved against
          // colliders in this order, and the pop must see the ball's full approach speed before
          // the top's edge has taken any of it. All of it switches on and off together.
          const first = this.colliders.length;
          const m = rampBumperMesh(el);
          for (const w of m.wall) {
            const c = seg(w.a, w.b, FACE_RADIUS, 'popBumper', w.height, 'pop', el.id);
            // One-way: a ball on top of the ramp rolls off the back edge; the wall is the slab's side.
            c.gnx = w.nx;
            c.gny = w.ny;
          }
          for (const t of m.top) tri(t[0], t[1], t[2], 'plastic');
          if (el.kick !== undefined) this.popKicks.set(el.id, el.kick);
          const r: RetractablePop = {
            id: el.id,
            x: el.x * MM,
            y: el.y * MM,
            radius: el.radius * MM,
            parts: this.colliders.slice(first).map((c) => ({ c, h: c.height })),
            lift: 0,
            raised: false,
          };
          this.retractables.push(r);
          this.setLift(r, 0);
          break;
        }
        case 'drop':
          seg(el.a, el.b, 2.5, 'dropTarget', 30, 'drop', el.id);
          this.drops.set(el.id, { id: el.id, down: false });
          break;
        case 'standup':
          seg(el.a, el.b, 3, 'rubberPost', 30, 'standup', el.id);
          break;
        case 'kicker':
          seg(el.a, el.b, 3, 'kicker', 25, 'kicker', el.id);
          break;
        case 'gate': {
          const c = seg(el.a, el.b, 1.5, 'metal', 30, 'gate', el.id);
          c.gnx = dcos(el.allow * DEG);
          c.gny = dsin(el.allow * DEG);
          break;
        }
        case 'spinner':
          sensor(el.id, el.a, el.b, 0, 40, true);
          this.spinners.set(el.id, {
            id: el.id,
            angle: 0,
            omega: 0,
            revs: 0,
            ax: el.a[0] * MM,
            ay: el.a[1] * MM,
            bx: el.b[0] * MM,
            by: el.b[1] * MM,
          });
          break;
        case 'sensor':
          sensor(el.id, el.a, el.b, el.zMin ?? 0, el.zMax ?? 40);
          break;
        case 'ramp': {
          const { left, right } = rampEdges(el.path, el.width, el.endWidth ?? el.width);
          for (let i = 0; i + 1 < el.path.length; i++) {
            const l0 = left[i]!;
            const l1 = left[i + 1]!;
            const r0 = right[i]!;
            const r1 = right[i + 1]!;
            tri(l0, r0, r1, 'plastic');
            tri(l0, r1, l1, 'plastic');
            const up = (v: Vec3): Vec3 => [v[0], v[1], v[2] + el.wallHeight];
            tri(l0, l1, up(l1), 'plastic');
            tri(l0, up(l1), up(l0), 'plastic');
            tri(r0, r1, up(r1), 'plastic');
            tri(r0, up(r1), up(r0), 'plastic');
            // Skirts from the floor edges down to the playfield, so no ball can wedge itself
            // under a ramp.
            for (const [a, b] of [
              [l0, l1],
              [r0, r1],
            ] as const) {
              const down = (v: Vec3): Vec3 => [v[0], v[1], 0];
              if (b[2] > 0.5) tri(a, b, down(b), 'plastic');
              if (a[2] > 0.5) tri(a, down(b), down(a), 'plastic');
            }
          }
          // And across the far end.
          const le = left[left.length - 1]!;
          const re = right[right.length - 1]!;
          tri(le, re, [re[0], re[1], 0], 'plastic');
          tri(le, [re[0], re[1], 0], [le[0], le[1], 0], 'plastic');
          break;
        }
        case 'wireform': {
          for (const rail of wireformRails(el.path, p.ballRadius / MM)) {
            for (let i = 0; i + 1 < rail.length; i++) capsule(rail[i]!, rail[i + 1]!, 2, 'wire');
          }
          break;
        }
        case 'dome':
          if (el.solid === false) break;
          this.domes.push({
            id: el.id,
            cx: el.x * MM,
            cy: el.y * MM,
            a: el.radius * MM,
            height: el.height * MM,
          });
          break;
        case 'magnet':
          this.magnets.push({
            id: el.id,
            cx: el.x * MM,
            cy: el.y * MM,
            radius: el.radius * MM,
            power: 0,
          });
          break;
        case 'kickback':
          this.kickbacks.push({
            id: el.id,
            x0: el.x0 * MM,
            y0: el.y0 * MM,
            x1: el.x1 * MM,
            y1: el.y1 * MM,
            angle: el.angle,
            armed: true,
          });
          break;
        case 'plunger':
          this.plunger = {
            id: el.id,
            x0: el.x0 * MM,
            x1: el.x1 * MM,
            tipY: el.tipY * MM,
            pull: 0,
            pullTarget: 1,
            pressed: false,
          };
          seg([el.x0, el.tipY], [el.x1, el.tipY], 1, 'rubberPost', 25);
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
            settling: null,
            holding: false,
            ball: null,
          });
          // Rubber-faced back lip (the fielder standee base).
          const la = el.lipAngle * DEG;
          if (el.lip === 'none') break;
          if (el.lip === 'post') {
            const post = saucerLipPost(el);
            circle(post.x, post.y, post.radius, 'glove', 12);
            break;
          }
          const lx = el.x + (el.radius + 6) * dcos(la);
          const ly = el.y + (el.radius + 6) * dsin(la);
          const half = el.radius * 0.9;
          const tx = -dsin(la) * half;
          const ty = dcos(la) * half;
          seg([lx - tx, ly - ty], [lx + tx, ly + ty], 4, 'glove', 12);
          break;
        }
        case 'flipper': {
          const f = new Flipper(el);
          f.setParams(p.flipper);
          this.flippers.push(f);
          break;
        }
        case 'lamp':
          break; // visual only
      }
    }
  }
}

// ---------------------------------------------------------------- geometry helpers

/** Left/right floor edges of a ramp (mm), offset horizontally from the centre line. */
/** Centre (mm) and radius of a saucer's round lip post. */
export function saucerLipPost(el: SaucerDef): { x: number; y: number; radius: number } {
  if (el.lipPost)
    return { x: el.x + el.lipPost.dx, y: el.y + el.lipPost.dy, radius: el.lipPost.radius };
  const la = el.lipAngle * DEG;
  return { x: el.x + (el.radius + 8) * dcos(la), y: el.y + (el.radius + 8) * dsin(la), radius: 8 };
}

export function rampEdges(
  path: readonly Vec3[],
  width: number,
  endWidth = width,
): { left: Vec3[]; right: Vec3[] } {
  const left: Vec3[] = [];
  const right: Vec3[] = [];
  for (let i = 0; i < path.length; i++) {
    const w = width + ((endWidth - width) * i) / Math.max(1, path.length - 1);
    const prev = path[Math.max(0, i - 1)]!;
    const next = path[Math.min(path.length - 1, i + 1)]!;
    const dx = next[0] - prev[0];
    const dy = next[1] - prev[1];
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    const lx = (-dy / len) * (w / 2);
    const ly = (dx / len) * (w / 2);
    const p = path[i]!;
    left.push([p[0] + lx, p[1] + ly, p[2]]);
    right.push([p[0] - lx, p[1] - ly, p[2]]);
  }
  return { left, right };
}

/**
 * Six rails around a wireform's ball-centre path (mm): two below the ball, cradling it, one on
 * each side at the ball's equator, and two above, so a fast ball cannot jump the track.
 */
export function wireformRails(path: readonly Vec3[], ballRadius: number): Vec3[][] {
  const railR = 2;
  const reach = ballRadius + railR; // rail axis distance from the ball centre
  const lateralLow = 9;
  const drop = Math.sqrt(reach * reach - lateralLow * lateralLow);
  const lateralHigh = 10;
  const rise = Math.sqrt((reach + 1) * (reach + 1) - lateralHigh * lateralHigh);
  const offsets: [number, number][] = [
    [lateralLow, -drop],
    [-lateralLow, -drop],
    [reach + 1, 0],
    [-(reach + 1), 0],
    [lateralHigh, rise],
    [-lateralHigh, rise],
  ];
  // The entry is flared: side and top rails start further out and close in by the second point,
  // so a ball arriving slightly off-centre from a ramp is gathered in rather than hitting rail ends.
  const flare = (i: number, k: number): number => (i === 0 ? k : i === 1 ? 1 + (k - 1) / 3 : 1);
  return offsets.map(([lat, dz], railIndex) =>
    path.map((p, i) => {
      const prev = path[Math.max(0, i - 1)]!;
      const next = path[Math.min(path.length - 1, i + 1)]!;
      const dx = next[0] - prev[0];
      const dy = next[1] - prev[1];
      const len = Math.sqrt(dx * dx + dy * dy) || 1;
      const isBottom = railIndex < 2;
      const l = isBottom ? lat : lat * flare(i, 1.6);
      const z = isBottom ? dz : dz * flare(i, 2.2);
      return [p[0] + (-dy / len) * l, p[1] + (dx / len) * l, p[2] + z] as Vec3;
    }),
  );
}

/** Closest point on triangle (a, b, c) of collider `t` to point p (Ericson, RTCD § 5.1.5). */
function closestOnTriangle(
  px: number,
  py: number,
  pz: number,
  t: StaticCollider,
  out: { x: number; y: number; z: number },
): void {
  const abx = t.bx - t.ax;
  const aby = t.by - t.ay;
  const abz = t.bz - t.az;
  const acx = t.cx - t.ax;
  const acy = t.cy - t.ay;
  const acz = t.cz - t.az;
  const apx = px - t.ax;
  const apy = py - t.ay;
  const apz = pz - t.az;
  const d1 = abx * apx + aby * apy + abz * apz;
  const d2 = acx * apx + acy * apy + acz * apz;
  if (d1 <= 0 && d2 <= 0) {
    out.x = t.ax;
    out.y = t.ay;
    out.z = t.az;
    return;
  }
  const bpx = px - t.bx;
  const bpy = py - t.by;
  const bpz = pz - t.bz;
  const d3 = abx * bpx + aby * bpy + abz * bpz;
  const d4 = acx * bpx + acy * bpy + acz * bpz;
  if (d3 >= 0 && d4 <= d3) {
    out.x = t.bx;
    out.y = t.by;
    out.z = t.bz;
    return;
  }
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    const v = d1 / (d1 - d3);
    out.x = t.ax + v * abx;
    out.y = t.ay + v * aby;
    out.z = t.az + v * abz;
    return;
  }
  const cpx = px - t.cx;
  const cpy = py - t.cy;
  const cpz = pz - t.cz;
  const d5 = abx * cpx + aby * cpy + abz * cpz;
  const d6 = acx * cpx + acy * cpy + acz * cpz;
  if (d6 >= 0 && d5 <= d6) {
    out.x = t.cx;
    out.y = t.cy;
    out.z = t.cz;
    return;
  }
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    const w = d2 / (d2 - d6);
    out.x = t.ax + w * acx;
    out.y = t.ay + w * acy;
    out.z = t.az + w * acz;
    return;
  }
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
    const w = (d4 - d3) / (d4 - d3 + (d5 - d6));
    out.x = t.bx + w * (t.cx - t.bx);
    out.y = t.by + w * (t.cy - t.by);
    out.z = t.bz + w * (t.cz - t.bz);
    return;
  }
  const denom = 1 / (va + vb + vc);
  const v = vb * denom;
  const w = vc * denom;
  out.x = t.ax + abx * v + acx * w;
  out.y = t.ay + aby * v + acy * w;
  out.z = t.az + abz * v + acz * w;
}

/** Uniform grid over the static colliders, each padded so a centre query finds all contacts. */
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
      const xs = c.kind === 'triangle' ? [c.ax, c.bx, c.cx] : [c.ax, c.bx];
      const ys = c.kind === 'triangle' ? [c.ay, c.by, c.cy] : [c.ay, c.by];
      const minX = Math.min(...xs) - c.radius - pad;
      const maxX = Math.max(...xs) + c.radius + pad;
      const minY = Math.min(...ys) - c.radius - pad;
      const maxY = Math.max(...ys) + c.radius + pad;
      for (let j = this.iy(minY); j <= this.iy(maxY); j++) {
        for (let i = this.ix(minX); i <= this.ix(maxX); i++) this.cells[j * this.nx + i]!.push(c);
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
