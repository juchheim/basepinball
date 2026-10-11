import { render } from 'preact';
import * as THREE from 'three/webgpu';
import { BRAND } from './app/brand';
import { FixedLoop } from './app/loop';
import { Crowd } from './audio/crowd';
import { AudioEngine } from './audio/engine';
import { playStinger } from './audio/organ';
import { RollSound } from './audio/sfx';
import { SOUNDS } from './audio/sounds';
import { Director } from './fx/director';
import { LampShows } from './fx/lampShows';
import { createOutput } from './fx/output';
import { createPanel, loadParams } from './debug/panel';
import { bindInput, type InputEvent } from './input/input';
import { World } from './physics/world';
import { GameRules } from './rules/game';
import type { RulesEvent } from './rules/types';
import { WorldMachine } from './rules/worldMachine';
import { AdaptiveQuality, initialTier, type Quality } from './render/quality';
import { Stadium } from './render/stadium';
import { STANDEE_CELLS, STANDEE_GRID } from './render/standeeAtlas';
import { Stage } from './render/stage';
import { TableView } from './render/tableView';
import { loadSlot } from './render/textures';
import { addHighScore, loadHighScores, qualifies } from './storage/highscores';
import { m0TestTable } from './table/m0TestTable';
import { v1Table } from './table/v1Table';
import { App } from './ui/App';
import {
  calloutFor,
  showCallout,
  pitchCueFor,
  finalStats,
  highScores,
  lastRank,
  qualified,
  screen,
  snapshot,
} from './ui/store';

/**
 * Rally Ball: the v1 table with the baseball rules, HUD, game flow, and (M4) the presentation:
 * sound, lamp shows, figure animation, particles and stadium reactions.
 * `?debug` adds the physics tuning panel, perf overlay and debug keys (B serve, K pitch,
 * C colliders, [ ] slow motion). `?table=m0` loads the M0 physics test table in free play.
 */

async function main(): Promise<void> {
  const container = document.getElementById('app')!;
  const query = new URLSearchParams(location.search);
  const debug = query.has('debug');
  const stage = new Stage(container, query.has('webgl'));
  try {
    await stage.init();
  } catch (err) {
    container.innerHTML = `<div class="fatal">Could not start the renderer: ${String(err)}</div>`;
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
  const reducedMotion =
    typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const shows = new LampShows(table);
  shows.reduced = reducedMotion;
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
  director.reduced = reducedMotion;
  const ui = (name: 'uiTick' | 'uiConfirm'): void => {
    const s = SOUNDS[name];
    audio.play(name, s.bus, s.recipe, { poly: s.poly });
  };

  // ---- quality tier, textures, standees, reflections
  let textureWidth = 0;
  const applyQuality = (q: Quality): void => {
    stage.applyQuality(q);
    view.setReflections(q.reflectionSize, q.reflectionEvery);
    stadium.setCrowd(q.crowd);
    if (q.playfieldTexture !== textureWidth && !freePlay) {
      textureWidth = q.playfieldTexture;
      void loadSlot('playfield.base', q.playfieldTexture).then(
        (tex) => tex && view.setPlayfieldTexture(tex),
      );
    }
  };
  const quality = new AdaptiveQuality(initialTier(query), applyQuality);
  quality.enabled = !query.has('quality');
  applyQuality(quality.tier);
  void loadSlot('standees', 600).then(
    (tex) => tex && view.addStandees(tex, STANDEE_CELLS, STANDEE_GRID),
  );
  // Redraw the scoreboard once the display font is ready.
  void document.fonts?.load('bold 40px Oswald').then(() => stadium.update(null, BRAND.game));

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

  // ---- presentation of rules events
  const presentRules = (e: RulesEvent): void => {
    calloutFor(e);
    pitchCueFor(e);
    director.rules(e, rules?.snapshot() ?? null);
    if (e.type === 'gameOver') {
      after(2.2, () => {
        finalStats.value = { ...rules!.stats };
        qualified.value = qualifies(rules!.stats);
        screen.value = 'gameover';
      });
    }
  };

  const loop = new FixedLoop(
    () => world,
    () => {
      const ball = world.balls[0];
      for (const e of world.events) {
        director.physics(e, ball && ball.active ? { x: ball.px, y: ball.py } : null);
        rules?.onSwitch(e);
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
      audio.setPaused(false);
      screen.value = 'playing';
      loop.paused = false;
      loop.resync();
    },
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
  if (freePlay) screen.value = 'playing';

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
        if (world.flippersEnabled) director.flipper(side, e.pressed);
        at((w) => {
          w.setFlipper(`flipper.${side}`, e.pressed);
          rules?.onButton(side, e.pressed);
        });
        return;
      }
      case 'plunger':
        if (s === 'title' && e.pressed && !freePlay) return start();
        if (s === 'scores' && e.pressed) return start();
        if (s === 'playing') at((w) => w.setPlunger(e.pressed));
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
        if (s === 'playing' && rules) {
          screen.value = 'paused';
          loop.paused = true;
          audio.setPaused(true);
        } else if (s === 'paused') actions.resume();
        return;
      case 'mute':
        if (e.pressed)
          showCallout(audio.toggleMute() ? 'SOUND OFF' : 'SOUND ON', undefined, 'info', 900);
        return;
    }
    if (!debug || !e.pressed) return;
    // Debug keys.
    if (e.action === 'serve') at(() => world.serveBall());
    if (e.action === 'pitch') at(() => world.pitchBall(0.221, 0.175, 1.2));
    if (e.action === 'resetTargets') world.resetDropTargets();
    if (e.action === 'toggleColliders') view.showColliders = !view.showColliders;
    if (e.action === 'slower') loop.timeScale = Math.max(0.05, loop.timeScale / 2);
    if (e.action === 'faster') loop.timeScale = Math.min(1, loop.timeScale * 2);
  };
  bindInput(stage.renderer.domElement, onInput);

  // Auto-pause when the tab is hidden (docs/MVP/01 § 5).
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && screen.value === 'playing' && rules) {
      screen.value = 'paused';
      loop.paused = true;
    } else if (!document.hidden) loop.resync();
    // Hidden: fade out and suspend; the pause menu keeps it silent until resumed.
    if (document.hidden) audio.setPaused(true);
    else if (screen.value !== 'paused') audio.setPaused(false);
  });

  // ---- debug tools
  let perf: HTMLDivElement | null = null;
  if (debug) {
    const state = { timeScale: 1, colliders: false, bloom: true, paused: false };
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
    });
    perf = document.createElement('div');
    perf.className = 'perf';
    document.body.appendChild(perf);
    // Mouse: click-drag on the table to throw a ball.
    const raycaster = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    const pick = (ev: PointerEvent): THREE.Vector3 | null => {
      ndc.set((ev.clientX / window.innerWidth) * 2 - 1, -(ev.clientY / window.innerHeight) * 2 + 1);
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
      getRules: () => rules,
    };
  }

  // ---- frame loop
  let frames = 0;
  let fpsAt = performance.now();
  let physicsMsAvg = 0;
  let last = performance.now();
  let lastHud = 0;
  const tick = (now: number): void => {
    loop.frame(now);
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    // Lamps: the rules' states, with any running lamp show layered on top.
    shows.update(dt);
    const base = rules ? rules.lamps() : {};
    const over = shows.overrides();
    for (const id of shows.lampIds) view.setLamp(id, over.get(id) ?? base[id] ?? 'off');
    // Presentation per frame: crowd tension, near misses, the rolling ball, the lights.
    const b = world.balls[0];
    const live = !!b && b.active && !loop.paused;
    const snap0 = rules ? rules.snapshot() : null;
    if (snap0) view.figures.sync(snap0.bases);
    director.frame(dt, live ? { x: b.px, y: b.py, speed: b.speed() } : null, snap0);
    if (b) roll?.update(b.speed(), b.surface, b.px / 0.55, b.py / 1.17, live);
    else roll?.update(0, 'playfield', 0.5, 0, false);
    lightLevel += (lightTarget - lightLevel) * Math.min(1, dt * 1.5);
    stage.keyLights.forEach((l, i) => (l.intensity = keyBase[i]! * lightLevel));
    stadium.tick(dt);
    // The HUD and scoreboard only need ~10 updates a second.
    if (now - lastHud > 100) {
      lastHud = now;
      const snap = rules ? rules.snapshot() : null;
      if (snap) snapshot.value = snap;
      stadium.update(snap, BRAND.game);
    }
    view.update(loop.alpha, dt);
    view.updateReflections(stage.renderer, stage.scene);
    stage.render();
    quality.frame(now, dt * 1000);

    frames++;
    physicsMsAvg = physicsMsAvg * 0.95 + loop.lastPhysicsMs * 0.05;
    if (perf && now - fpsAt > 500) {
      const fps = (frames * 1000) / (now - fpsAt);
      frames = 0;
      fpsAt = now;
      perf.textContent = `${stage.backend} · ${quality.tier.name} · ${fps.toFixed(0)} fps · physics ${(physicsMsAvg * 1000).toFixed(0)} µs/frame · state ${rules?.state ?? '—'}`;
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

void main();
