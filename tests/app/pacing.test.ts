import { describe, expect, it } from 'vitest';
import { ATTRACT_SLEEP_MS, FramePacer, frameInterval } from '../../src/app/pacing';

// Frame pacing (docs/MVP/efficiency-audit F3, F4, F6): a 60 fps cap on 90/120/144 Hz screens, a
// slower title screen and menus, and no skipped frames on a plain 60 Hz display.

/** Frames drawn over `seconds` of a `hz` display, with optional jitter (ms) on each refresh. */
function drawn(hz: number, interval: number, seconds = 2, jitter = 0): number {
  const p = new FramePacer();
  let n = 0;
  const frames = Math.round(hz * seconds);
  for (let i = 0; i < frames; i++) {
    const t = (i * 1000) / hz + (i % 2 === 0 ? jitter : -jitter);
    if (p.shouldDraw(t, interval)) n++;
  }
  return n / seconds;
}

describe('FramePacer', () => {
  const cap = 1000 / 60;

  it('draws every frame of a 60 Hz display, jitter or not', () => {
    expect(drawn(60, cap)).toBe(60);
    expect(drawn(60, cap, 2, 1.5)).toBe(60);
  });

  it('holds 120 and 144 Hz displays to about 60 fps', () => {
    expect(drawn(120, cap)).toBe(60);
    expect(Math.abs(drawn(144, cap) - 60)).toBeLessThanOrEqual(1);
    expect(Math.abs(drawn(90, cap) - 60)).toBeLessThanOrEqual(1);
  });

  it('uncapped draws every display frame', () => {
    expect(drawn(120, 0)).toBe(120);
  });

  it('paces the menus and title screen', () => {
    expect(drawn(120, 1000 / 30)).toBe(30);
    // 10.5: the slack lets the first menu frame land one refresh early.
    expect(Math.abs(drawn(60, 100) - 10)).toBeLessThanOrEqual(0.5);
  });

  it('leaving a menu draws at once, not after the old, longer interval', () => {
    const p = new FramePacer();
    expect(p.shouldDraw(0, 100)).toBe(true);
    expect(p.shouldDraw(16.7, 100)).toBe(false);
    expect(p.shouldDraw(33.3, cap)).toBe(true);
  });

  it('draws nothing while asleep, and at once on waking', () => {
    const p = new FramePacer();
    expect(p.shouldDraw(0, 1000 / 30)).toBe(true);
    for (let t = 16; t < 5000; t += 16) expect(p.shouldDraw(t, Infinity)).toBe(false);
    expect(p.shouldDraw(5000, 1000 / 60)).toBe(true);
  });

  it('after a stall it restarts the schedule instead of drawing a burst', () => {
    const p = new FramePacer();
    p.shouldDraw(0, cap);
    expect(p.shouldDraw(500, cap)).toBe(true);
    expect(p.shouldDraw(508.3, cap)).toBe(false);
    expect(p.shouldDraw(516.7, cap)).toBe(true);
  });
});

describe('frameInterval', () => {
  const base = { setting: 'auto', mobile: false, tier: 'high', boosted: false } as const;

  it('caps phones at 60 on Auto, leaves desktops uncapped', () => {
    expect(frameInterval({ ...base, mode: 'play', mobile: true })).toBeCloseTo(1000 / 60);
    expect(frameInterval({ ...base, mode: 'play' })).toBe(0);
  });

  it('follows an explicit setting', () => {
    expect(frameInterval({ ...base, mode: 'play', setting: '60' })).toBeCloseTo(1000 / 60);
    expect(frameInterval({ ...base, mode: 'play', setting: 'max', mobile: true })).toBe(0);
  });

  it('runs attract mode at 30 fps on Low and Medium, unless the player is pressing buttons', () => {
    expect(frameInterval({ ...base, mode: 'attract', tier: 'medium' })).toBeCloseTo(1000 / 30);
    expect(frameInterval({ ...base, mode: 'attract', tier: 'low' })).toBeCloseTo(1000 / 30);
    expect(frameInterval({ ...base, mode: 'attract', tier: 'high' })).toBe(0);
    expect(frameInterval({ ...base, mode: 'attract', tier: 'medium', boosted: true })).toBe(0);
  });

  it('Battery saver caps play at 60 and slows the title screen on every tier', () => {
    expect(frameInterval({ ...base, mode: 'play', setting: 'max', saver: true })).toBeCloseTo(
      1000 / 60,
    );
    expect(frameInterval({ ...base, mode: 'attract', tier: 'high', saver: true })).toBeCloseTo(
      1000 / 30,
    );
  });

  it('attract mode left alone for two minutes stops drawing; nothing else does', () => {
    const idle = ATTRACT_SLEEP_MS;
    expect(frameInterval({ ...base, mode: 'attract', sinceActivity: idle - 1 })).toBe(0);
    expect(frameInterval({ ...base, mode: 'attract', sinceActivity: idle })).toBe(Infinity);
    expect(frameInterval({ ...base, mode: 'play', sinceActivity: idle * 5 })).toBe(0);
    expect(frameInterval({ ...base, mode: 'idle', sinceActivity: idle * 5 })).toBe(100);
  });

  it('draws the menus at 10 fps', () => {
    expect(frameInterval({ ...base, mode: 'idle' })).toBe(100);
    expect(frameInterval({ ...base, mode: 'idle', boosted: true })).toBe(100);
  });
});
