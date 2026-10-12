/**
 * Geometry of the mound's ramp-and-bumper wedge (`RampBumperDef`), shared by the physics world
 * (colliders) and the table view (meshes) so what is drawn is what the ball hits. Units are mm.
 */

import { dcos, dsin } from '../core/dmath';
import type { RampBumperDef, Vec2, Vec3 } from './schema';

export type Tri = readonly [Vec3, Vec3, Vec3];

export interface RampBumperMesh {
  /** The ramp surface and the flat top. */
  top: Tri[];
  /** Skirts down to the playfield along the ramp's flanks (the rim in front of the centre line). */
  flank: Tri[];
  /** Skirts under the bumper face (the rim behind the centre line). */
  back: Tri[];
  /** The bumper face: the back half of the rim, as a polyline (the centre line of a thin wall). */
  arc: Vec2[];
}

const RINGS = 3;
/** Steps round the rim: even, so vertices land exactly on the centre line. */
const STEPS = 24;
/** The bumper wall's half-thickness (mm); the arc is inset by this much so its face is at the rim. */
export const FACE_RADIUS = 1;

export function rampBumperMesh(el: RampBumperDef): RampBumperMesh {
  const { x: cx, y: cy, radius: R, height: H } = el;
  const point = (r: number, j: number): Vec3 => {
    const a = (2 * Math.PI * j) / STEPS;
    const y = cy + r * dsin(a);
    // Rises linearly from the front rim to the centre line, then stays flat.
    const z = H * Math.min(1, Math.max(0, 1 + (y - cy) / R));
    return [cx + r * dcos(a), y, z];
  };
  const top: Tri[] = [];
  for (let j = 0; j < STEPS; j++) {
    top.push([[cx, cy, H], point(R / RINGS, j), point(R / RINGS, j + 1)]);
    for (let k = 2; k <= RINGS; k++) {
      const a0 = point((R * (k - 1)) / RINGS, j);
      const a1 = point((R * (k - 1)) / RINGS, j + 1);
      const b0 = point((R * k) / RINGS, j);
      const b1 = point((R * k) / RINGS, j + 1);
      top.push([a0, b0, b1], [a0, b1, a1]);
    }
  }
  const flank: Tri[] = [];
  const back: Tri[] = [];
  for (let j = 0; j < STEPS; j++) {
    const a = point(R, j);
    const b = point(R, j + 1);
    const out = j < STEPS / 2 ? back : flank;
    const down = (v: Vec3): Vec3 => [v[0], v[1], 0];
    if (b[2] > 1e-6) out.push([a, b, down(b)]);
    if (a[2] > 1e-6) out.push([a, down(b), down(a)]);
  }
  const arc: Vec2[] = [];
  for (let j = 0; j <= STEPS / 2; j++) {
    const p = point(R - FACE_RADIUS, j);
    arc.push([p[0], p[1]]);
  }
  return { top, flank, back, arc };
}
