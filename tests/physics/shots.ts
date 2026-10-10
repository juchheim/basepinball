import { defaultParams } from '../../src/physics/params';
import { World, type PhysicsEvent } from '../../src/physics/world';
import { v1Table } from '../../src/table/v1Table';

/** What a flip achieved: the first decisive event after the ball leaves the flipper. */
export type ShotResult =
  | 'orbit.L'
  | 'orbit.R'
  | 'ramp.HR'
  | 'ramp.STEAL'
  | 'gap.1B'
  | 'gap.2B'
  | 'drop'
  | 'standup'
  | `saucer.${string}`
  | 'drain'
  | 'none';

export function classify(e: PhysicsEvent): ShotResult | null {
  if (e.type === 'kicker') return e.id.endsWith('.L') ? 'orbit.L' : 'orbit.R';
  if (e.type === 'sensor' && e.id === 'gate.HR') return 'ramp.HR';
  if (e.type === 'sensor' && e.id === 'gate.STEAL') return 'ramp.STEAL';
  if (e.type === 'pop') return e.id.startsWith('pop.2B') ? 'gap.2B' : 'gap.1B';
  if (e.type === 'drop') return 'drop';
  if (e.type === 'standup') return 'standup';
  if (e.type === 'saucer') return `saucer.${e.id.slice(7)}`;
  if (e.type === 'drain') return 'drain';
  return null;
}

export type Feed = 'inlane' | 'pitch';

/**
 * Feed a ball to `side`'s flipper (rolling down its inlane, or pitched from the mound at its
 * sweet spot), flip `delayMs` after the feed starts, and report the first decisive result.
 */
export function flipShot(side: 'L' | 'R', feed: Feed, delayMs: number, holdMs = 160): ShotResult {
  const w = new World(v1Table, defaultParams());
  const sign = side === 'L' ? 1 : -1;
  const cx = side === 'L' ? 0 : 0.55;
  if (feed === 'inlane') {
    const b = w.addBall(cx + sign * 0.064, 0.395);
    b.vy = -0.9;
  } else {
    w.pitchBall(cx + sign * 0.216, 0.19, 1.1);
  }
  const id = side === 'L' ? 'flipper.L' : 'flipper.R';
  let flippedAt = -1;
  for (let i = 0; i < 3500; i++) {
    if (i === delayMs) {
      w.setFlipper(id, true);
      flippedAt = i;
    }
    if (flippedAt >= 0 && i === flippedAt + holdMs) w.setFlipper(id, false);
    w.step();
    for (const e of w.events) {
      // Ignore anything before the flip (e.g. the ball passing a sling on the way down).
      if (flippedAt < 0) continue;
      const r = classify(e);
      if (r) return r;
    }
    w.events.length = 0;
  }
  return 'none';
}
