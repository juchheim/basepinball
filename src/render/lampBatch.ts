import * as THREE from 'three/webgpu';
import { instancedBufferAttribute, instancedDynamicBufferAttribute } from 'three/tsl';

/**
 * The playfield's lamp inserts and the glows round them, batched (docs/MVP/efficiency-audit F13):
 * one instanced mesh for the round inserts, one for the arrows, and one for every halo (lamps and
 * pop bumpers), instead of a mesh and a material per lamp, which cost about 50 draws in every pass.
 * Each instance keeps its own colour and brightness (an instance attribute), so they look exactly
 * as the separate meshes did: an insert is tinted plastic at 22 % of its colour, glowing with its
 * colour times its intensity; a halo is an additive glow tinted by its colour, at its opacity.
 */

const MM = 0.001;

interface InsertSpec {
  x: number;
  y: number;
  r: number;
  /** Arrow direction (degrees), or undefined for a round insert. */
  arrow: number | undefined;
  color: number;
}

interface HaloSpec {
  x: number;
  y: number;
  size: number;
  color: number;
}

/** A per-instance float the batch can change every frame (intensity, opacity). */
interface Channel {
  attr: THREE.InstancedBufferAttribute;
  dirty: boolean;
}

export class LampBatch {
  private readonly inserts: InsertSpec[] = [];
  private readonly halos: HaloSpec[] = [];
  private round: Channel | null = null;
  private arrows: Channel | null = null;
  private haloOpacity: Channel | null = null;

  /**
   * Add an insert (playfield mm). Returns the setter for its emissive intensity, live once
   * `build` has run.
   */
  addInsert(spec: InsertSpec): (intensity: number) => void {
    const round = spec.arrow === undefined;
    const index = this.inserts.filter((s) => (s.arrow === undefined) === round).length;
    this.inserts.push(spec);
    return (v) => {
      const ch = round ? this.round : this.arrows;
      if (ch) set(ch, index, v);
    };
  }

  /** Add a halo (playfield mm; `size` is its width in m). Returns the setter for its opacity. */
  addHalo(spec: HaloSpec): (opacity: number) => void {
    const index = this.halos.length;
    this.halos.push(spec);
    return (v) => {
      if (this.haloOpacity) set(this.haloOpacity, index, v);
    };
  }

  /** Build the instanced meshes into `group`. */
  build(group: THREE.Object3D, haloMap: THREE.Texture): void {
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const p = new THREE.Vector3();
    const s = new THREE.Vector3();
    const z = new THREE.Vector3(0, 0, 1);
    const color = new THREE.Color();

    for (const round of [true, false]) {
      const specs = this.inserts.filter((x) => (x.arrow === undefined) === round);
      if (specs.length === 0) continue;
      const n = specs.length;
      // Unit shapes, scaled by each lamp's radius (the arrow as drawn before, with r = 1).
      let geo: THREE.BufferGeometry;
      if (round) {
        geo = new THREE.CircleGeometry(1, 24);
      } else {
        const shape = new THREE.Shape();
        shape.moveTo(1.4, 0);
        shape.lineTo(-1, 1);
        shape.lineTo(-0.4, 0);
        shape.lineTo(-1, -1);
        shape.closePath();
        geo = new THREE.ShapeGeometry(shape);
      }
      const glow = new THREE.InstancedBufferAttribute(new Float32Array(n).fill(0.12), 1);
      glow.setUsage(THREE.DynamicDrawUsage);
      const tint = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3);
      const mat = new THREE.MeshPhysicalNodeMaterial({
        // The instance colour multiplies this: 22 % of the lamp's colour, dark but clearly tinted.
        color: new THREE.Color(0.22, 0.22, 0.22),
        roughness: 0.2,
        clearcoat: 1,
        clearcoatRoughness: 0.04,
      });
      const tintNode = instancedBufferAttribute(tint, 'vec3') as unknown as THREE.Node<'vec3'>;
      mat.emissiveNode = tintNode.mul(instancedDynamicBufferAttribute(glow, 'float'));
      const mesh = new THREE.InstancedMesh(geo, mat, n);
      specs.forEach((sp, i) => {
        q.setFromAxisAngle(z, ((sp.arrow ?? 0) * Math.PI) / 180);
        const r = sp.r * MM;
        mesh.setMatrixAt(i, m.compose(p.set(sp.x * MM, sp.y * MM, 0.0004), q, s.set(r, r, 1)));
        color.setHex(sp.color);
        mesh.setColorAt(i, color);
        tint.setXYZ(i, color.r, color.g, color.b);
      });
      mesh.computeBoundingSphere();
      group.add(mesh);
      const ch = { attr: glow, dirty: false };
      if (round) this.round = ch;
      else this.arrows = ch;
    }

    if (this.halos.length > 0) {
      const n = this.halos.length;
      const opacity = new THREE.InstancedBufferAttribute(new Float32Array(n), 1);
      opacity.setUsage(THREE.DynamicDrawUsage);
      const mat = new THREE.MeshBasicNodeMaterial({
        map: haloMap,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      mat.opacityNode = instancedDynamicBufferAttribute(opacity, 'float');
      const mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), mat, n);
      this.halos.forEach((h, i) => {
        q.identity();
        mesh.setMatrixAt(
          i,
          m.compose(p.set(h.x * MM, h.y * MM, 0.0006), q, s.set(h.size, h.size, 1)),
        );
        mesh.setColorAt(i, color.setHex(h.color));
      });
      mesh.computeBoundingSphere();
      mesh.renderOrder = 1;
      group.add(mesh);
      this.haloOpacity = { attr: opacity, dirty: false };
    }
  }

  /** Upload this frame's changes (once a frame, after the lights are set). */
  flush(): void {
    for (const ch of [this.round, this.arrows, this.haloOpacity]) {
      if (ch?.dirty) {
        ch.attr.needsUpdate = true;
        ch.dirty = false;
      }
    }
  }
}

function set(ch: Channel, index: number, v: number): void {
  const a = ch.attr.array as Float32Array;
  // Compared as stored (32-bit), so an unchanged value never marks the buffer for upload.
  const f = Math.fround(v);
  if (a[index] === f) return;
  a[index] = f;
  ch.dirty = true;
}
