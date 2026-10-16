import { signal } from '@preact/signals';
import type { PitchType, Side } from '../rules/pitching';
import { ordinal, type AiDifficulty, type GameMode } from '../rules/match';
import type { GameSnapshot, GameStats, RulesEvent } from '../rules/types';
import type { HighScore } from '../storage/highscores';
import { EMPTY_LIFETIME, type Lifetime } from '../storage/lifetime';
import { DEFAULT_SETTINGS, type RemappableAction, type Settings } from '../storage/settings';

/** UI state shared between the game controller and the Preact overlay. */

export type Screen = 'title' | 'playing' | 'paused' | 'gameover' | 'scores';

export interface Callout {
  id: number;
  text: string;
  sub?: string;
  tone: 'hit' | 'out' | 'info' | 'big';
}

export const screen = signal<Screen>('title');
export const snapshot = signal<GameSnapshot | null>(null);

let snapshotKey = '';

/**
 * Hand the HUD a new game snapshot, only if something in it changed. `GameRules.snapshot()`
 * builds a fresh object every call, so publishing each one re-rendered the HUD ten times a second
 * for nothing (docs/MVP/efficiency-audit F10). The snapshot is small and has plain values, so
 * comparing its JSON is cheap and catches every field, including the stats mutated in place.
 */
export function publishSnapshot(g: GameSnapshot): void {
  const key = JSON.stringify(g);
  if (key === snapshotKey) return;
  snapshotKey = key;
  snapshot.value = g;
}
export const callout = signal<Callout | null>(null);
export const finalStats = signal<GameStats | null>(null);
export const activeGameMode = signal<GameMode>('single');
export const activeAiDifficulty = signal<AiDifficulty>('medium');
export const highScores = signal<HighScore[]>([]);
/** Rank of the score just entered (to highlight it), or -1. */
export const lastRank = signal(-1);
/** Whether the finished game makes the high-score table. */
export const qualified = signal(false);
export const settings = signal<Settings>(DEFAULT_SETTINGS);
export const settingsOpen = signal(false);
/** The action waiting for a key press in the settings (key remapping), or null. */
export const remapping = signal<RemappableAction | null>(null);
/** Resume countdown after a pause (3-2-1), or null. */
export const resumeCount = signal<number | null>(null);
export const lifetime = signal<Lifetime>(EMPTY_LIFETIME);
/** The how-to-play screen is open. */
export const howToOpen = signal(false);
/** A note from the settings (e.g. motion permission denied). */
export const settingsNote = signal('');

/**
 * The pre-pitch indicator: shown through the windup with a countdown to release, then "PITCH!"
 * briefly as the ball is thrown. `lead` is the windup length (s).
 */
export interface PitchCue {
  id: number;
  type: PitchType;
  side: Side;
  lead: number;
  phase: 'windup' | 'release';
}
export const pitchCue = signal<PitchCue | null>(null);

let cueId = 0;
let cueTimer: ReturnType<typeof setTimeout> | undefined;

export function pitchCueFor(e: RulesEvent): void {
  if (e.type === 'pitchTell') {
    clearTimeout(cueTimer);
    pitchCue.value = { id: ++cueId, type: e.pitch, side: e.side, lead: e.lead, phase: 'windup' };
  } else if (e.type === 'pitch' && pitchCue.value) {
    pitchCue.value = { ...pitchCue.value, phase: 'release' };
    clearTimeout(cueTimer);
    cueTimer = setTimeout(() => (pitchCue.value = null), 700);
  } else if (e.type === 'gameStart' || e.type === 'inningEnd' || e.type === 'tilt') {
    clearTimeout(cueTimer);
    pitchCue.value = null;
  }
}

let calloutId = 0;
let clearTimer: ReturnType<typeof setTimeout> | undefined;
/** Callouts waiting for the outcome callout on screen to finish. */
const waiting: { callout: Omit<Callout, 'id'>; ms: number }[] = [];

/** The outcome of a plate appearance: it always plays in full (docs/MVP/05 § 9.1). */
const isOutcome = (tone: Callout['tone']): boolean => tone === 'hit' || tone === 'out';

/**
 * Show a callout. An outcome replaces whatever is up; anything else (an award, an alert) waits
 * for an outcome on screen to finish, so the 3rd rally hit reads "DOUBLE!" before its Rally Cap
 * "HOT BAT LIT", rather than the award covering the hit in the same frame.
 */
export function showCallout(
  text: string,
  sub: string | undefined,
  tone: Callout['tone'],
  ms = 1400,
): void {
  const next = { text, ...(sub ? { sub } : {}), tone };
  if (!isOutcome(tone) && callout.value && isOutcome(callout.value.tone)) {
    waiting.push({ callout: next, ms });
    return;
  }
  display(next, ms);
}

function display(c: Omit<Callout, 'id'>, ms: number): void {
  callout.value = { id: ++calloutId, ...c };
  clearTimeout(clearTimer);
  clearTimer = setTimeout(() => {
    const queued = waiting.shift();
    if (queued) display(queued.callout, queued.ms);
    else callout.value = null;
  }, ms);
}

const HIT_NAMES = { '1B': 'SINGLE', '2B': 'DOUBLE', '3B': 'TRIPLE', HR: 'HOME RUN' } as const;
const BASE_NAMES = ['SINGLE', 'DOUBLE', 'TRIPLE', 'INSIDE-THE-PARK HOME RUN'];
const POS_NUM: Record<string, number> = { '1B': 3, '2B': 4, '3B': 5, SS: 6, LF: 7, CF: 8, RF: 9 };

/** Turn rules events into short, readable callouts (docs/MVP/05 § 8). */
export function calloutFor(e: RulesEvent): void {
  switch (e.type) {
    case 'inningStart':
      return showCallout(`INNING ${e.inning}`, 'Leadoff: plunge for the skill shot', 'big', 2000);
    case 'hit': {
      const name = e.hotBat ? BASE_NAMES[e.bases - 1]! : HIT_NAMES[e.hit];
      const runs =
        e.runs === 0 ? undefined : e.runs === 1 ? '1 run scores' : `${e.runs} runs score`;
      return showCallout(
        `${e.hotBat ? 'HOT BAT · ' : ''}${name}!`,
        runs,
        'hit',
        e.hit === 'HR' ? 2200 : 1400,
      );
    }
    case 'out': {
      const outs = `${e.outs} out${e.outs === 1 ? '' : 's'}`;
      if (e.how === 'fielder' && e.position)
        return showCallout(
          'OUT!',
          `Caught by ${e.position} (${POS_NUM[e.position]}) · ${outs}`,
          'out',
        );
      if (e.how === 'K') return showCallout('STRIKEOUT', outs, 'out');
      if (e.how === 'foul') return showCallout('FOUL OUT', outs, 'out');
      if (e.how === 'bunt') {
        // A cradled pitch: the batter is out, but with runners on (and fewer than 3 out) they move up.
        if (!e.moved?.length) return showCallout('BUNT OUT', `Cradled the pitch · ${outs}`, 'out');
        const runs = e.runs ? `${e.runs} run scores` : 'Runners advance';
        return showCallout('SACRIFICE BUNT', `${runs} · ${outs}`, 'out', 1800);
      }
      return showCallout('TILT', outs, 'out', 2000);
    }
    case 'steal':
      return showCallout(
        e.runs > 0 ? 'STEALS HOME!' : 'STOLEN BASE!',
        e.runs > 0 ? '1 run scores' : undefined,
        'hit',
      );
    case 'rally':
      return e.count >= 2 ? showCallout(`RALLY ×${e.count}`, undefined, 'info', 900) : undefined;
    case 'hotBat':
      return showCallout(
        'HOT BAT LIT',
        { BAT: 'B-A-T complete', skillShot: 'Skill shot!', rallyCap: 'Rally Cap!' }[e.source] +
          ' · next hit +1 base',
        'info',
      );
    case 'stealRamp':
      return showCallout('STEAL RAMP', 'Nobody on base to steal', 'info', 1100);
    case 'hustle':
      return showCallout(
        'HUSTLE!',
        e.runs > 0 ? 'Extra base: 1 run scores' : 'Every runner takes an extra base',
        'hit',
      );
    case 'walk':
      return showCallout(
        'WALK!',
        e.runs > 0 ? 'Bases loaded: 1 run scores' : 'Take your base',
        'hit',
      );
    case 'spinBonus':
      return showCallout(
        'SPIN BONUS!',
        e.gained > 0 ? 'A HUSTLE dot lights' : 'HUSTLE is already full',
        'info',
        1800,
      );
    case 'stretch':
      return showCallout(
        'FROM THE STRETCH',
        'Runner on: ramp and bumper up on the mound',
        'big',
        2000,
      );
    case 'souvenirReady':
      return showCallout(
        'SOUVENIR!',
        'A fan caught your home run. Go get it this inning',
        'info',
        2400,
      );
    case 'throwBack':
      return showCallout(
        'THROW IT BACK!',
        'The fan tosses it onto the field: two balls in play',
        'big',
        3200,
      );
    case 'throwBackEnd':
      return showCallout(
        'BACK TO ONE BALL',
        `${e.runs} run${e.runs === 1 ? '' : 's'} with two in play`,
        'big',
        2200,
      );
    case 'kickbackLit':
      return showCallout('KICKBACK LIT', undefined, 'info', 1000);
    case 'tiltWarning':
      return showCallout('WARNING', `${e.warnings} of 2`, 'out', 900);
    case 'inningEnd':
      return showCallout(
        'SIDE RETIRED',
        `${e.runs} run${e.runs === 1 ? '' : 's'} · ${e.lob} left on base`,
        'big',
        2600,
      );
    case 'extraInnings':
      return showCallout(
        'EXTRA INNINGS',
        `Tied ${e.runs}–${e.runs} · on to the ${ordinal(e.inning)}`,
        'big',
        2800,
      );
    case 'gameOver':
      return e.walkOff
        ? showCallout('WALK-OFF!', 'The winning run scores: ballgame', 'big', 3200)
        : showCallout('FINAL', undefined, 'big', 2000);
    default:
      return;
  }
}
