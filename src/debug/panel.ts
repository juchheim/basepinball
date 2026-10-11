import { Pane } from 'tweakpane';
import { defaultParams, type PhysicsParams } from '../physics/params';

/**
 * Live physics tuning (docs/MVP/03 § 9). Edits apply immediately and persist in this browser,
 * so feel-review sessions can build on each other. "Copy params" exports JSON for the repo.
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

function saveParams(params: PhysicsParams): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(params));
  } catch {
    // Ignore (private mode, quota).
  }
}

function deepAssign(target: Record<string, unknown>, src: unknown): void {
  if (!src || typeof src !== 'object') return;
  for (const [k, v] of Object.entries(src as Record<string, unknown>)) {
    const cur = target[k];
    if (cur && typeof cur === 'object' && v && typeof v === 'object')
      deepAssign(cur as Record<string, unknown>, v);
    else if (typeof cur === typeof v) target[k] = v;
  }
}

export interface PanelHooks {
  onParamsChange: () => void;
  spawn: () => void;
  pitch: () => void;
  curveball: () => void;
  resetTargets: () => void;
  state: { timeScale: number; colliders: boolean; bloom: boolean; paused: boolean };
  onStateChange: () => void;
}

export function createPanel(params: PhysicsParams, hooks: PanelHooks): Pane {
  const pane = new Pane({ title: 'Physics tuning', expanded: window.innerWidth > 800 });
  const changed = (): void => {
    saveParams(params);
    hooks.onParamsChange();
  };

  const sim = pane.addFolder({ title: 'Simulation' });
  sim
    .addBinding(hooks.state, 'timeScale', { min: 0.05, max: 1, step: 0.05, label: 'time scale' })
    .on('change', hooks.onStateChange);
  sim.addBinding(hooks.state, 'paused').on('change', hooks.onStateChange);
  sim
    .addBinding(hooks.state, 'colliders', { label: 'show colliders' })
    .on('change', hooks.onStateChange);
  sim.addBinding(hooks.state, 'bloom').on('change', hooks.onStateChange);
  sim.addButton({ title: 'New ball on plunger (B)' }).on('click', hooks.spawn);
  sim.addButton({ title: 'Pitch from mound (K)' }).on('click', hooks.pitch);
  sim.addButton({ title: 'Pulse curveball magnet' }).on('click', hooks.curveball);
  sim.addButton({ title: 'Reset drop targets (R)' }).on('click', hooks.resetTargets);

  const table = pane.addFolder({ title: 'Table' });
  table
    .addBinding(params, 'slopeDeg', { min: 5, max: 8, step: 0.1, label: 'slope°' })
    .on('change', changed);
  table
    .addBinding(params, 'rate', {
      options: { '500 Hz': 500, '1000 Hz': 1000, '2000 Hz': 2000 },
      label: 'physics rate',
    })
    .on('change', changed);
  table
    .addBinding(params, 'rollingResistance', {
      min: 0,
      max: 0.02,
      step: 0.0005,
      label: 'rolling resist.',
    })
    .on('change', changed);

  const fl = pane.addFolder({ title: 'Flippers' });
  fl.addBinding(params.flipper, 'coilTorque', {
    min: 0.3,
    max: 2.5,
    step: 0.05,
    label: 'coil N·m',
  }).on('change', changed);
  fl.addBinding(params.flipper, 'holdTorque', {
    min: 0.05,
    max: 1,
    step: 0.01,
    label: 'hold N·m',
  }).on('change', changed);
  fl.addBinding(params.flipper, 'returnTorque', {
    min: 0.05,
    max: 1,
    step: 0.01,
    label: 'return N·m',
  }).on('change', changed);
  fl.addBinding(params.flipper, 'mass', { min: 0.03, max: 0.3, step: 0.005, label: 'mass kg' }).on(
    'change',
    changed,
  );
  fl.addBinding(params.flipper, 'eosBounce', {
    min: 0,
    max: 0.8,
    step: 0.05,
    label: 'EOS bounce',
  }).on('change', changed);
  const fr = params.materials.rubberFlipper;
  fl.addBinding(fr, 'eLow', { min: 0, max: 1, step: 0.01, label: 'rubber e (slow)' }).on(
    'change',
    changed,
  );
  fl.addBinding(fr, 'eHigh', { min: 0, max: 1, step: 0.01, label: 'rubber e (fast)' }).on(
    'change',
    changed,
  );
  fl.addBinding(fr, 'friction', { min: 0, max: 1, step: 0.01, label: 'rubber friction' }).on(
    'change',
    changed,
  );

  const dev = pane.addFolder({ title: 'Devices', expanded: false });
  dev
    .addBinding(params, 'slingKickSpeed', { min: 0.5, max: 5, step: 0.1, label: 'sling kick m/s' })
    .on('change', changed);
  dev
    .addBinding(params, 'slingThreshold', {
      min: 0.05,
      max: 1.5,
      step: 0.05,
      label: 'sling threshold',
    })
    .on('change', changed);
  dev
    .addBinding(params, 'popKickSpeed', { min: 0.5, max: 6, step: 0.1, label: 'pop kick m/s' })
    .on('change', changed);
  dev
    .addBinding(params, 'dropThreshold', {
      min: 0.05,
      max: 1.5,
      step: 0.05,
      label: 'drop threshold',
    })
    .on('change', changed);
  dev
    .addBinding(params, 'saucerCaptureSpeed', {
      min: 0.02,
      max: 0.5,
      step: 0.01,
      label: 'saucer capture',
    })
    .on('change', changed);

  const matFolder = pane.addFolder({ title: 'Materials', expanded: false });
  for (const [name, m] of Object.entries(params.materials)) {
    const f = matFolder.addFolder({ title: name, expanded: false });
    f.addBinding(m, 'eLow', { min: 0, max: 1, step: 0.01 }).on('change', changed);
    f.addBinding(m, 'eHigh', { min: 0, max: 1, step: 0.01 }).on('change', changed);
    f.addBinding(m, 'friction', { min: 0, max: 1, step: 0.01 }).on('change', changed);
  }

  pane.addButton({ title: 'Copy params JSON' }).on('click', () => {
    void navigator.clipboard?.writeText(JSON.stringify(params, null, 2));
  });
  pane.addButton({ title: 'Reset to defaults' }).on('click', () => {
    deepAssign(params as unknown as Record<string, unknown>, defaultParams());
    pane.refresh();
    changed();
  });
  return pane;
}
