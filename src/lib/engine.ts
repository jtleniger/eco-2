import {
  GRID,
  MAX_TICKS_PER_FRAME,
  REGEN_SAMPLES_PER_TICK,
  SPEEDS,
  STATS_INTERVAL_MS,
  TICK_MS,
} from './config.ts';
import { computeEligibleCells, coverage, regrowTick, spawnInitialFood } from './food.ts';
import { BIOME_COUNT, FOOD_COUNT, NONE } from './palette.ts';
import { Renderer } from './renderer.ts';
import { mulberry32 } from './rng.ts';
import { generateTerrain } from './terrain.ts';
import { ui } from './ui.svelte.ts';

export type Status = 'paused' | 'running';

/** World state plus the fixed-timestep loop that advances it. */
export class Engine {
  biome: Uint8Array;
  food: Uint8Array;
  counts: Uint32Array;
  eligible: Uint32Array;
  renderer: Renderer;
  rng: () => number;
  seed: number;
  tick: number;
  status: Status;
  speed: number;
  dirty: boolean;
  private acc: number;
  private last: number;
  private lastStats: number;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new Renderer(canvas);
    this.biome = new Uint8Array(GRID);
    this.food = new Uint8Array(GRID).fill(NONE);
    this.counts = new Uint32Array(FOOD_COUNT);
    this.eligible = new Uint32Array(FOOD_COUNT);
    this.rng = mulberry32(1);
    this.seed = 0;
    this.tick = 0;
    this.status = 'paused';
    this.speed = 1;
    this.dirty = true;
    this.acc = 0;
    this.last = 0;
    this.lastStats = 0;
    this.reset();
    requestAnimationFrame(this.frame);
  }

  reset(): void {
    this.seed = (Math.random() * 0xffffffff) >>> 0;
    this.biome = generateTerrain(this.seed);
    this.food = new Uint8Array(GRID).fill(NONE);
    this.eligible = computeEligibleCells(this.biome);
    this.counts = new Uint32Array(FOOD_COUNT);
    this.rng = mulberry32(this.seed ^ 0x9e3779b9);
    spawnInitialFood(this.biome, this.food, this.counts, this.rng);
    this.tick = 0;
    this.acc = 0;
    this.status = 'paused';
    this.dirty = true;

    const share: number[] = new Array(BIOME_COUNT).fill(0);
    for (let i = 0; i < GRID; i++) share[this.biome[i]]++;
    for (let b = 0; b < BIOME_COUNT; b++) share[b] /= GRID;

    ui.status = this.status;
    ui.seed = this.seed;
    ui.tick = 0;
    ui.biomeShare = share;
    this.pushStats();

    this.renderer.paint(this.biome, this.food);
    this.dirty = false;
  }

  start(): void {
    if (this.status === 'running') return;
    this.status = 'running';
    ui.status = this.status;
  }

  pause(): void {
    if (this.status === 'paused') return;
    this.status = 'paused';
    ui.status = this.status;
    this.pushStats();
  }

  setSpeed(s: number): void {
    if (!(SPEEDS as readonly number[]).includes(s)) return;
    this.speed = s;
    ui.speed = s;
  }

  private step(): void {
    regrowTick(this.biome, this.food, this.counts, this.eligible, this.rng, REGEN_SAMPLES_PER_TICK);
    this.tick++;
    this.dirty = true;
    ui.tick = this.tick;
  }

  private pushStats(): void {
    const cov: number[] = new Array(FOOD_COUNT);
    for (let f = 0; f < FOOD_COUNT; f++) cov[f] = coverage(this.counts, this.eligible, f);
    ui.counts = Array.from(this.counts);
    ui.coverage = cov;
  }

  private frame = (ts: number): void => {
    if (this.last === 0) this.last = ts;
    const dt = ts - this.last;
    this.last = ts;

    if (this.status === 'running') {
      this.acc += dt * this.speed;
      let n = 0;
      while (this.acc >= TICK_MS && n < MAX_TICKS_PER_FRAME) {
        this.step();
        this.acc -= TICK_MS;
        n++;
      }
      if (n === MAX_TICKS_PER_FRAME) this.acc = 0;
    }

    if (this.dirty) {
      this.renderer.paint(this.biome, this.food);
      this.dirty = false;
    }

    if (ts - this.lastStats >= STATS_INTERVAL_MS) {
      this.lastStats = ts;
      this.pushStats();
    }

    requestAnimationFrame(this.frame);
  };
}
