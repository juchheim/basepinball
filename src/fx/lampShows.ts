import type { LampDef, TableDef } from '../table/schema';

/**
 * Lamp shows (docs/MVP/05 § 9.1): data-driven light patterns layered over the rules' lamp states
 * by priority. A show is a list of tracks, each a pattern on a group of lamps over a time window.
 * Patterns never flash a lamp faster than 3 times a second (WCAG 2.3.1; tests/fx/lampShows.test.ts
 * checks every show), and the reduced-motion setting swaps every show for a single gentle sweep.
 */

export type ShowMode = 'on' | 'off';

/** A lamp group: `@all`, `@ring` (around the centre), `@up` (bottom to top), or a list of ids. */
type Group = '@all' | '@ring' | '@up' | '@arrows' | '@bases' | '@rally' | '@lanes' | string[];

type Pattern =
  /** Lamps light one after another around the group, `width` = fraction of the period lit. */
  | { kind: 'chase'; period: number; width: number }
  /** All lamps on and off together, `rate` flashes per second. */
  | { kind: 'pulse'; rate: number; duty: number }
  /** Lamps light progressively across the window and stay lit. */
  | { kind: 'fill' }
  | { kind: 'solid'; mode: ShowMode };

export interface Track {
  lamps: Group;
  from: number;
  to: number;
  pattern: Pattern;
}

export interface LampShow {
  priority: number;
  /** Seconds; a looping show repeats every `duration`. */
  duration: number;
  loop?: boolean;
  tracks: Track[];
}

export const SHOWS = {
  /** Lights-on at game start: the table fills from the flippers up, then holds. */
  gameStart: {
    priority: 3,
    duration: 2.6,
    tracks: [
      { lamps: '@up', from: 0, to: 1.6, pattern: { kind: 'fill' } },
      { lamps: '@all', from: 1.6, to: 2.6, pattern: { kind: 'solid', mode: 'on' } },
    ],
  },
  /** Home run: a chase round the table, the HR arrow and bases pulsing. */
  homeRun: {
    priority: 4,
    duration: 3.4,
    tracks: [
      { lamps: '@ring', from: 0, to: 3.4, pattern: { kind: 'chase', period: 0.85, width: 0.22 } },
      { lamps: '@bases', from: 0, to: 3.4, pattern: { kind: 'pulse', rate: 2, duty: 0.5 } },
      {
        lamps: ['arrow.ramp.HR'],
        from: 0,
        to: 3.4,
        pattern: { kind: 'pulse', rate: 2.5, duty: 0.5 },
      },
    ],
  },
  /** Any other hit: a quick fill of the base path. */
  hit: {
    priority: 2,
    duration: 0.9,
    tracks: [
      {
        lamps: ['base.home', 'base.1B', 'base.2B', 'base.3B'],
        from: 0,
        to: 0.6,
        pattern: { kind: 'fill' },
      },
      { lamps: '@bases', from: 0.6, to: 0.9, pattern: { kind: 'solid', mode: 'on' } },
    ],
  },
  steal: {
    priority: 3,
    duration: 1.2,
    tracks: [
      {
        lamps: ['arrow.ramp.STEAL'],
        from: 0,
        to: 1.2,
        pattern: { kind: 'pulse', rate: 2.5, duty: 0.5 },
      },
      { lamps: '@bases', from: 0, to: 1.2, pattern: { kind: 'chase', period: 0.6, width: 0.3 } },
    ],
  },
  rally: {
    priority: 2,
    duration: 1,
    tracks: [{ lamps: '@rally', from: 0, to: 0.7, pattern: { kind: 'fill' } }],
  },
  hotBat: {
    priority: 3,
    duration: 1.4,
    tracks: [
      {
        lamps: ['lamp.drop.B', 'lamp.drop.A', 'lamp.drop.T'],
        from: 0,
        to: 1.4,
        pattern: { kind: 'chase', period: 0.6, width: 0.4 },
      },
      {
        lamps: ['lamp.hotbat'],
        from: 0,
        to: 1.4,
        pattern: { kind: 'pulse', rate: 2.5, duty: 0.5 },
      },
    ],
  },
  skillShot: {
    priority: 3,
    duration: 1.5,
    tracks: [
      { lamps: '@lanes', from: 0, to: 1.5, pattern: { kind: 'chase', period: 0.5, width: 0.4 } },
    ],
  },
  strikeout: {
    priority: 2,
    duration: 1.2,
    tracks: [
      {
        lamps: ['pitch.FB', 'pitch.CH', 'pitch.CB', 'base.home'],
        from: 0,
        to: 1.2,
        pattern: { kind: 'pulse', rate: 2, duty: 0.5 },
      },
    ],
  },
  /** Side retired: everything pulses slowly, then goes dark. */
  inningEnd: {
    priority: 3,
    duration: 2.2,
    tracks: [
      { lamps: '@all', from: 0, to: 1.6, pattern: { kind: 'pulse', rate: 1.5, duty: 0.5 } },
      { lamps: '@all', from: 1.6, to: 2.2, pattern: { kind: 'solid', mode: 'off' } },
    ],
  },
  /** Tilt: the lamps die. */
  tilt: {
    priority: 5,
    duration: 3,
    tracks: [{ lamps: '@all', from: 0, to: 3, pattern: { kind: 'solid', mode: 'off' } }],
  },
  /** Game over: a slow fill, then a long chase. */
  gameOver: {
    priority: 4,
    duration: 4,
    tracks: [
      { lamps: '@up', from: 0, to: 1.5, pattern: { kind: 'fill' } },
      { lamps: '@ring', from: 1.5, to: 4, pattern: { kind: 'chase', period: 1.2, width: 0.25 } },
    ],
  },
  /** Attract mode (title screen): a slow chase with the arrows breathing. */
  attract: {
    priority: 1,
    duration: 4.8,
    loop: true,
    tracks: [
      { lamps: '@ring', from: 0, to: 4.8, pattern: { kind: 'chase', period: 2.4, width: 0.2 } },
      { lamps: '@arrows', from: 0, to: 4.8, pattern: { kind: 'pulse', rate: 0.625, duty: 0.5 } },
    ],
  },
  /** Reduced motion replaces every show with this. */
  gentle: {
    priority: 2,
    duration: 1.2,
    tracks: [{ lamps: '@up', from: 0, to: 0.9, pattern: { kind: 'fill' } }],
  },
} satisfies Record<string, LampShow>;

export type ShowName = keyof typeof SHOWS;

interface Running {
  name: ShowName;
  show: LampShow;
  t: number;
}

export class LampShows {
  private readonly groups: Record<string, string[]>;
  private readonly running: Running[] = [];
  /** Reduced motion: every show becomes the gentle sweep. */
  reduced = false;

  constructor(table: TableDef) {
    this.groups = lampGroups(table);
  }

  get lampIds(): readonly string[] {
    return this.groups['@all']!;
  }

  start(name: ShowName): void {
    const actual: ShowName =
      this.reduced && name !== 'attract' && name !== 'tilt' ? 'gentle' : name;
    this.stop(name);
    this.running.push({ name, show: SHOWS[actual], t: 0 });
  }

  stop(name: ShowName): void {
    for (let i = this.running.length - 1; i >= 0; i--) {
      if (this.running[i]!.name === name) this.running.splice(i, 1);
    }
  }

  stopAll(): void {
    this.running.length = 0;
  }

  isRunning(name: ShowName): boolean {
    return this.running.some((r) => r.name === name);
  }

  update(dt: number): void {
    for (let i = this.running.length - 1; i >= 0; i--) {
      const r = this.running[i]!;
      r.t += dt;
      if (r.t >= r.show.duration) {
        if (r.show.loop) r.t %= r.show.duration;
        else this.running.splice(i, 1);
      }
    }
  }

  /** The lamps the running shows override (highest priority wins per lamp). */
  overrides(): Map<string, ShowMode> {
    const out = new Map<string, ShowMode>();
    const prio = new Map<string, number>();
    for (const r of this.running) {
      for (const [lamp, mode] of evaluate(r.show, r.t, this.groups)) {
        if ((prio.get(lamp) ?? -1) <= r.show.priority) {
          out.set(lamp, mode);
          prio.set(lamp, r.show.priority);
        }
      }
    }
    return out;
  }
}

/** Lamp groups for a table: all, around the centre, bottom-to-top, and the feature sets. */
export function lampGroups(table: TableDef): Record<string, string[]> {
  const lamps = table.elements.filter((e): e is LampDef => e.type === 'lamp');
  const cx = table.width / 2;
  const cy = table.length * 0.45;
  const ids = (list: LampDef[]) => list.map((l) => l.id);
  return {
    '@all': ids(lamps),
    '@ring': ids(
      [...lamps].sort((a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx)),
    ),
    '@up': ids([...lamps].sort((a, b) => a.y - b.y)),
    '@arrows': ids(lamps.filter((l) => l.id.startsWith('arrow.'))),
    '@bases': ids(lamps.filter((l) => l.id.startsWith('base.'))),
    '@rally': ids(lamps.filter((l) => l.id.startsWith('rally.'))),
    '@lanes': ids(lamps.filter((l) => l.id.startsWith('lamp.lane.'))),
  };
}

/** The lamp states a show sets at time `t`. */
export function evaluate(
  show: LampShow,
  t: number,
  groups: Record<string, string[]>,
): Map<string, ShowMode> {
  const out = new Map<string, ShowMode>();
  for (const track of show.tracks) {
    if (t < track.from || t >= track.to) continue;
    const lamps = typeof track.lamps === 'string' ? (groups[track.lamps] ?? []) : track.lamps;
    const local = t - track.from;
    const p = track.pattern;
    lamps.forEach((id, i) => {
      let on: boolean;
      switch (p.kind) {
        case 'chase': {
          const phase = (local / p.period - i / lamps.length) % 1;
          on = (phase < 0 ? phase + 1 : phase) < p.width;
          break;
        }
        case 'pulse':
          on = (local * p.rate) % 1 < p.duty;
          break;
        case 'fill':
          on = local >= ((track.to - track.from) * i) / lamps.length;
          break;
        case 'solid':
          on = p.mode === 'on';
          break;
      }
      out.set(id, on ? 'on' : 'off');
    });
  }
  return out;
}
