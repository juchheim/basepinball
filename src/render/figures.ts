import * as THREE from 'three/webgpu';
import { Spring, Timeline } from '../fx/anim';
import type { Particles } from '../fx/particles';
import type { LampDef, TableDef } from '../table/schema';

/**
 * The printed-acrylic figures (docs/MVP/05 § 9): fielders behind their gloves, the pitcher on the
 * mound, the catcher and umpire on the apron, and runners in the glass basepath channels. Each is a
 * flat standee on a spring rig (lean, tilt, stretch, hop) so it can snap, throw, wind up and run
 * like a toy. Visual only: nothing here touches the physics.
 */

const MM = 0.001;

export interface StandeeSpot {
  cell: string;
  x: number;
  y: number;
}

interface Rig {
  mesh: THREE.Mesh;
  /** Side lean (as the player sees it), forward tilt, height stretch, hop. */
  roll: Spring;
  tilt: Spring;
  stretch: Spring;
  hop: Spring;
  /** Overall size (runners shrink away after scoring or when the side is retired). */
  size: number;
  baseZ: number;
  /** Leaned back toward the player's eye, so the art reads from the camera above. */
  lean: number;
}

interface Runner {
  rig: Rig;
  /** Position along the base path: 0 home, 1 first, 2 second, 3 third, 4 home again. */
  at: number;
  /** Bases still to run to, in order. */
  queue: number[];
  scoring: boolean;
  fade: number;
}

const RUN_SPEED = 2.6; // bases per second (~0.4 s a base)

export class Figures {
  readonly group = new THREE.Group();
  private readonly rigs = new Map<string, Rig>();
  private readonly runners: Runner[] = [];
  private readonly spare: Rig[] = [];
  private readonly timeline = new Timeline();
  private readonly basePath: THREE.Vector3[];
  private material: THREE.MeshStandardMaterial | null = null;
  private cells: readonly string[] = [];
  private grid = { cols: 1, rows: 1 };
  private clock = 0;

  constructor(
    table: TableDef,
    private readonly spots: StandeeSpot[],
    private readonly particles: Particles,
  ) {
    const lamp = (id: string): THREE.Vector3 => {
      const l = table.elements.find((e): e is LampDef => e.type === 'lamp' && e.id === id);
      return new THREE.Vector3((l?.x ?? 275) * MM, (l?.y ?? 230) * MM, 0);
    };
    const home = lamp('base.home');
    this.basePath = [home, lamp('base.1B'), lamp('base.2B'), lamp('base.3B'), home];
  }

  /** Build the figures once the standee atlas has loaded. */
  build(
    atlas: THREE.Texture,
    cells: readonly string[],
    grid: { cols: number; rows: number },
  ): void {
    this.cells = cells;
    this.grid = grid;
    this.material = new THREE.MeshStandardMaterial({
      map: atlas,
      alphaTest: 0.5,
      side: THREE.DoubleSide,
      roughness: 0.35,
      transparent: false,
      // A little self-light, as GI under the playfield plastics would give.
      emissiveMap: atlas,
      emissive: new THREE.Color(0xffffff),
      emissiveIntensity: 0.25,
    });
    for (const spot of this.spots) {
      const rig = this.makeRig(spot.cell, 0.062);
      if (!rig) continue;
      rig.mesh.position.set(spot.x * MM, spot.y * MM, 0.001);
      rig.baseZ = 0.001;
      this.rigs.set(spot.cell, rig);
    }
    // Catcher and umpire stand on the apron, below the drain.
    for (const [cell, x] of [
      ['C', 0.245],
      ['UMP', 0.305],
    ] as const) {
      const rig = this.makeRig(cell, 0.05);
      if (!rig) continue;
      rig.mesh.position.set(x, 0.02, 0.031);
      rig.baseZ = 0.031;
      this.rigs.set(cell, rig);
    }
  }

  private makeRig(cell: string, h: number): Rig | null {
    const index = this.cells.indexOf(cell);
    if (index < 0 || !this.material) return null;
    const { cols, rows } = this.grid;
    const col = index % cols;
    const row = Math.floor(index / cols);
    const g = new THREE.PlaneGeometry(h / 2, h);
    const uv = g.getAttribute('uv') as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) {
      uv.setXY(i, (col + uv.getX(i)) / cols, 1 - (row + 1 - uv.getY(i)) / rows);
    }
    // Stand it up, pivoting at its feet.
    g.rotateX(Math.PI / 2);
    g.translate(0, 0, h / 2);
    const mesh = new THREE.Mesh(g, this.material);
    mesh.castShadow = true;
    this.group.add(mesh);
    return {
      mesh,
      roll: new Spring(5, 0.3),
      tilt: new Spring(5, 0.3),
      stretch: new Spring(9, 0.25),
      hop: new Spring(6, 0.5),
      size: 1,
      baseZ: 0,
      lean: -0.3,
    };
  }

  // ---------------------------------------------------------------- fielders, pitcher, battery

  /** A saucer catch: the fielder snaps up with the glove, a puff of dirt or grass. */
  catch(position: string, at: { x: number; y: number }, grass: boolean): void {
    const rig = this.rigs.get(position);
    if (rig) {
      rig.stretch.kick(3.2);
      rig.roll.kick((Math.random() < 0.5 ? -1 : 1) * 4);
    }
    this.particles.burst({
      at: { x: at.x * MM, y: at.y * MM, z: 0.004 },
      count: 18,
      palette: grass ? 'grass' : 'dirt',
      speed: [0.08, 0.25],
      upOnly: true,
      life: [0.3, 0.6],
      size: 0.0022,
      gravity: { x: 0, y: 0, z: -1.2 },
      drag: 2,
    });
  }

  /** The throw back to the mound: an arm whip and a ball streak arcing to the pitcher. */
  throwToMound(position: string, from: { x: number; y: number }, delay = 0.35): void {
    const rig = this.rigs.get(position);
    this.timeline.after(delay, () => {
      if (rig) {
        rig.tilt.target = 0.35;
        this.timeline.after(0.18, () => {
          rig.tilt.target = 0;
          rig.tilt.kick(-9);
        });
      }
      const mound = this.rigs.get('P')?.mesh.position ?? new THREE.Vector3(0.275, 0.33, 0);
      const T = 0.55;
      const g = 1.2;
      const p0 = { x: from.x * MM, y: from.y * MM, z: 0.05 };
      const v = {
        x: (mound.x - p0.x) / T,
        y: (mound.y - p0.y) / T,
        z: (0.04 - p0.z + 0.5 * g * T * T) / T,
      };
      // The ball and a short trail behind it.
      for (let i = 0; i < 4; i++) {
        this.timeline.after(0.18 + i * 0.025, () =>
          this.particles.burst({
            at: p0,
            count: 1,
            palette: 'white',
            speed: [0, 0],
            bias: v,
            life: [T, T],
            size: 0.005 - i * 0.001,
            gravity: { x: 0, y: 0, z: -g },
          }),
        );
      }
    });
  }

  /** Near miss: the fielder leans toward the ball and recovers. */
  dive(position: string, side: number): void {
    const rig = this.rigs.get(position);
    if (!rig) return;
    rig.roll.kick(side * 7);
    rig.hop.kick(0.15);
  }

  /** Pitcher windup over `lead` seconds: rock back and coil, then release on cue. */
  windup(lead: number): void {
    const rig = this.rigs.get('P');
    if (!rig) return;
    rig.tilt.target = 0;
    rig.stretch.target = 0;
    this.timeline.tween(lead * 0.8, (k) => {
      rig.tilt.target = 0.3 * k; // lean back
      rig.stretch.target = -0.12 * k; // coil (leg kick)
      rig.roll.target = 0.12 * Math.sin(k * Math.PI);
    });
  }

  release(): void {
    const rig = this.rigs.get('P');
    if (!rig) return;
    rig.tilt.target = 0;
    rig.stretch.target = 0;
    rig.roll.target = 0;
    rig.tilt.kick(-10); // whip forward, then follow through
    rig.stretch.kick(2.5);
  }

  /** Strike three: the umpire punches out, the catcher's mitt pops. */
  punchOut(): void {
    const ump = this.rigs.get('UMP');
    if (ump) {
      ump.roll.kick(-9);
      ump.hop.kick(0.25);
    }
    const c = this.rigs.get('C');
    if (c) c.stretch.kick(3);
  }

  /** Foul out (or any umpire call). */
  umpireSignal(): void {
    const ump = this.rigs.get('UMP');
    if (ump) ump.roll.kick(7);
  }

  /** A steal: the umpire calls him safe. */
  safeSignal(): void {
    const ump = this.rigs.get('UMP');
    if (ump) ump.stretch.kick(-2.5);
  }

  /** Big moments: every fielder hops. */
  celebrate(): void {
    let i = 0;
    for (const [cell, rig] of this.rigs) {
      if (cell === 'UMP' || cell === 'C' || cell === 'P') continue;
      this.timeline.after(0.05 * i++, () => rig.hop.kick(0.35));
    }
  }

  // ---------------------------------------------------------------- runners

  /** A hit: every runner and the batter advance `n` bases (4 = home run). */
  hit(n: number): void {
    for (const r of this.runners) {
      if (r.scoring || r.queue.length > 0) continue;
      this.runTo(r, Math.min(4, Math.round(r.at) + n));
    }
    const batter = this.newRunner();
    if (batter) this.runTo(batter, Math.min(4, n));
  }

  /** A steal by the runner on base index `from` (0 = first). */
  steal(from: number): void {
    const r = this.runners.find((x) => !x.scoring && Math.round(x.at) === from + 1);
    if (r) this.runTo(r, from + 2);
  }

  /** A walk: the batter trots to first and the forced runners (`moved`: bases they left) go up one. */
  walk(moved: number[]): void {
    for (const from of moved) {
      const r = this.runners.find((x) => !x.scoring && Math.round(x.at) === from + 1);
      if (r) this.runTo(r, from + 2);
    }
    const batter = this.newRunner();
    if (batter) this.runTo(batter, 1);
  }

  /** Inning over: runners jog off. */
  clearBases(): void {
    for (const r of this.runners) {
      r.queue.length = 0;
      r.scoring = true;
      r.fade = 1;
    }
  }

  /** Match the rules' bases when nobody is running (after a rescue, a new game, …). */
  sync(bases: readonly boolean[]): void {
    if (this.runners.some((r) => r.queue.length > 0 || r.scoring)) return;
    const want = [1, 2, 3].filter((_, i) => bases[i]);
    const have = this.runners.map((r) => Math.round(r.at));
    if (want.length === have.length && want.every((b) => have.includes(b))) return;
    for (const r of this.runners) this.recycle(r);
    this.runners.length = 0;
    for (const b of want) {
      const r = this.newRunner();
      if (r) this.place(r, b);
    }
  }

  private newRunner(): Runner | null {
    const rig = this.spare.pop() ?? this.makeRig('RUNNER', 0.05);
    if (!rig) return null;
    rig.lean = -0.55;
    rig.mesh.visible = true;
    rig.size = 1;
    const r: Runner = { rig, at: 0, queue: [], scoring: false, fade: 0 };
    this.place(r, 0);
    this.runners.push(r);
    return r;
  }

  private runTo(r: Runner, target: number): void {
    for (let b = Math.floor(r.at) + 1; b <= target; b++) r.queue.push(b);
    if (target >= 4) r.scoring = true;
  }

  private place(r: Runner, at: number): void {
    r.at = at;
    const p = this.pathPoint(at);
    r.rig.mesh.position.set(p.x, p.y, 0.001);
  }

  private pathPoint(at: number): THREE.Vector3 {
    const i = Math.min(3, Math.floor(at));
    const k = at - i;
    return this.basePath[i]!.clone().lerp(this.basePath[i + 1]!, k);
  }

  private recycle(r: Runner): void {
    r.rig.mesh.visible = false;
    this.spare.push(r.rig);
  }

  /** Called when a runner touches home: the plate burst. */
  onScore: (() => void) | null = null;

  // ---------------------------------------------------------------- frame

  update(dt: number): void {
    this.clock += dt;
    this.timeline.update(dt);
    for (let i = this.runners.length - 1; i >= 0; i--) {
      const r = this.runners[i]!;
      const next = r.queue[0];
      if (next !== undefined) {
        r.at = Math.min(next, r.at + RUN_SPEED * dt);
        if (r.at >= next) {
          r.queue.shift();
          if (next === 4) {
            r.fade = 1;
            this.onScore?.();
            const home = this.basePath[0]!;
            this.particles.burst({
              at: { x: home.x, y: home.y, z: 0.004 },
              count: 26,
              palette: 'gold',
              speed: [0.1, 0.3],
              upOnly: true,
              life: [0.4, 0.8],
              size: 0.0025,
              gravity: { x: 0, y: 0, z: -0.6 },
              drag: 1.5,
            });
          }
        }
        const p = this.pathPoint(r.at);
        // A bobbing run cycle.
        const bob = Math.abs(Math.sin(this.clock * 18)) * 0.004;
        r.rig.mesh.position.set(p.x, p.y, 0.001 + bob);
        r.rig.roll.target = Math.sin(this.clock * 18) * 0.12;
      } else {
        r.rig.roll.target = 0;
        r.rig.mesh.position.z = 0.001;
      }
      if (r.fade > 0 && r.queue.length === 0) {
        r.fade -= dt * 2;
        r.rig.size = Math.max(0.001, r.fade);
        if (r.fade <= 0) {
          this.recycle(r);
          this.runners.splice(i, 1);
        }
      }
    }
    for (const rig of this.rigs.values()) {
      this.pose(rig, dt);
      // Hops lift the figure off its base.
      rig.mesh.position.z = rig.baseZ + Math.max(0, rig.hop.x) * 0.03;
    }
    for (const r of this.runners) this.pose(r.rig, dt);
  }

  private pose(rig: Rig, dt: number): void {
    rig.roll.update(dt);
    rig.tilt.update(dt);
    rig.stretch.update(dt);
    rig.hop.update(dt);
    const m = rig.mesh;
    m.rotation.set(rig.lean + rig.tilt.x, rig.roll.x, 0);
    // Stretch keeps the volume roughly constant: taller is thinner.
    const s = Math.max(0.5, 1 + rig.stretch.x * 0.12);
    m.scale.set(rig.size / Math.sqrt(s), rig.size, rig.size * s);
  }
}
