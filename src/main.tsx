import { render } from 'preact';
import * as THREE from 'three/webgpu';
import { BRAND } from './app/brand';
import { DiagLog } from './app/diag';
import { FixedLoop } from './app/loop';
import {
  BlankTracker,
  CanvasProbe,
  FrameGuard,
  showFatal,
  startupFailure,
  watchContextLoss,
} from './app/resilience';
import { Crowd } from './audio/crowd';
import { AudioEngine } from './audio/engine';
import { playStinger } from './audio/organ';
import { RollSound } from './audio/sfx';
import { SOUNDS } from './audio/sounds';
import { Director } from './fx/director';
import { LampShows } from './fx/lampShows';
import { createOutput } from './fx/output';
import { loadParams } from './debug/params';
import { Input, vibrate, type InputEvent } from './input/input';
import { World } from './physics/world';
import { BLEACHERS, GameRules } from './rules/game';
import type { RulesEvent } from './rules/types';
import { WorldMachine } from './rules/worldMachine';
import { AdaptiveQuality, initialTier, TIERS, type Quality } from './render/quality';
import { Stadium } from './render/stadium';
import { STANDEE_CELLS, STANDEE_GRID } from './render/standeeAtlas';
import { Stage } from './render/stage';
import { TableView } from './render/tableView';
import { loadSlot } from './render/textures';
import { addHighScore, loadHighScores, qualifies } from './storage/highscores';
import { loadLifetime, recordGame } from './storage/lifetime';
import {
  bindKey,
  DEFAULT_KEYS,
  loadSettings,
  reducedMotion as isReducedMotion,
  saveSettings,
  type RemappableAction,
  type Settings,
} from './storage/settings';
import { m0TestTable } from './table/m0TestTable';
import { v1Table } from './table/v1Table';
import { App } from './ui/App';
import {
  calloutFor,
  showCallout,
  pitchCueFor,
  finalStats,
  highScores,
  howToOpen,
  lastRank,
  lifetime,
  qualified,
  remapping,
  resumeCount,
  screen,
  settings,
  settingsNote,
  settingsOpen,
  snapshot,
} from './ui/store';

/**
 * Steel Diamond: the v1 table with the baseball rules, HUD, game flow, and (M4) the presentation:
 * sound, lamp shows, figure animation, particles and stadium reactions.
 * `?debug` adds the physics tuning panel, perf overlay and debug keys (B serve, K pitch,
 * C colliders, J drop the ball in the Bleachers, [ ] slow motion). `?table=m0` loads the M0 physics test table in free play.
 */

async function main(): Promise<void> {
  const container = document.getElementById('app')!;
  const query = new URLSearchParams(location.search);
  const debug = query.has('debug');
  // Settings first: "Graphics: Compatibility" (or the watchdog, after a blank canvas) forces the
  // WebGL2 backend. `?webgl` forces it too; `?webgpu` overrides the saved choice.
  let cfg: Settings = loadSettings();
  const forceWebGL = query.has('webgl') || (cfg.graphics === 'compat' && !query.has('webgpu'));
  let stage: Stage;
  try {
    stage = new Stage(container, forceWebGL);
    await stage.init();
  } catch (err) {
    console.error(err);
    showFatal(startupFailure(err, forceWebGL));
    return;
  }

  const params = loadParams();
  const freePlay = query.get('table') === 'm0';
  const table = freePlay ? m0TestTable : v1Table;
  const world = new World(table, params);
  const machine = new WorldMachine(world);
  const MM = 0.001;

  const view = new TableView(table, world);
  const stadium = new Stadium(BRAND.game);
  const tilt = (): void => {
    for (const g of [view.group, stadium.group])
      g.rotation.x = -Math.PI / 2 + (params.slopeDeg * Math.PI) / 180;
    stage.scene.updateMatrixWorld();
    // Key lights shine from the light towers onto the middle of the playfield.
    stage.aimKeyLights(
      stadium.towerHeads.map((h) => stadium.group.localToWorld(h.clone())),
      view.group.localToWorld(new THREE.Vector3(0.275, 0.55, 0)),
    );
    // Keep the top of the backboard (and its scoreboard) in the shot.
    stage.fit(
      view.group,
      [new THREE.Vector3(0, 1.17, 0.26), new THREE.Vector3(0.59, 1.17, 0.26)].map((p) =>
        view.group.localToWorld(p),
      ),
    );
  };
  stage.scene.add(view.group, stadium.group);
  tilt();

  // ---- presentation (M4): audio, lamp shows, director
  const audio = new AudioEngine();
  const crowd = new Crowd(audio);
  let roll: RollSound | null = null;
  audio.onStart((a) => {
    crowd.start();
    roll = new RollSound(a, a.bus('mech')!);
  });
  // The first gesture anywhere starts the audio (iOS and Chrome autoplay rules).
  const unlock = (): void => audio.unlock();
  window.addEventListener('pointerdown', unlock);
  window.addEventListener('keydown', unlock);
  settings.value = cfg;
  const shows = new LampShows(table);
  // Light level: the towers and key lights dim for attract mode and warm up at game start.
  const keyBase = stage.keyLights.map((l) => l.intensity);
  let lightLevel = 0.55;
  let lightTarget = 0.55;
  const setLights = (on: boolean): void => {
    lightTarget = on ? 1 : 0.55;
    stadium.setTowers(on);
  };
  const director = new Director(
    table,
    createOutput({ audio, crowd, view, shows, stadium, stage, setLights }),
  );
  const ui = (name: 'uiTick' | 'uiConfirm'): void => {
    const s = SOUNDS[name];
    audio.play(name, s.bus, s.recipe, { poly: s.poly });
  };

  // ---- diagnostics (shown with ?debug): what happened just before, if the canvas ever blanks
  const diag = new DiagLog();
  diag.log(`boot ${stage.backend}, dpr ${window.devicePixelRatio}`);
  stage.onResize = (w, h, pr) =>
    diag.log(`resize ${w}x${h} @${pr.toFixed(2)} = ${Math.round(w * pr)}x${Math.round(h * pr)}`);

  // ---- quality tier, textures, standees, reflections
  let textureWidth = 0;
  // Compile all shaders once the textures are in (see `Stage.warmUp`), while the title screen is up.
  let pendingLoads = freePlay ? 1 : 2;
  let warmPending = false;
  const loaded = (): void => {
    if (--pendingLoads !== 0) return;
    warmPending = true;
  };
  // `live`: the adaptive controller stepping down mid-game. That changes only the resolution and
  // the crowd; effects that change shaders (bloom, shadows, reflections) stay as they were.
  const applyQuality = (q: Quality, live = false): void => {
    diag.log(`quality -> ${q.name}${live ? ' (resolution only)' : ''}`);
    stage.applyQuality(q, live);
    if (!live) view.setReflections(q.reflectionSize, q.reflectionEvery);
    stadium.setCrowd(q.crowd);
    if (q.playfieldTexture !== textureWidth && !freePlay) {
      textureWidth = q.playfieldTexture;
      void loadSlot('playfield.base', q.playfieldTexture).then((tex) => {
        if (tex) {
          view.setPlayfieldTexture(tex);
          diag.log(`playfield texture ${q.playfieldTexture} applied`);
        }
        loaded();
      });
    }
  };
  const quality = new AdaptiveQuality(initialTier(query, stage.backend), (q) =>
    applyQuality(q, true),
  );
  quality.enabled = !query.has('quality');
  if (!query.has('quality') && cfg.quality !== 'auto') {
    quality.tier = TIERS[cfg.quality];
    quality.enabled = false;
  }
  applyQuality(quality.tier);
  void loadSlot('standees', 600).then((tex) => {
    if (tex) {
      view.addStandees(tex, STANDEE_CELLS, STANDEE_GRID);
      diag.log('standees built');
    }
    loaded();
  });
  // Redraw the backboard and scoreboard once the display font is ready.
  void document.fonts?.load('bold 40px Oswald').then(() => {
    stadium.drawBackboard();
    stadium.update(null, BRAND.game);
  });

  let rules: GameRules | null = null;
  const timers: { at: number; run: () => void }[] = [];
  const after = (seconds: number, run: () => void): void => {
    timers.push({ at: world.time + seconds, run });
  };

  // ---- attract / free play: a ball on the plunger (or in the M0 test table's spawn spot)
  const idleBall = (): void => {
    if (freePlay) {
      world.balls.length = 0;
      world.addBall(table.spawn.x * MM, table.spawn.y * MM);
    } else {
      world.serveBall();
    }
  };
  world.reset();
  idleBall();

  // ---- haptics: gamepad rumble (flips, bumpers, outs) and phone vibration (Android)
  let input: Input | null = null;
  const haptic = (strength: number, rumbleMs: number, vibrateMs: number): void => {
    if (!cfg.haptics) return;
    input?.rumble(strength, rumbleMs);
    if (vibrateMs > 0) vibrate(vibrateMs);
  };

  // ---- presentation of rules events
  const presentRules = (e: RulesEvent): void => {
    if (e.type === 'out') haptic(0.7, 160, 60);
    if (e.type === 'hit')
      haptic(e.bases >= 4 ? 1 : 0.5, e.bases >= 4 ? 400 : 120, e.bases >= 4 ? 120 : 0);
    calloutFor(e);
    pitchCueFor(e);
    director.rules(e, rules?.snapshot() ?? null);
    if (e.type === 'gameOver') {
      after(2.2, () => {
        lifetime.value = recordGame(rules!.stats);
        finalStats.value = { ...rules!.stats };
        qualified.value = qualifies(rules!.stats);
        screen.value = 'gameover';
      });
    }
  };

  const loop = new FixedLoop(
    () => world,
    () => {
      // Sounds are placed at a ball in play (in multiball, the first one).
      const ball = world.balls.find((b) => b.active);
      for (const e of world.events) {
        director.physics(e, ball ? { x: ball.px, y: ball.py } : null);
        rules?.onSwitch(e);
        if (e.type === 'pop' || e.type === 'sling') haptic(0.3, 40, 0);
        if (freePlay && e.type === 'drain') after(1, idleBall);
      }
      world.events.length = 0;
      for (const i of world.impacts) director.impact(i);
      world.impacts.length = 0;
      if (rules) {
        rules.update(world.time);
        for (const e of rules.events) presentRules(e);
        rules.events.length = 0;
      }
      for (let i = timers.length - 1; i >= 0; i--) {
        if (world.time >= timers[i]!.at) timers.splice(i, 1)[0]!.run();
      }
    },
  );

  // ---- attract mode: lamps chase, the park lights are low
  const attract = (): void => {
    shows.stopAll();
    shows.start('attract');
    setLights(false);
    view.figures.clearBases();
  };
  if (!freePlay) attract();
  else setLights(true);

  // ---- game flow
  const start = (): void => {
    ui('uiConfirm');
    diag.log('game start');
    world.reset();
    timers.length = 0;
    rules = new GameRules(machine, { seed: (Date.now() & 0x7fffffff) >>> 0 });
    audio.unlock();
    shows.stop('attract');
    view.figures.sync([false, false, false]);
    rules.start(world.time);
    lastRank.value = -1;
    screen.value = 'playing';
    loop.paused = false;
    loop.resync();
  };
  const toTitle = (): void => {
    rules = null;
    attract();
    world.reset();
    idleBall();
    highScores.value = loadHighScores();
    screen.value = 'title';
    loop.paused = false;
    loop.resync();
  };
  const actions = {
    start: () => {
      if (!freePlay) start();
    },
    resume: () => {
      // A 3-2-1 countdown before the physics restarts (docs/MVP/01 § 5).
      if (resumeCount.value !== null) return;
      settingsOpen.value = false;
      let n = 3;
      resumeCount.value = n;
      ui('uiTick');
      const step = (): void => {
        n -= 1;
        if (screen.value !== 'paused') {
          resumeCount.value = null;
          return;
        }
        if (n > 0) {
          resumeCount.value = n;
          ui('uiTick');
          setTimeout(step, 700);
          return;
        }
        resumeCount.value = null;
        audio.setPaused(false);
        screen.value = 'playing';
        loop.paused = false;
        loop.resync();
      };
      setTimeout(step, 700);
    },
    pause: () => pauseGame(),
    openSettings: () => {
      ui('uiTick');
      settingsOpen.value = true;
    },
    closeSettings: () => {
      ui('uiTick');
      remapping.value = null;
      settingsOpen.value = false;
    },
    updateSettings: (patch: Partial<Settings>) => updateSettings(patch),
    remap: (action: RemappableAction) => {
      (document.activeElement as HTMLElement | null)?.blur();
      remapping.value = action;
      input?.captureKey((code) => {
        remapping.value = null;
        if (code) updateSettings({ keys: bindKey(cfg, action, code).keys });
      });
    },
    resetKeys: () => updateSettings({ keys: DEFAULT_KEYS }),
    quit: toTitle,
    saveInitials: (initials: string) => {
      const stats = finalStats.value;
      if (stats && qualified.value && initials) {
        const { scores, rank } = addHighScore(initials, stats);
        highScores.value = scores;
        lastRank.value = rank;
        playStinger(audio, 'highScore');
      } else {
        highScores.value = loadHighScores();
      }
      rules = null;
      attract();
      world.reset();
      idleBall();
      screen.value = 'scores';
    },
  };
  highScores.value = loadHighScores();
  lifetime.value = loadLifetime();
  // The how-to-play screen has its own address, for linking: /#how-to-play.
  const fromHash = (): void => {
    if (location.hash === '#how-to-play') howToOpen.value = true;
  };
  fromHash();
  window.addEventListener('hashchange', fromHash);
  if (freePlay) screen.value = 'playing';

  function pauseGame(): void {
    if (screen.value !== 'playing' || !rules) return;
    screen.value = 'paused';
    loop.paused = true;
    input?.releaseAll();
    audio.setPaused(true);
  }

  // ---- settings: apply now and on every change; saved to localStorage
  const applySettings = (): void => {
    audio.setVolumes({
      master: cfg.volume.master,
      mech: cfg.volume.sfx,
      ui: cfg.volume.sfx,
      stadium: cfg.volume.crowd,
      music: cfg.volume.music,
      muted: cfg.muted,
    });
    const reduced = isReducedMotion(cfg);
    shows.reduced = reduced;
    director.reduced = reduced;
    input?.setKeys(cfg.keys);
    if (!query.has('quality')) {
      if (cfg.quality === 'auto') quality.enabled = true;
      else if (quality.tier.name !== cfg.quality || quality.enabled) {
        quality.enabled = false;
        quality.tier = TIERS[cfg.quality];
        applyQuality(quality.tier);
      }
    }
  };
  function updateSettings(patch: Partial<Settings>): void {
    cfg = { ...cfg, ...patch };
    settings.value = cfg;
    saveSettings(cfg);
    applySettings();
    if (patch.motionNudge !== undefined) {
      settingsNote.value = '';
      // iOS asks for motion permission here, inside the tap on the toggle.
      void input?.enableMotion(patch.motionNudge).then((ok) => {
        if (patch.motionNudge && !ok) {
          settingsNote.value = 'Motion sensors are not available (or permission was denied).';
          cfg = { ...cfg, motionNudge: false };
          settings.value = cfg;
          saveSettings(cfg);
        }
      });
    }
  }

  const uiRoot = document.createElement('div');
  document.body.appendChild(uiRoot);
  render(<App actions={actions} />, uiRoot);

  // ---- input
  const playing = (): boolean => screen.value === 'playing' || freePlay || screen.value === 'title';
  const onInput = (e: InputEvent): void => {
    const at = (apply: (w: World) => void): void => loop.push({ time: e.time, apply });
    const s = screen.value;
    switch (e.action) {
      case 'flipperL':
      case 'flipperR': {
        if (!playing()) return;
        const side = e.action === 'flipperL' ? 'L' : 'R';
        // Heard at once, from the button (the coil fires with the press).
        if (world.flippersEnabled) {
          director.flipper(side, e.pressed);
          if (e.pressed) haptic(0.25, 40, 12);
        }
        at((w) => {
          w.setFlipper(`flipper.${side}`, e.pressed);
          rules?.onButton(side, e.pressed);
        });
        return;
      }
      case 'plunger':
        if (settingsOpen.value || howToOpen.value) return;
        // Starting a game: a fresh press, not a drag in progress.
        if (e.pressed && e.value === undefined && (s === 'title' || s === 'scores') && !freePlay)
          return start();
        if (s !== 'playing') return;
        if (e.pressed && e.value !== undefined) at((w) => w.setPlungerPull(e.value!));
        else at((w) => w.setPlunger(e.pressed));
        return;
      case 'nudgeL':
      case 'nudgeR':
      case 'nudgeUp':
        if (s !== 'playing' || !e.pressed) return;
        director.nudge();
        at((w) =>
          w.nudge(
            e.action === 'nudgeL' ? -1 : e.action === 'nudgeR' ? 1 : 0,
            e.action === 'nudgeUp' ? 1 : 0,
          ),
        );
        return;
      case 'pause':
        if (!e.pressed) return;
        if (settingsOpen.value) return actions.closeSettings();
        if (howToOpen.value) {
          howToOpen.value = false;
          return;
        }
        if (s === 'playing') pauseGame();
        else if (s === 'paused') actions.resume();
        return;
      case 'mute':
        if (!e.pressed) return;
        updateSettings({ muted: !cfg.muted });
        showCallout(cfg.muted ? 'SOUND OFF' : 'SOUND ON', undefined, 'info', 900);
        return;
    }
    if (!debug || !e.pressed) return;
    // Debug keys.
    if (e.action === 'serve') at(() => world.serveBall());
    if (e.action === 'pitch') at(() => world.pitchBall(0.221, 0.175, 1.2));
    if (e.action === 'resetTargets') world.resetDropTargets();
    if (e.action === 'toggleColliders') view.showColliders = !view.showColliders;
    if (e.action === 'bleachers') {
      // Set the ball in play down by the Bleachers scoop, to try THROW IT BACK.
      const s = world.table.elements.find((el) => el.type === 'saucer' && el.id === BLEACHERS);
      const b = world.balls.find((x) => x.active);
      if (s?.type === 'saucer' && b) at(() => b.place(s.x / 1000, s.y / 1000));
    }
    if (e.action === 'slower') loop.timeScale = Math.max(0.05, loop.timeScale / 2);
    if (e.action === 'faster') loop.timeScale = Math.min(1, loop.timeScale * 2);
  };
  input = new Input(stage.renderer.domElement, onInput, debug);

  let stopped = false;
  // A lost graphics context (GPU reset, the OS reclaiming memory) can't be recovered in place:
  // pause, and offer a reload. Scores and settings are already saved.
  watchContextLoss(
    stage.renderer.domElement,
    (
      stage.renderer as unknown as {
        backend: { device?: { lost?: Promise<{ reason?: string; message?: string }> } };
      }
    ).backend.device,
    (why) => {
      console.warn(why);
      stopped = true;
      pauseGame();
      audio.setPaused(true);
      showFatal({
        title: 'The graphics were reset',
        body: 'Your device reset its graphics (this can happen when memory runs low or the graphics driver restarts). Reload to play on. High scores and settings are safe; the game in progress is lost.',
        action: 'reload',
      });
    },
  );
  // GPU validation errors are silent by default; keep a count and log the first few (they are the
  // usual evidence when the canvas goes blank).
  let gpuErrors = 0;
  stage.gpuDevice?.addEventListener('uncapturederror', (e) => {
    gpuErrors++;
    if (gpuErrors <= 5) console.error('GPU error', (e as GPUUncapturedErrorEvent).error?.message);
  });

  // Blank-canvas watchdog: if the canvas stops showing the scene (the renderer stopped presenting
  // while the page carries on, as seen in Safari), nudge it, then switch to the WebGL2 backend.
  const probe = new CanvasProbe(stage.renderer.domElement);
  const blank = new BlankTracker();
  let faultInjected = false;
  const watchCanvas = (): void => {
    const had = blank.blankCount;
    const seen = faultInjected ? false : probe.hasContent();
    const action = blank.observe(seen);
    if (seen === false && had === 0) diag.log('canvas reads BLANK');
    if (seen === true && had > 0) diag.log(`canvas recovered after ${had} blank checks`);
    if (action === 'soft') {
      console.warn('canvas blank: nudging the renderer', diag.lines());
      diag.log('watchdog: nudge');
      stage.recover();
    } else if (action === 'rebuild') {
      console.warn('canvas still blank: rebuilding render targets', diag.lines());
      diag.log('watchdog: rebuild');
      stage.recover(true);
      view.setReflections(quality.tier.reflectionSize, quality.tier.reflectionEvery);
    } else if (action === 'fallback') {
      console.warn(`canvas blank: ${stage.backend} stopped drawing`, diag.lines());
      diag.log('watchdog: fallback');
      stopped = true;
      if (stage.backend === 'WebGPU') {
        // Remember the choice, and restart in compatibility mode.
        updateSettings({ graphics: 'compat' });
        showFatal({
          title: 'Switching to compatibility mode',
          body: 'The graphics stopped drawing, so Steel Diamond is restarting with the more widely supported WebGL2 renderer. Your settings and high scores are kept.',
          action: 'webgl',
        });
        setTimeout(() => {
          const url = new URL(location.href);
          url.searchParams.set('webgl', '');
          location.href = url.toString();
        }, 2500);
      } else {
        showFatal({
          title: 'The graphics stopped drawing',
          body: 'The display stopped updating. Reload to start again; high scores and settings are safe.',
          action: 'reload',
        });
      }
    }
  };
  applySettings();
  // Motion nudge (if it was on last time) starts with the first gesture (iOS permission rules).
  if (cfg.motionNudge) {
    const once = (): void => {
      void input?.enableMotion(true);
      window.removeEventListener('pointerdown', once);
    };
    window.addEventListener('pointerdown', once);
  }

  // Auto-pause when the tab is hidden or the window loses focus (docs/MVP/01 § 5).
  window.addEventListener('blur', () => {
    if (!debug) pauseGame();
  });
  document.addEventListener('visibilitychange', () => {
    diag.log(document.hidden ? 'tab hidden' : 'tab visible');
    if (document.hidden) pauseGame();
    else loop.resync();
    // Hidden: fade out and suspend; the pause menu keeps it silent until resumed.
    if (document.hidden) audio.setPaused(true);
    else if (screen.value !== 'paused') audio.setPaused(false);
  });

  // ---- debug tools
  let perf: HTMLDivElement | null = null;
  let diagEl: HTMLPreElement | null = null;
  if (debug) {
    const state = { timeScale: 1, colliders: false, bloom: true, paused: false };
    // The tuning panel (and its UI library) loads only in debug mode.
    void import('./debug/panel').then(({ createPanel }) =>
      createPanel(params, {
        onParamsChange: () => {
          world.applyParams();
          tilt();
        },
        spawn: () => world.serveBall(),
        pitch: () => world.pitchBall(0.221, 0.175, 1.2),
        curveball: () => {
          world.setMagnet('magnet.curve', 1);
          after(0.25, () => world.setMagnet('magnet.curve', 0));
        },
        resetTargets: () => world.resetDropTargets(),
        state,
        onStateChange: () => {
          loop.timeScale = state.timeScale;
          loop.paused = state.paused;
          view.showColliders = state.colliders;
          if (stage.bloomEnabled !== state.bloom) stage.setBloom(state.bloom);
        },
      }),
    );
    perf = document.createElement('div');
    perf.className = 'perf';
    document.body.appendChild(perf);
    diagEl = document.createElement('pre');
    diagEl.className = 'diag';
    document.body.appendChild(diagEl);
    // Mouse: click-drag on the table to throw a ball.
    const raycaster = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    const pick = (ev: PointerEvent): THREE.Vector3 | null => {
      const r = stage.renderer.domElement.getBoundingClientRect();
      ndc.set(
        ((ev.clientX - r.left) / r.width) * 2 - 1,
        -((ev.clientY - r.top) / r.height) * 2 + 1,
      );
      raycaster.setFromCamera(ndc, stage.camera);
      const hit = raycaster.intersectObject(view.floor, false)[0];
      return hit ? view.group.worldToLocal(hit.point.clone()) : null;
    };
    let dragStart: THREE.Vector3 | null = null;
    const canvas = stage.renderer.domElement;
    canvas.addEventListener('pointerdown', (ev) => {
      if (ev.pointerType !== 'touch') dragStart = pick(ev);
    });
    canvas.addEventListener('pointerup', (ev) => {
      const start0 = dragStart;
      dragStart = null;
      if (!start0) return;
      const end = pick(ev) ?? start0;
      const dx = end.x - start0.x;
      const dy = end.y - start0.y;
      const len = Math.hypot(dx, dy) || 1;
      const speed = Math.min(8, len * 25);
      loop.push({
        time: ev.timeStamp,
        apply: (w) => {
          w.releaseSaucers();
          const b = w.ball();
          b.place(start0.x, start0.y);
          b.vx = (dx / len) * speed;
          b.vy = (dy / len) * speed;
        },
      });
    });
    (window as unknown as Record<string, unknown>).__bp = {
      stage,
      view,
      stadium,
      world,
      loop,
      params,
      quality,
      director,
      shows,
      audio,
      /** Simulate a renderer that stops presenting (tests the blank-canvas watchdog). */
      breakCanvas: () => (faultInjected = true),
      probe,
      watchCanvas,
      getRules: () => rules,
    };
  }

  // ---- frame loop
  let frames = 0;
  let fpsAt = performance.now();
  let physicsMsAvg = 0;
  let last = performance.now();
  let lastHud = 0;
  const guard = new FrameGuard();
  const tick = (now: number): void => {
    if (stopped) return;
    try {
      frame(now);
      guard.ok();
    } catch (err) {
      // One bad frame is logged and skipped; a long run of them stops with a message rather than
      // a frozen screen.
      if (guard.failed(err)) {
        showFatal({
          title: 'Something went wrong',
          body: `${BRAND.game} hit an error it could not recover from. Reload to start again; high scores and settings are safe.`,
          action: 'reload',
        });
        return;
      }
    }
    requestAnimationFrame(tick);
  };
  let lastFrameAt = performance.now();
  let slowLogged = 0;
  let framesSeen = 0;
  const frame = (now: number): void => {
    input?.pollGamepads();
    loop.frame(now);
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    // Lamps: the rules' states, with any running lamp show layered on top.
    shows.update(dt);
    const base = rules ? rules.lamps() : {};
    const over = shows.overrides();
    for (const id of shows.lampIds) view.setLamp(id, over.get(id) ?? base[id] ?? 'off');
    // Presentation per frame: crowd tension, near misses, the rolling ball, the lights.
    // The rolling sound and near misses follow the fastest ball in play (multiball has two).
    let b = world.balls[0];
    for (const x of world.balls) if (x.active && (!b?.active || x.speed() > b.speed())) b = x;
    const live = !!b && b.active && !loop.paused;
    const snap0 = rules ? rules.snapshot() : null;
    if (snap0) view.figures.sync(snap0.bases);
    director.frame(dt, b && live ? { x: b.px, y: b.py, speed: b.speed() } : null, snap0);
    if (b) roll?.update(b.speed(), b.surface, b.px / 0.55, b.py / 1.17, live);
    else roll?.update(0, 'playfield', 0.5, 0, false);
    lightLevel += (lightTarget - lightLevel) * Math.min(1, dt * 1.5);
    // A home run's GI flash takes the towers down with it (a ballpark light show).
    const flashLevel = 0.35 + 0.65 * view.giFlashLevel;
    stage.keyLights.forEach((l, i) => (l.intensity = keyBase[i]! * lightLevel * flashLevel));
    view.setGI(lightLevel);
    stadium.flashesEnabled = !director.reduced;
    stadium.tick(dt);
    // Attract mode sways the camera round the table; it settles into the player view as a game
    // starts (the lights-on intro). Never during play, never with reduced motion.
    const orbitTarget = screen.value === 'title' && !director.reduced && !debug ? 1 : 0;
    stage.orbit += (orbitTarget - stage.orbit) * Math.min(1, dt * (orbitTarget ? 0.4 : 1.6));
    if (director.reduced && orbitTarget === 0) stage.orbit = 0;
    // The HUD and scoreboard only need ~10 updates a second.
    if (now - lastHud > 100) {
      lastHud = now;
      const snap = rules ? rules.snapshot() : null;
      if (snap) snapshot.value = snap;
      stadium.update(snap, BRAND.game);
    }
    view.update(loop.alpha, dt);
    const drawStart = performance.now();
    view.updateReflections(stage.renderer, stage.scene);
    if (faultInjected) {
      // Debug fault injection: skip drawing and empty the canvas (assigning its width clears it),
      // the symptom the watchdog looks for.
      const c = stage.renderer.domElement;
      const w = c.width;
      c.width = 1;
      c.width = w;
    } else {
      // The warm-up draws every object once; the real frame follows at once and overwrites it.
      if (warmPending) {
        warmPending = false;
        try {
          diag.log(`shaders warmed in ${stage.warmUp().toFixed(0)} ms`);
        } catch (err) {
          console.warn('shader warm-up failed', err);
        }
      }
      stage.render();
    }
    // Stalls go in the `?debug` timeline: a slow frame, and a slow draw (a shader compiling, say).
    const drawMs = performance.now() - drawStart;
    if (!document.hidden && ++framesSeen > 5 && slowLogged < 12) {
      const gap = now - lastFrameAt;
      if (drawMs > 60 || gap > 150) {
        slowLogged++;
        diag.log(`slow frame: ${gap.toFixed(0)} ms apart, draw ${drawMs.toFixed(0)} ms`);
      }
    }
    lastFrameAt = now;
    // Every half second (and never while the tab is hidden): did that frame actually draw?
    if (frames % 30 === 29 && !document.hidden) watchCanvas();
    quality.frame(now, dt * 1000);

    frames++;
    physicsMsAvg = physicsMsAvg * 0.95 + loop.lastPhysicsMs * 0.05;
    if (perf && now - fpsAt > 500) {
      const fps = (frames * 1000) / (now - fpsAt);
      frames = 0;
      fpsAt = now;
      perf.textContent = `${stage.backend} · ${quality.tier.name} · ${fps.toFixed(0)} fps · physics ${(physicsMsAvg * 1000).toFixed(0)} µs/frame · state ${rules?.state ?? '—'}${gpuErrors ? ` · GPU errors ${gpuErrors}` : ''}`;
      if (diagEl) diagEl.textContent = diag.lines().join('\n');
    }
  };
  requestAnimationFrame(tick);
}

void main();
