import * as THREE from 'three/webgpu';
import type { ElementDef, TableDef, Vec2 } from '../table/schema';
import type { World } from '../physics/world';
import type { Flipper } from '../physics/flipper';

/**
 * Whitebox meshes built from the table definition (M0: grey materials, no art).
 * Everything lives in a `playfield` group whose local frame is playfield metres (z up); the
 * group is tilted by the slope.
 */

const MM = 0.001;

const mats = {
  floor: new THREE.MeshStandardMaterial({ color: 0x3d5a45, roughness: 0.35, metalness: 0 }),
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
  flipper: new THREE.MeshStandardMaterial({ color: 0xf4efe1, roughness: 0.35 }),
  flipperRubber: new THREE.MeshStandardMaterial({ color: 0xc8282a, roughness: 0.6 }),
  saucer: new THREE.MeshStandardMaterial({ color: 0x050505, roughness: 0.9 }),
  standee: new THREE.MeshStandardMaterial({ color: 0x1b2a4a, roughness: 0.5 }),
  drop: new THREE.MeshStandardMaterial({ color: 0xf2b33d, roughness: 0.4, emissive: 0x000000 }),
  popBody: new THREE.MeshStandardMaterial({ color: 0xdddddd, roughness: 0.3, metalness: 0.6 }),
  ball: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.06, metalness: 1 }),
};

function materialFor(name: string): THREE.Material {
  if (name === 'wood') return mats.wood;
  if (name.startsWith('rubber')) return mats.rubber;
  return mats.metal;
}

interface Flash {
  material: THREE.MeshStandardMaterial;
  base: number;
  level: number;
}

export class TableView {
  readonly group = new THREE.Group();
  readonly floor: THREE.Mesh;
  private readonly flipperMeshes = new Map<Flipper, THREE.Object3D>();
  private readonly dropMeshes = new Map<string, THREE.Object3D>();
  private readonly flashes = new Map<string, Flash>();
  private readonly ballMeshes: THREE.Mesh[] = [];
  private readonly colliderLines: THREE.LineSegments;

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

  /** Brighten a device's light briefly (pop caps, sling rubbers). */
  flash(id: string): void {
    const f = this.flashes.get(id);
    if (f) f.level = 1;
  }

  update(alpha: number, dtSeconds: number): void {
    for (const [f, mesh] of this.flipperMeshes) {
      mesh.rotation.z = f.prevTheta + (f.theta - f.prevTheta) * alpha;
    }
    for (const [id, mesh] of this.dropMeshes) {
      const down = this.world.isDropDown(id);
      const target = down ? -0.028 : 0;
      mesh.position.z += (target - mesh.position.z) * Math.min(1, dtSeconds * 40);
    }
    for (const f of this.flashes.values()) {
      f.material.emissiveIntensity = f.base + f.level * 4;
      f.level = Math.max(0, f.level - dtSeconds * 8);
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

  private add(mesh: THREE.Mesh, shadows = true): THREE.Mesh {
    mesh.castShadow = shadows;
    mesh.receiveShadow = true;
    this.group.add(mesh);
    return mesh;
  }

  private wallSegment(a: Vec2, b: Vec2, radius: number, height: number, mat: THREE.Material): void {
    const dx = (b[0] - a[0]) * MM;
    const dy = (b[1] - a[1]) * MM;
    const len = Math.hypot(dx, dy);
    const t = Math.max(radius * 2 * MM, 0.002);
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(len + t, t, height * MM), mat);
    mesh.position.set(((a[0] + b[0]) / 2) * MM, ((a[1] + b[1]) / 2) * MM, (height / 2) * MM);
    mesh.rotation.z = Math.atan2(dy, dx);
    this.add(mesh);
  }

  private cylinder(
    x: number,
    y: number,
    r: number,
    h: number,
    mat: THREE.Material,
    z0 = 0,
  ): THREE.Mesh {
    const g = new THREE.CylinderGeometry(r * MM, r * MM, h * MM, 32);
    g.rotateX(Math.PI / 2);
    const mesh = new THREE.Mesh(g, mat);
    mesh.position.set(x * MM, y * MM, (z0 + h / 2) * MM);
    return this.add(mesh);
  }

  private addElement(el: ElementDef): void {
    switch (el.type) {
      case 'wall':
        for (let i = 0; i + 1 < el.points.length; i++) {
          this.wallSegment(
            el.points[i]!,
            el.points[i + 1]!,
            el.radius ?? 1.5,
            el.height ?? 25,
            materialFor(el.material),
          );
        }
        break;
      case 'post':
        this.cylinder(
          el.x,
          el.y,
          el.radius,
          25,
          el.material.startsWith('rubber') ? mats.rubber : mats.metal,
        );
        this.cylinder(el.x, el.y, Math.max(2, el.radius - 3), 32, mats.metal);
        break;
      case 'sling': {
        const shape = new THREE.Shape([
          new THREE.Vector2(el.corner[0] * MM, el.corner[1] * MM),
          new THREE.Vector2(el.top[0] * MM, el.top[1] * MM),
          new THREE.Vector2(el.bottom[0] * MM, el.bottom[1] * MM),
        ]);
        const g = new THREE.ExtrudeGeometry(shape, { depth: 0.022, bevelEnabled: false });
        this.add(new THREE.Mesh(g, mats.plastic));
        const rubberMat = mats.rubberWhite.clone();
        rubberMat.emissive = new THREE.Color(0xffffff);
        rubberMat.emissiveIntensity = 0;
        this.flashes.set(el.id, { material: rubberMat, base: 0, level: 0 });
        this.wallSegment(el.top, el.bottom, 3, 22, rubberMat);
        this.cylinder(el.top[0], el.top[1], 5, 25, mats.rubber);
        this.cylinder(el.bottom[0], el.bottom[1], 5, 25, mats.rubber);
        break;
      }
      case 'pop': {
        this.cylinder(el.x, el.y, el.radius, 30, mats.popBody);
        const cap = new THREE.MeshStandardMaterial({
          color: 0xf4efe1,
          roughness: 0.25,
          emissive: new THREE.Color(0xfff1c8),
          emissiveIntensity: 0.4,
          transparent: true,
          opacity: 0.95,
        });
        this.flashes.set(el.id, { material: cap, base: 0.4, level: 0 });
        this.cylinder(el.x, el.y, el.radius + 8, 8, cap, 32);
        break;
      }
      case 'drop': {
        const dx = (el.b[0] - el.a[0]) * MM;
        const dy = (el.b[1] - el.a[1]) * MM;
        const mesh = new THREE.Mesh(
          new THREE.BoxGeometry(Math.hypot(dx, dy), 0.005, 0.028),
          mats.drop,
        );
        const holder = new THREE.Group();
        holder.position.set(((el.a[0] + el.b[0]) / 2) * MM, ((el.a[1] + el.b[1]) / 2) * MM, 0);
        mesh.position.z = 0.014;
        mesh.rotation.z = Math.atan2(dy, dx);
        mesh.castShadow = true;
        holder.add(mesh);
        this.group.add(holder);
        this.dropMeshes.set(el.id, holder);
        break;
      }
      case 'saucer': {
        const disc = new THREE.Mesh(new THREE.CircleGeometry(el.radius * MM, 40), mats.saucer);
        disc.position.set(el.x * MM, el.y * MM, 0.0003);
        this.group.add(disc);
        const la = (el.lipAngle * Math.PI) / 180;
        const lx = el.x + (el.radius + 6) * Math.cos(la);
        const ly = el.y + (el.radius + 6) * Math.sin(la);
        const tx = -Math.sin(la) * el.radius * 0.9;
        const ty = Math.cos(la) * el.radius * 0.9;
        this.wallSegment([lx - tx, ly - ty], [lx + tx, ly + ty], 4, 12, mats.rubber);
        // Fielder standee placeholder.
        const standee = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.004, 0.05), mats.standee);
        standee.position.set((lx + 8 * Math.cos(la)) * MM, (ly + 8 * Math.sin(la)) * MM, 0.025);
        standee.rotation.z = la - Math.PI / 2;
        this.add(standee);
        break;
      }
      case 'flipper':
        break; // built from the physics flipper so geometry matches exactly
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
    for (const c of this.world.colliders) {
      if (c.kind === 'segment') {
        // Outline of the inflated segment.
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
      } else {
        const n = 24;
        for (let i = 0; i < n; i++) {
          const t0 = (i / n) * Math.PI * 2;
          const t1 = ((i + 1) / n) * Math.PI * 2;
          pts.push(
            c.ax + c.radius * Math.cos(t0),
            c.ay + c.radius * Math.sin(t0),
            z,
            c.ax + c.radius * Math.cos(t1),
            c.ay + c.radius * Math.sin(t1),
            z,
          );
        }
      }
    }
    for (const s of this.world.saucers) {
      const n = 32;
      for (let i = 0; i < n; i++) {
        const t0 = (i / n) * Math.PI * 2;
        const t1 = ((i + 1) / n) * Math.PI * 2;
        pts.push(
          s.cx + s.a * Math.cos(t0),
          s.cy + s.a * Math.sin(t0),
          z,
          s.cx + s.a * Math.cos(t1),
          s.cy + s.a * Math.sin(t1),
          z,
        );
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    return new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0x00ffaa }));
  }
}
