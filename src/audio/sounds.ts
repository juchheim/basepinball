import type { BusName, Recipe } from './engine';
import * as sfx from './sfx';

/** Every named one-shot sound: its bus, polyphony cap and recipe. */
export const SOUNDS = {
  flipperUp: { bus: 'mech', poly: 2, recipe: sfx.flipperUp },
  flipperDown: { bus: 'mech', poly: 2, recipe: sfx.flipperDown },
  sling: { bus: 'mech', poly: 2, recipe: sfx.sling },
  pop0: { bus: 'mech', poly: 3, recipe: sfx.pop(0) },
  pop1: { bus: 'mech', poly: 3, recipe: sfx.pop(1) },
  pop2: { bus: 'mech', poly: 3, recipe: sfx.pop(2) },
  kicker: { bus: 'mech', poly: 2, recipe: sfx.kicker },
  drop: { bus: 'mech', poly: 3, recipe: sfx.dropTarget },
  dropReset: { bus: 'mech', poly: 1, recipe: sfx.dropReset },
  standup: { bus: 'mech', poly: 3, recipe: sfx.standup },
  spinner: { bus: 'mech', poly: 6, recipe: sfx.spinnerTick },
  saucer: { bus: 'mech', poly: 1, recipe: sfx.saucerCatch },
  pitch: { bus: 'mech', poly: 1, recipe: sfx.pitchRelease },
  drain: { bus: 'mech', poly: 1, recipe: sfx.drain },
  plunger: { bus: 'mech', poly: 1, recipe: sfx.plunger },
  kickback: { bus: 'mech', poly: 1, recipe: sfx.kickback },
  gate: { bus: 'mech', poly: 2, recipe: sfx.gateFlap },
  rollover: { bus: 'mech', poly: 3, recipe: sfx.rollover },
  magnet: { bus: 'mech', poly: 1, recipe: sfx.magnetHum(0.2) },
  nudge: { bus: 'mech', poly: 1, recipe: sfx.nudge },
  search: { bus: 'mech', poly: 1, recipe: sfx.searchPulses },
  tiltWarning: { bus: 'mech', poly: 1, recipe: sfx.tiltBuzz(0.3) },
  tilt: { bus: 'mech', poly: 1, recipe: sfx.tiltBuzz(1.2) },
  tellFB: { bus: 'ui', poly: 1, recipe: sfx.tell(7) },
  tellCH: { bus: 'ui', poly: 1, recipe: sfx.tell(0) },
  tellCB: { bus: 'ui', poly: 1, recipe: sfx.tell(-5) },
  award: { bus: 'ui', poly: 1, recipe: sfx.award },
  slide: { bus: 'stadium', poly: 1, recipe: sfx.slide },
  fireworkLaunch: { bus: 'stadium', poly: 4, recipe: sfx.fireworkLaunch },
  fireworkBoom: { bus: 'stadium', poly: 4, recipe: sfx.fireworkBoom },
  towers: { bus: 'stadium', poly: 1, recipe: sfx.towerClunk },
  uiTick: { bus: 'ui', poly: 2, recipe: sfx.uiTick },
  uiConfirm: { bus: 'ui', poly: 1, recipe: sfx.uiConfirm },
} satisfies Record<string, { bus: BusName; poly: number; recipe: Recipe }>;

export type SoundName = keyof typeof SOUNDS;
