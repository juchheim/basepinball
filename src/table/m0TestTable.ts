import type { ElementDef, TableDef, Vec2 } from './schema';

/**
 * M0 physics test table: the lower half of the v1 playfield (flippers, slings, inlanes and
 * outlanes at their v1 positions) plus one of each device the spike must validate: a pop
 * bumper, a fielder saucer, a drop target and rubber posts. Coordinates in mm.
 */

const W = 550;
const mirror = (p: Vec2): Vec2 => [W - p[0], p[1]];
const mirrorAll = (pts: readonly Vec2[]): Vec2[] => pts.map(mirror);

/*
 * Lower-playfield geometry follows real tables: the outlane/inlane divider runs at the flipper's
 * rest angle and ends on top of the flipper base, so its surface continues into the flipper's top
 * surface and an inlane ball rolls straight onto the bat (no notch for it to stall in). The inlane
 * guide runs parallel above it, keeping the channel 34 mm wide (ball 27 mm) all the way down.
 */
const LANE_TOP = 380;
const divider: Vec2[] = [
  [40, LANE_TOP],
  [40, 264.5],
  // Ends at the bat's top tangent point, tucked over the base, so no dip is left between them.
  [179, 184.3],
];
const inlaneGuide: Vec2[] = [
  [88, LANE_TOP],
  [88, 280.7],
  [140, 250.6],
];
const topArc: Vec2[] = [
  [0, 600],
  [30, 660],
  [80, 705],
  [150, 738],
  [275, 755],
  [400, 738],
  [470, 705],
  [520, 660],
  [W, 600],
];

const elements: ElementDef[] = [
  // Cabinet walls.
  {
    type: 'wall',
    points: [
      [0, 0],
      [0, 600],
    ],
    material: 'wood',
    radius: 3,
  },
  {
    type: 'wall',
    points: [
      [W, 0],
      [W, 600],
    ],
    material: 'wood',
    radius: 3,
  },
  { type: 'wall', points: topArc, material: 'metal', radius: 3 },

  // Lanes.
  { type: 'wall', points: divider, material: 'metal' },
  { type: 'wall', points: mirrorAll(divider), material: 'metal' },
  { type: 'wall', points: inlaneGuide, material: 'metal' },
  { type: 'wall', points: mirrorAll(inlaneGuide), material: 'metal' },
  { type: 'post', x: 40, y: LANE_TOP, radius: 5, material: 'rubberPost' },
  { type: 'post', x: 88, y: LANE_TOP, radius: 5, material: 'rubberPost' },
  { type: 'post', x: W - 40, y: LANE_TOP, radius: 5, material: 'rubberPost' },
  { type: 'post', x: W - 88, y: LANE_TOP, radius: 5, material: 'rubberPost' },

  // Slingshots ("dugouts").
  { type: 'sling', id: 'sling.L', corner: [106, 280], top: [106, 372], bottom: [158, 251] },
  {
    type: 'sling',
    id: 'sling.R',
    corner: mirror([106, 280]),
    top: mirror([106, 372]),
    bottom: mirror([158, 251]),
  },

  // Flippers.
  {
    type: 'flipper',
    id: 'flipper.L',
    side: 'left',
    x: 175,
    y: 175,
    length: 80,
    baseRadius: 12,
    tipRadius: 7,
    restAngle: -30,
    stroke: 55,
  },
  {
    type: 'flipper',
    id: 'flipper.R',
    side: 'right',
    x: W - 175,
    y: 175,
    length: 80,
    baseRadius: 12,
    tipRadius: 7,
    restAngle: 210,
    stroke: 55,
  },

  // Devices under test.
  { type: 'pop', id: 'pop.1B.L', x: 330, y: 600, radius: 22 },
  {
    type: 'saucer',
    id: 'saucer.SS',
    x: 180,
    y: 480,
    radius: 20,
    depth: 7,
    lipAngle: 90,
    lip: 'post',
  },
  { type: 'drop', id: 'drop.B', a: [408.3, 479.4], b: [431.7, 460.6] },
  { type: 'post', x: 120, y: 600, radius: 8, material: 'rubberPost' },
  { type: 'post', x: 450, y: 640, radius: 8, material: 'rubberPost' },
];

export const m0TestTable: TableDef = {
  name: 'M0 physics test table',
  width: W,
  length: 760,
  drainY: 40,
  spawn: { x: 275, y: 700 },
  elements,
};
