import {
  CLIMATE_STEP_TICKS,
  GRID,
  HUNT_EFFICIENCY_MAX,
  HUNT_EFFICIENCY_MIN,
  REGEN_SAMPLES_PER_TICK,
  SEASON_AMPLITUDE,
  SEASON_AMPLITUDE_MAX,
  SEASON_AMPLITUDE_MIN,
} from './config.ts';
import { seasonOffset } from './climate.ts';
import { Population, spawnInitialCreatures } from './creatures.ts';
import { computeEligibleCells, regrowTick, spawnInitialFood } from './food.ts';
import { FOODS_BY_BIOME, FOOD_COUNT, NONE } from './palette.ts';
import { mulberry32 } from './rng.ts';
import { FOUNDERS, SpeciesRegistry } from './species.ts';
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
  /** Every species ever created in this run; founders pre-registered on `reset`. */
  registry = new SpeciesRegistry();
  rng: () => number = mulberry32(1);
  seed = 0;
  tick = 0;
  seasonOffset = 0;
  meanTempBase = 0;
  /** Per-seed carcass extraction efficiency; a lean seed favours pure carnivores. */
  huntEfficiency = 1;
  /** Per-seed seasonal temperature swing; a harsh seed crashes grazers in winter. */
  seasonAmplitude = SEASON_AMPLITUDE;

  /** Rebuild terrain, food and creatures for `seed`. */
  reset(seed: number): void {
    this.seed = seed >>> 0;
    this.tick = 0;
    // The seed's environmental profile comes from its own stream, not the run's `rng`, so the
    // run's draw sequence is untouched and a seed still reproduces its exact history. The first
    // draw of `mulberry32` is poorly mixed for small seeds (on 1..8,12345 the ninth value of
    // `seed ^ 0x51ed270b` lands in 0.33..0.97, i.e. every seed nearly lush), so the first two
    // draws are discarded and the profile reads the next pair.
    const profile = mulberry32(this.seed ^ 0x51ed270b);
    profile();
    profile();
    this.huntEfficiency =
      HUNT_EFFICIENCY_MIN + (HUNT_EFFICIENCY_MAX - HUNT_EFFICIENCY_MIN) * profile();
    this.seasonAmplitude =
      SEASON_AMPLITUDE_MIN + (SEASON_AMPLITUDE_MAX - SEASON_AMPLITUDE_MIN) * profile();
    this.seasonOffset = seasonOffset(this.tick, this.seasonAmplitude);
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
    this.registry = new SpeciesRegistry();
    for (let s = 0; s < FOUNDERS.length; s++) this.registry.addFounder(FOUNDERS[s], s);
    spawnInitialCreatures(this.biome, this.population, this.registry, this.rng);
  }

  /**
   * Advance one tick: shift the season, reclassify biomes on the climate cadence, then run
   * creatures before regrowth so food eaten this tick cannot regrow in the same tick; both
   * share `rng`, so the order fixes the run for a given seed.
   */
  step(): void {
    this.seasonOffset = seasonOffset(this.tick, this.seasonAmplitude);
    if (this.tick % CLIMATE_STEP_TICKS === 0) this.applyClimate();
    this.population.step(
      this.biome,
      this.food,
      this.counts,
      this.rng,
      this.tempBase,
      this.seasonOffset,
      this.registry,
      this.tick,
      this.huntEfficiency,
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
