import * as THREE from 'three/webgpu';
import { FixedLoop } from './app/loop';
import { Rng } from './core/rng';
import { createPanel, loadParams } from './debug/panel';
import { bindInput, type InputEvent } from './input/input';
import { World, type PhysicsEvent } from './physics/world';
import { Stage } from './render/stage';
import { TableView } from './render/tableView';
import { m0TestTable } from './table/m0TestTable';
import { v1Table } from './table/v1Table';

/**
 * M1 whitebox sandbox: the full v1 table (or `?table=m0` for the M0 test table), live tuning
 * panel, timing overlay and simple lamp feedback. No game rules yet (that is M2): drained and
 * caught balls come back as a pitch from the mound.
 */

async function main(): Promise<void> {
  const container = document.getElementById('app')!;
  const query = new URLSearchParams(location.search);
  const stage = new Stage(container, query.has('webgl'));
  try {
    await stage.init();
  } catch (err) {
    container.innerHTML = `<div class="fatal">Could not start the renderer: ${String(err)}</div>`;
    return;
  }

  const params = loadParams();
  const table = query.get('table') === 'm0' ? m0TestTable : v1Table;
  const world = new World(table, params);
  const rng = new Rng(20261010);
  const MM = 0.001;

  const view = new TableView(table, world);
  view.group.rotation.x = -Math.PI / 2 + (params.slopeDeg * Math.PI) / 180;
  stage.scene.add(view.group);
  stage.fit(view.group);

  // ---- sandbox harness (sim-time timers)
  const timers: { at: number; run: () => void }[] = [];
  const after = (seconds: number, run: () => void): void => {
    timers.push({ at: world.time + seconds, run });
  };
  const spawn = (): void => {
    world.balls.length = 0;
    const b = world.addBall(table.spawn.x * MM, table.spawn.y * MM);
    b.vx = rng.range(-0.8, 0.8);
  };
  const serve = (): void => {
    world.releaseSaucers();
    if (!world.serveBall()) spawn();
  };
  const pitch = (): void => {
    world.releaseSaucers();
    if (!table.pitchSpot) return spawn();
    // M1 stand-in for the pitching director (M2): alternate flippers, vary the speed.
    const left = rng.next() < 0.5;
    const ball = world.pitchBall((left ? 216 : 334) * MM, 190 * MM, rng.range(0.9, 1.3));
    if (ball) view.flash('pitch.FB');
  };
  serve();

  // Lamp feedback (a stand-in for M2's rules and M4's light shows).
  const lit = new Set<string>();
  const light = (id: string, on = true): void => {
    view.setLamp(id, on);
    if (on) lit.add(id);
    else lit.delete(id);
  };
  const allLit = (ids: string[]): boolean => ids.every((id) => lit.has(id));
  light('lamp.kickback');

  const log: string[] = [];
  const onEvent = (e: PhysicsEvent): void => {
    switch (e.type) {
      case 'pop':
        view.flash(e.id);
        view.flash('arrow.gap');
        break;
      case 'sling':
      case 'standup':
      case 'kicker':
        view.flash(e.id);
        if (e.id === 'kicker.3B.L') view.flash('arrow.orbit.L');
        if (e.id === 'kicker.3B.R') view.flash('arrow.orbit.R');
        break;
      case 'drain':
        after(1, pitch);
        break;
      case 'saucer':
        after(1.2, pitch);
        break;
      case 'kickback':
        light('lamp.kickback', false);
        break;
      case 'sensor':
        if (e.id === 'gate.HR') view.flash('arrow.ramp.HR');
        if (e.id === 'gate.STEAL') view.flash('arrow.ramp.STEAL');
        if (e.id.startsWith('lane.')) light(`lamp.${e.id}`);
        break;
    }
    if (e.type === 'drop') light(`lamp.${e.id}`);
    if (e.type === 'standup') light(`lamp.${e.id}`);
    const lanes = ['lamp.lane.R', 'lamp.lane.B', 'lamp.lane.I'];
    if (allLit(lanes)) {
      lanes.forEach((id) => light(id, false));
      lanes.forEach((id) => view.flash(id));
      light('lamp.kickback');
      world.setKickbackArmed('kickback.L', true);
    }
    const drops = ['lamp.drop.B', 'lamp.drop.A', 'lamp.drop.T'];
    if (allLit(drops)) {
      drops.forEach((id) => light(id, false));
      light('lamp.hotbat');
      after(2, () => world.resetDropTargets());
    }
    const standups = ['lamp.standup.R', 'lamp.standup.U', 'lamp.standup.N'];
    if (allLit(standups)) {
      standups.forEach((id) => light(id, false));
      light('lamp.steal');
    }
    if (e.type === 'tiltBob') log.unshift(`${e.time.toFixed(2)}s TILT WARNING`);
    else if (e.type !== 'eos' && e.type !== 'swing')
      log.unshift(`${e.time.toFixed(2)}s ${e.type} ${e.id}`);
    log.length = Math.min(log.length, 6);
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
    spawn: serve,
    pitch,
    resetTargets: () => world.resetDropTargets(),
    curveball: () => {
      world.setMagnet('magnet.curve', 1);
      after(0.6, () => world.setMagnet('magnet.curve', 0));
    },
    state,
    onStateChange: syncState,
  });

  // ---- input
  const onInput = (e: InputEvent): void => {
    const at = (apply: (w: World) => void): void => loop.push({ time: e.time, apply });
    switch (e.action) {
      case 'flipperL':
      case 'flipperR': {
        const id = e.action === 'flipperL' ? 'flipper.L' : 'flipper.R';
        at((w) => w.setFlipper(id, e.pressed));
        return;
      }
      case 'plunger':
        at((w) => w.setPlunger(e.pressed));
        return;
      case 'nudgeL':
        if (e.pressed) at((w) => w.nudge(-1, 0));
        return;
      case 'nudgeR':
        if (e.pressed) at((w) => w.nudge(1, 0));
        return;
      case 'nudgeUp':
        if (e.pressed) at((w) => w.nudge(0, 1));
        return;
      case 'serve':
        if (e.pressed) at(serve);
        break;
      case 'pitch':
        if (e.pressed) at(pitch);
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
    syncState();
    pane.refresh();
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
  let dragStart: THREE.Vector3 | null = null;
  const canvas = stage.renderer.domElement;
  canvas.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'touch') return;
    const p = pickPlayfield(e);
    if (!p) return;
    dragStart = p;
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointerup', (e) => {
    if (!dragStart) return;
    const start = dragStart;
    dragStart = null;
    const end = pickPlayfield(e) ?? start;
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const k = 25; // 10 cm drag -> 2.5 m/s
    const speed = Math.min(8, Math.hypot(dx, dy) * k);
    const len = Math.hypot(dx, dy) || 1;
    loop.push({
      time: e.timeStamp,
      apply: (w) => {
        w.releaseSaucers();
        w.balls.length = 0;
        const b = w.addBall(start.x, start.y);
        b.vx = (dx / len) * speed;
        b.vy = (dy / len) * speed;
      },
    });
  });

  // ---- resync the clock when the tab comes back
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
    'Flippers <b>Shift</b> / <b>← →</b> · plunger hold <b>↓</b> or <b>Enter</b> · nudge <b>Z</b> <b>/</b> <b>Space</b><br>' +
    '<b>B</b> new ball · <b>K</b> pitch · <b>click-drag</b> throw · <b>R</b> reset targets · <b>C</b> colliders · <b>P</b> pause · <b>[ ]</b> slow-mo<br>' +
    'Touch: left/right half flips · lower-right corner is the plunger';
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
        (world.plunger && world.plunger.pull > 0
          ? ` · plunger ${(world.plunger.pull * 100).toFixed(0)}%`
          : '') +
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
