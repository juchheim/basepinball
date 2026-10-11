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
