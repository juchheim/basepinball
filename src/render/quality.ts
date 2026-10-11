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
  /** Dynamic ball reflections: cube size (0 = static environment only) and update interval (frames). */
  reflectionSize: number;
  reflectionEvery: number;
  bloom: boolean;
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
    reflectionEvery: 2,
    bloom: true,
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
    reflectionEvery: 1,
    bloom: true,
    playfieldTexture: 4096,
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
    playfieldTexture: 4096,
    crowd: 4000,
  },
};

const ORDER: TierName[] = ['low', 'medium', 'high', 'ultra'];

export function initialTier(query: URLSearchParams): Quality {
  const forced = query.get('quality') as TierName | null;
  if (forced && TIERS[forced]) return TIERS[forced];
  const coarse = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;
  const small = Math.min(screen.width, screen.height) < 700;
  return coarse || small ? TIERS.medium : TIERS.high;
}

/** Watches frame times and steps the tier down when the game cannot hold its frame rate. */
export class AdaptiveQuality {
  private samples: number[] = [];
  private cooldownUntil = 0;
  enabled = true;

  constructor(
    public tier: Quality,
    private readonly apply: (q: Quality) => void,
  ) {}

  frame(now: number, dtMs: number): void {
    if (!this.enabled || now < this.cooldownUntil) return;
    // Ignore stalls from tab switches, pauses and loading hitches.
    if (dtMs > 100 || (typeof document !== 'undefined' && document.hidden)) return;
    this.samples.push(dtMs);
    if (this.samples.length < 120) return;
    this.samples.sort((a, b) => a - b);
    // The median frame over ~2 s; slower than ~48 fps means step down.
    const median = this.samples[this.samples.length >> 1]!;
    this.samples = [];
    if (median > 21) {
      const i = ORDER.indexOf(this.tier.name);
      if (i > 0) {
        this.tier = TIERS[ORDER[i - 1]!];
        this.apply(this.tier);
        this.cooldownUntil = now + 4000;
      }
    }
  }
}
