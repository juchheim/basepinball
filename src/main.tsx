import { render } from 'preact';
import * as THREE from 'three/webgpu';
import { FixedLoop } from './app/loop';
import { createPanel, loadParams } from './debug/panel';
import { bindInput, type InputEvent } from './input/input';
import { World, type PhysicsEvent } from './physics/world';
import { GameRules } from './rules/game';
import type { RulesEvent } from './rules/types';
import { WorldMachine } from './rules/worldMachine';
import { Stage } from './render/stage';
import { TableView } from './render/tableView';
import { addHighScore, loadHighScores, qualifies } from './storage/highscores';
import { m0TestTable } from './table/m0TestTable';
import { v1Table } from './table/v1Table';
import { App } from './ui/App';
import {
  calloutFor,
  finalStats,
  highScores,
  lastRank,
  qualified,
  screen,
  snapshot,
} from './ui/store';

/**
 * BasePinball (M2): the v1 whitebox table with the baseball rules, HUD and game flow.
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
  view.group.rotation.x = -Math.PI / 2 + (params.slopeDeg * Math.PI) / 180;
  stage.scene.add(view.group);
  stage.fit(view.group);

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

  // ---- presentation of physics and rules events
  const flashFor = (e: PhysicsEvent): void => {
    if (e.type === 'pop' || e.type === 'sling' || e.type === 'kicker' || e.type === 'standup')
      view.flash(e.id);
    if (e.type === 'pop') view.flash('arrow.gap');
    if (e.type === 'sensor' && e.id === 'gate.HR') view.flash('arrow.ramp.HR');
    if (e.type === 'sensor' && e.id === 'gate.STEAL') view.flash('arrow.ramp.STEAL');
    if (e.type === 'kicker') view.flash(e.id.endsWith('.L') ? 'arrow.orbit.L' : 'arrow.orbit.R');
  };
  const presentRules = (e: RulesEvent): void => {
    calloutFor(e);
    if (e.type === 'runs') view.flash('base.home');
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
      for (const e of world.events) {
        flashFor(e);
        rules?.onSwitch(e);
        if (freePlay && e.type === 'drain') after(1, idleBall);
      }
      world.events.length = 0;
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

  // ---- game flow
  const start = (): void => {
    world.reset();
    timers.length = 0;
    rules = new GameRules(machine, { seed: (Date.now() & 0x7fffffff) >>> 0 });
    rules.start(world.time);
    lastRank.value = -1;
    screen.value = 'playing';
    loop.paused = false;
    loop.resync();
  };
  const toTitle = (): void => {
    rules = null;
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
      } else {
        highScores.value = loadHighScores();
      }
      rules = null;
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
        } else if (s === 'paused') actions.resume();
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
  });

  // ---- debug tools
  let perf: HTMLDivElement | null = null;
  if (debug) {
    const state = { timeScale: 1, colliders: false, bloom: true, paused: false };
    createPanel(params, {
      onParamsChange: () => {
        world.applyParams();
        view.group.rotation.x = -Math.PI / 2 + (params.slopeDeg * Math.PI) / 180;
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
      world,
      loop,
      params,
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
    if (rules) {
      for (const [id, mode] of Object.entries(rules.lamps())) view.setLamp(id, mode);
      // The HUD only needs ~10 updates a second.
      if (now - lastHud > 100) {
        lastHud = now;
        snapshot.value = rules.snapshot();
      }
    }
    view.update(loop.alpha, dt);
    stage.render();

    frames++;
    physicsMsAvg = physicsMsAvg * 0.95 + loop.lastPhysicsMs * 0.05;
    if (perf && now - fpsAt > 500) {
      const fps = (frames * 1000) / (now - fpsAt);
      frames = 0;
      fpsAt = now;
      perf.textContent = `${stage.backend} · ${fps.toFixed(0)} fps · physics ${(physicsMsAvg * 1000).toFixed(0)} µs/frame · state ${rules?.state ?? '—'}`;
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

void main();
