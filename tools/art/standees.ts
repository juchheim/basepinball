/**
 * Standee atlas generator (docs/MVP/05 § 5.3): printed-acrylic player figures for the fielders,
 * pitcher, runner and catcher, in Tilt City Silverballs colours. 3 × 4 cells of 200 × 400 units;
 * the renderer cuts each cell out with alpha. Replace with assets-src/raster/standees.png
 * (same cell layout) for hand-drawn art.
 */

import { STANDEE_CELLS, STANDEE_GRID } from '../../src/render/standeeAtlas';

const NUM: Record<string, string> = {
  LF: '7',
  CF: '8',
  RF: '9',
  '3B': '5',
  SS: '6',
  '2B': '4',
  '1B': '3',
  P: '1',
  C: '2',
  RUNNER: '24',
};
const SKIN = [
  '#f1c7a3',
  '#d79b6e',
  '#a86b45',
  '#7a4a2c',
  '#e8b48c',
  '#5c3a24',
  '#c98b5c',
  '#f3d0b0',
  '#8d5636',
  '#b97a50',
];

const INK = '#0b1020';
const NAVY = '#1b2a4a';
const CREAM = '#f4efe1';
const SILVER = '#c9ced6';
const GOLD = '#f2b33d';
const LEATHER = '#8a5a2b';

function cap(cx: number, cy: number): string {
  return `<path d="M ${cx - 24} ${cy} Q ${cx} ${cy - 34} ${cx + 24} ${cy} Z" fill="${NAVY}" stroke="${INK}" stroke-width="3"/>
<path d="M ${cx - 6} ${cy} L ${cx + 36} ${cy + 4} L ${cx + 30} ${cy + 9} L ${cx - 6} ${cy + 7} Z" fill="${NAVY}" stroke="${INK}" stroke-width="3"/>
<text x="${cx}" y="${cy - 6}" font-size="13" text-anchor="middle" fill="${GOLD}" font-family="Oswald" font-weight="700">S</text>`;
}

function head(cx: number, cy: number, skin: string): string {
  return `<circle cx="${cx}" cy="${cy}" r="22" fill="${skin}" stroke="${INK}" stroke-width="3"/>${cap(cx, cy - 8)}`;
}

function jersey(x: number, y: number, w: number, h: number, num: string): string {
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="14" fill="${NAVY}" stroke="${INK}" stroke-width="3"/>
<path d="M ${x + w / 2} ${y + 4} L ${x + w / 2} ${y + h - 4}" stroke="${SILVER}" stroke-width="3"/>
<text x="${x + w / 2}" y="${y + h * 0.62}" font-size="${Math.min(30, w * 0.5)}" text-anchor="middle" fill="${CREAM}" stroke="${INK}" stroke-width="1" font-family="Oswald" font-weight="700">${num}</text>`;
}

function limb(points: [number, number][], width: number, color: string): string {
  const d = points.map(([x, y], i) => `${i ? 'L' : 'M'} ${x} ${y}`).join(' ');
  return `<path d="${d}" fill="none" stroke="${INK}" stroke-width="${width + 6}" stroke-linecap="round" stroke-linejoin="round"/>
<path d="${d}" fill="none" stroke="${color}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round"/>`;
}

function glove(x: number, y: number): string {
  return `<ellipse cx="${x}" cy="${y}" rx="20" ry="16" fill="${LEATHER}" stroke="${INK}" stroke-width="3"/>
<path d="M ${x - 10} ${y - 4} Q ${x} ${y + 6} ${x + 10} ${y - 4}" fill="none" stroke="${INK}" stroke-width="2"/>`;
}

function shoe(x: number, y: number): string {
  return `<ellipse cx="${x}" cy="${y}" rx="17" ry="8" fill="${INK}"/>`;
}

/** Fielder in a crouched ready stance, glove out front. Mirrored figures keep readable text. */
function fielder(num: string, skin: string, mirror: boolean): string {
  const limbs = `${limb(
    [
      [88, 250],
      [70, 310],
      [62, 372],
    ],
    22,
    CREAM,
  )}${limb(
    [
      [112, 250],
      [130, 310],
      [140, 372],
    ],
    22,
    CREAM,
  )}
${limb(
  [
    [66, 340],
    [62, 372],
  ],
  20,
  NAVY,
)}${limb(
    [
      [134, 340],
      [140, 372],
    ],
    20,
    NAVY,
  )}
${shoe(58, 380)}${shoe(146, 380)}
${limb(
  [
    [78, 175],
    [58, 220],
    [62, 262],
  ],
  18,
  NAVY,
)}${limb(
    [
      [122, 175],
      [140, 220],
      [134, 255],
    ],
    18,
    NAVY,
  )}
${glove(60, 268)}
<circle cx="134" cy="258" r="9" fill="${skin}" stroke="${INK}" stroke-width="3"/>`;
  // Only the pose is mirrored; the symmetric jersey and the head (cap logo) are drawn as-is.
  const pose = mirror ? `<g transform="translate(200 0) scale(-1 1)">${limbs}</g>` : limbs;
  return `${pose}${jersey(68, 160, 64, 104, num)}${head(100, 128, skin)}`;
}

function pitcher(skin: string): string {
  // Set position, leg kick, glove raised: the windup.
  return `${limb(
    [
      [96, 250],
      [92, 312],
      [96, 372],
    ],
    22,
    CREAM,
  )}${limb(
    [
      [108, 250],
      [140, 268],
      [158, 300],
    ],
    22,
    CREAM,
  )}
${limb(
  [
    [94, 340],
    [96, 372],
  ],
  20,
  NAVY,
)}${shoe(100, 380)}${shoe(166, 306)}
${limb(
  [
    [78, 176],
    [56, 150],
    [70, 120],
  ],
  18,
  NAVY,
)}${limb(
    [
      [122, 176],
      [150, 200],
      [168, 168],
    ],
    18,
    NAVY,
  )}
${jersey(68, 160, 64, 104, NUM.P!)}
${glove(72, 112)}
<circle cx="170" cy="160" r="10" fill="#ffffff" stroke="${INK}" stroke-width="3"/>
${head(100, 128, skin)}`;
}

function runner(skin: string): string {
  // Mid-stride, leaning into the run, helmet instead of cap.
  return `<g transform="rotate(-10 100 260)">
${limb(
  [
    [94, 250],
    [60, 300],
    [36, 340],
  ],
  22,
  CREAM,
)}${limb(
    [
      [106, 250],
      [128, 312],
      [150, 370],
    ],
    22,
    CREAM,
  )}
${shoe(30, 346)}${shoe(156, 378)}
${limb(
  [
    [78, 176],
    [48, 214],
    [40, 250],
  ],
  18,
  NAVY,
)}${limb(
    [
      [122, 176],
      [150, 150],
      [168, 120],
    ],
    18,
    NAVY,
  )}
${jersey(68, 160, 64, 104, NUM.RUNNER!)}
<circle cx="100" cy="128" r="22" fill="${skin}" stroke="${INK}" stroke-width="3"/>
<path d="M 74 126 Q 100 86 126 126 L 132 132 L 74 132 Z" fill="${NAVY}" stroke="${INK}" stroke-width="3"/>
</g>`;
}

function catcher(skin: string): string {
  // Squat behind the plate, mitt up, mask.
  return `${limb(
    [
      [84, 280],
      [52, 300],
      [62, 372],
    ],
    24,
    CREAM,
  )}${limb(
    [
      [116, 280],
      [148, 300],
      [138, 372],
    ],
    24,
    CREAM,
  )}
<rect x="76" y="282" width="48" height="60" rx="8" fill="${SILVER}" stroke="${INK}" stroke-width="3"/>
${shoe(58, 380)}${shoe(142, 380)}
${jersey(66, 190, 68, 100, NUM.C!)}
<rect x="76" y="196" width="48" height="70" rx="10" fill="${SILVER}" stroke="${INK}" stroke-width="3" opacity="0.9"/>
${limb(
  [
    [80, 210],
    [56, 214],
    [50, 180],
  ],
  18,
  NAVY,
)}
<circle cx="50" cy="170" r="24" fill="${LEATHER}" stroke="${INK}" stroke-width="3"/>
<circle cx="100" cy="160" r="22" fill="${skin}" stroke="${INK}" stroke-width="3"/>
<path d="M 82 152 L 118 152 M 82 164 L 118 164 M 90 142 L 90 176 M 110 142 L 110 176" stroke="${INK}" stroke-width="3"/>`;
}

function umpire(): string {
  // The punch-out call, in black.
  const skin = SKIN[6]!;
  return `${limb(
    [
      [88, 250],
      [80, 312],
      [78, 372],
    ],
    22,
    '#3a3f4a',
  )}${limb(
    [
      [112, 250],
      [122, 312],
      [126, 372],
    ],
    22,
    '#3a3f4a',
  )}
${shoe(74, 380)}${shoe(130, 380)}
<rect x="66" y="160" width="68" height="104" rx="14" fill="#121418" stroke="${INK}" stroke-width="3"/>
${limb(
  [
    [78, 176],
    [58, 220],
    [70, 262],
  ],
  18,
  '#121418',
)}${limb(
    [
      [122, 176],
      [158, 160],
      [176, 132],
    ],
    18,
    '#121418',
  )}
<circle cx="178" cy="126" r="11" fill="${skin}" stroke="${INK}" stroke-width="3"/>
<circle cx="100" cy="128" r="22" fill="${skin}" stroke="${INK}" stroke-width="3"/>
<path d="M 76 120 Q 100 92 124 120 L 130 124 L 76 124 Z" fill="#121418" stroke="${INK}" stroke-width="3"/>`;
}

export function standeeSvg(): string {
  const { cols, cellW, cellH, rows } = STANDEE_GRID;
  const cells = STANDEE_CELLS.map((name, i) => {
    const x = (i % cols) * cellW;
    const y = Math.floor(i / cols) * cellH;
    const skin = SKIN[i % SKIN.length]!;
    let art = '';
    if (name === 'P') art = pitcher(skin);
    else if (name === 'RUNNER') art = runner(skin);
    else if (name === 'C') art = catcher(skin);
    else if (name === 'UMP') art = umpire();
    else if (name !== 'SPARE') art = fielder(NUM[name]!, skin, i % 2 === 1);
    return `<g transform="translate(${x} ${y})">${art}</g>`;
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${cols * cellW} ${rows * cellH}" width="${cols * cellW}" height="${rows * cellH}">
<!-- Generated by tools/art/standees.ts. Cells (left to right, top to bottom): ${STANDEE_CELLS.join(', ')}. -->
${cells.join('\n')}
</svg>
`;
}
