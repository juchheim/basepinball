import * as THREE from 'three/webgpu';
import {
  abs,
  cubeTexture,
  dot,
  float,
  mix,
  normalView,
  positionViewDirection,
  pow,
  texture,
  uniform,
  uv,
  vec3,
} from 'three/tsl';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { ElementDef, TableDef, Vec2, Vec3 } from '../table/schema';
import { rampEdges, saucerLipPost, wireformRails, type World } from '../physics/world';
import type { Flipper } from '../physics/flipper';
import { rampBumperMesh, type Tri } from '../table/rampBumper';
import { Spring } from '../fx/anim';
import { Particles } from '../fx/particles';
import { Figures } from './figures';
import { LampBatch } from './lampBatch';
import { toBackdrop } from './layers';

/**
 * Whitebox meshes built from the table definition (M1: grey materials, coloured lamp discs,
 * no art). Everything lives in a group whose local frame is playfield metres (z up); the group
 * is tilted by the slope. Static parts are merged per material to keep draw calls low.
 */

const MM = 0.001;
/** How far (m) a rising bumper sinks below the playfield, enough to hide it entirely. */
const RISER_DEPTH = 0.025;

/**
 * Tinted clear acrylic: see-through where you look straight into it, thicker and more strongly
 * coloured toward grazing angles (a Fresnel term), so the ramp's walls and curves read as glass.
 */
function rampMaterial(color: number): THREE.MeshPhysicalNodeMaterial {
  const m = new THREE.MeshPhysicalNodeMaterial({
    color,
    roughness: 0.06,
    metalness: 0,
    clearcoat: 1,
    clearcoatRoughness: 0.03,
    // A faint self-glow in the tint, as edge-lit acrylic has.
    emissive: new THREE.Color(color),
    emissiveIntensity: 0.05,
    transparent: true,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const facing = abs(dot(normalView, positionViewDirection));
  m.opacityNode = mix(float(0.14), float(0.8), pow(float(1).sub(facing), 2.2));
  return m;
}

/**
 * General illumination (GI): the warm bulbs under the plastics of a real table throw pools of light
 * on the playfield, brightest round the slings and the flipper area, with the far corners in
 * shade. The printed art is multiplied by this map (playfield mm; x, y, radius, weight). Dimmed
 * with the park lights for attract mode.
 */
const GI_POOLS: [number, number, number, number][] = [
  [275, 170, 230, 0.2],
  [96, 330, 120, 0.3],
  [454, 330, 120, 0.3],
  [275, 420, 170, 0.14],
  [275, 900, 150, 0.16],
  [170, 700, 120, 0.1],
  [380, 700, 120, 0.1],
];
const giLevel = uniform(1);
const playfieldMap = texture(new THREE.Texture());

/** GLSL's smoothstep (also for edge0 > edge1). */
function smooth(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/**
 * The static part of the GI, baked once (docs/MVP/efficiency-audit F7): R = shade toward the top of
 * the field and along the side rails, G = the sum of the pools. The playfield covers most of the
 * screen, so this saves seven `exp`s and the shading curves per pixel; the maps are smooth, so a
 * bilinear 128×256 texture reproduces them exactly. Sampled at texel centres, as the GPU filters.
 */
function bakeGI(width: number, length: number): THREE.DataTexture {
  const W = 128;
  const H = 256;
  const data = new Uint16Array(W * H * 4);
  for (let j = 0; j < H; j++) {
    const y = ((j + 0.5) / H) * length;
    for (let i = 0; i < W; i++) {
      const x = ((i + 0.5) / W) * width;
      let pools = 0;
      for (const [px, py, r, w] of GI_POOLS) {
        const dx = (x - px) / r;
        const dy = (y - py) / r;
        pools += Math.exp(-(dx * dx + dy * dy)) * w;
      }
      const shade =
        (1 + (0.68 - 1) * smooth(560, length, y)) *
        (0.8 + 0.2 * smooth(0, 70, x) * smooth(width, width - 70, x));
      const k = (j * W + i) * 4;
      data[k] = THREE.DataUtils.toHalfFloat(shade);
      data[k + 1] = THREE.DataUtils.toHalfFloat(pools);
      data[k + 3] = THREE.DataUtils.toHalfFloat(1);
    }
  }
  const tex = new THREE.DataTexture(data, W, H, THREE.RGBAFormat, THREE.HalfFloatType);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

function playfieldMaterial(width: number, length: number): THREE.MeshPhysicalNodeMaterial {
  const m = new THREE.MeshPhysicalNodeMaterial({
    roughness: 0.6,
    metalness: 0,
    clearcoat: 1,
    clearcoatRoughness: 0.04,
  });
  const baked = texture(bakeGI(width, length), uv());
  // With the GI out the field falls to 40 % (the towers still light it); the pools go entirely.
  const lit = mix(float(0.4), float(1), giLevel.min(1));
  const gi = vec3(baked.r.mul(lit)).add(vec3(1, 0.86, 0.66).mul(baked.g).mul(giLevel));
  m.colorNode = playfieldMap.mul(gi);
  return m;
}

const mats = {
  // The cabinet's inner side walls: dark lacquered walnut.
  wood: new THREE.MeshPhysicalMaterial({
    color: 0x2a1b12,
    roughness: 0.45,
    clearcoat: 0.7,
    clearcoatRoughness: 0.15,
  }),
  metal: new THREE.MeshStandardMaterial({ color: 0xe2e6ee, roughness: 0.14, metalness: 1 }),
  rubber: new THREE.MeshStandardMaterial({ color: 0x15151a, roughness: 0.45 }),
  rubberWhite: new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.6 }),
  // Sling plastics: glossy printed acrylic.
  plastic: new THREE.MeshPhysicalMaterial({
    color: 0xf1e8d2,
    roughness: 0.25,
    clearcoat: 1,
    clearcoatRoughness: 0.05,
    transparent: true,
    opacity: 0.9,
  }),
  // Tinted clear plastics tell the two ramps apart: red "Over the Wall" (home run), teal Steal.
  rampHR: rampMaterial(0xff5a48),
  rampSteal: rampMaterial(0x2ee6cf),
  wire: new THREE.MeshStandardMaterial({ color: 0xeef1f6, roughness: 0.07, metalness: 1 }),
  flipper: new THREE.MeshPhysicalMaterial({
    color: 0xf4efe1,
    roughness: 0.3,
    clearcoat: 0.8,
    clearcoatRoughness: 0.1,
  }),
  flipperRubber: new THREE.MeshStandardMaterial({ color: 0xc41f24, roughness: 0.45 }),
  saucer: new THREE.MeshStandardMaterial({ color: 0x030303, roughness: 0.9 }),
  mound: new THREE.MeshStandardMaterial({ color: 0x8e4f2b, roughness: 0.85 }),
  /** The ramp of the mound's wedge (the triangles are not wound consistently, so two-sided). */
  rampBumper: new THREE.MeshStandardMaterial({
    color: 0xf6f1e4,
    emissive: new THREE.Color(0x4a4636),
    roughness: 0.4,
    metalness: 0.1,
    side: THREE.DoubleSide,
  }),
  popBody: new THREE.MeshStandardMaterial({ color: 0xe8ebf0, roughness: 0.12, metalness: 1 }),
  sensor: new THREE.MeshStandardMaterial({ color: 0x9aa6c4, roughness: 0.3, metalness: 0.9 }),
  // A node material, so the dynamic reflection can be set as its `envNode` (see `setReflections`).
  ball: new THREE.MeshStandardNodeMaterial({ color: 0xffffff, roughness: 0.04, metalness: 1 }),
};

/** Scratch vector for the ball's position in `updateReflections`. */
const reflectionPos = new THREE.Vector3();
/** Per-frame scratch for the balls and the trail (nothing allocated a frame, efficiency audit F11). */
const scratchQa = new THREE.Quaternion();
const scratchQb = new THREE.Quaternion();
const scratchMatrix = new THREE.Matrix4();

/** A soft round glow (white centre fading to nothing), shared by every lamp and pop halo. */
let haloTexture: THREE.Texture | null = null;
function getHaloTexture(): THREE.Texture {
  if (haloTexture) return haloTexture;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.22, 'rgba(255,255,255,0.55)');
  g.addColorStop(0.5, 'rgba(255,255,255,0.16)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  haloTexture = new THREE.CanvasTexture(c);
  haloTexture.colorSpace = THREE.SRGBColorSpace;
  return haloTexture;
}

/**
 * A pop bumper's cap: translucent coloured plastic, brighter in the middle where the bulb sits, a
 * white rim, and its label printed on top.
 */
function popCapTexture(color: number, label: string): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const ctx = c.getContext('2d')!;
  const col = new THREE.Color(color);
  const css = (k: number): string =>
    `rgb(${Math.round(Math.min(1, col.r * k) * 255)},${Math.round(Math.min(1, col.g * k) * 255)},${Math.round(Math.min(1, col.b * k) * 255)})`;
  const g = ctx.createRadialGradient(128, 128, 8, 128, 128, 128);
  g.addColorStop(0, '#ffffff');
  g.addColorStop(0.35, css(1.05));
  g.addColorStop(0.8, css(0.72));
  g.addColorStop(1, css(0.45));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 256, 256);
  ctx.lineWidth = 14;
  ctx.strokeStyle = 'rgba(255,255,255,0.85)';
  ctx.beginPath();
  ctx.arc(128, 128, 112, 0, Math.PI * 2);
  ctx.stroke();
  if (label) {
    ctx.fillStyle = 'rgba(11,16,32,0.85)';
    ctx.font = 'bold 92px Oswald, "Arial Narrow", Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    // The cylinder's cap maps the texture a quarter turn round: counter-rotate so it reads upright.
    ctx.translate(128, 128);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText(label, 0, 6);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function materialFor(name: string): THREE.Material {
  if (name === 'wood') return mats.wood;
  if (name.startsWith('rubber')) return mats.rubber;
  return mats.metal;
}

export type LampMode = 'off' | 'on' | 'blink';

/** Something emissive that can flash (pop caps, sling rubbers, targets, lamps). */
interface Light {
  /** Sets its emissive intensity: a material's own, or a batched lamp's (see `LampBatch`). */
  glow: (intensity: number) => void;
  base: number;
  level: number;
  /** Steady state (lamps); 'blink' flashes at 2.5 Hz (under the 3 Hz photosensitivity cap). */
  mode: LampMode;
  /** Emissive intensity added while lit (default 1.6). */
  boost?: number;
  /** Sets the opacity of the glow on the playfield round it; its strength at full brightness. */
  halo?: (opacity: number) => void;
  haloMax?: number;
}

/**
 * The intensity setter for a material of its own. Only a changed value is written: most lamps are
 * steady most of the time, and each write means a uniform upload (efficiency audit F12).
 */
function glowOf(m: THREE.MeshStandardMaterial): (intensity: number) => void {
  return (v) => {
    if (m.emissiveIntensity !== v) m.emissiveIntensity = v;
  };
}

/** A mesh from triangles given in mm (the wedge on the mound). */
function triGeometry(tris: readonly Tri[]): THREE.BufferGeometry {
  const pos: number[] = [];
  for (const t of tris) for (const v of t) pos.push(v[0] * MM, v[1] * MM, v[2] * MM);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
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
  private readonly floorMaterial: THREE.MeshPhysicalNodeMaterial;
  private readonly flipperMeshes = new Map<Flipper, THREE.Object3D>();
  private readonly dropMeshes = new Map<string, { holder: THREE.Object3D; spring: Spring }>();
  /** Bumpers that rise out of the playfield (the Stretch): `shown` is 0 (sunk) to 1 (up). */
  private readonly risers = new Map<string, { holder: THREE.Object3D; shown: number }>();
  /** Coil-driven parts (pop rings, sling rubbers, kickers, standups) on springs. */
  private readonly devices = new Map<
    string,
    { spring: Spring; kick: number; apply: (x: number) => void }
  >();
  /** Effects in playfield coordinates: dirt puffs, sparks, the home-plate burst. */
  readonly particles = new Particles(300);
  readonly figures: Figures;
  private readonly spinnerMeshes = new Map<string, THREE.Object3D>();
  private plungerRod: THREE.Object3D | null = null;
  private readonly lights = new Map<string, Light[]>();
  /** Lamp inserts and halos, drawn as three instanced meshes. */
  private readonly lamps = new LampBatch();
  private readonly ballMeshes: THREE.Mesh[] = [];
  /** A short streak behind a fast ball (docs/MVP/05 § 4), built on the first ball. */
  private trail: THREE.InstancedMesh | null = null;
  private readonly colliderLines: THREE.LineSegments;
  /** Where standees go (filled while building, placed when the art loads). */
  private readonly standeeSpots: { cell: string; x: number; y: number }[] = [];
  private ballEnv: {
    camera: THREE.CubeCamera;
    target: THREE.CubeRenderTarget;
    /** Cube faces drawn per frame (6 / the tier's frames per full refresh). */
    facesPerFrame: number;
    /** The next face to draw (round robin). */
    face: number;
    /** Where the faces were last drawn from; null at first and after the ball was hidden. */
    at: THREE.Vector3 | null;
    /** Frames since the last face was drawn (a still ball refreshes slowly). */
    idle: number;
  } | null = null;
  /** Static geometry waiting to be merged, per material. */
  private readonly pending = new Map<THREE.Material, THREE.BufferGeometry[]>();

  constructor(
    table: TableDef,
    private readonly world: World,
  ) {
    const w = table.width * MM;
    const l = table.length * MM;
    this.floorMaterial = playfieldMaterial(table.width, table.length);
    this.floor = new THREE.Mesh(new THREE.PlaneGeometry(w, l), this.floorMaterial);
    this.floor.position.set(w / 2, l / 2, 0);
    this.floor.receiveShadow = true;
    this.group.add(this.floor);

    for (const el of table.elements) this.addElement(el);
    for (const f of world.flippers) this.addFlipper(f);
    this.flushStatic();
    this.lamps.build(this.group, getHaloTexture());
    this.figures = new Figures(table, this.standeeSpots, this.particles);
    this.group.add(toBackdrop(this.particles.group), this.figures.group);

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
    const old = playfieldMap.value;
    playfieldMap.value = tex;
    this.floorMaterial.needsUpdate = true;
    old.dispose();
  }

  /** The playfield GI (0 dark to 1 full), following the park lights. */
  setGI(level: number): void {
    this.giBase = level;
  }

  /** The GI drops out for a beat, then surges back brighter and settles (a home run). */
  giFlash(): void {
    this.giPulse = 0;
  }

  private giBase = 1;
  /** Seconds into a GI flash, or -1. */
  private giPulse = -1;
  /** The GI flash's current multiplier (1 when none is running), for the park lights to follow. */
  giFlashLevel = 1;

  /** The GI flash envelope at `t` seconds: out, a held dark beat, a surge, settle. */
  private static giEnvelope(t: number): number {
    if (t < 0.1) return 1 - (t / 0.1) * 0.9;
    if (t < 0.5) return 0.1;
    if (t < 0.65) return 0.1 + ((t - 0.5) / 0.15) * 1.6;
    return 1 + 0.7 * Math.exp(-(t - 0.65) * 4);
  }

  /** Printed-acrylic figures (docs/MVP/05 § 5.3), once the standee atlas has loaded. */
  addStandees(
    atlas: THREE.Texture,
    cells: readonly string[],
    grid: { cols: number; rows: number },
  ): void {
    this.figures.build(atlas, cells, grid);
  }

  /** Fire a coil-driven part: a pop ring pulls down, a sling rubber snaps, a target flexes. */
  fire(id: string): void {
    const d = this.devices.get(id);
    if (d) d.spring.kick(d.kick);
  }

  /**
   * Dynamic ball reflections (docs/MVP/05 § 4): a cube camera follows the ball and renders the
   * table around it, so the chrome ball mirrors lamps, rails and flippers. Size 0 uses the static
   * scene environment instead. `every` is the frames per full refresh: the six faces are drawn
   * round robin, `6 / every` a frame.
   *
   * Kept cheap: the cube cameras see only layer 0 (no stands, crowd, stars or particles; see
   * `layers.ts`) out to 1.6 m (the backboard and tower lamps, nothing behind them), and the ball
   * samples the cube directly. As a plain `envMap` it would be filtered into a PMREM after every
   * update, a chain of blur passes a near-mirror ball (roughness 0.04) has no use for.
   */
  setReflections(size: number, every: number): void {
    if (this.ballEnv) {
      this.ballEnv.target.dispose();
      this.ballEnv = null;
    }
    mats.ball.envNode = null;
    if (size > 0) {
      const target = new THREE.CubeRenderTarget(size);
      const camera = new THREE.CubeCamera(0.005, 1.6, target);
      const facesPerFrame = [1, 2, 3, 6].find((n) => n * Math.max(1, every) >= 6) ?? 6;
      this.ballEnv = { camera, target, facesPerFrame, face: 0, at: null, idle: 0 };
      // Not a texture node (`.rgb`), so the environment lighting samples it as it is instead of
      // wrapping it in a PMREM; it still picks up the reflection vector from the lighting context.
      mats.ball.envNode = cubeTexture(target.texture).rgb;
    }
    mats.ball.needsUpdate = true;
  }

  /**
   * Draw this frame's share of the reflection cube. Nothing while the game is paused (nothing
   * moves); a ball that has barely moved (under 2 mm) refreshes only every fourth frame, so lamp
   * changes still show; a ball that has just appeared or jumped gets all six faces at once.
   */
  updateReflections(renderer: THREE.WebGPURenderer, scene: THREE.Scene, paused: boolean): void {
    const env = this.ballEnv;
    const ball = this.ballMeshes[0];
    if (!env || !ball) return;
    if (!ball.visible) env.at = null;
    if (!ball.visible || paused) return;
    const pos = ball.getWorldPosition(reflectionPos);
    const moved = env.at ? env.at.distanceTo(pos) : Infinity;
    let faces = env.facesPerFrame;
    // Further than a ball rolls in a frame: it was placed (served, released from a lock).
    if (moved > 0.25) faces = 6;
    else if (moved < 0.002 && ++env.idle < 4) return;
    env.idle = 0;
    env.camera.position.copy(pos);
    env.camera.updateMatrixWorld();
    if (env.camera.coordinateSystem !== renderer.coordinateSystem) {
      env.camera.coordinateSystem = renderer.coordinateSystem;
      env.camera.updateCoordinateSystem();
    }
    const cameras = env.camera.children as THREE.PerspectiveCamera[];
    const prevTarget = renderer.getRenderTarget();
    const prevFace = renderer.getActiveCubeFace();
    const prevLevel = renderer.getActiveMipmapLevel();
    ball.visible = false;
    try {
      for (let i = 0; i < faces; i++) {
        renderer.setRenderTarget(env.target, env.face);
        renderer.render(scene, cameras[env.face]!);
        env.face = (env.face + 1) % 6;
      }
    } finally {
      ball.visible = true;
      renderer.setRenderTarget(prevTarget, prevFace, prevLevel);
    }
    env.at = (env.at ?? new THREE.Vector3()).copy(pos);
  }

  /** Brighten a device or lamp briefly. */
  flash(id: string): void {
    for (const l of this.lights.get(id) ?? []) l.level = 1;
  }

  /** Steady state for a lamp. */
  setLamp(id: string, mode: LampMode | boolean): void {
    const m: LampMode = mode === true ? 'on' : mode === false ? 'off' : mode;
    for (const l of this.lights.get(id) ?? []) l.mode = m;
    // A target plate follows its lamp (the W-A-L-K letters glow where they were hit).
    const linked = this.lampLink.get(id);
    if (linked) for (const l of this.lights.get(linked) ?? []) l.mode = m;
  }

  /** Lamp ids that also drive a target's own glow: `lamp.standup.W` → `standup.W`. */
  private readonly lampLink = new Map<string, string>();
  private blinkClock = 0;

  update(alpha: number, dtSeconds: number): void {
    for (const [f, mesh] of this.flipperMeshes) {
      mesh.rotation.z = f.prevTheta + (f.theta - f.prevTheta) * alpha;
    }
    for (const [id, d] of this.dropMeshes) {
      // Snap down with a small bounce; reset pops up past level and settles.
      d.spring.target = this.world.isDropDown(id) ? -0.028 : 0;
      d.spring.update(dtSeconds);
      d.holder.position.z = Math.min(0.004, d.spring.x);
    }
    for (const [id, r] of this.risers) {
      // Follow the physics up; ease down, so a bumper dropping out of the pitch's way sinks
      // instead of vanishing.
      const lift = this.world.popLift(id);
      r.shown = lift >= r.shown ? lift : Math.max(lift, r.shown - dtSeconds * 8);
      r.holder.visible = r.shown > 0.001;
      r.holder.position.z = -(1 - r.shown) * RISER_DEPTH;
    }
    for (const d of this.devices.values()) {
      if (d.spring.settled && d.spring.x === 0) continue;
      d.spring.update(dtSeconds);
      d.apply(d.spring.x);
    }
    this.giFlashLevel = 1;
    if (this.giPulse >= 0) {
      this.giFlashLevel = TableView.giEnvelope(this.giPulse);
      this.giPulse += dtSeconds;
      if (this.giPulse > 2) this.giPulse = -1;
    }
    giLevel.value = this.giBase * this.giFlashLevel;
    this.figures.update(dtSeconds);
    this.particles.update(dtSeconds);
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
        const extra = (lit ? (l.boost ?? 1.6) : 0) + l.level * 4;
        l.glow(l.base + extra);
        l.halo?.(Math.min(1, extra / (l.boost ?? 1.6)) * (l.haloMax ?? 0.8));
        l.level = Math.max(0, l.level - dtSeconds * 6);
      }
    }
    this.lamps.flush();

    // Balls: create meshes on demand, interpolate between physics states.
    const balls = this.world.balls;
    while (this.ballMeshes.length < balls.length) {
      const r = this.world.params.ballRadius;
      const m = new THREE.Mesh(new THREE.SphereGeometry(r, 48, 32), mats.ball);
      m.castShadow = true;
      this.ballMeshes.push(m);
      this.group.add(m);
    }
    const qa = scratchQa;
    const qb = scratchQb;
    this.ballMeshes.forEach((m, i) => {
      const b = balls[i];
      // A parked ball (the souvenir in the Bleachers) is on show too.
      m.visible = !!b && (b.active || b.parkedIn !== null);
      if (!b || !m.visible) return;
      m.position.set(
        b.prevPx + (b.px - b.prevPx) * alpha,
        b.prevPy + (b.py - b.prevPy) * alpha,
        b.prevPz + (b.pz - b.prevPz) * alpha,
      );
      qa.set(b.prevQx, b.prevQy, b.prevQz, b.prevQw);
      qb.set(b.qx, b.qy, b.qz, b.qw);
      m.quaternion.slerpQuaternions(qa, qb, alpha);
    });
    this.updateTrail();
  }

  /**
   * The streak: overlapping soft spheres laid back along the velocity, shrinking toward the tail.
   * Tuned to this table's speeds (a live ball spends ~5 % of its time above 3 m/s and almost none
   * above 4): it fades in from 1.2 m/s and is full by 3.2 m/s, so a ball rolling off a flipper has
   * none and a shot, pop or sling kick leaves a short comet tail.
   */
  private updateTrail(): void {
    const N = 24;
    if (!this.trail) {
      const mat = new THREE.MeshBasicMaterial({
        color: 0xbcd4ff,
        transparent: true,
        opacity: 0.11,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      this.trail = new THREE.InstancedMesh(
        new THREE.SphereGeometry(this.world.params.ballRadius, 12, 8),
        mat,
        N,
      );
      this.trail.frustumCulled = false;
      this.group.add(this.trail);
    }
    // The streak follows one ball: the first in play.
    const i = this.world.balls.findIndex((x) => x.active);
    const b = i >= 0 ? this.world.balls[i] : undefined;
    const mesh = i >= 0 ? this.ballMeshes[i] : undefined;
    const speed = b && b.active ? b.speed() : 0;
    const k = Math.min(1, Math.max(0, (speed - 1.2) / 2));
    this.trail.visible = k > 0 && !!mesh;
    if (!this.trail.visible || !b || !mesh) return;
    // 40 ms of travel back along the velocity (~12 cm at 3 m/s), never more than 14 cm.
    const back = Math.min(0.04, 0.14 / speed);
    const m = scratchMatrix;
    for (let i = 0; i < N; i++) {
      const t = ((i + 1) / N) * back;
      const s = (1 - t / back) * k * 0.95;
      m.makeScale(s, s, s).setPosition(
        mesh.position.x - b.vx * t,
        mesh.position.y - b.vy * t,
        mesh.position.z - b.vz * t,
      );
      this.trail.setMatrixAt(i, m);
    }
    this.trail.instanceMatrix.needsUpdate = true;
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
      mesh.castShadow = material !== mats.rampHR && material !== mats.rampSteal;
      mesh.receiveShadow = true;
      this.group.add(mesh);
    }
    this.pending.clear();
  }

  private addDevice(id: string, kick: number, apply: (x: number) => void): void {
    const prev = this.devices.get(id);
    if (prev) {
      // Several parts share an id (a kicker built from segments): move them together.
      const both = prev.apply;
      prev.apply = (x) => {
        both(x);
        apply(x);
      };
      return;
    }
    this.devices.set(id, { spring: new Spring(14, 0.3), kick, apply });
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
        this.addLight(el.id, { glow: glowOf(rubber), base: 0, level: 0, mode: 'off' });
        const m = new THREE.Mesh(this.boxGeometry(el.top, el.bottom, 6, 22), rubber);
        m.castShadow = true;
        this.group.add(m);
        // The rubber snaps out, away from the sling's corner, and settles.
        {
          const ex = el.bottom[0] - el.top[0];
          const ey = el.bottom[1] - el.top[1];
          let nx = -ey;
          let ny = ex;
          const mx = (el.top[0] + el.bottom[0]) / 2 - el.corner[0];
          const my = (el.top[1] + el.bottom[1]) / 2 - el.corner[1];
          if (nx * mx + ny * my < 0) {
            nx = -nx;
            ny = -ny;
          }
          const len = Math.hypot(nx, ny);
          this.addDevice(el.id, 90, (x) =>
            m.position.set((nx / len) * x * 0.005, (ny / len) * x * 0.005, 0),
          );
        }
        this.addStatic(this.cylinderGeometry(el.top[0], el.top[1], 5, 25), mats.rubber);
        this.addStatic(this.cylinderGeometry(el.bottom[0], el.bottom[1], 5, 25), mats.rubber);
        break;
      }
      case 'pop': {
        this.addStatic(this.cylinderGeometry(el.x, el.y, el.radius, 30), mats.popBody);
        const cap = glowMaterial(0xffffff, 0.3);
        cap.map = cap.emissiveMap = popCapTexture(el.color ?? 0xf4efe1, el.label ?? '');
        cap.roughness = 0.15;
        // The flash lights up the playfield round the bumper (a halo in the lamp batch).
        this.addLight(el.id, {
          glow: glowOf(cap),
          base: 0.3,
          level: 0,
          mode: 'off',
          boost: 1.6,
          halo: this.lamps.addHalo({
            x: el.x,
            y: el.y,
            size: el.radius * MM * 6,
            color: el.color ?? 0xf4efe1,
          }),
          haloMax: 0.35,
        });
        const m = new THREE.Mesh(this.cylinderGeometry(el.x, el.y, el.radius + 8, 8, 32), cap);
        m.castShadow = true;
        this.group.add(m);
        // The ring pulls down hard and springs back.
        this.addDevice(el.id, 90, (x) => (m.position.z = -Math.max(0, x) * 0.006));
        break;
      }
      case 'rampBumper': {
        // The ramp rides in a holder that sinks below the playfield; the bumper face is a glowing
        // band round the back that dips when it fires, like a pop's ring.
        const holder = new THREE.Group();
        holder.visible = false;
        const mesh = rampBumperMesh(el);
        const ramp = new THREE.Mesh(triGeometry(mesh.top), mats.rampBumper);
        ramp.castShadow = true;
        ramp.receiveShadow = true;
        // The bumper glows all the time (more when it fires), so it reads from the flippers.
        const face = glowMaterial(el.color ?? 0xf4efe1, 1.4);
        face.side = THREE.DoubleSide;
        this.addLight(el.id, { glow: glowOf(face), base: 1.4, level: 0, mode: 'off' });
        const band = new THREE.Mesh(triGeometry(mesh.skirt), face);
        band.castShadow = true;
        holder.add(ramp, band);
        this.group.add(holder);
        this.risers.set(el.id, { holder, shown: 0 });
        this.addDevice(el.id, 90, (x) => (band.position.z = -Math.max(0, x) * 0.002));
        break;
      }
      case 'drop':
      case 'standup': {
        const color = el.type === 'drop' ? 0xf2b33d : 0x9b5de5;
        const mat = glowMaterial(color, 0.05);
        // Standups glow strongly once lit, so a hit letter is easy to see from the flippers.
        this.addLight(el.id, {
          glow: glowOf(mat),
          base: 0.05,
          level: 0,
          mode: 'off',
          ...(el.type === 'standup' ? { boost: 3.2 } : {}),
        });
        const dx = (el.b[0] - el.a[0]) * MM;
        const dy = (el.b[1] - el.a[1]) * MM;
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(Math.hypot(dx, dy), 0.005, 0.03), mat);
        mesh.position.z = 0.015;
        mesh.castShadow = true;
        const holder = new THREE.Group();
        holder.position.set(((el.a[0] + el.b[0]) / 2) * MM, ((el.a[1] + el.b[1]) / 2) * MM, 0);
        holder.rotation.z = Math.atan2(dy, dx);
        holder.add(mesh);
        this.group.add(holder);
        if (el.type === 'drop') this.dropMeshes.set(el.id, { holder, spring: new Spring(9, 0.45) });
        // Standups flex back on their spring and wobble upright.
        else {
          this.addDevice(el.id, 60, (x) => (mesh.rotation.x = x * 0.3));
          // A lit pad on the playfield in front of the plate (the side facing the flippers), like
          // a lit insert: dark until the target has been hit.
          const len = Math.hypot(dx, dy);
          const localY = [-Math.sin(holder.rotation.z), Math.cos(holder.rotation.z)];
          const toward = [0.175 - holder.position.x, 0.175 - holder.position.y];
          const side = toward[0]! * localY[0]! + toward[1]! * localY[1]! >= 0 ? 1 : -1;
          const padMat = glowMaterial(color, 0.0);
          padMat.color.set(0x1b1230); // a dark slot until it lights
          padMat.transparent = true;
          padMat.opacity = 0.9;
          const pad = new THREE.Mesh(new THREE.PlaneGeometry(len * 0.94, 0.017), padMat);
          pad.position.set(0, side * 0.015, 0.0007);
          holder.add(pad);
          this.addLight(el.id, {
            glow: glowOf(padMat),
            base: 0,
            level: 0,
            mode: 'off',
            boost: 3.5,
          });
          this.lampLink.set(`lamp.${el.id}`, el.id);
        }
        break;
      }
      case 'kicker': {
        const mat = glowMaterial(0xff9f1c, 0.15);
        this.addLight(el.id, { glow: glowOf(mat), base: 0.15, level: 0, mode: 'off' });
        const m = new THREE.Mesh(this.boxGeometry(el.a, el.b, 6, 25), mat);
        this.group.add(m);
        {
          // The rubber face flexes inward, toward the playfield.
          let nx = -(el.b[1] - el.a[1]);
          let ny = el.b[0] - el.a[0];
          const cx = 275 - (el.a[0] + el.b[0]) / 2;
          const cy = 600 - (el.a[1] + el.b[1]) / 2;
          if (nx * cx + ny * cy < 0) {
            nx = -nx;
            ny = -ny;
          }
          const len = Math.hypot(nx, ny) || 1;
          this.addDevice(el.id, 70, (x) =>
            m.position.set((nx / len) * x * 0.003, (ny / len) * x * 0.003, 0),
          );
        }
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
        this.addStatic(g, el.id === 'ramp.STEAL' ? mats.rampSteal : mats.rampHR);
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
        this.standeeSpots.push({ cell: 'P', x: el.x, y: el.y + 36 });
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
          const post = saucerLipPost(el);
          this.addStatic(this.cylinderGeometry(post.x, post.y, post.radius, 12), mats.rubber);
        }
        // Fielder standee behind the lip (added when the standee art loads).
        if (el.label) {
          this.standeeSpots.push({
            cell: el.label,
            x: el.standee?.[0] ?? el.x + (el.radius + 16) * Math.cos(la),
            y: el.standee?.[1] ?? el.y + (el.radius + 16) * Math.sin(la),
          });
        }
        break;
      }
      case 'lamp': {
        // Batched with the other lamps (see `LampBatch`): a round or arrow insert and its halo.
        this.addLight(el.id, {
          glow: this.lamps.addInsert({
            x: el.x,
            y: el.y,
            r: el.radius,
            arrow: el.arrow,
            color: el.color,
          }),
          base: 0.12,
          level: 0,
          mode: 'off',
          boost: 2.6,
          halo: this.lamps.addHalo({
            x: el.x,
            y: el.y,
            size: el.radius * MM * (el.arrow !== undefined ? 6 : 5.5),
            color: el.color,
          }),
          haloMax: 0.55,
        });
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
