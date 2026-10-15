import { BRAND } from './brand';

/**
 * Release hardening (docs/MVP/07 § M6): what happens when something outside the game's control
 * fails. A lost graphics context (GPU reset, driver crash, the OS reclaiming memory on mobile)
 * pauses the game and offers a reload; an exception in one frame is logged and the loop carries
 * on; a run of them stops the loop with a message instead of a frozen screen.
 */

export interface FatalInfo {
  title: string;
  body: string;
  /** Offer a reload, or a reload in the WebGL2 compatibility mode. */
  action: 'reload' | 'webgl';
}

/**
 * Watch the canvas for a lost WebGL context, and the WebGPU device (if any) for loss. Both call
 * `onLost` once.
 */
export function watchContextLoss(
  canvas: HTMLCanvasElement,
  device: { lost?: Promise<{ reason?: string; message?: string }> } | undefined,
  onLost: (why: string) => void,
): void {
  let fired = false;
  const lost = (why: string): void => {
    if (fired) return;
    fired = true;
    onLost(why);
  };
  canvas.addEventListener('webglcontextlost', (e) => {
    // Without preventDefault the browser never offers the context back.
    e.preventDefault();
    lost('webgl context lost');
  });
  void device?.lost?.then((info) => {
    // `destroyed` is our own teardown (page unload); anything else is a real loss.
    if (info.reason !== 'destroyed')
      lost(`webgpu device lost: ${info.message ?? info.reason ?? ''}`);
  });
}

export type WatchdogAction = 'none' | 'soft' | 'rebuild' | 'fallback';

/**
 * Turns observations of the canvas ("is anything drawn?") into recovery steps, escalating the
 * longer it stays empty. Checks are about half a second apart while anything looks wrong (see
 * `ProbeSchedule`). A canvas that was drawing and goes
 * blank gets a nudge after 2 checks (1 s), a rebuild of the render targets after 4 (2 s), and the
 * WebGL2 fallback after 8 (4 s). A canvas never seen drawing gets only the fallback, after 12, so a
 * browser where the probe can't tell is switched to the safer backend rather than left blank.
 */
export class BlankTracker {
  private blank = 0;
  private everHealthy = false;
  private stage = 0;

  /** Consecutive blank observations so far. */
  get blankCount(): number {
    return this.blank;
  }

  /** `hasContent`: true = drawn, false = empty, null = the browser would not say. */
  observe(hasContent: boolean | null): WatchdogAction {
    if (hasContent === null) return 'none';
    if (hasContent) {
      this.everHealthy = true;
      this.blank = 0;
      this.stage = 0;
      return 'none';
    }
    this.blank++;
    if (this.blank >= (this.everHealthy ? 8 : 12)) {
      this.blank = 0;
      this.stage = 0;
      return 'fallback';
    }
    if (this.everHealthy && this.blank >= 4 && this.stage < 2) {
      this.stage = 2;
      return 'rebuild';
    }
    if (this.everHealthy && this.blank >= 2 && this.stage < 1) {
      this.stage = 1;
      return 'soft';
    }
    return 'none';
  }
}

/**
 * When to probe the canvas. Each probe reads the whole frame back from the GPU (a stall), so once
 * the canvas has been healthy for a while it is checked every 5 s instead of every 0.5 s
 * (docs/MVP/efficiency-audit F5). Anything that can break presenting (start-up, a resize, a
 * quality change, a recovery) or a blank read `wake`s it back to the fast rate for 10 s, so the
 * `BlankTracker` escalation keeps its half-second pace once something is wrong.
 */
export class ProbeSchedule {
  private next = 0;
  private fastUntil: number;

  constructor(
    now: number,
    private readonly fastMs = 500,
    private readonly slowMs = 5000,
    private readonly settleMs = 10_000,
  ) {
    this.fastUntil = now + settleMs;
    this.next = now + fastMs;
  }

  wake(now: number): void {
    this.fastUntil = Math.max(this.fastUntil, now + this.settleMs);
    this.next = Math.min(this.next, now + this.fastMs);
  }

  /** Whether a probe is due now (call only right after a drawn frame). */
  due(now: number): boolean {
    if (now < this.next) return false;
    this.next = now + (now < this.fastUntil ? this.fastMs : this.slowMs);
    return true;
  }
}

/** Reads back a few pixels of the game canvas to see whether anything was presented. */
export class CanvasProbe {
  private readonly ctx: CanvasRenderingContext2D | null;

  constructor(private readonly canvas: HTMLCanvasElement) {
    const probe = document.createElement('canvas');
    probe.width = probe.height = 8;
    this.ctx = probe.getContext('2d', { willReadFrequently: true });
  }

  /**
   * Call right after a frame is rendered (the drawing buffer is only readable in that task). The
   * scene always has an opaque background, so any transparent result means nothing was drawn.
   */
  hasContent(): boolean | null {
    if (!this.ctx) return null;
    try {
      this.ctx.clearRect(0, 0, 8, 8);
      this.ctx.drawImage(this.canvas, 0, 0, 8, 8);
      const px = this.ctx.getImageData(0, 0, 8, 8).data;
      for (let i = 3; i < px.length; i += 4) if (px[i] !== 0) return true;
      return false;
    } catch {
      return null;
    }
  }
}

/** Counts consecutive failing frames; returns true once the loop should give up. */
export class FrameGuard {
  private failures = 0;
  private logged = 0;

  ok(): void {
    this.failures = 0;
  }

  /** Record a failed frame. True when it has failed too many times in a row to keep going. */
  failed(err: unknown): boolean {
    this.failures++;
    if (this.logged < 5) {
      this.logged++;
      console.error('frame error', err);
    }
    return this.failures >= 30;
  }
}

/** The message for a renderer that could not start, with a way forward. */
export function startupFailure(err: unknown, forcedWebGL: boolean): FatalInfo {
  return forcedWebGL
    ? {
        title: `${BRAND.game} can't start graphics here`,
        body: `This browser couldn't start WebGL2 (${String(err)}). Try an up-to-date Chrome, Edge, Firefox or Safari, and check that hardware acceleration is on.`,
        action: 'reload',
      }
    : {
        title: `${BRAND.game} can't start graphics here`,
        body: `The graphics engine failed to start (${String(err)}). Compatibility mode uses the older WebGL2 path, which works on more devices.`,
        action: 'webgl',
      };
}

/**
 * Show a fatal message over everything, in plain DOM (it must work even if the UI layer is the
 * thing that broke). The action button reloads, or reloads in compatibility (WebGL2) mode.
 */
export function showFatal(info: FatalInfo): void {
  if (document.querySelector('.fatal-panel')) return;
  // A failure during start-up: the message replaces the loading screen.
  document.getElementById('loader')?.remove();
  const panel = document.createElement('div');
  panel.className = 'fatal-panel';
  panel.setAttribute('role', 'alertdialog');
  const h = document.createElement('h2');
  h.textContent = info.title;
  const p = document.createElement('p');
  p.textContent = info.body;
  const b = document.createElement('button');
  b.textContent = info.action === 'webgl' ? 'Try compatibility mode' : 'Reload';
  b.addEventListener('click', () => {
    if (info.action === 'webgl') {
      const url = new URL(location.href);
      url.searchParams.set('webgl', '');
      location.href = url.toString();
    } else {
      location.reload();
    }
  });
  panel.append(h, p, b);
  document.body.appendChild(panel);
  b.focus();
}
