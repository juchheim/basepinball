import { dcos, dsin } from '../core/dmath';
import type { ElementDef, TableDef, Vec2, Vec3 } from './schema';

/**
 * The BasePinball v1 table (docs/MVP/02-playfield-design.md), whitebox geometry for M1.
 * Millimetres, playfield coordinates. Left/right features are mirrored about the playable
 * centre line (x = 275); the shooter lane is x 550-590.
 */

const W = 550; // playable width
const FULL_W = 590;
const L = 1170;
const mx = (x: number): number => W - x;
const m2 = (p: Vec2): Vec2 => [mx(p[0]), p[1]];
const m3 = (p: Vec3): Vec3 => [mx(p[0]), p[1], p[2]];

// ---------------------------------------------------------------- outer shape

/** Top arch: half-ellipse over the full cabinet width, from y = 1000 to the top. */
function arch(): Vec2[] {
  const pts: Vec2[] = [];
  const cx = FULL_W / 2;
  const rx = FULL_W / 2;
  const ry = L - 1000;
  for (let i = 0; i <= 24; i++) {
    const t = Math.PI - (i / 24) * Math.PI;
    pts.push([round(cx + rx * dcos(t)), round(1000 + ry * dsin(t))]);
  }
  return pts;
}

/** Quadratic Bézier sampled as a polyline. */
function quad(a: Vec2, c: Vec2, b: Vec2, n = 8): Vec2[] {
  const pts: Vec2[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const u = 1 - t;
    pts.push([
      round(u * u * a[0] + 2 * u * t * c[0] + t * t * b[0]),
      round(u * u * a[1] + 2 * u * t * c[1] + t * t * b[1]),
    ]);
  }
  return pts;
}

/**
 * A kicker following the arch between two angles (deg on the arch ellipse), set 1 mm inside it so
 * it is the surface the ball rides on through the corner.
 */
function cornerKicker(id: string, fromDeg: number, toDeg: number): ElementDef[] {
  const cx = FULL_W / 2;
  const rx = FULL_W / 2 - 3.5;
  const ry = L - 1000 - 3.5;
  const pt = (deg: number): Vec2 => {
    const t = (deg * Math.PI) / 180;
    return [round(cx + rx * dcos(t)), round(1000 + ry * dsin(t))];
  };
  const out: ElementDef[] = [];
  const steps = 3;
  for (let i = 0; i < steps; i++) {
    const a = fromDeg + ((toDeg - fromDeg) * i) / steps;
    const b = fromDeg + ((toDeg - fromDeg) * (i + 1)) / steps;
    out.push({ type: 'kicker', id, a: pt(a), b: pt(b) });
  }
  return out;
}

function round(v: number): number {
  return Math.round(v * 10) / 10;
}

const ORBIT_MOUTH = 700;
const leftInnerGuide: Vec2[] = [[45, ORBIT_MOUTH], ...quad([45, 910], [45, 1060], [165, 1090])];
/**
 * Orbit funnel: below each orbit mouth the outer wall angles toward the centre, so a ball coming
 * back down an orbit is steered into play instead of running down the side wall, and upward
 * shots are guided into the lane.
 */
const leftFunnel: Vec2[] = [
  [0, 690],
  [60, 590],
];

// ---------------------------------------------------------------- lower playfield (from M0)

const LANE_TOP = 380;
const divider: Vec2[] = [
  [40, LANE_TOP],
  [40, 264.5],
  [179, 184.3],
];
const inlaneGuide: Vec2[] = [
  [88, LANE_TOP],
  [88, 280.7],
  [140, 250.6],
];

// ---------------------------------------------------------------- ramps & wireforms

/** Left ramp "Over the Wall" (HR): floor centre line, z = floor height. */
const hrRamp: Vec3[] = [
  [142, 790, 0],
  [136, 825, 6],
  [128, 862, 15],
  [120, 900, 26],
  [113, 940, 37],
  // Rounded crest: the slope eases off (13° → 4°) so the ball does not launch off the top.
  [107, 975, 45.5],
  [103, 1000, 50.5],
  [101, 1018, 53],
  [100, 1032, 54],
];

/**
 * HR wireform: ball-centre path from the ramp crest, round a 39 mm-radius U-turn (tighter turns
 * pinch the inner rails), then down the left side. It descends all the way, so a ball that
 * makes the crest always comes home to the left inlane.
 */
const U_CENTER: Vec2 = [61, 1030];
const U_RADIUS = 39;
// Heights fall steadily all the way round: counting the playfield slope, every point is lower
// than the one before it, so no ball can stall in the turn.
const U_POINTS: [number, number][] = [
  [20, 64.8],
  [45, 62.8],
  [70, 61.4],
  [90, 60.8],
  [110, 60.4],
  [135, 59.6],
  [160, 58.6],
];
const hrWire: Vec3[] = [
  [100, 1024, 67.5],
  ...U_POINTS.map(([deg, z]): Vec3 => {
    const t = (deg * Math.PI) / 180;
    return [round(U_CENTER[0] + U_RADIUS * dcos(t)), round(U_CENTER[1] + U_RADIUS * dsin(t)), z];
  }),
  [22, 1010, 57.5],
  [22, 900, 55],
  [22, 800, 54],
  [22, 700, 53],
  [22, 600, 52],
  [22, 480, 51],
  [27, 445, 50.5],
  [42, 428, 50],
  [56, 414, 49.5],
  [63, 401, 49],
  [64, 392, 48],
];

const RAMP_WIDTH = 52;
/**
 * The Steal ramp's mouth is clearly wider than the home-run ramp's, so the cheaper award is the
 * easier shot (a ball must enter within roughly mouth - 44 mm of the centre line: 8 mm of play on
 * the HR ramp, about 26 mm here). The 2B and RF fielders sit 20 mm further down the table than
 * SS and LF to make room: each mouth guard post then keeps a ball-wide (>= 27.5 mm) gap to their
 * glove posts, so no notch can hold a ball.
 */
const STEAL_RAMP_WIDTH = 70;

const fieldSaucer = (
  id: string,
  label: string,
  x: number,
  y: number,
  lipAngle = 90,
  lip: 'bar' | 'post' | 'none' = 'bar',
  lipPost?: { dx: number; dy: number; radius: number },
): ElementDef => ({
  type: 'saucer',
  id,
  label,
  x,
  y,
  radius: 20,
  depth: 7,
  lipAngle,
  lip,
  ...(lipPost ? { lipPost } : {}),
});

/** Drop target / standup plate centred at (x, y), facing `toward`. */
function plate(x: number, y: number, toward: Vec2, half = 13): [Vec2, Vec2] {
  const dx = toward[0] - x;
  const dy = toward[1] - y;
  const len = Math.sqrt(dx * dx + dy * dy);
  const tx = (-dy / len) * half;
  const ty = (dx / len) * half;
  return [
    [round(x - tx), round(y - ty)],
    [round(x + tx), round(y + ty)],
  ];
}

const leftFlipperPivot: Vec2 = [175, 175];
const rightFlipperPivot: Vec2 = [mx(175), 175];

const bat = ['B', 'A', 'T'];
const walk = ['W', 'A', 'L', 'K'];

/**
 * Side-wall 3-target banks below the orbit funnels, facing the far flipper. Shots to them clear
 * the slingshots and never cross the main shot lines. The three plates sit end to end on one
 * line (a continuous face, like a real bank) with a backstop behind, so there are no notches for
 * a ball to rest in and a dropped target only reveals the backstop. (M1 whitebox history:
 * free-standing banks in the mid-field blocked the ramp and orbit shots; wall targets under an
 * orbit exit trapped returning balls; staggered plates left notches.)
 */
const PLATE = 26;
function sideBank(
  start: Vec2,
  toward: Vec2,
  count = 3,
  plate = PLATE,
): { centers: Vec2[]; backstop: [Vec2, Vec2]; behind: Vec2 } {
  const dx = toward[0] - start[0];
  const dy = toward[1] - start[1];
  const len = Math.sqrt(dx * dx + dy * dy);
  const fx = dx / len;
  const fy = dy / len;
  // Bank runs perpendicular to the facing direction, away from the wall and up the table.
  const sgn = fx > 0 ? 1 : -1;
  const tx = -fy * sgn;
  const ty = fx * sgn;
  const at = (k: number): Vec2 => [round(start[0] + tx * k), round(start[1] + ty * k)];
  const back = (p: Vec2): Vec2 => [round(p[0] - fx * 7), round(p[1] - fy * 7)];
  return {
    centers: Array.from({ length: count }, (_, i) => at(plate * (i + 0.5))),
    backstop: [back(at(0)), back(at(plate * count))],
    /** Unit vector pointing away from the face (toward the wall / backstop side). */
    behind: [round(-fx * 1000) / 1000, round(-fy * 1000) / 1000],
  };
}
const BAT_BANK = sideBank([5.5, 520], rightFlipperPivot);
/**
 * W-A-L-K: four full-size standups standing out in the open at the lower right, facing the left
 * flipper. On the wall (first beside the right funnel, then flush from y = 520) the middle letters
 * were almost unreachable from the paddles: a sweep of flip timings reached the bank 8 % of the
 * time, with A and L starved (3-5 hits each). Out here it is reached about 19 % of the time, every
 * letter 9-17 times in 248 flips, and the steal ramp, HR ramp and orbit shots are untouched
 * (position chosen by sweeping layouts in the simulation; see docs/MVP/02 (the W-A-L-K section).
 */
const WALK_BANK = sideBank([482, 445], leftFlipperPivot, walk.length);
/**
 * The bank runs from the lower right up to the upper left, so as the player looks at the board it
 * reads right to left. The letters go the other way round: W is the plate at the left end, K the
 * one at the right, so WALK reads left to right.
 */
const WALK_CENTERS = [...WALK_BANK.centers].reverse();

const LAMP = {
  amber: 0xff9f1c,
  red: 0xff3b3b,
  ivory: 0xf4efe1,
  blue: 0x3d8bfd,
  teal: 0x2ec4b6,
  gold: 0xf2b33d,
  violet: 0x9b5de5,
  mint: 0x7bd88f,
  white: 0xffffff,
};

const elements: ElementDef[] = [
  // ---- cabinet
  {
    type: 'wall',
    points: [
      [0, 0],
      [0, 1000],
    ],
    material: 'wood',
    radius: 3,
  },
  {
    type: 'wall',
    points: [
      [FULL_W, 0],
      [FULL_W, 1000],
    ],
    material: 'wood',
    radius: 3,
  },
  { type: 'wall', points: arch(), material: 'metal', radius: 3 },
  // Shooter lane separator (also the right orbit's outer wall) and its one-way exit gate.
  {
    type: 'wall',
    points: [
      [W, 0],
      [W, 990],
    ],
    material: 'metal',
    radius: 2,
  },
  // Sloped one-way exit gate: plunged balls pass up through it; balls coming back down the arch
  // roll off it into the right orbit.
  { type: 'gate', id: 'gate.shooter', a: [W, 990], b: [FULL_W, 1040], allow: 141.3 },
  { type: 'plunger', id: 'plunger', x0: W + 2, x1: FULL_W - 2, tipY: 40 },
  { type: 'sensor', id: 'sw.shooter', a: [W + 2, 900], b: [FULL_W - 2, 900] },

  // ---- orbits
  { type: 'wall', points: leftInnerGuide, material: 'metal' },
  { type: 'wall', points: leftInnerGuide.map(m2), material: 'metal' },
  { type: 'post', x: 45, y: ORBIT_MOUTH, radius: 4, material: 'rubberPost' },
  { type: 'post', x: mx(45), y: ORBIT_MOUTH, radius: 4, material: 'rubberPost' },
  { type: 'wall', points: leftFunnel, material: 'metal' },
  { type: 'wall', points: leftFunnel.map(m2), material: 'metal' },
  { type: 'post', x: 60, y: 590, radius: 5, material: 'rubberPost' },
  { type: 'post', x: mx(60), y: 590, radius: 5, material: 'rubberPost' },
  // Close the dead space under each ramp from the top area.
  {
    type: 'wall',
    points: [
      [165, 1090],
      [185, 1050],
    ],
    material: 'metal',
  },
  { type: 'wall', points: [m2([165, 1090]), m2([185, 1050])], material: 'metal' },
  { type: 'spinner', id: 'spinner.L', a: [3, 800], b: [42, 800] },
  { type: 'spinner', id: 'spinner.R', a: [mx(42), 800], b: [mx(3), 800] },
  { type: 'sensor', id: 'orbit.L', a: [3, 740], b: [42, 740] },
  { type: 'sensor', id: 'orbit.R', a: [mx(42), 740], b: [mx(3), 740] },
  // Corner kickers (triples): flush with the arch where each orbit's ball meets it. Not mirror
  // images: the right orbit lane sits inside the shooter lane, so it meets the arch further in.
  ...cornerKicker('kicker.3B.L', 148, 163),
  ...cornerKicker('kicker.3B.R', 44, 30),

  // ---- top lanes R-B-I (low enough that the orbit loop clears the guide tops by 30 mm)
  ...[221, 257, 293, 329].flatMap((x): ElementDef[] => [
    {
      type: 'wall',
      points: [
        [x, 1060],
        [x, 1100],
      ],
      material: 'metal',
    },
    { type: 'post', x, y: 1100, radius: 4, material: 'metal' },
    { type: 'post', x, y: 1060, radius: 3, material: 'metal' },
  ]),
  { type: 'sensor', id: 'lane.R', a: [223, 1080], b: [255, 1080] },
  { type: 'sensor', id: 'lane.B', a: [259, 1080], b: [291, 1080] },
  { type: 'sensor', id: 'lane.I', a: [295, 1080], b: [327, 1080] },

  // ---- the Gap (pop nest)
  // The nest's back walls slope down into the top-lane opening, so nothing can rest on them.
  {
    type: 'wall',
    points: [
      [240, 805],
      [185, 880],
      [185, 1050],
      [218, 1018],
    ],
    material: 'metal',
  },
  {
    type: 'wall',
    points: [m2([240, 805]), m2([185, 880]), m2([185, 1050]), m2([218, 1018])],
    material: 'metal',
  },
  { type: 'post', x: 240, y: 805, radius: 5, material: 'rubberPost' },
  { type: 'post', x: mx(240), y: 805, radius: 5, material: 'rubberPost' },
  // "Hit it up the middle": two singles flank a 40 mm centre channel; a ball threading it skims
  // over CF and meets a double at the back. A weak ball in the channel drops into CF instead.
  { type: 'pop', id: 'pop.1B.L', x: 233, y: 868, radius: 22, label: '1B', color: LAMP.ivory },
  { type: 'pop', id: 'pop.1B.R', x: 317, y: 868, radius: 22, label: '1B', color: LAMP.ivory },
  { type: 'pop', id: 'pop.2B.L', x: 247, y: 992, radius: 20, label: '2B', color: LAMP.blue },
  { type: 'pop', id: 'pop.2B.R', x: 303, y: 992, radius: 20, label: '2B', color: LAMP.blue },
  { type: 'sensor', id: 'gap.mouth', a: [242, 815], b: [308, 815] },

  // ---- outfield bumpers: somewhere for the ball to bang around besides the Gap. They score no hit
  // of their own; they feed the HUSTLE meter (docs/MVP/02, "Bumpers that matter"). A mirror-
  // symmetric pair (so the board looks balanced), placed by sweeping symmetric layouts in the
  // simulation for the one that leaves every important shot at its original count: the ramps, the
  // Gap, the orbits and the W-A-L-K bank are unchanged, and 30 % of flipper shots touch one.
  {
    type: 'pop',
    id: 'pop.OF.L',
    x: 105,
    y: 660,
    radius: 17,
    label: 'OF',
    color: LAMP.mint,
    kick: 0.8,
  },
  {
    type: 'pop',
    id: 'pop.OF.R',
    x: mx(105),
    y: 660,
    radius: 17,
    label: 'OF',
    color: LAMP.mint,
    kick: 0.8,
  },

  // ---- fielders (7 saucers)
  fieldSaucer('saucer.3B', '3B', 25, 478, 180),
  fieldSaucer('saucer.LF', 'LF', 85, 750, 90, 'post', { dx: -4, dy: 20, radius: 5 }),
  fieldSaucer('saucer.SS', 'SS', 200, 765, 90, 'post', { dx: 4, dy: 25, radius: 5 }),
  fieldSaucer('saucer.CF', 'CF', 275, 918, 90, 'none'),
  fieldSaucer('saucer.2B', '2B', 348, 745, 90, 'post', { dx: -6, dy: 25, radius: 5 }),
  fieldSaucer('saucer.RF', 'RF', 465, 730, 90, 'post', { dx: 6, dy: 20, radius: 5 }),
  fieldSaucer('saucer.1B', '1B', mx(25), 478, 0),

  // ---- ramps
  { type: 'ramp', id: 'ramp.HR', path: hrRamp, width: RAMP_WIDTH, endWidth: 32, wallHeight: 40 },
  { type: 'wireform', id: 'wire.HR', path: hrWire },
  { type: 'sensor', id: 'gate.HR', a: [76, 1015], b: [128, 1021], zMin: 50, zMax: 90 },
  {
    type: 'ramp',
    id: 'ramp.STEAL',
    path: hrRamp.map(m3),
    width: STEAL_RAMP_WIDTH,
    endWidth: 32,
    wallHeight: 40,
  },
  { type: 'wireform', id: 'wire.STEAL', path: hrWire.map(m3) },
  { type: 'sensor', id: 'gate.STEAL', a: [mx(128), 1021], b: [mx(76), 1015], zMin: 50, zMax: 90 },
  // Posts guarding the ramp entrance corners.
  { type: 'post', x: 117, y: 782, radius: 4, material: 'metal' },
  { type: 'post', x: 167, y: 798, radius: 4, material: 'metal' },
  { type: 'post', x: 408 + STEAL_RAMP_WIDTH / 2, y: 782, radius: 4, material: 'metal' },
  { type: 'post', x: 408 - STEAL_RAMP_WIDTH / 2, y: 798, radius: 4, material: 'metal' },

  // ---- target banks: B-A-T drops (left wall), W-A-L-K standups (out in the open, lower right)
  ...BAT_BANK.centers.map(([x, y], i): ElementDef => {
    const [a, b] = plate(x, y, rightFlipperPivot);
    return { type: 'drop', id: `drop.${bat[i]}`, a, b, label: bat[i]! };
  }),
  { type: 'wall', points: BAT_BANK.backstop, material: 'rubberPost', radius: 2 },
  ...WALK_CENTERS.map(([x, y], i): ElementDef => {
    const [a, b] = plate(x, y, leftFlipperPivot);
    return { type: 'standup', id: `standup.${walk[i]}`, a, b, label: walk[i]! };
  }),
  { type: 'wall', points: WALK_BANK.backstop, material: 'rubberPost', radius: 2 },

  // ---- mound
  // The mound and pitcher are visual only: in M1 testing both knocked centre shots off line.
  { type: 'dome', id: 'mound', x: 275, y: 355, radius: 30, height: 4, solid: false },
  { type: 'magnet', id: 'magnet.curve', x: 275, y: 270, radius: 60 },

  // ---- lower playfield
  { type: 'wall', points: divider, material: 'metal' },
  { type: 'wall', points: divider.map(m2), material: 'metal' },
  { type: 'wall', points: inlaneGuide, material: 'metal' },
  { type: 'wall', points: inlaneGuide.map(m2), material: 'metal' },
  { type: 'post', x: 40, y: LANE_TOP, radius: 5, material: 'rubberPost' },
  { type: 'post', x: 88, y: LANE_TOP, radius: 5, material: 'rubberPost' },
  { type: 'post', x: mx(40), y: LANE_TOP, radius: 5, material: 'rubberPost' },
  { type: 'post', x: mx(88), y: LANE_TOP, radius: 5, material: 'rubberPost' },
  // Cap joining the inlane-guide post to the slingshot's top post (no V for a ball to sit in).
  {
    type: 'wall',
    points: [
      [88, LANE_TOP],
      [106, 372],
    ],
    material: 'rubberPost',
    radius: 5,
  },
  { type: 'wall', points: [m2([88, LANE_TOP]), m2([106, 372])], material: 'rubberPost', radius: 5 },
  { type: 'sensor', id: 'outlane.L', a: [3, 300], b: [37, 300] },
  { type: 'sensor', id: 'inlane.L', a: [43, 300], b: [85, 300] },
  { type: 'sensor', id: 'inlane.R', a: [mx(85), 300], b: [mx(43), 300] },
  { type: 'sensor', id: 'outlane.R', a: [mx(37), 300], b: [mx(3), 300] },
  { type: 'kickback', id: 'kickback.L', x0: 0, y0: 60, x1: 40, y1: 140, angle: 90 },
  { type: 'sling', id: 'sling.L', corner: [106, 280], top: [106, 372], bottom: [158, 251] },
  {
    type: 'sling',
    id: 'sling.R',
    corner: m2([106, 280]),
    top: m2([106, 372]),
    bottom: m2([158, 251]),
  },
  {
    type: 'flipper',
    id: 'flipper.L',
    side: 'left',
    x: leftFlipperPivot[0],
    y: leftFlipperPivot[1],
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
    x: rightFlipperPivot[0],
    y: rightFlipperPivot[1],
    length: 80,
    baseRadius: 12,
    tipRadius: 7,
    restAngle: 210,
    stroke: 55,
  },

  // ---- whitebox lamps (coloured discs standing in for printed inserts)
  { type: 'lamp', id: 'arrow.orbit.L', x: 24, y: 745, radius: 12, color: LAMP.amber, arrow: 90 },
  { type: 'lamp', id: 'arrow.ramp.HR', x: 176, y: 676, radius: 12, color: LAMP.red, arrow: 100 },
  { type: 'lamp', id: 'arrow.gap', x: 275, y: 665, radius: 12, color: LAMP.ivory, arrow: 90 },
  {
    type: 'lamp',
    id: 'arrow.ramp.STEAL',
    x: mx(176),
    y: 676,
    radius: 12,
    color: LAMP.teal,
    arrow: 80,
  },
  {
    type: 'lamp',
    id: 'arrow.orbit.R',
    x: mx(24),
    y: 745,
    radius: 12,
    color: LAMP.amber,
    arrow: 90,
  },
  ...[0, 1, 2, 3, 4].map((i): ElementDef => ({
    type: 'lamp',
    id: `rally.${i + 1}`,
    x: 243 + i * 16,
    y: 580,
    radius: 5,
    color: LAMP.gold,
  })),
  // The HUSTLE meter: five lamps, each worth two bumper hits.
  ...[0, 1, 2, 3, 4].map((i): ElementDef => ({
    type: 'lamp',
    id: `hustle.${i + 1}`,
    x: 243 + i * 16,
    y: 612,
    radius: 5,
    color: LAMP.mint,
  })),
  { type: 'lamp', id: 'base.1B', x: 400, y: 355, radius: 9, color: LAMP.white },
  { type: 'lamp', id: 'base.2B', x: 275, y: 480, radius: 9, color: LAMP.white },
  { type: 'lamp', id: 'base.3B', x: 150, y: 355, radius: 9, color: LAMP.white },
  { type: 'lamp', id: 'base.home', x: 275, y: 230, radius: 9, color: LAMP.white },
  { type: 'lamp', id: 'pitch.FB', x: 255, y: 318, radius: 5, color: LAMP.red },
  { type: 'lamp', id: 'pitch.CH', x: 275, y: 312, radius: 5, color: LAMP.gold },
  { type: 'lamp', id: 'pitch.CB', x: 295, y: 318, radius: 5, color: LAMP.blue },
  { type: 'lamp', id: 'lamp.lane.R', x: 239, y: 1044, radius: 6, color: LAMP.gold },
  { type: 'lamp', id: 'lamp.lane.B', x: 275, y: 1044, radius: 6, color: LAMP.gold },
  { type: 'lamp', id: 'lamp.lane.I', x: 311, y: 1044, radius: 6, color: LAMP.gold },
  ...BAT_BANK.centers.map(([x, y], i): ElementDef => ({
    type: 'lamp',
    id: `lamp.drop.${bat[i]}`,
    x: x + 26,
    y: y - 22,
    radius: 6,
    color: LAMP.gold,
  })),
  ...WALK_CENTERS.map(([x, y], i): ElementDef => ({
    type: 'lamp',
    id: `lamp.standup.${walk[i]}`,
    // Behind the bank, so the letters read from the flippers' side.
    x: round(x + WALK_BANK.behind[0] * 17),
    y: round(y + WALK_BANK.behind[1] * 17),
    radius: 6,
    color: LAMP.violet,
  })),
  { type: 'lamp', id: 'lamp.hotbat', x: 95, y: 520, radius: 8, color: LAMP.red },
  { type: 'lamp', id: 'lamp.kickback', x: 20, y: 170, radius: 6, color: LAMP.gold },
];

export const v1Table: TableDef = {
  name: 'BasePinball v1 (whitebox)',
  width: FULL_W,
  length: L,
  drainY: 40,
  spawn: { x: 275, y: 650 },
  pitchSpot: { x: 275, y: 345 },
  elements,
};
