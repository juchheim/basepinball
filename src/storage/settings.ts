/**
 * Player settings (docs/MVP/01 § 9, 07 § 2 Meta/Accessibility): volumes, reduced motion, HUD size,
 * quality, haptics, motion nudge and key bindings. Stored in localStorage with a version; anything
 * missing or malformed falls back to the default, and storage failures (private mode, quota) are
 * swallowed, so the game always starts.
 */

export type RemappableAction =
  'flipperL' | 'flipperR' | 'plunger' | 'nudgeL' | 'nudgeR' | 'nudgeUp' | 'pause' | 'mute';

export const REMAPPABLE: { action: RemappableAction; label: string }[] = [
  { action: 'flipperL', label: 'Left flipper' },
  { action: 'flipperR', label: 'Right flipper' },
  { action: 'plunger', label: 'Plunger / start' },
  { action: 'nudgeL', label: 'Nudge left' },
  { action: 'nudgeR', label: 'Nudge right' },
  { action: 'nudgeUp', label: 'Nudge forward' },
  { action: 'pause', label: 'Pause' },
  { action: 'mute', label: 'Mute' },
];

export type QualitySetting = 'auto' | 'low' | 'medium' | 'high' | 'ultra';

export interface Settings {
  version: 1;
  /** 0-1 each. */
  volume: { master: number; sfx: number; crowd: number; music: number };
  muted: boolean;
  /** 'system' follows prefers-reduced-motion. */
  reducedMotion: 'system' | 'on' | 'off';
  hudScale: 'normal' | 'large';
  quality: QualitySetting;
  /** Vibration (Android) and gamepad rumble. */
  haptics: boolean;
  /** Tilt the phone to nudge (asks for motion permission on iOS). */
  motionNudge: boolean;
  /** Key codes (KeyboardEvent.code) per action. */
  keys: Record<RemappableAction, string[]>;
}

export const DEFAULT_KEYS: Record<RemappableAction, string[]> = {
  flipperL: ['ShiftLeft', 'ArrowLeft', 'KeyA'],
  flipperR: ['ShiftRight', 'ArrowRight', 'KeyL'],
  plunger: ['ArrowDown', 'Enter'],
  nudgeL: ['KeyZ'],
  nudgeR: ['Slash'],
  nudgeUp: ['Space'],
  pause: ['Escape', 'KeyP'],
  mute: ['KeyM'],
};

export const DEFAULT_SETTINGS: Settings = {
  version: 1,
  volume: { master: 0.8, sfx: 1, crowd: 0.7, music: 0.6 },
  muted: false,
  reducedMotion: 'system',
  hudScale: 'normal',
  quality: 'auto',
  haptics: true,
  motionNudge: false,
  keys: DEFAULT_KEYS,
};

const KEY = 'bp.v1.settings';

export function safeStorage(): Storage | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

export function loadSettings(storage: Storage | undefined = safeStorage()): Settings {
  try {
    const raw = storage?.getItem(KEY);
    if (!raw) return clone(DEFAULT_SETTINGS);
    return sanitize(JSON.parse(raw) as unknown);
  } catch {
    return clone(DEFAULT_SETTINGS);
  }
}

export function saveSettings(s: Settings, storage: Storage | undefined = safeStorage()): void {
  try {
    storage?.setItem(KEY, JSON.stringify(s));
  } catch {
    // Not saved; the settings still apply for this session.
  }
}

/** Take what is valid from stored data; everything else is the default. */
export function sanitize(data: unknown): Settings {
  const d = clone(DEFAULT_SETTINGS);
  if (!data || typeof data !== 'object') return d;
  const o = data as Record<string, unknown>;
  const unit = (v: unknown, fallback: number): number =>
    typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : fallback;
  const vol = (o.volume ?? {}) as Record<string, unknown>;
  d.volume = {
    master: unit(vol.master, d.volume.master),
    sfx: unit(vol.sfx, d.volume.sfx),
    crowd: unit(vol.crowd, d.volume.crowd),
    music: unit(vol.music, d.volume.music),
  };
  if (typeof o.muted === 'boolean') d.muted = o.muted;
  if (o.reducedMotion === 'system' || o.reducedMotion === 'on' || o.reducedMotion === 'off')
    d.reducedMotion = o.reducedMotion;
  if (o.hudScale === 'normal' || o.hudScale === 'large') d.hudScale = o.hudScale;
  if (['auto', 'low', 'medium', 'high', 'ultra'].includes(o.quality as string))
    d.quality = o.quality as QualitySetting;
  if (typeof o.haptics === 'boolean') d.haptics = o.haptics;
  if (typeof o.motionNudge === 'boolean') d.motionNudge = o.motionNudge;
  const keys = (o.keys ?? {}) as Record<string, unknown>;
  for (const { action } of REMAPPABLE) {
    const k = keys[action];
    if (Array.isArray(k) && k.every((c) => typeof c === 'string') && k.length > 0 && k.length <= 4)
      d.keys[action] = k as string[];
  }
  return d;
}

/** Bind `code` to `action`, taking it away from any other action (one key, one job). */
export function bindKey(s: Settings, action: RemappableAction, code: string): Settings {
  const keys = { ...s.keys };
  for (const { action: a } of REMAPPABLE) keys[a] = keys[a].filter((c) => c !== code);
  keys[action] = [code, ...keys[action].filter((c) => c !== code)].slice(0, 3);
  return { ...s, keys };
}

/** Whether reduced motion is in effect. */
export function reducedMotion(s: Settings): boolean {
  if (s.reducedMotion !== 'system') return s.reducedMotion === 'on';
  return (
    typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

/** A readable name for a key code ("ShiftLeft" → "Left Shift"). */
export function keyName(code: string): string {
  const named: Record<string, string> = {
    ShiftLeft: 'Left Shift',
    ShiftRight: 'Right Shift',
    ArrowLeft: '←',
    ArrowRight: '→',
    ArrowUp: '↑',
    ArrowDown: '↓',
    Space: 'Space',
    Slash: '/',
    Escape: 'Esc',
    Enter: 'Enter',
    ControlLeft: 'Left Ctrl',
    ControlRight: 'Right Ctrl',
    AltLeft: 'Left Alt',
    AltRight: 'Right Alt',
    MetaLeft: 'Left ⌘',
    MetaRight: 'Right ⌘',
  };
  if (named[code]) return named[code];
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  return code;
}

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}
