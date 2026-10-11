import { dcos, dsin, DEG } from '../../src/core/dmath';
import { defaultParams, type PhysicsParams } from '../../src/physics/params';
import { World } from '../../src/physics/world';
import type { Flipper } from '../../src/physics/flipper';
import type { TableDef } from '../../src/table/schema';
import { m0TestTable } from '../../src/table/m0TestTable';

export function makeWorld(
  table: TableDef = m0TestTable,
  tweak?: (p: PhysicsParams) => void,
): World {
  const p = defaultParams();
  tweak?.(p);
  return new World(table, p);
}

export function runFor(world: World, seconds: number, each?: () => void): void {
  const steps = Math.round(seconds * world.params.rate);
  for (let i = 0; i < steps; i++) {
    world.step();
    each?.();
  }
}

export function flipper(world: World, id: string): Flipper {
  const f = world.flippers.find((x) => x.id === id);
  if (!f) throw new Error(`no flipper ${id}`);
  return f;
}

/** Point on the top surface of a flipper at fraction `s` of its length (m), ball resting on it. */
export function pointAbove(f: Flipper, s: number, ballRadius: number): { x: number; y: number } {
  const t = f.theta;
  const along = f.length * s;
  const cx = f.px + along * dcos(t);
  const cy = f.py + along * dsin(t);
  // Outward normal on the upper side of the bat.
  const r = f.baseRadius + (f.tipRadius - f.baseRadius) * s;
  const nAngle = t + f.dir * 90 * DEG;
  return {
    x: cx + (r + ballRadius + 0.0002) * dcos(nAngle),
    y: cy + (r + ballRadius + 0.0002) * dsin(nAngle),
  };
}

/** A table with nothing but a floor, for isolated collider tests (mm). */
export function emptyTable(elements: TableDef['elements']): TableDef {
  return {
    name: 'empty',
    width: 600,
    length: 800,
    drainY: -1000,
    spawn: { x: 300, y: 400 },
    elements,
  };
}
