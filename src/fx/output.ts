import type { Crowd } from '../audio/crowd';
import type { AudioEngine } from '../audio/engine';
import { playStinger } from '../audio/organ';
import { impact as impactRecipe } from '../audio/sfx';
import { SOUNDS } from '../audio/sounds';
import type { Stadium } from '../render/stadium';
import type { Stage } from '../render/stage';
import type { TableView } from '../render/tableView';
import type { FigureAction, PresentationOut } from './director';
import type { LampShows } from './lampShows';

/** The real outputs behind the director: Web Audio, the table view, the stadium and the stage. */
export function createOutput(d: {
  audio: AudioEngine;
  crowd: Crowd;
  view: TableView;
  shows: LampShows;
  stadium: Stadium;
  stage: Stage;
  setLights: (on: boolean) => void;
}): PresentationOut {
  const lastImpact = new Map<string, number>();
  return {
    sound(name, at, gain) {
      const s = SOUNDS[name];
      d.audio.play(name, s.bus, s.recipe, {
        poly: s.poly,
        ...(at ? { at } : {}),
        ...(gain !== undefined ? { gain } : {}),
      });
    },
    impact(material, speed, at) {
      // One impact sound per surface every 30 ms is plenty (a ball rattling in a corner).
      const now = d.audio.now;
      if (now - (lastImpact.get(material) ?? -1) < 0.03) return;
      const recipe = impactRecipe(material, speed);
      if (!recipe) return;
      lastImpact.set(material, now);
      d.audio.play(`impact.${material}`, 'mech', recipe, { poly: 3, at });
    },
    stinger(name) {
      playStinger(d.audio, name);
    },
    crowd(reaction, level = 0.5) {
      if (reaction === 'cheer') d.crowd.cheer(level);
      else if (reaction === 'roar') d.crowd.roar();
      else if (reaction === 'groan') d.crowd.groan();
      else if (reaction === 'ooh') d.crowd.ooh();
      else d.crowd.rallyClap();
    },
    crowdIntensity(level) {
      d.crowd.setIntensity(level);
    },
    flash(id) {
      d.view.flash(id);
    },
    fire(id) {
      d.view.fire(id);
    },
    show(name) {
      d.shows.start(name);
    },
    figure(a: FigureAction) {
      const f = d.view.figures;
      switch (a.kind) {
        case 'catch':
          return f.catch(a.position, a, a.grass);
        case 'throw':
          return f.throwToMound(a.position, a);
        case 'dive':
          return f.dive(a.position, a.side);
        case 'windup':
          return f.windup(a.lead);
        case 'release':
          return f.release();
        case 'punchOut':
          return f.punchOut();
        case 'umpire':
          return f.umpireSignal();
        case 'safe':
          return f.safeSignal();
        case 'celebrate':
          return f.celebrate();
        case 'hit':
          return f.hit(a.bases);
        case 'steal':
          return f.steal(a.from);
        case 'clearBases':
          return f.clearBases();
      }
    },
    fireworks(count) {
      const launch = SOUNDS.fireworkLaunch;
      const boom = SOUNDS.fireworkBoom;
      d.stadium.fireworks(
        count,
        () => d.audio.play('fireworkLaunch', launch.bus, launch.recipe, { poly: launch.poly }),
        () => {
          d.audio.play('fireworkBoom', boom.bus, boom.recipe, { poly: boom.poly });
          d.stadium.excite(0.8);
        },
      );
    },
    scoreboard(text, sub, color, seconds) {
      d.stadium.showMessage(text, sub, color, seconds);
    },
    excite(level) {
      d.stadium.excite(level);
    },
    lights(on) {
      d.setLights(on);
    },
    shake(amount) {
      d.stage.shake(amount);
    },
  };
}
