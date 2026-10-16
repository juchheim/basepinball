import { describe, expect, it } from 'vitest';
import { defaultParams } from '../../src/physics/params';
import { World, type PhysicsEvent, type PhysicsEventType } from '../../src/physics/world';
import { advance, advanceAll, steal, walk } from '../../src/rules/bases';
import {
  BLEACHERS,
  BLEACHERS_HOLD,
  GameRules,
  type GameOptions,
  HUSTLE_COOLDOWN,
  HUSTLE_TARGET,
  THROW_BACK_DELAY,
  SPIN_BONUS_HUSTLE,
  STRETCH_ALERT_DELAY,
} from '../../src/rules/game';
import type { PitchSpec } from '../../src/rules/pitching';
import type { HitType, Machine, RulesEvent } from '../../src/rules/types';
import { WorldMachine } from '../../src/rules/worldMachine';
import { v1Table } from '../../src/table/v1Table';
import { classify, type Feed } from '../physics/shots';

// Rules unit tests: every cell of the event-resolution table (docs/MVP/01 § 4.3), base running,
// feature goals, innings and game over. A fake machine stands in for the physics.

class FakeMachine implements Machine {
  calls: string[] = [];
  /** Balls on the playfield. */
  balls = 0;
  get inPlay(): boolean {
    return this.balls > 0;
  }
  set inPlay(on: boolean) {
    this.balls = on ? Math.max(1, this.balls) : 0;
  }
  speed = 1;
  flippers = true;
  kickback = false;
  magnet = 0;
  serveToPlunger(): void {
    this.calls.push('serve');
    this.balls = 1;
  }
  pitch(spec: PitchSpec): void {
    this.calls.push(`pitch:${spec.type}`);
    this.balls = 1;
  }
  holdBall(): void {
    this.balls = 0;
  }
  ejectSaucer(id: string): void {
    this.calls.push(`eject:${id}`);
    this.balls++;
  }
  parkSouvenir(): void {
    this.calls.push('park');
  }
  clearSouvenir(): void {
    this.calls.push('clear');
  }
  releaseSaucer(id: string): void {
    this.calls.push(`release:${id}`);
  }
  ballsInPlay(): number {
    return this.balls;
  }
  setMagnet(p: number): void {
    this.magnet = p;
  }
  setKickback(armed: boolean): void {
    this.kickback = armed;
  }
  moundBumper = false;
  setMoundBumper(raised: boolean): void {
    this.moundBumper = raised;
  }
  resetDropTargets(): void {
    this.calls.push('resetDrops');
  }
  setFlippersEnabled(on: boolean): void {
    this.flippers = on;
  }
  ballSearch(): void {
    this.calls.push('search');
  }
  ballInPlay(): boolean {
    return this.inPlay;
  }
  ballSpeed(): number {
    return this.speed;
  }
  pitches(): number {
    return this.calls.filter((c) => c.startsWith('pitch')).length;
  }
}

class Harness {
  m = new FakeMachine();
  g: GameRules;
  t = 0;
  constructor(opts: GameOptions = {}) {
    this.g = new GameRules(this.m, { seed: 7, ...opts });
    this.g.start(0);
  }
  ev(type: PhysicsEventType, id = ''): this {
    this.t += 0.01;
    if (type === 'drain' || type === 'saucer') this.m.balls = Math.max(0, this.m.balls - 1);
    this.g.onSwitch({ type, id, time: this.t } as PhysicsEvent);
    this.g.update(this.t);
    return this;
  }
  wait(seconds: number): this {
    const end = this.t + seconds;
    while (this.t < end) {
      this.t = Math.min(end, this.t + 0.01);
      this.g.update(this.t);
    }
    return this;
  }
  /** Wait for the next pitch to be released. */
  toPitch(): this {
    return this.wait(4);
  }
  get state() {
    return this.g.state;
  }
  last<T extends RulesEvent['type']>(type: T): Extract<RulesEvent, { type: T }> | undefined {
    return [...this.g.events].reverse().find((e) => e.type === type) as
      Extract<RulesEvent, { type: T }> | undefined;
  }
  count(type: RulesEvent['type']): number {
    return this.g.events.filter((e) => e.type === type).length;
  }
}

/** Harness in each live state. */
const inLeadoff = () => new Harness();
const inInPlay = () => new Harness().ev('plunger').ev('swing', 'flipper.L');
const inLiveAfterHit = () => inInPlay().ev('pop', 'pop.1B.L');
const inPitch = () => {
  const h = inInPlay().ev('saucer', 'saucer.SS').toPitch();
  expect(h.state).toBe('PITCH');
  return h;
};

describe('base running', () => {
  it('advances every runner by the hit value', () => {
    expect(advance([false, false, false], 1)).toEqual({ bases: [true, false, false], runs: 0 });
    expect(advance([true, false, false], 1)).toEqual({ bases: [true, true, false], runs: 0 });
    expect(advance([true, false, true], 2)).toEqual({ bases: [false, true, true], runs: 1 });
    expect(advance([true, true, true], 4)).toEqual({ bases: [false, false, false], runs: 4 });
    expect(advance([false, true, false], 3)).toEqual({ bases: [false, false, true], runs: 1 });
  });

  it('a walk puts the batter on first and forces only the runners ahead of him', () => {
    expect(walk([false, false, false])).toEqual({
      bases: [true, false, false],
      runs: 0,
      moved: [],
    });
    // Nobody on first: a runner on second or third is not forced.
    expect(walk([false, true, true])).toMatchObject({
      bases: [true, true, true],
      runs: 0,
      moved: [],
    });
    expect(walk([true, false, false])).toMatchObject({ bases: [true, true, false], moved: [0] });
    expect(walk([true, false, true])).toMatchObject({
      bases: [true, true, true],
      runs: 0,
      moved: [0],
    });
    expect(walk([true, true, false])).toMatchObject({
      bases: [true, true, true],
      runs: 0,
      moved: [0, 1],
    });
    expect(walk([true, true, true])).toMatchObject({
      bases: [true, true, true],
      runs: 1,
      moved: [0, 1, 2],
    });
  });

  it('advanceAll moves every runner up one base; the runner on third scores', () => {
    expect(advanceAll([false, false, false])).toBeNull();
    expect(advanceAll([true, false, false])?.bases).toEqual([false, true, false]);
    expect(advanceAll([true, true, false])).toMatchObject({
      bases: [false, true, true],
      runs: 0,
      moved: [0, 1],
    });
    expect(advanceAll([true, true, true])).toMatchObject({
      bases: [false, true, true],
      runs: 1,
      moved: [0, 1, 2],
    });
  });

  it('steals with the lead runner who can advance', () => {
    expect(steal([false, false, false])).toBeNull();
    expect(steal([true, false, false])?.bases).toEqual([false, true, false]);
    expect(steal([true, true, false])?.bases).toEqual([true, false, true]);
    expect(steal([true, false, true])).toMatchObject({ bases: [true, false, false], runs: 1 });
  });
});

describe('spin bonus (a hard plunge)', () => {
  const plates = ['spinner.L.890', 'spinner.L.860', 'spinner.L.830', 'spinner.L', 'spinner.L.760'];
  const spin = (h: Harness, ids: string[]) => ids.forEach((id) => h.ev('spinner', id));

  it('spinning four plates after the plunge starts the HUSTLE meter, once', () => {
    const h = new Harness().ev('plunger');
    spin(h, plates);
    expect(h.count('spinBonus')).toBe(1);
    expect(h.last('spinBonus')).toMatchObject({ gained: SPIN_BONUS_HUSTLE });
    expect(h.g.snapshot().hustle).toBe(SPIN_BONUS_HUSTLE);
    spin(h, plates);
    expect(h.count('spinBonus')).toBe(1);
  });

  it('does not pay for fewer plates, or for one plate spinning again and again', () => {
    const h = new Harness().ev('plunger');
    spin(h, plates.slice(0, 3));
    for (let i = 0; i < 10; i++) h.ev('spinner', 'spinner.L.890');
    expect(h.count('spinBonus')).toBe(0);
    expect(h.g.snapshot().hustle).toBe(0);
  });

  it('only counts a plunged ball before the first swing', () => {
    const early = new Harness();
    spin(early, plates);
    expect(early.count('spinBonus')).toBe(0);
    const late = new Harness().ev('plunger').ev('swing', 'flipper.L');
    spin(late, plates);
    expect(late.count('spinBonus')).toBe(0);
  });

  it('pays once per inning, and again the next inning', () => {
    const h = new Harness().ev('plunger');
    spin(h, plates);
    h.ev('drain', 'drain').toPitch().ev('drain', 'drain').toPitch().ev('drain', 'drain');
    expect(h.state).toBe('INNING_BREAK');
    h.wait(6);
    h.ev('plunger');
    spin(h, plates);
    expect(h.count('spinBonus')).toBe(2);
    expect(h.g.snapshot().hustle).toBe(2 * SPIN_BONUS_HUSTLE);
  });

  it('pays nothing but still alerts when the meter is already full', () => {
    const h = new Harness().ev('plunger');
    h.g.hustle = HUSTLE_TARGET;
    spin(h, plates);
    expect(h.last('spinBonus')).toMatchObject({ gained: 0 });
    expect(h.g.snapshot().hustle).toBe(HUSTLE_TARGET);
  });
});

describe('the Stretch (mound bumper)', () => {
  it('is down at the start and up exactly while a runner is on base', () => {
    const h = inInPlay();
    expect(h.m.moundBumper).toBe(false);
    h.ev('pop', 'pop.1B.L');
    expect(h.g.bases[0]).toBe(true);
    expect(h.m.moundBumper).toBe(true);
  });

  it('alerts once, after the hit callout, when a runner puts it up', () => {
    const h = inInPlay().ev('pop', 'pop.1B.L');
    // Not at once: the hit's own callout is on screen.
    expect(h.count('stretch')).toBe(0);
    h.wait(STRETCH_ALERT_DELAY + 0.1);
    expect(h.count('stretch')).toBe(1);
    h.wait(5);
    expect(h.count('stretch')).toBe(1);
  });

  it('does not alert if the bases clear before the alert is due', () => {
    const h = inInPlay().ev('pop', 'pop.1B.L');
    h.g.bases = [false, false, false];
    h.wait(STRETCH_ALERT_DELAY + 0.5);
    expect(h.count('stretch')).toBe(0);
  });

  it('goes down again when the bases clear', () => {
    const h = inLiveAfterHit();
    expect(h.m.moundBumper).toBe(true);
    // Drain the ball: the runner is stranded or cleared by the inning change, never left up.
    h.g.bases = [false, false, false];
    h.wait(0.1);
    expect(h.m.moundBumper).toBe(false);
  });
});

describe('event resolution table', () => {
  it('swing', () => {
    expect(inPitch().ev('swing', 'flipper.R').state).toBe('IN_PLAY');
    expect(inLeadoff().ev('swing', 'flipper.L').state).toBe('IN_PLAY');
    expect(inInPlay().ev('swing', 'flipper.R').state).toBe('IN_PLAY');
    const live = inLiveAfterHit().ev('swing', 'flipper.R');
    expect(live.state).toBe('IN_PLAY');
    expect(live.last('rally')?.count).toBe(1);
  });

  it('fielder saucer is an out in every live state, swing or not', () => {
    const p = inPitch();
    const pitches = p.m.pitches();
    p.ev('saucer', 'saucer.LF').toPitch();
    expect(p.g.outs).toBe(2); // the earlier out and this one
    expect(p.m.pitches()).toBe(pitches + 1);

    const ip = inInPlay().ev('saucer', 'saucer.SS');
    expect(ip.g.outs).toBe(1);
    expect(ip.last('out')).toMatchObject({ how: 'fielder', position: 'SS' });

    for (const h of [inLiveAfterHit(), inLeadoff().ev('plunger')]) {
      const pas = h.g.stats.plateAppearances;
      h.ev('saucer', 'saucer.CF');
      expect(h.g.outs).toBe(1);
      expect(h.last('out')).toMatchObject({ how: 'fielder', position: 'CF' });
      expect(h.g.stats.fielderOuts).toBe(1);
      expect(h.g.stats.plateAppearances).toBe(pas + 1);
      expect(h.g.rally).toBe(0);
      h.toPitch();
      expect(h.state).toBe('PITCH');
    }

    // Not while the ball is dead (being routed back to the mound).
    const dead = inInPlay().ev('saucer', 'saucer.SS');
    dead.ev('saucer', 'saucer.SS');
    expect(dead.g.outs).toBe(1);
  });

  it('a corner kicker is a triple only after the ball came up that orbit', () => {
    expect(inInPlay().ev('kicker', 'kicker.3B.L').g.stats.triples).toBe(0);
    expect(inInPlay().ev('sensor', 'orbit.R').ev('kicker', 'kicker.3B.L').g.stats.triples).toBe(0);
    expect(inInPlay().ev('sensor', 'orbit.L').ev('kicker', 'kicker.3B.L').g.stats.triples).toBe(1);
  });

  it('hit device', () => {
    const p = inPitch().ev('pop', 'pop.1B.L');
    expect(p.g.stats.hits).toBe(0);
    const ip = inInPlay().ev('pop', 'pop.2B.R');
    expect(ip.last('hit')).toMatchObject({ hit: '2B', bases: 2 });
    expect(ip.state).toBe('LIVE_AFTER_HIT');
    const live = inLiveAfterHit()
      .ev('pop', 'pop.1B.R')
      .ev('sensor', 'orbit.L')
      .ev('kicker', 'kicker.3B.L');
    expect(live.g.stats.hits).toBe(1);
    const lead = inLeadoff().ev('plunger').ev('sensor', 'orbit.R').ev('kicker', 'kicker.3B.R');
    expect(lead.g.stats.hits).toBe(0);
  });

  it('feature shots count in every live state and never end the PA', () => {
    for (const h of [inPitch(), inInPlay(), inLiveAfterHit(), inLeadoff()]) {
      const before = h.state;
      h.ev('drop', 'drop.B').ev('standup', 'standup.W').ev('sensor', 'spinner.L');
      expect(h.state).toBe(before);
    }
  });

  it('center drain is always a strikeout', () => {
    for (const h of [inPitch(), inInPlay(), inLiveAfterHit(), inLeadoff().ev('plunger')]) {
      const outs = h.g.outs;
      h.ev('drain', 'drain');
      expect(h.g.outs).toBe(outs + 1);
      expect(h.last('out')?.how).toBe('K');
    }
  });

  it('outlane drain is always a foul out, unless the kickback saved it', () => {
    for (const h of [inPitch(), inInPlay(), inLiveAfterHit(), inLeadoff().ev('plunger')]) {
      const outs = h.g.outs;
      h.ev('sensor', 'outlane.L').ev('drain', 'drain');
      expect(h.g.outs).toBe(outs + 1);
      expect(h.last('out')?.how).toBe('foul');
    }
    const saved = inInPlay()
      .ev('sensor', 'outlane.L')
      .ev('kickback', 'kickback.L')
      .ev('drain', 'drain');
    expect(saved.last('out')?.how).toBe('K');
  });

  it('tilt is always an out; flippers die until the ball drains', () => {
    for (const h of [inPitch(), inInPlay(), inLiveAfterHit(), inLeadoff().ev('plunger')]) {
      const outs = h.g.outs;
      h.ev('tiltBob', 'tilt').ev('tiltBob', 'tilt');
      expect(h.g.outs).toBe(outs);
      h.ev('tiltBob', 'tilt');
      expect(h.g.outs).toBe(outs + 1);
      expect(h.m.flippers).toBe(false);
      const hits = h.g.stats.hits;
      h.ev('swing', 'flipper.L').ev('pop', 'pop.1B.L');
      expect(h.g.stats.hits).toBe(hits);
      h.ev('drain', 'drain');
      expect(h.m.flippers).toBe(true);
      expect(h.g.outs).toBe(outs + 1);
    }
  });

  it('a stuck ball is searched for, then rescued with a new pitch', () => {
    for (const h of [inPitch(), inInPlay(), inLiveAfterHit()]) {
      const outs = h.g.outs;
      const pitches = h.m.pitches();
      h.m.speed = 0;
      h.wait(7);
      expect(h.m.calls).toContain('search');
      h.wait(10);
      expect(h.count('ballRescued')).toBe(1);
      h.m.speed = 1;
      h.wait(4);
      expect(h.m.pitches()).toBe(pitches + 1);
      expect(h.g.outs).toBe(outs);
      expect(h.state).toBe('PITCH');
    }
  });

  it('a ball that each search kick only rocks in place is still rescued', () => {
    const h = inInPlay();
    h.m.speed = 0;
    for (let i = 0; i < 300 && h.count('ballRescued') === 0; i++) {
      const searches = h.m.calls.filter((c) => c === 'search').length;
      h.wait(0.1);
      if (h.m.calls.filter((c) => c === 'search').length > searches) {
        // The kick moves the ball for a moment, then it settles back into the same spot.
        h.m.speed = 0.3;
        h.wait(0.5);
        h.m.speed = 0;
      }
    }
    expect(h.count('ballRescued')).toBe(1);
  });

  it('a ball resting on a sling that every search kick fires is still rescued', () => {
    const h = inInPlay();
    h.m.speed = 0;
    for (let i = 0; i < 400 && h.count('ballRescued') === 0; i++) {
      const searches = h.m.calls.filter((c) => c === 'search').length;
      h.wait(0.1);
      if (h.m.calls.filter((c) => c === 'search').length > searches) {
        // The search kick fires the sling the ball is resting against, then it settles again.
        h.ev('sling', 'sling.L');
        h.m.speed = 0.3;
        h.wait(0.5);
        h.m.speed = 0;
      }
    }
    expect(h.count('ballRescued')).toBe(1);
  });

  it('a cradled ball (flipper held) is never treated as stuck', () => {
    const h = inInPlay();
    h.m.speed = 0;
    h.g.onButton('L', true);
    h.wait(20);
    expect(h.count('ballSearch')).toBe(0);
  });
});

describe('bunts (a pitch meets a bat held out)', () => {
  it('a bat held out to a pitch with nobody on is a bunt out, then the next pitch', () => {
    const h = inPitch().ev('swing', 'flipper.L').ev('bunt', 'flipper.L');
    expect(h.g.outs).toBe(2);
    expect(h.last('out')).toEqual({ type: 'out', how: 'bunt', outs: 2, moved: [], runs: 0 });
    expect(h.g.stats.buntOuts).toBe(1);
    expect(h.state).toBe('DEAD');
    h.toPitch();
    expect(h.state).toBe('PITCH');
  });

  it('is a sacrifice: every runner moves up a base', () => {
    const h = inPitch();
    h.g.bases = [true, false, false];
    h.ev('swing', 'flipper.R').ev('bunt', 'flipper.R');
    expect(h.g.bases).toEqual([false, true, false]);
    expect(h.last('out')).toMatchObject({ how: 'bunt', moved: [0], runs: 0 });
    expect(h.g.stats.runs).toBe(0);
  });

  it('with the runner on third, a sacrifice scores him', () => {
    const h = inPitch();
    h.g.bases = [true, true, true];
    h.ev('swing', 'flipper.L').ev('bunt', 'flipper.L');
    expect(h.g.bases).toEqual([false, true, true]);
    expect(h.last('out')).toMatchObject({ how: 'bunt', moved: [0, 1, 2], runs: 1 });
    expect(h.g.stats.runs).toBe(1);
    expect(h.last('runs')?.runs).toBe(1);
  });

  it('with two out it is the third out: nobody advances or scores', () => {
    const h = inPitch().ev('drain', 'drain').toPitch();
    h.g.bases = [true, false, true];
    h.ev('swing', 'flipper.L').ev('bunt', 'flipper.L');
    expect(h.last('out')).toMatchObject({ how: 'bunt', outs: 3, moved: [], runs: 0 });
    expect(h.g.stats.runs).toBe(0);
    expect(h.last('inningEnd')?.lob).toBe(2);
  });

  it('only while the pitched ball has touched nothing but the bats', () => {
    // A tap pass to the other flipper is still the fresh pitch.
    const pass = inPitch().ev('swing', 'flipper.L').ev('swing', 'flipper.R');
    pass.ev('bunt', 'flipper.R');
    expect(pass.last('out')?.how).toBe('bunt');
    // Off a sling it is in play: a bat held out (a cradle) is ordinary pinball again.
    const h = inPitch().ev('swing', 'flipper.L').ev('sling', 'sling.L').ev('bunt', 'flipper.R');
    expect(h.g.outs).toBe(1);
    expect(h.state).toBe('IN_PLAY');
  });

  it('never in a rally or off the leadoff plunge', () => {
    const rally = inLiveAfterHit().ev('swing', 'flipper.L').ev('bunt', 'flipper.L');
    expect(rally.g.outs).toBe(0);
    expect(rally.state).toBe('IN_PLAY');
    const leadoff = inLeadoff().ev('plunger').ev('swing', 'flipper.L').ev('bunt', 'flipper.L');
    expect(leadoff.g.outs).toBe(0);
    expect(leadoff.state).toBe('IN_PLAY');
  });

  it('the same pitch cannot be bunted twice', () => {
    const h = inPitch().ev('swing', 'flipper.L').ev('bunt', 'flipper.L').ev('bunt', 'flipper.L');
    expect(h.g.outs).toBe(2);
    expect(h.count('out')).toBe(2);
  });
});

describe('scoring and innings', () => {
  it('scores runs when runners cross the plate', () => {
    const h = inInPlay().ev('pop', 'pop.2B.L').ev('swing', 'flipper.L').ev('sensor', 'gate.HR');
    expect(h.g.stats.runs).toBe(2);
    expect(h.g.stats.runsByInning[0]).toBe(2);
  });

  it('retires the side after 3 outs, clears the bases, and serves the next leadoff', () => {
    const h = inInPlay()
      .ev('pop', 'pop.1B.L')
      .ev('swing', 'flipper.L')
      .ev('saucer', 'saucer.2B')
      .toPitch();
    h.ev('drain', 'drain').toPitch().ev('drain', 'drain');
    expect(h.state).toBe('INNING_BREAK');
    expect(h.last('inningEnd')).toMatchObject({ inning: 1, lob: 1 });
    expect(h.g.bases).toEqual([false, false, false]);
    h.wait(6);
    expect(h.g.inning).toBe(2);
    expect(h.state).toBe('LEADOFF_LAUNCH');
    expect(h.m.calls.filter((c) => c === 'serve')).toHaveLength(2);
  });

  it('ends the game after the 9th', () => {
    const h = new Harness();
    for (let inning = 1; inning <= 9; inning++) {
      h.ev('plunger')
        .ev('drain', 'drain')
        .toPitch()
        .ev('drain', 'drain')
        .toPitch()
        .ev('drain', 'drain')
        .wait(6);
    }
    expect(h.state).toBe('GAME_OVER');
    expect(h.count('gameOver')).toBe(1);
    expect(h.g.stats.strikeouts).toBe(27);
  });
});

describe('Vs AI: extra innings and walk-offs', () => {
  /** Three straight strikeouts from the leadoff launch. */
  const sideOut = (h: Harness): Harness =>
    h
      .ev('plunger')
      .ev('drain', 'drain')
      .toPitch()
      .ev('drain', 'drain')
      .toPitch()
      .ev('drain', 'drain');
  /** A solo home run off the leadoff launch. */
  const soloHomer = (h: Harness): Harness =>
    h.ev('plunger').ev('swing', 'flipper.L').ev('sensor', 'gate.HR');
  /** A solo home run, then three outs. */
  const homerThenSideOut = (h: Harness): Harness =>
    soloHomer(h).ev('drain', 'drain').toPitch().ev('drain', 'drain').toPitch().ev('drain', 'drain');
  /** Plays whole innings (both halves) with no runs. */
  const scoreless = (h: Harness, innings: number): Harness => {
    for (let i = 0; i < innings; i++) {
      sideOut(h).wait(6);
      sideOut(h);
      if (h.state === 'INNING_BREAK') h.wait(6);
    }
    return h;
  };
  /** Off the leadoff launch: three singles, each off a rally swing, load the bases. */
  const loadTheBases = (h: Harness): Harness =>
    h
      .ev('plunger')
      .ev('swing', 'flipper.L')
      .ev('pop', 'pop.1B.L')
      .ev('swing', 'flipper.L')
      .ev('pop', 'pop.1B.L')
      .ev('swing', 'flipper.L')
      .ev('pop', 'pop.1B.L')
      .ev('swing', 'flipper.L');

  it('goes to extra innings when level after nine, AI batting first', () => {
    const h = scoreless(new Harness({ vsAi: true }), 8);
    sideOut(h).wait(6);
    expect(h.g.inning).toBe(9);
    expect(h.g.battingSide).toBe('human');
    sideOut(h);
    expect(h.state).toBe('INNING_BREAK');
    expect(h.last('extraInnings')).toEqual({ type: 'extraInnings', inning: 10, runs: 0 });
    expect(h.g.extraInnings).toBe(false);
    h.wait(6);
    expect(h.g.inning).toBe(10);
    expect(h.g.battingSide).toBe('ai');
    expect(h.state).toBe('LEADOFF_LAUNCH');
    expect(h.g.extraInnings).toBe(true);
    expect(h.g.snapshot().extraInnings).toBe(true);
    expect(h.count('gameOver')).toBe(0);
  });

  it('keeps playing extra innings until one side leads at the end of one', () => {
    const h = scoreless(new Harness({ vsAi: true }), 11);
    expect(h.count('extraInnings')).toBe(3);
    expect(h.last('extraInnings')?.inning).toBe(12);
    expect(h.g.inning).toBe(12);
    expect(h.g.aiStats.runsByInning).toHaveLength(12);
    expect(h.g.humanStats.runsByInning).toHaveLength(11);
  });

  it('the AI wins when it still leads after the bottom of an extra inning', () => {
    const h = scoreless(new Harness({ vsAi: true }), 9);
    homerThenSideOut(h);
    expect(h.state).toBe('INNING_BREAK');
    h.wait(6);
    expect(h.g.battingSide).toBe('human');
    sideOut(h);
    expect(h.state).toBe('GAME_OVER');
    expect(h.g.walkOff).toBe(false);
    expect(h.last('gameOver')).toEqual({ type: 'gameOver' });
    expect(h.g.aiStats.runs).toBe(1);
    expect(h.g.aiStats.runsByInning[9]).toBe(1);
    expect(h.g.humanStats.runsByInning[9]).toBe(0);
  });

  it('the home half of an extra inning is always played, even after the AI scores', () => {
    const h = scoreless(new Harness({ vsAi: true }), 9);
    homerThenSideOut(h).wait(6);
    expect(h.g.inning).toBe(10);
    expect(h.state).toBe('LEADOFF_LAUNCH');
  });

  it('ends on a walk-off the moment the winning run scores in an extra inning', () => {
    const h = scoreless(new Harness({ vsAi: true }), 9);
    sideOut(h).wait(6);
    soloHomer(h);
    expect(h.state).toBe('GAME_OVER');
    expect(h.g.walkOff).toBe(true);
    expect(h.last('gameOver')).toEqual({ type: 'gameOver', walkOff: true });
    expect(h.g.humanStats.runsByInning[9]).toBe(1);
    expect(h.g.outs).toBe(0);
    // The ball stays on the table with the flippers dead, and nothing more counts.
    expect(h.m.flippers).toBe(false);
    h.ev('sensor', 'gate.HR').ev('drain', 'drain').wait(10);
    expect(h.g.humanStats.runs).toBe(1);
    expect(h.count('gameOver')).toBe(1);
    expect(h.g.snapshot()).toMatchObject({ walkOff: true, extraInnings: true });
  });

  it('a walk-off in the bottom of the 9th ends the game before three outs', () => {
    const h = scoreless(new Harness({ vsAi: true }), 8);
    sideOut(h).wait(6);
    soloHomer(h);
    expect(h.state).toBe('GAME_OVER');
    expect(h.g.walkOff).toBe(true);
    expect(h.g.extraInnings).toBe(false);
  });

  it('a squeeze bunt in the bottom of the 9th is a walk-off', () => {
    const h = scoreless(new Harness({ vsAi: true }), 8);
    sideOut(h).wait(6);
    loadTheBases(h).ev('drain', 'drain').toPitch();
    expect(h.g.bases).toEqual([true, true, true]);
    h.ev('swing', 'flipper.L').ev('bunt', 'flipper.L');
    expect(h.state).toBe('GAME_OVER');
    expect(h.g.walkOff).toBe(true);
    expect(h.g.humanStats.runs).toBe(1);
  });

  it('a walk-off hit counts only the run that wins it', () => {
    const h = scoreless(new Harness({ vsAi: true }), 9);
    sideOut(h).wait(6);
    loadTheBases(h);
    expect(h.g.bases).toEqual([true, true, true]);
    // A bases-loaded double would score two; tied, only the winning run counts.
    h.ev('pop', 'pop.2B.L');
    expect(h.state).toBe('GAME_OVER');
    expect(h.last('hit')).toMatchObject({ hit: '2B', runs: 1 });
    expect(h.last('runs')).toEqual({ type: 'runs', runs: 1 });
    expect(h.g.humanStats.runs).toBe(1);
    expect(h.g.humanStats.runsByInning[9]).toBe(1);
    expect(h.g.humanStats.leftOnBase).toBe(2);
  });

  it('a walk-off home run counts every run', () => {
    const h = scoreless(new Harness({ vsAi: true }), 9);
    sideOut(h).wait(6);
    loadTheBases(h).ev('sensor', 'gate.HR');
    expect(h.state).toBe('GAME_OVER');
    expect(h.last('hit')).toMatchObject({ hit: 'HR', runs: 4 });
    expect(h.g.humanStats.runs).toBe(4);
    expect(h.g.walkOff).toBe(true);
  });

  it('a hit before the 9th counts every run', () => {
    const h = new Harness({ vsAi: true });
    sideOut(h).wait(6);
    loadTheBases(h).ev('pop', 'pop.2B.L');
    expect(h.last('hit')).toMatchObject({ hit: '2B', runs: 2 });
    expect(h.g.humanStats.runs).toBe(2);
  });

  it('single player never goes to extra innings', () => {
    const h = new Harness();
    for (let inning = 1; inning <= 9; inning++) {
      sideOut(h);
      if (inning < 9) h.wait(6);
    }
    expect(h.state).toBe('GAME_OVER');
    expect(h.count('extraInnings')).toBe(0);
    expect(h.g.extraInnings).toBe(false);
  });
});

describe('feature goals', () => {
  it('B-A-T lights HOT BAT: +1 base on the next non-HR hit, then the drops reset', () => {
    const h = inInPlay().ev('drop', 'drop.B').ev('drop', 'drop.A').ev('drop', 'drop.T');
    expect(h.g.hotBat).toBe(true);
    h.ev('sensor', 'gate.HR');
    expect(h.g.hotBat).toBe(true); // a home run does not use it
    h.ev('swing', 'flipper.L').ev('pop', 'pop.1B.L');
    expect(h.last('hit')).toMatchObject({ hit: '1B', bases: 2, hotBat: true });
    expect(h.g.hotBat).toBe(false);
    expect(h.m.calls).toContain('resetDrops');
  });

  it('HOT BAT turns a triple into an inside-the-park home run', () => {
    const h = inInPlay()
      .ev('drop', 'drop.B')
      .ev('drop', 'drop.A')
      .ev('drop', 'drop.T')
      .ev('sensor', 'orbit.L')
      .ev('kicker', 'kicker.3B.L');
    expect(h.last('hit')).toMatchObject({ hit: '3B', bases: 4 });
    expect(h.g.stats.runs).toBe(1);
  });

  it('HOT BAT carries across innings', () => {
    const h = inInPlay().ev('drop', 'drop.B').ev('drop', 'drop.A').ev('drop', 'drop.T');
    h.ev('drain', 'drain').toPitch().ev('drain', 'drain').toPitch().ev('drain', 'drain').wait(6);
    expect(h.g.inning).toBe(2);
    expect(h.g.hotBat).toBe(true);
  });

  it('the right ramp steals directly: no R-U-N needed', () => {
    const h = inInPlay().ev('pop', 'pop.1B.L');
    expect(h.g.bases).toEqual([true, false, false]);
    expect(h.g.stealReady).toBe(true);
    h.ev('sensor', 'gate.STEAL');
    expect(h.g.bases).toEqual([false, true, false]);
    expect(h.g.stats.steals).toBe(1);
    expect(h.g.outs).toBe(0);
  });

  it('a right-ramp shot with nobody on base does nothing (and says so)', () => {
    const h = inInPlay().ev('sensor', 'gate.STEAL');
    expect(h.g.stats.steals).toBe(0);
    expect(h.g.stealReady).toBe(false);
    expect(h.g.events.some((e) => e.type === 'stealRamp' && e.result === 'noRunner')).toBe(true);
  });

  it('the ramp arrow blinks only while a runner can steal', () => {
    const h = inInPlay();
    expect(h.g.lamps()['arrow.ramp.STEAL']).toBe('off');
    h.ev('pop', 'pop.1B.L');
    expect(h.g.lamps()['arrow.ramp.STEAL']).toBe('blink');
    expect(h.g.snapshot().stealReady).toBe(true);
  });

  it('stealing home scores a run', () => {
    const h = inInPlay().ev('sensor', 'orbit.L').ev('kicker', 'kicker.3B.L');
    expect(h.g.bases).toEqual([false, false, true]);
    h.ev('sensor', 'gate.STEAL');
    expect(h.g.stats.runs).toBe(1);
    expect(h.g.bases).toEqual([false, false, false]);
  });

  it('an ordinary steal moves only the lead runner', () => {
    const h = inInPlay().ev('pop', 'pop.1B.L').ev('swing', 'flipper.L').ev('pop', 'pop.1B.L');
    expect(h.g.bases).toEqual([true, true, false]);
    h.ev('sensor', 'gate.STEAL');
    expect(h.g.bases).toEqual([true, false, true]);
  });

  const spell = (h: ReturnType<typeof inInPlay>, letters = ['W', 'A', 'L', 'K']) => {
    for (const l of letters) h.ev('standup', `standup.${l}`);
    return h;
  };

  it('spelling W-A-L-K walks the batter: first base, not a hit', () => {
    const h = spell(inInPlay());
    expect(h.g.bases).toEqual([true, false, false]);
    expect(h.g.stats.walks).toBe(1);
    expect(h.g.stats.hits).toBe(0);
    expect(h.g.outs).toBe(0);
    expect(h.last('walk')).toMatchObject({ runs: 0, moved: [] });
  });

  it('a walk forces runners and, with the bases loaded, forces in a run', () => {
    const h = inInPlay().ev('pop', 'pop.1B.L');
    expect(h.g.bases).toEqual([true, false, false]);
    spell(h);
    expect(h.g.bases).toEqual([true, true, false]);
    // Load them up, then walk in a run.
    h.ev('swing', 'flipper.L').ev('pop', 'pop.1B.L');
    expect(h.g.bases).toEqual([true, true, true]);
    spell(h);
    expect(h.g.stats.runs).toBe(1);
    expect(h.g.bases).toEqual([true, true, true]);
    expect(h.g.stats.walks).toBe(2);
  });

  it('a walk is a feature award: it does not end or restart the plate appearance', () => {
    for (const h of [inPitch(), inInPlay(), inLiveAfterHit()]) {
      const before = h.state;
      spell(h);
      expect(h.state).toBe(before);
    }
  });

  it('three letters are not enough, and the lamps show the letters hit', () => {
    const h = spell(inInPlay(), ['W', 'A', 'L']);
    expect(h.g.stats.walks).toBe(0);
    expect(h.g.lamps()['lamp.standup.W']).toBe('on');
    expect(h.g.lamps()['lamp.standup.K']).toBe('off');
    expect(h.g.snapshot().walkHit).toEqual([true, true, true, false]);
    h.ev('standup', 'standup.K');
    expect(h.g.snapshot().walkHit).toEqual([false, false, false, false]);
    expect(h.g.stats.walks).toBe(1);
    // The word resets once walked.
    expect(h.g.lamps()['lamp.standup.W']).toBe('off');
  });

  it('repeats of the same letter do not count twice', () => {
    const h = spell(inInPlay(), ['W', 'W', 'A', 'A', 'L', 'L']);
    expect(h.g.stats.walks).toBe(0);
  });

  it('letters persist through innings until the word is spelled', () => {
    const h = spell(inInPlay(), ['W', 'A', 'L']);
    h.ev('drain', 'drain').toPitch().ev('drain', 'drain').toPitch().ev('drain', 'drain').wait(6);
    expect(h.g.inning).toBe(2);
    for (const l of ['W', 'A', 'L']) expect(h.g.lamps()[`lamp.standup.${l}`]).toBe('on');
    expect(h.g.lamps()['lamp.standup.K']).toBe('off');
    // Finish the word in the next inning: the walk comes.
    h.wait(6).ev('plunger');
    h.ev('standup', 'standup.K');
    expect(h.g.stats.walks).toBe(1);
  });

  const bump = (h: ReturnType<typeof inInPlay>, n: number, id = 'pop.OF.L') => {
    // Spaced past the cooldown, so every hit counts.
    for (let i = 0; i < n; i++) h.ev('pop', id).wait(HUSTLE_COOLDOWN + 0.1);
    return h;
  };

  it('an outfield bumper never scores a hit, and before a hit it feeds nothing', () => {
    const h = bump(inInPlay(), 5);
    expect(h.g.stats.hits).toBe(0);
    expect(h.g.state).toBe('IN_PLAY');
    expect(h.g.hustle).toBe(0);
  });

  it('after a hit, outfield bumpers and the Gap pops all feed HUSTLE (the Gap scores no second hit)', () => {
    const h = inLiveAfterHit();
    expect(h.g.hustle).toBe(0); // the hit itself is not hustle
    h.wait(1).ev('pop', 'pop.2B.R').wait(1).ev('pop', 'pop.1B.R').wait(1).ev('pop', 'pop.OF.L');
    expect(h.g.stats.hits).toBe(1);
    expect(h.g.hustle).toBe(3);
  });

  it('a ball ricocheting through the nest counts once per cooldown, not per contact', () => {
    const h = inLiveAfterHit().wait(1).ev('pop', 'pop.OF.L');
    for (let i = 0; i < 8; i++) h.ev('pop', 'pop.OF.R'); // eight more contacts within 0.1 s
    expect(h.g.hustle).toBe(1);
    h.wait(HUSTLE_COOLDOWN + 0.05).ev('pop', 'pop.OF.R');
    expect(h.g.hustle).toBe(2);
  });

  it('bumper hits do not count in the pitch or the leadoff launch', () => {
    expect(bump(inPitch(), 4).g.hustle).toBe(0);
    expect(bump(inLeadoff(), 4).g.hustle).toBe(0);
  });

  it('a full HUSTLE meter moves every runner up a base, and the third-base runner scores', () => {
    const h = inInPlay().ev('pop', 'pop.1B.L').ev('swing', 'flipper.L').ev('pop', 'pop.1B.L');
    expect(h.g.bases).toEqual([true, true, false]);
    bump(h, HUSTLE_TARGET - 1);
    expect(h.g.bases).toEqual([true, true, false]);
    expect(h.g.snapshot().hustle).toBe(HUSTLE_TARGET - 1);
    bump(h, 1);
    expect(h.g.bases).toEqual([false, true, true]);
    expect(h.g.hustle).toBe(0);
    expect(h.g.stats.hustles).toBe(1);
    expect(h.last('hustle')).toMatchObject({ runs: 0, moved: [0, 1] });
    // Again: the runner on third scores.
    bump(h, HUSTLE_TARGET);
    expect(h.g.stats.runs).toBe(1);
    expect(h.g.bases).toEqual([false, false, true]);
  });

  it('a full meter pays the moment it fills when a runner is on', () => {
    const h = bump(inLiveAfterHit(), HUSTLE_TARGET); // a single: a runner on first
    expect(h.g.stats.hustles).toBe(1);
    expect(h.g.bases).toEqual([false, true, false]);
  });

  it('with nobody on base a full meter holds; a runner arriving lets the next bumper hit pay', () => {
    // Home run: the bases clear, the ball stays live.
    const h = inInPlay().ev('sensor', 'gate.HR');
    expect(h.g.bases).toEqual([false, false, false]);
    bump(h, HUSTLE_TARGET + 3);
    expect(h.g.hustle).toBe(HUSTLE_TARGET);
    expect(h.g.stats.hustles).toBe(0);
    expect(h.g.lamps()['hustle.5']).toBe('blink');
    // A walk puts a runner on first; the next bumper hit pays.
    for (const l of ['W', 'A', 'L', 'K']) h.ev('standup', `standup.${l}`);
    expect(h.g.bases).toEqual([true, false, false]);
    bump(h, 1);
    expect(h.g.stats.hustles).toBe(1);
    expect(h.g.bases).toEqual([false, true, false]);
  });

  it('HUSTLE lamps light one per HUSTLE_TARGET / 5 hits, and the meter persists through innings', () => {
    const per = HUSTLE_TARGET / 5;
    const h = bump(inLiveAfterHit(), per * 2 + 1);
    const on = ['1', '2', '3', '4', '5'].map((i) => h.g.lamps()[`hustle.${i}`]);
    expect(on).toEqual(['on', 'on', 'off', 'off', 'off']);
    h.ev('drain', 'drain').toPitch().ev('drain', 'drain').toPitch().ev('drain', 'drain').wait(6);
    expect(h.g.inning).toBe(2);
    expect(h.g.hustle).toBe(per * 2 + 1);
  });

  it('skill shot: the lit lane on the leadoff launch lights HOT BAT; buttons move the lit lane', () => {
    const h = inLeadoff();
    const lit = h.g.skillLane!;
    h.g.onButton('R', true);
    expect(h.g.skillLane).not.toBe(lit);
    const now = h.g.skillLane!;
    h.ev('plunger').ev('sensor', `lane.${now}`);
    expect(h.g.hotBat).toBe(true);
    expect(h.g.stats.skillShots).toBe(1);
  });

  it('completing R-B-I relights the kickback', () => {
    const h = inInPlay().ev('kickback', 'kickback.L');
    expect(h.g.kickbackLit).toBe(false);
    h.ev('sensor', 'lane.R').ev('sensor', 'lane.B').ev('sensor', 'lane.I');
    expect(h.g.kickbackLit).toBe(true);
    expect(h.m.kickback).toBe(true);
  });

  it('Rally Cap: the 3rd consecutive rally hit lights HOT BAT; any out ends the rally', () => {
    const h = inLiveAfterHit();
    for (let i = 0; i < 3; i++) h.ev('swing', 'flipper.L').ev('pop', 'pop.1B.L');
    expect(h.g.hotBat).toBe(true);
    expect(h.g.rally).toBe(3);
    h.ev('swing', 'flipper.R').ev('drain', 'drain');
    expect(h.g.rally).toBe(0);
    expect(h.g.stats.longestRally).toBe(4);
  });

  it('curveballs pulse the magnet after release', () => {
    const h = new Harness();
    // Late innings throw curveballs; play to the 7th and watch for a magnet pulse.
    for (let inning = 1; inning <= 6; inning++) {
      h.ev('plunger')
        .ev('drain', 'drain')
        .toPitch()
        .ev('drain', 'drain')
        .toPitch()
        .ev('drain', 'drain')
        .wait(6);
    }
    let pulsed = false;
    h.ev('plunger').ev('drain', 'drain');
    for (let k = 0; k < 6000 && !pulsed; k++) {
      h.wait(0.01);
      if (h.m.magnet > 0) pulsed = true;
      if (pulsed) break;
      // Not a curve: retire the batter and take the next pitch (in the next inning if need be).
      if (h.state === 'PITCH') h.ev('saucer', 'saucer.SS');
      if (h.state === 'LEADOFF_LAUNCH') h.ev('plunger').ev('drain', 'drain');
    }
    expect(pulsed).toBe(true);
  });
});

describe('the Bleachers and THROW IT BACK', () => {
  /** A home run: a fan in the Bleachers catches the ball, a souvenir. */
  const withSouvenir = (): Harness => {
    const h = inInPlay().ev('sensor', 'gate.HR');
    expect(h.g.souvenirReady).toBe(true);
    return h;
  };
  /** The ball in play touches the souvenir in the Bleachers; the fan throws it back a moment later. */
  const strike = (h: Harness): Harness =>
    h.ev('parkedHit', BLEACHERS).wait(THROW_BACK_DELAY + 0.05);
  const inThrowBack = (): Harness => {
    const h = strike(withSouvenir());
    expect(h.g.throwBack).toBe(true);
    return h;
  };

  it('no souvenir at the start: a home run puts one in the Bleachers, its lamp blinking', () => {
    const h = inLeadoff();
    expect(h.g.souvenirReady).toBe(false);
    expect(h.m.calls).not.toContain('park');
    expect(h.g.lamps()['lamp.bleachers']).toBe('off');
    h.ev('plunger').ev('swing', 'flipper.L').ev('sensor', 'gate.HR');
    expect(h.m.calls.filter((c) => c === 'park')).toHaveLength(1);
    expect(h.count('souvenirReady')).toBe(1);
    expect(h.g.lamps()['lamp.bleachers']).toBe('blink');
    // Another home run while it waits: still one souvenir.
    h.ev('swing', 'flipper.L').ev('sensor', 'gate.HR');
    expect(h.m.calls.filter((c) => c === 'park')).toHaveLength(1);
  });

  it('touching it starts THROW IT BACK: the fan throws it into play as the second ball', () => {
    const h = withSouvenir().ev('parkedHit', BLEACHERS);
    expect(h.count('throwBack')).toBe(1);
    expect(h.g.throwBack).toBe(true);
    expect(h.g.souvenirReady).toBe(false);
    expect(h.g.stats.throwBacks).toBe(1);
    expect(h.m.balls).toBe(1);
    h.wait(THROW_BACK_DELAY + 0.05);
    expect(h.m.calls).toContain(`eject:${BLEACHERS}`);
    expect(h.m.balls).toBe(2);
    expect(h.g.lamps()['lamp.bleachers']).toBe('blink');
    // A second touch (it has gone) does nothing.
    h.ev('parkedHit', BLEACHERS);
    expect(h.count('throwBack')).toBe(1);
  });

  it('a touch when the ball is not live does nothing', () => {
    const h = withSouvenir().ev('drain', 'drain').ev('parkedHit', BLEACHERS);
    expect(h.count('throwBack')).toBe(0);
    expect(h.g.souvenirReady).toBe(true);
  });

  it('a ball in the empty Bleachers is no out: it is kicked back out', () => {
    const h = inInPlay().ev('saucer', BLEACHERS);
    expect(h.g.outs).toBe(0);
    h.wait(BLEACHERS_HOLD + 0.05);
    expect(h.m.calls.filter((c) => c === `eject:${BLEACHERS}`)).toHaveLength(1);
  });

  it('a souvenir not thrown back by the end of the inning: the fan keeps it', () => {
    const h = withSouvenir();
    h.ev('drain', 'drain').toPitch().ev('drain', 'drain').toPitch().ev('drain', 'drain').wait(6);
    expect(h.g.inning).toBe(2);
    expect(h.g.souvenirReady).toBe(false);
    expect(h.m.calls).toContain('clear');
  });

  it('no outs in THROW IT BACK: it ends when one ball is left, then outs count again', () => {
    const h = inThrowBack().ev('drain', 'drain');
    expect(h.g.outs).toBe(0);
    expect(h.g.throwBack).toBe(false);
    expect(h.last('throwBackEnd')).toMatchObject({ runs: 0 });
    // Nothing is put back: the player plays on with the one ball that is left.
    expect(h.m.balls).toBe(1);
    h.ev('drain', 'drain');
    expect(h.g.outs).toBe(1);
  });

  it('a drain before the souvenir is back in play is no out: it still comes back', () => {
    const h = withSouvenir().ev('parkedHit', BLEACHERS).ev('drain', 'drain');
    expect(h.g.outs).toBe(0);
    expect(h.g.throwBack).toBe(false);
    h.wait(THROW_BACK_DELAY + 0.05);
    expect(h.m.calls).toContain(`eject:${BLEACHERS}`);
    expect(h.m.balls).toBe(1);
  });

  it('a fielder catch in THROW IT BACK costs no out: that ball is out of play, the other plays on', () => {
    const h = inThrowBack().ev('saucer', 'saucer.LF');
    expect(h.g.outs).toBe(0);
    expect(h.m.calls).toContain('release:saucer.LF');
    expect(h.m.balls).toBe(1);
    expect(h.g.throwBack).toBe(false);
    // Down to one ball: the next catch is an out.
    h.ev('saucer', 'saucer.SS');
    expect(h.g.outs).toBe(1);
  });

  it('runs count once in THROW IT BACK: its reward is the second ball', () => {
    // THROW IT BACK, a runner on third, then a single brings him home: 1 run.
    const h = strike(withSouvenir());
    h.g.bases = [false, false, true];
    const before = h.g.stats.runs;
    h.ev('swing', 'flipper.L').ev('pop', 'pop.1B.L');
    expect(h.last('hit')).toMatchObject({ runs: 1 });
    expect(h.g.stats.runs - before).toBe(1);
    h.ev('drain', 'drain');
    expect(h.last('throwBackEnd')).toMatchObject({ runs: 1 });
  });
});

describe('hits off the real flippers (physics + rules)', () => {
  /**
   * The batter is up but has not swung (the leadoff ball, or a pitch). The ball comes to `side`'s
   * flipper (down its inlane, as the plunged leadoff ball does, or pitched at it) and the player
   * flips `delayMs` later. Reports the first decisive thing the shot hit and the hits the rules
   * credited for it.
   */
  function flipAtBatter(
    state: 'LEADOFF_LAUNCH' | 'PITCH',
    side: 'L' | 'R',
    feed: Feed,
    delayMs: number,
  ) {
    const world = new World(v1Table, defaultParams());
    const rules = new GameRules(new WorldMachine(world), { seed: 7 });
    rules.start(0);
    if (state === 'PITCH') {
      // The leadoff ball drains (a strikeout) and the next batter gets a pitch.
      rules.onSwitch({ type: 'drain', id: 'drain', time: 0 });
      for (let t = 0; rules.state !== 'PITCH'; t += 0.01) rules.update(t);
    }
    expect(rules.state).toBe(state);
    rules.events.length = 0;
    // Feed the ball exactly as the shot-map sweep does (tests/physics/shots.ts).
    const sign = side === 'L' ? 1 : -1;
    const cx = side === 'L' ? 0 : 0.55;
    if (feed === 'inlane') {
      const b = world.ball();
      b.place(cx + sign * 0.064, 0.395);
      b.vy = -0.9;
    } else world.pitchBall(cx + sign * 0.216, 0.19, 1.1);
    const id = side === 'L' ? 'flipper.L' : 'flipper.R';
    let result: string | null = null;
    for (let i = 0; i < 3500 && !result; i++) {
      if (i === delayMs) world.setFlipper(id, true);
      if (i === delayMs + 160) world.setFlipper(id, false);
      world.step();
      for (const e of world.events) {
        if (i >= delayMs && !result) result = hitDevice(e) ?? classify(e);
        rules.onSwitch(e);
      }
      world.events.length = 0;
    }
    const hits = rules.events.flatMap((e) => (e.type === 'hit' ? [e.hit] : []));
    return { result, hits };
  }

  /** The hit a device scores for a batter who has swung (the triple's corner kickers aside). */
  function hitDevice(e: PhysicsEvent): HitType | null {
    if (e.type === 'pop' && e.id.startsWith('pop.1B')) return '1B';
    if (e.type === 'pop' && e.id.startsWith('pop.2B')) return '2B';
    if (e.type === 'sensor' && e.id === 'gate.HR') return 'HR';
    return null;
  }
  const HITS: (string | null)[] = ['1B', '2B', 'HR'];

  it('a ball flipped off the resting bat is a swing: the hit counts', () => {
    // The playtest bug: the ball came down onto the bat with the button up, and that passive touch
    // used up its one swing, so the flip that followed was no swing and the hit went uncounted.
    // Here the plunged leadoff ball rolls down the left inlane and is flipped up the HR ramp...
    expect(flipAtBatter('LEADOFF_LAUNCH', 'L', 'inlane', 750)).toEqual({
      result: 'HR',
      hits: ['HR'],
    });
    // ...and a pitch bounces off the resting bat just before the flip sends it into the Gap.
    expect(flipAtBatter('PITCH', 'R', 'pitch', 200)).toEqual({ result: '1B', hits: ['1B'] });
  });

  for (const state of ['LEADOFF_LAUNCH', 'PITCH'] as const) {
    it(`every flipper shot into a hit device records that hit (${state})`, () => {
      let checked = 0;
      for (const side of ['L', 'R'] as const) {
        const sweeps: [Feed, number, number][] = [
          ['inlane', 700, 1000],
          ['pitch', 100, 280],
        ];
        for (const [feed, from, to] of sweeps) {
          for (let d = from; d <= to; d += 10) {
            const { result, hits } = flipAtBatter(state, side, feed, d);
            if (!HITS.includes(result)) continue;
            checked++;
            expect(hits[0], `${side} ${feed} @${d}ms`).toBe(result);
          }
        }
      }
      expect(checked).toBeGreaterThanOrEqual(15);
    });
  }
});
