import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { ElementDef, TableDef, Vec2, Vec3 } from '../table/schema';
import { rampEdges, wireformRails, type World } from '../physics/world';
import type { Flipper } from '../physics/flipper';

/**
 * Whitebox meshes built from the table definition (M1: grey materials, coloured lamp discs,
 * no art). Everything lives in a group whose local frame is playfield metres (z up); the group
 * is tilted by the slope. Static parts are merged per material to keep draw calls low.
 */

const MM = 0.001;

const mats = {
  // The printed playfield under a clear coat (art texture applied once it loads).
  floor: new THREE.MeshPhysicalMaterial({
    color: 0x3d5a45,
    roughness: 0.55,
    metalness: 0,
    clearcoat: 1,
    clearcoatRoughness: 0.06,
  }),
  wood: new THREE.MeshStandardMaterial({ color: 0x8a6a4a, roughness: 0.6 }),
  metal: new THREE.MeshStandardMaterial({ color: 0xc9ced6, roughness: 0.25, metalness: 0.9 }),
  rubber: new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.7 }),
  rubberWhite: new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.6 }),
  plastic: new THREE.MeshStandardMaterial({
    color: 0xe9e2cf,
    roughness: 0.3,
    transparent: true,
    opacity: 0.85,
  }),
  ramp: new THREE.MeshStandardMaterial({
    color: 0xcfe3ff,
    roughness: 0.15,
    metalness: 0,
    transparent: true,
    opacity: 0.45,
    side: THREE.DoubleSide,
    depthWrite: false,
  }),
  wire: new THREE.MeshStandardMaterial({ color: 0xdfe4ea, roughness: 0.15, metalness: 1 }),
  flipper: new THREE.MeshStandardMaterial({ color: 0xf4efe1, roughness: 0.35 }),
  flipperRubber: new THREE.MeshStandardMaterial({ color: 0xc8282a, roughness: 0.6 }),
  saucer: new THREE.MeshStandardMaterial({ color: 0x050505, roughness: 0.9 }),
  mound: new THREE.MeshStandardMaterial({ color: 0xb4683c, roughness: 0.9 }),
  popBody: new THREE.MeshStandardMaterial({ color: 0xdddddd, roughness: 0.3, metalness: 0.6 }),
  sensor: new THREE.MeshStandardMaterial({ color: 0x9aa6c4, roughness: 0.4, metalness: 0.8 }),
  ball: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.05, metalness: 1 }),
};

function materialFor(name: string): THREE.Material {
  if (name === 'wood') return mats.wood;
  if (name.startsWith('rubber')) return mats.rubber;
  return mats.metal;
}

export type LampMode = 'off' | 'on' | 'blink';

/** An emissive material that can flash (pop caps, sling rubbers, targets, lamps). */
interface Light {
  material: THREE.MeshStandardMaterial;
  base: number;
  level: number;
  /** Steady state (lamps); 'blink' flashes at 2.5 Hz (under the 3 Hz photosensitivity cap). */
  mode: LampMode;
}

function glowMaterial(color: number, base = 0): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({
    color,
    roughness: 0.35,
    emissive: new THREE.Color(color),
    emissiveIntensity: base,
  });
  return m;
}

export class TableView {
  readonly group = new THREE.Group();
  readonly floor: THREE.Mesh;
  private readonly flipperMeshes = new Map<Flipper, THREE.Object3D>();
  private readonly dropMeshes = new Map<string, THREE.Object3D>();
  private readonly spinnerMeshes = new Map<string, THREE.Object3D>();
  private plungerRod: THREE.Object3D | null = null;
  private readonly lights = new Map<string, Light[]>();
  private readonly ballMeshes: THREE.Mesh[] = [];
  private readonly colliderLines: THREE.LineSegments;
  /** Where standees go (filled while building, placed when the art loads). */
  private readonly standeeSpots: { cell: string; x: number; y: number }[] = [];
  private ballEnv: {
    camera: THREE.CubeCamera;
    target: THREE.CubeRenderTarget;
    every: number;
    frame: number;
  } | null = null;
  /** Static geometry waiting to be merged, per material. */
  private readonly pending = new Map<THREE.Material, THREE.BufferGeometry[]>();

  constructor(
    table: TableDef,
    private readonly world: World,
  ) {
    const w = table.width * MM;
    const l = table.length * MM;
    this.floor = new THREE.Mesh(new THREE.PlaneGeometry(w, l), mats.floor);
    this.floor.position.set(w / 2, l / 2, 0);
    this.floor.receiveShadow = true;
    this.group.add(this.floor);

    for (const el of table.elements) this.addElement(el);
    for (const f of world.flippers) this.addFlipper(f);
    this.flushStatic();

    this.colliderLines = this.buildColliderLines();
    this.colliderLines.visible = false;
    this.group.add(this.colliderLines);
  }

  set showColliders(v: boolean) {
    this.colliderLines.visible = v;
  }

  get showColliders(): boolean {
    return this.colliderLines.visible;
  }

  /** Apply the printed playfield art. */
  setPlayfieldTexture(tex: THREE.Texture): void {
    const old = mats.floor.map;
    mats.floor.map = tex;
    mats.floor.color.set(0xffffff);
    mats.floor.needsUpdate = true;
    old?.dispose();
  }

  /**
   * Printed-acrylic player standees (docs/MVP/05 § 5.3): an alpha-cut figure from the standee atlas
   * on a thin clear plate, standing behind each fielder's glove and on the mound.
   */
  addStandees(
    atlas: THREE.Texture,
    cells: readonly string[],
    grid: { cols: number; rows: number },
  ): void {
    const mat = new THREE.MeshStandardMaterial({
      map: atlas,
      alphaTest: 0.5,
      side: THREE.DoubleSide,
      roughness: 0.35,
      // A little self-light, as GI under the playfield plastics would give.
      emissiveMap: atlas,
      emissive: new THREE.Color(0xffffff),
      emissiveIntensity: 0.25,
    });
    for (const spot of this.standeeSpots) {
      const index = cells.indexOf(spot.cell);
      if (index < 0) continue;
      const col = index % grid.cols;
      const row = Math.floor(index / grid.cols);
      const h = 0.062;
      const g = new THREE.PlaneGeometry(h / 2, h);
      const uv = g.getAttribute('uv') as THREE.BufferAttribute;
      for (let i = 0; i < uv.count; i++) {
        uv.setXY(i, (col + uv.getX(i)) / grid.cols, 1 - (row + 1 - uv.getY(i)) / grid.rows);
      }
      g.rotateX(Math.PI / 2);
      const m = new THREE.Mesh(g, mat);
      m.position.set(spot.x * MM, spot.y * MM, h / 2 + 0.001);
      m.castShadow = true;
      this.group.add(m);
    }
  }

  /**
   * Dynamic ball reflections (docs/MVP/05 § 4): a cube camera follows the ball and renders the
   * table around it, so the chrome ball mirrors lamps, rails and flippers. Size 0 uses the static
   * scene environment instead.
   */
  setReflections(size: number, every: number): void {
    if (this.ballEnv) {
      this.ballEnv.target.dispose();
      this.ballEnv = null;
    }
    mats.ball.envMap = null;
    if (size > 0) {
      const target = new THREE.CubeRenderTarget(size);
      const camera = new THREE.CubeCamera(0.005, 5, target);
      this.ballEnv = { camera, target, every: Math.max(1, every), frame: 0 };
      mats.ball.envMap = target.texture;
    }
    mats.ball.needsUpdate = true;
  }

  updateReflections(renderer: THREE.WebGPURenderer, scene: THREE.Scene): void {
    const env = this.ballEnv;
    const ball = this.ballMeshes[0];
    if (!env || !ball || !ball.visible) return;
    if (env.frame++ % env.every !== 0) return;
    ball.getWorldPosition(env.camera.position);
    ball.visible = false;
    env.camera.update(renderer, scene);
    ball.visible = true;
  }

  /** Brighten a device or lamp briefly. */
  flash(id: string): void {
    for (const l of this.lights.get(id) ?? []) l.level = 1;
  }

  /** Steady state for a lamp. */
  setLamp(id: string, mode: LampMode | boolean): void {
    const m: LampMode = mode === true ? 'on' : mode === false ? 'off' : mode;
    for (const l of this.lights.get(id) ?? []) l.mode = m;
  }

  private blinkClock = 0;

  update(alpha: number, dtSeconds: number): void {
    for (const [f, mesh] of this.flipperMeshes) {
      mesh.rotation.z = f.prevTheta + (f.theta - f.prevTheta) * alpha;
    }
    for (const [id, mesh] of this.dropMeshes) {
      const target = this.world.isDropDown(id) ? -0.028 : 0;
      mesh.position.z += (target - mesh.position.z) * Math.min(1, dtSeconds * 40);
    }
    for (const [id, mesh] of this.spinnerMeshes) {
      const s = this.world.spinners.get(id);
      if (s) mesh.rotation.x = s.angle;
    }
    const pl = this.world.plunger;
    if (this.plungerRod && pl) this.plungerRod.position.y = -pl.pull * 0.05;
    this.blinkClock += dtSeconds;
    const blinkOn = this.blinkClock * 2.5 - Math.floor(this.blinkClock * 2.5) < 0.5;
    for (const list of this.lights.values()) {
      for (const l of list) {
        const lit = l.mode === 'on' || (l.mode === 'blink' && blinkOn);
        l.material.emissiveIntensity = l.base + (lit ? 1.6 : 0) + l.level * 4;
        l.level = Math.max(0, l.level - dtSeconds * 6);
      }
    }

    // Balls: create meshes on demand, interpolate between physics states.
    const balls = this.world.balls;
    while (this.ballMeshes.length < balls.length) {
      const r = this.world.params.ballRadius;
      const m = new THREE.Mesh(new THREE.SphereGeometry(r, 48, 32), mats.ball);
      m.castShadow = true;
      this.ballMeshes.push(m);
      this.group.add(m);
    }
    const qa = new THREE.Quaternion();
    const qb = new THREE.Quaternion();
    this.ballMeshes.forEach((m, i) => {
      const b = balls[i];
      m.visible = !!b && b.active;
      if (!b || !b.active) return;
      m.position.set(
        b.prevPx + (b.px - b.prevPx) * alpha,
        b.prevPy + (b.py - b.prevPy) * alpha,
        b.prevPz + (b.pz - b.prevPz) * alpha,
      );
      qa.set(b.prevQx, b.prevQy, b.prevQz, b.prevQw);
      qb.set(b.qx, b.qy, b.qz, b.qw);
      m.quaternion.slerpQuaternions(qa, qb, alpha);
    });
  }

  // ---------------------------------------------------------------- builders

  /** Queue static geometry (already in playfield metres) for merging. */
  private addStatic(geometry: THREE.BufferGeometry, material: THREE.Material): void {
    const g = geometry.index ? geometry.toNonIndexed() : geometry;
    for (const name of Object.keys(g.attributes)) {
      if (name !== 'position' && name !== 'normal') g.deleteAttribute(name);
    }
    if (!this.pending.has(material)) this.pending.set(material, []);
    this.pending.get(material)!.push(g);
  }

  private flushStatic(): void {
    for (const [material, geometries] of this.pending) {
      const merged = mergeGeometries(geometries, false);
      if (!merged) continue;
      const mesh = new THREE.Mesh(merged, material);
      mesh.castShadow = material !== mats.ramp;
      mesh.receiveShadow = true;
      this.group.add(mesh);
    }
    this.pending.clear();
  }

  private addLight(id: string, light: Light): void {
    if (!this.lights.has(id)) this.lights.set(id, []);
    this.lights.get(id)!.push(light);
  }

  private boxGeometry(
    a: Vec2,
    b: Vec2,
    thickness: number,
    height: number,
    z0 = 0,
  ): THREE.BufferGeometry {
    const dx = (b[0] - a[0]) * MM;
    const dy = (b[1] - a[1]) * MM;
    const len = Math.hypot(dx, dy);
    const t = Math.max(thickness * MM, 0.002);
    const g = new THREE.BoxGeometry(len + t, t, height * MM);
    g.rotateZ(Math.atan2(dy, dx));
    g.translate(((a[0] + b[0]) / 2) * MM, ((a[1] + b[1]) / 2) * MM, (z0 + height / 2) * MM);
    return g;
  }

  private cylinderGeometry(
    x: number,
    y: number,
    r: number,
    h: number,
    z0 = 0,
  ): THREE.BufferGeometry {
    const g = new THREE.CylinderGeometry(r * MM, r * MM, h * MM, 24);
    g.rotateX(Math.PI / 2);
    g.translate(x * MM, y * MM, (z0 + h / 2) * MM);
    return g;
  }

  private addElement(el: ElementDef): void {
    switch (el.type) {
      case 'wall':
        for (let i = 0; i + 1 < el.points.length; i++) {
          const height = el.height ?? 25;
          this.addStatic(
            this.boxGeometry(el.points[i]!, el.points[i + 1]!, (el.radius ?? 1.5) * 2, height),
            materialFor(el.material),
          );
        }
        break;
      case 'post': {
        const h = el.height ?? 25;
        this.addStatic(
          this.cylinderGeometry(el.x, el.y, el.radius, h),
          el.material.startsWith('rubber') ? mats.rubber : mats.metal,
        );
        this.addStatic(
          this.cylinderGeometry(el.x, el.y, Math.max(2, el.radius - 3), h + 7),
          mats.metal,
        );
        break;
      }
      case 'sling': {
        const shape = new THREE.Shape([
          new THREE.Vector2(el.corner[0] * MM, el.corner[1] * MM),
          new THREE.Vector2(el.top[0] * MM, el.top[1] * MM),
          new THREE.Vector2(el.bottom[0] * MM, el.bottom[1] * MM),
        ]);
        this.addStatic(
          new THREE.ExtrudeGeometry(shape, { depth: 0.022, bevelEnabled: false }),
          mats.plastic,
        );
        const rubber = glowMaterial(0xf2f2f2);
        this.addLight(el.id, { material: rubber, base: 0, level: 0, mode: 'off' });
        const m = new THREE.Mesh(this.boxGeometry(el.top, el.bottom, 6, 22), rubber);
        m.castShadow = true;
        this.group.add(m);
        this.addStatic(this.cylinderGeometry(el.top[0], el.top[1], 5, 25), mats.rubber);
        this.addStatic(this.cylinderGeometry(el.bottom[0], el.bottom[1], 5, 25), mats.rubber);
        break;
      }
      case 'pop': {
        this.addStatic(this.cylinderGeometry(el.x, el.y, el.radius, 30), mats.popBody);
        const cap = glowMaterial(el.color ?? 0xf4efe1, 0.4);
        cap.transparent = true;
        cap.opacity = 0.95;
        this.addLight(el.id, { material: cap, base: 0.4, level: 0, mode: 'off' });
        const m = new THREE.Mesh(this.cylinderGeometry(el.x, el.y, el.radius + 8, 8, 32), cap);
        m.castShadow = true;
        this.group.add(m);
        break;
      }
      case 'drop':
      case 'standup': {
        const color = el.type === 'drop' ? 0xf2b33d : 0x9b5de5;
        const mat = glowMaterial(color, 0.05);
        this.addLight(el.id, { material: mat, base: 0.05, level: 0, mode: 'off' });
        const dx = (el.b[0] - el.a[0]) * MM;
        const dy = (el.b[1] - el.a[1]) * MM;
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(Math.hypot(dx, dy), 0.005, 0.03), mat);
        mesh.position.z = 0.015;
        mesh.rotation.z = Math.atan2(dy, dx);
        mesh.castShadow = true;
        const holder = new THREE.Group();
        holder.position.set(((el.a[0] + el.b[0]) / 2) * MM, ((el.a[1] + el.b[1]) / 2) * MM, 0);
        holder.add(mesh);
        this.group.add(holder);
        if (el.type === 'drop') this.dropMeshes.set(el.id, holder);
        break;
      }
      case 'kicker': {
        const mat = glowMaterial(0xff9f1c, 0.15);
        this.addLight(el.id, { material: mat, base: 0.15, level: 0, mode: 'off' });
        const m = new THREE.Mesh(this.boxGeometry(el.a, el.b, 6, 25), mat);
        this.group.add(m);
        break;
      }
      case 'gate':
        this.addStatic(this.boxGeometry(el.a, el.b, 1.5, 4, 22), mats.metal);
        break;
      case 'spinner': {
        const dx = (el.b[0] - el.a[0]) * MM;
        const dy = (el.b[1] - el.a[1]) * MM;
        const holder = new THREE.Group();
        holder.position.set(((el.a[0] + el.b[0]) / 2) * MM, ((el.a[1] + el.b[1]) / 2) * MM, 0.03);
        holder.rotation.z = Math.atan2(dy, dx);
        const axle = new THREE.Group();
        const plate = new THREE.Mesh(
          new THREE.BoxGeometry(Math.hypot(dx, dy), 0.002, 0.024),
          mats.wire,
        );
        plate.position.z = -0.012;
        axle.add(plate);
        holder.add(axle);
        this.group.add(holder);
        this.spinnerMeshes.set(el.id, axle);
        this.addStatic(this.boxGeometry(el.a, el.b, 2, 2, 30), mats.metal);
        break;
      }
      case 'sensor':
        if ((el.zMin ?? 0) < 20) this.addStatic(this.boxGeometry(el.a, el.b, 1, 0.6), mats.sensor);
        break;
      case 'ramp': {
        const { left, right } = rampEdges(el.path, el.width, el.endWidth ?? el.width);
        const pos: number[] = [];
        const quad = (a: Vec3, b: Vec3, c: Vec3, d: Vec3) => {
          for (const v of [a, b, c, a, c, d]) pos.push(v[0] * MM, v[1] * MM, v[2] * MM);
        };
        const up = (v: Vec3): Vec3 => [v[0], v[1], v[2] + el.wallHeight];
        for (let i = 0; i + 1 < el.path.length; i++) {
          const l0 = left[i]!;
          const l1 = left[i + 1]!;
          const r0 = right[i]!;
          const r1 = right[i + 1]!;
          quad(l0, r0, r1, l1);
          quad(l0, l1, up(l1), up(l0));
          quad(r0, r1, up(r1), up(r0));
        }
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        g.computeVertexNormals();
        this.addStatic(g, mats.ramp);
        break;
      }
      case 'wireform': {
        for (const rail of wireformRails(el.path, this.world.params.ballRadius / MM)) {
          const curve = new THREE.CatmullRomCurve3(
            rail.map((p) => new THREE.Vector3(p[0] * MM, p[1] * MM, p[2] * MM)),
          );
          this.addStatic(
            new THREE.TubeGeometry(curve, rail.length * 6, 0.002, 6, false),
            mats.wire,
          );
        }
        break;
      }
      case 'dome': {
        // Low mound with a pitcher standee behind it (both visual only in M1).
        const g = new THREE.SphereGeometry(el.radius * MM, 32, 8, 0, Math.PI * 2, 0, Math.PI / 2);
        g.scale(1, el.height / el.radius, 1);
        g.rotateX(Math.PI / 2);
        g.translate(el.x * MM, el.y * MM, 0);
        this.addStatic(g, mats.mound);
        this.standeeSpots.push({ cell: 'P', x: el.x, y: el.y + 20 });
        break;
      }
      case 'kickback':
        this.addStatic(
          this.boxGeometry([el.x0 + 8, el.y0 + 10], [el.x1 - 8, el.y0 + 10], 10, 12),
          mats.metal,
        );
        break;
      case 'plunger': {
        const x = ((el.x0 + el.x1) / 2) * MM;
        const rod = new THREE.Group();
        const shaft = new THREE.Mesh(
          new THREE.CylinderGeometry(0.004, 0.004, 0.06, 12),
          mats.metal,
        );
        shaft.position.set(x, (el.tipY - 30) * MM, 0.0135);
        const tip = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.009, 0.01, 16), mats.rubber);
        tip.position.set(x, (el.tipY - 4) * MM, 0.0135);
        rod.add(shaft, tip);
        this.group.add(rod);
        this.plungerRod = rod;
        break;
      }
      case 'saucer': {
        const disc = new THREE.Mesh(new THREE.CircleGeometry(el.radius * MM, 40), mats.saucer);
        disc.position.set(el.x * MM, el.y * MM, 0.0003);
        this.group.add(disc);
        const la = (el.lipAngle * Math.PI) / 180;
        const lip = el.lip ?? 'bar';
        if (lip === 'bar') {
          const lx = el.x + (el.radius + 6) * Math.cos(la);
          const ly = el.y + (el.radius + 6) * Math.sin(la);
          const tx = -Math.sin(la) * el.radius * 0.9;
          const ty = Math.cos(la) * el.radius * 0.9;
          this.addStatic(
            this.boxGeometry([lx - tx, ly - ty], [lx + tx, ly + ty], 8, 12),
            mats.rubber,
          );
        } else if (lip === 'post') {
          this.addStatic(
            this.cylinderGeometry(
              el.x + (el.radius + 8) * Math.cos(la),
              el.y + (el.radius + 8) * Math.sin(la),
              8,
              12,
            ),
            mats.rubber,
          );
        }
        // Fielder standee behind the lip (added when the standee art loads).
        if (el.label) {
          this.standeeSpots.push({
            cell: el.label,
            x: el.x + (el.radius + 16) * Math.cos(la),
            y: el.y + (el.radius + 16) * Math.sin(la),
          });
        }
        break;
      }
      case 'lamp': {
        const mat = glowMaterial(el.color, 0.08);
        this.addLight(el.id, { material: mat, base: 0.08, level: 0, mode: 'off' });
        let geom: THREE.BufferGeometry;
        if (el.arrow !== undefined) {
          const r = el.radius * MM;
          const s = new THREE.Shape();
          s.moveTo(r * 1.4, 0);
          s.lineTo(-r, r);
          s.lineTo(-r * 0.4, 0);
          s.lineTo(-r, -r);
          s.closePath();
          geom = new THREE.ShapeGeometry(s);
          geom.rotateZ((el.arrow * Math.PI) / 180);
        } else {
          geom = new THREE.CircleGeometry(el.radius * MM, 24);
        }
        const m = new THREE.Mesh(geom, mat);
        m.position.set(el.x * MM, el.y * MM, 0.0004);
        this.group.add(m);
        break;
      }
      case 'magnet':
      case 'flipper':
        break; // magnet is under the playfield; flippers are built from the physics model
    }
  }

  private addFlipper(f: Flipper): void {
    const outline = (r1: number, r2: number): THREE.Shape => {
      const L = f.length;
      const b = (r1 - r2) / L;
      const a = Math.sqrt(1 - b * b);
      const up = Math.atan2(a, b);
      const shape = new THREE.Shape();
      shape.moveTo(r1 * b, r1 * a);
      shape.lineTo(L + r2 * b, r2 * a);
      shape.absarc(L, 0, r2, up, -up, true);
      shape.lineTo(r1 * b, -r1 * a);
      shape.absarc(0, 0, r1, -up, up, true);
      return shape;
    };
    const holder = new THREE.Group();
    holder.position.set(f.px, f.py, 0);
    // Plastic bat slightly inside the collision outline; the rubber band is the true outline.
    const inset = 0.0012;
    const body = new THREE.Mesh(
      new THREE.ExtrudeGeometry(outline(f.baseRadius - inset, f.tipRadius - inset), {
        depth: f.height * 0.8,
        bevelEnabled: false,
        curveSegments: 24,
      }),
      mats.flipper,
    );
    body.position.z = f.height * 0.1;
    body.castShadow = true;
    holder.add(body);
    const rubber = new THREE.Mesh(
      new THREE.ExtrudeGeometry(outline(f.baseRadius, f.tipRadius), {
        depth: f.height * 0.3,
        bevelEnabled: false,
        curveSegments: 24,
      }),
      mats.flipperRubber,
    );
    rubber.position.z = f.height * 0.3;
    holder.add(rubber);
    const pivot = new THREE.Mesh(
      new THREE.CylinderGeometry(0.004, 0.004, f.height * 1.2, 16).rotateX(Math.PI / 2),
      mats.metal,
    );
    pivot.position.z = f.height * 0.6;
    holder.add(pivot);
    this.group.add(holder);
    this.flipperMeshes.set(f, holder);
  }

  private buildColliderLines(): THREE.LineSegments {
    const pts: number[] = [];
    const z = 0.002;
    const circle = (cx: number, cy: number, r: number, cz = z) => {
      const n = 24;
      for (let i = 0; i < n; i++) {
        const t0 = (i / n) * Math.PI * 2;
        const t1 = ((i + 1) / n) * Math.PI * 2;
        pts.push(
          cx + r * Math.cos(t0),
          cy + r * Math.sin(t0),
          cz,
          cx + r * Math.cos(t1),
          cy + r * Math.sin(t1),
          cz,
        );
      }
    };
    for (const c of this.world.colliders) {
      if (c.kind === 'segment') {
        const dx = c.bx - c.ax;
        const dy = c.by - c.ay;
        const len = Math.hypot(dx, dy) || 1;
        const nx = (-dy / len) * c.radius;
        const ny = (dx / len) * c.radius;
        pts.push(
          c.ax + nx,
          c.ay + ny,
          z,
          c.bx + nx,
          c.by + ny,
          z,
          c.ax - nx,
          c.ay - ny,
          z,
          c.bx - nx,
          c.by - ny,
          z,
        );
      } else if (c.kind === 'circle') {
        circle(c.ax, c.ay, c.radius);
      } else if (c.kind === 'triangle') {
        pts.push(
          c.ax,
          c.ay,
          c.az,
          c.bx,
          c.by,
          c.bz,
          c.bx,
          c.by,
          c.bz,
          c.cx,
          c.cy,
          c.cz,
          c.cx,
          c.cy,
          c.cz,
          c.ax,
          c.ay,
          c.az,
        );
      } else {
        pts.push(c.ax, c.ay, c.az, c.bx, c.by, c.bz);
      }
    }
    for (const s of this.world.saucers) circle(s.cx, s.cy, s.a);
    for (const s of this.world.sensors) pts.push(s.ax, s.ay, z, s.bx, s.by, z);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    return new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0x00ffaa }));
  }
}
