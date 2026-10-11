import { describe, expect, it } from 'vitest';
import type { PhysicsEvent, PhysicsEventType } from '../../src/physics/world';
import { advance, steal } from '../../src/rules/bases';
import { GameRules } from '../../src/rules/game';
import type { PitchSpec } from '../../src/rules/pitching';
import type { Machine, RulesEvent } from '../../src/rules/types';

// Rules unit tests: every cell of the event-resolution table (docs/MVP/01 § 4.3), base running,
// feature goals, innings and game over. A fake machine stands in for the physics.

class FakeMachine implements Machine {
  calls: string[] = [];
  inPlay = false;
  speed = 1;
  flippers = true;
  kickback = false;
  magnet = 0;
  serveToPlunger(): void {
    this.calls.push('serve');
    this.inPlay = true;
  }
  pitch(spec: PitchSpec): void {
    this.calls.push(`pitch:${spec.type}`);
    this.inPlay = true;
  }
  holdBall(): void {
    this.inPlay = false;
  }
  setMagnet(p: number): void {
    this.magnet = p;
  }
  setKickback(armed: boolean): void {
    this.kickback = armed;
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
    if (type === 'drain' || type === 'saucer') this.m.inPlay = false;
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

  it('steals with the lead runner who can advance', () => {
    expect(steal([false, false, false])).toBeNull();
    expect(steal([true, false, false])?.bases).toEqual([false, true, false]);
    expect(steal([true, true, false])?.bases).toEqual([true, false, true]);
    expect(steal([true, false, true])).toMatchObject({ bases: [true, false, false], runs: 1 });
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

  it('fielder saucer', () => {
    const p = inPitch();
    const pitches = p.m.pitches();
    p.ev('saucer', 'saucer.LF').toPitch();
    expect(p.g.outs).toBe(1); // only the earlier out
    expect(p.m.pitches()).toBe(pitches + 1);

    const ip = inInPlay().ev('saucer', 'saucer.SS');
    expect(ip.g.outs).toBe(1);
    expect(ip.last('out')).toMatchObject({ how: 'fielder', position: 'SS' });

    for (const h of [inLiveAfterHit(), inLeadoff().ev('plunger')]) {
      h.ev('saucer', 'saucer.CF');
      expect(h.g.outs).toBe(0);
      h.toPitch();
      expect(h.state).toBe('PITCH');
    }
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
      h.ev('drop', 'drop.B').ev('standup', 'standup.R').ev('sensor', 'spinner.L');
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

  it('R-U-N lights STEAL; the Steal ramp then advances the lead runner', () => {
    const h = inInPlay()
      .ev('standup', 'standup.R')
      .ev('standup', 'standup.U')
      .ev('standup', 'standup.N');
    expect(h.g.stealLit).toBe(true);
    h.ev('sensor', 'gate.STEAL');
    expect(h.g.stealLit).toBe(true); // nobody on base: stays lit
    h.ev('pop', 'pop.1B.L').ev('sensor', 'gate.STEAL');
    expect(h.g.bases).toEqual([false, true, false]);
    expect(h.g.stealLit).toBe(false);
  });

  it('stealing home scores a run', () => {
    const h = inInPlay()
      .ev('sensor', 'orbit.L')
      .ev('kicker', 'kicker.3B.L')
      .ev('standup', 'standup.R')
      .ev('standup', 'standup.U')
      .ev('standup', 'standup.N');
    h.ev('sensor', 'gate.STEAL');
    expect(h.g.stats.runs).toBe(1);
    expect(h.g.bases).toEqual([false, false, false]);
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
    for (let k = 0; k < 2000 && !pulsed; k++) {
      h.wait(0.01);
      if (h.m.magnet > 0) pulsed = true;
      if (h.state === 'PITCH' && !pulsed) h.ev('saucer', 'saucer.SS');
    }
    expect(pulsed).toBe(true);
  });
});
