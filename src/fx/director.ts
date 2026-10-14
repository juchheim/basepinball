import type { StingerName } from '../audio/organ';
import type { SoundName } from '../audio/sounds';
import type { MaterialName } from '../physics/params';
import type { Impact, PhysicsEvent } from '../physics/world';
import { POSITIONS, type GameSnapshot, type RulesEvent } from '../rules/types';
import type { SaucerDef, TableDef } from '../table/schema';
import type { ShowName } from './lampShows';

/**
 * The presentation director (docs/MVP/05 § 9, 06 § 2): turns physics switches, ball impacts and
 * rules events into sound, lamp shows, figure animation, particles and stadium reactions. It only
 * ever *reads* the game; celebrations run alongside a live ball and never pause it.
 *
 * Output goes through {@link PresentationOut}, so tests can check that every event is both seen
 * and heard (tests/fx/director.test.ts).
 */

/** A playfield position as fractions (x 0 = left, y 0 = flippers). */
export interface Place {
  x: number;
  y: number;
}

export type CrowdReaction = 'cheer' | 'roar' | 'groan' | 'ooh' | 'clap';

export interface PresentationOut {
  // ---- audio
  sound(name: SoundName, at?: Place, gain?: number): void;
  impact(material: MaterialName, speed: number, at: Place): void;
  stinger(name: StingerName): void;
  crowd(reaction: CrowdReaction, level?: number): void;
  crowdIntensity(level: number): void;
  // ---- visual
  /** Brighten a lamp or device. */
  flash(id: string): void;
  /** Mechanical motion of a coil-driven part. */
  fire(id: string): void;
  show(name: ShowName): void;
  figure(action: FigureAction): void;
  fireworks(count: number): void;
  scoreboard(text: string, sub: string, color: string, seconds: number): void;
  excite(level: number): void;
  /** The crowd does the wave (7th-inning stretch). */
  wave(): void;
  /** Light towers and the cabinet's GI: on (with a warm-up) or dimmed for attract mode. */
  lights(on: boolean): void;
  /** The cabinet's GI drops out for a beat and surges back (a home run). */
  giFlash(): void;
  shake(amount: number): void;
}

export type FigureAction =
  | { kind: 'catch'; position: string; x: number; y: number; grass: boolean }
  | { kind: 'throw'; position: string; x: number; y: number }
  | { kind: 'dive'; position: string; side: number }
  | { kind: 'windup'; lead: number }
  | { kind: 'release' }
  | { kind: 'punchOut' }
  | { kind: 'umpire' }
  | { kind: 'safe' }
  | { kind: 'celebrate' }
  | { kind: 'hit'; bases: number }
  | { kind: 'steal'; from: number }
  | { kind: 'walk'; moved: number[] }
  | { kind: 'advance'; moved: number[] }
  | { kind: 'clearBases' };

const MM = 0.001;

export class Director {
  private readonly saucers: SaucerDef[];
  private readonly width: number;
  private readonly length: number;
  private readonly diveCooldown = new Map<string, number>();
  private clock = 0;
  private lastOoh = -10;
  /** Reduced motion: no camera shake, a single firework. */
  reduced = false;

  constructor(
    table: TableDef,
    private readonly out: PresentationOut,
  ) {
    this.saucers = table.elements.filter((e): e is SaucerDef => e.type === 'saucer');
    this.width = table.width * MM;
    this.length = table.length * MM;
  }

  private place(x: number, y: number): Place {
    return { x: x / this.width, y: y / this.length };
  }

  // ---------------------------------------------------------------- input

  flipper(side: 'L' | 'R', pressed: boolean): void {
    const at = { x: side === 'L' ? 0.35 : 0.65, y: 0.12 };
    this.out.sound(pressed ? 'flipperUp' : 'flipperDown', at);
  }

  nudge(): void {
    this.out.sound('nudge');
    if (!this.reduced) this.out.shake(0.004);
  }

  // ---------------------------------------------------------------- physics

  physics(e: PhysicsEvent, ball: { x: number; y: number } | null): void {
    const at = ball ? this.place(ball.x, ball.y) : undefined;
    switch (e.type) {
      case 'pop': {
        // Singles and doubles sound different (three variants across the nest).
        const variant = e.id.includes('2B') ? 'pop1' : e.id.endsWith('.R') ? 'pop2' : 'pop0';
        this.out.sound(variant, at);
        this.out.flash(e.id);
        this.out.fire(e.id);
        return;
      }
      case 'sling':
      case 'kicker':
        this.out.sound(e.type, at);
        this.out.flash(e.id);
        this.out.fire(e.id);
        return;
      case 'standup':
        this.out.sound('standup', at);
        this.out.flash(e.id);
        this.out.fire(e.id);
        return;
      case 'drop':
        this.out.sound('drop', at);
        this.out.flash(e.id);
        return;
      case 'spinner':
        this.out.sound('spinner', at);
        this.out.flash(e.id.endsWith('.L') ? 'arrow.orbit.L' : 'arrow.orbit.R');
        return;
      case 'saucer': {
        const s = this.saucers.find((x) => x.id === e.id);
        this.out.sound('saucer', s ? this.place(s.x * MM, s.y * MM) : at);
        // The Bullpen scoop has no fielder: its lock lamps flash instead.
        if (s && !s.label) {
          this.out.flash('lamp.bullpen.1');
          this.out.flash('lamp.bullpen.2');
        }
        if (s?.label) {
          // The outfielders stand on the grass; the rest are on the dirt.
          this.out.figure({
            kind: 'catch',
            position: s.label,
            x: s.x,
            y: s.y,
            grass: s.label === 'CF' || s.label === 'LF' || s.label === 'RF',
          });
          this.out.figure({ kind: 'throw', position: s.label, x: s.x, y: s.y });
        }
        return;
      }
      case 'drain':
        this.out.sound('drain', { x: 0.5, y: 0 });
        return;
      case 'kickback':
        this.out.sound('kickback', { x: 0.05, y: 0.15 });
        this.out.flash('lamp.kickback');
        if (!this.reduced) this.out.shake(0.003);
        return;
      case 'plunger':
        this.out.sound('plunger', { x: 0.98, y: 0.05 });
        return;
      case 'sensor':
        if (e.id === 'gate.HR' || e.id === 'gate.STEAL') {
          this.out.sound('gate', at);
          this.out.flash(e.id === 'gate.HR' ? 'arrow.ramp.HR' : 'arrow.ramp.STEAL');
        } else if (e.id.startsWith('lane.') || e.id.includes('lane.')) {
          this.out.sound('rollover', at);
          if (e.id.startsWith('lane.')) this.out.flash(`lamp.${e.id}`);
          // Heading down an outlane: the crowd sees it coming.
          if (e.id.startsWith('outlane.') && this.clock - this.lastOoh > 3) {
            this.lastOoh = this.clock;
            this.out.crowd('ooh');
          }
        }
        return;
      default:
        // eos, swing (heard from the button), tiltBob (the rules decide).
        return;
    }
  }

  impact(i: Impact): void {
    this.out.impact(i.material, i.speed, this.place(i.x, i.y));
  }

  // ---------------------------------------------------------------- rules

  rules(e: RulesEvent, g: GameSnapshot | null): void {
    const o = this.out;
    switch (e.type) {
      case 'gameStart':
        o.lights(true);
        o.sound('towers');
        o.show('gameStart');
        o.crowd('cheer', 0.5);
        o.excite(0.6);
        return;
      case 'inningStart':
        o.stinger(e.inning === 7 ? 'stretch' : 'inningStart');
        o.scoreboard(e.inning === 7 ? 'STRETCH!' : `INNING ${e.inning}`, '', '#f2b33d', 2.2);
        o.crowd('cheer', 0.3);
        o.excite(e.inning === 7 ? 0.8 : 0.3);
        if (e.inning === 7) o.wave();
        return;
      case 'pitchTell':
        o.sound(`tell${e.pitch}`);
        o.figure({ kind: 'windup', lead: e.lead });
        return;
      case 'pitch':
        o.sound('pitch', { x: 0.5, y: 0.3 });
        o.figure({ kind: 'release' });
        o.flash(`pitch.${e.pitch}`);
        if (e.pitch === 'CB') o.sound('magnet', { x: 0.5, y: 0.25 });
        return;
      case 'hit': {
        o.figure({ kind: 'hit', bases: e.bases });
        if (e.hit === 'HR' || e.bases >= 4) {
          o.crowd('roar');
          o.stinger('homeRun');
          o.show('homeRun');
          o.fireworks(this.reduced ? 1 : 5);
          if (!this.reduced) o.giFlash();
          o.scoreboard('HOME RUN', e.runs > 1 ? `${e.runs} RUNS SCORE` : '', '#ff4d4d', 3.5);
          o.figure({ kind: 'celebrate' });
          o.excite(1);
        } else {
          o.crowd('cheer', [0.35, 0.55, 0.75][e.bases - 1] ?? 0.5);
          o.show('hit');
          o.excite(0.25 * e.bases);
          if (e.bases === 3) o.scoreboard('TRIPLE!', '', '#f2b33d', 1.6);
        }
        return;
      }
      case 'out':
        if (e.how === 'K') {
          o.figure({ kind: 'punchOut' });
          o.stinger('strikeout');
          o.crowd('groan');
          o.show('strikeout');
          o.scoreboard('K', `${e.outs} OUT`, '#ff4d4d', 1.6);
        } else if (e.how === 'foul') {
          o.figure({ kind: 'umpire' });
          o.crowd('groan', 0.6);
          o.flash('outlane.L');
          o.flash('outlane.R');
          o.scoreboard('FOUL OUT', `${e.outs} OUT`, '#ff9f1c', 1.4);
        } else if (e.how === 'fielder') {
          o.figure({ kind: 'umpire' });
          o.crowd('groan', 0.4);
          o.scoreboard('OUT', e.position ? `CAUGHT BY ${e.position}` : '', '#ff6b6b', 1.4);
        } else {
          // Tilt: the tilt event carries the presentation.
          o.sound('tiltWarning');
          o.scoreboard('OUT', 'TILT', '#ff6b6b', 1.4);
        }
        return;
      case 'runs':
        o.crowd('cheer', Math.min(1, 0.5 + e.runs * 0.15));
        o.flash('base.home');
        o.excite(0.5 + e.runs * 0.1);
        return;
      case 'steal':
        o.figure({ kind: 'steal', from: e.from });
        o.figure({ kind: 'safe' });
        o.sound('slide');
        o.show('steal');
        o.crowd('cheer', 0.6);
        o.scoreboard(e.runs > 0 ? 'STEALS HOME!' : 'SAFE!', '', '#3fe0cf', 1.8);
        return;
      case 'hustle':
        // Every runner takes an extra base; the five meter lamps flash and reset.
        o.figure({ kind: 'advance', moved: e.moved });
        o.sound('award');
        o.show('hit');
        for (let i = 1; i <= 5; i++) o.flash(`hustle.${i}`);
        o.crowd('cheer', e.runs > 0 ? 0.7 : 0.45);
        o.scoreboard('HUSTLE', e.runs > 0 ? 'RUN SCORES' : 'EXTRA BASE', '#7bd88f', 1.8);
        o.excite(0.5);
        return;
      case 'walk':
        o.figure({ kind: 'walk', moved: e.moved });
        o.sound('award');
        o.show('hit');
        o.flash('base.1B');
        // The four plates flash as the word is spelled (their lamps go dark as it resets).
        for (const l of ['W', 'A', 'L', 'K']) o.flash(`standup.${l}`);
        o.crowd('cheer', e.runs > 0 ? 0.6 : 0.35);
        o.scoreboard('WALK', e.runs > 0 ? 'RUN SCORES' : '', '#9b5de5', 1.6);
        return;
      case 'stealRamp':
        // A made right ramp with nobody on base to steal.
        o.sound('uiTick');
        o.flash('arrow.ramp.STEAL');
        return;
      case 'hotBat':
        o.sound('award');
        o.show('hotBat');
        o.crowd('cheer', 0.4);
        return;
      case 'spinBonus':
        // The hard plunge looped the orbit: the HUSTLE lamps blink to show the head start.
        o.sound('award');
        for (let i = 1; i <= 5; i++) o.flash(`hustle.${i}`);
        o.crowd('cheer', 0.3);
        o.scoreboard('SPIN BONUS', e.gained > 0 ? 'HUSTLE +1 DOT' : '', '#7bd88f', 1.6);
        return;
      case 'stretch':
        // The pitcher goes to the stretch: the mound's bumper is up, so shots over it are live.
        o.sound('award');
        o.flash('pop.mound');
        o.fire('pop.mound');
        o.crowd('ooh');
        o.scoreboard('FROM THE STRETCH', 'RUNNER ON', '#ff3b3b', 2);
        return;
      case 'bullpen':
        // A reliever warms up: the scoop's lock lamp lights.
        o.sound('award');
        o.show('bullpen');
        o.crowd('ooh');
        o.scoreboard('BULLPEN', 'A RELIEVER IS WARMING UP', '#ff9f1c', 2);
        return;
      case 'doubleheader':
        o.stinger('homeRun');
        o.crowd('roar');
        o.show('doubleheader');
        o.fireworks(this.reduced ? 1 : 4);
        if (!this.reduced) o.giFlash();
        o.scoreboard('DOUBLEHEADER!', 'TWO BALLS · NO OUTS · RUNS COUNT TWICE', '#ff9f1c', 4);
        o.excite(1);
        return;
      case 'ballSaved':
        o.sound('uiConfirm');
        o.flash('pitch.FB');
        o.flash('pitch.CH');
        o.flash('pitch.CB');
        return;
      case 'fieldingError':
        // In DOUBLEHEADER a catch is dropped: no out, and the fielder throws the ball back in.
        o.crowd('ooh');
        o.sound('uiTick');
        o.scoreboard(`E${POSITIONS[e.position]}`, `ERROR ON THE ${e.position}`, '#ff9f1c', 1.4);
        return;
      case 'doubleheaderEnd':
        o.crowd('cheer', e.runs > 0 ? 0.7 : 0.3);
        o.scoreboard(
          'DOUBLEHEADER OVER',
          `${e.runs} RUN${e.runs === 1 ? '' : 'S'}`,
          '#ff9f1c',
          2.5,
        );
        return;
      case 'kickbackLit':
        o.sound('award');
        o.flash('lamp.kickback');
        return;
      case 'skillShot':
        o.sound('award');
        o.show('skillShot');
        o.crowd('cheer', 0.5);
        o.scoreboard('SKILL SHOT', 'HOT BAT LIT', '#f2b33d', 1.8);
        return;
      case 'rally':
        o.flash(`rally.${Math.min(5, e.count)}`);
        if (e.count >= 2) {
          o.show('rally');
          o.crowd('clap');
          o.excite(Math.min(1, 0.2 * e.count));
        }
        if (e.count >= 3) o.stinger('rally');
        else o.sound('uiTick');
        return;
      case 'tiltWarning':
        o.sound('tiltWarning');
        if (!this.reduced) o.shake(0.003);
        o.flash('lamp.kickback');
        return;
      case 'tilt':
        o.sound('tilt');
        o.show('tilt');
        o.crowd('groan');
        return;
      case 'ballSearch':
        // A real ball search pulses every coil.
        o.sound('search');
        for (const id of [
          'pop.1B.L',
          'pop.1B.R',
          'pop.2B.L',
          'pop.2B.R',
          'pop.mound',
          'sling.L',
          'sling.R',
        ]) {
          o.fire(id);
        }
        return;
      case 'ballRescued':
        o.sound('uiConfirm');
        o.show('rally');
        return;
      case 'inningEnd':
        o.stinger('sideRetired');
        o.show('inningEnd');
        o.figure({ kind: 'clearBases' });
        o.crowd(e.runs > 0 ? 'cheer' : 'groan', 0.3);
        return;
      case 'gameOver': {
        const runs = g?.stats.runs ?? 0;
        o.stinger('gameOver');
        o.show('gameOver');
        o.fireworks(this.reduced ? 1 : Math.min(12, 2 + runs));
        o.scoreboard('FINAL', `${runs} RUN${runs === 1 ? '' : 'S'}`, '#f2b33d', 6);
        o.crowd('cheer', 0.7);
        o.excite(0.7);
        return;
      }
    }
  }

  // ---------------------------------------------------------------- per frame

  /** Near misses and crowd tension; `ball` in metres, `dt` in seconds. */
  frame(
    dt: number,
    ball: { x: number; y: number; speed: number } | null,
    g: GameSnapshot | null,
  ): void {
    this.clock += dt;
    if (ball && ball.speed > 0.8) {
      for (const s of this.saucers) {
        if (!s.label) continue;
        const dx = ball.x - s.x * MM;
        const dy = ball.y - s.y * MM;
        const d = Math.sqrt(dx * dx + dy * dy);
        // Within 15 mm of the rim, but not in it.
        if (d < (s.radius + 15 + 13.5) * MM && d > s.radius * MM) {
          if (this.clock < (this.diveCooldown.get(s.id) ?? 0)) continue;
          this.diveCooldown.set(s.id, this.clock + 1.2);
          this.out.figure({ kind: 'dive', position: s.label, side: dx < 0 ? -1 : 1 });
        }
      }
    }
    if (g) {
      const risp = g.bases[1] || g.bases[2];
      let level = 0.15;
      if (risp) level += 0.3;
      if (g.rally >= 2) level += 0.1 * Math.min(4, g.rally);
      if (g.inning >= 7) level += 0.15;
      if (g.outs === 2) level += 0.15;
      this.out.crowdIntensity(Math.min(1, level));
    } else {
      this.out.crowdIntensity(0.12);
    }
  }
}
