import {
  GRID,
  MAX_TICKS_PER_FRAME,
  SPEEDS,
  STATS_INTERVAL_MS,
  TICK_MS,
} from './config.ts';
import { seasonName } from './climate.ts';
import { coverage } from './food.ts';
import { BIOME_COUNT, FOOD_COUNT } from './palette.ts';
import { Renderer } from './renderer.ts';
import { ui } from './ui.svelte.ts';
import { World } from './world.ts';

export type Status = 'paused' | 'running';

/**
 * Fixed-timestep driver: owns the canvas, the clock and the UI mirror, and delegates all
 * simulated state to `World`.
 */
export class Engine {
  readonly world = new World();
  renderer: Renderer;
  status: Status;
  speed: number;
  dirty: boolean;
  private acc: number;
  private last: number;
  private lastStats: number;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new Renderer(canvas);
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
    this.world.reset((Math.random() * 0xffffffff) >>> 0);
    this.acc = 0;
    this.status = 'paused';
    this.dirty = true;

    this.refreshBiomeShare();

    ui.status = this.status;
    ui.seed = this.world.seed;
    ui.tick = 0;
    ui.season = seasonName(0);
    ui.seasonOffset = 0;
    ui.meanTemp = this.world.meanTempBase;
    this.pushStats();

    this.renderer.paint(this.world.biome, this.world.food, this.world.population);
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
    this.world.step();
    this.dirty = true;
    ui.tick = this.world.tick;
    ui.season = seasonName(this.world.tick);
    ui.seasonOffset = this.world.seasonOffset;
    ui.meanTemp = this.world.meanTempBase + this.world.seasonOffset;
  }

  private refreshBiomeShare(): void {
    const share: number[] = new Array(BIOME_COUNT).fill(0);
    for (let i = 0; i < GRID; i++) share[this.world.biome[i]]++;
    for (let b = 0; b < BIOME_COUNT; b++) share[b] /= GRID;
    ui.biomeShare = share;
  }

  private pushStats(): void {
    this.refreshBiomeShare();
    const cov: number[] = new Array(FOOD_COUNT);
    for (let f = 0; f < FOOD_COUNT; f++) {
      cov[f] = coverage(this.world.counts, this.world.eligible, f);
    }
    ui.counts = Array.from(this.world.counts);
    ui.creatureCounts = Array.from(this.world.population.counts);
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
      this.renderer.paint(this.world.biome, this.world.food, this.world.population);
      this.dirty = false;
    }

    if (ts - this.lastStats >= STATS_INTERVAL_MS) {
      this.lastStats = ts;
      this.pushStats();
    }

    requestAnimationFrame(this.frame);
  };
}
