/**
 * Table definition: the single source of truth for geometry, devices and switch IDs
 * (docs/MVP/04-technical-architecture.md § 5). Units are millimetres in playfield coordinates:
 * origin bottom-left, +x right, +y up the table, +z out of the playfield.
 */

import type { MaterialName } from '../physics/params';

export type Vec2 = readonly [number, number];
export type Vec3 = readonly [number, number, number];

export interface WallDef {
  type: 'wall';
  /** Polyline; consecutive points form wall segments. */
  points: readonly Vec2[];
  material: MaterialName;
  /** Half-thickness of the wall (mm). */
  radius?: number;
  height?: number;
}

export interface PostDef {
  type: 'post';
  x: number;
  y: number;
  radius: number;
  material: MaterialName;
  height?: number;
}

export interface SlingDef {
  type: 'sling';
  id: string;
  /** Triangle corners. The kicking face runs from `top` to `bottom`. */
  corner: Vec2;
  top: Vec2;
  bottom: Vec2;
}

export interface PopDef {
  type: 'pop';
  id: string;
  x: number;
  y: number;
  radius: number;
  /** Cap label and colour key for the renderer. */
  label?: string;
  color?: number;
  /** Kick speed (m/s) this bumper gives the ball; the physics parameter `popKickSpeed` if omitted. */
  kick?: number;
}

export interface SaucerDef {
  type: 'saucer';
  id: string;
  x: number;
  y: number;
  /** Rim radius (mm). */
  radius: number;
  depth: number;
  /** Direction (deg, from +x) from the dish centre to the rubber back lip. */
  lipAngle: number;
  /**
   * 'bar' (default): a straight rubber backstop, for saucers with closed space behind them.
   * 'post': a round rubber post, for saucers in the open where a bar would be a ledge.
   * 'none': no backstop (the saucer only catches balls that are already slow).
   */
  lip?: 'bar' | 'post' | 'none';
  /**
   * For 'post': its centre offset from the dish centre and radius (mm). Default: radius 8, just
   * behind the rim at `lipAngle`. Small, offset posts leave a ball-wide gap to their neighbours
   * on both sides, so nothing can wedge between them.
   */
  lipPost?: { dx: number; dy: number; radius: number };
  label?: string;
}

export interface DropTargetDef {
  type: 'drop';
  id: string;
  a: Vec2;
  b: Vec2;
  label?: string;
}

/** A stationary target: a rubber-faced plate with a switch. */
export interface StandupDef {
  type: 'standup';
  id: string;
  a: Vec2;
  b: Vec2;
  label?: string;
}

/** A kicking rubber that speeds the ball along its face (orbit corner kickers). */
export interface KickerDef {
  type: 'kicker';
  id: string;
  a: Vec2;
  b: Vec2;
}

/** A one-way gate across a lane. The ball may pass only in the `allow` direction (deg). */
export interface GateDef {
  type: 'gate';
  id: string;
  a: Vec2;
  b: Vec2;
  allow: number;
}

/** A spinner plate across a lane: spins when the ball passes underneath. */
export interface SpinnerDef {
  type: 'spinner';
  id: string;
  a: Vec2;
  b: Vec2;
}

/** A line switch (rollover, optical, ramp gate): fires when the ball centre crosses it. */
export interface SensorDef {
  type: 'sensor';
  id: string;
  a: Vec2;
  b: Vec2;
  /** Ball-centre height band (mm) in which the sensor sees the ball. */
  zMin?: number;
  zMax?: number;
}

/** A ramp: a floor following `path` (centre line, z = floor height) with side walls. */
export interface RampDef {
  type: 'ramp';
  id: string;
  path: readonly Vec3[];
  width: number;
  /** Width at the last path point; the ramp tapers linearly to centre the ball for a wireform. */
  endWidth?: number;
  wallHeight: number;
}

/** A wire ramp: four rails following `path`, the ball-centre line (z = ball centre height). */
export interface WireformDef {
  type: 'wireform';
  id: string;
  path: readonly Vec3[];
}

/** A raised hump in the playfield (the pitcher's mound). */
export interface DomeDef {
  type: 'dome';
  id: string;
  x: number;
  y: number;
  radius: number;
  height: number;
  /** If false the hump is drawn but the ball rolls straight over (no physics). */
  solid?: boolean;
}

export interface MagnetDef {
  type: 'magnet';
  id: string;
  x: number;
  y: number;
  /** Reach (mm). */
  radius: number;
}

export interface KickbackDef {
  type: 'kickback';
  id: string;
  /** Trigger zone (mm). */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** Kick direction (deg). */
  angle: number;
}

export interface PlungerDef {
  type: 'plunger';
  id: string;
  /** Shooter lane x-range and the plunger tip's y. */
  x0: number;
  x1: number;
  tipY: number;
}

export interface FlipperDef {
  type: 'flipper';
  id: string;
  side: 'left' | 'right';
  x: number;
  y: number;
  length: number;
  baseRadius: number;
  tipRadius: number;
  /** Rest angle (deg from +x). */
  restAngle: number;
  /** Stroke (deg), always positive. */
  stroke: number;
  height?: number;
}

/** A coloured insert lamp (whitebox stand-in for printed inserts). */
export interface LampDef {
  type: 'lamp';
  id: string;
  x: number;
  y: number;
  radius: number;
  color: number;
  /** Optional arrow direction (deg); omitted = round insert. */
  arrow?: number;
}

export type ElementDef =
  | WallDef
  | PostDef
  | SlingDef
  | PopDef
  | SaucerDef
  | DropTargetDef
  | StandupDef
  | KickerDef
  | GateDef
  | SpinnerDef
  | SensorDef
  | RampDef
  | WireformDef
  | DomeDef
  | MagnetDef
  | KickbackDef
  | PlungerDef
  | FlipperDef
  | LampDef;

export interface TableDef {
  name: string;
  width: number;
  length: number;
  /** Balls whose centre falls below this y (mm) drain. */
  drainY: number;
  /** Sandbox spawn point. */
  spawn: { x: number; y: number };
  /** Where the mound releases a pitch (mm). */
  pitchSpot?: { x: number; y: number };
  elements: readonly ElementDef[];
}
