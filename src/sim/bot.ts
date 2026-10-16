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
  /** Timing error around a deliberate strike deadline (s), sampled once per paddle opportunity. */
  jitter: number;
  /** Chance of reacting to an ambiguous encounter. Obvious slow rolls bypass this probability. */
  attention: number;
  /** Human-like recognition delay for a newly observed, ambiguous opportunity (s). */
  reactionDelay?: number;
  /** Chance of choosing a physical catch for a slow, controllable arrival. */
  cradle: number;
  /** How often the bot refreshes trajectory plans (s). Paddle deadlines still run every step. */
  thinkInterval?: number;
  /** Target contact point along the bat for planned hits and controlled rolls. */
  rollTarget?: number;
  /** Target contact point for the deliberate shot after releasing a cradle. */
  cradleTarget?: number;
  /** Hard-only contact target when no runners are on, favoring frequent singles and doubles. */
  emptyBasesTarget?: number;
  /** Hard-only contact target with runners on, favoring extra-base hits. */
  occupiedBasesTarget?: number;
  /** Use bat-supported roll physics when forecasting a ball already resting on a flipper. */
  supportedRollPrediction?: boolean;
  /** Permit a local safety press for a measured near-term contact or tip exit. */
  urgentSafety?: boolean;
  /** Advance ordinary-pitch strikes by this many ms before the forecast safety window. */
  anticipatoryStrikeLeadMs?: number;
  /** Restrict catch attempts to this normalized along-bat interval. */
  catchRange?: readonly [number, number];
}

export const PROFILES: Record<string, BotProfile> = {
  rookie: { name: 'rookie', jitter: 0.03, attention: 0.85, cradle: 0 },
  average: { name: 'average', jitter: 0.016, attention: 0.95, cradle: 0.35 },
  // Expert stays a sharper, more attentive reactor than the average balance profile.
  expert: { name: 'expert', jitter: 0.006, attention: 1, cradle: 0.2 },
};

/** Player-facing levels vary recognition time and timing precision, not whether they see easy rolls. */
export const PLAYER_PROFILES: Record<AiDifficulty, BotProfile> = {
  easy: {
    name: 'easy',
    jitter: 0.01,
    attention: 1,
    reactionDelay: 0.09,
    cradle: 0.1,
    thinkInterval: 0.02,
    // Contact nearer the pivot produces lower-power shots and fewer home runs.
    rollTarget: 0.4,
    cradleTarget: 0.56,
  },
  medium: {
    name: 'medium',
    jitter: 0.005,
    attention: 1,
    reactionDelay: 0.065,
    cradle: 0.35,
    thinkInterval: 0.012,
    rollTarget: 0.65,
    cradleTarget: 0.7,
  },
  hard: {
    name: 'hard',
    jitter: 0.00075,
    attention: 1,
    reactionDelay: 0.016,
    cradle: 0.65,
    thinkInterval: 0.004,
    rollTarget: 0.75,
    cradleTarget: 0.76,
    emptyBasesTarget: 0.6,
    occupiedBasesTarget: 0.82,
    supportedRollPrediction: true,
    urgentSafety: true,
    anticipatoryStrikeLeadMs: 12,
    catchRange: [0.2, 0.7],
  },
};

type FlipperSide = 'L' | 'R';
type PlanPhase =
  'tracking' | 'committed' | 'striking' | 'catching' | 'cradled' | 'releasing' | 'recovering';

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
  catch: boolean;
  /** A cradle is being released and must reach its deliberate follow-up shot before replanning. */
  followUp: boolean;
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

interface PaddleOpportunity {
  /** First visible moment sets the reaction clock for ambiguous shots. */
  firstSeenAt: number;
  lastSeenAt: number;
  closeSince: number;
  supportedSince: number;
  lastSupportedAt: number;
  lastAttemptAt: number;
  attempts: number;
  attentionAccepted: boolean;
  timingError: number;
  along: number;
  gap: number;
  normalSpeed: number;
  tangentSpeed: number;
  timeToExit: number;
  contactEta: number;
  supported: boolean;
  obvious: boolean;
}

interface PaddleContact {
  gap: number;
  along: number;
  normalSpeed: number;
  tangentSpeed: number;
  facesStroke: boolean;
  inRollRegion: boolean;
}

interface BallChanges {
  reset: Set<Ball>;
  trajectory: Set<Ball>;
}

const LIVE_STATES = new Set(['LEADOFF_LAUNCH', 'PITCH', 'IN_PLAY', 'LIVE_AFTER_HIT']);
const CONTACT_STEP = 0.002;
const CONTACT_HORIZON = 0.24;
const CRADLE_ROLLOUT_HORIZON = 0.5;
const CONTACT_TOLERANCE = 0.002;
const OPPORTUNITY_RANGE = 0.09;
const OPPORTUNITY_ABSENCE = 0.08;
const SUPPORT_GAP = 0.006;
const SUPPORT_GAP_GRACE = 0.015;
const CLOSE_GAP = 0.02;
const OBVIOUS_DWELL = 0.08;
const RETRY_COOLDOWN = 0.065;
const MIN_STRIKE_PRESS = 0.05;
const MAX_STRIKE_PRESS = 0.12;
const CRADLE_SETUP_LEAD = 0.08;
const CRADLE_DWELL = 0.075;
const CRADLE_HOLD_MIN = 0.35;
const CRADLE_HOLD_MAX = 0.65;
const STRIKE_FACING_DOT = 0.35;
const ROLL_MIN_ALONG = 0.15;
const ROLL_MAX_ALONG = 1.04;

export class Bot {
  private readonly rng: Rng;
  private readonly plans: Record<FlipperSide, FlipperPlan | null> = {
    L: null,
    R: null,
  };
  /** Opportunities outlive strokes, so a weak first attempt can be corrected after recovery. */
  private readonly opportunities: Record<FlipperSide, Map<Ball, PaddleOpportunity>> = {
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
      this.updatePaddleOpportunities(world, rules, side, f, now);
      const plan = this.plans[side];
      if (plan && ballChanges.reset.has(plan.ball)) {
        this.setPressed(world, rules, side, f, false);
        this.plans[side] = null;
        this.opportunities[side].delete(plan.ball);
        this.nextThinkAt = now;
      } else if (
        plan &&
        ballChanges.trajectory.has(plan.ball) &&
        (plan.phase === 'tracking' || plan.phase === 'committed')
      ) {
        // A rebound invalidates a forecast, but a ball impact during a strike must not cancel the
        // coil stroke that caused it.
        if (plan.followUp) plan.phase = 'tracking';
        else this.plans[side] = null;
        this.nextThinkAt = now;
      } else {
        this.advancePlan(world, rules, side, f, now);
      }
      // Obvious supported contacts can override a stale forecast, even when another plan is
      // tracking or committed for later. Let active strokes finish before considering a retry.
      const pending = this.plans[side];
      if (!pending || pending.phase === 'tracking' || pending.phase === 'committed') {
        this.tryLocalSafetyPress(world, rules, side, f, now);
      }
    }

    if (now >= this.nextThinkAt) {
      for (const side of ['L', 'R'] as const)
        this.refreshPlan(world, rules, side, now, rules.pitchLive);
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
        this.opportunities.L.delete(ball);
        this.opportunities.R.delete(ball);
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

  private getPaddleOpportunity(side: FlipperSide, ball: Ball, now: number): PaddleOpportunity {
    let opportunity = this.opportunities[side].get(ball);
    if (!opportunity) {
      opportunity = {
        firstSeenAt: now,
        lastSeenAt: now,
        closeSince: -1,
        supportedSince: -1,
        lastSupportedAt: -Infinity,
        lastAttemptAt: -Infinity,
        attempts: 0,
        attentionAccepted: this.rng.next() < this.profile.attention,
        timingError: this.rng.range(-this.profile.jitter, this.profile.jitter),
        along: 0,
        gap: Infinity,
        normalSpeed: 0,
        tangentSpeed: 0,
        timeToExit: Infinity,
        contactEta: Infinity,
        supported: false,
        obvious: false,
      };
      this.opportunities[side].set(ball, opportunity);
    }
    opportunity.lastSeenAt = now;
    return opportunity;
  }

  private targetAlong(rules: GameRules): number {
    const fallback = this.profile.rollTarget ?? 0.7;
    if (rules.bases.some(Boolean)) return this.profile.occupiedBasesTarget ?? fallback;
    return this.profile.emptyBasesTarget ?? fallback;
  }

  private updatePaddleOpportunities(
    world: World,
    rules: GameRules,
    side: FlipperSide,
    f: Flipper,
    now: number,
  ): void {
    const seen = new Set<Ball>();
    for (const ball of world.balls) {
      if (!ball.active || ball.pz - ball.radius > f.height) continue;
      const contact = this.measurePaddleContact(ball, f);
      const existing = this.opportunities[side].get(ball);
      const relevant =
        contact.facesStroke && contact.inRollRegion && contact.gap <= OPPORTUNITY_RANGE;
      if (!relevant) {
        // Keep an in-flight opportunity through its own stroke, but don't keep refreshing it
        // after the ball has left the paddle's neighborhood.
        if (existing && this.plans[side]?.ball === ball) {
          existing.lastSeenAt = now;
          existing.supported = false;
          existing.supportedSince = -1;
          existing.closeSince = -1;
          existing.obvious = false;
          seen.add(ball);
        }
        continue;
      }

      const opportunity = this.getPaddleOpportunity(side, ball, now);
      seen.add(ball);
      opportunity.along = contact.along;
      opportunity.gap = contact.gap;
      opportunity.normalSpeed = contact.normalSpeed;
      opportunity.tangentSpeed = contact.tangentSpeed;
      opportunity.contactEta =
        contact.gap <= SUPPORT_GAP
          ? 0
          : contact.normalSpeed < -0.01
            ? contact.gap / -contact.normalSpeed
            : Infinity;
      opportunity.timeToExit = this.timeToTip(world, f, contact.along, contact.tangentSpeed);

      const close =
        contact.facesStroke &&
        contact.inRollRegion &&
        contact.gap <= CLOSE_GAP &&
        Math.abs(contact.normalSpeed) <= 0.25;
      if (close) {
        if (opportunity.closeSince < 0) opportunity.closeSince = now;
      } else if (contact.gap > CLOSE_GAP + 0.004 || Math.abs(contact.normalSpeed) > 0.35) {
        opportunity.closeSince = -1;
      }

      const supported =
        contact.facesStroke &&
        contact.inRollRegion &&
        contact.gap <= SUPPORT_GAP &&
        Math.abs(contact.normalSpeed) <= 0.25 &&
        ball.speed() <= 0.65;
      if (supported) {
        if (opportunity.supportedSince < 0) opportunity.supportedSince = now;
        opportunity.lastSupportedAt = now;
      }
      opportunity.supported = now - opportunity.lastSupportedAt <= SUPPORT_GAP_GRACE;
      if (!opportunity.supported) opportunity.supportedSince = -1;

      const targetAlong = this.targetAlong(rules);
      const dwell = opportunity.supportedSince < 0 ? 0 : now - opportunity.supportedSince;
      opportunity.obvious =
        this.profile.attention > 0 &&
        ((opportunity.supported &&
          (contact.along >= targetAlong ||
            opportunity.timeToExit <= flipperLead(world, f) + 0.02 ||
            dwell >= OBVIOUS_DWELL ||
            opportunity.attempts > 0)) ||
          (opportunity.closeSince >= 0 &&
            now - opportunity.closeSince >= OBVIOUS_DWELL &&
            opportunity.contactEta <= 0.12));
    }

    for (const [ball, opportunity] of this.opportunities[side]) {
      if (!ball.active || (!seen.has(ball) && now - opportunity.lastSeenAt > OPPORTUNITY_ABSENCE)) {
        this.opportunities[side].delete(ball);
      }
    }
    const plan = this.plans[side];
    if (plan && (!plan.ball.active || now - plan.pressAt > 2)) this.plans[side] = null;
  }

  private measurePaddleContact(ball: Ball, f: Flipper): PaddleContact {
    const c = dcos(f.theta);
    const s = dsin(f.theta);
    f.distance(ball.px, ball.py, this.probe);
    const gap = this.probe.d - ball.radius;
    const along = ((ball.px - f.px) * c + (ball.py - f.py) * s) / f.length;
    const cx = ball.px - this.probe.nx * ball.radius;
    const cy = ball.py - this.probe.ny * ball.radius;
    const surfaceVx = -f.omega * (cy - f.py);
    const surfaceVy = f.omega * (cx - f.px);
    const relativeVx = ball.vx - surfaceVx;
    const relativeVy = ball.vy - surfaceVy;
    const normalSpeed = relativeVx * this.probe.nx + relativeVy * this.probe.ny;
    const tangentSpeed = relativeVx * c + relativeVy * s;
    const strokeNx = f.dir * -s;
    const strokeNy = f.dir * c;
    return {
      gap,
      along,
      normalSpeed,
      tangentSpeed,
      facesStroke: this.probe.nx * strokeNx + this.probe.ny * strokeNy > STRIKE_FACING_DOT,
      inRollRegion: along >= ROLL_MIN_ALONG && along <= ROLL_MAX_ALONG,
    };
  }

  private timeToTip(world: World, f: Flipper, along: number, tangentSpeed: number): number {
    const distance = (1.02 - along) * f.length;
    if (distance <= 0) return 0;
    return this.timeForDistance(
      distance,
      tangentSpeed,
      this.rollAcceleration(world, f, tangentSpeed),
    );
  }

  private rollAcceleration(world: World, f: Flipper, tangentSpeed: number): number {
    const slope = world.params.slopeDeg * DEG;
    const gravityAlongBat = -world.params.gravity * dsin(slope) * dsin(f.theta);
    const rollDirection = Math.sign(tangentSpeed) || Math.sign(gravityAlongBat);
    return (
      gravityAlongBat -
      rollDirection * world.params.rollingResistance * world.params.gravity * dcos(slope)
    );
  }

  private timeForDistance(distance: number, tangentSpeed: number, acceleration: number): number {
    if (distance <= 0) return 0;
    if (Math.abs(acceleration) < 1e-5) {
      return tangentSpeed > 1e-4 ? distance / tangentSpeed : Infinity;
    }
    const discriminant = tangentSpeed * tangentSpeed + 2 * acceleration * distance;
    if (discriminant < 0) return Infinity;
    const root = Math.sqrt(discriminant);
    const candidates = [
      (-tangentSpeed + root) / acceleration,
      (-tangentSpeed - root) / acceleration,
    ];
    return (
      candidates.filter((time) => time >= 0 && Number.isFinite(time)).sort((a, b) => a - b)[0] ??
      Infinity
    );
  }

  /** Raise early for a catch only when there's enough time to settle before contact. */
  private plannedPressAt(
    world: World,
    rules: GameRules,
    side: FlipperSide,
    f: Flipper,
    plan: FlipperPlan,
    candidate: EncounterCandidate,
    opportunity: PaddleOpportunity,
    now: number,
  ): number {
    const lead = flipperLead(world, f);
    if (plan.catch && (candidate.rolling || candidate.speed > 0.6)) plan.catch = false;
    const recognizedAt = opportunity.firstSeenAt + (this.profile.reactionDelay ?? 0);
    if (
      this.profile.anticipatoryStrikeLeadMs !== undefined &&
      rules.pitchPhase === 'flight' &&
      (rules.pitchType === 'FB' || rules.pitchType === 'CH') &&
      rules.pitchSide === side &&
      !plan.catch &&
      !plan.followUp &&
      !candidate.rolling &&
      !f.pressed &&
      f.phase <= 0.06 &&
      world.balls.filter((ball) => ball.active).length === 1
    ) {
      const safetyOnset = this.predictEncounter(
        world,
        plan.ball,
        f,
        plan.targetAlong,
        CONTACT_HORIZON,
        lead,
      );
      if (safetyOnset) {
        return Math.max(
          now,
          now +
            safetyOnset.eta -
            this.profile.anticipatoryStrikeLeadMs / 1000 +
            opportunity.timingError,
          recognizedAt,
        );
      }
    }
    const pressAt = (): number =>
      Math.max(
        now,
        now + candidate.eta - lead - (plan.catch ? CRADLE_SETUP_LEAD : 0) + opportunity.timingError,
        recognizedAt,
      );

    let scheduled = pressAt();
    if (plan.catch && scheduled + lead > now + candidate.eta - 0.01) {
      // Recognition or timing noise left too little time for a settled catch. Make it a normal hit.
      plan.catch = false;
      scheduled = pressAt();
    }
    return scheduled;
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
      const current = this.predictEncounter(
        world,
        plan.ball,
        f,
        plan.targetAlong,
        plan.followUp ? CRADLE_ROLLOUT_HORIZON : CONTACT_HORIZON,
      );
      if (!current || current.eta > 0.12) {
        if (plan.followUp) plan.phase = 'tracking';
        else this.plans[side] = null;
        this.nextThinkAt = now;
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
        if (plan.followUp) plan.phase = 'tracking';
        else this.plans[side] = null;
        this.nextThinkAt = now;
        return;
      }
      const opportunity = this.getPaddleOpportunity(side, plan.ball, now);
      const revisedPressAt = this.plannedPressAt(
        world,
        rules,
        side,
        f,
        plan,
        current,
        opportunity,
        now,
      );
      if (revisedPressAt > now + world.dt) {
        plan.pressAt = revisedPressAt;
        plan.contactAt = now + current.eta;
        plan.contactX = current.x;
        plan.contactY = current.y;
        plan.contactZ = current.z;
        return;
      }
      this.setPressed(world, rules, side, f, true);
      this.markAttempt(side, plan.ball, now);
      plan.followUp = false;
      plan.phase = plan.catch ? 'catching' : 'striking';
      plan.contactSeen = false;
      plan.contactSince = -1;
      plan.minReleaseAt = now + MIN_STRIKE_PRESS;
      plan.contactDeadline = now + (plan.catch ? 0.24 : MAX_STRIKE_PRESS);
      return;
    }

    if (plan.phase === 'recovering') {
      // Replan as soon as the bat is physically at rest, after a short debounce. The persistent
      // opportunity can ask for a deliberate retry if the ball is still controllable.
      if (now >= plan.releaseAt && f.phase <= 0.025) this.plans[side] = null;
      return;
    }

    if (plan.phase === 'cradled') {
      if (!this.isTouching(plan.ball, f, 0.008) || now >= plan.releaseAt) {
        this.setPressed(world, rules, side, f, false);
        plan.phase = 'releasing';
        plan.catch = false;
        plan.followUp = true;
        plan.targetAlong =
          this.profile.emptyBasesTarget !== undefined ||
          this.profile.occupiedBasesTarget !== undefined
            ? this.targetAlong(rules)
            : (this.profile.cradleTarget ?? Math.max(0.7, this.profile.rollTarget ?? 0.7));
        plan.pressAt = now;
        plan.releaseAt = now + 0.02;
      }
      return;
    }

    if (plan.phase === 'releasing') {
      if (!plan.ball.active) {
        this.plans[side] = null;
      } else if (now >= plan.releaseAt && f.phase <= 0.025) {
        // The ball is free to roll outward on the resting bat. Keep the plan while a forecast
        // waits for the deliberate contact point.
        plan.phase = 'tracking';
        plan.pressAt = now;
        plan.contactSeen = false;
        plan.contactSince = -1;
        this.nextThinkAt = now;
      }
      return;
    }

    const touching = this.isTouching(plan.ball, f, 0.004);
    if (touching) {
      plan.contactSeen = true;
      if (plan.ball.speed() <= 0.45 && f.phase >= f.stroke - 0.025) {
        if (plan.contactSince < 0) plan.contactSince = now;
      } else {
        plan.contactSince = -1;
      }
    } else {
      plan.contactSince = -1;
    }

    if (
      plan.phase === 'catching' &&
      plan.contactSince >= 0 &&
      now - plan.contactSince >= CRADLE_DWELL
    ) {
      // A cradle only starts after sustained, slow, real contact with the raised bat.
      plan.phase = 'cradled';
      plan.releaseAt = now + this.rng.range(CRADLE_HOLD_MIN, CRADLE_HOLD_MAX);
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
    plan.phase = 'recovering';
    plan.releaseAt = now + 0.02;
  }

  private markAttempt(side: FlipperSide, ball: Ball, now: number): void {
    const opportunity = this.getPaddleOpportunity(side, ball, now);
    opportunity.lastAttemptAt = now;
    opportunity.attempts++;
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
    let chosen: Ball | null = null;
    let chosenPriority = Infinity;

    for (const ball of world.balls) {
      if (!ball.active || ball.pz - ball.radius > f.height) continue;
      const opportunity = this.opportunities[side].get(ball);
      if (!opportunity || this.profile.attention <= 0) continue;
      const contact = this.measurePaddleContact(ball, f);
      const immediateTouch =
        contact.facesStroke &&
        contact.inRollRegion &&
        contact.gap <= 0.003 &&
        contact.normalSpeed < -0.05;
      const stillSupported =
        contact.facesStroke &&
        contact.inRollRegion &&
        contact.gap <= SUPPORT_GAP + 0.003 &&
        Math.abs(contact.normalSpeed) <= 0.3 &&
        ball.speed() <= 0.75;
      const lead = flipperLead(world, f);
      const tipUrgent = stillSupported && opportunity.timeToExit <= lead + 0.012;
      const incomingUrgent =
        contact.facesStroke &&
        contact.inRollRegion &&
        contact.gap <= 0.025 &&
        contact.normalSpeed < -0.05 &&
        opportunity.contactEta <= lead + 0.006;
      const urgentSafety = this.profile.urgentSafety && (tipUrgent || incomingUrgent);
      const targetNotReached = stillSupported && contact.along < this.targetAlong(rules) - 0.012;
      if (
        this.profile.supportedRollPrediction &&
        targetNotReached &&
        !tipUrgent &&
        !immediateTouch
      ) {
        continue;
      }
      const rollingOutOfCradle = this.plans[side]?.followUp && this.plans[side]?.ball === ball;
      if (
        rollingOutOfCradle &&
        !urgentSafety &&
        !immediateTouch &&
        !(stillSupported && contact.along >= ROLL_MAX_ALONG - 0.06 && !this.profile.urgentSafety)
      ) {
        continue;
      }
      const readyToRetry = now - opportunity.lastAttemptAt >= RETRY_COOLDOWN;
      if (
        (!(opportunity.obvious && stillSupported) && !immediateTouch && !urgentSafety) ||
        !readyToRetry
      ) {
        continue;
      }
      const priority = urgentSafety
        ? -1 + Math.min(opportunity.timeToExit, opportunity.contactEta)
        : opportunity.timeToExit - (opportunity.obvious ? 0.05 : 0) - (immediateTouch ? 0.05 : 0);
      if (priority < chosenPriority) {
        chosen = ball;
        chosenPriority = priority;
      }
    }

    if (!chosen) return;
    this.setPressed(world, rules, side, f, true);
    this.plans[side] = {
      ball: chosen,
      phase: 'striking',
      targetAlong: this.targetAlong(rules),
      catch: false,
      followUp: false,
      pressAt: now,
      contactAt: now,
      contactX: chosen.px,
      contactY: chosen.py,
      contactZ: chosen.pz,
      releaseAt: -1,
      minReleaseAt: now + MIN_STRIKE_PRESS,
      contactDeadline: now + MAX_STRIKE_PRESS,
      contactSeen: true,
      contactSince: -1,
    };
    this.markAttempt(side, chosen, now);
  }

  private isTouching(ball: Ball, f: Flipper, margin: number): boolean {
    if (!ball.active || ball.pz - ball.radius > f.height) return false;
    f.distance(ball.px, ball.py, this.probe);
    return this.probe.d <= ball.radius + margin;
  }

  /** `noCradle`: a bat held out now would bunt (a fresh pitch), so swing away instead. */
  private refreshPlan(
    world: World,
    rules: GameRules,
    side: FlipperSide,
    now: number,
    noCradle: boolean,
  ): void {
    const f = world.flippers.find((x) => x.id === `flipper.${side}`)!;
    const existing = this.plans[side];
    if (existing && existing.phase !== 'tracking' && existing.phase !== 'committed') return;
    if (f.pressed || f.phase > 0.06) return;

    let best: EncounterCandidate | null = null;
    for (const ball of world.balls) {
      if (!ball.active) continue;
      const candidate = this.predictEncounter(
        world,
        ball,
        f,
        existing?.ball === ball ? existing.targetAlong : this.targetAlong(rules),
        existing?.followUp && existing.ball === ball ? CRADLE_ROLLOUT_HORIZON : CONTACT_HORIZON,
      );
      if (!candidate) continue;
      const opportunity = this.getPaddleOpportunity(side, ball, now);
      if (!opportunity.attentionAccepted && !opportunity.obvious) continue;
      if (!best || this.encounterPriority(candidate) < this.encounterPriority(best))
        best = candidate;
    }

    if (existing) {
      const sameBall = best?.ball === existing.ball ? best : null;
      if (sameBall) {
        this.schedule(world, rules, f, side, existing, sameBall, now);
        return;
      }
      const current = this.predictEncounter(
        world,
        existing.ball,
        f,
        existing.targetAlong,
        existing.followUp ? CRADLE_ROLLOUT_HORIZON : CONTACT_HORIZON,
      );
      if (existing.followUp) {
        const supported = this.supportedRollContact(existing.ball, f);
        const tipEta = supported
          ? this.timeToTip(world, f, supported.along, supported.tangentSpeed)
          : Infinity;
        const followUpEta = current?.eta ?? tipEta;
        const locallyRecoverable =
          Boolean(current) || (supported !== null && Number.isFinite(tipEta));
        const anotherBallIsMoreUrgent =
          best !== null && best.ball !== existing.ball && best.eta + 0.025 < followUpEta;
        if (locallyRecoverable && !anotherBallIsMoreUrgent) {
          if (current) this.schedule(world, rules, f, side, existing, current, now);
          return;
        }
        this.plans[side] = null;
        this.nextThinkAt = now;
      } else if (
        current &&
        (!best || this.encounterPriority(best) + 0.025 >= this.encounterPriority(current))
      ) {
        this.schedule(world, rules, f, side, existing, current, now);
        return;
      } else {
        this.plans[side] = null;
      }
    }

    if (!best) return;
    const targetAlong = this.targetAlong(rules);
    const selected = this.predictEncounter(world, best.ball, f, targetAlong) ?? best;
    const opportunity = this.getPaddleOpportunity(side, selected.ball, now);
    if (!opportunity.attentionAccepted && !opportunity.obvious) return;
    const catchCos = dcos(f.theta);
    const catchSin = dsin(f.theta);
    const catchAlong = ((selected.x - f.px) * catchCos + (selected.y - f.py) * catchSin) / f.length;
    const withinCatchRange =
      !this.profile.catchRange ||
      (catchAlong >= this.profile.catchRange[0] && catchAlong <= this.profile.catchRange[1]);
    const canSettleForCatch =
      !selected.rolling &&
      selected.speed <= 0.6 &&
      selected.eta > flipperLead(world, f) + CRADLE_SETUP_LEAD &&
      withinCatchRange;
    const catchBall = canSettleForCatch && !noCradle && this.rng.next() < this.profile.cradle;
    const plan: FlipperPlan = {
      ball: selected.ball,
      phase: 'tracking',
      targetAlong,
      catch: catchBall,
      followUp: false,
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
    this.schedule(world, rules, f, side, plan, selected, now);
  }

  private schedule(
    world: World,
    rules: GameRules,
    f: Flipper,
    side: FlipperSide,
    plan: FlipperPlan,
    candidate: EncounterCandidate,
    now: number,
  ): void {
    const opportunity = this.getPaddleOpportunity(side, candidate.ball, now);
    plan.phase = candidate.eta <= 0.12 ? 'committed' : 'tracking';
    plan.contactAt = now + candidate.eta;
    plan.contactX = candidate.x;
    plan.contactY = candidate.y;
    plan.contactZ = candidate.z;
    plan.pressAt = this.plannedPressAt(world, rules, side, f, plan, candidate, opportunity, now);
  }

  private encounterPriority(candidate: EncounterCandidate): number {
    // A low, descending ball is more urgent because it has less room to recover before the drain.
    const urgent = candidate.ball.py < 0.28 && candidate.ball.vy < 0 ? 0.015 : 0;
    return candidate.eta - urgent;
  }

  private supportedRollContact(ball: Ball, f: Flipper): PaddleContact | null {
    if (f.pressed || f.phase > 0.06 || ball.pz - ball.radius > f.height) return null;
    const contact = this.measurePaddleContact(ball, f);
    if (
      !contact.facesStroke ||
      !contact.inRollRegion ||
      contact.gap > SUPPORT_GAP + 0.003 ||
      Math.abs(contact.normalSpeed) > 0.25 ||
      ball.speed() > 0.75
    ) {
      return null;
    }
    return contact;
  }

  private predictSupportedRoll(
    world: World,
    ball: Ball,
    f: Flipper,
    targetAlong: number,
    contact: PaddleContact,
    horizon: number,
  ): EncounterCandidate | null {
    const acceleration = this.rollAcceleration(world, f, contact.tangentSpeed);
    const tipTime = this.timeToTip(world, f, contact.along, contact.tangentSpeed);
    const distance = (targetAlong - contact.along) * f.length;
    let eta =
      distance <= 0 ? 0 : this.timeForDistance(distance, contact.tangentSpeed, acceleration);
    let hitAlong = targetAlong;

    if (Number.isFinite(tipTime) && tipTime < eta) {
      eta = tipTime;
      hitAlong = 1.02;
    }
    if (!Number.isFinite(eta) || eta > horizon) return null;

    const travel = contact.tangentSpeed * eta + 0.5 * acceleration * eta * eta;
    if (hitAlong !== 1.02) {
      hitAlong = Math.max(contact.along, Math.min(1.02, contact.along + travel / f.length));
    }
    const c = dcos(f.theta);
    const s = dsin(f.theta);
    const alongDistance = (hitAlong - contact.along) * f.length;
    return {
      ball,
      eta,
      x: ball.px + c * alongDistance,
      y: ball.py + s * alongDistance,
      z: ball.pz,
      speed: Math.abs(contact.tangentSpeed + acceleration * eta),
      rolling: true,
    };
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
    horizon = CONTACT_HORIZON,
    incomingSafetyLead?: number,
  ): EncounterCandidate | null {
    if (!ball.active) return null;
    const supported = this.supportedRollContact(ball, f);
    if (
      incomingSafetyLead === undefined &&
      supported &&
      (this.profile.supportedRollPrediction || horizon > CONTACT_HORIZON)
    ) {
      // Keep a supported ball on the bat in the forecast rather than letting free-flight gravity
      // carry it through the flipper surface.
      return this.predictSupportedRoll(
        world,
        ball,
        f,
        targetAlong,
        supported,
        Math.max(horizon, CRADLE_ROLLOUT_HORIZON),
      );
    }
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
    const steps = Math.ceil(horizon / CONTACT_STEP);

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
      const facesStroke =
        this.probe.nx * (f.dir * -s) + this.probe.ny * (f.dir * c) > STRIKE_FACING_DOT;
      if (incomingSafetyLead !== undefined) {
        const cx = x - this.probe.nx * ball.radius;
        const cy = y - this.probe.ny * ball.radius;
        const surfaceVx = -f.omega * (cy - f.py);
        const surfaceVy = f.omega * (cx - f.px);
        const relativeNormalSpeed =
          (vx - surfaceVx) * this.probe.nx + (vy - surfaceVy) * this.probe.ny;
        const contactEta =
          gap <= SUPPORT_GAP
            ? 0
            : relativeNormalSpeed < -0.01
              ? gap / -relativeNormalSpeed
              : Infinity;
        if (
          facesStroke &&
          along >= ROLL_MIN_ALONG &&
          along <= ROLL_MAX_ALONG &&
          gap <= 0.025 &&
          relativeNormalSpeed < -0.05 &&
          contactEta <= incomingSafetyLead + 0.006
        ) {
          return {
            ball,
            eta: t,
            x,
            y,
            z,
            speed: Math.hypot(vx, vy, vz),
            rolling: false,
          };
        }
      }
      const impact = facesStroke && gap <= CONTACT_TOLERANCE && normalSpeed < -0.08;
      if (incomingSafetyLead !== undefined && impact) return null;
      const onBatRoll =
        facesStroke &&
        gap <= 0.006 &&
        Math.abs(normalSpeed) <= 0.18 &&
        rollingSpeed > 0.05 &&
        along >= ROLL_MIN_ALONG &&
        along <= ROLL_MAX_ALONG;
      // Aim at a useful point down the bat, rather than flicking as soon as the ball first enters
      // the paddle's neighborhood. A ball already beyond the target is still a valid rescue.
      const rolling = onBatRoll && along >= targetAlong;
      if (incomingSafetyLead !== undefined) {
        if (y < 0.035 && z < 0.05) return null;
        continue;
      }
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

function flipperLead(world: World, f: Flipper): number {
  const p = world.params.flipper;
  const inertia = (p.mass * f.length * f.length) / 3;
  const angularAcceleration = p.coilTorque / Math.max(inertia, 1e-9);
  const fullStrokeTime = Math.sqrt((2 * f.stroke) / Math.max(angularAcceleration, 1e-9));
  return Math.max(0.012, Math.min(0.06, fullStrokeTime + 0.006));
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
