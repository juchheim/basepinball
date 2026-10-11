import { describe, expect, it } from 'vitest';
import { Rng } from '../../src/core/rng';
import { rampEdges } from '../../src/physics/world';
import type { TableDef } from '../../src/table/schema';
import { m0TestTable } from '../../src/table/m0TestTable';
import { v1Table } from '../../src/table/v1Table';
import { makeWorld } from './helpers';

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
});
