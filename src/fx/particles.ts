import * as THREE from 'three/webgpu';

/**
 * Instanced particles (docs/MVP/05 § 9.1): fireworks over the backboard, dirt and grass puffs at
 * the fielders, the home-plate burst, sparks. One instanced mesh per palette (so each glows in its
 * own emissive color through the selective bloom). Positions are in the parent group's local
 * frame (playfield metres, z up from the glass side); the budget scales with the quality tier.
 */

export type Palette = 'gold' | 'red' | 'white' | 'blue' | 'teal' | 'violet' | 'dirt' | 'grass';

const COLORS: Record<Palette, { color: number; glow: number }> = {
  gold: { color: 0xffc94d, glow: 3 },
  red: { color: 0xff4d4d, glow: 3 },
  white: { color: 0xfff6e0, glow: 3 },
  blue: { color: 0x5aa2ff, glow: 3 },
  teal: { color: 0x3fe0cf, glow: 3 },
  violet: { color: 0xb57bff, glow: 3 },
  dirt: { color: 0x9a6a3f, glow: 0 },
  grass: { color: 0x3f8f44, glow: 0 },
};

export interface BurstOptions {
  at: THREE.Vector3Like;
  count: number;
  palette: Palette;
  /** Initial speed range (m/s). */
  speed: [number, number];
  /** Bias direction added to each random direction (e.g. up). */
  bias?: THREE.Vector3Like;
  /** Restrict directions to the hemisphere above the playfield (z ≥ 0). */
  upOnly?: boolean;
  /** Lifetime range (s). */
  life: [number, number];
  /** Particle radius (m). */
  size: number;
  /** Gravity in the local frame (m/s²). */
  gravity?: THREE.Vector3Like;
  /** Velocity damping per second (0 = none). */
  drag?: number;
}

interface P {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  gx: number;
  gy: number;
  gz: number;
  drag: number;
  age: number;
  life: number;
  size: number;
}

interface Pool {
  mesh: THREE.InstancedMesh;
  live: P[];
  capacity: number;
}

export class Particles {
  readonly group = new THREE.Group();
  private readonly pools = new Map<Palette, Pool>();
  private budget = 1;
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly s = new THREE.Vector3();
  private readonly p = new THREE.Vector3();

  constructor(capacity = 400) {
    const geo = new THREE.OctahedronGeometry(1, 0);
    for (const [name, c] of Object.entries(COLORS) as [Palette, (typeof COLORS)[Palette]][]) {
      const mat = new THREE.MeshStandardMaterial({
        color: c.glow > 0 ? 0x000000 : c.color,
        emissive: new THREE.Color(c.color),
        emissiveIntensity: c.glow,
        roughness: 0.9,
      });
      const mesh = new THREE.InstancedMesh(geo, mat, capacity);
      mesh.count = 0;
      mesh.frustumCulled = false;
      this.group.add(mesh);
      this.pools.set(name, { mesh, live: [], capacity });
    }
  }

  /** Fraction of the particle counts to actually spawn (quality tier). */
  setBudget(fraction: number): void {
    this.budget = Math.max(0.1, Math.min(1, fraction));
  }

  burst(o: BurstOptions): void {
    const pool = this.pools.get(o.palette)!;
    const n = Math.round(o.count * this.budget);
    const g = o.gravity ?? { x: 0, y: 0, z: -9.8 };
    for (let i = 0; i < n && pool.live.length < pool.capacity; i++) {
      // A random direction on the sphere.
      let dx = 0;
      let dy = 0;
      let dz = 0;
      let len = 2;
      while (len > 1 || len < 0.01) {
        dx = Math.random() * 2 - 1;
        dy = Math.random() * 2 - 1;
        dz = Math.random() * 2 - 1;
        len = dx * dx + dy * dy + dz * dz;
      }
      len = Math.sqrt(len);
      dx /= len;
      dy /= len;
      dz /= len;
      if (o.upOnly && dz < 0) dz = -dz;
      const sp = o.speed[0] + Math.random() * (o.speed[1] - o.speed[0]);
      pool.live.push({
        x: o.at.x,
        y: o.at.y,
        z: o.at.z,
        vx: dx * sp + (o.bias?.x ?? 0),
        vy: dy * sp + (o.bias?.y ?? 0),
        vz: dz * sp + (o.bias?.z ?? 0),
        gx: g.x,
        gy: g.y,
        gz: g.z,
        drag: o.drag ?? 0,
        age: 0,
        life: o.life[0] + Math.random() * (o.life[1] - o.life[0]),
        size: o.size * (0.7 + Math.random() * 0.6),
      });
    }
  }

  get liveCount(): number {
    let n = 0;
    for (const pool of this.pools.values()) n += pool.live.length;
    return n;
  }

  clear(): void {
    for (const pool of this.pools.values()) {
      pool.live.length = 0;
      pool.mesh.count = 0;
    }
  }

  update(dt: number): void {
    for (const pool of this.pools.values()) {
      const live = pool.live;
      let w = 0;
      for (let i = 0; i < live.length; i++) {
        const p = live[i]!;
        p.age += dt;
        if (p.age >= p.life) continue;
        const damp = Math.max(0, 1 - p.drag * dt);
        p.vx = (p.vx + p.gx * dt) * damp;
        p.vy = (p.vy + p.gy * dt) * damp;
        p.vz = (p.vz + p.gz * dt) * damp;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.z += p.vz * dt;
        live[w++] = p;
      }
      live.length = w;
      for (let i = 0; i < w; i++) {
        const p = live[i]!;
        // Shrink out over the last 40 % of life.
        const k = Math.min(1, (1 - p.age / p.life) / 0.4);
        this.s.setScalar(p.size * k);
        this.p.set(p.x, p.y, p.z);
        this.m.compose(this.p, this.q, this.s);
        pool.mesh.setMatrixAt(i, this.m);
      }
      pool.mesh.count = w;
      if (w > 0) pool.mesh.instanceMatrix.needsUpdate = true;
    }
  }
}
