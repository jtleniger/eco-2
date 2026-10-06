import { GRID, REGEN_SAMPLES_PER_TICK } from './config.ts';
import { Population, spawnInitialCreatures } from './creatures.ts';
import { computeEligibleCells, regrowTick, spawnInitialFood } from './food.ts';
import { FOOD_COUNT, NONE } from './palette.ts';
import { mulberry32 } from './rng.ts';
import { generateTerrain } from './terrain.ts';

/**
 * All simulated state plus one fixed-timestep advance, with no canvas, DOM or UI coupling:
 * `Engine` drives it from the animation frame, tests drive it directly from Node.
 */
export class World {
  biome: Uint8Array = new Uint8Array(GRID);
  food: Uint8Array = new Uint8Array(GRID).fill(NONE);
  counts: Uint32Array = new Uint32Array(FOOD_COUNT);
  eligible: Uint32Array = new Uint32Array(FOOD_COUNT);
  population = new Population();
  rng: () => number = mulberry32(1);
  seed = 0;
  tick = 0;

  /** Rebuild terrain, food and creatures for `seed`. */
  reset(seed: number): void {
    this.seed = seed >>> 0;
    this.biome = generateTerrain(this.seed);
    this.food = new Uint8Array(GRID).fill(NONE);
    this.eligible = computeEligibleCells(this.biome);
    this.counts = new Uint32Array(FOOD_COUNT);
    this.rng = mulberry32(this.seed ^ 0x9e3779b9);
    spawnInitialFood(this.biome, this.food, this.counts, this.rng);
    this.population = new Population();
    spawnInitialCreatures(this.biome, this.population, this.rng);
    this.tick = 0;
  }

  /**
   * Advance one tick. Creatures run before regrowth so food eaten this tick cannot regrow
   * in the same tick; both share `rng`, so the order fixes the run for a given seed.
   */
  step(): void {
    this.population.step(this.biome, this.food, this.counts, this.rng);
    regrowTick(this.biome, this.food, this.counts, this.rng, REGEN_SAMPLES_PER_TICK);
    this.tick++;
  }
}
