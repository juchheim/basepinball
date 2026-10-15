import { Rng } from '../core/rng';
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
  /** Flip timing noise (s, standard deviation-ish). */
  jitter: number;
  /** Chance of reacting at all to a ball reaching a flipper. */
  attention: number;
  /** Consistent delay before reacting, in seconds. */
  reactionDelay?: number;
  /** Chance of catching a slow ball in a cradle and aiming from it. */
  cradle: number;
}

export const PROFILES: Record<string, BotProfile> = {
  rookie: { name: 'rookie', jitter: 0.03, attention: 0.85, cradle: 0 },
  average: { name: 'average', jitter: 0.016, attention: 0.95, cradle: 0.35 },
  // The bot cannot yet aim from a cradle (that needs a shot map per release timing), so its
  // "expert" is a sharper, more attentive reactor rather than a cradle-and-aim player.
  expert: { name: 'expert', jitter: 0.006, attention: 1, cradle: 0.2 },
};

/** Player-facing levels vary response speed, attention and cradling. */
export const PLAYER_PROFILES: Record<AiDifficulty, BotProfile> = {
  easy: { name: 'easy', jitter: 0.016, attention: 0.8, reactionDelay: 0.012, cradle: 0.1 },
  medium: { name: 'medium', jitter: 0.016, attention: 0.9, reactionDelay: 0.005, cradle: 0.25 },
  hard: { name: 'hard', jitter: 0.016, attention: 0.95, cradle: 0.35 },
};

interface FlipperPlan {
  /** Sim time to press, or -1. */
  pressAt: number;
  releaseAt: number;
  /** Balls already judged as misses; prevents rerolling attention on every physics step. */
  missedBalls: Set<Ball>;
  /** Cradling: holding the flipper up with the ball resting on it. */
  cradleUntil: number;
}

export class Bot {
  private readonly rng: Rng;
  private readonly plans: Record<'L' | 'R', FlipperPlan> = {
    L: { pressAt: -1, releaseAt: -1, missedBalls: new Set(), cradleUntil: -1 },
    R: { pressAt: -1, releaseAt: -1, missedBalls: new Set(), cradleUntil: -1 },
  };
  private plungeAt = -1;
  private plungeRelease = -1;
  private readonly probe = { d: 0, nx: 0, ny: 0 };
  /** Where along the bat (0-1) the bot means to hit a ball rolling down it. */
  private targetAlong = 0.65;

  constructor(
    private readonly profile: BotProfile,
    seed: number,
  ) {
    this.rng = new Rng(seed);
  }

  /** Called once per physics step. Returns flipper button changes for the rules. */
  update(world: World, rules: GameRules): void {
    const now = world.time;
    const b = world.balls.find((x) => x.active);

    // Plunger: on the leadoff, pull for a random time and release.
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

    for (const side of ['L', 'R'] as const) {
      const f = world.flippers.find((x) => x.id === `flipper.${side}`)!;
      const plan = this.plans[side];
      // Give a ball another chance only after it has left the paddle's approach area. A small
      // margin avoids rerolling if it skims along the edge of the area for several steps.
      for (const missedBall of plan.missedBalls) {
        if (!this.inApproachArea(missedBall, f, 0.025)) plan.missedBalls.delete(missedBall);
      }
      const press = (on: boolean): void => {
        if (f.pressed === on) return;
        world.setFlipper(f.id, on);
        rules.onButton(side, on);
      };

      if (plan.pressAt >= 0 && now >= plan.pressAt) {
        press(true);
        plan.pressAt = -1;
      }
      if (plan.releaseAt >= 0 && now >= plan.releaseAt) {
        press(false);
        plan.releaseAt = -1;
      }
      if (plan.cradleUntil >= 0) {
        if (now >= plan.cradleUntil) {
          // Release the cradle and re-flip after a short, noisy delay: a "drop catch" shot.
          press(false);
          plan.cradleUntil = -1;
          plan.pressAt = now + 0.07 + this.rng.range(-1, 1) * this.profile.jitter * 2;
          plan.releaseAt = plan.pressAt + 0.18;
        }
        continue;
      }
      if (plan.pressAt >= 0 || f.pressed) continue;
      // In multiball, react to whichever ball reaches this flipper first.
      for (const ball of world.balls) {
        if (ball.active && !plan.missedBalls.has(ball) && this.plan(ball, f, plan, now, press))
          break;
      }
    }
  }

  private inApproachArea(b: Ball, f: Flipper, margin = 0): boolean {
    if (!b.active || b.pz > 0.03 + margin) return false;
    const dx = (b.px - f.px) * f.dir; // + = toward this flipper's tip
    const dy = b.py - f.py;
    return (
      dx >= -0.02 - margin &&
      dx <= 0.1 + margin &&
      dy >= -0.06 - margin &&
      dy <= 0.09 + margin
    );
  }

  /** Plan a flip (or a cradle) for a ball arriving at flipper `f`. True if a plan was made. */
  private plan(
    b: Ball,
    f: Flipper,
    plan: FlipperPlan,
    now: number,
    press: (on: boolean) => void,
  ): boolean {
    // Is the ball arriving at this flipper? Work out where it will meet the bat and when.
    if (!this.inApproachArea(b, f)) return false;
    f.distance(b.px, b.py, this.probe);
    const gap = this.probe.d - b.radius;
    const approach = -(b.vx * this.probe.nx + b.vy * this.probe.ny); // speed toward the bat
    const cx = b.px - this.probe.nx * this.probe.d;
    const cy = b.py - this.probe.ny * this.probe.d;
    const along = ((cx - f.px) * Math.cos(f.theta) + (cy - f.py) * Math.sin(f.theta)) / f.length;
    const speed = b.speed();

    if (speed < 0.35 && gap < 0.004 && along < 0.45 && this.rng.next() < this.profile.cradle) {
      // Catch it: hold the flipper up and let the ball settle, then aim from the cradle.
      press(true);
      plan.cradleUntil = now + this.rng.range(0.4, 1.2);
      return true;
    }
    // Time until the ball reaches the bat (falling onto it), or until a ball rolling down the
    // bat reaches the bot's chosen hitting point.
    let eta: number;
    if (approach > 0.15) eta = gap / approach;
    else {
      const rollSpeed = b.vx * Math.cos(f.theta) + b.vy * Math.sin(f.theta);
      if (rollSpeed <= 0.05 || gap > 0.004) return false;
      eta = Math.max(0, (this.targetAlong - along) * f.length) / rollSpeed;
    }
    const flipLead = 0.012; // the bat takes ~12 ms to reach a ball resting on it
    if (eta > flipLead + 0.03) return false;
    if (this.rng.next() > this.profile.attention) {
      // A missed reaction is a true miss. Delaying it by a second caused unrelated-looking
      // paddle twitches and blocked the controller from considering another ball meanwhile.
      plan.missedBalls.add(b);
      return true;
    }
    plan.pressAt =
      now +
      Math.max(
        0,
        eta - flipLead +
          (this.profile.reactionDelay ?? 0) +
          this.rng.range(-1, 1) * this.profile.jitter,
      );
    plan.releaseAt = plan.pressAt + 0.17;
    this.targetAlong = this.rng.range(0.45, 0.85);
    return true;
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
