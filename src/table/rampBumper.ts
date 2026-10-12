/**
 * Geometry of the mound's ramp-and-bumper wedge (`RampBumperDef`), shared by the physics world
 * (colliders) and the table view (meshes) so what is drawn is what the ball hits. Units are mm.
 *
 * Seen from above it is a disc. A flat top (radius `TOP_RADIUS`) is ringed by a cone that runs down
 * to the playfield at the rim, so a ball can ride up it from any side. Only across the back (the
 * side away from the flippers) does the top run out flat to the rim and stop at a vertical face:
 * that is the bumper. The face fades back into the cone over `TAPER` steps either side, so there is
 * never a step in the surface for a ball to bounce off.
 */

import { dcos, dsin } from '../core/dmath';
import type { RampBumperDef, Vec2, Vec3 } from './schema';

export type Tri = readonly [Vec3, Vec3, Vec3];

export interface RampBumperMesh {
  /** The cone and the flat top. */
  top: Tri[];
  /** Skirts down to the playfield along the rim, everywhere except under the bumper face. */
  flank: Tri[];
  /** Skirts under the bumper face (drawn; the physics uses `arc` there). */
  back: Tri[];
  /** The bumper face: the rim across the back, as a polyline (the centre line of a thin wall). */
  arc: Vec2[];
}

/** Steps round the rim, and the one straight behind the mound (+y). */
const STEPS = 48;
const BACK = STEPS / 4;
/** Steps either side of straight behind on which the top runs out flat to the rim (the face). */
const FACE = 3;
/** Steps over which the face fades into the cone, either side. */
const TAPER = 1;
/** Rings of the cone, and where the flat top ends (mm from the centre). */
const RINGS = 8;
/** The first part of the cone (0-1) that curves in from the playfield instead of starting at a slope. */
const TOE = 0.4;
const TOP_RADIUS = 10;
/** The bumper wall's half-thickness (mm); the arc is inset by this much so its face is at the rim. */
export const FACE_RADIUS = 1;

/** 1 across the face, falling to 0 over `TAPER` steps either side. */
function faceness(j: number): number {
  const off = Math.abs((((j - BACK) % STEPS) + STEPS + STEPS / 2) % STEPS) - STEPS / 2;
  return Math.min(1, Math.max(0, 1 - (Math.abs(off) - FACE) / TAPER));
}

/**
 * Height (0-1) at `t` (0 at the rim, 1 at the top). It curves in from the playfield over the first
 * `TOE` and is straight after, so a fast ball meets no kink at the bottom to bounce off.
 */
function profile(t: number): number {
  const rise = t < TOE ? (t * t) / (2 * TOE) : t - TOE / 2;
  return rise / (1 - TOE / 2);
}

export function rampBumperMesh(el: RampBumperDef): RampBumperMesh {
  const { x: cx, y: cy, radius: R, height: H } = el;
  const ri = Math.min(TOP_RADIUS, R / 2);
  const point = (r: number, j: number): Vec3 => {
    const a = (2 * Math.PI * j) / STEPS;
    const cone = profile(Math.min(1, Math.max(0, (R - r) / (R - ri))));
    return [cx + r * dcos(a), cy + r * dsin(a), H * Math.min(1, cone + faceness(j))];
  };
  const top: Tri[] = [];
  for (let j = 0; j < STEPS; j++) {
    top.push([[cx, cy, H], point(ri, j), point(ri, j + 1)]);
    for (let k = 1; k <= RINGS; k++) {
      const r0 = ri + ((R - ri) * (k - 1)) / RINGS;
      const r1 = ri + ((R - ri) * k) / RINGS;
      const a0 = point(r0, j);
      const a1 = point(r0, j + 1);
      const b0 = point(r1, j);
      const b1 = point(r1, j + 1);
      top.push([a0, b0, b1], [a0, b1, a1]);
    }
  }
  const flank: Tri[] = [];
  const back: Tri[] = [];
  for (let j = 0; j < STEPS; j++) {
    const a = point(R, j);
    const b = point(R, j + 1);
    const out = faceness(j) === 1 && faceness(j + 1) === 1 ? back : flank;
    const down = (v: Vec3): Vec3 => [v[0], v[1], 0];
    if (b[2] > 1e-6) out.push([a, b, down(b)]);
    if (a[2] > 1e-6) out.push([a, down(b), down(a)]);
  }
  const arc: Vec2[] = [];
  for (let j = BACK - FACE; j <= BACK + FACE; j++) {
    const p = point(R - FACE_RADIUS, j);
    arc.push([p[0], p[1]]);
  }
  return { top, flank, back, arc };
}
