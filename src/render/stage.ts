import * as THREE from 'three/webgpu';
import { emissive, mrt, output, pass, saturation, screenUV, smoothstep, vec4 } from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import type { Quality } from './quality';

/**
 * Renderer, scene, lights, camera and post-processing. WebGPU when available, otherwise Three.js
 * falls back to its WebGL2 backend automatically (docs/MVP/04 § 1); `?webgl` forces the fallback.
 *
 * Look (docs/MVP/05 § 6): two stadium-tower key lights casting soft shadows, a dim cool fill,
 * selective bloom on emissive surfaces only, AgX tone mapping and a night-game grade (a touch more
 * saturation and a soft vignette).
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
  private fitTarget: THREE.Object3D | null = null;
  private fitExtra: THREE.Vector3[] = [];
  private dprCap = 2;
  private maxPixels = 6e6;
  private shakeAmp = 0;
  private shakeUntil = 0;
  private shakeLength = 1;
  /** Attract-mode camera orbit, 0 (player view) to 1 (full slow orbit). */
  orbit = 0;
  private readonly orbitCenter = new THREE.Vector3();
  private orbitClock = 0;

  constructor(container: HTMLElement, forceWebGL: boolean) {
    this.renderer = new THREE.WebGPURenderer({ antialias: true, forceWebGL });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, this.dprCap));
    this.renderer.toneMapping = THREE.AgXToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    container.appendChild(this.renderer.domElement);

    this.scene.background = new THREE.Color(0x070a14);

    this.scene.add(new THREE.HemisphereLight(0x9fb4ff, 0x140f0c, 0.28));
    // Two "stadium tower" key lights (aimed from the towers once the stadium is built).
    for (const intensity of [2.3, 1.7]) {
      const light = new THREE.DirectionalLight(0xfff1d6, intensity);
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
      light.shadow.radius = 3;
      this.keyLights.push(light);
      this.scene.add(light, light.target);
    }

    // A soft fill from the player's side, standing in for the cabinet's GI lighting the toys.
    const fill = new THREE.DirectionalLight(0xffe6c4, 0.55);
    fill.position.set(0.275, 1.2, 1.6);
    fill.target.position.set(0.275, 0, -0.4);
    this.scene.add(fill, fill.target);

    // Selective bloom: only emissive surfaces (lamps, pop caps, flashes) glow, via an MRT
    // emissive target, so bright white plastics under the key lights stay crisp.
    const scenePass = pass(this.scene, this.camera);
    scenePass.setMRT(mrt({ output, emissive }));
    this.scenePassColor = scenePass.getTextureNode('output');
    this.bloomPass = bloom(scenePass.getTextureNode('emissive'), 1.1, 0.4, 0);
    this.pipeline = new THREE.RenderPipeline(this.renderer);
    this.setBloom(true);

    window.addEventListener('resize', () => this.resize());
  }

  async init(): Promise<void> {
    await this.renderer.init();
    const backend = (this.renderer as unknown as { backend: { isWebGPUBackend?: boolean } })
      .backend;
    this.backend = backend.isWebGPUBackend ? 'WebGPU' : 'WebGL2';
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(nightEnvironment(), 0.03).texture;
    this.scene.environmentIntensity = 0.9;
    this.resize();
  }

  setBloom(on: boolean): void {
    this.bloomEnabled = on;
    const color = on ? this.scenePassColor.add(this.bloomPass) : this.scenePassColor;
    // Night grade: +8 % saturation and a soft vignette.
    const graded = saturation(color.rgb, 1.08);
    const vignette = smoothstep(0.85, 0.35, screenUV.sub(0.5).length()).mul(0.22).add(0.78);
    this.pipeline.outputNode = vec4(graded.mul(vignette), 1);
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

  applyQuality(q: Quality): void {
    this.dprCap = q.dpr;
    this.maxPixels = q.maxPixels;
    this.keyLights.forEach((light, i) => {
      const on = i < q.shadowLights;
      if (light.shadow.mapSize.x !== q.shadowMapSize) {
        light.shadow.mapSize.set(q.shadowMapSize, q.shadowMapSize);
        light.shadow.map?.dispose();
        (light.shadow as unknown as { map: unknown }).map = null;
      }
      light.castShadow = on;
    });
    if (q.bloom !== this.bloomEnabled) this.setBloom(q.bloom);
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
    const w = window.innerWidth;
    const h = window.innerHeight;
    // The pixel ratio is the device's, capped by the tier and by the canvas's total pixel budget.
    const budget = Math.sqrt(this.maxPixels / Math.max(1, w * h));
    this.renderer.setPixelRatio(
      Math.max(0.75, Math.min(window.devicePixelRatio, this.dprCap, budget)),
    );
    this.renderer.setSize(w, h);
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

  /** Nudge a renderer that has stopped presenting: rebuild the post pipeline and the canvas. */
  recover(): void {
    this.pipeline.needsUpdate = true;
    this.resize();
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

  render(): void {
    if (this.orbit > 0.001) {
      // A slow sway around the table for attract mode; dead-ball only (docs/MVP/05 § 7).
      this.orbitClock += 1 / 60;
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
 * Image-based lighting for a night game: a dark sky bowl, two banks of tower lights high on
 * either side, a faint glow from the stands and dim field below. Reflections on the clear coat and
 * chrome then show darkness and bright tower lights, as they would in a ballpark, rather than a
 * bright studio.
 */
function nightEnvironment(): THREE.Scene {
  const env = new THREE.Scene();
  const bowl = new THREE.Mesh(
    new THREE.SphereGeometry(10, 32, 16),
    new THREE.MeshBasicMaterial({ color: 0x0a1020, side: THREE.BackSide }),
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
  // Tower light banks (very bright, warm).
  panel(0xfff0d0, 2.2, 1.0, [-5, 5, -4], 6);
  panel(0xfff0d0, 2.2, 1.0, [5, 5, -4], 6);
  panel(0xc8b48c, 1.2, 0.6, [-6, 3.5, 3], 3);
  panel(0xc8b48c, 1.2, 0.6, [6, 3.5, 3], 3);
  // The stands catching some light, and the field below.
  panel(0x1c2236, 14, 2.2, [0, 1.6, -8]);
  panel(0x10301a, 14, 14, [0, -6, 0]);
  return env;
}
