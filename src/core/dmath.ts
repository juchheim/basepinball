/**
 * Deterministic math for the physics step.
 *
 * `Math.sin`/`Math.cos` are implementation-defined and can differ between JS engines, which
 * would break cross-engine replay validation (docs/MVP/03-physics.md § 8). These versions use
 * only IEEE-754 basic arithmetic (correctly rounded everywhere), so results are bit-identical
 * across V8, JavaScriptCore and SpiderMonkey.
 *
 * Range reduction + polynomial kernels follow the classic fdlibm approach (accurate to ~1 ulp
 * for |x| < 1e5, far beyond what a flipper angle needs).
 */

const INV_PIO2 = 6.36619772367581382433e-1;
const PIO2_1 = 1.57079632673412561417e0; // first 33 bits of pi/2
const PIO2_1T = 6.07710050650619224932e-11; // pi/2 - PIO2_1

const S1 = -1.66666666666666324348e-1;
const S2 = 8.33333333332248946124e-3;
const S3 = -1.98412698298579493134e-4;
const S4 = 2.75573137070700676789e-6;
const S5 = -2.50507602534068634195e-8;
const S6 = 1.58969099521155010221e-10;

const C1 = 4.16666666666666019037e-2;
const C2 = -1.38888888888741095749e-3;
const C3 = 2.48015872894767294178e-5;
const C4 = -2.75573143513906633035e-7;
const C5 = 2.08757232129817482790e-9;
const C6 = -1.13596475577881948265e-11;

function kernelSin(x: number): number {
  const z = x * x;
  const v = z * x;
  const r = S2 + z * (S3 + z * (S4 + z * (S5 + z * S6)));
  return x + v * (S1 + z * r);
}

function kernelCos(x: number): number {
  const z = x * x;
  const r = z * (C1 + z * (C2 + z * (C3 + z * (C4 + z * (C5 + z * C6)))));
  return 1 - (0.5 * z - z * r);
}

/** Reduces x to [-pi/4, pi/4]; returns the reduced value and the quadrant (0-3). */
function reduce(x: number, out: { y: number; q: number }): void {
  const k = Math.round(x * INV_PIO2);
  out.y = x - k * PIO2_1 - k * PIO2_1T;
  out.q = ((k % 4) + 4) % 4;
}

const scratch = { y: 0, q: 0 };

export function dsin(x: number): number {
  reduce(x, scratch);
  const y = scratch.y;
  switch (scratch.q) {
    case 0:
      return kernelSin(y);
    case 1:
      return kernelCos(y);
    case 2:
      return -kernelSin(y);
    default:
      return -kernelCos(y);
  }
}

export function dcos(x: number): number {
  reduce(x, scratch);
  const y = scratch.y;
  switch (scratch.q) {
    case 0:
      return kernelCos(y);
    case 1:
      return -kernelSin(y);
    case 2:
      return -kernelCos(y);
    default:
      return kernelSin(y);
  }
}

export const DEG = Math.PI / 180;

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
