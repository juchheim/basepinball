/**
 * Geometry of the mound's ramp-and-bumper (`RampBumperDef`), shared by the physics world
 * (colliders) and the table view (meshes) so what is drawn is what the ball hits. Units are mm.
 *
 * Seen from above it is a half disc: the straight edge (across the mound's middle) faces the
 * flippers, the arc faces the top of the table. The surface rises from the straight edge as a ramp
 * and then runs flat; its rim along the arc is a vertical wall, the bumper. A ball from the flippers
 * rides up the ramp and over the top; a ball from above or the sides meets the wall.
 */

import { dcos, dsin } from '../core/dmath';
import type { RampBumperDef, Vec2, Vec3 } from './schema';

export type Tri = readonly [Vec3, Vec3, Vec3];

/** One piece of the bumper wall: a segment (mm) and the wall's height there (mm). */
export interface WallPiece {
  a: Vec2;
  b: Vec2;
  height: number;
  /** Unit normal pointing out of the half disc. The wall acts only on a ball on that side. */
  nx: number;
  ny: number;
}

export interface RampBumperMesh {
  /** The ramp and the flat top. */
  top: Tri[];
  /** The wall's outer face, down to the playfield (drawn; the physics uses `wall`). */
  skirt: Tri[];
  /** The bumper wall, in short straight pieces along the arc. */
  wall: WallPiece[];
}

/** Steps round the arc (180 degrees), and rings out from the centre. */
const STEPS = 24;
const RINGS = 8;
/** The first part of the ramp (0-1) that curves in from the playfield instead of starting at a slope. */
const TOE = 0.35;
/** The ramp is this fraction of the radius long; the top is flat beyond it. */
const RAMP = 0.8;
/** The bumper wall's half-thickness (mm); the wall is inset by this much so its face is at the rim. */
export const FACE_RADIUS = 1;
/** Margin (mm) under the top: a ball riding over the top has its lowest point at the top height. */
export const WALL_CLEARANCE = 0.5;

/**
 * Height (0-1) at `u` (0 at the straight edge, 1 at the top of the ramp). It curves in from the
 * playfield over the first `TOE` and is straight after, so a fast ball meets no kink to bounce off.
 */
function profile(u: number): number {
  const x = Math.min(1, Math.max(0, u));
  const rise = x < TOE ? (x * x) / (2 * TOE) : x - TOE / 2;
  return rise / (1 - TOE / 2);
}

export function rampBumperMesh(el: RampBumperDef): RampBumperMesh {
  const { x: cx, y: cy, radius: R, height: H } = el;
  const rampLength = R * RAMP;
  const point = (r: number, j: number): Vec3 => {
    const a = (Math.PI * j) / STEPS;
    const x = cx + r * dcos(a);
    const y = cy + r * dsin(a);
    return [x, y, H * profile((y - cy) / rampLength)];
  };
  const top: Tri[] = [];
  for (let j = 0; j < STEPS; j++) {
    top.push([[cx, cy, 0], point(R / RINGS, j), point(R / RINGS, j + 1)]);
    for (let k = 2; k <= RINGS; k++) {
      const a0 = point((R * (k - 1)) / RINGS, j);
      const a1 = point((R * (k - 1)) / RINGS, j + 1);
      const b0 = point((R * k) / RINGS, j);
      const b1 = point((R * k) / RINGS, j + 1);
      top.push([a0, b0, b1], [a0, b1, a1]);
    }
  }
  const skirt: Tri[] = [];
  const wall: WallPiece[] = [];
  const down = (v: Vec3): Vec3 => [v[0], v[1], 0];
  for (let j = 0; j < STEPS; j++) {
    const a = point(R, j);
    const b = point(R, j + 1);
    if (b[2] > 1e-6) skirt.push([a, b, down(b)]);
    if (a[2] > 1e-6) skirt.push([a, down(b), down(a)]);
    const ia = point(R - FACE_RADIUS, j);
    const ib = point(R - FACE_RADIUS, j + 1);
    const height = (a[2] + b[2]) / 2 - WALL_CLEARANCE;
    // Where the wall is lower than the clearance the ball rolls over it.
    if (height > 0) {
      const mid = (Math.PI * (j + 0.5)) / STEPS;
      wall.push({ a: [ia[0], ia[1]], b: [ib[0], ib[1]], height, nx: dcos(mid), ny: dsin(mid) });
    }
  }
  return { top, skirt, wall };
}
