import { CLIMATE_STEP_TICKS, GRID, REGEN_SAMPLES_PER_TICK } from './config.ts';
import { seasonOffset } from './climate.ts';
import { Population, spawnInitialCreatures } from './creatures.ts';
import { computeEligibleCells, regrowTick, spawnInitialFood } from './food.ts';
import { FOODS_BY_BIOME, FOOD_COUNT, NONE } from './palette.ts';
import { mulberry32 } from './rng.ts';
import { classify, generateTerrain } from './terrain.ts';

/**
 * All simulated state plus one fixed-timestep advance, with no canvas, DOM or UI coupling:
 * `Engine` drives it from the animation frame, tests drive it directly from Node.
 */
export class World {
  biome: Uint8Array = new Uint8Array(GRID);
  elev: Float32Array = new Float32Array(GRID);
  moist: Float32Array = new Float32Array(GRID);
  tempBase: Float32Array = new Float32Array(GRID);
  snowBias: Float32Array = new Float32Array(GRID);
  food: Uint8Array = new Uint8Array(GRID).fill(NONE);
  counts: Uint32Array = new Uint32Array(FOOD_COUNT);
  eligible: Uint32Array = new Uint32Array(FOOD_COUNT);
  population = new Population();
  rng: () => number = mulberry32(1);
  seed = 0;
  tick = 0;
  seasonOffset = 0;
  meanTempBase = 0;

  /** Rebuild terrain, food and creatures for `seed`. */
  reset(seed: number): void {
    this.seed = seed >>> 0;
    this.tick = 0;
    this.seasonOffset = seasonOffset(this.tick);
    const terrain = generateTerrain(this.seed, this.seasonOffset);
    this.biome = terrain.biome;
    this.elev = terrain.elev;
    this.moist = terrain.moist;
    this.tempBase = terrain.tempBase;
    this.snowBias = terrain.snowBias;
    let sum = 0;
    for (let i = 0; i < GRID; i++) sum += this.tempBase[i];
    this.meanTempBase = sum / GRID;
    this.food = new Uint8Array(GRID).fill(NONE);
    this.eligible = computeEligibleCells(this.biome);
    this.counts = new Uint32Array(FOOD_COUNT);
    this.rng = mulberry32(this.seed ^ 0x9e3779b9);
    spawnInitialFood(this.biome, this.food, this.counts, this.rng);
    this.population = new Population();
    spawnInitialCreatures(this.biome, this.population, this.rng);
  }

  /**
   * Advance one tick: shift the season, reclassify biomes on the climate cadence, then run
   * creatures before regrowth so food eaten this tick cannot regrow in the same tick; both
   * share `rng`, so the order fixes the run for a given seed.
   */
  step(): void {
    this.seasonOffset = seasonOffset(this.tick);
    if (this.tick % CLIMATE_STEP_TICKS === 0) this.applyClimate();
    this.population.step(
      this.biome,
      this.food,
      this.counts,
      this.rng,
      this.tempBase,
      this.seasonOffset,
    );
    regrowTick(this.biome, this.food, this.counts, this.rng, REGEN_SAMPLES_PER_TICK);
    this.tick++;
  }

  /**
   * Reclassify every cell's biome at the current season offset. A cell that changes to a
   * biome it can no longer host loses its food (counters kept in step); passability never
   * changes because temperature only separates biomes that share a species' habitat.
   */
  private applyClimate(): void {
    const { elev, moist, tempBase, snowBias, biome, food, counts } = this;
    for (let i = 0; i < GRID; i++) {
      const nb = classify(elev[i], moist[i], tempBase[i] + this.seasonOffset, snowBias[i]);
      if (nb === biome[i]) continue;
      biome[i] = nb;
      const f = food[i];
      if (f === NONE) continue;
      const list = FOODS_BY_BIOME[nb];
      let ok = false;
      for (let k = 0; k < list.length; k++) {
        if (list[k] === f) {
          ok = true;
          break;
        }
      }
      if (!ok) {
        food[i] = NONE;
        counts[f]--;
      }
    }
    this.eligible = computeEligibleCells(this.biome);
  }
}
