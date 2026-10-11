import { describe, expect, it } from 'vitest';
import { BlankTracker, FrameGuard } from '../../src/app/resilience';

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

  it('nudges once after 3 blank checks, then falls back after 8', () => {
    const t = new BlankTracker();
    t.observe(true);
    const out = feed(t, Array(8).fill(false));
    expect(out.indexOf('soft')).toBe(2);
    expect(out.filter((a) => a === 'soft')).toHaveLength(1);
    expect(out[7]).toBe('fallback');
  });

  it('a recovered canvas resets the count', () => {
    const t = new BlankTracker();
    t.observe(true);
    feed(t, [false, false, true]);
    expect(feed(t, [false, false])).toEqual(['none', 'none']);
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
