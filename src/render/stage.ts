import * as THREE from 'three/webgpu';
import {
  emissive,
  float,
  luminance,
  max,
  mix,
  mrt,
  output,
  pass,
  renderOutput,
  saturation,
  screenUV,
  smoothstep,
  uniform,
  vec2,
  vec3,
  vec4,
} from 'three/tsl';
import { fxaa } from 'three/addons/tsl/display/FXAANode.js';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import type { Quality } from './quality';
import { BACKDROP_LAYER } from './layers';

/**
 * Renderer, scene, lights, camera and post-processing. WebGPU when available, otherwise Three.js
 * falls back to its WebGL2 backend automatically (docs/MVP/04 § 1); `?webgl` forces the fallback.
 *
 * Look (docs/MVP/05 § 6): a night game under the lights, graded like a broadcast. Two warm
 * stadium-tower key lights cast the shadows; the fill is a dim, cool moonlight, so shade reads
 * blue and lit surfaces read warm. Bloom takes the emissive surfaces (lamps, pop caps, flashes)
 * plus the hottest specular glints on chrome, so the ball and rails sparkle. ACES tone mapping
 * and a grade (filmic contrast, cool shadows, warm highlights, richer colour, a vignette) give
 * the deep blacks and saturated lamps of a modern lit pinball cabinet.
 */
export class Stage {
  readonly renderer: THREE.WebGPURenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(40, 1, 0.01, 30);
  readonly pipeline: THREE.RenderPipeline;
  readonly keyLights: THREE.DirectionalLight[] = [];
  backend = 'unknown';
  bloomEnabled = true;
  private readonly bloomPass: ReturnType<typeof bloom>;
  private readonly scenePassColor;
  private readonly scenePass: ReturnType<typeof pass>;
  private fxaaEnabled = true;
  /**
   * The grade, live-tunable (uniforms, so changing them never recompiles a shader): exposure,
   * filmic contrast around mid grey, saturation, the shadow and highlight tints, the vignette, and
   * how much of the hottest specular light reaches the bloom.
   */
  readonly grade = {
    exposure: uniform(0.88),
    contrast: uniform(1.12),
    saturation: uniform(1.08),
    shadowTint: uniform(new THREE.Vector3(0.9, 0.97, 1.12)),
    highlightTint: uniform(new THREE.Vector3(1.07, 1.0, 0.9)),
    vignette: uniform(0.42),
    sparkle: uniform(0.2),
    sparkleFrom: uniform(2.2),
  };
  private fitTarget: THREE.Object3D | null = null;
  private fitExtra: THREE.Vector3[] = [];
  private dprCap = 2;
  private maxPixels = 6e6;
  /**
   * The drawing-buffer size waiting to be applied (see `resize`), and the one last applied. Setting
   * a canvas's size, even to the same value, wipes it, so it is only done right before a draw.
   */
  private pendingSize: { w: number; h: number; pr: number } | null = null;
  private appliedSize = { w: 0, h: 0, pr: 0 };
  /** Called after every canvas resize (diagnostics). */
  onResize: ((w: number, h: number, pixelRatio: number) => void) | null = null;
  private shakeAmp = 0;
  private shakeUntil = 0;
  private shakeLength = 1;
  /** Attract-mode camera orbit, 0 (player view) to 1 (full slow orbit). */
  orbit = 0;
  private readonly orbitCenter = new THREE.Vector3();
  private orbitClock = 0;

  constructor(container: HTMLElement, forceWebGL: boolean) {
    this.container = container;
    this.renderer = // No MSAA on the canvas: the scene is drawn into the post-processing pass and only a
      // full-screen quad reaches the canvas, so a multisampled canvas just burns GPU memory.
      new THREE.WebGPURenderer({ antialias: false, forceWebGL });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, this.dprCap));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    container.appendChild(this.renderer.domElement);
    this.camera.layers.enable(BACKDROP_LAYER);

    this.scene.background = new THREE.Color(0x03050c);

    // Sky bounce: a faint navy from above, almost nothing from below, so shade stays deep.
    this.scene.add(new THREE.HemisphereLight(0x5d78c8, 0x07060a, 0.16));
    // Two "stadium tower" key lights (aimed from the towers once the stadium is built): warm
    // metal-halide white, strong enough that lit and shaded sides read clearly apart.
    for (const intensity of [3.1, 2.2]) {
      const light = new THREE.DirectionalLight(0xffe9c7, intensity);
      light.position.set(0, 1.4, 0.4);
      light.target.position.set(0.275, 0, -0.35);
      light.castShadow = true;
      light.shadow.mapSize.set(2048, 2048);
      const cam = light.shadow.camera;
      cam.left = -0.7;
      cam.right = 0.7;
      cam.top = 0.7;
      cam.bottom = -0.7;
      cam.near = 0.05;
      cam.far = 5;
      light.shadow.bias = -0.0005;
      light.shadow.radius = 2.5;
      // Redrawn once per frame (`refreshShadows`), not on every render call: three redraws an
      // auto-updating shadow map in each of the reflection cube's six renders too.
      light.shadow.autoUpdate = false;
      light.shadow.needsUpdate = true;
      this.keyLights.push(light);
      this.scene.add(light, light.target);
    }

    // A dim, cool fill from the player's side (moonlight, the scoreboard's glow), so the faces of
    // the toys turned away from the towers fall into blue shade instead of grey.
    const fill = new THREE.DirectionalLight(0x8fb0ff, 0.38);
    fill.position.set(0.275, 1.2, 1.6);
    fill.target.position.set(0.275, 0, -0.4);
    this.scene.add(fill, fill.target);

    // Selective bloom: only emissive surfaces (lamps, pop caps, flashes) glow, via an MRT
    // emissive target, so bright white plastics under the key lights stay crisp.
    // The pass is unsampled by default (a Retina-size 4x MSAA pair of 16-bit targets is ~600 MB);
    // FXAA smooths edges instead, and Ultra can turn MSAA back on.
    const scenePass = pass(this.scene, this.camera, { samples: 0 });
    this.scenePass = scenePass;
    scenePass.setMRT(mrt({ output, emissive }));
    this.scenePassColor = scenePass.getTextureNode('output');
    // The bloom's input: everything emissive, plus the part of the lit scene brighter than
    // `sparkleFrom` (the tower lights glinting off the ball and the chrome).
    const lit = this.scenePassColor.rgb;
    const glint = max(lit.sub(this.grade.sparkleFrom), vec3(0)).mul(this.grade.sparkle);
    const bloomIn = vec4(scenePass.getTextureNode('emissive').rgb.add(glint), 1);
    this.bloomPass = bloom(bloomIn, 1.25, 0.55, 0);
    this.pipeline = new THREE.RenderPipeline(this.renderer);
    this.setPost(true, true);

    // Follow the container's laid-out size. iOS Safari can report a short innerHeight while the
    // page loads (the toolbar still settling) and never fire the window resize that corrects it,
    // which left the table drawn in the top part of the screen until a reload. The observer sees
    // the box itself change; the window events are fallbacks.
    new ResizeObserver(() => this.resize()).observe(container);
    const resize = (): void => this.resize();
    window.addEventListener('resize', resize);
    window.addEventListener('orientationchange', resize);
    window.addEventListener('pageshow', resize);
    window.visualViewport?.addEventListener('resize', resize);
  }

  private readonly container: HTMLElement;

  async init(): Promise<void> {
    await this.renderer.init();
    const backend = (this.renderer as unknown as { backend: { isWebGPUBackend?: boolean } })
      .backend;
    this.backend = backend.isWebGPUBackend ? 'WebGPU' : 'WebGL2';
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(nightEnvironment(), 0.03).texture;
    this.scene.environmentIntensity = 0.8;
    this.resize();
  }

  setBloom(on: boolean): void {
    this.setPost(on, this.fxaaEnabled);
  }

  /** Rebuild the post-processing chain: optional bloom, the night grade, optional FXAA. */
  setPost(bloomOn: boolean, fxaaOn: boolean): void {
    this.bloomEnabled = bloomOn;
    this.fxaaEnabled = fxaaOn;
    const color = bloomOn ? this.scenePassColor.add(this.bloomPass) : this.scenePassColor;
    const out = vec4(nightGrade(color.rgb, this.grade), 1);
    if (fxaaOn) {
      // FXAA needs display-ready (tone-mapped, sRGB) input, so do the output transform first.
      this.pipeline.outputColorTransform = false;
      this.pipeline.outputNode = fxaa(renderOutput(out));
    } else {
      this.pipeline.outputColorTransform = true;
      this.pipeline.outputNode = out;
    }
    this.pipeline.needsUpdate = true;
  }

  /** MSAA samples for the scene pass (0 = off). */
  setMSAA(samples: 0 | 4): void {
    (this.scenePass as unknown as { options: { samples: number } }).options.samples = samples;
    this.pipeline.needsUpdate = true;
  }

  /** Point the key lights from the given world positions (the light towers). */
  aimKeyLights(from: THREE.Vector3[], at: THREE.Vector3): void {
    this.keyLights.forEach((light, i) => {
      const p = from[i];
      if (!p) return;
      light.position.copy(p);
      light.target.position.copy(at);
    });
  }

  /**
   * Apply a quality tier. `live` is for the adaptive controller stepping down in mid-game: it only
   * changes the render resolution. Switching bloom, FXAA, shadows or MSAA changes the shaders of
   * every material, and recompiling them all takes seconds on Safari (the canvas goes blank), so
   * those are set only at start-up and from the Settings menu.
   */
  applyQuality(q: Quality, live = false): void {
    this.dprCap = q.dpr;
    this.maxPixels = q.maxPixels;
    if (!live) {
      this.keyLights.forEach((light, i) => {
        const on = i < q.shadowLights;
        if (light.shadow.mapSize.x !== q.shadowMapSize) {
          light.shadow.mapSize.set(q.shadowMapSize, q.shadowMapSize);
          light.shadow.map?.dispose();
          (light.shadow as unknown as { map: unknown }).map = null;
        }
        light.castShadow = on;
      });
      this.setMSAA(q.msaa);
      if (q.bloom !== this.bloomEnabled || q.fxaa !== this.fxaaEnabled)
        this.setPost(q.bloom, q.fxaa);
    }
    this.resize();
  }

  /**
   * Frame `obj` (the tilted playfield) from the player's viewpoint, for any aspect ratio, also
   * keeping `extra` world points (the top of the backboard) in view.
   */
  fit(obj: THREE.Object3D, extra: THREE.Vector3[] = []): void {
    this.fitTarget = obj;
    this.fitExtra = extra;
    this.resize();
  }

  private resize(): void {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    // The pixel ratio is the device's, capped by the tier and by the canvas's total pixel budget.
    const budget = Math.sqrt(this.maxPixels / Math.max(1, w * h));
    const pr = Math.max(0.75, Math.min(window.devicePixelRatio, this.dprCap, budget));
    // The canvas itself is resized at the next draw (`applySize`). Resizing it here would blank it
    // for a frame: this runs from a ResizeObserver (after the frame is drawn, before it is shown)
    // and from the quality controller (after the draw), and an unchanged size still clears it.
    const a = this.appliedSize;
    if (w !== a.w || h !== a.h || pr !== a.pr) this.pendingSize = { w, h, pr };
    else this.pendingSize = null;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    if (!this.fitTarget) return;

    const box = new THREE.Box3().setFromObject(this.fitTarget);
    for (const p of this.fitExtra) box.expandByPoint(p);
    const center = box.getCenter(new THREE.Vector3());
    // Player's eye: in front of and above the apron.
    const dir = new THREE.Vector3(
      0,
      Math.sin((56 * Math.PI) / 180),
      Math.cos((56 * Math.PI) / 180),
    );
    const corners: THREE.Vector3[] = [];
    for (const x of [box.min.x, box.max.x])
      for (const y of [box.min.y, box.max.y])
        for (const z of [box.min.z, box.max.z]) corners.push(new THREE.Vector3(x, y, z));
    const fits = (d: number): boolean => {
      this.camera.position.copy(center).addScaledVector(dir, d);
      this.camera.lookAt(center);
      this.camera.updateMatrixWorld();
      return corners.every((c) => {
        const p = c.clone().project(this.camera);
        return Math.abs(p.x) <= 0.97 && Math.abs(p.y) <= 0.97 && p.z < 1;
      });
    };
    let lo = 0.2;
    let hi = 8;
    for (let i = 0; i < 30; i++) {
      const mid = (lo + hi) / 2;
      if (fits(mid)) hi = mid;
      else lo = mid;
    }
    fits(hi);
    this.orbitCenter.copy(center);
  }

  /**
   * Nudge a renderer that has stopped presenting. Soft: rebuild the post pipeline and resize the
   * canvas. Hard: also rebuild the post-processing chain's nodes from scratch.
   */
  recover(hard = false): void {
    if (hard) this.setPost(this.bloomEnabled, this.fxaaEnabled);
    this.pipeline.needsUpdate = true;
    // Force the canvas to be reconfigured at the next draw, even at the same size.
    this.appliedSize = { w: 0, h: 0, pr: 0 };
    this.resize();
  }

  /** Apply a pending canvas resize; called right before drawing, so the cleared canvas is redrawn. */
  private applySize(): void {
    const s = this.pendingSize;
    if (!s) return;
    this.pendingSize = null;
    this.appliedSize = s;
    // Drawing-buffer size only: CSS sizes the canvas, so a stale size can't pin it smaller.
    this.renderer.setDrawingBufferSize(s.w, s.h, s.pr);
    this.onResize?.(s.w, s.h, s.pr);
  }

  /**
   * Redraw the key lights' shadow maps at the next render. Called once a frame, right before the
   * main draw (after the ball's reflection), so the reflection reuses the last frame's maps.
   */
  refreshShadows(): void {
    for (const light of this.keyLights) light.shadow.needsUpdate = true;
  }

  /** The WebGPU device, if that is the backend in use. */
  get gpuDevice(): GPUDevice | undefined {
    return (this.renderer as unknown as { backend: { device?: GPUDevice } }).backend.device;
  }

  /** A small camera shake (nudges); off under reduced motion. */
  shake(amount: number, seconds = 0.18): void {
    this.shakeAmp = Math.max(this.shakeAmp, amount);
    this.shakeUntil = performance.now() + seconds * 1000;
    this.shakeLength = seconds * 1000;
  }

  /**
   * Compile every shader once, up front. Objects that only show up in play (runners, the ball,
   * effects) would otherwise compile the first time they appear, and on Safari that can stall the
   * GPU for a second right in the middle of a game. Everything is switched on for one real frame,
   * then put back. It is one synchronous block (never spread over frames: a frame that is skipped
   * leaves the canvas empty, which the watchdog reads as a dead renderer). Returns the ms taken.
   */
  warmUp(): number {
    const t0 = performance.now();
    const hidden: THREE.Object3D[] = [];
    this.scene.traverse((o) => {
      if (!o.visible) {
        hidden.push(o);
        o.visible = true;
      }
    });
    try {
      this.applySize();
      this.pipeline.render();
    } finally {
      for (const o of hidden) o.visible = false;
    }
    return performance.now() - t0;
  }

  /** Draw a frame; `dt` (s) since the last one drives the attract orbit (frames are paced). */
  render(dt = 1 / 60): void {
    this.applySize();
    if (this.orbit > 0.001) {
      // A slow sway around the table for attract mode; dead-ball only (docs/MVP/05 § 7).
      this.orbitClock += dt;
      const saved = this.camera.position.clone();
      const yaw = Math.sin(this.orbitClock * 0.15) * 0.3 * this.orbit;
      const offset = saved.clone().sub(this.orbitCenter);
      offset.applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
      offset.multiplyScalar(1 + 0.08 * this.orbit);
      this.camera.position.copy(this.orbitCenter).add(offset);
      this.camera.lookAt(this.orbitCenter);
      this.pipeline.render();
      this.camera.position.copy(saved);
      this.camera.lookAt(this.orbitCenter);
      return;
    }
    const left = this.shakeUntil - performance.now();
    if (left > 0) {
      const k = (left / this.shakeLength) * this.shakeAmp;
      const saved = this.camera.position.clone();
      this.camera.position.x += (Math.random() * 2 - 1) * k;
      this.camera.position.y += (Math.random() * 2 - 1) * k * 0.6;
      this.pipeline.render();
      this.camera.position.copy(saved);
      return;
    }
    this.shakeAmp = 0;
    this.pipeline.render();
  }
}

/**
 * The night-game grade, in linear light before tone mapping: exposure, a filmic contrast curve
 * pivoting on mid grey (deeper shade, brighter lights), a split tone (cool shadows, warm
 * highlights), extra saturation, and an oval vignette that pulls the eye to the playfield.
 */
function nightGrade(rgbIn: THREE.Node<'vec3'>, g: Stage['grade']): THREE.Node<'vec3'> {
  const exposed = rgbIn.mul(g.exposure);
  const contrasted = max(exposed.div(0.18), vec3(1e-5)).pow(vec3(g.contrast)).mul(0.18);
  const l = luminance(contrasted);
  const tint = mix(g.shadowTint, g.highlightTint, smoothstep(0.02, 0.7, l));
  const toned = saturation(contrasted.mul(tint), g.saturation);
  // Oval (wider than tall), darker at the corners.
  const d = screenUV.sub(0.5).mul(vec2(1.15, 1)).length();
  const vignette = float(1).sub(smoothstep(0.32, 0.9, d).mul(g.vignette));
  return toned.mul(vignette);
}

/**
 * Image-based lighting for a night game: a dark sky bowl, two banks of tower lights high on
 * either side, a faint glow from the stands and dim field below. Reflections on the clear coat and
 * chrome then show darkness and bright tower lights, as they would in a ballpark, rather than a
 * bright studio.
 */
function nightEnvironment(): THREE.Scene {
  const env = new THREE.Scene();
  const bowl = new THREE.Mesh(
    new THREE.SphereGeometry(10, 32, 16),
    new THREE.MeshBasicMaterial({ color: 0x050914, side: THREE.BackSide }),
  );
  env.add(bowl);
  // `boost` > 1 makes a panel brighter than white (HDR), like a real light source.
  const panel = (
    color: number,
    w: number,
    h: number,
    pos: [number, number, number],
    boost = 1,
  ): void => {
    const c = new THREE.Color(color).multiplyScalar(boost);
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({ color: c, side: THREE.DoubleSide }),
    );
    m.position.set(...pos);
    m.lookAt(0, 0, 0);
    env.add(m);
  };
  // Tower light banks (very bright, warm), the near pair dimmer.
  panel(0xffe8c0, 2.2, 1.0, [-5, 5, -4], 9);
  panel(0xffe8c0, 2.2, 1.0, [5, 5, -4], 9);
  panel(0xd8b88a, 1.2, 0.6, [-6, 3.5, 3], 4);
  panel(0xd8b88a, 1.2, 0.6, [6, 3.5, 3], 4);
  // A long, soft strip high behind the backboard (the light-tower haze over the outfield): the
  // clear coat mirrors it as a sheen across the upper playfield, and chrome as a bright band.
  panel(0xdde4ff, 7, 0.7, [0, 3.2, -7], 1.6);
  // The stands catching some light (a cool navy), and the dark field below.
  panel(0x18203a, 14, 2.2, [0, 1.6, -8]);
  panel(0x081a0e, 14, 14, [0, -6, 0]);
  return env;
}
