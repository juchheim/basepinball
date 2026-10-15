import { Rng } from '../core/rng';
import { dcos, dsin, DEG } from '../core/dmath';
import { defaultParams, type PhysicsParams } from '../physics/params';
import type { Ball } from '../physics/ball';
import type { Flipper } from '../physics/flipper';
import { World } from '../physics/world';
import { GameRules } from '../rules/game';
import type { GameStats, RulesEvent } from '../rules/types';
import type { AiDifficulty } from '../rules/match';
import { WorldMachine } from '../rules/worldMachine';
import type { TableDef } from '../table/schema';
import { v1Table } from '../table/v1Table';

/**
 * Headless sim bot (docs/MVP/04 § 9): plays complete games with physics + rules at hundreds of
 * times real time, for balancing. Profiles differ in reaction consistency and in whether they
 * catch-and-cradle before shooting.
 */

export interface BotProfile {
  name: string;
  /** Maximum encounter-specific timing offset (s). Sampled once when a plan is made. */
  jitter: number;
  /** Chance of committing to a predicted encounter. Sampled once per encounter. */
  attention: number;
  /** Delay before committing to a response, in seconds. */
  reactionDelay?: number;
  /** Chance of choosing a physical catch for a slow, controllable arrival. */
  cradle: number;
  /** How often the bot refreshes trajectory plans (s). Paddle deadlines still run every step. */
  thinkInterval?: number;
}

export const PROFILES: Record<string, BotProfile> = {
  rookie: { name: 'rookie', jitter: 0.03, attention: 0.85, cradle: 0 },
  average: { name: 'average', jitter: 0.016, attention: 0.95, cradle: 0.35 },
  // The bot cannot yet aim from a cradle (that needs a shot map per release timing), so its
  // "expert" is a sharper, more attentive reactor rather than a cradle-and-aim player.
  expert: { name: 'expert', jitter: 0.006, attention: 1, cradle: 0.2 },
};

/** Player-facing levels vary planning cadence and timing precision; they do not use blind cradles. */
export const PLAYER_PROFILES: Record<AiDifficulty, BotProfile> = {
  easy: {
    name: 'easy',
    jitter: 0.004,
    attention: 1,
    reactionDelay: 0.005,
    cradle: 0,
    thinkInterval: 0.02,
  },
  medium: {
    name: 'medium',
    jitter: 0.002,
    attention: 1,
    reactionDelay: 0.002,
    cradle: 0,
    thinkInterval: 0.012,
  },
  hard: {
    name: 'hard',
    jitter: 0.001,
    attention: 1,
    reactionDelay: 0.001,
    cradle: 0,
    thinkInterval: 0.008,
  },
};

type FlipperSide = 'L' | 'R';
type PlanPhase = 'tracking' | 'committed' | 'striking' | 'catching' | 'cradled' | 'recovering';

interface EncounterCandidate {
  ball: Ball;
  /** Seconds from now to the predicted contact or rolling strike point. */
  eta: number;
  x: number;
  y: number;
  z: number;
  speed: number;
  rolling: boolean;
}

interface FlipperPlan {
  ball: Ball;
  phase: PlanPhase;
  /** Along-bat strike target used only when the ball is already rolling on the bat. */
  targetAlong: number;
  /** Selected once per encounter, so replanning does not reroll reaction or cradle decisions. */
  responseOffset: number;
  catch: boolean;
  pressAt: number;
  contactAt: number;
  contactX: number;
  contactY: number;
  contactZ: number;
  releaseAt: number;
  minReleaseAt: number;
  contactDeadline: number;
  contactSeen: boolean;
  contactSince: number;
}

interface BallSnapshot {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  active: boolean;
}

interface IgnoredEncounter {
  /** If the ball never reaches the paddle neighborhood, let the planned encounter expire. */
  until: number;
  /** Once seen at the paddle, keep ignoring only until it physically leaves contact range. */
  sawContact: boolean;
}

interface BallChanges {
  reset: Set<Ball>;
  trajectory: Set<Ball>;
}

const LIVE_STATES = new Set(['LEADOFF_LAUNCH', 'PITCH', 'IN_PLAY', 'LIVE_AFTER_HIT']);
const CONTACT_STEP = 0.002;
const CONTACT_HORIZON = 0.24;
// Default coil torque/inertia needs about 19 ms for a full stroke; leave a little margin.
const FLIPPER_LEAD = 0.026;
const CONTACT_TOLERANCE = 0.002;
const LOCAL_SAFETY_MARGIN = 0.012;

export class Bot {
  private readonly rng: Rng;
  private readonly plans: Record<FlipperSide, FlipperPlan | null> = {
    L: null,
    R: null,
  };
  /** Suppress duplicate decisions for one physical encounter without hiding a later return. */
  private readonly ignoredBalls: Record<FlipperSide, Map<Ball, IgnoredEncounter>> = {
    L: new Map(),
    R: new Map(),
  };
  private readonly ballSnapshots = new WeakMap<Ball, BallSnapshot>();
  private plungeAt = -1;
  private plungeRelease = -1;
  private readonly probe = { d: 0, nx: 0, ny: 0 };
  private nextThinkAt = -Infinity;

  constructor(
    private readonly profile: BotProfile,
    seed: number,
  ) {
    this.rng = new Rng(seed);
  }

  /** Called once per physics step. Paddle deadlines are serviced each step; planning is throttled. */
  update(world: World, rules: GameRules): void {
    const now = world.time;
    const ballChanges = this.trackBallEncounters(world);

    // Plunger: on the leadoff, pull for a random time and release.
    const b = world.balls.find((x) => x.active);
    if (
      rules.state === 'LEADOFF_LAUNCH' &&
      b?.active &&
      world.plunger &&
      b.py < 0.08 &&
      b.px > 0.55
    ) {
      if (this.plungeAt < 0) {
        this.plungeAt = now + 0.4;
        this.plungeRelease = this.plungeAt + this.rng.range(0.35, 0.95);
      }
      if (now >= this.plungeAt && now < this.plungeRelease) world.setPlunger(true);
      else if (now >= this.plungeRelease) {
        world.setPlunger(false);
        this.plungeAt = -1;
      }
    }

    if (!LIVE_STATES.has(rules.state) || rules.tilted || !world.flippersEnabled) {
      for (const side of ['L', 'R'] as const) {
        const f = world.flippers.find((x) => x.id === `flipper.${side}`)!;
        this.setPressed(world, rules, side, f, false);
        this.plans[side] = null;
      }
      return;
    }

    for (const side of ['L', 'R'] as const) {
      const f = world.flippers.find((x) => x.id === `flipper.${side}`)!;
      const plan = this.plans[side];
      this.pruneIgnoredBalls(side, f, now);
      if (plan && ballChanges.reset.has(plan.ball)) {
        this.setPressed(world, rules, side, f, false);
        this.plans[side] = null;
      } else if (
        plan &&
        ballChanges.trajectory.has(plan.ball) &&
        (plan.phase === 'tracking' || plan.phase === 'committed')
      ) {
        // A rebound invalidates a forecast, but a ball impact during a strike must not cancel the
        // coil stroke that caused it.
        this.plans[side] = null;
        this.nextThinkAt = now;
      } else {
        this.advancePlan(world, rules, side, f, now);
      }
      const pending = this.plans[side];
      if (!pending || pending.phase === 'tracking' || pending.phase === 'committed') {
        // The physical near-contact check may override a pending forecast that has gone stale.
        this.tryLocalSafetyPress(world, rules, side, f, now);
      }
    }

    if (now >= this.nextThinkAt) {
      for (const side of ['L', 'R'] as const) this.refreshPlan(world, side, now);
      this.nextThinkAt = now + (this.profile.thinkInterval ?? 0.02);
    }
  }

  private trackBallEncounters(world: World): BallChanges {
    const reset = new Set<Ball>();
    const trajectory = new Set<Ball>();
    for (const ball of world.balls) {
      const previous = this.ballSnapshots.get(ball);
      const teleported =
        previous &&
        ball.active &&
        Math.hypot(ball.px - previous.x, ball.py - previous.y, ball.pz - previous.z) > 0.08;
      if (previous && (previous.active !== ball.active || teleported)) {
        reset.add(ball);
        this.ignoredBalls.L.delete(ball);
        this.ignoredBalls.R.delete(ball);
      } else if (
        previous &&
        ball.active &&
        Math.hypot(ball.vx - previous.vx, ball.vy - previous.vy, ball.vz - previous.vz) > 0.8
      ) {
        trajectory.add(ball);
      }
      this.ballSnapshots.set(ball, {
        x: ball.px,
        y: ball.py,
        z: ball.pz,
        vx: ball.vx,
        vy: ball.vy,
        vz: ball.vz,
        active: ball.active,
      });
    }
    return { reset, trajectory };
  }

  private setPressed(
    world: World,
    rules: GameRules,
    side: FlipperSide,
    f: Flipper,
    pressed: boolean,
  ): void {
    if (f.pressed === pressed) return;
    world.setFlipper(f.id, pressed);
    rules.onButton(side, pressed);
  }

  private pruneIgnoredBalls(side: FlipperSide, f: Flipper, now: number): void {
    for (const [ball, ignored] of this.ignoredBalls[side]) {
      if (!ball.active) {
        this.ignoredBalls[side].delete(ball);
        continue;
      }
      f.distance(ball.px, ball.py, this.probe);
      const near =
        ball.pz - ball.radius <= f.height && this.probe.d <= ball.radius + LOCAL_SAFETY_MARGIN;
      if (near) ignored.sawContact = true;
      if ((ignored.sawContact && !near) || (!ignored.sawContact && now >= ignored.until)) {
        this.ignoredBalls[side].delete(ball);
      }
    }
    const plan = this.plans[side];
    if (plan && (!plan.ball.active || now - plan.pressAt > 2)) this.plans[side] = null;
  }

  private advancePlan(
    world: World,
    rules: GameRules,
    side: FlipperSide,
    f: Flipper,
    now: number,
  ): void {
    const plan = this.plans[side];
    if (!plan) {
      if (f.pressed) this.setPressed(world, rules, side, f, false);
      return;
    }

    if (plan.phase === 'tracking') return;

    if (plan.phase === 'committed') {
      if (now < plan.pressAt) return;
      // A planned contact can become stale after a bounce, catch, drain or multiball collision.
      // Re-predict immediately before pressing and move the deadline if the arrival shifted.
      const current = this.predictEncounter(world, plan.ball, f, plan.targetAlong);
      if (!current || current.eta > 0.12) {
        this.plans[side] = null;
        return;
      }
      const expectedEta = Math.max(0, plan.contactAt - now);
      const contactShift = Math.hypot(
        current.x - plan.contactX,
        current.y - plan.contactY,
        current.z - plan.contactZ,
      );
      if (Math.abs(current.eta - expectedEta) > 0.06 || contactShift > 0.06) {
        // The contact moved materially since the last plan update. Drop it and let the next
        // planning tick make a fresh encounter decision from the new path.
        this.plans[side] = null;
        return;
      }
      const revisedPressAt = now + Math.max(0, current.eta - FLIPPER_LEAD);
      if (revisedPressAt > now + world.dt) {
        plan.pressAt = revisedPressAt;
        plan.contactAt = now + current.eta;
        plan.contactX = current.x;
        plan.contactY = current.y;
        plan.contactZ = current.z;
        return;
      }
      this.setPressed(world, rules, side, f, true);
      plan.phase = plan.catch ? 'catching' : 'striking';
      plan.contactSeen = false;
      plan.contactSince = -1;
      plan.minReleaseAt = now + 0.035;
      plan.contactDeadline = now + (plan.catch ? 0.24 : 0.18);
      return;
    }

    if (plan.phase === 'recovering') {
      // Replan as soon as the bat is physically at rest, after a short debounce. The encounter
      // ignore marker independently prevents duplicate presses while the same ball still touches.
      if (now >= plan.releaseAt && f.phase <= 0.025) this.plans[side] = null;
      return;
    }

    if (plan.phase === 'cradled') {
      if (!this.isTouching(plan.ball, f, 0.008) || now >= plan.releaseAt) {
        this.finishAction(world, rules, side, f, plan, now);
      }
      return;
    }

    const touching = this.isTouching(plan.ball, f, 0.004);
    if (touching) {
      plan.contactSeen = true;
      if (plan.ball.speed() <= 0.45) {
        if (plan.contactSince < 0) plan.contactSince = now;
      } else {
        plan.contactSince = -1;
      }
    }

    if (plan.phase === 'catching' && plan.contactSince >= 0 && now - plan.contactSince >= 0.075) {
      // A cradle only starts after sustained, slow, real contact with the raised bat.
      plan.phase = 'cradled';
      plan.releaseAt = now + this.rng.range(0.45, 0.9);
      return;
    }

    const departed = plan.contactSeen && !touching && now >= plan.minReleaseAt;
    if (!plan.ball.active || departed || now >= plan.contactDeadline) {
      this.finishAction(world, rules, side, f, plan, now);
    }
  }

  private finishAction(
    world: World,
    rules: GameRules,
    side: FlipperSide,
    f: Flipper,
    plan: FlipperPlan,
    now: number,
  ): void {
    this.setPressed(world, rules, side, f, false);
    this.ignoreEncounter(side, plan.ball, now + 0.04, plan.contactSeen);
    plan.phase = 'recovering';
    plan.releaseAt = now + 0.02;
  }

  private ignoreEncounter(side: FlipperSide, ball: Ball, until: number, sawContact: boolean): void {
    this.ignoredBalls[side].set(ball, { until, sawContact });
  }

  /**
   * Last-resort reaction for a ball that reaches the resting bat between forecast updates or after
   * an unmodelled table bounce. Physical contact is authoritative, even if its prior plan expired.
   */
  private tryLocalSafetyPress(
    world: World,
    rules: GameRules,
    side: FlipperSide,
    f: Flipper,
    now: number,
  ): void {
    if (f.pressed || f.phase > 0.06) return;
    const c = dcos(f.theta);
    const s = dsin(f.theta);
    let chosen: Ball | null = null;
    let chosenGap = Infinity;

    for (const ball of world.balls) {
      if (!ball.active || ball.pz - ball.radius > f.height || this.ignoredBalls[side].has(ball))
        continue;
      f.distance(ball.px, ball.py, this.probe);
      const gap = this.probe.d - ball.radius;
      const normalSpeed = ball.vx * this.probe.nx + ball.vy * this.probe.ny;
      const along = ((ball.px - f.px) * c + (ball.py - f.py) * s) / f.length;
      const rollingSpeed = ball.vx * c + ball.vy * s;
      const touching = gap <= 0.003;
      const arriving = gap <= 0.025 && normalSpeed < -0.1;
      const rollingOffBat =
        gap <= 0.008 && Math.abs(normalSpeed) <= 0.25 && rollingSpeed > 0.02 && along >= 0.05;
      if ((touching || arriving || rollingOffBat) && gap < chosenGap) {
        chosen = ball;
        chosenGap = gap;
      }
    }

    if (!chosen) return;
    this.setPressed(world, rules, side, f, true);
    this.plans[side] = {
      ball: chosen,
      phase: 'striking',
      targetAlong: 0.72,
      responseOffset: 0,
      catch: false,
      pressAt: now,
      contactAt: now,
      contactX: chosen.px,
      contactY: chosen.py,
      contactZ: chosen.pz,
      releaseAt: -1,
      minReleaseAt: now + 0.055,
      contactDeadline: now + 0.18,
      contactSeen: true,
      contactSince: -1,
    };
  }

  private isTouching(ball: Ball, f: Flipper, margin: number): boolean {
    if (!ball.active || ball.pz - ball.radius > f.height) return false;
    f.distance(ball.px, ball.py, this.probe);
    return this.probe.d <= ball.radius + margin;
  }

  private refreshPlan(world: World, side: FlipperSide, now: number): void {
    const f = world.flippers.find((x) => x.id === `flipper.${side}`)!;
    const existing = this.plans[side];
    if (existing && existing.phase !== 'tracking' && existing.phase !== 'committed') return;
    if (f.pressed || f.phase > 0.06) return;

    let best: EncounterCandidate | null = null;
    for (const ball of world.balls) {
      if (!ball.active || this.ignoredBalls[side].has(ball)) continue;
      const candidate = this.predictEncounter(world, ball, f, existing?.targetAlong ?? 0.72);
      if (!candidate) continue;
      if (!best || this.encounterPriority(candidate) < this.encounterPriority(best))
        best = candidate;
    }

    if (existing) {
      const sameBall = best?.ball === existing.ball ? best : null;
      if (sameBall) {
        this.schedule(existing, sameBall, now);
        return;
      }
      const current = this.predictEncounter(world, existing.ball, f, existing.targetAlong);
      if (
        current &&
        (!best || this.encounterPriority(best) + 0.025 >= this.encounterPriority(current))
      ) {
        this.schedule(existing, current, now);
        return;
      }
      this.plans[side] = null;
    }

    if (!best) return;
    // Player levels use a stable roll strike point; random target selection made paddle timing
    // look arbitrary without a calibrated shot map to explain the variation.
    const targetAlong = 0.7;
    const selected = this.predictEncounter(world, best.ball, f, targetAlong) ?? best;
    if (this.rng.next() > this.profile.attention) {
      this.ignoreEncounter(side, selected.ball, now + selected.eta + 0.06, false);
      return;
    }

    const responseOffset =
      (this.profile.reactionDelay ?? 0) + this.rng.range(-this.profile.jitter, this.profile.jitter);
    const catchBall = selected.speed <= 0.6 && this.rng.next() < this.profile.cradle;
    const plan: FlipperPlan = {
      ball: selected.ball,
      phase: 'tracking',
      targetAlong,
      responseOffset,
      catch: catchBall,
      pressAt: 0,
      contactAt: 0,
      contactX: selected.x,
      contactY: selected.y,
      contactZ: selected.z,
      releaseAt: -1,
      minReleaseAt: -1,
      contactDeadline: -1,
      contactSeen: false,
      contactSince: -1,
    };
    this.plans[side] = plan;
    this.schedule(plan, selected, now);
  }

  private schedule(plan: FlipperPlan, candidate: EncounterCandidate, now: number): void {
    // Once the predicted arrival is inside the bat's stroke lead, act now. Waiting for the full
    // reaction delay at that point would move the deadline forward on every replan.
    const available = candidate.eta - FLIPPER_LEAD;
    plan.phase = candidate.eta <= 0.12 ? 'committed' : 'tracking';
    plan.contactAt = now + candidate.eta;
    plan.contactX = candidate.x;
    plan.contactY = candidate.y;
    plan.contactZ = candidate.z;
    plan.pressAt =
      now + (available <= 0 ? 0 : available + Math.min(plan.responseOffset, FLIPPER_LEAD));
  }

  private encounterPriority(candidate: EncounterCandidate): number {
    // A low, descending ball is more urgent because it has less room to recover before the drain.
    const urgent = candidate.ball.py < 0.28 && candidate.ball.vy < 0 ? 0.015 : 0;
    return candidate.eta - urgent;
  }

  /**
   * Predicts a short ball trajectory with gravity, floor contact and rolling resistance. Static
   * table bounces are intentionally left to the next replan; the committed action is checked again
   * immediately before it can move a paddle.
   */
  private predictEncounter(
    world: World,
    ball: Ball,
    f: Flipper,
    targetAlong: number,
  ): EncounterCandidate | null {
    if (!ball.active) return null;
    const p = world.params;
    const slope = p.slopeDeg * DEG;
    const ax = 0;
    const ay = -p.gravity * dsin(slope);
    const az = -p.gravity * dcos(slope);
    const resistance = p.rollingResistance * p.gravity * dcos(slope);
    const c = dcos(f.theta);
    const s = dsin(f.theta);
    let x = ball.px;
    let y = ball.py;
    let z = ball.pz;
    let vx = ball.vx;
    let vy = ball.vy;
    let vz = ball.vz;
    const steps = Math.ceil(CONTACT_HORIZON / CONTACT_STEP);

    for (let i = 0; i <= steps; i++) {
      const t = i * CONTACT_STEP;
      if (i > 0) {
        vx += ax * CONTACT_STEP;
        vy += ay * CONTACT_STEP;
        vz += az * CONTACT_STEP;
        x += vx * CONTACT_STEP;
        y += vy * CONTACT_STEP;
        z += vz * CONTACT_STEP;
        const floor = world.floorHeightAt(x, y) + ball.radius;
        if (z < floor) {
          z = floor;
          if (vz < 0) vz = 0;
          const speed = Math.hypot(vx, vy);
          if (speed > 1e-9) {
            const nextSpeed = Math.max(0, speed - resistance * CONTACT_STEP);
            vx *= nextSpeed / speed;
            vy *= nextSpeed / speed;
          }
        }
      }

      if (z - ball.radius > f.height) continue;
      f.distance(x, y, this.probe);
      const gap = this.probe.d - ball.radius;
      const normalSpeed = vx * this.probe.nx + vy * this.probe.ny;
      const along = ((x - f.px) * c + (y - f.py) * s) / f.length;
      const rollingSpeed = vx * c + vy * s;
      const impact = gap <= CONTACT_TOLERANCE && normalSpeed < -0.08;
      const rolling =
        gap <= 0.006 &&
        Math.abs(normalSpeed) <= 0.18 &&
        rollingSpeed > 0.05 &&
        along >= 0.05 &&
        along < targetAlong;
      if (impact || rolling) {
        return {
          ball,
          eta: t,
          x,
          y,
          z,
          speed: Math.hypot(vx, vy, vz),
          rolling,
        };
      }

      if (y < 0.035 && z < 0.05) return null;
    }
    return null;
  }
}

export interface GameResult {
  stats: GameStats;
  events: RulesEvent[];
  completed: boolean;
  rescues: number;
}

/** Play one complete game headlessly. */
export function playGame(
  profile: BotProfile,
  seed: number,
  opts: { table?: TableDef; params?: PhysicsParams; maxSeconds?: number } = {},
): GameResult {
  const world = new World(opts.table ?? v1Table, opts.params ?? defaultParams(), seed);
  const rules = new GameRules(new WorldMachine(world), { seed });
  const bot = new Bot(profile, seed * 7 + 3);
  const events: RulesEvent[] = [];
  rules.start(0);
  const maxSteps = (opts.maxSeconds ?? 3600) * world.params.rate;
  for (let i = 0; i < maxSteps && rules.state !== 'GAME_OVER'; i++) {
    bot.update(world, rules);
    world.step();
    for (const e of world.events) rules.onSwitch(e);
    world.events.length = 0;
    rules.update(world.time);
    events.push(...rules.events);
    rules.events.length = 0;
  }
  return {
    stats: rules.stats,
    events,
    completed: rules.state === 'GAME_OVER',
    rescues: events.filter((e) => e.type === 'ballRescued').length,
  };
}
