/**
 * Keyboard and touch input (docs/MVP/01 § 6). Every action carries the event's timestamp so
 * the fixed-step loop can apply it at the right physics step.
 */

export type Action =
  | 'flipperL'
  | 'flipperR'
  | 'plunger'
  | 'nudgeL'
  | 'nudgeR'
  | 'nudgeUp'
  | 'serve'
  | 'pitch'
  | 'resetTargets'
  | 'toggleColliders'
  | 'pause'
  | 'slower'
  | 'faster';

export interface InputEvent {
  action: Action;
  pressed: boolean;
  time: number;
}

const KEYS: Record<string, Action> = {
  ShiftLeft: 'flipperL',
  ArrowLeft: 'flipperL',
  KeyA: 'flipperL',
  ShiftRight: 'flipperR',
  ArrowRight: 'flipperR',
  KeyL: 'flipperR',
  ArrowDown: 'plunger',
  Enter: 'plunger',
  KeyZ: 'nudgeL',
  Slash: 'nudgeR',
  Space: 'nudgeUp',
  KeyB: 'serve',
  KeyK: 'pitch',
  KeyR: 'resetTargets',
  KeyC: 'toggleColliders',
  KeyP: 'pause',
  Escape: 'pause',
  BracketLeft: 'slower',
  BracketRight: 'faster',
};

/**
 * Touch zones: the plunger is the lower-right corner (over the shooter lane); otherwise the left
 * and right halves of the screen are the flippers. Several fingers at once are fine.
 */
function touchAction(x: number, y: number): Action {
  const w = window.innerWidth;
  const h = window.innerHeight;
  if (x > w * 0.82 && y > h * 0.72) return 'plunger';
  return x < w / 2 ? 'flipperL' : 'flipperR';
}

/** Typing into a form (e.g. high-score initials) must not flip or pause. */
function typing(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null;
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
}

export function bindInput(canvas: HTMLElement, emit: (e: InputEvent) => void): void {
  const held = new Set<Action>();

  window.addEventListener('keydown', (e) => {
    if (typing(e)) return;
    const action = KEYS[e.code];
    if (!action) return;
    e.preventDefault();
    if (e.repeat || held.has(action)) return;
    held.add(action);
    emit({ action, pressed: true, time: e.timeStamp });
  });
  window.addEventListener('keyup', (e) => {
    if (typing(e) && !held.size) return;
    const action = KEYS[e.code];
    if (!action) return;
    e.preventDefault();
    held.delete(action);
    emit({ action, pressed: false, time: e.timeStamp });
  });
  window.addEventListener('blur', () => {
    for (const action of held) emit({ action, pressed: false, time: performance.now() });
    held.clear();
  });

  const touches = new Map<number, Action>();
  canvas.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'touch') return;
    e.preventDefault();
    const action = touchAction(e.clientX, e.clientY);
    touches.set(e.pointerId, action);
    emit({ action, pressed: true, time: e.timeStamp });
  });
  const release = (e: PointerEvent): void => {
    const action = touches.get(e.pointerId);
    if (!action) return;
    touches.delete(e.pointerId);
    // Keep the flipper up while another finger still holds the same side.
    for (const a of touches.values()) if (a === action) return;
    emit({ action, pressed: false, time: e.timeStamp });
  };
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', release);
}
