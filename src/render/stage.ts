import * as THREE from 'three/webgpu';
import { emissive, mrt, output, pass } from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

/**
 * Renderer, scene, lights and camera. WebGPU when available, otherwise Three.js falls back to
 * its WebGL2 backend automatically (docs/MVP/04 § 1). `?webgl` forces the fallback for testing.
 */
export class Stage {
  readonly renderer: THREE.WebGPURenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(40, 1, 0.01, 20);
  readonly pipeline: THREE.RenderPipeline;
  backend = 'unknown';
  bloomEnabled = true;
  private readonly bloomPass: ReturnType<typeof bloom>;
  private readonly scenePassColor;
  private fitTarget: THREE.Object3D | null = null;

  constructor(container: HTMLElement, forceWebGL: boolean) {
    this.renderer = new THREE.WebGPURenderer({ antialias: true, forceWebGL });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.AgXToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    container.appendChild(this.renderer.domElement);

    this.scene.background = new THREE.Color(0x0b1020);

    const hemi = new THREE.HemisphereLight(0xdfe8ff, 0x1a1410, 0.6);
    this.scene.add(hemi);
    // Two "stadium tower" key lights, left and right, casting soft shadows.
    for (const [x, intensity] of [
      [-0.6, 1.6],
      [1.2, 1.2],
    ] as const) {
      const light = new THREE.DirectionalLight(0xfff4dc, intensity);
      light.position.set(x, 1.4, 0.4);
      light.target.position.set(0.275, 0, -0.35);
      light.castShadow = true;
      light.shadow.mapSize.set(2048, 2048);
      const cam = light.shadow.camera;
      cam.left = -0.6;
      cam.right = 0.6;
      cam.top = 0.6;
      cam.bottom = -0.6;
      cam.near = 0.1;
      cam.far = 4;
      light.shadow.bias = -0.0005;
      light.shadow.radius = 3;
      this.scene.add(light, light.target);
    }

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
    const backend = (this.renderer as unknown as { backend: { isWebGPUBackend?: boolean } }).backend;
    this.backend = backend.isWebGPUBackend ? 'WebGPU' : 'WebGL2';
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.6;
    this.resize();
  }

  setBloom(on: boolean): void {
    this.bloomEnabled = on;
    this.pipeline.outputNode = on ? this.scenePassColor.add(this.bloomPass) : this.scenePassColor;
    this.pipeline.needsUpdate = true;
  }

  /** Frame `obj` (the tilted playfield) from the player's viewpoint, for any aspect ratio. */
  fit(obj: THREE.Object3D): void {
    this.fitTarget = obj;
    this.resize();
  }

  private resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    if (!this.fitTarget) return;

    const box = new THREE.Box3().setFromObject(this.fitTarget);
    const center = box.getCenter(new THREE.Vector3());
    // Player's eye: in front of and above the apron.
    const dir = new THREE.Vector3(0, Math.sin((58 * Math.PI) / 180), Math.cos((58 * Math.PI) / 180));
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
        return Math.abs(p.x) <= 0.96 && Math.abs(p.y) <= 0.96 && p.z < 1;
      });
    };
    let lo = 0.2;
    let hi = 6;
    for (let i = 0; i < 30; i++) {
      const mid = (lo + hi) / 2;
      if (fits(mid)) hi = mid;
      else lo = mid;
    }
    fits(hi);
  }

  render(): void {
    this.pipeline.render();
  }
}
