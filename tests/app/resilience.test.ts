import { describe, expect, it } from 'vitest';
import { BlankTracker, FrameGuard, ProbeSchedule } from '../../src/app/resilience';

// The blank-canvas watchdog (M6 follow-up): a renderer that stops presenting while the page carries
// on (seen in Safari) is nudged, then switched to the WebGL2 backend.

describe('BlankTracker', () => {
  const feed = (t: BlankTracker, obs: (boolean | null)[]) => obs.map((o) => t.observe(o));

  it('stays quiet while the canvas is drawing, and when the browser will not say', () => {
    const t = new BlankTracker();
    expect(feed(t, [true, true, null, null, true])).toEqual([
      'none',
      'none',
      'none',
      'none',
      'none',
    ]);
  });

  it('escalates: a nudge after 2 blank checks, a rebuild after 4, the fallback after 8', () => {
    const t = new BlankTracker();
    t.observe(true);
    const out = feed(t, Array(8).fill(false));
    expect(out).toEqual(['none', 'soft', 'none', 'rebuild', 'none', 'none', 'none', 'fallback']);
  });

  it('a recovered canvas resets the count', () => {
    const t = new BlankTracker();
    t.observe(true);
    feed(t, [false, false, true]);
    expect(t.blankCount).toBe(0);
    // A second outage escalates from the start again.
    expect(feed(t, [false, false])).toEqual(['none', 'soft']);
  });

  it('a canvas never seen drawing falls back after 12 blank checks (no nudge)', () => {
    const t = new BlankTracker();
    const out = feed(t, Array(12).fill(false));
    expect(out.slice(0, 11).every((a) => a === 'none')).toBe(true);
    expect(out[11]).toBe('fallback');
  });
});

describe('FrameGuard', () => {
  it('gives up only after 30 failing frames in a row', () => {
    const g = new FrameGuard();
    let gave = false;
    for (let i = 0; i < 29; i++) gave ||= g.failed(new Error('x'));
    expect(gave).toBe(false);
    g.ok();
    for (let i = 0; i < 29; i++) gave ||= g.failed(new Error('x'));
    expect(gave).toBe(false);
    expect(g.failed(new Error('x'))).toBe(true);
  });
});

describe('ProbeSchedule', () => {
  /** Times (ms) at which a probe falls due, polling every 10 ms up to `until`. */
  const dueTimes = (s: ProbeSchedule, from: number, until: number): number[] => {
    const out: number[] = [];
    for (let t = from; t <= until; t += 10) if (s.due(t)) out.push(t);
    return out;
  };

  it('checks every half second at start-up, then every 5 s once settled', () => {
    const s = new ProbeSchedule(0);
    expect(dueTimes(s, 0, 10_000)).toHaveLength(20);
    expect(dueTimes(s, 10_010, 30_000)).toHaveLength(4);
  });

  it('a wake (resize, quality change, a blank read) goes back to half-second checks at once', () => {
    const s = new ProbeSchedule(0);
    dueTimes(s, 0, 20_000);
    s.wake(20_000);
    const after = dueTimes(s, 20_000, 22_000);
    expect(after[0]).toBe(20_500);
    expect(after).toHaveLength(4);
  });
});
