import * as THREE from 'three/webgpu';
import {
  abs,
  dot,
  exp,
  float,
  instancedBufferAttribute,
  instanceIndex,
  normalView,
  positionLocal,
  positionViewDirection,
  pow,
  sin,
  uniform,
  uv,
  vec3,
} from 'three/tsl';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { BRAND } from '../app/brand';
import { Rng } from '../core/rng';
import { Particles, type Palette } from '../fx/particles';
import { toBackdrop } from './layers';
import type { GameSnapshot } from '../rules/types';

/**
 * The ballpark beyond the playfield and the cabinet around it (docs/MVP/05 § 2): backboard with
 * the outfield wall, a live LED scoreboard, light towers, stands with an instanced crowd, and a
 * night sky; plus the cabinet's side rails, the lockdown bar and the apron. Built in playfield
 * metres (z up) and tilted with the table.
 *
 * Look: a broadcast night game. Everything is dark navy except what the lights touch: tower banks
 * burning white with shafts of light falling from them, a bulb marquee chasing round the
 * scoreboard, concourse lights along the tiers, and camera flashes popping in the crowd (more of
 * them the louder the crowd gets).
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
    emissiveIntensity: 6,
  });
  private towerLevel = 1;
  private towerTarget = 1;
  /** Seconds, for the marquee chase. */
  private readonly time = uniform(0);
  /** Marquee brightness: idle chase, brighter while a message is up. */
  private readonly marquee = uniform(1);
  /** Strength of the light shafts from the towers (follows the towers). */
  private readonly beamLevel = uniform(1);
  /** Camera flashes in the crowd. Off under reduced motion (no flashing). */
  flashesEnabled = true;
  private flashes: THREE.InstancedMesh | null = null;
  private readonly flashLife: number[] = [];
  private flashBudget = 0;
  private backboardTexture: THREE.CanvasTexture | null = null;
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
    this.buildGround();
    this.buildBackboard();
    this.buildTowers();
    this.buildSky();
    // The ball's reflection sees the cabinet, backboard, scoreboard, marquee and tower lamps; the
    // rest of the ballpark is on the backdrop layer, which it skips (see `layers.ts`).
    this.group.add(toBackdrop(this.particles.group));
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
        color: 0x000000,
        emissiveMap: texture,
        emissive: new THREE.Color(0xffffff),
        emissiveIntensity: 1.25,
        roughness: 0.3,
      }),
    );
    board.rotation.x = Math.PI / 2;
    board.position.set(W / 2, L + 0.004, 0.2);
    this.group.add(board);
    const frame = new THREE.Mesh(
      new THREE.BoxGeometry(0.36, 0.012, 0.11),
      new THREE.MeshStandardMaterial({ color: 0x10182c, roughness: 0.35, metalness: 0.6 }),
    );
    frame.position.set(W / 2, L + 0.011, 0.2);
    this.group.add(frame);
    this.buildMarquee();
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
    const mat = new THREE.MeshStandardNodeMaterial({
      roughness: 0.8,
      emissive: new THREE.Color(0x141414),
    });
    // The bounce and the wave run on the GPU (docs/MVP/efficiency-audit F8): each fan hops on their
    // own rhythm (`phase`, from the instance index) as excited as `crowdEnergy`, and rises as the
    // wave's front passes their seat (`seatX`, the fan's x). The instance matrices never change.
    const seatX = new Float32Array(count);
    const phase = float(instanceIndex).mul(0.618).fract();
    const hop = sin(this.time.mul(phase.mul(3).add(5)).add(phase.mul(6.28)))
      .max(0)
      .mul(this.crowdEnergy.mul(0.005));
    const seat = instancedBufferAttribute(
      new THREE.InstancedBufferAttribute(seatX, 1),
      'float',
    ) as unknown as THREE.Node<'float'>;
    const dx = seat.sub(this.waveFront).div(0.07);
    const rise = exp(dx.mul(dx).negate()).mul(0.012);
    mat.positionNode = positionLocal.add(vec3(0, 0, hop.add(rise)));
    const mesh = new THREE.InstancedMesh(geo, mat, count);
    this.crowdBase = [];
    const m = new THREE.Matrix4();
    // Mostly home navy, white and gold, with a scatter of everything else.
    const shirts = [
      0x1d3a8a, 0x1d3a8a, 0xf4efe1, 0xf4efe1, 0xf2b33d, 0xf2b33d, 0xd63a3a, 0x2e9b54, 0x3d8bfd,
      0xff7a1a, 0x8c5ad8, 0x2a2f3c,
    ];
    const color = new THREE.Color();
    for (let i = 0; i < count; i++) {
      // Rows of seats rising away from the field, in a bowl around the backboard.
      const row = Math.floor(rng.next() * 14);
      const x = -0.25 + rng.next() * (W + 0.5);
      const y = L + 0.06 + row * 0.022 + Math.abs(x - W / 2) * 0.15;
      const z = 0.27 + row * 0.018 + rng.range(0, 0.004);
      m.makeTranslation(x, y, z);
      mesh.setMatrixAt(i, m);
      seatX[i] = x;
      this.crowdBase.push(m.clone());
      mesh.setColorAt(i, color.setHex(shirts[Math.floor(rng.next() * shirts.length)]!));
    }
    this.crowd = mesh;
    this.group.add(toBackdrop(mesh));
    this.buildFlashes();
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

  /** Per-frame animation: crowd, towers, fireworks, marquee, camera flashes. */
  tick(dt: number): void {
    this.clock += dt;
    this.time.value = this.clock;
    this.marquee.value += ((this.message ? 2.2 : 1) - this.marquee.value) * Math.min(1, dt * 4);
    this.beamLevel.value = this.towerLevel;
    this.tickFlashes(dt);
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
      this.towerLamp.emissiveIntensity = 6 * this.towerLevel * flicker;
    }

    // The crowd bounces with excitement, each fan on their own rhythm (animated in the crowd's
    // vertex shader, see `setCrowd`).
    if (this.waveX !== null) {
      this.waveX += dt * 0.28;
      if (this.waveX > W + 0.4) this.waveX = null;
    }
    this.crowdEnergy.value = this.energy > 0.005 ? this.energy : 0;
    // No wave: a front far off the stands lifts nobody.
    this.waveFront.value = this.waveX ?? 1000;
    this.energy = Math.max(0, this.energy - dt * 0.25);
  }

  /** The 7th-inning crowd wave: the front's x (m), or null. */
  private waveX: number | null = null;
  /** The crowd's bounce and the wave's front, for its vertex shader. */
  private readonly crowdEnergy = uniform(0);
  private readonly waveFront = uniform(1000);

  /** A crowd wave across the stands, left to right (the 7th-inning stretch). */
  wave(): void {
    this.waveX = -0.4;
  }

  private drawScoreboard(g: GameSnapshot | null, title: string): void {
    const key = g
      ? `${g.inning}|${g.battingSide}|${g.outs}|${g.humanStats?.runsByInning.join(',')}|${g.aiStats?.runsByInning.join(',')}|${g.humanStats?.hits}|${g.aiStats?.hits}|${g.bases.join()}|${g.state}`
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
    const vsAi = g.vsAi === true && !!g.aiStats;
    const human = g.humanStats ?? g.stats;
    const drawLine = (label: string, stats: GameSnapshot['stats'], y: number, active: boolean) => {
      ctx.textAlign = 'left';
      ctx.fillStyle = active ? '#f2b33d' : '#f4f1e8';
      ctx.fillText(label, 22, y, 190);
      ctx.textAlign = 'center';
      for (let i = 0; i < 9; i++) {
        const runs = stats.runsByInning[i];
        ctx.fillStyle = active && i + 1 === g.inning ? '#f2b33d' : '#f4f1e8';
        ctx.fillText(runs === undefined ? '' : String(runs), col(i), y);
      }
      ctx.fillStyle = active ? '#f2b33d' : '#f4f1e8';
      ctx.fillText(String(stats.runs), col(9) + 20, y);
      ctx.fillText(String(stats.hits), col(10) + 20, y);
    };
    if (vsAi && g.aiStats) {
      drawLine('AI', g.aiStats, 92, g.battingSide === 'ai');
      drawLine(BRAND.teamShort.toUpperCase(), human, 138, g.battingSide !== 'ai');
    } else {
      drawLine('SILVERBALLS', g.stats, 118, true);
    }
    // Outs and the at-bat line.
    ctx.textAlign = 'left';
    ctx.fillStyle = '#9aa6c4';
    ctx.fillText('OUT', 22, 204);
    for (let i = 0; i < 3; i++) {
      ctx.beginPath();
      ctx.arc(120 + i * 40, 204, 13, 0, Math.PI * 2);
      ctx.fillStyle = i < g.outs ? '#ff3b3b' : '#1a1f2c';
      ctx.fill();
    }
    ctx.fillStyle = '#f4f1e8';
    const onBase = ['1ST', '2ND', '3RD'].filter((_, i) => g.bases[i]).join(' · ');
    ctx.fillText(
      onBase ? `ON BASE: ${onBase}` : g.state === 'INNING_BREAK' ? 'SIDE RETIRED' : 'BASES EMPTY',
      300,
      204,
    );
    texture.needsUpdate = true;
  }

  private buildCabinet(): void {
    // Black powder-coated armour with chrome trim, as on a modern cabinet: a dark frame that makes
    // the lit playfield the brightest thing on screen.
    const armour = new THREE.MeshPhysicalMaterial({
      color: 0x0b0e18,
      roughness: 0.38,
      metalness: 0.55,
      clearcoat: 0.6,
      clearcoatRoughness: 0.25,
    });
    const chrome = new THREE.MeshStandardMaterial({
      color: 0xf0f2f6,
      roughness: 0.08,
      metalness: 1,
    });
    // A thin team-gold pinstripe along the inside of each rail.
    const stripe = new THREE.MeshStandardMaterial({
      color: 0x3a2a08,
      emissive: new THREE.Color(0xf2b33d),
      emissiveIntensity: 0.55,
      roughness: 0.4,
    });
    const rails: THREE.Mesh[] = [];
    const trims: THREE.Mesh[] = [];
    const pins: THREE.Mesh[] = [];
    for (const x of [-0.016, W + 0.016]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(0.03, L + 0.06, 0.07), armour);
      rail.position.set(x, L / 2, 0.02);
      rails.push(rail);
      const inner = x < 0 ? x + 0.012 : x - 0.012;
      const trim = new THREE.Mesh(new THREE.BoxGeometry(0.006, L + 0.06, 0.004), chrome);
      trim.position.set(inner, L / 2, 0.056);
      trims.push(trim);
      const pin = new THREE.Mesh(new THREE.BoxGeometry(0.0016, L + 0.06, 0.001), stripe);
      pin.position.set(x < 0 ? inner + 0.0048 : inner - 0.0048, L / 2, 0.0552);
      pins.push(pin);
    }
    const railMesh = merged(rails);
    railMesh.castShadow = true;
    railMesh.receiveShadow = true;
    this.group.add(railMesh, merged(trims), merged(pins));
    // Brushed rather than mirror chrome on the lockdown bar, so it does not flare at the bottom
    // of the screen.
    const brushed = new THREE.MeshStandardMaterial({
      color: 0xd8dce4,
      roughness: 0.26,
      metalness: 1,
    });
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, W + 0.06, 32), brushed);
    bar.rotation.z = Math.PI / 2;
    bar.position.set(W / 2, -0.03, 0.05);
    this.group.add(bar);
    const front = new THREE.Mesh(new THREE.BoxGeometry(W + 0.06, 0.03, 0.07), armour);
    front.position.set(W / 2, -0.03, 0.01);
    this.group.add(front);
    // Apron: printed metal over the bottom of the playfield, where the ball drains away.
    const apron = new THREE.Mesh(
      new THREE.BoxGeometry(0.55, 0.036, 0.004),
      new THREE.MeshPhysicalMaterial({
        color: 0x121a33,
        roughness: 0.3,
        metalness: 0.5,
        clearcoat: 1,
        clearcoatRoughness: 0.1,
      }),
    );
    apron.position.set(0.275, 0.018, 0.028);
    apron.castShadow = true;
    this.group.add(apron);
  }

  /**
   * The cabinet's body and legs, standing on the outfield grass at night: mowing stripes in a pool
   * of light round the machine, fading to black. Without it the table floats in a void.
   */
  private buildGround(): void {
    const FLOOR = -0.85;
    const armour = new THREE.MeshPhysicalMaterial({
      color: 0x0b0e18,
      roughness: 0.38,
      metalness: 0.55,
      clearcoat: 0.6,
      clearcoatRoughness: 0.25,
    });
    // Body: sides and front under the rails, down to the legs.
    const depth = 0.3;
    const body: THREE.Mesh[] = [];
    for (const x of [-0.016, W + 0.016]) {
      const side = new THREE.Mesh(new THREE.BoxGeometry(0.026, L + 0.06, depth), armour);
      side.position.set(x, L / 2, -0.015 - depth / 2);
      body.push(side);
    }
    const front = new THREE.Mesh(new THREE.BoxGeometry(W + 0.06, 0.026, depth), armour);
    front.position.set(W / 2, -0.03, -0.015 - depth / 2);
    body.push(front);
    this.group.add(toBackdrop(merged(body)));
    // Chrome legs at the corners.
    const chrome = new THREE.MeshStandardMaterial({
      color: 0xd8dce4,
      roughness: 0.2,
      metalness: 1,
    });
    const legLength = -FLOOR - depth;
    const legs: THREE.Mesh[] = [];
    for (const [x, y] of [
      [0.01, 0.02],
      [W - 0.01, 0.02],
      [0.01, L - 0.03],
      [W - 0.01, L - 0.03],
    ] as const) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.03, legLength), chrome);
      leg.position.set(x, y, FLOOR + legLength / 2);
      legs.push(leg);
    }
    this.group.add(toBackdrop(merged(legs)));
    // The grass.
    const c = document.createElement('canvas');
    c.width = c.height = 1024;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#0a2011';
    ctx.fillRect(0, 0, 1024, 1024);
    ctx.save();
    ctx.translate(512, 512);
    ctx.rotate(Math.PI / 4);
    ctx.fillStyle = '#0e2b17';
    for (let x = -800; x < 800; x += 64) ctx.fillRect(x, -800, 32, 1600);
    ctx.restore();
    // Light pool round the cabinet, darkness beyond, a soft shadow under it.
    const pool = ctx.createRadialGradient(512, 512, 60, 512, 512, 470);
    pool.addColorStop(0, 'rgba(0,0,0,0)');
    pool.addColorStop(0.35, 'rgba(0,0,0,0.3)');
    pool.addColorStop(1, 'rgba(0,0,0,1)');
    ctx.fillStyle = pool;
    ctx.fillRect(0, 0, 1024, 1024);
    const shadow = ctx.createRadialGradient(512, 512, 30, 512, 512, 190);
    shadow.addColorStop(0, 'rgba(0,0,0,0.85)');
    shadow.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = shadow;
    ctx.save();
    ctx.translate(512, 512);
    ctx.scale(0.62, 1);
    ctx.translate(-512, -512);
    ctx.fillRect(0, 0, 1024, 1024);
    ctx.restore();
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(4, 4),
      new THREE.MeshStandardMaterial({ map: tex, roughness: 0.92 }),
    );
    ground.position.set(W / 2, L / 2, FLOOR);
    this.group.add(toBackdrop(ground));
  }

  private buildBackboard(): void {
    const canvas = document.createElement('canvas');
    canvas.width = 1024;
    canvas.height = 512;
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    this.backboardTexture = tex;
    this.drawBackboard();
    const board = new THREE.Mesh(
      new THREE.PlaneGeometry(W + 0.03, 0.3),
      // A translite: the art is lit from behind (emissive only), under glossy glass.
      new THREE.MeshStandardMaterial({
        color: 0x000000,
        emissiveMap: tex,
        emissive: new THREE.Color(0xffffff),
        emissiveIntensity: 1.1,
        roughness: 0.35,
      }),
    );
    board.rotation.x = Math.PI / 2;
    board.position.set(W / 2, L + 0.012, 0.15);
    board.receiveShadow = true;
    this.group.add(board);
  }

  /** Redraw the backboard art (again once the display font has loaded). */
  drawBackboard(): void {
    const tex = this.backboardTexture;
    if (!tex) return;
    const canvas = tex.image as HTMLCanvasElement;
    const ctx = canvas.getContext('2d')!;
    const w = canvas.width;
    const h = canvas.height;
    const rng = new Rng(5);
    // Night sky, glowing toward the horizon over the stands.
    const sky = ctx.createLinearGradient(0, 0, 0, 392);
    sky.addColorStop(0, '#010208');
    sky.addColorStop(0.5, '#050b20');
    sky.addColorStop(0.82, '#0d1a40');
    sky.addColorStop(1, '#1a2c5e');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#c9d6ff';
    for (let i = 0; i < 70; i++) {
      ctx.globalAlpha = 0.2 + rng.next() * 0.5;
      ctx.fillRect(rng.next() * w, rng.next() * 220, 1.5, 1.5);
    }
    ctx.globalAlpha = 1;
    // Light towers either side, rising out of the stands, each with a bank of lamps.
    const towers = [118, 906];
    ctx.globalCompositeOperation = 'lighter';
    for (const x of towers) {
      // Shafts of light falling from the bank toward the field.
      for (const [spread, alpha] of [
        [260, 0.08],
        [150, 0.1],
        [70, 0.12],
      ] as const) {
        const toward = x < w / 2 ? 1 : -1;
        const g = ctx.createLinearGradient(x, 70, x + toward * 160, 392);
        g.addColorStop(0, `rgba(255,236,200,${alpha})`);
        g.addColorStop(1, 'rgba(255,236,200,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.moveTo(x - 30, 70);
        ctx.lineTo(x + 30, 70);
        ctx.lineTo(x + toward * 160 + spread, 392);
        ctx.lineTo(x + toward * 160 - spread, 392);
        ctx.closePath();
        ctx.fill();
      }
      const glow = ctx.createRadialGradient(x, 58, 4, x, 58, 230);
      glow.addColorStop(0, 'rgba(255,240,210,0.9)');
      glow.addColorStop(0.15, 'rgba(255,225,170,0.35)');
      glow.addColorStop(1, 'rgba(255,225,170,0)');
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, w, h);
    }
    ctx.globalCompositeOperation = 'source-over';
    for (const x of towers) {
      ctx.fillStyle = '#05070d';
      ctx.fillRect(x - 5, 80, 10, 240);
      ctx.fillRect(x - 44, 36, 88, 46);
      ctx.fillStyle = '#fff6e4';
      for (let r = 0; r < 3; r++)
        for (let c = 0; c < 6; c++) ctx.fillRect(x - 40 + c * 14, 40 + r * 14, 10, 10);
    }
    // Bleachers above the wall: dark tiers speckled with fans, lit along their fronts.
    const stands = ctx.createLinearGradient(0, 296, 0, 392);
    stands.addColorStop(0, '#0a1124');
    stands.addColorStop(1, '#131c36');
    ctx.fillStyle = stands;
    ctx.beginPath();
    ctx.moveTo(0, 300);
    ctx.quadraticCurveTo(w / 2, 270, w, 300);
    ctx.lineTo(w, 392);
    ctx.lineTo(0, 392);
    ctx.closePath();
    ctx.fill();
    const fans = ['#f4efe1', '#f2b33d', '#3d6bd8', '#d63a3a', '#9aa6c4', '#2e9b54'];
    for (let i = 0; i < 900; i++) {
      const x = rng.next() * w;
      const top = 300 - 30 * Math.sin((x / w) * Math.PI);
      const y = top + 6 + rng.next() * (392 - top - 12);
      ctx.globalAlpha = 0.35 + rng.next() * 0.4;
      ctx.fillStyle = fans[Math.floor(rng.next() * fans.length)]!;
      ctx.fillRect(x, y, 3, 4);
    }
    ctx.globalAlpha = 1;
    ctx.fillStyle = 'rgba(255,214,150,0.55)';
    for (const y of [336, 362]) ctx.fillRect(0, y, w, 1.5);
    // Outfield wall: padded green with seams, the yellow home-run line, distance markers.
    const wall = ctx.createLinearGradient(0, 392, 0, h);
    wall.addColorStop(0, '#13502a');
    wall.addColorStop(1, '#0a2e17');
    ctx.fillStyle = wall;
    ctx.fillRect(0, 392, w, 120);
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    for (let x = 64; x < w; x += 64) ctx.fillRect(x, 398, 2, 114);
    ctx.fillStyle = '#ffc53d';
    ctx.fillRect(0, 392, w, 7);
    ctx.font = 'bold 46px Oswald, "Arial Narrow", Arial, sans-serif';
    ctx.textAlign = 'center';
    for (const [x, t] of [
      [120, '330'],
      [330, '375'],
      [512, '400'],
      [694, '375'],
      [904, '330'],
    ] as const) {
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      ctx.fillText(t, x + 2, 473);
      ctx.fillStyle = '#f7f3e8';
      ctx.fillText(t, x, 470);
    }
    tex.needsUpdate = true;
  }

  /** A row of bulbs above and below the scoreboard, chasing (one draw call, animated on the GPU). */
  private buildMarquee(): void {
    const perRow = 30;
    const geo = new THREE.SphereGeometry(0.0021, 10, 6);
    const mat = new THREE.MeshStandardNodeMaterial({ color: 0x2a1e08, roughness: 0.3 });
    // Each bulb's brightness: a travelling wave, so the lights chase round the board.
    const phase = float(instanceIndex).mul(0.55).sub(this.time.mul(7));
    const chase = pow(sin(phase).mul(0.5).add(0.5), float(3));
    mat.emissiveNode = vec3(1, 0.78, 0.42).mul(chase.mul(3.2).add(0.6)).mul(this.marquee);
    const bulbs = new THREE.InstancedMesh(geo, mat, perRow * 2);
    const m = new THREE.Matrix4();
    for (let i = 0; i < perRow * 2; i++) {
      const row = i < perRow ? 0 : 1;
      const k = i % perRow;
      // The bottom row runs the other way, so the chase goes round.
      const t = row === 0 ? k / (perRow - 1) : 1 - k / (perRow - 1);
      m.makeTranslation(W / 2 - 0.172 + t * 0.344, L + 0.004, 0.2 + (row === 0 ? 0.05 : -0.05));
      bulbs.setMatrixAt(i, m);
    }
    this.group.add(bulbs);
  }

  /** Camera flashes popping in the stands: hidden (zero-size) until one fires. */
  private buildFlashes(): void {
    if (this.flashes) {
      this.group.remove(this.flashes);
      this.flashes.geometry.dispose();
    }
    const n = 32;
    const geo = new THREE.PlaneGeometry(0.0045, 0.0045);
    geo.rotateX(Math.PI / 2);
    const mat = new THREE.MeshStandardMaterial({
      color: 0x000000,
      emissive: new THREE.Color(0xeef4ff),
      emissiveIntensity: 9,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.InstancedMesh(geo, mat, n);
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < n; i++) mesh.setMatrixAt(i, zero);
    this.flashLife.length = 0;
    for (let i = 0; i < n; i++) this.flashLife.push(0);
    this.flashes = mesh;
    this.group.add(toBackdrop(mesh));
  }

  private readonly flashMatrix = new THREE.Matrix4();

  private tickFlashes(dt: number): void {
    const mesh = this.flashes;
    if (!mesh || this.crowdBase.length === 0) return;
    // A steady trickle, a storm when the crowd is on its feet.
    this.flashBudget += dt * (this.flashesEnabled ? 1.2 + this.energy * 30 : 0);
    let changed = false;
    const m = this.flashMatrix;
    for (let i = 0; i < this.flashLife.length; i++) {
      if (this.flashLife[i]! > 0) {
        this.flashLife[i]! -= dt;
        if (this.flashLife[i]! <= 0) {
          mesh.setMatrixAt(i, m.makeScale(0, 0, 0));
          changed = true;
        }
      } else if (this.flashBudget >= 1) {
        this.flashBudget -= 1;
        const base = this.crowdBase[Math.floor(Math.random() * this.crowdBase.length)]!;
        m.copy(base);
        m.elements[13] -= 0.001;
        m.elements[14] += 0.006;
        mesh.setMatrixAt(i, m);
        this.flashLife[i] = 0.05 + Math.random() * 0.04;
        changed = true;
      }
    }
    this.flashBudget = Math.min(this.flashBudget, 3);
    if (changed) mesh.instanceMatrix.needsUpdate = true;
  }

  private buildTowers(): void {
    const steel = new THREE.MeshStandardMaterial({
      color: 0x1a1f2b,
      roughness: 0.45,
      metalness: 0.8,
    });
    const lamp = this.towerLamp;
    const target = new THREE.Vector3(W / 2, L * 0.55, 0);
    const steelParts: THREE.Mesh[] = [];
    const bulbs: THREE.Mesh[] = [];
    for (const head of this.towerHeads) {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.009, head.z, 10), steel);
      pole.rotation.x = Math.PI / 2;
      pole.position.set(head.x, head.y, head.z / 2);
      const bank = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.012, 0.05), steel);
      bank.position.copy(head);
      bank.lookAt(target);
      steelParts.push(pole, bank);
      for (let i = 0; i < 6; i++) {
        const bulb = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.004, 0.012), lamp);
        bulb.position.set(-0.033 + (i % 3) * 0.033, -0.008, i < 3 ? 0.012 : -0.012);
        bank.add(bulb);
        bulbs.push(bulb);
      }
      this.group.add(toBackdrop(this.lightShaft(head, target)));
    }
    this.group.add(merged(steelParts), merged(bulbs));
  }

  /**
   * A fake volumetric shaft from a tower toward the field (docs/MVP/05 § 2): an open cone, additive,
   * fading along its length and toward its edges. It ends well above the playfield, so it never
   * hazes over play.
   */
  private lightShaft(from: THREE.Vector3, to: THREE.Vector3): THREE.Mesh {
    const length = 0.5;
    const geo = new THREE.CylinderGeometry(0.03, 0.16, length, 32, 1, true);
    geo.translate(0, -length / 2, 0);
    const mat = new THREE.MeshBasicNodeMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    });
    // Brightest at the lamps (uv.y = 1), gone by the far end; soft at the silhouette.
    const along = pow(uv().y, float(2.2));
    const across = pow(abs(dot(normalView, positionViewDirection)), float(1.5));
    mat.colorNode = vec3(1, 0.9, 0.72);
    mat.opacityNode = along.mul(across).mul(0.38).mul(this.beamLevel);
    const shaft = new THREE.Mesh(geo, mat);
    shaft.position.copy(from);
    shaft.quaternion.setFromUnitVectors(
      new THREE.Vector3(0, -1, 0),
      to.clone().sub(from).normalize(),
    );
    shaft.renderOrder = 2;
    return shaft;
  }

  private buildSky(): void {
    // Stands: stepped tiers behind the backboard, painted dark navy, each with a strip of warm
    // concourse lights along its front edge.
    const concrete = new THREE.MeshStandardMaterial({ color: 0x070b17, roughness: 0.95 });
    const strips: THREE.BufferGeometry[] = [];
    const tiers: THREE.Mesh[] = [];
    for (let row = 0; row < 7; row++) {
      const y = L + 0.07 + row * 0.044;
      const z = 0.24 + row * 0.036;
      const tier = new THREE.Mesh(new THREE.BoxGeometry(W + 0.6, 0.044, 0.04), concrete);
      tier.position.set(W / 2, y, z);
      tiers.push(tier);
      strips.push(
        new THREE.BoxGeometry(W + 0.5, 0.0008, 0.0008).translate(W / 2, y - 0.023, z + 0.019),
      );
    }
    const stands = merged(tiers);
    stands.receiveShadow = true;
    this.group.add(toBackdrop(stands));
    this.group.add(
      toBackdrop(
        new THREE.Mesh(
          mergeGeometries(strips),
          new THREE.MeshStandardMaterial({
            color: 0x000000,
            emissive: new THREE.Color(0xffc98a),
            emissiveIntensity: 0.9,
          }),
        ),
      ),
    );
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
      toBackdrop(
        new THREE.Points(
          g,
          new THREE.PointsMaterial({ color: 0xc9d6ff, size: 2, sizeAttenuation: false }),
        ),
      ),
    );
  }
}

/**
 * Static parts that share a material, baked into one mesh (docs/MVP/efficiency-audit F13): each
 * part's transform (with its parent's, for parts on a detached holder) goes into the geometry, so
 * the parts draw once, in every pass, instead of once each.
 */
function merged(parts: THREE.Mesh[]): THREE.Mesh {
  const geometries = parts.map((p) => {
    p.updateWorldMatrix(true, false);
    return p.geometry.clone().applyMatrix4(p.matrixWorld);
  });
  return new THREE.Mesh(mergeGeometries(geometries)!, parts[0]!.material);
}
