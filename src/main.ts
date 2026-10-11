import * as THREE from 'three/webgpu';
import { FixedLoop } from './app/loop';
import { Rng } from './core/rng';
import { createPanel, loadParams } from './debug/panel';
import { bindInput, type InputEvent } from './input/input';
import { World, type PhysicsEvent } from './physics/world';
import { Stage } from './render/stage';
import { TableView } from './render/tableView';
import { m0TestTable } from './table/m0TestTable';

/**
 * M0 physics sandbox: the test table, live tuning panel, and timing overlay.
 * Desktop: Shift/arrows flip, Space = new ball, click-drag on the table to throw a ball.
 * Touch: left/right half of the screen flips.
 */

async function main(): Promise<void> {
  const container = document.getElementById('app')!;
  const forceWebGL = new URLSearchParams(location.search).has('webgl');
  const stage = new Stage(container, forceWebGL);
  try {
    await stage.init();
  } catch (err) {
    container.innerHTML = `<div class="fatal">Could not start the renderer: ${String(err)}</div>`;
    return;
  }

  const params = loadParams();
  const table = m0TestTable;
  const world = new World(table, params);
  const rng = new Rng(20261010);
  const MM = 0.001;

  const view = new TableView(table, world);
  view.group.rotation.x = -Math.PI / 2 + (params.slopeDeg * Math.PI) / 180;
  stage.scene.add(view.group);
  stage.fit(view.group);

  // ---- sandbox harness: respawn, saucer eject, drop reset (sim-time timers)
  const timers: { at: number; run: () => void }[] = [];
  const after = (seconds: number, run: () => void): void => {
    timers.push({ at: world.time + seconds, run });
  };
  const spawn = (): void => {
    world.balls.length = 0;
    const b = world.addBall(table.spawn.x * MM, table.spawn.y * MM);
    b.vx = rng.range(-0.8, 0.8);
  };
  spawn();

  const log: string[] = [];
  const onEvent = (e: PhysicsEvent): void => {
    if (e.type === 'pop' || e.type === 'sling') view.flash(e.id);
    if (e.type === 'drain') after(0.8, spawn);
    if (e.type === 'saucer') {
      after(1.0, () => {
        const b = world.balls[0];
        if (b) world.ejectFromSaucer(b, e.id, 1.1, -95);
      });
    }
    if (e.type === 'drop') after(2.5, () => world.resetDropTargets());
    if (e.type !== 'eos') {
      log.unshift(`${e.time.toFixed(2)}s ${e.type} ${e.id}`);
      log.length = Math.min(log.length, 6);
    }
  };

  const loop = new FixedLoop(
    () => world,
    () => {
      for (const e of world.events) onEvent(e);
      world.events.length = 0;
      for (let i = timers.length - 1; i >= 0; i--) {
        if (world.time >= timers[i]!.at) timers.splice(i, 1)[0]!.run();
      }
    },
  );

  // ---- debug panel
  const state = { timeScale: 1, colliders: false, bloom: true, paused: false };
  const syncState = (): void => {
    loop.timeScale = state.timeScale;
    loop.paused = state.paused;
    view.showColliders = state.colliders;
    if (stage.bloomEnabled !== state.bloom) stage.setBloom(state.bloom);
  };
  const pane = createPanel(params, {
    onParamsChange: () => {
      world.applyParams();
      view.group.rotation.x = -Math.PI / 2 + (params.slopeDeg * Math.PI) / 180;
    },
    spawn,
    resetTargets: () => world.resetDropTargets(),
    state,
    onStateChange: syncState,
  });

  // ---- input
  const onInput = (e: InputEvent): void => {
    switch (e.action) {
      case 'flipperL':
      case 'flipperR': {
        const id = e.action === 'flipperL' ? 'flipper.L' : 'flipper.R';
        loop.push({ time: e.time, apply: (w) => w.setFlipper(id, e.pressed) });
        break;
      }
      case 'spawn':
        if (e.pressed) loop.push({ time: e.time, apply: spawn });
        break;
      case 'resetTargets':
        if (e.pressed) world.resetDropTargets();
        break;
      case 'toggleColliders':
        if (e.pressed) state.colliders = !state.colliders;
        break;
      case 'pause':
        if (e.pressed) state.paused = !state.paused;
        break;
      case 'slower':
        if (e.pressed) state.timeScale = Math.max(0.05, +(state.timeScale / 2).toFixed(3));
        break;
      case 'faster':
        if (e.pressed) state.timeScale = Math.min(1, state.timeScale * 2);
        break;
    }
    if (!e.action.startsWith('flipper')) {
      syncState();
      pane.refresh();
    }
  };
  bindInput(stage.renderer.domElement, onInput);

  // Mouse: click to place a ball, drag to throw it.
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const pickPlayfield = (e: PointerEvent): THREE.Vector3 | null => {
    ndc.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
    raycaster.setFromCamera(ndc, stage.camera);
    const hit = raycaster.intersectObject(view.floor, false)[0];
    return hit ? view.group.worldToLocal(hit.point.clone()) : null;
  };
  let dragStart: { p: THREE.Vector3; t: number } | null = null;
  const canvas = stage.renderer.domElement;
  canvas.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'touch') return;
    const p = pickPlayfield(e);
    if (!p) return;
    dragStart = { p, t: e.timeStamp };
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointerup', (e) => {
    if (!dragStart) return;
    const start = dragStart;
    dragStart = null;
    const end = pickPlayfield(e) ?? start.p;
    const dx = end.x - start.p.x;
    const dy = end.y - start.p.y;
    const k = 25; // 10 cm drag -> 2.5 m/s
    const speed = Math.min(8, Math.hypot(dx, dy) * k);
    const len = Math.hypot(dx, dy) || 1;
    loop.push({
      time: e.timeStamp,
      apply: (w) => {
        w.balls.length = 0;
        const b = w.addBall(start.p.x, start.p.y);
        b.vx = (dx / len) * speed;
        b.vy = (dy / len) * speed;
      },
    });
  });

  // ---- pause on hide, resync on return
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) loop.resync();
  });

  if (import.meta.env.DEV) {
    // Handles for debugging from the browser console.
    (window as unknown as Record<string, unknown>).__bp = { stage, view, world, loop, params };
  }

  // ---- HUD
  const hud = document.createElement('div');
  hud.className = 'hud';
  document.body.appendChild(hud);
  const help = document.createElement('div');
  help.className = 'help';
  help.innerHTML =
    'Flippers: <b>Shift</b> / <b>←→</b> / <b>A L</b> · touch left/right half<br>' +
    '<b>Space</b> new ball · <b>click-drag</b> throw ball · <b>R</b> reset drop · <b>C</b> colliders · <b>P</b> pause · <b>[ ]</b> slow-mo';
  document.body.appendChild(help);

  let frames = 0;
  let fpsAt = performance.now();
  let fps = 0;
  let physicsMsAvg = 0;
  let last = performance.now();
  const tick = (now: number): void => {
    loop.frame(now);
    const dtSec = Math.min(0.1, (now - last) / 1000);
    last = now;
    view.update(loop.alpha, dtSec);
    stage.render();

    frames++;
    physicsMsAvg = physicsMsAvg * 0.95 + loop.lastPhysicsMs * 0.05;
    if (now - fpsAt > 500) {
      fps = (frames * 1000) / (now - fpsAt);
      frames = 0;
      fpsAt = now;
      const b = world.balls[0];
      hud.textContent =
        `${stage.backend} · ${fps.toFixed(0)} fps · physics ${(physicsMsAvg * 1000).toFixed(0)} µs/frame · ` +
        `${loop.lastSteps} steps × ${world.lastSubsteps} sub` +
        (b && b.active ? ` · ball ${b.speed().toFixed(2)} m/s` : '') +
        (state.timeScale < 1 ? ` · ${state.timeScale}× time` : '') +
        (state.paused ? ' · PAUSED' : '') +
        '\n' +
        log.join('\n');
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

void main();
