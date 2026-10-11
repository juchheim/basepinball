import * as THREE from 'three/webgpu';
import { Rng } from '../core/rng';
import { Particles, type Palette } from '../fx/particles';
import type { GameSnapshot } from '../rules/types';

/**
 * The ballpark beyond the playfield and the cabinet around it (docs/MVP/05 § 2): backboard with
 * the outfield wall, a live LED scoreboard, light towers, stands with an instanced crowd, and a
 * night sky; plus wood side rails, the lockdown bar and the apron. Built in playfield metres
 * (z up) and tilted with the table.
 */

const W = 0.59;
const L = 1.17;

export class Stadium {
  readonly group = new THREE.Group();
  /** Tower light heads in playfield coordinates, for aiming the key lights. */
  readonly towerHeads: THREE.Vector3[] = [
    new THREE.Vector3(-0.1, L + 0.12, 0.62),
    new THREE.Vector3(W + 0.1, L + 0.12, 0.62),
  ];
  private readonly scoreboard: {
    canvas: HTMLCanvasElement;
    ctx: CanvasRenderingContext2D;
    texture: THREE.CanvasTexture;
  };
  private lastBoard = '';
  private crowd: THREE.InstancedMesh | null = null;
  private crowdBase: THREE.Matrix4[] = [];
  /** Crowd excitement (0-1): fans bounce, decaying back to a murmur. */
  private energy = 0;
  private clock = 0;
  private message: { text: string; sub: string; color: string; until: number } | null = null;
  private readonly towerLamp = new THREE.MeshStandardMaterial({
    color: 0xfff4dc,
    emissive: new THREE.Color(0xfff4dc),
    emissiveIntensity: 3,
  });
  private towerLevel = 1;
  private towerTarget = 1;
  /** Fireworks over the backboard (docs/MVP/05 § 9). */
  readonly particles = new Particles(500);
  private readonly launches: {
    at: number;
    x: number;
    z: number;
    palette: Palette;
    onBoom?: () => void;
  }[] = [];

  constructor(title: string) {
    this.buildCabinet();
    this.buildBackboard();
    this.buildTowers();
    this.buildSky();
    this.group.add(this.particles.group);
    const canvas = document.createElement('canvas');
    canvas.width = 1024;
    canvas.height = 256;
    const ctx = canvas.getContext('2d')!;
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    this.scoreboard = { canvas, ctx, texture };
    const board = new THREE.Mesh(
      new THREE.PlaneGeometry(0.34, 0.085),
      new THREE.MeshStandardMaterial({
        map: texture,
        emissiveMap: texture,
        emissive: new THREE.Color(0xffffff),
        emissiveIntensity: 0.9,
        roughness: 0.6,
      }),
    );
    board.rotation.x = Math.PI / 2;
    board.position.set(W / 2, L + 0.004, 0.2);
    this.group.add(board);
    const frame = new THREE.Mesh(
      new THREE.BoxGeometry(0.36, 0.012, 0.1),
      new THREE.MeshStandardMaterial({ color: 0x1b2a4a, roughness: 0.5 }),
    );
    frame.position.set(W / 2, L + 0.011, 0.2);
    this.group.add(frame);
    this.drawScoreboard(null, title);
  }

  /** Size the crowd for the quality tier. */
  setCrowd(count: number): void {
    if (this.crowd) {
      this.group.remove(this.crowd);
      this.crowd.geometry.dispose();
    }
    const rng = new Rng(42);
    const geo = new THREE.PlaneGeometry(0.007, 0.011);
    geo.rotateX(Math.PI / 2);
    const mat = new THREE.MeshStandardMaterial({
      roughness: 0.9,
      emissive: new THREE.Color(0x222222),
    });
    const mesh = new THREE.InstancedMesh(geo, mat, count);
    this.crowdBase = [];
    const m = new THREE.Matrix4();
    const shirts = [0x1b2a4a, 0xf4efe1, 0xc9ced6, 0xf2b33d, 0x8a2b2b, 0x2e6b34, 0x3d8bfd, 0x555b66];
    const color = new THREE.Color();
    for (let i = 0; i < count; i++) {
      // Rows of seats rising away from the field, in a bowl around the backboard.
      const row = Math.floor(rng.next() * 14);
      const x = -0.25 + rng.next() * (W + 0.5);
      const y = L + 0.06 + row * 0.022 + Math.abs(x - W / 2) * 0.15;
      const z = 0.27 + row * 0.018 + rng.range(0, 0.004);
      m.makeTranslation(x, y, z);
      mesh.setMatrixAt(i, m);
      this.crowdBase.push(m.clone());
      mesh.setColorAt(i, color.setHex(shirts[Math.floor(rng.next() * shirts.length)]!));
    }
    this.crowd = mesh;
    this.group.add(mesh);
  }

  /** Redraw the LED scoreboard when the game state changes. */
  update(g: GameSnapshot | null, title: string): void {
    if (this.message && this.clock > this.message.until) this.message = null;
    this.drawScoreboard(g, title);
  }

  /** A big scoreboard message ("HOME RUN", "K") over the line score for a while. */
  showMessage(text: string, sub: string, color: string, seconds: number): void {
    this.message = { text, sub, color, until: this.clock + seconds };
    this.lastBoard = '';
  }

  /** Make the crowd jump (0-1); it settles back over a few seconds. */
  excite(level: number): void {
    this.energy = Math.max(this.energy, Math.min(1, level));
  }

  /** The light towers: off (attract dark), or on with a warm-up flicker. */
  setTowers(on: boolean): void {
    this.towerTarget = on ? 1 : 0.08;
    if (!on) this.towerLevel = 0.08;
  }

  /** Launch `count` fireworks over the backboard; `onBoom` fires as each one bursts. */
  fireworks(count: number, onLaunch?: () => void, onBoom?: () => void): void {
    const palettes: Palette[] = ['gold', 'red', 'white', 'blue', 'teal', 'violet'];
    for (let i = 0; i < count; i++) {
      const delay = i * (0.35 + Math.random() * 0.25);
      // Over the stands either side of the scoreboard (the HUD sits over the middle), just
      // clearing the top of the backboard.
      const side = i % 2 === 0 ? -1 : 1;
      const x = W / 2 + side * (0.12 + Math.random() * 0.14);
      const z = 0.29 + Math.random() * 0.06;
      const palette = palettes[Math.floor(Math.random() * palettes.length)]!;
      this.launches.push({ at: this.clock + delay, x, z, palette, ...(onBoom ? { onBoom } : {}) });
      if (onLaunch)
        this.launches.push({
          at: this.clock + delay - 0.001,
          x: -1,
          z: 0,
          palette,
          onBoom: onLaunch,
        });
    }
  }

  /** Per-frame animation: crowd, towers, fireworks. */
  tick(dt: number): void {
    this.clock += dt;
    // Fireworks: a rising spark, then a burst at the top.
    for (let i = this.launches.length - 1; i >= 0; i--) {
      const l = this.launches[i]!;
      if (this.clock < l.at) continue;
      this.launches.splice(i, 1);
      if (l.x < 0) {
        l.onBoom?.();
        continue;
      }
      const rise = 0.55;
      const startZ = 0.16;
      this.particles.burst({
        at: { x: l.x, y: L + 0.03, z: startZ },
        count: 1,
        palette: 'white',
        speed: [0, 0],
        bias: { x: 0, y: 0, z: (l.z - startZ) / rise + 0.5 * 0.6 * rise },
        life: [rise, rise],
        size: 0.004,
        gravity: { x: 0, y: 0, z: -0.6 },
      });
      this.launches.push({
        at: this.clock + rise,
        x: -1,
        z: 0,
        palette: l.palette,
        onBoom: () => {
          this.particles.burst({
            at: { x: l.x, y: L + 0.03, z: l.z },
            count: 70,
            palette: l.palette,
            speed: [0.07, 0.13],
            life: [0.9, 1.5],
            size: 0.0035,
            gravity: { x: 0, y: 0, z: -0.12 },
            drag: 1.2,
          });
          l.onBoom?.();
        },
      });
    }
    this.particles.update(dt);

    // Towers warm up like big bulbs, with a flicker on the way.
    if (this.towerLevel !== this.towerTarget) {
      const step = dt * (this.towerTarget > this.towerLevel ? 0.8 : 3);
      this.towerLevel =
        this.towerTarget > this.towerLevel
          ? Math.min(this.towerTarget, this.towerLevel + step)
          : Math.max(this.towerTarget, this.towerLevel - step);
      const flicker = this.towerLevel < 0.6 && Math.random() < 0.15 ? 0.5 : 1;
      this.towerLamp.emissiveIntensity = 3 * this.towerLevel * flicker;
    }

    // The crowd bounces with excitement, each fan on their own rhythm.
    const crowd = this.crowd;
    if (crowd && (this.energy > 0.005 || this.wasBouncing)) {
      const m = new THREE.Matrix4();
      const e = this.energy;
      for (let i = 0; i < this.crowdBase.length; i++) {
        const base = this.crowdBase[i]!;
        const phase = (i * 0.618) % 1;
        const hop =
          e > 0.005
            ? Math.max(0, Math.sin(this.clock * (5 + phase * 3) + phase * 6.28)) * 0.005 * e
            : 0;
        m.copy(base);
        m.elements[14] += hop;
        crowd.setMatrixAt(i, m);
      }
      crowd.instanceMatrix.needsUpdate = true;
      this.wasBouncing = e > 0.005;
      this.energy = Math.max(0, this.energy - dt * 0.25);
    }
  }

  private wasBouncing = false;

  private drawScoreboard(g: GameSnapshot | null, title: string): void {
    const key = g
      ? `${g.inning}|${g.outs}|${g.stats.runsByInning.join(',')}|${g.stats.hits}|${g.bases.join()}|${g.state}`
      : `title:${title}`;
    const msg = this.message;
    if (msg) {
      if (this.lastBoard === `msg:${msg.text}`) return;
      this.lastBoard = `msg:${msg.text}`;
      const { ctx, canvas, texture } = this.scoreboard;
      ctx.fillStyle = '#05070d';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#0c1220';
      for (let y = 4; y < canvas.height; y += 8)
        for (let x = 4; x < canvas.width; x += 8) ctx.fillRect(x, y, 3, 3);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = msg.color;
      ctx.font = 'bold 120px Oswald, "Arial Narrow", Arial, sans-serif';
      ctx.fillText(msg.text, canvas.width / 2, msg.sub ? 105 : 128);
      if (msg.sub) {
        ctx.fillStyle = '#f4f1e8';
        ctx.font = 'bold 40px Oswald, "Arial Narrow", Arial, sans-serif';
        ctx.fillText(msg.sub, canvas.width / 2, 205);
      }
      texture.needsUpdate = true;
      return;
    }
    if (key === this.lastBoard) return;
    this.lastBoard = key;
    const { ctx, canvas, texture } = this.scoreboard;
    ctx.fillStyle = '#05070d';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    // LED dot grid.
    ctx.fillStyle = '#0c1220';
    for (let y = 4; y < canvas.height; y += 8)
      for (let x = 4; x < canvas.width; x += 8) ctx.fillRect(x, y, 3, 3);
    ctx.font = 'bold 40px Oswald, "Arial Narrow", Arial, sans-serif';
    ctx.textBaseline = 'middle';
    if (!g) {
      ctx.fillStyle = '#f2b33d';
      ctx.textAlign = 'center';
      ctx.font = 'bold 96px Oswald, "Arial Narrow", Arial, sans-serif';
      ctx.fillText(title.toUpperCase(), canvas.width / 2, 110);
      ctx.font = 'bold 34px Oswald, "Arial Narrow", Arial, sans-serif';
      ctx.fillStyle = '#f4f1e8';
      ctx.fillText('PLUNGER PARK · TILT CITY SILVERBALLS', canvas.width / 2, 200);
      texture.needsUpdate = true;
      return;
    }
    ctx.textAlign = 'center';
    const col = (i: number) => 230 + i * 68;
    ctx.fillStyle = '#9aa6c4';
    for (let i = 0; i < 9; i++) ctx.fillText(String(i + 1), col(i), 50);
    ctx.fillText('R', col(9) + 20, 50);
    ctx.fillText('H', col(10) + 20, 50);
    ctx.textAlign = 'left';
    ctx.fillStyle = '#f4f1e8';
    ctx.fillText('SILVERBALLS', 22, 118);
    ctx.textAlign = 'center';
    for (let i = 0; i < 9; i++) {
      const runs = g.stats.runsByInning[i];
      ctx.fillStyle = i + 1 === g.inning ? '#f2b33d' : '#f4f1e8';
      ctx.fillText(runs === undefined ? '' : String(runs), col(i), 118);
    }
    ctx.fillStyle = '#f2b33d';
    ctx.fillText(String(g.stats.runs), col(9) + 20, 118);
    ctx.fillText(String(g.stats.hits), col(10) + 20, 118);
    // Outs and the at-bat line.
    ctx.textAlign = 'left';
    ctx.fillStyle = '#9aa6c4';
    ctx.fillText('OUT', 22, 196);
    for (let i = 0; i < 3; i++) {
      ctx.beginPath();
      ctx.arc(120 + i * 40, 196, 13, 0, Math.PI * 2);
      ctx.fillStyle = i < g.outs ? '#ff3b3b' : '#1a1f2c';
      ctx.fill();
    }
    ctx.fillStyle = '#f4f1e8';
    const onBase = ['1ST', '2ND', '3RD'].filter((_, i) => g.bases[i]).join(' · ');
    ctx.fillText(
      onBase ? `ON BASE: ${onBase}` : g.state === 'INNING_BREAK' ? 'SIDE RETIRED' : 'BASES EMPTY',
      300,
      196,
    );
    texture.needsUpdate = true;
  }

  private buildCabinet(): void {
    const wood = new THREE.MeshPhysicalMaterial({
      color: 0x3b2416,
      roughness: 0.5,
      metalness: 0,
      clearcoat: 0.8,
      clearcoatRoughness: 0.2,
    });
    const chrome = new THREE.MeshStandardMaterial({
      color: 0xe6e9ee,
      roughness: 0.12,
      metalness: 1,
    });
    for (const x of [-0.016, W + 0.016]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(0.03, L + 0.06, 0.07), wood);
      rail.position.set(x, L / 2, 0.02);
      rail.castShadow = true;
      rail.receiveShadow = true;
      this.group.add(rail);
      const trim = new THREE.Mesh(new THREE.BoxGeometry(0.006, L + 0.06, 0.004), chrome);
      trim.position.set(x < 0 ? x + 0.012 : x - 0.012, L / 2, 0.056);
      this.group.add(trim);
    }
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, W + 0.06, 24), chrome);
    bar.rotation.z = Math.PI / 2;
    bar.position.set(W / 2, -0.03, 0.05);
    this.group.add(bar);
    const front = new THREE.Mesh(new THREE.BoxGeometry(W + 0.06, 0.03, 0.07), wood);
    front.position.set(W / 2, -0.03, 0.01);
    this.group.add(front);
    // Apron: printed metal over the bottom of the playfield, where the ball drains away.
    const apron = new THREE.Mesh(
      new THREE.BoxGeometry(0.55, 0.036, 0.004),
      new THREE.MeshStandardMaterial({ color: 0x1a2036, roughness: 0.35, metalness: 0.4 }),
    );
    apron.position.set(0.275, 0.018, 0.028);
    apron.castShadow = true;
    this.group.add(apron);
  }

  private buildBackboard(): void {
    const canvas = document.createElement('canvas');
    canvas.width = 1024;
    canvas.height = 512;
    const ctx = canvas.getContext('2d')!;
    const sky = ctx.createLinearGradient(0, 0, 0, canvas.height);
    sky.addColorStop(0, '#05070f');
    sky.addColorStop(0.6, '#141b33');
    sky.addColorStop(1, '#22304f');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    // Light haze from the towers.
    for (const x of [90, 934]) {
      const glow = ctx.createRadialGradient(x, 80, 10, x, 80, 420);
      glow.addColorStop(0, 'rgba(255,244,220,0.35)');
      glow.addColorStop(1, 'rgba(255,244,220,0)');
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    // Outfield wall: padded green with the yellow home-run line, distance markers.
    ctx.fillStyle = '#1f4d2a';
    ctx.fillRect(0, 392, canvas.width, 120);
    ctx.fillStyle = '#f2b33d';
    ctx.fillRect(0, 392, canvas.width, 6);
    ctx.fillStyle = '#f4f1e8';
    ctx.font = 'bold 44px Oswald, "Arial Narrow", Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('330', 120, 470);
    ctx.fillText('375', 330, 470);
    ctx.fillText('400', 512, 470);
    ctx.fillText('375', 694, 470);
    ctx.fillText('330', 904, 470);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    const board = new THREE.Mesh(
      new THREE.PlaneGeometry(W + 0.03, 0.3),
      // Backboard art is lit from behind like a translite.
      new THREE.MeshStandardMaterial({
        map: tex,
        emissiveMap: tex,
        emissive: new THREE.Color(0xffffff),
        emissiveIntensity: 0.45,
        roughness: 0.8,
      }),
    );
    board.rotation.x = Math.PI / 2;
    board.position.set(W / 2, L + 0.012, 0.15);
    board.receiveShadow = true;
    this.group.add(board);
  }

  private buildTowers(): void {
    const steel = new THREE.MeshStandardMaterial({
      color: 0x3a4152,
      roughness: 0.5,
      metalness: 0.7,
    });
    const lamp = this.towerLamp;
    for (const head of this.towerHeads) {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.009, head.z, 10), steel);
      pole.rotation.x = Math.PI / 2;
      pole.position.set(head.x, head.y, head.z / 2);
      this.group.add(pole);
      const bank = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.012, 0.05), steel);
      bank.position.copy(head);
      bank.lookAt(new THREE.Vector3(W / 2, L / 2, 0));
      this.group.add(bank);
      for (let i = 0; i < 6; i++) {
        const bulb = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.004, 0.012), lamp);
        bulb.position.set(-0.033 + (i % 3) * 0.033, -0.008, i < 3 ? 0.012 : -0.012);
        bank.add(bulb);
      }
    }
  }

  private buildSky(): void {
    // Stands: stepped concrete tiers behind the backboard.
    const concrete = new THREE.MeshStandardMaterial({ color: 0x2a3142, roughness: 0.9 });
    for (let row = 0; row < 7; row++) {
      const tier = new THREE.Mesh(new THREE.BoxGeometry(W + 0.6, 0.044, 0.04), concrete);
      tier.position.set(W / 2, L + 0.07 + row * 0.044, 0.24 + row * 0.036);
      this.group.add(tier);
    }
    // A distant star field.
    const rng = new Rng(9);
    const stars = new Float32Array(600 * 3);
    for (let i = 0; i < 600; i++) {
      stars[i * 3] = -1.5 + rng.next() * (W + 3);
      stars[i * 3 + 1] = L + 1.2 + rng.next() * 0.6;
      stars[i * 3 + 2] = 0.6 + rng.next() * 1.6;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(stars, 3));
    this.group.add(
      new THREE.Points(
        g,
        new THREE.PointsMaterial({ color: 0xc9d6ff, size: 2, sizeAttenuation: false }),
      ),
    );
  }
}
