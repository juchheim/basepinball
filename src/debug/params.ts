import { defaultParams, type PhysicsParams } from '../physics/params';

/**
 * Physics parameters tuned in the debug panel persist in this browser (docs/MVP/03 § 9). Kept apart
 * from the panel so normal play doesn't download the panel's UI library.
 */

// Bumped when defaults change meaningfully, so stale tuning from an older build is not reapplied.
const STORAGE_KEY = 'bp.dev.physicsParams.v2';

export function loadParams(): PhysicsParams {
  const params = defaultParams();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) deepAssign(params as unknown as Record<string, unknown>, JSON.parse(raw));
  } catch {
    // Storage unavailable or corrupt: fall back to defaults.
  }
  return params;
}

export function saveParams(params: PhysicsParams): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(params));
  } catch {
    // Ignore (private mode, quota).
  }
}

export function deepAssign(target: Record<string, unknown>, src: unknown): void {
  if (!src || typeof src !== 'object') return;
  for (const [k, v] of Object.entries(src as Record<string, unknown>)) {
    const cur = target[k];
    if (cur && typeof cur === 'object' && v && typeof v === 'object')
      deepAssign(cur as Record<string, unknown>, v);
    else if (typeof cur === typeof v) target[k] = v;
  }
}
