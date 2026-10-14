import { describe, expect, it } from 'vitest';
import { Director, type PresentationOut } from '../../src/fx/director';
import type { PhysicsEvent } from '../../src/physics/world';
import type { RulesEvent } from '../../src/rules/types';
import { v1Table } from '../../src/table/v1Table';

// M4 exit criterion (docs/MVP/07 § M4): every presentation event has visual and audio feedback.

const AUDIO = new Set(['sound', 'impact', 'stinger', 'crowd', 'crowdIntensity']);

function recorder(): { out: PresentationOut; calls: string[] } {
  const calls: string[] = [];
  const out = new Proxy({} as PresentationOut, {
    get: (_, name: string) => () => calls.push(name),
  });
  return { out, calls };
}

/** One example of every rules event (a new event type fails to compile here until added). */
const RULES_EVENTS: { [K in RulesEvent['type']]: Extract<RulesEvent, { type: K }>[] } = {
  gameStart: [{ type: 'gameStart' }],
  inningStart: [
    { type: 'inningStart', inning: 1 },
    { type: 'inningStart', inning: 7 },
  ],
  pitchTell: [{ type: 'pitchTell', pitch: 'CB', side: 'L', lead: 1.5 }],
  pitch: [
    { type: 'pitch', pitch: 'FB' },
    { type: 'pitch', pitch: 'CB' },
  ],
  hit: [
    { type: 'hit', hit: '1B', bases: 1, hotBat: false, runs: 0 },
    { type: 'hit', hit: '2B', bases: 2, hotBat: false, runs: 1 },
    { type: 'hit', hit: '3B', bases: 3, hotBat: false, runs: 0 },
    { type: 'hit', hit: 'HR', bases: 4, hotBat: false, runs: 2 },
    { type: 'hit', hit: '3B', bases: 4, hotBat: true, runs: 1 },
  ],
  out: [
    { type: 'out', how: 'K', outs: 1 },
    { type: 'out', how: 'foul', outs: 2 },
    { type: 'out', how: 'fielder', position: 'SS', outs: 1 },
    { type: 'out', how: 'tilt', outs: 1 },
  ],
  runs: [{ type: 'runs', runs: 2 }],
  steal: [
    { type: 'steal', from: 0, runs: 0 },
    { type: 'steal', from: 2, runs: 1 },
  ],
  hustle: [
    { type: 'hustle', runs: 0, moved: [0] },
    { type: 'hustle', runs: 1, moved: [0, 1, 2] },
  ],
  walk: [
    { type: 'walk', runs: 0, moved: [] },
    { type: 'walk', runs: 1, moved: [0, 1, 2] },
  ],
  stealRamp: [{ type: 'stealRamp', result: 'noRunner' }],
  bullpenReady: [{ type: 'bullpenReady' }],
  doubleheader: [{ type: 'doubleheader' }],
  doubleheaderEnd: [
    { type: 'doubleheaderEnd', runs: 0 },
    { type: 'doubleheaderEnd', runs: 6 },
  ],
  spinBonus: [
    { type: 'spinBonus', gained: 3 },
    { type: 'spinBonus', gained: 0 },
  ],
  stretch: [{ type: 'stretch' }],
  hotBat: [{ type: 'hotBat', source: 'BAT' }],
  kickbackLit: [{ type: 'kickbackLit' }],
  skillShot: [{ type: 'skillShot' }],
  rally: [
    { type: 'rally', count: 1 },
    { type: 'rally', count: 2 },
    { type: 'rally', count: 4 },
  ],
  tiltWarning: [{ type: 'tiltWarning', warnings: 1 }],
  tilt: [{ type: 'tilt' }],
  ballSearch: [{ type: 'ballSearch' }],
  ballRescued: [{ type: 'ballRescued' }],
  inningEnd: [
    { type: 'inningEnd', inning: 3, runs: 0, lob: 2 },
    { type: 'inningEnd', inning: 3, runs: 2, lob: 0 },
  ],
  gameOver: [{ type: 'gameOver' }],
};

describe('presentation director', () => {
  for (const [type, examples] of Object.entries(RULES_EVENTS)) {
    it(`${type} is both seen and heard`, () => {
      for (const e of examples as RulesEvent[]) {
        const { out, calls } = recorder();
        new Director(v1Table, out).rules(e, null);
        const label = JSON.stringify(e);
        expect(
          calls.some((c) => AUDIO.has(c)),
          `${label} has no sound`,
        ).toBe(true);
        expect(
          calls.some((c) => !AUDIO.has(c)),
          `${label} has no visual`,
        ).toBe(true);
      }
    });
  }

  it('every playfield switch is heard, and every device is seen moving or lit', () => {
    const switches: PhysicsEvent[] = [
      ...v1Table.elements.flatMap((el): PhysicsEvent[] => {
        if (el.type === 'pop' || el.type === 'sling' || el.type === 'kicker')
          return [{ type: el.type, id: el.id, time: 0 }];
        if (el.type === 'rampBumper') return [{ type: 'pop', id: el.id, time: 0 }];
        if (el.type === 'drop' || el.type === 'standup' || el.type === 'saucer')
          return [{ type: el.type, id: el.id, time: 0 }];
        if (el.type === 'spinner') return [{ type: 'spinner', id: el.id, time: 0 }];
        if (el.type === 'sensor' && (el.id.includes('lane.') || el.id.startsWith('gate.')))
          return [{ type: 'sensor', id: el.id, time: 0 }];
        return [];
      }),
      { type: 'drain', id: 'drain', time: 0 },
      { type: 'kickback', id: 'kickback.L', time: 0 },
      { type: 'plunger', id: 'plunger', time: 0 },
    ];
    expect(switches.length).toBeGreaterThan(30);
    for (const e of switches) {
      const { out, calls } = recorder();
      new Director(v1Table, out).physics(e, { x: 0.3, y: 0.6 });
      expect(
        calls.some((c) => AUDIO.has(c)),
        `${e.type} ${e.id} is silent`,
      ).toBe(true);
      if (
        e.type !== 'drain' &&
        e.type !== 'plunger' &&
        !e.id.startsWith('inlane') &&
        !e.id.startsWith('outlane')
      ) {
        expect(
          calls.some((c) => !AUDIO.has(c)),
          `${e.type} ${e.id} shows nothing`,
        ).toBe(true);
      }
    }
  });

  it('flippers and nudges are heard from the button press', () => {
    const { out, calls } = recorder();
    const d = new Director(v1Table, out);
    d.flipper('L', true);
    d.flipper('L', false);
    d.nudge();
    expect(calls.filter((c) => c === 'sound')).toHaveLength(3);
  });

  it('reduced motion never shakes the camera', () => {
    const { out, calls } = recorder();
    const d = new Director(v1Table, out);
    d.reduced = true;
    d.nudge();
    d.rules({ type: 'tiltWarning', warnings: 1 }, null);
    d.physics({ type: 'kickback', id: 'kickback.L', time: 0 }, null);
    expect(calls).not.toContain('shake');
  });

  it('a fast ball skimming past a fielder makes him dive (once, then a cooldown)', () => {
    const { out, calls } = recorder();
    const d = new Director(v1Table, out);
    // Pass 30 mm to the right of the SS saucer (radius 20).
    const ss = v1Table.elements.find((e) => e.type === 'saucer' && e.id === 'saucer.SS')!;
    if (ss.type !== 'saucer') throw new Error('no SS');
    const past = { x: (ss.x + 30) / 1000, y: ss.y / 1000, speed: 2 };
    d.frame(0.016, past, null);
    d.frame(0.016, past, null);
    expect(calls.filter((c) => c === 'figure')).toHaveLength(1);
  });
});
