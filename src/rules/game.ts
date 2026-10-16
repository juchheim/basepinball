import { Rng } from '../core/rng';
import type { PhysicsEvent } from '../physics/world';
import { advance, advanceAll, EMPTY, runnersOn, steal, walk, type Bases } from './bases';
import { choosePitch, type PitchSpec, type PitchType, type Side } from './pitching';
import {
  DEFAULT_TIMING,
  emptyStats,
  type BallState,
  type BattingSide,
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
const WALK_LETTERS = ['W', 'A', 'L', 'K'];
/** Lamp ids built once, for `lamps()`: [lamp, the switch that lights it] where there is one. */
const LAMP_KEYS = {
  lane: Object.fromEntries(LANES.map((l) => [l, `lamp.lane.${l}`])) as Record<Lane, string>,
  drops: ['B', 'A', 'T'].map((l) => [`lamp.drop.${l}`, `drop.${l}`] as const),
  walk: WALK_LETTERS.map((l) => [`lamp.standup.${l}`, `standup.${l}`] as const),
  rally: [1, 2, 3, 4, 5].map((i) => `rally.${i}`),
  hustle: [1, 2, 3, 4, 5].map((i) => `hustle.${i}`),
};
/** Seconds after the Stretch rises before its alert shows (clear of the hit's own callout). */
export const STRETCH_ALERT_DELAY = 1.6;

/** Bumper hits that fill the HUSTLE meter (five lamps of three hits each). */
export const HUSTLE_TARGET = 15;
/** At most one bumper hit counts per this many seconds, so a ball ricocheting through the Gap's
 * four pops earns by how long it keeps bouncing, not by how many contacts physics produces. */
export const HUSTLE_COOLDOWN = 0.4;

/**
 * The spin bonus: a hard plunge runs the whole arch and down the left orbit, setting its five
 * spinners going. (A gentle plunge that falls back into the right orbit spins the right ones, and
 * the soft plunge for the skill shot at most three of the left: neither counts.) Spinning this many
 * different left-orbit plates before the first swing of an inning starts the HUSTLE meter with a lamp.
 */
export const SPIN_BONUS_PLATES = 4;
/**
 * Bumper hits the bonus adds to the meter: one lamp's worth (the five lamps are three hits each),
 * so it always lights exactly one new lamp, a clear sign of what the plunge earned.
 */
export const SPIN_BONUS_HUSTLE = HUSTLE_TARGET / 5;
const LIVE: BallState[] = ['LEADOFF_LAUNCH', 'PITCH', 'IN_PLAY', 'LIVE_AFTER_HIT'];

/**
 * The Bleachers scoop (docs/MVP/01 § 4.8): a souvenir, a ball a fan caught (a parked ball), waits in
 * it on show. Touch it and the fan throws it back: THROW IT BACK, two balls in play.
 */
export const BLEACHERS = 'saucer.BLEACHERS';
/** Seconds the empty scoop holds a ball before kicking it back out. */
export const BLEACHERS_HOLD = 1.2;
/**
 * A called strikeout leaves the ball to drain past dead flippers; if it has not left play after
 * this many seconds (resting somewhere, or kicked back up), it is taken off the table.
 */
export const CALLED_BALL_TIMEOUT = 4;
/** Seconds from touching the souvenir to the fan throwing it back (the scoop kicks it into play). */
export const THROW_BACK_DELAY = 0.6;

export interface GameOptions {
  seed?: number;
  innings?: number;
  vsAi?: boolean;
  timing?: Partial<RulesTiming>;
}

interface Timer {
  at: number;
  run: () => void;
}

export class GameRules {
  readonly events: RulesEvent[] = [];
  readonly humanStats: GameStats = emptyStats();
  readonly aiStats: GameStats = emptyStats();
  readonly innings: number;
  readonly vsAi: boolean;

  state: BallState = 'DEAD';
  inning = 0;
  battingSide: BattingSide = 'human';
  /** The game ended on a walk-off: the home side (the human, in Vs AI) won it in the bottom half. */
  walkOff = false;
  outs = 0;
  bases: Bases = EMPTY;
  rally = 0;
  tiltWarnings = 0;
  tilted = false;
  skillLane: Lane | null = null;
  pitchType: PitchType | null = null;
  pitchSide: Side | null = null;
  pitchPhase: 'windup' | 'flight' | null = null;

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
  /** Ball searches since the last real switch hit; a search's own kick is not progress. */
  private searches = 0;
  private lastOutlane = -Infinity;
  private lastKickback = -Infinity;
  private readonly rbi = new Set<Lane>();
  private readonly bat = new Set<string>();
  private lastBumper = -Infinity;
  /** Distinct spinner plates spun since this inning's plunge, and whether it has paid out. */
  private readonly plungeSpins = new Set<string>();
  private spinBonusPaid = false;
  /** Whether the Stretch (the mound's ramp-and-bumper) was last commanded up. */
  private moundUp = false;
  /** Long-lived awards belong to the batting side in Vs AI, and to the sole side in solo play. */
  private readonly hotBatBySide: Record<BattingSide, boolean> = { human: false, ai: false };
  private readonly kickbackLitBySide: Record<BattingSide, boolean> = { human: true, ai: true };
  /** Bumper hits toward HUSTLE; at the target, every runner takes an extra base. */
  private readonly hustleBySide: Record<BattingSide, number> = { human: 0, ai: 0 };
  /** A souvenir (a parked ball) waits in the Bleachers. Touch it to start THROW IT BACK. */
  souvenirReady = false;
  /** Two-ball multiball is running, and the runs scored in it so far. */
  throwBack = false;
  private throwBackRuns = 0;
  /** The souvenir has been touched and is about to be thrown back (it counts as a ball in play). */
  private souvenirPending = false;
  /** W-A-L-K letters persist across innings independently for each batting side. */
  private readonly walkLetters: Record<BattingSide, Set<string>> = {
    human: new Set(),
    ai: new Set(),
  };
  private readonly buttons = { L: false, R: false };
  private readonly orbitUp = new Map<'L' | 'R', number>();
  private lastSwing = -Infinity;
  /**
   * The pitched ball has touched nothing but the bats yet (docs/MVP/01 § 4.1): a bat held out to it
   * is a bunt, a bat at rest a called strikeout. Once it is put in play (any other switch), that is
   * ordinary pinball again.
   */
  private freshPitch = false;
  /** A called strikeout: the flippers are dead until the taken pitch leaves play. */
  private calledOut = false;

  constructor(
    private readonly machine: Machine,
    opts: GameOptions = {},
  ) {
    this.rng = new Rng(opts.seed ?? 1);
    this.innings = opts.innings ?? 9;
    this.vsAi = opts.vsAi ?? false;
    this.timing = { ...DEFAULT_TIMING, ...opts.timing };
  }

  /**
   * The pitch is live: it has touched nothing but the bats yet, so a bat held out to it now would
   * bunt and a bat at rest would take it.
   */
  get pitchLive(): boolean {
    return this.freshPitch && (this.state === 'PITCH' || this.state === 'IN_PLAY');
  }

  /** Stats for the side currently batting; `humanStats` remains the player's lifetime/high-score row. */
  get stats(): GameStats {
    return this.battingSide === 'ai' ? this.aiStats : this.humanStats;
  }

  /**
   * Vs AI: past the regulation innings. Baseball has no ties, so a game level after the 9th goes
   * on an inning at a time until one side leads at the end of one (docs/MVP/01 § 5).
   */
  get extraInnings(): boolean {
    return this.vsAi && this.inning > this.innings;
  }

  /** The home side's half of the 9th or later, where the winning run ends the game on the spot. */
  private get lastLicks(): boolean {
    return this.vsAi && this.battingSide === 'human' && this.inning >= this.innings;
  }

  get hotBat(): boolean {
    return this.hotBatBySide[this.battingSide];
  }

  set hotBat(value: boolean) {
    this.hotBatBySide[this.battingSide] = value;
  }

  get kickbackLit(): boolean {
    return this.kickbackLitBySide[this.battingSide];
  }

  set kickbackLit(value: boolean) {
    this.kickbackLitBySide[this.battingSide] = value;
  }

  get hustle(): number {
    return this.hustleBySide[this.battingSide];
  }

  set hustle(value: number) {
    this.hustleBySide[this.battingSide] = value;
  }

  // ---------------------------------------------------------------- inputs

  start(now: number): void {
    this.now = now;
    this.startTime = now;
    this.lastActivity = now;
    this.machine.setKickback(true);
    this.moundUp = false;
    this.machine.setMoundBumper(false);
    this.emit({ type: 'gameStart' });
    this.startInning(1, this.vsAi ? 'ai' : 'human');
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
    this.syncMoundBumper();
    this.watchForStuckBall();
  }

  /**
   * The mound's ramp-and-bumper (the Stretch) is up exactly while a runner is on base. It rises with
   * an alert, held back a moment so it does not cover the callout of the hit that put the runner on.
   */
  private syncMoundBumper(): void {
    const up = runnersOn(this.bases) > 0;
    if (up === this.moundUp) return;
    this.moundUp = up;
    this.machine.setMoundBumper(up);
    if (up) {
      this.after(STRETCH_ALERT_DELAY, () => {
        if (this.moundUp) this.emit({ type: 'stretch' });
      });
    }
  }

  onSwitch(e: PhysicsEvent): void {
    this.now = Math.max(this.now, e.time);
    if (e.type !== 'eos') this.lastActivity = this.now;
    // A search's own kick can fire the device the ball is resting against (a sling): that is not
    // progress, or the search would reset the count that leads to a rescue and repeat forever.
    const ownKick = this.now - this.lastSearch < 2;
    const flipperOnly =
      e.type === 'eos' || e.type === 'swing' || e.type === 'bunt' || e.type === 'take';
    if (!flipperOnly && !ownKick) this.searches = 0;
    if (this.state === 'GAME_OVER' || this.state === 'INNING_BREAK') return;
    // Anything but the bats (or a nudge) puts the pitched ball in play.
    if (!flipperOnly && e.type !== 'tiltBob') this.freshPitch = false;

    if (this.tilted) {
      // Only the ball leaving the playfield matters once tilted.
      if (e.type === 'drain' || e.type === 'saucer') this.afterTiltBallGone();
      return;
    }
    if (this.calledOut) {
      // Likewise after a called strikeout.
      if (e.type === 'drain' || e.type === 'saucer') this.afterCalledBallGone();
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
      case 'bunt':
        if (this.pitchLive) this.bunt();
        return;
      case 'take':
        if (this.pitchLive) this.calledStrikeout();
        return;
      case 'pop': {
        // The Gap pops (1B / 2B) score the hit for a batter who has swung. Every other bumper hit
        // (the outfield pair, or the Gap after the hit) feeds HUSTLE once a hit has landed.
        const gap = e.id.startsWith('pop.1B') || e.id.startsWith('pop.2B');
        if (gap && this.state === 'IN_PLAY') this.hit(e.id.startsWith('pop.2B') ? '2B' : '1B');
        else this.bumperHit();
        return;
      }
      case 'kicker':
        // A triple is a made orbit shot: the ball must have come up that orbit's entry switch
        // just before reaching the corner kicker (a ball coming round the top does not count).
        if (this.now - (this.orbitUp.get(e.id.endsWith('.L') ? 'L' : 'R') ?? -Infinity) < 1.2)
          this.hit('3B');
        return;
      case 'spinner':
        this.plungeSpin(e.id);
        return;
      case 'saucer':
        this.saucer(e.id);
        return;
      case 'parkedHit':
        if (e.id === BLEACHERS) this.souvenirTouched();
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

  /**
   * A pitch that meets a bat held out is a bunt (docs/MVP/01 § 4.1): the batter held the bat out
   * over the plate instead of swinging. He is out at first, and every runner moves up a base: a sacrifice. With
   * two out it is the third out, a force, so the inning is over and nobody advances.
   */
  private bunt(): void {
    const sac = this.outs < 2 ? advanceAll(this.bases) : null;
    if (sac) this.bases = sac.bases;
    const runs = sac?.runs ?? 0;
    this.out('bunt', undefined, { moved: sac?.moved ?? [], runs });
    if (runs > 0) this.score(runs);
    // A walk-off squeeze: the winning run has ended the game.
    if (this.walkOff) return;
    this.afterOut(this.timing.routeFromDrain);
  }

  /**
   * The batter took the pitch: it reached a bat at rest before any swing struck it (docs/MVP/01
   * § 4.1). Strike three, called, on that touch. The flippers go dead so the ball drains past them
   * (rather than rolling across to the other bat for a free swing), and play goes on once it has.
   */
  private calledStrikeout(): void {
    this.out('K', undefined, { looking: true });
    this.calledOut = true;
    this.machine.setFlippersEnabled(false);
    if (!this.machine.ballInPlay()) {
      this.afterCalledBallGone();
      return;
    }
    this.after(CALLED_BALL_TIMEOUT, () => {
      if (!this.calledOut) return;
      this.machine.holdBall();
      this.afterCalledBallGone();
    });
  }

  private afterCalledBallGone(): void {
    this.calledOut = false;
    this.machine.setFlippersEnabled(true);
    this.afterOut(this.timing.routeFromDrain);
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
    // A fan in the Bleachers catches the home-run ball: a souvenir, on show, for this inning.
    if (hit === 'HR') this.handOutSouvenir();
    if (useHotBat) {
      this.hotBat = false;
      this.bat.clear();
      this.machine.resetDropTargets();
    }
    const credited = this.creditedRuns(runs, hit === 'HR');
    this.emit({ type: 'hit', hit, bases: reached, hotBat: useHotBat, runs: credited });
    if (credited > 0) this.score(credited);
    // A walk-off: the winning run has ended the game.
    if (this.walkOff) return;
    this.state = 'LIVE_AFTER_HIT';
    if (this.rallyPa) {
      this.rallyHits++;
      // Rally Cap: the 3rd consecutive rally hit lights HOT BAT (docs/MVP/01 § 4.5).
      if (this.rallyHits === 3 && !this.hotBat) this.lightHotBat('rallyCap');
    }
  }

  private saucer(id: string): void {
    if (id === BLEACHERS) {
      this.bleachersCatch();
      return;
    }
    if (!LIVE.includes(this.state)) return;
    const position = id.slice('saucer.'.length) as Position;
    if (this.extraBallLost()) {
      // The fielder keeps it: that ball is out of play, but it costs no out.
      this.machine.releaseSaucer(id);
      return;
    }
    // Like a drain, a catch is an out in every live state, swing or not: after a hit it charges
    // the next batter (docs/MVP/01 § 4.3).
    this.out('fielder', position);
    this.afterOut(this.timing.routeFromSaucer);
  }

  /**
   * THROW IT BACK (docs/MVP/01 § 4.8). A souvenir, a second ball, sits in the Bleachers scoop where
   * the player can see it. Touch it with the ball in play and the fan throws it back: the scoop kicks
   * it into play. (Any touch counts: in the narrow alley a ball that only rested against it would be
   * stuck.) A souvenir appears when the batter hits a home run, and lasts the rest of that inning.
   */
  private souvenirTouched(): void {
    if (!this.souvenirReady || this.throwBack || !LIVE.includes(this.state)) return;
    this.souvenirReady = false;
    this.throwBack = true;
    this.throwBackRuns = 0;
    this.stats.throwBacks++;
    this.souvenirPending = true;
    this.emit({ type: 'throwBack' });
    this.after(THROW_BACK_DELAY, () => {
      // If THROW IT BACK was cut short (a tilt, a rescue, the inning over), the fan keeps the ball.
      if (!this.souvenirPending) return;
      this.souvenirPending = false;
      this.machine.ejectSaucer(BLEACHERS);
    });
  }

  /** A ball in the empty scoop (no souvenir waiting) is held a moment and kicked back out. */
  private bleachersCatch(): void {
    this.after(BLEACHERS_HOLD, () => this.machine.ejectSaucer(BLEACHERS));
  }

  /**
   * A fan in the Bleachers catches a home-run ball: a souvenir (a parked ball), if there is not one
   * there already. It is there for the rest of the inning.
   */
  private handOutSouvenir(): void {
    if (this.souvenirReady) return;
    this.souvenirReady = true;
    this.machine.parkSouvenir();
    this.emit({ type: 'souvenirReady' });
  }

  /**
   * Down to one ball (or none): normal play resumes with whatever ball is left, the souvenir too if
   * it is on its way back. Cut short (a tilt, a rescue, the inning over), a souvenir that was never
   * thrown back stays in the Bleachers.
   */
  private endThrowBack(cutShort: boolean): void {
    if (!this.throwBack) return;
    this.throwBack = false;
    if (cutShort && this.souvenirPending) {
      // It was never thrown back: the fan still has it.
      this.souvenirPending = false;
      this.souvenirReady = true;
    }
    this.emit({ type: 'throwBackEnd', runs: this.throwBackRuns });
  }

  /**
   * A ball has left play (drained or caught) in THROW IT BACK. Its reward is the second ball, so
   * while another is still in play (a souvenir on its way back counts) losing one costs no
   * out: it just leaves play. Down to one ball, normal play resumes. True if the loss costs nothing.
   */
  private extraBallLost(): boolean {
    if (!this.throwBack) return false;
    const left = this.machine.ballsInPlay() + (this.souvenirPending ? 1 : 0);
    if (left <= 1) this.endThrowBack(false);
    return left >= 1;
  }

  private drain(): void {
    if (!LIVE.includes(this.state)) return;
    if (this.extraBallLost()) return;
    // Every drain is an out (docs/MVP/01 § 4.2): down an outlane is a foul out, else a strikeout.
    const foul =
      this.now - this.lastOutlane < this.timing.outlaneWindow &&
      this.lastOutlane > this.lastKickback;
    this.out(foul ? 'foul' : 'K');
    this.afterOut(this.timing.routeFromDrain);
  }

  private out(
    how: OutHow,
    position?: Position,
    detail?: { moved?: number[]; runs?: number; looking?: boolean },
  ): void {
    this.outs++;
    this.stats.plateAppearances++;
    if (how === 'K') this.stats.strikeouts++;
    else if (how === 'foul') this.stats.foulOuts++;
    else if (how === 'fielder') this.stats.fielderOuts++;
    else if (how === 'bunt') this.stats.buntOuts++;
    else this.stats.tiltOuts++;
    this.endRally();
    this.state = 'DEAD';
    this.freshPitch = false;
    this.emit({
      type: 'out',
      how,
      ...(position && { position }),
      outs: this.outs,
      ...detail,
    });
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
    if (this.throwBack) this.throwBackRuns += runs;
    this.stats.runs += runs;
    this.stats.runsByInning[this.inning - 1] =
      (this.stats.runsByInning[this.inning - 1] ?? 0) + runs;
    this.emit({ type: 'runs', runs });
    if (this.lastLicks && this.humanStats.runs > this.aiStats.runs) this.endOnWalkOff();
  }

  /**
   * Baseball's walk-off rule (OBR 7.01(g)): in the home half of the 9th or later, the game ends the
   * moment the winning run scores, so a hit counts only the runs needed to win. A home run is the
   * exception: the batter and every runner score. (A feature award scores one run at most.)
   */
  private creditedRuns(runs: number, homeRun: boolean): number {
    if (homeRun || !this.lastLicks) return runs;
    return Math.min(runs, Math.max(0, this.aiStats.runs - this.humanStats.runs + 1));
  }

  // ---------------------------------------------------------------- pitching

  private schedulePitch(delay: number): void {
    this.endThrowBack(true);
    this.state = 'DEAD';
    this.freshPitch = false;
    this.machine.holdBall();
    const spec = choosePitch(this.inning, this.rng);
    this.after(delay, () => {
      this.pitchType = spec.type;
      this.pitchSide = spec.side;
      if (this.vsAi && this.battingSide === 'ai') {
        // AI batting needs no pitch preview or windup pause; human turns keep the readable tell.
        this.releasePitch(spec);
        return;
      }
      this.pitchPhase = 'windup';
      this.emit({ type: 'pitchTell', pitch: spec.type, side: spec.side, lead: this.timing.tell });
      this.after(this.timing.tell, () => this.releasePitch(spec));
    });
  }

  private releasePitch(spec: PitchSpec): void {
    this.tiltWarnings = 0;
    this.machine.pitch(spec);
    this.state = 'PITCH';
    this.freshPitch = true;
    this.pitchPhase = 'flight';
    this.lastActivity = this.now;
    this.emit({ type: 'pitch', pitch: spec.type });
    if (spec.curve) {
      const c = spec.curve;
      this.after(c.delay, () => this.machine.setMagnet(c.power));
      this.after(c.delay + c.duration, () => this.machine.setMagnet(0));
    }
    this.after(1.5, () => {
      if (this.pitchType === spec.type && this.pitchPhase === 'flight') this.clearPitch();
    });
  }

  private clearPitch(): void {
    this.pitchType = null;
    this.pitchSide = null;
    this.pitchPhase = null;
  }

  // ---------------------------------------------------------------- innings

  private startInning(n: number, battingSide: BattingSide): void {
    this.inning = n;
    this.battingSide = battingSide;
    this.outs = 0;
    this.bases = EMPTY;
    this.stats.runsByInning[n - 1] = 0;
    this.tiltWarnings = 0;
    this.launched = false;
    this.plungeSpins.clear();
    this.spinBonusPaid = false;
    this.skillLane = LANES[Math.floor(this.rng.next() * 3)]!;
    this.machine.setKickback(this.kickbackLit);
    this.state = 'LEADOFF_LAUNCH';
    this.lastActivity = this.now;
    this.machine.serveToPlunger();
    this.emit({ type: 'inningStart', inning: n, battingSide });
  }

  /**
   * The half-inning is over (three outs, or a walk-off): count the runners left on base and clear
   * everything that belongs to this side's turn. Returns the runners left on base.
   */
  private retireSide(): number {
    // A souvenir not thrown back by the end of the inning: the fan keeps it.
    if (this.souvenirReady) {
      this.souvenirReady = false;
      this.machine.clearSouvenir();
    }
    const lob = runnersOn(this.bases);
    this.stats.leftOnBase += lob;
    this.bases = EMPTY;
    this.endThrowBack(true);
    this.endRally();
    this.clearPitch();
    this.freshPitch = false;
    this.skillLane = null;
    // Partial progress in R-B-I and B-A-T resets at the half-inning change. In Vs AI the physical
    // target bank belongs to the current turn, while stored awards remain with their batting side.
    this.rbi.clear();
    if (!this.hotBat || this.vsAi) {
      this.bat.clear();
      this.machine.resetDropTargets();
    }
    // No pitch, curve magnet, or delayed device action from this side may leak into the next one.
    this.timers.length = 0;
    this.machine.setMagnet(0);
    this.machine.setMoundBumper(false);
    this.moundUp = false;
    this.buttons.L = false;
    this.buttons.R = false;
    return lob;
  }

  private endInning(): void {
    const lob = this.retireSide();
    this.emit({
      type: 'inningEnd',
      inning: this.inning,
      runs: this.stats.runsByInning[this.inning - 1] ?? 0,
      lob,
      battingSide: this.battingSide,
    });
    this.machine.holdBall();

    // From the 9th on, the game can be decided at the end of either half (docs/MVP/01 § 5).
    if (this.inning >= this.innings) {
      if (!this.vsAi) return this.gameOver();
      const lead = this.humanStats.runs - this.aiStats.runs;
      // The home team (human) does not bat in the bottom half when it already leads after the
      // away team's top half. After the bottom half, whoever leads has won.
      if (this.battingSide === 'ai' ? lead > 0 : lead !== 0) return this.gameOver();
      if (this.battingSide === 'human') {
        // Level after a full inning: no ties in baseball, so extra innings.
        this.emit({ type: 'extraInnings', inning: this.inning + 1, runs: this.humanStats.runs });
      }
    }

    this.state = 'INNING_BREAK';
    this.after(this.timing.inningBreak, () => {
      if (this.vsAi && this.battingSide === 'ai') this.startInning(this.inning, 'human');
      else this.startInning(this.inning + 1, this.vsAi ? 'ai' : 'human');
    });
  }

  /**
   * The winning run has scored in the home half of the 9th or later: the game is over on the spot,
   * with the ball still on the table. The flippers go dead and it rolls down to the drain.
   */
  private endOnWalkOff(): void {
    this.retireSide();
    this.machine.setFlippersEnabled(false);
    this.gameOver(true);
  }

  private gameOver(walkOff = false): void {
    this.state = 'GAME_OVER';
    this.walkOff = walkOff;
    this.humanStats.duration = this.now - this.startTime;
    if (this.vsAi) this.aiStats.duration = this.now - this.startTime;
    this.emit(walkOff ? { type: 'gameOver', walkOff } : { type: 'gameOver' });
  }

  // ---------------------------------------------------------------- feature goals

  private lightHotBat(source: 'BAT' | 'skillShot' | 'rallyCap'): void {
    if (this.hotBat) return;
    this.hotBat = true;
    this.emit({ type: 'hotBat', source });
  }

  /**
   * The spin bonus. Only the leadoff plunge counts: spinners spun before the first swing of the
   * inning, by a ball that was plunged. Spinners are otherwise decoration.
   */
  private plungeSpin(id: string): void {
    if (this.state !== 'LEADOFF_LAUNCH' || !this.launched || this.spinBonusPaid) return;
    if (!id.startsWith('spinner.L')) return;
    this.plungeSpins.add(id);
    if (this.plungeSpins.size < SPIN_BONUS_PLATES) return;
    this.spinBonusPaid = true;
    const before = this.hustle;
    this.hustle = Math.min(HUSTLE_TARGET, this.hustle + SPIN_BONUS_HUSTLE);
    this.emit({ type: 'spinBonus', gained: this.hustle - before });
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

  /**
   * W-A-L-K (docs/MVP/01 § 4.8): the four standups. Spelling the word walks the batter: he takes
   * first, forced runners advance, and the bases loaded forces in a run. It is a feature award, not
   * a hit (no H, and the plate appearance carries on). Each side's letters persist through its
   * innings independently.
   */
  private standup(id: string): void {
    const letters = this.walkLetters[this.battingSide];
    letters.add(id);
    if (letters.size < WALK_LETTERS.length) return;
    letters.clear();
    if (!LIVE.includes(this.state)) return;
    const result = walk(this.bases);
    const { runs } = result;
    this.bases = result.bases;
    this.stats.walks++;
    this.emit({ type: 'walk', runs, moved: result.moved });
    if (runs > 0) this.score(runs);
  }

  /**
   * HUSTLE (docs/MVP/01 § 4.8): once a hit has landed and the ball is still live, every bumper hit
   * (the outfield pair, or the Gap pops, which no longer score anything then) fills the meter. Full, with a runner on, every runner takes an extra base (the
   * runner on third scores). Full with the bases empty it waits for the next bumper hit with a
   * runner on.
   */
  private bumperHit(): void {
    // Only the banging after a hit counts. Before the result a bumper just deflects the ball (the
    // bot sees about 46 such hits a game, which would fill the meter ~7 times); after the hit it
    // used to be decoration, and this is what makes it matter.
    if (this.state !== 'LIVE_AFTER_HIT') return;
    if (this.now - this.lastBumper < HUSTLE_COOLDOWN) return;
    this.lastBumper = this.now;
    this.hustle = Math.min(HUSTLE_TARGET, this.hustle + 1);
    if (this.hustle < HUSTLE_TARGET) return;
    const result = advanceAll(this.bases);
    if (!result) return;
    const { runs } = result;
    this.hustle = 0;
    this.bases = result.bases;
    this.stats.hustles++;
    this.emit({ type: 'hustle', runs, moved: result.moved });
    if (runs > 0) this.score(runs);
  }

  /** A runner can steal whenever one is on base (the right ramp is always armed for them). */
  get stealReady(): boolean {
    return steal(this.bases) !== null;
  }

  /**
   * The right ramp (docs/MVP/01 § 4.8). With a runner on, the shot steals: the lead runner who can
   * advance takes the next base, and stealing home scores. With the bases empty nothing happens.
   */
  private stealShot(): void {
    if (!LIVE.includes(this.state)) return;
    const result = steal(this.bases);
    if (!result) {
      this.emit({ type: 'stealRamp', result: 'noRunner' });
      return;
    }
    const { runs } = result;
    this.bases = result.bases;
    this.stats.steals++;
    this.emit({ type: 'steal', from: result.from, runs });
    if (runs > 0) this.score(runs);
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
    this.endThrowBack(true);
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
    // Rescue after a long still spell, or when searches keep failing (the search kick moves the
    // ball, so it can settle back into the same spot without the ball ever staying still for long).
    if (
      idle > this.timing.rescueAfter ||
      (idle > this.timing.ballSearchAfter && this.searches >= 3)
    ) {
      this.searches = 0;
      // Rescue (docs/MVP/01 § 4.3): a PA in progress is voided and re-pitched.
      this.emit({ type: 'ballRescued' });
      this.endRally();
      this.schedulePitch(this.timing.routeFromDrain);
      return;
    }
    if (idle > this.timing.ballSearchAfter && this.now - this.lastSearch > 3) {
      this.lastSearch = this.now;
      this.searches++;
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
      vsAi: this.vsAi,
      battingSide: this.battingSide,
      extraInnings: this.extraInnings,
      walkOff: this.walkOff,
      outs: this.outs,
      bases: this.bases,
      humanStats: this.humanStats,
      aiStats: this.aiStats,
      stats: this.stats,
      rally: this.rally,
      hotBat: this.hotBat,
      stealReady: this.stealReady,
      walkHit: WALK_LETTERS.map((l) => this.walkLetters[this.battingSide].has(`standup.${l}`)),
      hustle: this.hustle,
      hustleTarget: HUSTLE_TARGET,
      souvenirReady: this.souvenirReady,
      throwBack: this.throwBack,
      kickbackLit: this.kickbackLit,
      tiltWarnings: this.tiltWarnings,
      tilted: this.tilted,
      skillLane: this.skillLane,
      pitch: this.pitchType,
      pitchSide: this.pitchSide,
      pitchPhase: this.pitchPhase,
    };
  }

  /** Lamp states for the playfield inserts. */
  /**
   * The lamp states. Read every frame, so it fills one object kept for the purpose, with the keys
   * built once (docs/MVP/efficiency-audit F11): the result is only good until the next call.
   */
  lamps(): Record<string, LampMode> {
    const out = this.lampState;
    const on = (b: boolean): LampMode => (b ? 'on' : 'off');
    const pitchLamp = (t: PitchType): LampMode =>
      this.pitchType !== t ? 'off' : this.pitchPhase === 'windup' ? 'blink' : 'on';
    out['base.1B'] = on(this.bases[0]);
    out['base.2B'] = on(this.bases[1]);
    out['base.3B'] = on(this.bases[2]);
    out['lamp.hotbat'] = this.hotBat ? 'blink' : 'off';
    out['lamp.kickback'] = on(this.kickbackLit);
    out['arrow.ramp.STEAL'] = this.stealReady ? 'blink' : 'off';
    // The pitch lamp blinks through the windup and holds steady once the ball is thrown.
    out['pitch.FB'] = pitchLamp('FB');
    out['pitch.CH'] = pitchLamp('CH');
    out['pitch.CB'] = pitchLamp('CB');
    for (const lane of LANES) {
      out[LAMP_KEYS.lane[lane]] = this.skillLane === lane ? 'blink' : on(this.rbi.has(lane));
    }
    for (const [lamp, drop] of LAMP_KEYS.drops) out[lamp] = on(this.bat.has(drop) || this.hotBat);
    for (const [lamp, target] of LAMP_KEYS.walk)
      out[lamp] = on(this.walkLetters[this.battingSide].has(target));
    for (let i = 1; i <= 5; i++) out[LAMP_KEYS.rally[i - 1]!] = on(this.rally >= i);
    // The Bleachers (its lamp and the scoop's border): blinking while a souvenir waits there and
    // through THROW IT BACK.
    out['lamp.bleachers'] = this.throwBack || this.souvenirReady ? 'blink' : 'off';
    // HUSTLE: a lamp per two bumper hits; all five blink while it waits for a runner.
    const full = this.hustle >= HUSTLE_TARGET;
    for (let i = 1; i <= 5; i++) {
      out[LAMP_KEYS.hustle[i - 1]!] = full ? 'blink' : on(this.hustle >= i * (HUSTLE_TARGET / 5));
    }
    return out;
  }

  private readonly lampState: Record<string, LampMode> = {};

  private emit(e: RulesEvent): void {
    this.events.push(e);
  }

  private after(seconds: number, run: () => void): void {
    this.timers.push({ at: this.now + seconds, run });
  }
}
