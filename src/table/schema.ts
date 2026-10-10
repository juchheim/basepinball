/**
 * Table definition: the single source of truth for geometry, devices and switch IDs
 * (docs/MVP/04-technical-architecture.md § 5). Units are millimetres in playfield coordinates:
 * origin bottom-left, +x right, +y up the table, +z out of the playfield.
 */

import type { MaterialName } from '../physics/params';

export type Vec2 = readonly [number, number];

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
}

export interface DropTargetDef {
  type: 'drop';
  id: string;
  a: Vec2;
  b: Vec2;
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

export type ElementDef = WallDef | PostDef | SlingDef | PopDef | SaucerDef | DropTargetDef | FlipperDef;

export interface TableDef {
  name: string;
  width: number;
  length: number;
  /** Balls whose centre falls below this y (mm) drain. */
  drainY: number;
  spawn: { x: number; y: number };
  elements: readonly ElementDef[];
}
