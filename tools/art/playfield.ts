/**
 * Playfield art generator (docs/MVP/05 § 5). Builds the printed playfield as SVG from the table
 * definition, so every lane, saucer and insert lines up with the geometry. The output
 * (assets-src/svg/playfield.base.svg) is the editable vector source; a PNG dropped into
 * assets-src/raster/playfield.base.png replaces it entirely.
 *
 * Style: a ballpark at night under lights, printed on a pinball playfield.
 */
import type { ElementDef, LampDef, SaucerDef, TableDef } from '../../src/table/schema';

/**
 * Re-tune a '#rrggbb' colour in HSL: scale its lightness and saturation. The field colours below
 * use it so the whole ballpark can be made a little darker and richer in one place (playtest
 * feedback: darker, more saturated field, so the ball's spotlight and the lamps stand out).
 */
function tune(hex: string, lightness: number, saturation: number): string {
  const n = parseInt(hex.slice(1), 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;
  const d = max - min;
  if (d > 0) {
    s = d / (1 - Math.abs(2 * l - 1));
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  const l2 = Math.min(1, l * lightness);
  const s2 = Math.min(1, s * saturation);
  const c = (1 - Math.abs(2 * l2 - 1)) * s2;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l2 - c / 2;
  const [r1, g1, b1] =
    h < 60
      ? [c, x, 0]
      : h < 120
        ? [x, c, 0]
        : h < 180
          ? [0, c, x]
          : h < 240
            ? [0, x, c]
            : h < 300
              ? [x, 0, c]
              : [c, 0, x];
  const to = (v: number): string =>
    Math.round((v + m) * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${to(r1)}${to(g1)}${to(b1)}`;
}

/** The field: about 12 % darker and 30 % more saturated than the first pass. */
const FIELD = { lightness: 0.88, saturation: 1.3 };

/**
 * Grass is a deep emerald (a little blue in the green, as turf looks under metal-halide lights)
 * and the clay a red-brown rather than orange, so the renderer's richer grade keeps them natural.
 */
const C = {
  grassDark: tune('#15452a', FIELD.lightness, FIELD.saturation),
  grass: tune('#22663a', FIELD.lightness, FIELD.saturation),
  grassLight: tune('#2f7a47', FIELD.lightness, FIELD.saturation),
  dirt: tune('#9c5634', FIELD.lightness, FIELD.saturation),
  dirtDark: tune('#6c3a22', FIELD.lightness, FIELD.saturation),
  chalk: '#f7f4ec',
  track: tune('#7e4a30', FIELD.lightness, FIELD.saturation),
  navy: '#1b2a4a',
  gold: '#f2b33d',
  red: '#ff3b3b',
  teal: '#2ec4b6',
  amber: '#ff9f1c',
  blue: '#3d8bfd',
  violet: '#9b5de5',
  ink: '#0b1020',
  glass: '#0d2236',
};

export function playfieldSvg(table: TableDef): string {
  const W = table.width;
  const L = table.length;
  const Y = (y: number): number => +(L - y).toFixed(2);
  const pt = (x: number, y: number): string => `${x.toFixed(2)},${Y(y)}`;
  const els = table.elements;
  const lamp = (id: string): LampDef | undefined =>
    els.find((e): e is LampDef => e.type === 'lamp' && e.id === id);
  const saucers = els.filter((e): e is SaucerDef => e.type === 'saucer');
  const out: string[] = [];
  /**
   * A printed label anchored at (x, y) (y is the baseline). Every label carries a dark outline so
   * it reads against the mowing checker. Labels are big on purpose: seen from the player's end of
   * the cabinet, 1 mm of playfield is under 1 px of screen, so anything below about 14 mm is a
   * smudge (playtest: "none of it is legible").
   */
  const text = (
    x: number,
    y: number,
    s: string,
    size: number,
    fill = C.chalk,
    extra = '',
    anchor: 'start' | 'middle' | 'end' = 'middle',
  ): void => {
    out.push(
      `<text x="${x.toFixed(1)}" y="${Y(y).toFixed(1)}" font-size="${size}" fill="${fill}" stroke="${C.ink}" stroke-width="${(size * 0.14).toFixed(2)}" stroke-linejoin="round" paint-order="stroke" text-anchor="${anchor}" font-family="Oswald, 'Arial Narrow', Arial, sans-serif" font-weight="700" letter-spacing="${(size * 0.06).toFixed(2)}" ${extra}>${s}</text>`,
    );
  };

  // ---- grass, mowing stripes, vignette
  // A broadcast-style mowing checker: light and dark stripes crossing at right angles.
  out.push(`<rect width="${W}" height="${L}" fill="url(#grass)"/>`);
  out.push(`<rect width="${W}" height="${L}" fill="url(#mow)"/>`);
  out.push(`<rect width="${W}" height="${L}" fill="url(#mowCross)"/>`);

  // ---- warning track along the top arch and down the orbit lanes ("foul lines")
  const arcPath = (inset: number): string => {
    const cx = W / 2;
    const rx = W / 2 - inset;
    const ry = L - 1000 - inset;
    return `M ${inset},${Y(1000)} A ${rx},${ry} 0 0 1 ${cx + rx},${Y(1000)}`;
  };
  out.push(`<path d="${arcPath(14)}" fill="none" stroke="${C.track}" stroke-width="30"/>`);
  out.push(`<rect x="0" y="${Y(1000)}" width="46" height="${1000 - 700}" fill="${C.track}"/>`);
  out.push(`<rect x="504" y="${Y(1000)}" width="46" height="${1000 - 700}" fill="${C.track}"/>`);
  out.push(
    `<path d="${arcPath(30)}" fill="none" stroke="${C.gold}" stroke-width="1.6" opacity="0.9"/>`,
  );

  // ---- the Gap: dark "batter's eye" behind the pop nest
  out.push(
    `<polygon points="${[pt(240, 805), pt(185, 880), pt(185, 1050), pt(218, 1018), pt(332, 1018), pt(365, 1050), pt(365, 880), pt(310, 805)].join(' ')}" fill="#0f2a17"/>`,
  );

  // ---- infield
  const home = { x: 275, y: 230 };
  // Dirt fan between the foul lines, past the bases.
  out.push(
    `<path d="M ${pt(home.x, home.y)} L ${pt(home.x - 205, home.y + 205)} A 290 290 0 0 1 ${pt(home.x + 205, home.y + 205)} Z" fill="url(#dirt)"/>`,
  );
  // Infield grass square.
  out.push(
    `<polygon points="${[pt(275, 250), pt(380, 355), pt(275, 460), pt(170, 355)].join(' ')}" fill="${C.grass}"/>`,
  );
  out.push(
    `<polygon points="${[pt(275, 250), pt(380, 355), pt(275, 460), pt(170, 355)].join(' ')}" fill="url(#mow)" opacity="0.35"/>`,
  );
  // Foul lines.
  out.push(
    `<line x1="${home.x}" y1="${Y(home.y)}" x2="${home.x - 172}" y2="${Y(home.y + 172)}" stroke="${C.chalk}" stroke-width="2.4"/>`,
  );
  out.push(
    `<line x1="${home.x}" y1="${Y(home.y)}" x2="${home.x + 172}" y2="${Y(home.y + 172)}" stroke="${C.chalk}" stroke-width="2.4"/>`,
  );
  // Basepath windows: glass channels the runners run under.
  const bases = [
    [275, 230],
    [400, 355],
    [275, 480],
    [150, 355],
  ] as const;
  const path = `M ${bases.map(([x, y]) => pt(x, y)).join(' L ')} Z`;
  out.push(
    `<path d="${path}" fill="none" stroke="#0a1320" stroke-width="20" stroke-linejoin="round"/>`,
  );
  out.push(
    `<path d="${path}" fill="none" stroke="url(#glass)" stroke-width="16" stroke-linejoin="round"/>`,
  );
  out.push(
    `<path d="${path}" fill="none" stroke="#9fd6ff" stroke-width="0.8" stroke-dasharray="6 5" opacity="0.6" stroke-linejoin="round"/>`,
  );
  // Mound and home plate dirt.
  out.push(`<circle cx="275" cy="${Y(355)}" r="34" fill="url(#dirt)"/>`);
  out.push(`<rect x="268" y="${Y(355) - 1.5}" width="14" height="3" fill="${C.chalk}"/>`);
  out.push(`<circle cx="275" cy="${Y(230)}" r="30" fill="url(#dirt)"/>`);
  // Batter's boxes.
  out.push(
    `<rect x="250" y="${Y(242)}" width="17" height="26" fill="none" stroke="${C.chalk}" stroke-width="1.4"/>`,
  );
  out.push(
    `<rect x="283" y="${Y(242)}" width="17" height="26" fill="none" stroke="${C.chalk}" stroke-width="1.4"/>`,
  );
  // Bases and home plate (the base lamps sit on top).
  for (const [x, y] of bases.slice(1)) {
    out.push(
      `<rect x="${x - 7}" y="${Y(y) - 7}" width="14" height="14" fill="${C.chalk}" transform="rotate(45 ${x} ${Y(y)})"/>`,
    );
  }
  out.push(
    `<polygon points="${[pt(268, 236), pt(282, 236), pt(282, 229), pt(275, 222), pt(268, 229)].join(' ')}" fill="${C.chalk}"/>`,
  );

  // ---- fielders: leather "glove" rings with stitching. No printed names: the standees say who
  // they are, and their labels were too small to read anyway.
  for (const s of saucers) {
    if (!s.label) {
      // The Bleachers scoop: an amber-ringed dish (its sign goes with the labels below).
      out.push(
        `<circle cx="${s.x}" cy="${Y(s.y)}" r="${s.radius + 7}" fill="${C.ink}" opacity="0.85"/>`,
      );
      out.push(
        `<circle cx="${s.x}" cy="${Y(s.y)}" r="${s.radius + 4.5}" fill="none" stroke="${C.amber}" stroke-width="1.6"/>`,
      );
      continue;
    }
    out.push(`<circle cx="${s.x}" cy="${Y(s.y)}" r="${s.radius + 7}" fill="#5a3a22"/>`);
    out.push(
      `<circle cx="${s.x}" cy="${Y(s.y)}" r="${s.radius + 4.5}" fill="none" stroke="${C.chalk}" stroke-width="1" stroke-dasharray="2.5 2" opacity="0.8"/>`,
    );
  }

  // ---- shot arrows (the arrow lamps sit on top)
  const arrow = (id: string, color: string): void => {
    const l = lamp(id);
    if (!l || l.arrow === undefined) return;
    const a = (l.arrow * Math.PI) / 180;
    const len = 34;
    const back = { x: l.x - Math.cos(a) * len * 0.7, y: l.y - Math.sin(a) * len * 0.7 };
    const tip = { x: l.x + Math.cos(a) * len * 0.6, y: l.y + Math.sin(a) * len * 0.6 };
    const nx = -Math.sin(a) * 15;
    const ny = Math.cos(a) * 15;
    out.push(
      `<polygon points="${[pt(tip.x, tip.y), pt(back.x + nx, back.y + ny), pt(back.x + nx * 0.25 + Math.cos(a) * 9, back.y + ny * 0.25 + Math.sin(a) * 9), pt(back.x - nx * 0.25 + Math.cos(a) * 9, back.y - ny * 0.25 + Math.sin(a) * 9), pt(back.x - nx, back.y - ny)].join(' ')}" fill="${color}" opacity="0.28" stroke="${color}" stroke-width="1.2"/>`,
    );
  };
  arrow('arrow.orbit.L', C.amber);
  arrow('arrow.ramp.HR', C.red);
  arrow('arrow.gap', C.chalk);
  arrow('arrow.ramp.STEAL', C.teal);
  arrow('arrow.orbit.R', C.amber);

  // ---- labels: one short, big word per shot, under its arrow, saying what the shot does. Status
  // meters and banks get their name once; everything decorative went (the player reads the
  // distances and the park's name off the backbox).
  text(150, 594, 'HOME RUN', 24, C.red);
  text(275, 621, 'HITS', 16, C.chalk);
  text(414, 594, 'STEAL', 24, C.teal);
  // The orbit arrows are hidden under the wireforms, so TRIPLE goes just inside each orbit's
  // funnel, where the shot is aimed from.
  text(72, 622, 'TRIPLE', 15, C.amber);
  text(486, 638, 'TRIPLE', 15, C.amber);
  // The two meters' names sit to the right of their lamp rows.
  text(322, 576, 'RALLY', 13, C.gold, '', 'start');
  text(322, 608, 'HUSTLE', 13, '#7bd88f', '', 'start');
  // THROW IT BACK: the Bleachers' alley is too narrow for a sign across it, so it runs up the
  // alley, below the scoop's lamp.
  text(382, 856, 'MULTIBALL', 12, C.amber, `transform="rotate(-90 382 ${Y(856)})"`);
  const hot = lamp('lamp.hotbat');
  if (hot) text(hot.x, hot.y - 26, 'HOT BAT', 16, C.red);
  const wa = lamp('lamp.standup.W');
  if (wa) text(wa.x + 30, wa.y + 14, 'WALK', 16, C.violet);
  for (const l of els.filter(
    (e): e is LampDef => e.type === 'lamp' && e.id.startsWith('lamp.lane.'),
  )) {
    // The lanes are at the far end, squashed by the perspective and half hidden behind the 2B
    // bumpers, so each letter fills its lane and is stretched tall to read square from the bat.
    const by = Y(l.y + 18);
    text(
      l.x,
      l.y + 18,
      l.id.slice(-1),
      34,
      C.gold,
      `transform="translate(0 ${by}) scale(1 1.6) translate(0 ${-by})"`,
    );
  }
  const kb = lamp('lamp.kickback');
  if (kb)
    text(
      kb.x,
      kb.y + 50,
      'KICKBACK',
      12,
      C.gold,
      `transform="rotate(-90 ${kb.x} ${Y(kb.y + 50)})"`,
    );

  // ---- lower playfield: foul territory (the outlanes), catcher
  text(26, 290, 'FOUL', 16, C.chalk, `transform="rotate(-90 26 ${Y(290)})"`);
  text(524, 290, 'FOUL', 16, C.chalk, `transform="rotate(90 524 ${Y(290)})"`);
  out.push(`<ellipse cx="275" cy="${Y(70)}" rx="44" ry="30" fill="#6b4426"/>`);
  out.push(`<ellipse cx="275" cy="${Y(74)}" rx="26" ry="16" fill="#3e2614"/>`);
  out.push(
    `<ellipse cx="275" cy="${Y(70)}" rx="44" ry="30" fill="none" stroke="${C.chalk}" stroke-width="1" stroke-dasharray="3 2" opacity="0.6"/>`,
  );

  // ---- lamp sockets: a dark ring under every insert so lamps read as inserts
  for (const l of els.filter((e): e is LampDef => e.type === 'lamp' && e.arrow === undefined)) {
    out.push(
      `<circle cx="${l.x}" cy="${Y(l.y)}" r="${l.radius + 1.6}" fill="${C.ink}" opacity="0.85"/>`,
    );
  }

  // ---- print grain over everything
  out.push(`<rect width="${W}" height="${L}" filter="url(#grain)" opacity="0.10"/>`);
  out.push(`<rect width="${W}" height="${L}" fill="url(#vignette)"/>`);

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${L}" width="${W}mm" height="${L}mm">
<!-- Generated by tools/art/playfield.ts from the table definition. Edit freely, or replace with
     assets-src/raster/playfield.base.png (same proportions). 1 unit = 1 mm. -->
<defs>
  <radialGradient id="grass" cx="50%" cy="55%" r="75%">
    <stop offset="0" stop-color="${C.grassLight}"/>
    <stop offset="0.55" stop-color="${C.grass}"/>
    <stop offset="1" stop-color="${C.grassDark}"/>
  </radialGradient>
  <pattern id="mow" width="56" height="56" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
    <rect width="28" height="56" fill="#ffffff" opacity="0.075"/>
    <rect x="28" width="28" height="56" fill="#000000" opacity="0.06"/>
  </pattern>
  <pattern id="mowCross" width="56" height="56" patternUnits="userSpaceOnUse" patternTransform="rotate(-45)">
    <rect width="28" height="56" fill="#ffffff" opacity="0.045"/>
  </pattern>
  <radialGradient id="dirt" cx="50%" cy="50%" r="60%">
    <stop offset="0" stop-color="${C.dirt}"/>
    <stop offset="1" stop-color="${C.dirtDark}"/>
  </radialGradient>
  <linearGradient id="glass" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="#1d4a6e"/>
    <stop offset="0.5" stop-color="${C.glass}"/>
    <stop offset="1" stop-color="#16405e"/>
  </linearGradient>
  <radialGradient id="vignette" cx="50%" cy="50%" r="72%">
    <stop offset="0.65" stop-color="#000" stop-opacity="0"/>
    <stop offset="1" stop-color="#000" stop-opacity="0.45"/>
  </radialGradient>
  <filter id="grain" x="0" y="0" width="100%" height="100%">
    <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="7"/>
    <feColorMatrix type="saturate" values="0"/>
  </filter>
</defs>
${out.join('\n')}
</svg>
`;
}

/** Elements the art must avoid covering (kept for future layout checks). */
export type ArtElement = ElementDef;
