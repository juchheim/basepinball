/**
 * Keyboard and touch input (docs/MVP/01 § 6). Every action carries the event's timestamp so
 * the fixed-step loop can apply it at the right physics step.
 */

export type Action = 'flipperL' | 'flipperR' | 'spawn' | 'resetTargets' | 'toggleColliders' | 'pause' | 'slower' | 'faster';

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
  Space: 'spawn',
  KeyR: 'resetTargets',
  KeyC: 'toggleColliders',
  KeyP: 'pause',
  BracketLeft: 'slower',
  BracketRight: 'faster',
};

export function bindInput(canvas: HTMLElement, emit: (e: InputEvent) => void): void {
  const held = new Set<Action>();

  window.addEventListener('keydown', (e) => {
    const action = KEYS[e.code];
    if (!action) return;
    e.preventDefault();
    if (e.repeat || held.has(action)) return;
    held.add(action);
    emit({ action, pressed: true, time: e.timeStamp });
  });
  window.addEventListener('keyup', (e) => {
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

  // Touch: left/right half of the screen are the flippers; several fingers at once are fine.
  const touches = new Map<number, Action>();
  canvas.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'touch') return;
    e.preventDefault();
    const action: Action = e.clientX < window.innerWidth / 2 ? 'flipperL' : 'flipperR';
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
