import type { Bases } from './bases';
import type { PitchSpec, PitchType, Side } from './pitching';

/** Ball states of the at-bat state machine (docs/MVP/01 § 4.2). */
export type BallState =
  'LEADOFF_LAUNCH' | 'PITCH' | 'IN_PLAY' | 'LIVE_AFTER_HIT' | 'DEAD' | 'INNING_BREAK' | 'GAME_OVER';

export type HitType = '1B' | '2B' | '3B' | 'HR';
export type OutHow = 'K' | 'foul' | 'fielder' | 'tilt';

/** Fielding positions and their scorebook numbers. */
export const POSITIONS = {
  P: 1,
  C: 2,
  '1B': 3,
  '2B': 4,
  '3B': 5,
  SS: 6,
  LF: 7,
  CF: 8,
  RF: 9,
} as const;
export type Position = keyof typeof POSITIONS;

/** What the game tells presentation (HUD, lamps, sound, animation). */
export type RulesEvent =
  | { type: 'gameStart' }
  | { type: 'inningStart'; inning: number }
  /** The windup: `lead` seconds before release, the pitch type and target flipper are shown. */
  | { type: 'pitchTell'; pitch: PitchType; side: Side; lead: number }
  | { type: 'pitch'; pitch: PitchType }
  | { type: 'hit'; hit: HitType; bases: number; hotBat: boolean; runs: number }
  | { type: 'out'; how: OutHow; position?: Position; outs: number }
  | { type: 'runs'; runs: number }
  | { type: 'steal'; from: number; runs: number }
  /** The HUSTLE meter filled: every runner took an extra base (`moved`: the bases they left). */
  | { type: 'hustle'; runs: number; moved: number[] }
  | { type: 'hotBat'; source: 'BAT' | 'skillShot' | 'rallyCap' }
  /** W-A-L-K is complete: the batter walks. `moved` lists the bases (0 = first) whose runners advanced. */
  | { type: 'walk'; runs: number; moved: number[] }
  /** A right-ramp shot with nobody on base to steal. */
  | { type: 'stealRamp'; result: 'noRunner' }
  /**
   * A hard plunge looped an orbit and spun its spinners: a head start on the HUSTLE meter.
   * `gained` is the bumper hits added (0 if the meter was already full).
   */
  | { type: 'spinBonus'; gained: number }
  /** A runner is on and the pitcher goes to the stretch: the mound's ramp-and-bumper has risen. */
  | { type: 'stretch' }
  /** A fan in the Bleachers caught the home-run ball: a souvenir (a parked ball), this inning. */
  | { type: 'souvenirReady' }
  /** The souvenir in the Bleachers was touched: THROW IT BACK, two-ball multiball, begins. */
  | { type: 'throwBack' }
  /** Down to one ball: THROW IT BACK is over. `runs` were scored while it lasted. */
  | { type: 'throwBackEnd'; runs: number }
  | { type: 'kickbackLit' }
  | { type: 'skillShot' }
  | { type: 'rally'; count: number }
  | { type: 'tiltWarning'; warnings: number }
  | { type: 'tilt' }
  | { type: 'ballSearch' }
  | { type: 'ballRescued' }
  | { type: 'inningEnd'; inning: number; runs: number; lob: number }
  | { type: 'gameOver' };

export interface GameStats {
  runsByInning: number[];
  runs: number;
  hits: number;
  singles: number;
  doubles: number;
  triples: number;
  homeRuns: number;
  strikeouts: number;
  foulOuts: number;
  fielderOuts: number;
  tiltOuts: number;
  plateAppearances: number;
  leftOnBase: number;
  longestRally: number;
  skillShots: number;
  steals: number;
  walks: number;
  hustles: number;
  throwBacks: number;
  /** Simulation seconds from first pitch to final out. */
  duration: number;
}

export function emptyStats(): GameStats {
  return {
    runsByInning: [],
    runs: 0,
    hits: 0,
    singles: 0,
    doubles: 0,
    triples: 0,
    homeRuns: 0,
    strikeouts: 0,
    foulOuts: 0,
    fielderOuts: 0,
    tiltOuts: 0,
    plateAppearances: 0,
    leftOnBase: 0,
    longestRally: 0,
    skillShots: 0,
    steals: 0,
    walks: 0,
    hustles: 0,
    throwBacks: 0,
    duration: 0,
  };
}

/** Everything the HUD needs, as plain data. */
export interface GameSnapshot {
  state: BallState;
  inning: number;
  innings: number;
  outs: number;
  bases: Bases;
  stats: GameStats;
  rally: number;
  hotBat: boolean;
  /** A runner is on, so the right ramp steals. */
  stealReady: boolean;
  /** W, A, L, K: which letters have been hit so far. */
  walkHit: boolean[];
  /** The HUSTLE meter: bumper hits so far, and how many fill it. */
  hustle: number;
  hustleTarget: number;
  /** A souvenir waits in the Bleachers: touch it to start THROW IT BACK. */
  souvenirReady: boolean;
  /** THROW IT BACK (two-ball multiball) is running. */
  throwBack: boolean;
  kickbackLit: boolean;
  tiltWarnings: number;
  tilted: boolean;
  skillLane: 'R' | 'B' | 'I' | null;
  /** Pitch being telegraphed or in flight, the flipper it is thrown at, and which. */
  pitch: PitchType | null;
  pitchSide: Side | null;
  pitchPhase: 'windup' | 'flight' | null;
}

/** Commands the rules issue to the machine (physics), like coil drivers on a real table. */
export interface Machine {
  /** Put the ball on the plunger (start of an inning). */
  serveToPlunger(): void;
  /** Ball comes up the mound VUK and is pitched (the ball may currently be held or in play). */
  pitch(spec: PitchSpec): void;
  /** Take every ball off the playfield (it is in the subway or trough). */
  holdBall(): void;
  /** Kick the ball a saucer (the Bleachers scoop) holds back into play. */
  ejectSaucer(id: string): void;
  /** Let a saucer go of the ball it caught, leaving that ball out of play (multiball). */
  releaseSaucer(id: string): void;
  /** Park a ball on show in the Bleachers scoop (the souvenir). */
  parkSouvenir(): void;
  /** Take the souvenir out of the Bleachers scoop (the fan keeps it). */
  clearSouvenir(): void;
  /** How many balls are on the playfield. */
  ballsInPlay(): number;
  setMagnet(power: number): void;
  setKickback(armed: boolean): void;
  /** Raise the bumper on the mound (a runner is on base) or lower it (the bases are empty). */
  setMoundBumper(raised: boolean): void;
  resetDropTargets(): void;
  setFlippersEnabled(enabled: boolean): void;
  /** Free a stuck ball (pulse coils / small kick). */
  ballSearch(): void;
  /** Is a ball on the playfield (not drained, captured, or held)? */
  ballInPlay(): boolean;
  /** Speed (m/s) of the fastest ball in play, for stuck-ball detection. */
  ballSpeed(): number;
}

/** Timing (seconds of simulation time). */
export interface RulesTiming {
  /** Ball travels the subway from a saucer / the trough to the mound. */
  routeFromSaucer: number;
  routeFromDrain: number;
  /** The windup: pitch type and target flipper are shown this long before release. */
  tell: number;
  inningBreak: number;
  /** No switch activity and a still ball for this long → ball search; then rescue. */
  ballSearchAfter: number;
  rescueAfter: number;
  /** A drain this soon after an outlane switch is a foul out. */
  outlaneWindow: number;
}

/** Includes presentation time: the fielder's catch-and-throw, the pitcher's windup, the side retired. */
export const DEFAULT_TIMING: RulesTiming = {
  routeFromSaucer: 2.0,
  routeFromDrain: 1.6,
  tell: 1.5,
  inningBreak: 5,
  ballSearchAfter: 6,
  rescueAfter: 15,
  outlaneWindow: 2,
};
