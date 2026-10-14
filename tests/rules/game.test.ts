import { describe, expect, it } from 'vitest';
import type { PhysicsEvent, PhysicsEventType } from '../../src/physics/world';
import { advance, advanceAll, steal, walk } from '../../src/rules/bases';
import {
  BULLPEN,
  BULLPEN_HOLD,
  ERROR_HOLD,
  GameRules,
  HUSTLE_COOLDOWN,
  HUSTLE_TARGET,
  RELIEVER_ENTRANCE,
  SPIN_BONUS_HUSTLE,
  STRETCH_ALERT_DELAY,
} from '../../src/rules/game';
import type { PitchSpec } from '../../src/rules/pitching';
import type { Machine, RulesEvent } from '../../src/rules/types';

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
  parkBullpen(): void {
    this.calls.push('park');
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
  g = new GameRules(this.m, { seed: 7 });
  t = 0;
  constructor() {
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

describe('the Bullpen and DOUBLEHEADER', () => {
  /** The ball in play touches the reliever waiting in the Bullpen; he enters a moment later. */
  const strike = (h: Harness): Harness => h.ev('parkedHit', BULLPEN).wait(RELIEVER_ENTRANCE + 0.05);
  const inDoubleheader = (): Harness => {
    const h = strike(inInPlay());
    expect(h.g.doubleheader).toBe(true);
    return h;
  };

  it('a reliever waits in the Bullpen from the start, lamps lit', () => {
    const h = inLeadoff();
    expect(h.m.calls.filter((c) => c === 'park')).toHaveLength(1);
    expect(h.g.bullpenReady).toBe(true);
    expect(h.g.lamps()['lamp.bullpen']).toBe('on');
  });

  it('touching him starts DOUBLEHEADER: he is kicked into play as the second ball', () => {
    const h = inInPlay().ev('parkedHit', BULLPEN);
    expect(h.count('doubleheader')).toBe(1);
    expect(h.g.doubleheader).toBe(true);
    expect(h.g.bullpenReady).toBe(false);
    expect(h.g.stats.doubleheaders).toBe(1);
    expect(h.m.balls).toBe(1);
    h.wait(RELIEVER_ENTRANCE + 0.05);
    expect(h.m.calls).toContain(`eject:${BULLPEN}`);
    expect(h.m.balls).toBe(2);
    expect(h.g.lamps()['lamp.bullpen']).toBe('blink');
    // A second touch (he has gone) does nothing.
    h.ev('parkedHit', BULLPEN);
    expect(h.count('doubleheader')).toBe(1);
  });

  it('a touch when the ball is not live does nothing', () => {
    const h = inInPlay().ev('drain', 'drain').ev('parkedHit', BULLPEN);
    expect(h.count('doubleheader')).toBe(0);
    expect(h.g.bullpenReady).toBe(true);
  });

  it('a ball in the empty Bullpen is no out: it is kicked back out', () => {
    const h = strike(inInPlay()).ev('drain', 'drain');
    expect(h.g.doubleheader).toBe(false);
    h.ev('saucer', BULLPEN);
    expect(h.g.outs).toBe(0);
    h.wait(BULLPEN_HOLD + 0.05);
    expect(h.m.calls.filter((c) => c === `eject:${BULLPEN}`)).toHaveLength(2);
  });

  it('a new reliever warms up at the start of the next inning', () => {
    const h = strike(inInPlay()).ev('drain', 'drain');
    h.ev('drain', 'drain').toPitch().ev('drain', 'drain').toPitch().ev('drain', 'drain').wait(6);
    expect(h.g.inning).toBe(2);
    expect(h.g.bullpenReady).toBe(true);
    expect(h.count('bullpenReady')).toBe(1);
    expect(h.m.calls.filter((c) => c === 'park')).toHaveLength(2);
  });

  it('no outs in DOUBLEHEADER: it ends when one ball is left, then outs count again', () => {
    const h = inDoubleheader().ev('drain', 'drain');
    expect(h.g.outs).toBe(0);
    expect(h.g.doubleheader).toBe(false);
    expect(h.last('doubleheaderEnd')).toMatchObject({ runs: 0 });
    // Nothing is put back: the player plays on with the one ball that is left.
    expect(h.m.balls).toBe(1);
    h.ev('drain', 'drain');
    expect(h.g.outs).toBe(1);
  });

  it('a drain before the reliever is in play is no out: he still comes in', () => {
    const h = inInPlay().ev('parkedHit', BULLPEN).ev('drain', 'drain');
    expect(h.g.outs).toBe(0);
    expect(h.g.doubleheader).toBe(false);
    h.wait(RELIEVER_ENTRANCE + 0.05);
    expect(h.m.calls).toContain(`eject:${BULLPEN}`);
    expect(h.m.balls).toBe(1);
  });

  it('a fielder drops the ball in DOUBLEHEADER: an error, no out, and the ball is thrown back', () => {
    const h = inDoubleheader().ev('saucer', 'saucer.LF');
    expect(h.last('fieldingError')).toMatchObject({ position: 'LF' });
    expect(h.g.outs).toBe(0);
    h.wait(ERROR_HOLD + 0.05);
    expect(h.m.calls).toContain('eject:saucer.LF');
    expect(h.m.balls).toBe(2);
  });

  it('every run counts twice in DOUBLEHEADER', () => {
    // A runner on third, then DOUBLEHEADER, then a single brings him home: 2 runs.
    const h = inInPlay();
    h.g.bases = [false, false, true];
    strike(h);
    const before = h.g.stats.runs;
    h.ev('swing', 'flipper.L').ev('pop', 'pop.1B.L');
    expect(h.last('hit')).toMatchObject({ runs: 2 });
    expect(h.g.stats.runs - before).toBe(2);
    h.ev('drain', 'drain');
    expect(h.last('doubleheaderEnd')).toMatchObject({ runs: 2 });
  });
});
