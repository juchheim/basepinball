/**
 * Geometry of the mound's ramp-and-bumper (`RampBumperDef`), shared by the physics world
 * (colliders) and the table view (meshes) so what is drawn is what the ball hits. Units are mm.
 *
 * Seen from above it is a disc as wide as the mound. Its whole front half (the rim facing the
 * flippers, round to the sides) starts flush with the playfield and ramps up to a flat top; the
 * rim round the back is a vertical wall, the bumper. A ball coming up the table meets a ramp
 * wherever it touches the device, front or side, rides up and goes off over the back; a ball
 * coming down the table meets the wall.
 *
 * The surface height is set by the distance from the front rim, so the ramp is the same slope in
 * every direction and a ball touching the side of the disc rolls up it rather than hitting a step.
 * The back wall is full height across the middle and falls away toward the sides, where it meets
 * the side ramps.
 */

import { dcos, dsin } from '../core/dmath';
import type { RampBumperDef, Vec2, Vec3 } from './schema';

export type Tri = readonly [Vec3, Vec3, Vec3];

/** One piece of the bumper wall: a segment (mm) and the wall's height there (mm). */
export interface WallPiece {
  a: Vec2;
  b: Vec2;
  height: number;
  /** Unit normal pointing out of the disc. The wall acts only on a ball on that side. */
  nx: number;
  ny: number;
}

export interface RampBumperMesh {
  /** The ramp and the flat top. */
  top: Tri[];
  /** The wall's outer face, down to the playfield (drawn; the physics uses `wall`). */
  skirt: Tri[];
  /** The bumper wall, in short straight pieces along the back of the rim. */
  wall: WallPiece[];
}

/** Steps round the whole rim, and rings out from the centre. */
const STEPS = 48;
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
 * The wall stops where the rim is lower than this (mm). A lower step is one the ball climbs (the
 * ramp's edge lifts it), not a wall to bounce off, so toward the sides the back is ramp too.
 */
const MIN_WALL = 3;

/**
 * Height (0-1) at `u` (0 at the front rim, 1 at the top of the ramp). It curves in from the
 * playfield over the first `TOE` and is straight after, so a fast ball meets no kink to bounce off.
 */
function profile(u: number): number {
  const x = Math.min(1, Math.max(0, u));
  const rise = x < TOE ? (x * x) / (2 * TOE) : x - TOE / 2;
  return rise / (1 - TOE / 2);
}

/**
 * Distance (mm) from a point (dx, dy from the centre, inside the disc) to the front rim: the half
 * of the rim with dy <= 0. In the front half that is straight out to the rim; in the back half the
 * nearest point of the front rim is one of its two ends, (±radius, 0).
 */
function fromFront(dx: number, dy: number, radius: number): number {
  if (dy <= 0) return Math.max(0, radius - Math.sqrt(dx * dx + dy * dy));
  const ex = radius - Math.abs(dx);
  return Math.sqrt(ex * ex + dy * dy);
}

export function rampBumperMesh(el: RampBumperDef): RampBumperMesh {
  const { x: cx, y: cy, radius: R, height: H } = el;
  const rampLength = R * RAMP;
  // j = 0 points down the table (toward the flippers); j = STEPS / 2 points up it.
  const point = (r: number, j: number): Vec3 => {
    const a = -Math.PI / 2 + (2 * Math.PI * j) / STEPS;
    const dx = r * dcos(a);
    const dy = r * dsin(a);
    return [cx + dx, cy + dy, H * profile(fromFront(dx, dy, R) / rampLength)];
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
  const skirt: Tri[] = [];
  const wall: WallPiece[] = [];
  const down = (v: Vec3): Vec3 => [v[0], v[1], 0];
  for (let j = 0; j < STEPS; j++) {
    const a = point(R, j);
    const b = point(R, j + 1);
    const ia = point(R - FACE_RADIUS, j);
    const ib = point(R - FACE_RADIUS, j + 1);
    const rim = (a[2] + b[2]) / 2;
    if (rim < MIN_WALL) continue;
    skirt.push([a, b, down(b)], [a, down(b), down(a)]);
    const mid = -Math.PI / 2 + (2 * Math.PI * (j + 0.5)) / STEPS;
    wall.push({
      a: [ia[0], ia[1]],
      b: [ib[0], ib[1]],
      height: rim - WALL_CLEARANCE,
      nx: dcos(mid),
      ny: dsin(mid),
    });
  }
  return { top, skirt, wall };
}
