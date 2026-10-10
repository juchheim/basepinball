import { describe, expect, it } from 'vitest';
import { emptyTable, makeWorld, runFor } from './helpers';
import type { PhysicsEvent } from '../../src/physics/world';

function collect(w: { events: PhysicsEvent[] }, into: PhysicsEvent[]) {
  return () => {
    into.push(...w.events);
    w.events.length = 0;
  };
}

describe('devices', () => {
  it('pop bumper kicks the ball away at kick speed', () => {
    const w = makeWorld(emptyTable([{ type: 'pop', id: 'pop', x: 300, y: 400, radius: 22 }]));
    const b = w.addBall(0.3, 0.33);
    b.vy = 1;
    const events: PhysicsEvent[] = [];
    runFor(w, 0.1, collect(w, events));
    expect(events.filter((e) => e.type === 'pop')).toHaveLength(1);
    expect(b.vy).toBeLessThan(-w.params.popKickSpeed * 0.9);
  });

  it('slingshot only fires above its threshold', () => {
    const sling = { type: 'sling' as const, id: 'sl', corner: [200, 300] as const, top: [200, 450] as const, bottom: [300, 300] as const };
    const fast = makeWorld(emptyTable([sling]));
    const b = fast.addBall(0.3, 0.42);
    b.vx = -1.5;
    b.vy = -1.0;
    const ev: PhysicsEvent[] = [];
    runFor(fast, 0.2, collect(fast, ev));
    expect(ev.some((e) => e.type === 'sling')).toBe(true);

    const slow = makeWorld(emptyTable([sling]));
    const b2 = slow.addBall(0.275, 0.4);
    b2.vx = -0.1;
    b2.vy = -0.1;
    const ev2: PhysicsEvent[] = [];
    runFor(slow, 0.3, collect(slow, ev2));
    expect(ev2.some((e) => e.type === 'sling')).toBe(false);
  });

  it('drop target falls when hit hard and lets the ball through', () => {
    const w = makeWorld(emptyTable([{ type: 'drop', id: 'd', a: [250, 400], b: [350, 400] }]));
    const b = w.addBall(0.3, 0.35);
    b.vy = 2;
    const ev: PhysicsEvent[] = [];
    runFor(w, 0.05, collect(w, ev));
    expect(ev.some((e) => e.type === 'drop')).toBe(true);
    expect(w.isDropDown('d')).toBe(true);
  });

  it('saucer captures a slow ball and lets a fast one skim across', () => {
    const saucer = { type: 'saucer' as const, id: 's', x: 300, y: 400, radius: 20, depth: 7, lipAngle: 90 };
    const slow = makeWorld(emptyTable([saucer]));
    const b = slow.addBall(0.3, 0.34);
    b.vy = 0.45;
    const ev: PhysicsEvent[] = [];
    runFor(slow, 1.5, collect(slow, ev));
    expect(ev.some((e) => e.type === 'saucer')).toBe(true);

    const fast = makeWorld(emptyTable([saucer]));
    const b2 = fast.addBall(0.24, 0.36);
    b2.vx = 3;
    b2.vy = 0.5;
    const ev2: PhysicsEvent[] = [];
    runFor(fast, 0.3, collect(fast, ev2));
    expect(ev2.some((e) => e.type === 'saucer')).toBe(false);
  });

  it('drains below the drain line', () => {
    const w = makeWorld();
    const b = w.addBall(0.275, 0.12);
    const ev: PhysicsEvent[] = [];
    runFor(w, 1, collect(w, ev));
    expect(b.active).toBe(false);
    expect(ev.some((e) => e.type === 'drain')).toBe(true);
  });
});
