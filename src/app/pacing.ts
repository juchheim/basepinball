import type { TierName } from '../render/quality';

/**
 * Frame pacing (docs/MVP/efficiency-audit F3, F4, F6): how often to draw. Physics runs at its own
 * fixed rate with timestamped inputs (see `FixedLoop`), so drawing less often never changes the
 * game, only how smooth it looks and how much power it takes.
 *
 * - Play: every display frame, or capped at 60 fps ("Frame rate" setting; Auto caps phones and
 *   tablets, whose 90/120 Hz screens otherwise double the cost of every frame).
 * - Attract (the title screen): 30 fps on Low and Medium. The orbit is slow and the lamp shows step
 *   anyway; any input brings back the play rate for a few seconds, so the flippers stay crisp.
 * - Idle (paused, settings, how to play, game over, high scores): 10 fps. Nothing in play moves;
 *   the stadium details (marquee chase, blinking lamps at 2.5 Hz, camera flashes) still read.
 * - Battery saver caps play at 60 whatever the Frame rate setting, and slows attract mode on every
 *   tier.
 */

export type FrameRateSetting = 'auto' | '60' | 'max';
export type PaceMode = 'play' | 'attract' | 'idle';

const FPS60 = 1000 / 60;
const FPS30 = 1000 / 30;
const FPS10 = 1000 / 10;
/** How long an input keeps attract mode at the play rate (ms). */
export const INPUT_BOOST_MS = 3000;

/** The minimum time between drawn frames (ms), 0 = every display frame. */
export function frameInterval(o: {
  mode: PaceMode;
  setting: FrameRateSetting;
  mobile: boolean;
  tier: TierName;
  /** An input arrived within the last `INPUT_BOOST_MS`. */
  boosted: boolean;
  /** The Battery saver setting. */
  saver?: boolean;
}): number {
  if (o.mode === 'idle') return FPS10;
  const lowTier = o.tier === 'low' || o.tier === 'medium';
  if (o.mode === 'attract' && !o.boosted && (lowTier || o.saver)) return FPS30;
  return o.saver || o.setting === '60' || (o.setting === 'auto' && o.mobile) ? FPS60 : 0;
}

/**
 * Decides, per display frame, whether to draw. It keeps a schedule rather than measuring the gap
 * since the last draw, so a 144 Hz display capped at 60 averages 60 (drawing every 2nd or 3rd
 * refresh) instead of falling to 48. A little slack (20 % of the interval) means a display already
 * at the cap never skips a frame for jitter.
 */
export class FramePacer {
  private next = -Infinity;

  shouldDraw(now: number, interval: number): boolean {
    if (interval <= 0) {
      this.next = -Infinity;
      return true;
    }
    // The interval just shrank (leaving a menu): don't wait out the old, longer one.
    if (this.next - now > interval) this.next = now;
    if (now < this.next - interval * 0.2) return false;
    // Behind by more than a frame (a stall): restart the schedule rather than draw to catch up.
    this.next = now - this.next > interval ? now + interval : this.next + interval;
    return true;
  }
}
