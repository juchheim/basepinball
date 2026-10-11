import { beforeAll, describe, expect, it } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import { dcos, dsin, DEG } from '../../src/core/dmath';
import { defaultParams } from '../../src/physics/params';
import { World } from '../../src/physics/world';
import { m0TestTable } from '../../src/table/m0TestTable';
import { flipper as getFlipper, makeWorld, pointAbove, runFor } from '../physics/helpers';

/**
 * M0 reference benchmark (docs/MVP/03-physics.md § 1): the same flipper scenarios in Rapier, a
 * general-purpose engine, with the flipper as a kinematic body (the usual approach there).
 * Run with `npm run bench:rapier`. Prints a comparison table; asserts only that it ran.
 */

const RUN = !!process.env.RAPIER_BENCH;
const R = 0.0135;
const STEEL_DENSITY = 0.08 / ((4 / 3) * Math.PI * R ** 3);

/** Our flipper's unloaded angle profile (rad per 1 ms step), reused to drive Rapier's flipper. */
function strokeProfile(): number[] {
  const w = new World({ ...m0TestTable }, defaultParams());
  const f = getFlipper(w, 'flipper.L');
  w.setFlipper('flipper.L', true);
  const out: number[] = [];
  for (let i = 0; i < 200; i++) {
    w.step();
    out.push(f.theta);
  }
  return out;
}

function flipperHull(f: {
  length: number;
  baseRadius: number;
  tipRadius: number;
  height: number;
}): Float32Array {
  const pts: number[] = [];
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    for (const z of [0, f.height]) {
      pts.push(f.baseRadius * Math.cos(a), f.baseRadius * Math.sin(a), z);
      pts.push(f.length + f.tipRadius * Math.cos(a), f.tipRadius * Math.sin(a), z);
    }
  }
  return new Float32Array(pts);
}

function quatZ(theta: number): RAPIER.Rotation {
  return { x: 0, y: 0, z: Math.sin(theta / 2), w: Math.cos(theta / 2) };
}

function makeRapier() {
  const p = defaultParams();
  const slope = p.slopeDeg * DEG;
  const world = new RAPIER.World({
    x: 0,
    y: -p.gravity * dsin(slope),
    z: -p.gravity * dcos(slope),
  });
  world.timestep = 1 / p.rate;
  world.createCollider(
    RAPIER.ColliderDesc.cuboid(1, 1, 0.01)
      .setTranslation(0.3, 0.4, -0.01)
      .setFriction(0.15)
      .setRestitution(0.25),
  );
  const ours = makeWorld();
  const f = getFlipper(ours, 'flipper.L');
  const body = world.createRigidBody(
    RAPIER.RigidBodyDesc.kinematicPositionBased()
      .setTranslation(f.px, f.py, 0)
      .setRotation(quatZ(f.restAngle)),
  );
  world.createCollider(
    RAPIER.ColliderDesc.convexHull(flipperHull(f))!.setRestitution(0.45).setFriction(0.4),
    body,
  );
  // Inlane divider (the wall a cradled ball rests against), as in the M0 table.
  const wall = (ax: number, ay: number, bx: number, by: number) => {
    const dx = (bx - ax) / 1000;
    const dy = (by - ay) / 1000;
    const len = Math.hypot(dx, dy);
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(len / 2, 0.0015, 0.0125)
        .setTranslation((ax + bx) / 2000, (ay + by) / 2000, 0.0125)
        .setRotation(quatZ(Math.atan2(dy, dx)))
        .setRestitution(0.5)
        .setFriction(0.1),
    );
  };
  wall(40, 340, 40, 230);
  wall(40, 230, 165, 150);
  const addBall = (x: number, y: number) => {
    const b = world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic().setTranslation(x, y, R).setCcdEnabled(true),
    );
    world.createCollider(
      RAPIER.ColliderDesc.ball(R).setDensity(STEEL_DENSITY).setRestitution(0.25).setFriction(0.15),
      b,
    );
    return b;
  };
  return { world, body, f, addBall };
}

describe.skipIf(!RUN)('Rapier reference', () => {
  beforeAll(async () => {
    await RAPIER.init();
  });

  it('compares flipper shots, cradle, tunneling and cost', () => {
    const profile = strokeProfile();
    const rows: string[] = [];

    // 1. Shots from rest at fractions along the bat.
    for (const s of [0.3, 0.6, 0.85]) {
      const r = makeRapier();
      const pt = pointAbove(r.f, s, R);
      const ball = r.addBall(pt.x, pt.y);
      let best = 0;
      let angle = 0;
      for (let i = 0; i < 80; i++) {
        r.body.setNextKinematicRotation(quatZ(profile[Math.min(i, profile.length - 1)]!));
        r.world.step();
        const v = ball.linvel();
        const sp = Math.hypot(v.x, v.y);
        if (sp > best) {
          best = sp;
          angle = (Math.atan2(v.y, v.x) * 180) / Math.PI;
        }
      }
      const ours = makeWorld();
      const of = getFlipper(ours, 'flipper.L');
      const op = pointAbove(of, s, R);
      const ob = ours.addBall(op.x, op.y);
      ours.setFlipper('flipper.L', true);
      let obest = 0;
      let oangle = 0;
      runFor(ours, 0.08, () => {
        const sp = Math.hypot(ob.vx, ob.vy);
        if (sp > obest) {
          obest = sp;
          oangle = (Math.atan2(ob.vy, ob.vx) * 180) / Math.PI;
        }
      });
      rows.push(
        `shot s=${s}: rapier ${best.toFixed(2)} m/s @ ${angle.toFixed(0)}° | ours ${obest.toFixed(2)} m/s @ ${oangle.toFixed(0)}°`,
      );
    }

    // 2. Cradle drift on the held (kinematic, raised) bat over 10 s.
    {
      const r = makeRapier();
      const up = profile[profile.length - 1]!;
      r.body.setRotation(quatZ(up), true);
      r.body.setNextKinematicRotation(quatZ(up));
      const pt = pointAbove({ ...r.f, theta: up } as typeof r.f, 0.7, R);
      const ball = r.addBall(pt.x, pt.y + 0.01);
      for (let i = 0; i < 2000; i++) r.world.step();
      const p0 = ball.translation();
      let drift = 0;
      for (let i = 0; i < 10000; i++) {
        r.world.step();
        const p = ball.translation();
        drift = Math.max(drift, Math.hypot(p.x - p0.x, p.y - p0.y));
      }
      rows.push(
        `cradle drift over 10 s: rapier ${(drift * 1000).toFixed(3)} mm (ours < 0.5 mm, see flipper.test.ts)`,
      );
    }

    // 3. Tunneling: 20 m/s into a 3 mm static wall, CCD on.
    {
      let passed = 0;
      for (const angle of [30, 60, 90, 120, 150]) {
        const r = makeRapier();
        r.world.createCollider(
          RAPIER.ColliderDesc.cuboid(0.3, 0.0015, 0.0125).setTranslation(0.3, 0.6, 0.0125),
        );
        const ball = r.addBall(0.3, 0.5);
        ball.setLinvel(
          { x: 20 * Math.cos(angle * DEG), y: 20 * Math.sin(angle * DEG), z: 0 },
          true,
        );
        for (let i = 0; i < 100; i++) r.world.step();
        if (ball.translation().y > 0.6) passed++;
      }
      rows.push(
        `tunneling at 20 m/s through a 3 mm wall: rapier ${passed}/5 passed through (ours 0, see tunneling.test.ts)`,
      );
    }

    // 4. Cost per step with a ball rolling on the flipper scene.
    {
      const r = makeRapier();
      const ball = r.addBall(0.25, 0.4);
      ball.setLinvel({ x: 1, y: -1, z: 0 }, true);
      for (let i = 0; i < 2000; i++) r.world.step();
      const t0 = performance.now();
      for (let i = 0; i < 20000; i++) {
        r.body.setNextKinematicRotation(quatZ(profile[i % profile.length]!));
        r.world.step();
      }
      const rapierUs = ((performance.now() - t0) * 1000) / 20000;
      rows.push(
        `cost: rapier ${rapierUs.toFixed(2)} µs/step on a 2-collider scene (ours ~2 µs/step on the full test table, see perf.test.ts)`,
      );
    }

    console.log('\n' + rows.join('\n'));
    expect(rows.length).toBe(6);
  });
});
