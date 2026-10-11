import { describe, expect, it } from 'vitest';
import {
  evaluate,
  lampGroups,
  LampShows,
  SHOWS,
  type LampShow,
  type ShowName,
} from '../../src/fx/lampShows';
import { v1Table } from '../../src/table/v1Table';

// Photosensitivity (docs/MVP/01 § 9, WCAG 2.3.1): no lamp show flashes any lamp more than three
// times in any one-second window. Shows only name lamps that exist.

const groups = lampGroups(v1Table);
const allLamps = new Set(groups['@all']);

describe('lamp shows', () => {
  it('the table has the lamp groups the shows use', () => {
    for (const g of ['@all', '@ring', '@up', '@arrows', '@bases', '@rally', '@lanes']) {
      expect(groups[g]!.length, g).toBeGreaterThan(0);
    }
  });

  for (const name of Object.keys(SHOWS) as ShowName[]) {
    it(`${name}: never more than 3 flashes a second, and only real lamps`, () => {
      const show: LampShow = SHOWS[name];
      for (const track of show.tracks) {
        if (Array.isArray(track.lamps))
          for (const id of track.lamps) expect(allLamps, id).toContain(id);
      }
      const dt = 0.001;
      const span = show.loop ? show.duration * 3 : show.duration;
      const onsets = new Map<string, number[]>();
      let prev = new Map<string, string>();
      for (let t = 0; t < span; t += dt) {
        const now = evaluate(show, t % show.duration, groups);
        for (const [id, mode] of now) {
          if (mode === 'on' && prev.get(id) !== 'on') {
            if (!onsets.has(id)) onsets.set(id, []);
            onsets.get(id)!.push(t);
          }
        }
        prev = now;
      }
      for (const [id, times] of onsets) {
        for (let i = 3; i < times.length; i++) {
          // Four onsets inside one second would be more than 3 flashes per second.
          expect(times[i]! - times[i - 3]!, `${name} ${id}`).toBeGreaterThanOrEqual(1 - 1e-6);
        }
      }
    });
  }

  it('higher-priority shows win; finished shows hand the lamps back', () => {
    const shows = new LampShows(v1Table);
    shows.start('attract');
    shows.start('tilt');
    shows.update(0.5);
    expect(shows.overrides().get('base.home')).toBe('off');
    shows.update(3);
    expect(shows.isRunning('tilt')).toBe(false);
    expect(shows.isRunning('attract')).toBe(true);
    shows.stopAll();
    expect(shows.overrides().size).toBe(0);
  });

  it('reduced motion swaps every show for the gentle sweep', () => {
    const shows = new LampShows(v1Table);
    shows.reduced = true;
    shows.start('homeRun');
    // Each lamp comes on at most once: a sweep, no flashing.
    const onsets = new Map<string, number>();
    let prev = new Map<string, string>();
    for (let i = 0; i < 200; i++) {
      shows.update(0.01);
      const now = shows.overrides();
      for (const [id, mode] of now) {
        if (mode === 'on' && prev.get(id) !== 'on') onsets.set(id, (onsets.get(id) ?? 0) + 1);
      }
      prev = now;
    }
    expect(onsets.size).toBeGreaterThan(0);
    expect(Math.max(...onsets.values())).toBe(1);
  });
});
