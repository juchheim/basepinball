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

export interface PitchTemplate {
  type: PitchType;
  /** Speed range (m/s), scaled up within it as innings progress. */
  speed: [number, number];
  /** Horizontal aim offset from the sweet point (m, + = toward the flipper tip / centre). */
  aimOffset: number;
  /** Random aim jitter (± m). */
  aimJitter: number;
  curve: PitchSpec['curve'];
}

export const TEMPLATES: Record<PitchType, PitchTemplate> = {
  // Calibrated against the physics (tests/rules/pitching.test.ts): contact lands at ~50 % of the bat.
  FB: { type: 'FB', speed: [1.15, 1.45], aimOffset: 0, aimJitter: 0.006, curve: null },
  CH: { type: 'CH', speed: [0.7, 0.85], aimOffset: -0.006, aimJitter: 0.006, curve: null },
  // A curveball is aimed ~28 mm outside the bat (it would hit near the pivot) and the magnet under
  // the mound bends it ~20 mm back onto the middle of the bat: a visible late break.
  CB: {
    type: 'CB',
    speed: [0.95, 1.1],
    aimOffset: -0.028,
    aimJitter: 0.003,
    curve: { delay: 0.04, duration: 0.2, power: 1 },
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
  const aim = t.aimOffset + rng.range(-t.aimJitter, t.aimJitter);
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
