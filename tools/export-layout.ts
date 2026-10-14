/**
 * Layout exporter (docs/MVP/04 § 5): renders a TableDef to a top-down SVG schematic, so the docs
 * and the playfield artist always work from the real geometry.
 *
 *   npm run layout:svg            -> docs/MVP/assets/playfield-layout-v1-generated.svg
 */
import { writeFileSync } from 'node:fs';
import { rampEdges, wireformRails } from '../src/physics/world';
import type { ElementDef, TableDef, Vec2 } from '../src/table/schema';
import { v1Table } from '../src/table/v1Table';

const PAD = 20;
const LEGEND_W = 330;

function render(table: TableDef): string {
  const W = table.width;
  const H = table.length;
  // SVG y grows downward; playfield y grows up the table.
  const X = (x: number): number => +(PAD + x).toFixed(1);
  const Y = (y: number): number => +(PAD + H - y).toFixed(1);
  const pts = (ps: readonly Vec2[]): string => ps.map((p) => `${X(p[0])},${Y(p[1])}`).join(' ');
  const out: string[] = [];
  const hex = (c: number): string => `#${c.toString(16).padStart(6, '0')}`;

  const draw = (el: ElementDef): void => {
    switch (el.type) {
      case 'wall':
        out.push(
          `<polyline points="${pts(el.points)}" fill="none" stroke="${el.material.startsWith('rubber') ? '#111' : '#c9ced6'}" stroke-width="${Math.max(2, (el.radius ?? 1.5) * 2)}" stroke-linecap="round" stroke-linejoin="round"/>`,
        );
        break;
      case 'post':
        out.push(
          `<circle cx="${X(el.x)}" cy="${Y(el.y)}" r="${el.radius}" fill="${el.material.startsWith('rubber') ? '#111' : '#c9ced6'}"/>`,
        );
        break;
      case 'sling':
        out.push(
          `<polygon points="${pts([el.corner, el.top, el.bottom])}" fill="#e9e2cf" stroke="#fff" stroke-width="2"/>`,
        );
        break;
      case 'pop':
        out.push(
          `<circle cx="${X(el.x)}" cy="${Y(el.y)}" r="${el.radius + 8}" fill="${hex(el.color ?? 0xf4efe1)}" stroke="#fff" stroke-width="2"/>`,
        );
        if (el.label)
          out.push(
            `<text x="${X(el.x)}" y="${Y(el.y) + 4}" text-anchor="middle" font-size="12" font-weight="700" fill="#1b2a4a">${el.label}</text>`,
          );
        break;
      case 'saucer':
        out.push(
          `<circle cx="${X(el.x)}" cy="${Y(el.y)}" r="${el.radius}" fill="#0a0a0a" stroke="${el.label ? '#e6e6e6' : '#ff9f1c'}" stroke-width="2"/>`,
        );
        out.push(
          `<text x="${X(el.x)}" y="${Y(el.y) + 4}" text-anchor="middle" font-size="${el.label ? 11 : 7}" font-weight="700" fill="#fff">${el.label ?? 'BULLPEN'}</text>`,
        );
        break;
      case 'drop':
      case 'standup':
        out.push(
          `<line x1="${X(el.a[0])}" y1="${Y(el.a[1])}" x2="${X(el.b[0])}" y2="${Y(el.b[1])}" stroke="${el.type === 'drop' ? '#f2b33d' : '#9b5de5'}" stroke-width="6" stroke-linecap="round"/>`,
        );
        break;
      case 'kicker':
        out.push(
          `<line x1="${X(el.a[0])}" y1="${Y(el.a[1])}" x2="${X(el.b[0])}" y2="${Y(el.b[1])}" stroke="#ff9f1c" stroke-width="8" stroke-linecap="round"/>`,
        );
        break;
      case 'gate':
        out.push(
          `<line x1="${X(el.a[0])}" y1="${Y(el.a[1])}" x2="${X(el.b[0])}" y2="${Y(el.b[1])}" stroke="#7fd1ff" stroke-width="3" stroke-dasharray="6 3"/>`,
        );
        break;
      case 'spinner':
        out.push(
          `<line x1="${X(el.a[0])}" y1="${Y(el.a[1])}" x2="${X(el.b[0])}" y2="${Y(el.b[1])}" stroke="#e6e6e6" stroke-width="5"/>`,
        );
        break;
      case 'sensor':
        out.push(
          `<line x1="${X(el.a[0])}" y1="${Y(el.a[1])}" x2="${X(el.b[0])}" y2="${Y(el.b[1])}" stroke="#9aa6c4" stroke-width="1.5" stroke-dasharray="3 3"/>`,
        );
        break;
      case 'ramp': {
        const { left, right } = rampEdges(el.path, el.width, el.endWidth ?? el.width);
        const poly = [...left, ...[...right].reverse()].map((p) => [p[0], p[1]] as Vec2);
        out.push(
          `<polygon points="${pts(poly)}" fill="${el.id.endsWith('HR') ? '#ff3b3b' : '#2ec4b6'}" fill-opacity="0.35" stroke="#fff" stroke-opacity="0.5"/>`,
        );
        break;
      }
      case 'wireform':
        for (const rail of wireformRails(el.path, 13.5).slice(0, 2)) {
          out.push(
            `<polyline points="${pts(rail.map((p) => [p[0], p[1]] as Vec2))}" fill="none" stroke="#dfe4ea" stroke-width="1.5"/>`,
          );
        }
        break;
      case 'filler':
        out.push(`<polygon points="${pts(el.points)}" fill="#e9e2cf" fill-opacity="0.6"/>`);
        break;
      case 'dome':
        out.push(
          `<circle cx="${X(el.x)}" cy="${Y(el.y)}" r="${el.radius}" fill="#b4683c" opacity="0.8"/>`,
        );
        break;
      case 'magnet':
        out.push(
          `<circle cx="${X(el.x)}" cy="${Y(el.y)}" r="${el.radius}" fill="none" stroke="#c9a7ff" stroke-dasharray="4 3"/>`,
        );
        break;
      case 'kickback':
        out.push(
          `<rect x="${X(el.x0)}" y="${Y(el.y1)}" width="${el.x1 - el.x0}" height="${el.y1 - el.y0}" fill="#f2b33d" fill-opacity="0.25"/>`,
        );
        break;
      case 'plunger':
        out.push(
          `<rect x="${X(el.x0)}" y="${Y(el.tipY)}" width="${el.x1 - el.x0}" height="${el.tipY}" fill="#c9ced6"/>`,
        );
        break;
      case 'lamp':
        out.push(
          `<circle cx="${X(el.x)}" cy="${Y(el.y)}" r="${el.radius}" fill="${hex(el.color)}" opacity="0.85"/>`,
        );
        break;
      case 'flipper': {
        const t = (el.restAngle * Math.PI) / 180;
        const tip: Vec2 = [el.x + el.length * Math.cos(t), el.y + el.length * Math.sin(t)];
        out.push(
          `<line x1="${X(el.x)}" y1="${Y(el.y)}" x2="${X(tip[0])}" y2="${Y(tip[1])}" stroke="#f4efe1" stroke-width="${el.baseRadius + el.tipRadius}" stroke-linecap="round"/>`,
        );
        break;
      }
    }
  };

  // Draw order: floor features first, ramps and wires last (they are elevated).
  const order: ElementDef['type'][] = [
    'lamp',
    'magnet',
    'kickback',
    'dome',
    'sensor',
    'saucer',
    'filler',
    'wall',
    'post',
    'sling',
    'pop',
    'drop',
    'standup',
    'kicker',
    'gate',
    'spinner',
    'plunger',
    'flipper',
    'ramp',
    'wireform',
  ];
  for (const type of order) for (const el of table.elements) if (el.type === type) draw(el);

  const legend: [string, string][] = [
    ['#0a0a0a', 'Fielder saucer (out)'],
    ['#f4efe1', 'Single pop bumper'],
    ['#3d8bfd', 'Double pop bumper'],
    ['#ff9f1c', 'Corner kicker (triple)'],
    ['#ff3b3b', 'HR ramp'],
    ['#2ec4b6', 'Steal ramp'],
    ['#f2b33d', 'B-A-T drop targets'],
    ['#9b5de5', 'W-A-L-K standups'],
    ['#ff9f1c', 'Bullpen scoop (DOUBLEHEADER locks)'],
    ['#9aa6c4', 'Switch / sensor (dashed)'],
  ];
  const lx = PAD * 2 + W;
  const legendSvg = legend
    .map(
      ([c, t], i) =>
        `<circle cx="${lx + 10}" cy="${80 + i * 26}" r="8" fill="${c}" stroke="#fff"/><text x="${lx + 26}" y="${85 + i * 26}" font-size="13" fill="#f4f1e8">${t}</text>`,
    )
    .join('\n');

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W + PAD * 3 + LEGEND_W} ${H + PAD * 2}" font-family="Helvetica, Arial, sans-serif">
<title>${table.name} — generated layout</title>
<!-- Generated by tools/export-layout.ts from src/table/v1Table.ts. Do not edit by hand. 1 unit = 1 mm. -->
<rect width="100%" height="100%" fill="#0b1020"/>
<rect x="${PAD}" y="${PAD}" width="${W}" height="${H}" fill="#2e6b34"/>
${out.join('\n')}
<text x="${lx}" y="40" font-size="20" font-weight="700" fill="#f4f1e8">${table.name}</text>
<text x="${lx}" y="60" font-size="12" fill="#9aa6c4">Generated from the table data · 1 unit = 1 mm</text>
${legendSvg}
</svg>
`;
}

const file = 'docs/MVP/assets/playfield-layout-v1-generated.svg';
writeFileSync(file, render(v1Table));
console.log(`wrote ${file}`);
