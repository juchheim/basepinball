import { DEFAULT_KEYS, type RemappableAction } from '../storage/settings';

/**
 * Keyboard, touch, gamepad and motion input (docs/MVP/01 § 6). Every action carries the event's
 * timestamp so the fixed-step loop can apply it at the right physics step.
 */

export type Action =
  RemappableAction | 'serve' | 'pitch' | 'resetTargets' | 'toggleColliders' | 'slower' | 'faster';

export interface InputEvent {
  action: Action;
  pressed: boolean;
  time: number;
  /** Plunger only: how far it is pulled (0-1) while dragging the knob or the right stick. */
  value?: number;
}

/** Debug keys are fixed; everything else comes from the settings. */
const DEBUG_KEYS: Record<string, Action> = {
  KeyB: 'serve',
  KeyK: 'pitch',
  KeyR: 'resetTargets',
  KeyC: 'toggleColliders',
  BracketLeft: 'slower',
  BracketRight: 'faster',
};

/**
 * Touch layout: the lower-right corner over the shooter lane is the plunger knob (drag down and
 * release, or just hold); the lower 70 % of the screen is the flippers, left and right halves; a
 * quick flick in the top 30 % nudges the table in the flick's direction.
 */
export const TOUCH = { plungerX: 0.82, plungerY: 0.72, flipperTop: 0.3 };

type Zone = 'plunger' | 'flipperL' | 'flipperR' | 'nudge';

function touchZone(x: number, y: number): Zone {
  const w = window.innerWidth;
  const h = window.innerHeight;
  if (x > w * TOUCH.plungerX && y > h * TOUCH.plungerY) return 'plunger';
  if (y < h * TOUCH.flipperTop) return 'nudge';
  return x < w / 2 ? 'flipperL' : 'flipperR';
}

/** Typing into a form (e.g. high-score initials) must not flip or pause. */
function typing(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null;
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
}

interface PadState {
  buttons: boolean[];
  stickX: number;
  stickY: number;
  pull: number;
}

export class Input {
  private keymap = new Map<string, Action>();
  private debugKeys = false;
  private readonly held = new Set<Action>();
  private capture: ((code: string) => void) | null = null;
  private readonly pads = new Map<number, PadState>();
  private lastPad: Gamepad | null = null;
  private motionOn = false;
  private motionListening = false;
  private lastMotionNudge = 0;

  constructor(
    canvas: HTMLElement,
    private readonly emit: (e: InputEvent) => void,
    debug: boolean,
  ) {
    this.setKeys(DEFAULT_KEYS, debug);
    this.bindKeyboard();
    this.bindTouch(canvas);
  }

  /** Apply key bindings from the settings. */
  setKeys(keys: Record<RemappableAction, string[]>, debug = this.debugKeys): void {
    this.debugKeys = debug;
    this.keymap = new Map();
    if (debug) for (const [code, a] of Object.entries(DEBUG_KEYS)) this.keymap.set(code, a);
    for (const [action, codes] of Object.entries(keys) as [RemappableAction, string[]][]) {
      for (const code of codes) this.keymap.set(code, action);
    }
  }

  /** The next key pressed goes to `cb` instead of the game (key remapping); Esc gives null. */
  captureKey(cb: (code: string | null) => void): void {
    this.capture = (code) => cb(code === 'Escape' ? null : code);
  }

  private bindKeyboard(): void {
    window.addEventListener('keydown', (e) => {
      if (this.capture) {
        e.preventDefault();
        const cb = this.capture;
        this.capture = null;
        cb(e.code);
        return;
      }
      if (typing(e)) return;
      const action = this.keymap.get(e.code);
      if (!action) return;
      e.preventDefault();
      if (e.repeat || this.held.has(action)) return;
      this.held.add(action);
      this.emit({ action, pressed: true, time: e.timeStamp });
    });
    window.addEventListener('keyup', (e) => {
      const action = this.keymap.get(e.code);
      if (!action) return;
      e.preventDefault();
      if (!this.held.delete(action)) return;
      this.emit({ action, pressed: false, time: e.timeStamp });
    });
    window.addEventListener('blur', () => this.releaseAll());
  }

  /** Let go of everything (the window lost focus, the game paused). */
  releaseAll(): void {
    for (const action of this.held) this.emit({ action, pressed: false, time: performance.now() });
    this.held.clear();
  }

  private bindTouch(canvas: HTMLElement): void {
    interface Touch {
      zone: Zone;
      x: number;
      y: number;
      t: number;
      dragging: boolean;
    }
    const touches = new Map<number, Touch>();
    canvas.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'touch') return;
      e.preventDefault();
      const zone = touchZone(e.clientX, e.clientY);
      touches.set(e.pointerId, {
        zone,
        x: e.clientX,
        y: e.clientY,
        t: e.timeStamp,
        dragging: false,
      });
      if (zone !== 'nudge') this.emit({ action: zone, pressed: true, time: e.timeStamp });
    });
    canvas.addEventListener('pointermove', (e) => {
      const t = touches.get(e.pointerId);
      if (!t || t.zone !== 'plunger') return;
      // Dragging the knob down pulls the spring back that far (a fifth of the screen = all).
      const dy = e.clientY - t.y;
      if (!t.dragging && Math.abs(dy) < 8) return;
      t.dragging = true;
      const value = Math.max(0, Math.min(1, dy / (window.innerHeight * 0.2)));
      this.emit({ action: 'plunger', pressed: true, time: e.timeStamp, value });
    });
    const release = (e: PointerEvent): void => {
      const t = touches.get(e.pointerId);
      if (!t) return;
      touches.delete(e.pointerId);
      if (t.zone === 'nudge') {
        // A quick flick nudges the way it went.
        const dx = e.clientX - t.x;
        const dy = e.clientY - t.y;
        if (e.type === 'pointerup' && e.timeStamp - t.t < 350 && Math.hypot(dx, dy) > 30) {
          const action: Action =
            Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? 'nudgeL' : 'nudgeR') : 'nudgeUp';
          this.tap(action, e.timeStamp);
        }
        return;
      }
      // Keep a flipper up while another finger still holds the same side.
      for (const other of touches.values()) if (other.zone === t.zone) return;
      this.emit({ action: t.zone, pressed: false, time: e.timeStamp });
    };
    canvas.addEventListener('pointerup', release);
    canvas.addEventListener('pointercancel', release);
  }

  private tap(action: Action, time: number): void {
    this.emit({ action, pressed: true, time });
    this.emit({ action, pressed: false, time });
  }

  // ---------------------------------------------------------------- gamepad

  /**
   * Poll gamepads once a frame (standard mapping): LB/LT and RB/RT flip, A plunges (or pull the
   * right stick down and let go), Start pauses, a flick of the left stick nudges.
   */
  pollGamepads(): void {
    if (typeof navigator === 'undefined' || !navigator.getGamepads) return;
    const now = performance.now();
    for (const pad of navigator.getGamepads()) {
      if (!pad || pad.mapping !== 'standard') continue;
      let st = this.pads.get(pad.index);
      if (!st) {
        st = { buttons: [], stickX: 0, stickY: 0, pull: 0 };
        this.pads.set(pad.index, st);
      }
      const down = (i: number): boolean => {
        const b = pad.buttons[i];
        return !!b && (b.pressed || b.value > 0.5);
      };
      const state = [down(4) || down(6), down(5) || down(7), down(0), down(9)];
      const actions: Action[] = ['flipperL', 'flipperR', 'plunger', 'pause'];
      state.forEach((isDown, i) => {
        if (isDown === !!st.buttons[i]) return;
        this.lastPad = pad;
        this.emit({ action: actions[i]!, pressed: isDown, time: now });
      });
      st.buttons = state;

      // Left-stick flicks nudge (on crossing out from near the centre).
      const x = pad.axes[0] ?? 0;
      const y = pad.axes[1] ?? 0;
      if (Math.abs(x) > 0.85 && Math.abs(st.stickX) < 0.5) {
        this.lastPad = pad;
        this.tap(x < 0 ? 'nudgeL' : 'nudgeR', now);
      }
      if (y < -0.85 && st.stickY > -0.5) {
        this.lastPad = pad;
        this.tap('nudgeUp', now);
      }
      st.stickX = x;
      st.stickY = y;

      // Right stick down pulls the plunger that far; letting it spring back launches.
      const pull = Math.max(0, pad.axes[3] ?? 0);
      if (pull > 0.2) this.emit({ action: 'plunger', pressed: true, time: now, value: pull });
      else if (st.pull > 0.2) this.emit({ action: 'plunger', pressed: false, time: now });
      st.pull = pull;
    }
  }

  /** Rumble the last-used gamepad (strength 0-1). */
  rumble(strength: number, ms: number): void {
    const act = (this.lastPad as { vibrationActuator?: unknown } | null)?.vibrationActuator as
      { playEffect?: (type: string, p: Record<string, number>) => Promise<unknown> } | undefined;
    void act
      ?.playEffect?.('dual-rumble', {
        duration: ms,
        strongMagnitude: strength,
        weakMagnitude: strength * 0.6,
      })
      ?.catch(() => undefined);
  }

  // ---------------------------------------------------------------- motion nudge

  /**
   * Tilt-to-nudge: a sharp jolt of the phone nudges the table. iOS asks for permission, which
   * needs a user gesture (the settings toggle). Resolves false if motion is unavailable or denied.
   */
  async enableMotion(on: boolean): Promise<boolean> {
    this.motionOn = on;
    if (!on || typeof DeviceMotionEvent === 'undefined') return false;
    const req = (DeviceMotionEvent as unknown as { requestPermission?: () => Promise<string> })
      .requestPermission;
    if (req) {
      try {
        if ((await req()) !== 'granted') {
          this.motionOn = false;
          return false;
        }
      } catch {
        this.motionOn = false;
        return false;
      }
    }
    if (!this.motionListening) {
      this.motionListening = true;
      window.addEventListener('devicemotion', (e) => this.onMotion(e));
    }
    return true;
  }

  private onMotion(e: DeviceMotionEvent): void {
    if (!this.motionOn) return;
    const a = e.acceleration;
    if (!a || a.x === null || a.y === null) return;
    if (e.timeStamp - this.lastMotionNudge < 400) return;
    // In portrait, device x is the table's left-right and y (toward the top of the phone) forward.
    if (Math.abs(a.x) < 11 && a.y < 11) return;
    this.lastMotionNudge = e.timeStamp;
    this.tap(Math.abs(a.x) >= 11 ? (a.x < 0 ? 'nudgeL' : 'nudgeR') : 'nudgeUp', e.timeStamp);
  }
}

/** Vibration (Android Chrome; iOS Safari has none). */
export function vibrate(ms: number): void {
  try {
    navigator.vibrate?.(ms);
  } catch {
    // Unsupported.
  }
}
