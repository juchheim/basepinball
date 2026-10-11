import type { Rng } from '../core/rng';

/**
 * Pitching director (docs/MVP/01 § 4.6). Pitches are drawn from templates that a physics test
 * validates (tests/rules/pitching.test.ts): with no swing, every template reaches a flipper's
 * sweet zone (25-75 % of its length) without touching anything else first, then drains. No pitch
 * can go straight down the middle.
 */

export type PitchType = 'FB' | 'CH' | 'CB';
export type Side = 'L' | 'R';

export interface PitchSpec {
  type: PitchType;
  side: Side;
  /** Aim point for the ball centre (m, playfield coordinates). */
  targetX: number;
  targetY: number;
  /** Release speed (m/s). */
  speed: number;
  /** Curveball magnet: seconds after release to switch on, how long, and power (0-1). */
  curve: { delay: number; duration: number; power: number } | null;
}

/** Ball-centre aim points (m) over the middle of each resting flipper. */
const SWEET: Record<Side, { x: number; y: number }> = {
  L: { x: 0.221, y: 0.175 },
  R: { x: 0.329, y: 0.175 },
};

/**
 * Base aim offset (m, from the sweet point, + = toward the tip) that lands a straight pitch of the
 * given speed on the middle of the bat. Slow pitches are bent toward the tip by the playfield's
 * slope on the way down, so they are aimed further toward the pivot. Measured with the physics
 * (tests/rules/pitching.test.ts); linear between the samples.
 */
const AIM_FOR_SPEED: [speed: number, offset: number][] = [
  [0.28, -0.06],
  [0.32, -0.052],
  [0.36, -0.0415],
  [0.42, -0.029],
  [0.48, -0.0225],
  [0.55, -0.018],
  [0.62, -0.0135],
];

export function aimForSpeed(speed: number): number {
  const last = AIM_FOR_SPEED.length - 1;
  for (let i = 1; i <= last; i++) {
    const [v1, a1] = AIM_FOR_SPEED[i - 1]!;
    const [v2, a2] = AIM_FOR_SPEED[i]!;
    if (speed <= v2 || i === last) return a1 + ((a2 - a1) * (speed - v1)) / (v2 - v1);
  }
  return 0;
}

export interface PitchTemplate {
  type: PitchType;
  /** Speed range (m/s), scaled up within it as innings progress. */
  speed: [number, number];
  /** Extra aim offset (m) on top of {@link aimForSpeed} (+ = toward the flipper tip / centre). */
  aimOffset: number;
  /** Random aim jitter (± m). */
  aimJitter: number;
  curve: PitchSpec['curve'];
}

// Pitches are slow enough to read and react to: a fastball reaches the bat ~0.33-0.40 s after
// release, a change-up ~0.45-0.49 s (the slope does much of the work at these speeds).
export const TEMPLATES: Record<PitchType, PitchTemplate> = {
  FB: { type: 'FB', speed: [0.42, 0.56], aimOffset: 0, aimJitter: 0.006, curve: null },
  CH: { type: 'CH', speed: [0.28, 0.34], aimOffset: 0, aimJitter: 0.006, curve: null },
  // A curveball is aimed 45 mm outside (it would clip the bat near the pivot) and the magnet under
  // the mound bends it back onto the middle of the bat: a visible break.
  CB: {
    type: 'CB',
    speed: [0.36, 0.46],
    aimOffset: -0.045,
    aimJitter: 0.003,
    curve: { delay: 0.04, duration: 0.2, power: 0.6 },
  },
};

/** Pitch mix by inning (docs/MVP/01 § 4.6): weights for FB / CH / CB. */
export function pitchMix(inning: number): Record<PitchType, number> {
  if (inning <= 3) return { FB: 0.6, CH: 0.4, CB: 0 };
  if (inning <= 6) return { FB: 0.45, CH: 0.3, CB: 0.25 };
  return { FB: 0.45, CH: 0.2, CB: 0.35 };
}

/** Builds the concrete pitch for a template, side and inning (speed rises with the innings). */
export function buildPitch(t: PitchTemplate, side: Side, inning: number, rng: Rng): PitchSpec {
  const sweet = SWEET[side];
  // + offset moves toward the tip: right for the left flipper, left for the right flipper.
  const dir = side === 'L' ? 1 : -1;
  const progress = Math.min(1, Math.max(0, (inning - 1) / 8));
  const lo = t.speed[0] + (t.speed[1] - t.speed[0]) * progress * 0.6;
  const speed = rng.range(lo, lo + (t.speed[1] - t.speed[0]) * 0.4);
  const aim = aimForSpeed(speed) + t.aimOffset + rng.range(-t.aimJitter, t.aimJitter);
  return {
    type: t.type,
    side,
    targetX: sweet.x + dir * aim,
    targetY: sweet.y,
    speed,
    curve: t.curve,
  };
}

export function choosePitch(inning: number, rng: Rng): PitchSpec {
  const mix = pitchMix(inning);
  const r = rng.next();
  const type: PitchType = r < mix.FB ? 'FB' : r < mix.FB + mix.CH ? 'CH' : 'CB';
  const side: Side = rng.next() < 0.5 ? 'L' : 'R';
  return buildPitch(TEMPLATES[type], side, inning, rng);
}
