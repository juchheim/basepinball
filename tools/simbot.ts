/**
 * Balance report: plays complete games with the sim bot and compares them with the tuning
 * targets in docs/MVP/01 § 8.
 *
 *   npm run simbot -- [games=20] [profile=average]
 */
import { PROFILES, playGame } from '../src/sim/bot';

const games = Number(process.argv[2] ?? 20);
const profile = PROFILES[process.argv[3] ?? 'average'];
if (!profile) throw new Error(`unknown profile; try ${Object.keys(PROFILES).join(', ')}`);

const t0 = performance.now();
const results = Array.from({ length: games }, (_, i) => playGame(profile, 1000 + i));
const ms = performance.now() - t0;

const sum = (f: (r: (typeof results)[number]) => number) => results.reduce((a, r) => a + f(r), 0);
const pa = sum((r) => r.stats.plateAppearances);
const hits = sum((r) => r.stats.hits);
const pct = (n: number, d: number) => `${((100 * n) / Math.max(1, d)).toFixed(1)} %`;
const runs = results.map((r) => r.stats.runs).sort((a, b) => a - b);
const rallyPas = sum((r) => r.events.filter((e) => e.type === 'rally').length);
const minutes = sum((r) => r.stats.duration) / games / 60;

const rows: [string, string, string][] = [
  ['Games completed', `${results.filter((r) => r.completed).length} / ${games}`, 'all'],
  [
    'Runs per game (mean / median)',
    `${(sum((r) => r.stats.runs) / games).toFixed(2)} / ${runs[Math.floor(games / 2)]}`,
    '3-5 (median 4)',
  ],
  ['Game length (sim minutes)', minutes.toFixed(1), '5-8 (bot; humans 6-9)'],
  ['PA per game', (pa / games).toFixed(1), '≈ 40'],
  ['Hit rate (H / PA)', pct(hits, pa), '≈ 30 %'],
  [
    'Hit mix 1B / 2B / 3B / HR',
    [
      sum((r) => r.stats.singles),
      sum((r) => r.stats.doubles),
      sum((r) => r.stats.triples),
      sum((r) => r.stats.homeRuns),
    ]
      .map((n) => pct(n, hits))
      .join(' / '),
    '55 / 25 / 8 / 12',
  ],
  [
    'Drain outs (K + foul) / PA',
    pct(
      sum((r) => r.stats.strikeouts + r.stats.foulOuts),
      pa,
    ),
    '≤ 25 %',
  ],
  [
    'Fielder outs / PA',
    pct(
      sum((r) => r.stats.fielderOuts),
      pa,
    ),
    'most common out',
  ],
  ['Rally PAs / PA', pct(rallyPas, pa), '15-25 %'],
  [
    'Steals, skill shots per game',
    `${(sum((r) => r.stats.steals) / games).toFixed(2)}, ${(sum((r) => r.stats.skillShots) / games).toFixed(2)}`,
    '—',
  ],
  ['Ball rescues per game', (sum((r) => r.rescues) / games).toFixed(2), '< 0.05'],
];
console.log(
  `\nSim bot: ${games} games, profile "${profile.name}" (${(ms / 1000).toFixed(1)} s wall time)\n`,
);
for (const [k, v, t] of rows) console.log(`${k.padEnd(32)} ${v.padEnd(28)} target ${t}`);
