import { Rng } from '../core/rng';
import type { PhysicsEvent } from '../physics/world';
import { advance, EMPTY, runnersOn, steal, type Bases } from './bases';
import { choosePitch, type PitchSpec, type PitchType } from './pitching';
import {
  DEFAULT_TIMING,
  emptyStats,
  type BallState,
  type GameSnapshot,
  type GameStats,
  type HitType,
  type Machine,
  type OutHow,
  type Position,
  type RulesEvent,
  type RulesTiming,
} from './types';

/**
 * The baseball rules (docs/MVP/01 § 4): a pure state machine fed by physics switch events, flipper
 * buttons and simulation time. It drives the table through `Machine` (like coil drivers) and
 * reports what happened as `RulesEvent`s for presentation. No rendering, no DOM, deterministic.
 */

export type LampMode = 'off' | 'on' | 'blink';
type Lane = 'R' | 'B' | 'I';
const LANES: Lane[] = ['R', 'B', 'I'];
const LIVE: BallState[] = ['LEADOFF_LAUNCH', 'PITCH', 'IN_PLAY', 'LIVE_AFTER_HIT'];

export interface GameOptions {
  seed?: number;
  innings?: number;
  timing?: Partial<RulesTiming>;
}

interface Timer {
  at: number;
  run: () => void;
}

export class GameRules {
  readonly events: RulesEvent[] = [];
  readonly stats: GameStats = emptyStats();
  readonly innings: number;

  state: BallState = 'DEAD';
  inning = 0;
  outs = 0;
  bases: Bases = EMPTY;
  rally = 0;
  hotBat = false;
  stealLit = false;
  kickbackLit = true;
  tiltWarnings = 0;
  tilted = false;
  skillLane: Lane | null = null;
  pitchType: PitchType | null = null;

  private readonly rng: Rng;
  private readonly timing: RulesTiming;
  private readonly timers: Timer[] = [];
  private now = 0;
  private startTime = 0;
  /** True for a PA that began with a swing at a live ball after a hit. */
  private rallyPa = false;
  private rallyHits = 0;
  private launched = false;
  private lastActivity = 0;
  private lastSearch = -Infinity;
  private lastOutlane = -Infinity;
  private lastKickback = -Infinity;
  private readonly rbi = new Set<Lane>();
  private readonly bat = new Set<string>();
  private readonly run = new Set<string>();
  private readonly buttons = { L: false, R: false };
  private readonly orbitUp = new Map<'L' | 'R', number>();
  private lastSwing = -Infinity;

  constructor(
    private readonly machine: Machine,
    opts: GameOptions = {},
  ) {
    this.rng = new Rng(opts.seed ?? 1);
    this.innings = opts.innings ?? 9;
    this.timing = { ...DEFAULT_TIMING, ...opts.timing };
  }

  // ---------------------------------------------------------------- inputs

  start(now: number): void {
    this.now = now;
    this.startTime = now;
    this.lastActivity = now;
    this.machine.setKickback(true);
    this.emit({ type: 'gameStart' });
    this.startInning(1);
  }

  /** Flipper buttons: lane change during the skill shot; suppress ball search while held. */
  onButton(side: 'L' | 'R', pressed: boolean): void {
    this.buttons[side] = pressed;
    if (!pressed || this.state !== 'LEADOFF_LAUNCH' || !this.skillLane) return;
    const i = LANES.indexOf(this.skillLane);
    this.skillLane = LANES[(i + (side === 'L' ? 2 : 1)) % 3]!;
  }

  update(now: number): void {
    this.now = now;
    // Run timers in order; a timer may add more.
    for (;;) {
      let next = -1;
      for (let i = 0; i < this.timers.length; i++) {
        if (this.timers[i]!.at <= now && (next < 0 || this.timers[i]!.at < this.timers[next]!.at))
          next = i;
      }
      if (next < 0) break;
      this.timers.splice(next, 1)[0]!.run();
    }
    this.watchForStuckBall();
  }

  onSwitch(e: PhysicsEvent): void {
    this.now = Math.max(this.now, e.time);
    if (e.type !== 'eos') this.lastActivity = this.now;
    if (this.state === 'GAME_OVER' || this.state === 'INNING_BREAK') return;

    if (this.tilted) {
      // Only the ball leaving the playfield matters once tilted.
      if (e.type === 'drain' || e.type === 'saucer') this.afterTiltBallGone();
      return;
    }

    switch (e.type) {
      case 'plunger':
        this.launched = true;
        return;
      case 'swing':
        this.lastSwing = this.now;
        this.swing();
        return;
      case 'pop':
        this.hit(e.id.startsWith('pop.2B') ? '2B' : '1B');
        return;
      case 'kicker':
        // A triple is a made orbit shot: the ball must have come up that orbit's entry switch
        // just before reaching the corner kicker (a ball coming round the top does not count).
        if (this.now - (this.orbitUp.get(e.id.endsWith('.L') ? 'L' : 'R') ?? -Infinity) < 1.2)
          this.hit('3B');
        return;
      case 'saucer':
        this.saucer(e.id);
        return;
      case 'drain':
        this.drain();
        return;
      case 'kickback':
        this.kickbackLit = false;
        this.lastKickback = this.now;
        return;
      case 'tiltBob':
        this.tiltBob();
        return;
      case 'drop':
        this.dropTarget(e.id);
        return;
      case 'standup':
        this.standup(e.id);
        return;
      case 'sensor':
        if (e.id === 'gate.HR') this.hit('HR');
        else if (e.id === 'gate.STEAL') this.stealShot();
        else if (e.id.startsWith('outlane.')) this.lastOutlane = this.now;
        else if ((e.id === 'orbit.L' || e.id === 'orbit.R') && this.now - this.lastSwing < 1.0) {
          // Only a ball coming straight off the bat counts as hit down the line (not a
          // slingshot ricochet that happens to wander up an orbit).
          this.orbitUp.set(e.id.endsWith('.L') ? 'L' : 'R', this.now);
        } else if (e.id.startsWith('lane.')) this.laneRollover(e.id.slice(5) as Lane);
        return;
      default:
        return;
    }
  }

  // ---------------------------------------------------------------- the at-bat

  private swing(): void {
    switch (this.state) {
      case 'PITCH':
      case 'LEADOFF_LAUNCH':
        this.rallyPa = false;
        this.skillLane = null;
        this.state = 'IN_PLAY';
        return;
      case 'LIVE_AFTER_HIT':
        this.rallyPa = true;
        this.rally++;
        this.stats.longestRally = Math.max(this.stats.longestRally, this.rally);
        this.state = 'IN_PLAY';
        this.emit({ type: 'rally', count: this.rally });
        return;
      default:
        return;
    }
  }

  private hit(hit: HitType): void {
    // Hit devices only count for a batter who has swung (docs/MVP/01 § 4.3).
    if (this.state !== 'IN_PLAY') return;
    const value = { '1B': 1, '2B': 2, '3B': 3, HR: 4 }[hit];
    const useHotBat = this.hotBat && hit !== 'HR';
    const reached = useHotBat ? Math.min(4, value + 1) : value;
    const { bases, runs } = advance(this.bases, reached);
    this.bases = bases;
    this.stats.plateAppearances++;
    this.stats.hits++;
    if (hit === '1B') this.stats.singles++;
    else if (hit === '2B') this.stats.doubles++;
    else if (hit === '3B') this.stats.triples++;
    else this.stats.homeRuns++;
    if (useHotBat) {
      this.hotBat = false;
      this.bat.clear();
      this.machine.resetDropTargets();
    }
    this.emit({ type: 'hit', hit, bases: reached, hotBat: useHotBat, runs });
    if (runs > 0) this.score(runs);
    this.state = 'LIVE_AFTER_HIT';
    if (this.rallyPa) {
      this.rallyHits++;
      // Rally Cap: the 3rd consecutive rally hit lights HOT BAT (docs/MVP/01 § 4.5).
      if (this.rallyHits === 3 && !this.hotBat) this.lightHotBat('rallyCap');
    }
  }

  private saucer(id: string): void {
    const position = id.slice('saucer.'.length) as Position;
    switch (this.state) {
      case 'IN_PLAY':
        this.out('fielder', position);
        this.afterOut(this.timing.routeFromSaucer);
        return;
      case 'PITCH':
      case 'LIVE_AFTER_HIT':
      case 'LEADOFF_LAUNCH':
        // No out: the fielder throws it back to the pitcher, and the batter gets a pitch.
        this.endRally();
        this.schedulePitch(this.timing.routeFromSaucer);
        return;
      default:
        return;
    }
  }

  private drain(): void {
    if (!LIVE.includes(this.state)) return;
    // Every drain is an out (docs/MVP/01 § 4.2): down an outlane is a foul out, else a strikeout.
    const foul =
      this.now - this.lastOutlane < this.timing.outlaneWindow &&
      this.lastOutlane > this.lastKickback;
    this.out(foul ? 'foul' : 'K');
    this.afterOut(this.timing.routeFromDrain);
  }

  private out(how: OutHow, position?: Position): void {
    this.outs++;
    this.stats.plateAppearances++;
    if (how === 'K') this.stats.strikeouts++;
    else if (how === 'foul') this.stats.foulOuts++;
    else if (how === 'fielder') this.stats.fielderOuts++;
    else this.stats.tiltOuts++;
    this.endRally();
    this.state = 'DEAD';
    this.emit(
      position
        ? { type: 'out', how, position, outs: this.outs }
        : { type: 'out', how, outs: this.outs },
    );
  }

  /** The ball has left the playfield after an out: next pitch, or the side is retired. */
  private afterOut(routeDelay: number): void {
    if (this.outs >= 3) this.endInning();
    else this.schedulePitch(routeDelay);
  }

  private endRally(): void {
    this.rally = 0;
    this.rallyHits = 0;
    this.rallyPa = false;
  }

  private score(runs: number): void {
    this.stats.runs += runs;
    this.stats.runsByInning[this.inning - 1] =
      (this.stats.runsByInning[this.inning - 1] ?? 0) + runs;
    this.emit({ type: 'runs', runs });
  }

  // ---------------------------------------------------------------- pitching

  private schedulePitch(delay: number): void {
    this.state = 'DEAD';
    this.machine.holdBall();
    const spec = choosePitch(this.inning, this.rng);
    this.after(delay, () => {
      this.pitchType = spec.type;
      this.emit({ type: 'pitchTell', pitch: spec.type });
      this.after(this.timing.tell, () => this.releasePitch(spec));
    });
  }

  private releasePitch(spec: PitchSpec): void {
    this.tiltWarnings = 0;
    this.machine.pitch(spec);
    this.state = 'PITCH';
    this.lastActivity = this.now;
    this.emit({ type: 'pitch', pitch: spec.type });
    if (spec.curve) {
      const c = spec.curve;
      this.after(c.delay, () => this.machine.setMagnet(c.power));
      this.after(c.delay + c.duration, () => this.machine.setMagnet(0));
    }
    this.after(1.5, () => {
      if (this.pitchType === spec.type) this.pitchType = null;
    });
  }

  // ---------------------------------------------------------------- innings

  private startInning(n: number): void {
    this.inning = n;
    this.outs = 0;
    this.bases = EMPTY;
    this.stats.runsByInning[n - 1] = 0;
    this.tiltWarnings = 0;
    this.launched = false;
    this.skillLane = LANES[Math.floor(this.rng.next() * 3)]!;
    this.state = 'LEADOFF_LAUNCH';
    this.lastActivity = this.now;
    this.machine.serveToPlunger();
    this.emit({ type: 'inningStart', inning: n });
  }

  private endInning(): void {
    const lob = runnersOn(this.bases);
    this.stats.leftOnBase += lob;
    this.emit({
      type: 'inningEnd',
      inning: this.inning,
      runs: this.stats.runsByInning[this.inning - 1] ?? 0,
      lob,
    });
    this.bases = EMPTY;
    this.endRally();
    this.pitchType = null;
    this.skillLane = null;
    // Partial progress resets at the inning change; lit awards carry over (docs/MVP/01 § 4.8).
    this.rbi.clear();
    this.run.clear();
    if (!this.hotBat) {
      this.bat.clear();
      this.machine.resetDropTargets();
    }
    this.machine.holdBall();
    this.state = 'INNING_BREAK';
    this.after(this.timing.inningBreak, () => {
      if (this.inning >= this.innings) this.gameOver();
      else this.startInning(this.inning + 1);
    });
  }

  private gameOver(): void {
    this.state = 'GAME_OVER';
    this.stats.duration = this.now - this.startTime;
    this.emit({ type: 'gameOver' });
  }

  // ---------------------------------------------------------------- feature goals

  private lightHotBat(source: 'BAT' | 'skillShot' | 'rallyCap'): void {
    if (this.hotBat) return;
    this.hotBat = true;
    this.emit({ type: 'hotBat', source });
  }

  private laneRollover(lane: Lane): void {
    if (this.state === 'LEADOFF_LAUNCH' && this.skillLane) {
      if (lane === this.skillLane) {
        this.stats.skillShots++;
        this.emit({ type: 'skillShot' });
        this.lightHotBat('skillShot');
      }
      this.skillLane = null;
    }
    this.rbi.add(lane);
    if (this.rbi.size === 3) {
      this.rbi.clear();
      this.kickbackLit = true;
      this.machine.setKickback(true);
      this.emit({ type: 'kickbackLit' });
    }
  }

  private dropTarget(id: string): void {
    this.bat.add(id);
    if (this.bat.size === 3) this.lightHotBat('BAT');
  }

  private standup(id: string): void {
    this.run.add(id);
    if (this.run.size === 3) {
      this.run.clear();
      if (!this.stealLit) {
        this.stealLit = true;
        this.emit({ type: 'stealLit' });
      }
    }
  }

  private stealShot(): void {
    if (!this.stealLit || !LIVE.includes(this.state)) return;
    const result = steal(this.bases);
    if (!result) return;
    this.bases = result.bases;
    this.stealLit = false;
    this.stats.steals++;
    this.emit({ type: 'steal', from: result.from, runs: result.runs });
    if (result.runs > 0) this.score(result.runs);
  }

  // ---------------------------------------------------------------- tilt & stuck balls

  private tiltBob(): void {
    if (!LIVE.includes(this.state)) return;
    this.tiltWarnings++;
    if (this.tiltWarnings < 3) {
      this.emit({ type: 'tiltWarning', warnings: this.tiltWarnings });
      return;
    }
    // TILT: flippers die, the PA is an out, the ball drains normally (docs/MVP/01 § 4.9).
    this.tilted = true;
    this.machine.setFlippersEnabled(false);
    this.emit({ type: 'tilt' });
    this.out('tilt');
    if (!this.machine.ballInPlay()) this.afterTiltBallGone();
  }

  private afterTiltBallGone(): void {
    this.tilted = false;
    this.machine.setFlippersEnabled(true);
    this.afterOut(this.timing.routeFromDrain);
  }

  private watchForStuckBall(): void {
    const live =
      (this.state === 'PITCH' ||
        this.state === 'IN_PLAY' ||
        this.state === 'LIVE_AFTER_HIT' ||
        (this.state === 'LEADOFF_LAUNCH' && this.launched)) &&
      !this.tilted &&
      this.machine.ballInPlay();
    // A moving ball, or one held on a raised flipper (a cradle), is not stuck.
    if (!live || this.buttons.L || this.buttons.R || this.machine.ballSpeed() > 0.02) {
      this.lastActivity = this.now;
      return;
    }
    const idle = this.now - this.lastActivity;
    if (idle > this.timing.rescueAfter) {
      // Rescue (docs/MVP/01 § 4.3): a PA in progress is voided and re-pitched.
      this.emit({ type: 'ballRescued' });
      this.endRally();
      this.schedulePitch(this.timing.routeFromDrain);
      return;
    }
    if (idle > this.timing.ballSearchAfter && this.now - this.lastSearch > 3) {
      this.lastSearch = this.now;
      this.emit({ type: 'ballSearch' });
      this.machine.ballSearch();
    }
  }

  // ---------------------------------------------------------------- outputs

  snapshot(): GameSnapshot {
    return {
      state: this.state,
      inning: this.inning,
      innings: this.innings,
      outs: this.outs,
      bases: this.bases,
      stats: this.stats,
      rally: this.rally,
      hotBat: this.hotBat,
      stealLit: this.stealLit,
      kickbackLit: this.kickbackLit,
      tiltWarnings: this.tiltWarnings,
      tilted: this.tilted,
      skillLane: this.skillLane,
      pitch: this.pitchType,
    };
  }

  /** Lamp states for the playfield inserts. */
  lamps(): Record<string, LampMode> {
    const on = (b: boolean): LampMode => (b ? 'on' : 'off');
    const out: Record<string, LampMode> = {
      'base.1B': on(this.bases[0]),
      'base.2B': on(this.bases[1]),
      'base.3B': on(this.bases[2]),
      'lamp.hotbat': this.hotBat ? 'blink' : 'off',
      'lamp.steal': this.stealLit ? 'blink' : 'off',
      'lamp.kickback': on(this.kickbackLit),
      'arrow.ramp.STEAL': this.stealLit && runnersOn(this.bases) > 0 ? 'blink' : 'off',
      'pitch.FB': on(this.pitchType === 'FB'),
      'pitch.CH': on(this.pitchType === 'CH'),
      'pitch.CB': on(this.pitchType === 'CB'),
    };
    for (const lane of LANES) {
      out[`lamp.lane.${lane}`] = this.skillLane === lane ? 'blink' : on(this.rbi.has(lane));
    }
    for (const l of ['B', 'A', 'T'])
      out[`lamp.drop.${l}`] = on(this.bat.has(`drop.${l}`) || this.hotBat);
    for (const l of ['R', 'U', 'N']) out[`lamp.standup.${l}`] = on(this.run.has(`standup.${l}`));
    for (let i = 1; i <= 5; i++) out[`rally.${i}`] = on(this.rally >= i);
    return out;
  }

  private emit(e: RulesEvent): void {
    this.events.push(e);
  }

  private after(seconds: number, run: () => void): void {
    this.timers.push({ at: this.now + seconds, run });
  }
}
