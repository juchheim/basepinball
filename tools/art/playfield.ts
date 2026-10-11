/**
 * Playfield art generator (docs/MVP/05 § 5). Builds the printed playfield as SVG from the table
 * definition, so every lane, saucer and insert lines up with the geometry. The output
 * (assets-src/svg/playfield.base.svg) is the editable vector source; a PNG dropped into
 * assets-src/raster/playfield.base.png replaces it entirely.
 *
 * Style: a ballpark at night under lights, printed on a pinball playfield.
 */
import type { ElementDef, LampDef, SaucerDef, TableDef } from '../../src/table/schema';

const C = {
  grassDark: '#1c4a26',
  grass: '#2c6a35',
  grassLight: '#3a7d42',
  dirt: '#a8643a',
  dirtDark: '#7e4a2b',
  chalk: '#f4f1e8',
  track: '#8c5a3b',
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
  const text = (
    x: number,
    y: number,
    s: string,
    size: number,
    fill = C.chalk,
    extra = '',
  ): void => {
    out.push(
      `<text x="${x.toFixed(1)}" y="${Y(y).toFixed(1)}" font-size="${size}" fill="${fill}" text-anchor="middle" font-family="Oswald, 'Arial Narrow', Arial, sans-serif" font-weight="700" letter-spacing="0.6" ${extra}>${s}</text>`,
    );
  };

  // ---- grass, mowing stripes, vignette
  out.push(`<rect width="${W}" height="${L}" fill="url(#grass)"/>`);
  out.push(`<rect width="${W}" height="${L}" fill="url(#mow)" opacity="0.5"/>`);

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
  out.push(`<path id="arcText" d="${arcPath(9)}" fill="none"/>`);
  out.push(
    `<text font-size="11" fill="${C.chalk}" font-family="Oswald, 'Arial Narrow', Arial, sans-serif" font-weight="700" letter-spacing="3" opacity="0.85"><textPath href="#arcText" startOffset="50%" text-anchor="middle">PLUNGER PARK · HOME OF THE TILT CITY SILVERBALLS</textPath></text>`,
  );
  // Distance markers on the warning track.
  text(70, 1030, '330', 9, C.chalk, 'opacity="0.8"');
  text(295, 1150, '400', 9, C.chalk, 'opacity="0.8"');
  text(520, 1030, '330', 9, C.chalk, 'opacity="0.8"');

  // ---- the Gap: dark "batter's eye" behind the pop nest
  out.push(
    `<polygon points="${[pt(240, 805), pt(185, 880), pt(185, 1050), pt(218, 1018), pt(332, 1018), pt(365, 1050), pt(365, 880), pt(310, 805)].join(' ')}" fill="#0f2a17"/>`,
  );
  text(275, 1000, 'THE GAP', 8, C.gold, 'opacity="0.7"');

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
    `<line x1="${home.x}" y1="${Y(home.y)}" x2="${home.x - 172}" y2="${Y(home.y + 172)}" stroke="${C.chalk}" stroke-width="2"/>`,
  );
  out.push(
    `<line x1="${home.x}" y1="${Y(home.y)}" x2="${home.x + 172}" y2="${Y(home.y + 172)}" stroke="${C.chalk}" stroke-width="2"/>`,
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
  text(275, 302, 'FB · CH · CB', 6, C.chalk, 'opacity="0.75"');

  // ---- fielders: leather "glove" rings with stitching, position and scorebook number
  const POS: Record<string, number> = { '1B': 3, '2B': 4, '3B': 5, SS: 6, LF: 7, CF: 8, RF: 9 };
  for (const s of saucers) {
    out.push(`<circle cx="${s.x}" cy="${Y(s.y)}" r="${s.radius + 7}" fill="#5a3a22"/>`);
    out.push(
      `<circle cx="${s.x}" cy="${Y(s.y)}" r="${s.radius + 4.5}" fill="none" stroke="${C.chalk}" stroke-width="1" stroke-dasharray="2.5 2" opacity="0.8"/>`,
    );
    const label = s.label ?? '';
    // Put the label on the playfield side (opposite the lip).
    const a = ((s.lipAngle + 180) * Math.PI) / 180;
    const lx = s.x + Math.cos(a) * (s.radius + 15);
    const ly = s.y + Math.sin(a) * (s.radius + 15) - 3;
    text(lx, ly, `${label} ${POS[label] ?? ''}`, 9, C.chalk);
  }

  // ---- shot arrows and labels (the arrow lamps sit on top)
  const shot = (id: string, label: string, color: string): void => {
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
    text(back.x - Math.cos(a) * 6, back.y - Math.sin(a) * 6 - 12, label, 8.5, color);
  };
  shot('arrow.orbit.L', 'TRIPLE', C.amber);
  shot('arrow.ramp.HR', 'HOME RUN', C.red);
  shot('arrow.gap', '1B · 2B', C.chalk);
  shot('arrow.ramp.STEAL', 'STEAL', C.teal);
  shot('arrow.orbit.R', 'TRIPLE', C.amber);
  // Ramp signage near the entrances.
  text(142, 772, 'OVER THE WALL', 7, C.red);
  text(408, 772, 'STEAL', 7, C.teal);

  // ---- rally meter, feature inserts, banks, lanes
  text(275, 566, 'RALLY', 7, C.gold);
  text(275, 598, 'HUSTLE', 7, '#7bd88f');
  const hot = lamp('lamp.hotbat');
  if (hot) text(hot.x, hot.y - 18, 'HOT BAT', 8, C.red);
  // The W-A-L-K bank's sign, behind its lamps.
  const wa = lamp('lamp.standup.A');
  const wl = lamp('lamp.standup.L');
  if (wa && wl) text((wa.x + wl.x) / 2 + 10, (wa.y + wl.y) / 2 + 9, 'WALK', 8, C.violet);
  for (const l of els.filter(
    (e): e is LampDef => e.type === 'lamp' && /^lamp\.(drop|standup)\./.test(e.id),
  )) {
    text(l.x, l.y - 3, l.id.slice(-1), 6.5, C.ink);
  }
  for (const l of els.filter(
    (e): e is LampDef => e.type === 'lamp' && e.id.startsWith('lamp.lane.'),
  )) {
    text(l.x, l.y + 14, l.id.slice(-1), 11, C.gold);
  }
  const kb = lamp('lamp.kickback');
  if (kb) text(kb.x + 2, kb.y + 14, 'KICKBACK', 5.5, C.gold);

  // ---- lower playfield: foul territory, dugout signage, catcher
  text(20, 260, 'FOUL', 8, C.chalk, `transform="rotate(-90 20 ${Y(260)})" opacity="0.8"`);
  text(530, 260, 'FOUL', 8, C.chalk, `transform="rotate(90 530 ${Y(260)})" opacity="0.8"`);
  out.push(`<ellipse cx="275" cy="${Y(70)}" rx="44" ry="30" fill="#6b4426"/>`);
  out.push(`<ellipse cx="275" cy="${Y(74)}" rx="26" ry="16" fill="#3e2614"/>`);
  out.push(
    `<ellipse cx="275" cy="${Y(70)}" rx="44" ry="30" fill="none" stroke="${C.chalk}" stroke-width="1" stroke-dasharray="3 2" opacity="0.6"/>`,
  );
  text(275, 32, 'CATCHER', 8, C.chalk, 'opacity="0.8"');

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
    <rect width="28" height="56" fill="#ffffff" opacity="0.07"/>
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
