/**
 * Quality tiers and the adaptive controller (docs/MVP/04 § 6). The starting tier comes from the
 * device (or `?quality=low|medium|high|ultra`); if frames stay slow, the controller steps down.
 */

export type TierName = 'low' | 'medium' | 'high' | 'ultra';

export interface Quality {
  name: TierName;
  /** Device-pixel-ratio cap. */
  dpr: number;
  /** Cap on the canvas's total pixels, so a huge Retina window can't exhaust GPU memory. */
  maxPixels: number;
  /** Shadow-casting key lights (0-2) and shadow map size. */
  shadowLights: number;
  shadowMapSize: number;
  /**
   * Dynamic ball reflections: cube size (0 = static environment only) and frames per full refresh
   * (the six faces are drawn round robin, `6 / reflectionEvery` a frame: 1, 2, 3 or 6).
   */
  reflectionSize: number;
  reflectionEvery: number;
  bloom: boolean;
  /** MSAA samples on the scene pass (0 or 4). 4x MSAA on two 16-bit targets is ~600 MB at Retina size. */
  msaa: 0 | 4;
  /** FXAA edge smoothing, the cheap replacement for MSAA. */
  fxaa: boolean;
  /** Playfield texture width (px). */
  playfieldTexture: number;
  /** Crowd figures in the stands. */
  crowd: number;
}

export const TIERS: Record<TierName, Quality> = {
  low: {
    name: 'low',
    dpr: 1,
    maxPixels: 1.5e6,
    shadowLights: 0,
    shadowMapSize: 1024,
    reflectionSize: 0,
    reflectionEvery: 0,
    bloom: false,
    msaa: 0,
    fxaa: false,
    playfieldTexture: 2048,
    crowd: 300,
  },
  medium: {
    name: 'medium',
    dpr: 1.5,
    maxPixels: 3e6,
    shadowLights: 1,
    shadowMapSize: 1024,
    reflectionSize: 64,
    reflectionEvery: 3,
    bloom: true,
    msaa: 0,
    fxaa: true,
    playfieldTexture: 2048,
    crowd: 900,
  },
  high: {
    name: 'high',
    dpr: 2,
    maxPixels: 6e6,
    shadowLights: 2,
    shadowMapSize: 2048,
    reflectionSize: 128,
    reflectionEvery: 2,
    bloom: true,
    msaa: 0,
    fxaa: true,
    // 2048 px is already about twice the playfield's on-screen width; 4096 px costs ~180 MB of GPU
    // memory, so only Ultra uses it.
    playfieldTexture: 2048,
    crowd: 2200,
  },
  ultra: {
    name: 'ultra',
    dpr: 3,
    maxPixels: 12e6,
    shadowLights: 2,
    shadowMapSize: 2048,
    reflectionSize: 256,
    reflectionEvery: 1,
    bloom: true,
    msaa: 4,
    fxaa: false,
    playfieldTexture: 4096,
    crowd: 4000,
  },
};

const ORDER: TierName[] = ['low', 'medium', 'high', 'ultra'];

/** What we know about the device before the first frame. */
export interface DeviceHints {
  /** A phone or tablet (touch-first), or a small screen. */
  mobile: boolean;
  /** Safari (desktop or iOS): its GPU path is much heavier on memory and per-frame cost. */
  safari: boolean;
}

export function deviceHints(): DeviceHints {
  const coarse = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;
  const small = typeof screen !== 'undefined' && Math.min(screen.width, screen.height) < 700;
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  const safari = /safari/i.test(ua) && !/chrome|chromium|crios|fxios|edg|android/i.test(ua);
  return { mobile: coarse || small, safari };
}

/**
 * The tier to start at. `?quality=` forces one. Phones, Safari and the WebGL2 renderer start at
 * Medium: a Safari tester saw the canvas blank for several seconds at High (16 fps on the WebGL2
 * renderer) until the controller stepped down. Everything else starts at High and steps down if
 * it cannot keep up.
 */
export function initialTier(
  query: URLSearchParams,
  backend: 'WebGPU' | 'WebGL2' | string,
  hints: DeviceHints = deviceHints(),
): Quality {
  const forced = query.get('quality') as TierName | null;
  if (forced && TIERS[forced]) return TIERS[forced];
  return hints.mobile || hints.safari || backend !== 'WebGPU' ? TIERS.medium : TIERS.high;
}

/**
 * Watches frame times and steps the tier down when the game cannot hold its frame rate. It judges
 * the median of 45 frames (under a second at 60 fps), skips the first moments after start and after
 * a change (shader compiles). One tier down when the median is under about 30 fps, two at once
 * under about 22 fps (a struggling GPU gets worse, not better, the longer it is left alone). A
 * step down changes only the resolution and crowd (see `Stage.applyQuality`), because anything that
 * changes shaders stalls Safari for seconds. The bar is low (not 45 fps) so a busy moment or a
 * busy machine does not trigger a step.
 */
export class AdaptiveQuality {
  private samples: number[] = [];
  private cooldownUntil = -1;
  enabled = true;

  constructor(
    public tier: Quality,
    private readonly apply: (q: Quality) => void,
  ) {}

  frame(now: number, dtMs: number): void {
    if (!this.enabled) return;
    // The first frames compile shaders and upload textures: judge nothing until they settle.
    if (this.cooldownUntil < 0) this.cooldownUntil = now + 1500;
    if (now < this.cooldownUntil) return;
    // Ignore real stalls (tab switches, pauses), but not merely slow frames.
    if (dtMs > 250 || (typeof document !== 'undefined' && document.hidden)) return;
    this.samples.push(dtMs);
    if (this.samples.length < 45) return;
    const sorted = [...this.samples].sort((a, b) => a - b);
    const median = sorted[sorted.length >> 1]!;
    this.samples = [];
    const steps = median > 45 ? 2 : median > 33 ? 1 : 0;
    if (steps === 0) return;
    const i = ORDER.indexOf(this.tier.name);
    if (i <= 0) return;
    this.tier = TIERS[ORDER[Math.max(0, i - steps)]!];
    this.apply(this.tier);
    this.cooldownUntil = now + 1500;
  }
}
