import { describe, expect, it } from 'vitest';
import { Rng } from '../../src/core/rng';
import { rampEdges } from '../../src/physics/world';
import type { TableDef } from '../../src/table/schema';
import { m0TestTable } from '../../src/table/m0TestTable';
import { v1Table } from '../../src/table/v1Table';
import { makeWorld, runFor } from './helpers';

/** Spawn points no ball can reach in play: under the ramps and the pockets behind the side banks. */
function sealed(table: TableDef, xMm: number, yMm: number): boolean {
  if (table !== v1Table) return false;
  if (yMm > 520 && yMm < 690 && (xMm < 60 || xMm > 490)) return true;
  return table.elements.some((el) => {
    if (el.type !== 'ramp') return false;
    const { left, right } = rampEdges(el.path, el.width, el.endWidth ?? el.width);
    const poly = [...left, ...right.slice().reverse()];
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, yi] = poly[i]!;
      const [xj, yj] = poly[j]!;
      if (yi > yMm !== yj > yMm && xMm < ((xj - xi) * (yMm - yi)) / (yj - yi) + xi)
        inside = !inside;
    }
    return inside;
  });
}

// Whitebox checklist item (docs/MVP/02 § 9): no stuck-ball spots. Random balls are thrown into the
// open playfield with flippers idle, flicking randomly, or held; a ball that sits still for 2 s with
// no flipper held (a cradle is intentional) and not in a saucer is stuck.

// (M3: this ran on the M0 test table only, which missed ledges on the v1 table: the tops of the
// fielders' lip bars and the gap under each ramp's floor edge.)

describe('stuck balls', () => {
  it.each([
    ['M0 test table', m0TestTable, 0.72],
    ['v1 table', v1Table, 0.95],
  ] as const)('never come to rest anywhere except a cradle or a saucer (%s)', (_, table, yMax) => {
    const rng = new Rng(99);
    const stuck: string[] = [];
    for (let trial = 0; trial < 150; trial++) {
      let x = rng.range(0.03, 0.52);
      let y = rng.range(0.42, yMax);
      while (sealed(table, x * 1000, y * 1000)) {
        x = rng.range(0.03, 0.52);
        y = rng.range(0.42, yMax);
      }
      const w = makeWorld(table);
      const b = w.addBall(x, y);
      b.vx = rng.range(-3, 3);
      b.vy = rng.range(-3, 2);
      const mode = trial % 3; // 0: never flip, 1: random flips, 2: hold left
      if (mode === 2) w.setFlipper('flipper.L', true);
      let still = 0;
      for (let i = 0; i < 15000 && b.active; i++) {
        if (mode === 1 && i % 300 === 0) {
          w.setFlipper('flipper.L', rng.next() < 0.3);
          w.setFlipper('flipper.R', rng.next() < 0.3);
        }
        w.step();
        w.events.length = 0;
        if (w.saucers.some((s) => s.holding)) break;
        still = b.speed() < 0.01 ? still + 1 : 0;
        if (still > 2000) {
          if (!w.flippers.some((f) => f.pressed)) {
            stuck.push(
              `trial ${trial} at (${(b.px * 1000).toFixed(0)}, ${(b.py * 1000).toFixed(0)}) mm`,
            );
          }
          break;
        }
      }
    }
    expect(stuck).toEqual([]);
  });

  // A ball thrown off the mound's ramp could drop in behind the B-A-T bank over its 25 mm walls and
  // sit wedged against the backstop at (16, 565) until the ball rescue; the pocket is filled in now.
  it('a ball that drops in behind the B-A-T bank rolls back out, targets up or down', () => {
    const rng = new Rng(7);
    const stuck: string[] = [];
    for (let trial = 0; trial < 80; trial++) {
      const w = makeWorld(v1Table);
      ['drop.B', 'drop.A', 'drop.T'].forEach((id, i) => {
        if (trial & (1 << i)) w.drops.get(id)!.down = true;
      });
      const b = w.addBall(rng.range(0.005, 0.06), rng.range(0.53, 0.65), rng.range(0.04, 0.075));
      b.vx = rng.range(-0.6, 0.6);
      b.vy = rng.range(-0.6, 0.6);
      b.vz = rng.range(-1, 0.3);
      runFor(w, 3);
      if (b.active && b.px < 0.065 && b.py > 0.515 && b.py < 0.69) {
        stuck.push(
          `trial ${trial} at (${(b.px * 1000).toFixed(0)}, ${(b.py * 1000).toFixed(0)}) mm`,
        );
      }
    }
    expect(stuck).toEqual([]);
  });

  // Up the alley beside each ramp the inner guide closes in to the ramp's far end, leaving a slot
  // narrower than a ball. One thrown up the alley off the mound's ramp flew in over the 25 mm guide
  // and came down wedged in the slot, at (480, 1008) or (70, 1006); that stretch is tall now.
  it.each(['L', 'R'] as const)(
    'a ball thrown up the alley beside a ramp never wedges in its far end (%s)',
    (side) => {
      const rng = new Rng(5);
      const stuck: string[] = [];
      for (let trial = 0; trial < 120; trial++) {
        const x = rng.range(0.472, 0.495);
        const w = makeWorld(v1Table);
        const b = w.addBall(side === 'R' ? x : 0.55 - x, rng.range(0.88, 0.94), 0.045);
        const speed = rng.range(0.3, 4);
        const angle = rng.range(70, 110) * (Math.PI / 180);
        b.vx = speed * Math.cos(angle) * (side === 'R' ? 1 : -1);
        b.vy = speed * Math.sin(angle);
        b.vz = rng.range(-0.5, 0.5);
        runFor(w, 3);
        if (b.active && b.py > 0.99 && b.py < 1.04 && b.speed() < 0.05) {
          stuck.push(
            `trial ${trial} at (${(b.px * 1000).toFixed(0)}, ${(b.py * 1000).toFixed(0)}) mm`,
          );
        }
      }
      expect(stuck).toEqual([]);
    },
  );
});
