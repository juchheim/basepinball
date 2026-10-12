import { describe, expect, it } from 'vitest';
import { AdaptiveQuality, initialTier, TIERS, type Quality } from '../../src/render/quality';

// A Safari tester saw the canvas blank for seconds at High (16 fps, WebGL2 renderer) until the
// adaptive controller stepped down. These tests pin the faster, bigger step-down and the safer
// starting tier.

function run(controller: AdaptiveQuality, frames: number, dtMs: number, from = 0): number {
  let now = from;
  for (let i = 0; i < frames; i++) {
    now += dtMs;
    controller.frame(now, dtMs);
  }
  return now;
}

describe('starting tier', () => {
  const q = (s = '') => new URLSearchParams(s);
  const desktop = { mobile: false, safari: false };

  it('desktop WebGPU starts at High', () => {
    expect(initialTier(q(), 'WebGPU', desktop).name).toBe('high');
  });
  it('the WebGL2 renderer, Safari and phones start at Medium', () => {
    expect(initialTier(q(), 'WebGL2', desktop).name).toBe('medium');
    expect(initialTier(q(), 'WebGPU', { mobile: false, safari: true }).name).toBe('medium');
    expect(initialTier(q(), 'WebGPU', { mobile: true, safari: false }).name).toBe('medium');
  });
  it('?quality= wins', () => {
    expect(initialTier(q('quality=ultra'), 'WebGL2', { mobile: true, safari: true }).name).toBe(
      'ultra',
    );
  });
  it('only Ultra uses the 4096 px playfield', () => {
    expect(TIERS.high.playfieldTexture).toBe(2048);
    expect(TIERS.ultra.playfieldTexture).toBe(4096);
  });
});

describe('adaptive controller', () => {
  const make = (start: Quality) => {
    const seen: string[] = [];
    const c = new AdaptiveQuality(start, (t) => seen.push(t.name));
    return { c, seen };
  };

  it('holds steady at 60 fps', () => {
    const { c, seen } = make(TIERS.high);
    run(c, 600, 16.7);
    expect(seen).toEqual([]);
  });

  it('does not step down at 45 fps (a busy moment, or a busy machine)', () => {
    const { c, seen } = make(TIERS.high);
    run(c, 400, 22);
    expect(seen).toEqual([]);
  });

  it('steps down one tier at about 28 fps', () => {
    const { c, seen } = make(TIERS.high);
    run(c, 200, 36);
    expect(seen[0]).toBe('medium');
  });

  it('a struggling renderer (16 fps) drops two tiers at once, within a few seconds', () => {
    const { c, seen } = make(TIERS.high);
    const end = run(c, 200, 62);
    expect(seen[0]).toBe('low');
    // The first judgement comes after ~1.5 s of settling plus 45 frames, not 120 plus a cooldown.
    expect(end).toBeGreaterThan(0);
    const t = run(make(TIERS.high).c, 60, 62);
    expect(t).toBeLessThan(5000);
  });

  it('judges nothing in the first 1.5 s (shader compiles)', () => {
    const { c, seen } = make(TIERS.high);
    run(c, 20, 62); // 1.24 s of slow frames
    expect(seen).toEqual([]);
  });

  it('counts slow frames but ignores real stalls', () => {
    const { c, seen } = make(TIERS.high);
    let now = run(c, 5, 16); // past warm-up soon enough
    now = run(c, 100, 16, now);
    for (let i = 0; i < 200; i++) {
      now += 400;
      c.frame(now, 400); // tab-switch style stalls
    }
    expect(seen).toEqual([]);
  });

  it('waits out the cooldown after a change, and never goes below Low', () => {
    const { c, seen } = make(TIERS.medium);
    const t = run(c, 100, 62);
    run(c, 300, 62, t);
    expect(seen[0]).toBe('low');
    expect(seen).toHaveLength(1);
  });

  it('does nothing when disabled (a forced ?quality=)', () => {
    const { c, seen } = make(TIERS.high);
    c.enabled = false;
    run(c, 300, 62);
    expect(seen).toEqual([]);
  });
});
