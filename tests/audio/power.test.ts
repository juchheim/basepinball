import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Crowd } from '../../src/audio/crowd';
import { AudioEngine } from '../../src/audio/engine';
import { RollSound } from '../../src/audio/sfx';
import { publishSnapshot, snapshot } from '../../src/ui/store';
import type { GameSnapshot } from '../../src/rules/types';
import { emptyStats } from '../../src/rules/types';

// Battery (docs/MVP/efficiency-audit F9, F10): muted audio suspends the context; per-frame audio
// updates schedule nothing when nothing changed; the HUD is only handed a snapshot that changed.

/** Counts every automation event scheduled anywhere in the fake context. */
let scheduled = 0;

class FakeParam {
  value = 0;
  setTargetAtTime(v: number): this {
    scheduled++;
    this.value = v;
    return this;
  }
  cancelScheduledValues(): this {
    return this;
  }
}

class FakeNode {
  gain = new FakeParam();
  frequency = new FakeParam();
  Q = new FakeParam();
  pan = new FakeParam();
  playbackRate = new FakeParam();
  threshold = new FakeParam();
  knee = new FakeParam();
  ratio = new FakeParam();
  attack = new FakeParam();
  release = new FakeParam();
  type = '';
  buffer: unknown = null;
  loop = false;
  connect<T>(n: T): T {
    return n;
  }
  start(): void {}
}

class FakeAudioContext {
  state: 'running' | 'suspended' = 'running';
  currentTime = 0;
  sampleRate = 8000;
  destination = new FakeNode();
  suspend = vi.fn(async () => {
    this.state = 'suspended';
  });
  resume = vi.fn(async () => {
    this.state = 'running';
  });
  createGain = (): FakeNode => new FakeNode();
  createDynamicsCompressor = (): FakeNode => new FakeNode();
  createBufferSource = (): FakeNode => new FakeNode();
  createBiquadFilter = (): FakeNode => new FakeNode();
  createStereoPanner = (): FakeNode => new FakeNode();
  createOscillator = (): FakeNode => new FakeNode();
  createBuffer = (_c: number, len: number) => ({ getChannelData: () => new Float32Array(len) });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('AudioContext', FakeAudioContext);
  scheduled = 0;
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const ctxOf = (a: AudioEngine) => a.ctx as unknown as FakeAudioContext;

describe('muted audio', () => {
  it('suspends the context while muted and resumes it when unmuted', async () => {
    const a = new AudioEngine();
    a.unlock();
    a.setVolumes({ muted: true });
    vi.advanceTimersByTime(200);
    expect(ctxOf(a).suspend).toHaveBeenCalled();
    expect(ctxOf(a).state).toBe('suspended');
    a.setVolumes({ muted: false });
    await vi.runAllTimersAsync();
    expect(ctxOf(a).state).toBe('running');
  });

  it('master volume at 0 counts as muted', () => {
    const a = new AudioEngine();
    a.unlock();
    a.setVolumes({ master: 0 });
    vi.advanceTimersByTime(200);
    expect(ctxOf(a).state).toBe('suspended');
  });

  it('a context created muted starts suspended, and gestures do not wake it', () => {
    const a = new AudioEngine();
    a.setVolumes({ muted: true });
    a.unlock();
    vi.advanceTimersByTime(200);
    expect(ctxOf(a).state).toBe('suspended');
    a.unlock();
    expect(ctxOf(a).resume).not.toHaveBeenCalled();
  });

  it('unmuting while paused stays suspended until the game resumes', async () => {
    const a = new AudioEngine();
    a.unlock();
    a.setPaused(true);
    a.setVolumes({ muted: true });
    a.setVolumes({ muted: false });
    vi.advanceTimersByTime(200);
    expect(ctxOf(a).state).toBe('suspended');
    a.setPaused(false);
    await vi.runAllTimersAsync();
    expect(ctxOf(a).state).toBe('running');
  });
});

describe('per-frame audio updates', () => {
  it('the roll loop schedules nothing for a ball that is not moving', () => {
    const a = new AudioEngine();
    a.unlock();
    const roll = new RollSound(a, a.bus('mech')!);
    roll.update(0, 'playfield', 0.5, 0, false);
    const first = scheduled;
    expect(first).toBeGreaterThan(0);
    for (let i = 0; i < 100; i++) roll.update(0, 'playfield', 0.5, 0, false);
    expect(scheduled).toBe(first);
  });

  it('a rolling ball still updates, and silence is always sent', () => {
    const a = new AudioEngine();
    a.unlock();
    const roll = new RollSound(a, a.bus('mech')!);
    roll.update(2, 'playfield', 0.5, 0.2, true);
    const n = scheduled;
    roll.update(2.5, 'playfield', 0.6, 0.2, true);
    expect(scheduled).toBeGreaterThan(n);
    // Slowing to a crawl, then stopping: the last tiny level is not left hissing.
    roll.update(0.05, 'playfield', 0.6, 0.2, true);
    const crawl = scheduled;
    roll.update(0, 'playfield', 0.6, 0.2, false);
    expect(scheduled).toBeGreaterThan(crawl);
  });

  it('the crowd bed is only rescheduled when the intensity changes', () => {
    const a = new AudioEngine();
    a.unlock();
    const crowd = new Crowd(a);
    crowd.start();
    const n = scheduled;
    for (let i = 0; i < 60; i++) crowd.setIntensity(0.45);
    expect(scheduled).toBe(n + 2);
    crowd.setIntensity(0.6);
    expect(scheduled).toBe(n + 4);
  });
});

describe('HUD snapshot', () => {
  const snap = (over: Partial<GameSnapshot> = {}): GameSnapshot => ({
    state: 'IN_PLAY',
    inning: 1,
    innings: 9,
    outs: 0,
    bases: [false, false, false],
    stats: emptyStats(),
    rally: 0,
    hotBat: false,
    stealReady: false,
    walkHit: [false, false, false, false],
    hustle: 0,
    hustleTarget: 25,
    souvenirReady: false,
    throwBack: false,
    kickbackLit: false,
    tiltWarnings: 0,
    tilted: false,
    skillLane: null,
    pitch: null,
    pitchSide: null,
    pitchPhase: null,
    ...over,
  });

  it('is published only when something in it changed', () => {
    let renders = 0;
    const off = snapshot.subscribe(() => renders++);
    const base = renders;
    publishSnapshot(snap());
    publishSnapshot(snap());
    publishSnapshot(snap());
    expect(renders).toBe(base + 1);
    publishSnapshot(snap({ outs: 1 }));
    expect(renders).toBe(base + 2);
    // Stats are mutated in place by the rules: a changed count still publishes.
    const s = snap({ outs: 1 });
    s.stats.runs = 3;
    publishSnapshot(s);
    expect(renders).toBe(base + 3);
    off();
  });
});
