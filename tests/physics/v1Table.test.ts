import { describe, expect, it } from 'vitest';
import { Rng } from '../../src/core/rng';
import { defaultParams } from '../../src/physics/params';
import { World, type PhysicsEvent } from '../../src/physics/world';
import { v1Table } from '../../src/table/v1Table';
import { flipShot, type Feed, type ShotResult } from './shots';

// M1 whitebox acceptance (docs/MVP/07 § M1): every shot makeable, ramp threshold, no stuck balls.

const world = (): World => new World(v1Table, defaultParams());

function run(w: World, ms: number, until?: (e: PhysicsEvent) => boolean): PhysicsEvent[] {
  const seen: PhysicsEvent[] = [];
  for (let i = 0; i < ms; i++) {
    w.step();
    for (const e of w.events) {
      seen.push(e);
      if (until?.(e)) {
        w.events.length = 0;
        return seen;
      }
    }
    w.events.length = 0;
  }
  return seen;
}

describe('v1 table: shot map', () => {
  it('makes every major shot from the flippers', () => {
    const made = new Map<ShotResult, string>();
    const sweep = (side: 'L' | 'R', feed: Feed, from: number, to: number) => {
      for (let d = from; d <= to; d += 4) {
        const r = flipShot(side, feed, d);
        if (!made.has(r)) made.set(r, `${side} ${feed} @${d}ms`);
      }
    };
    sweep('L', 'inlane', 680, 1000);
    sweep('R', 'inlane', 680, 1000);
    sweep('L', 'pitch', 100, 270);
    sweep('R', 'pitch', 100, 270);
    for (const shot of [
      'orbit.L',
      'orbit.R',
      'ramp.HR',
      'ramp.STEAL',
      'gap.1B',
      'gap.2B',
      'drop',
      'standup',
    ] as const) {
      expect(made.has(shot), `${shot} should be makeable`).toBe(true);
    }
  });
});

describe('v1 table: W-A-L-K bank', () => {
  it('has four full-size standups spelling WALK, end to end, out from the wall', () => {
    const standups = v1Table.elements.flatMap((e) => (e.type === 'standup' ? [e] : []));
    expect(standups.map((e) => e.id)).toEqual(['standup.W', 'standup.A', 'standup.L', 'standup.K']);
    for (const e of standups) {
      const len = Math.hypot(e.b[0] - e.a[0], e.b[1] - e.a[1]);
      expect(len).toBeCloseTo(26, 0);
    }
    // WALK reads left to right as the player sees the board: W is the left-most plate.
    const midX = (e: (typeof standups)[number]): number => (e.a[0] + e.b[0]) / 2;
    expect(standups.map(midX)).toEqual([...standups.map(midX)].sort((l, r) => l - r));
    const lamps = v1Table.elements.flatMap((e) =>
      e.type === 'lamp' && e.id.startsWith('lamp.standup.') ? [e] : [],
    );
    expect(lamps.map((l) => l.id)).toEqual([
      'lamp.standup.W',
      'lamp.standup.A',
      'lamp.standup.L',
      'lamp.standup.K',
    ]);
  });
});

describe('v1 table: outfield bumpers and the HUSTLE meter', () => {
  it('has two outfield bumpers (off the Gap) and five hustle lamps', () => {
    const pops = v1Table.elements.flatMap((e) => (e.type === 'pop' ? [e.id] : []));
    expect(pops.filter((id) => id.startsWith('pop.OF.'))).toEqual(['pop.OF.L', 'pop.OF.R']);
    // Four Gap pops and the outfield pair; the mound's wedge is a separate element.
    expect(pops).toHaveLength(6);
    expect(v1Table.elements.flatMap((e) => (e.type === 'rampBumper' ? [e.id] : []))).toEqual([
      'pop.mound',
    ]);
    const lamps = v1Table.elements.flatMap((e) =>
      e.type === 'lamp' && e.id.startsWith('hustle.') ? [e.id] : [],
    );
    expect(lamps).toEqual(['hustle.1', 'hustle.2', 'hustle.3', 'hustle.4', 'hustle.5']);
  });
});

describe('v1 table: ramps', () => {
  const fireAtHr = (speed: number): World => {
    const w = world();
    const b = w.addBall(0.152, 0.755);
    const dx = -0.012;
    const dy = 0.035;
    const len = Math.sqrt(dx * dx + dy * dy);
    b.vx = (dx / len) * speed;
    b.vy = (dy / len) * speed;
    return w;
  };

  it('has a sensible make threshold (rollback below, made above)', () => {
    const crests = (v: number) => run(fireAtHr(v), 1500).some((e) => e.id === 'gate.HR');
    expect(crests(1.0)).toBe(false);
    expect(crests(1.8)).toBe(true);
    let lo = 1.0;
    let hi = 1.8;
    for (let i = 0; i < 10; i++) {
      const mid = (lo + hi) / 2;
      if (crests(mid)) hi = mid;
      else lo = mid;
    }
    console.log(`HR ramp make threshold ≈ ${hi.toFixed(2)} m/s at the entrance`);
    expect(hi).toBeGreaterThan(1.2);
    expect(hi).toBeLessThan(1.8);
  });

  it('always brings a made ramp home to the left inlane', () => {
    for (const v of [1.8, 2.2, 2.6, 3.0, 3.5, 4.5]) {
      const events = run(fireAtHr(v), 4000, (e) => e.id === 'inlane.L');
      expect(
        events.some((e) => e.id === 'gate.HR'),
        `${v} m/s crests`,
      ).toBe(true);
      expect(
        events.some((e) => e.id === 'inlane.L'),
        `${v} m/s returns`,
      ).toBe(true);
    }
  });
});

describe('v1 table: devices', () => {
  it('plunger: a full plunge loops the orbit, a medium one drops into the top lanes', () => {
    const plunge = (pull: number) => {
      const w = world();
      w.serveBall();
      w.setPlunger(true);
      run(w, Math.round(pull * w.params.plungerPullTime * 1000));
      w.setPlunger(false);
      return run(w, 3000);
    };
    expect(plunge(1).some((e) => e.id === 'kicker.3B.L')).toBe(true);
    // The skill-shot window: a soft plunge that just reaches the top drops into R-B-I.
    const soft = [0.44, 0.46, 0.48, 0.5].map((pull) =>
      plunge(pull).some((e) => e.id.startsWith('lane.')),
    );
    expect(soft.filter(Boolean).length).toBeGreaterThanOrEqual(2);
  });

  it('kickback saves an outlane ball once, then is spent', () => {
    const w = world();
    const b = w.addBall(0.02, 0.3);
    // The kickback launches the ball up out of the outlane (its top is at y = 0.38 m). Where the
    // ball is a second and a half later depends on where it bounces, so check how high it got.
    let highest = 0;
    const saved: PhysicsEvent[] = [];
    for (let i = 0; i < 1500; i++) {
      w.step();
      saved.push(...w.events);
      w.events.length = 0;
      highest = Math.max(highest, b.py);
    }
    expect(saved.some((e) => e.type === 'kickback')).toBe(true);
    expect(saved.some((e) => e.type === 'drain')).toBe(false);
    expect(highest).toBeGreaterThan(0.45);
    const again = world();
    again.setKickbackArmed('kickback.L', false);
    again.addBall(0.02, 0.3);
    expect(run(again, 1500).some((e) => e.type === 'drain')).toBe(true);
  });

  it('saucers catch a slow ball and let a fast one skim over', () => {
    // CF on a bare playfield. A ball rolled gently up into the dish settles in it; one rolled fast
    // across it skims over.
    const cf = v1Table.elements.find((e) => e.type === 'saucer' && e.id === 'saucer.CF')!;
    if (cf.type !== 'saucer') throw new Error('no CF');
    const bare = { ...v1Table, elements: [cf] };
    const roll = (dx: number, dy: number, vx: number, vy: number) => {
      const w = new World(bare, defaultParams());
      const b = w.addBall((cf.x + dx) / 1000, (cf.y + dy) / 1000);
      b.vx = vx;
      b.vy = vy;
      return run(w, 2000, (e) => e.type === 'saucer').some((e) => e.id === 'saucer.CF');
    };
    expect(roll(0, -15, 0, 0.2)).toBe(true);
    expect(roll(-50, 0, 2.5, 0)).toBe(false);
  });
});

describe('v1 table: the Bullpen and multiball', () => {
  it('the reliever parked in the Bullpen is on show, stays put when struck, and enters on cue', () => {
    const bp = v1Table.elements.find((e) => e.type === 'saucer' && e.id === 'saucer.BULLPEN')!;
    if (bp.type !== 'saucer') throw new Error('no Bullpen');
    const w = world();
    w.parkBall('saucer.BULLPEN');
    const reliever = w.balls.find((b) => b.parkedIn === 'saucer.BULLPEN')!;
    expect(reliever.active).toBe(false);
    expect(w.isSaucerHolding('saucer.BULLPEN')).toBe(true);
    // A ball rolled up into him: a hit, and he does not budge.
    const b = w.addBall(bp.x / 1000, (bp.y - 45) / 1000);
    b.vy = 0.8;
    expect(run(w, 1000, (e) => e.type === 'parkedHit').some((e) => e.id === 'saucer.BULLPEN')).toBe(
      true,
    );
    expect(reliever.px).toBeCloseTo(bp.x / 1000, 6);
    expect(reliever.py).toBeCloseTo(bp.y / 1000, 6);
    // Kicked out, he is a ball in play.
    expect(w.kickOutSaucer('saucer.BULLPEN', 1.4, 270)).toBe(true);
    expect(reliever.active).toBe(true);
    expect(reliever.parkedIn).toBeNull();
    expect(w.activeBalls()).toHaveLength(2);
  });

  it('serves and pitches never take the parked reliever', () => {
    const w = world();
    w.serveBall();
    w.parkBall('saucer.BULLPEN');
    w.balls[0]!.active = false;
    const pitched = w.pitchBall(0.22, 0.18, 1);
    expect(pitched?.parkedIn).toBeNull();
    expect(w.balls.filter((b) => b.parkedIn)).toHaveLength(1);
  });

  it('two balls collide instead of passing through each other', () => {
    const bare = { ...v1Table, elements: [] };
    const w = new World(bare, defaultParams());
    const a = w.addBall(0.2, 0.6);
    const b = w.addBall(0.3, 0.6);
    a.vx = 1;
    b.vx = -1;
    let closest = 1;
    for (let i = 0; i < 200; i++) {
      w.step();
      closest = Math.min(closest, Math.hypot(b.px - a.px, b.py - a.py));
    }
    expect(closest).toBeGreaterThan(2 * a.radius - 0.001);
    // Head on with equal masses, they bounce back off each other.
    expect(a.vx).toBeLessThan(0);
    expect(b.vx).toBeGreaterThan(0);
  });

  it('a switch fires for each ball that crosses it, not for two balls on either side of it', () => {
    const w = world();
    // The Gap mouth's switch is the line y = 815 between x = 242 and 308.
    const above = w.addBall(0.275, 0.84);
    const below = w.addBall(0.275, 0.79);
    above.vy = below.vy = 0;
    const fired = run(w, 50).filter((e) => e.id === 'gap.mouth');
    expect(fired.length).toBeLessThanOrEqual(1);
  });

  it('a saucer catches a ball while another is in play elsewhere', () => {
    const w = world();
    const cf = v1Table.elements.find((e) => e.type === 'saucer' && e.id === 'saucer.CF')!;
    if (cf.type !== 'saucer') throw new Error('no CF');
    const b = w.addBall(cf.x / 1000, (cf.y - 15) / 1000);
    b.vy = 0.2;
    const other = w.addBall(0.275, 0.6);
    other.vx = 1.5;
    expect(run(w, 2000, (e) => e.type === 'saucer').some((e) => e.id === 'saucer.CF')).toBe(true);
  });
});

describe('v1 table: stuck balls', () => {
  it('no ball comes to rest outside a cradle or a saucer', () => {
    const rng = new Rng(5);
    const stuck: string[] = [];
    for (let trial = 0; trial < 200; trial++) {
      const w = world();
      const b = w.addBall(rng.range(0.06, 0.49), rng.range(0.62, 0.74));
      b.vx = rng.range(-3, 3);
      b.vy = rng.range(-2, 3);
      const mode = trial % 3;
      let still = 0;
      for (let i = 0; i < 20000 && b.active; i++) {
        if (mode === 1 && i % 250 === 0) {
          w.setFlipper('flipper.L', rng.next() < 0.35);
          w.setFlipper('flipper.R', rng.next() < 0.35);
        }
        w.step();
        w.events.length = 0;
        if (w.saucers.some((s) => s.holding)) break;
        still = b.speed() < 0.01 ? still + 1 : 0;
        if (still > 2000) {
          if (!w.flippers.some((f) => f.pressed))
            stuck.push(
              `trial ${trial} at (${(b.px * 1000).toFixed(0)}, ${(b.py * 1000).toFixed(0)})`,
            );
          break;
        }
      }
    }
    expect(stuck).toEqual([]);
  });
});
