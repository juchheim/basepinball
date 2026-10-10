import { describe, expect, it } from 'vitest';
import { Rng } from '../../src/core/rng';
import { buildPitch, TEMPLATES, type PitchType, type Side } from '../../src/rules/pitching';
import { simulatePitch } from './pitchSim';

// Pitch fairness (docs/MVP/01 § 4.6): with no swing, every pitch reaches the middle of a flipper
// (25-75 % of its length) without touching anything first, and then drains (a called strike three).
// A pitch can never go straight down the middle.

describe('pitch templates', () => {
  for (const type of ['FB', 'CH', 'CB'] as PitchType[]) {
    for (const side of ['L', 'R'] as Side[]) {
      it(`${type} to the ${side} flipper always lands in the sweet zone`, () => {
        const rng = new Rng(type.charCodeAt(0) * 31 + side.charCodeAt(0));
        for (const inning of [1, 5, 9]) {
          for (let k = 0; k < 6; k++) {
            const spec = buildPitch(TEMPLATES[type], side, inning, rng);
            const r = simulatePitch(spec);
            const label = `${type} ${side} inning ${inning} v=${spec.speed.toFixed(2)}`;
            expect(r.side, label).toBe(side);
            expect(r.contact, label).not.toBeNull();
            expect(r.contact!, label).toBeGreaterThan(0.25);
            expect(r.contact!, label).toBeLessThan(0.75);
            expect(r.before, label).toEqual([]);
            expect(r.drained, label).toBe(true);
          }
        }
      });
    }
  }

  it('the extremes of every template are still fair', () => {
    for (const type of ['FB', 'CH', 'CB'] as PitchType[]) {
      const t = TEMPLATES[type];
      for (const side of ['L', 'R'] as Side[]) {
        const dir = side === 'L' ? 1 : -1;
        for (const speed of t.speed) {
          for (const j of [-t.aimJitter, t.aimJitter]) {
            const spec = { ...buildPitch(t, side, 1, new Rng(1)), speed };
            spec.targetX = (side === 'L' ? 0.221 : 0.329) + dir * (t.aimOffset + j);
            const r = simulatePitch(spec);
            expect(r.contact, `${type} ${side} v=${speed} jitter=${j}`).toBeGreaterThan(0.25);
            expect(r.contact!).toBeLessThan(0.75);
          }
        }
      }
    }
  });
});
