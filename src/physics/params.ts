/**
 * Tunable physics parameters (SI units). Starting values from docs/MVP/03-physics.md § 10.
 * Everything here is live-editable from the debug panel; nothing is baked into colliders.
 */

export interface Material {
  /** Restitution at or below `vLow` impact speed. */
  eLow: number;
  /** Restitution at or above `vHigh` impact speed. */
  eHigh: number;
  vLow: number;
  vHigh: number;
  /** Coulomb friction coefficient. */
  friction: number;
}

export type MaterialName =
  | 'playfield'
  | 'wood'
  | 'metal'
  | 'rubberPost'
  | 'rubberSling'
  | 'rubberFlipper'
  | 'popBumper'
  | 'dropTarget'
  | 'glass';

export interface FlipperParams {
  /** Effective mass of bat + linkage (kg), spread along the bat. */
  mass: number;
  /** Coil torque during the stroke (N·m). */
  coilTorque: number;
  /** Hold torque after end-of-stroke (N·m). */
  holdTorque: number;
  /** Return-spring torque (N·m). */
  returnTorque: number;
  /** Restitution of the bat against its end-of-stroke stop. */
  eosBounce: number;
  /** Restitution of the bat against its rest stop. */
  restBounce: number;
}

export interface PhysicsParams {
  /** Fixed step rate (Hz). */
  rate: number;
  /** Max ball travel per substep (m); sets the adaptive substep count. */
  maxSubstepTravel: number;
  maxSubsteps: number;
  gravity: number;
  slopeDeg: number;
  ballRadius: number;
  ballMass: number;
  /** Rolling resistance coefficient (dimensionless, × normal accel). */
  rollingResistance: number;
  /** Below this approach speed (m/s) impacts are treated as resting (no bounce). */
  restingSpeed: number;
  /** Positional correction slop (m). */
  slop: number;
  glassHeight: number;
  flipper: FlipperParams;
  slingKickSpeed: number;
  slingThreshold: number;
  popKickSpeed: number;
  popThreshold: number;
  dropThreshold: number;
  /** Saucer capture: max speed (m/s) and settle time (s). */
  saucerCaptureSpeed: number;
  saucerCaptureTime: number;
  maxBallSpeed: number;
  materials: Record<MaterialName, Material>;
}

export function defaultParams(): PhysicsParams {
  return {
    rate: 1000,
    maxSubstepTravel: 0.002,
    maxSubsteps: 32,
    gravity: 9.81,
    slopeDeg: 6.5,
    ballRadius: 0.0135,
    ballMass: 0.08,
    rollingResistance: 0.004,
    restingSpeed: 0.05,
    slop: 0.00005,
    glassHeight: 0.09,
    flipper: {
      mass: 0.1,
      coilTorque: 1.1,
      holdTorque: 0.2,
      returnTorque: 0.15,
      eosBounce: 0.25,
      restBounce: 0.2,
    },
    slingKickSpeed: 2.6,
    slingThreshold: 0.35,
    popKickSpeed: 3.4,
    popThreshold: 0.12,
    dropThreshold: 0.35,
    saucerCaptureSpeed: 0.15,
    saucerCaptureTime: 0.04,
    maxBallSpeed: 20,
    materials: {
      playfield: { eLow: 0.25, eHigh: 0.25, vLow: 0.5, vHigh: 5, friction: 0.15 },
      wood: { eLow: 0.45, eHigh: 0.35, vLow: 0.5, vHigh: 5, friction: 0.12 },
      metal: { eLow: 0.5, eHigh: 0.4, vLow: 0.5, vHigh: 5, friction: 0.1 },
      rubberPost: { eLow: 0.85, eHigh: 0.55, vLow: 0.5, vHigh: 6, friction: 0.3 },
      rubberSling: { eLow: 0.8, eHigh: 0.55, vLow: 0.5, vHigh: 6, friction: 0.3 },
      rubberFlipper: { eLow: 0.6, eHigh: 0.35, vLow: 0.5, vHigh: 6, friction: 0.4 },
      popBumper: { eLow: 0.6, eHigh: 0.5, vLow: 0.5, vHigh: 5, friction: 0.2 },
      dropTarget: { eLow: 0.4, eHigh: 0.3, vLow: 0.5, vHigh: 5, friction: 0.15 },
      glass: { eLow: 0.3, eHigh: 0.3, vLow: 0.5, vHigh: 5, friction: 0.05 },
    },
  };
}

export function restitution(m: Material, impactSpeed: number): number {
  if (impactSpeed <= m.vLow) return m.eLow;
  if (impactSpeed >= m.vHigh) return m.eHigh;
  const t = (impactSpeed - m.vLow) / (m.vHigh - m.vLow);
  return m.eLow + (m.eHigh - m.eLow) * t;
}
