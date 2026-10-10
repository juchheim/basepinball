import { describe, expect, it } from 'vitest';
import { dcos, dsin } from '../src/core/dmath';
import { Rng } from '../src/core/rng';

describe('deterministic math', () => {
  it('matches Math.sin/cos to within 1e-15 on the physics range', () => {
    for (let x = -20; x <= 20; x += 0.001237) {
      expect(Math.abs(dsin(x) - Math.sin(x))).toBeLessThan(1e-15);
      expect(Math.abs(dcos(x) - Math.cos(x))).toBeLessThan(1e-15);
    }
  });
});

describe('seeded rng', () => {
  it('is reproducible and roughly uniform', () => {
    const a = new Rng(42);
    const b = new Rng(42);
    let sum = 0;
    for (let i = 0; i < 10_000; i++) {
      const x = a.next();
      expect(x).toBe(b.next());
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
      sum += x;
    }
    expect(sum / 10_000).toBeGreaterThan(0.48);
    expect(sum / 10_000).toBeLessThan(0.52);
  });
});
