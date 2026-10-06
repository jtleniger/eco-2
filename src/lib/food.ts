import { GRID } from './config.ts';
import { FOODS, FOODS_BY_BIOME, FOOD_COUNT, NONE } from './palette.ts';

/** Per food id: how many cells of `biome` can host that food. */
export function computeEligibleCells(biome: Uint8Array): Uint32Array {
  const eligible = new Uint32Array(FOOD_COUNT);
  for (let i = 0; i < GRID; i++) {
    const list = FOODS_BY_BIOME[biome[i]];
    for (let k = 0; k < list.length; k++) eligible[list[k]]++;
  }
  return eligible;
}

/** Sprinkle the initial food population, one Bernoulli trial per eligible cell. */
export function spawnInitialFood(
  biome: Uint8Array,
  food: Uint8Array,
  counts: Uint32Array,
  rng: () => number,
): void {
  for (let i = 0; i < GRID; i++) {
    const list = FOODS_BY_BIOME[biome[i]];
    if (list.length === 0) continue;
    const f = list[(rng() * list.length) | 0];
    if (rng() < FOODS[f].density) {
      food[i] = f;
      counts[f]++;
    }
  }
}

/** Grow food toward its per-type carrying capacity on `samples` random cells. */
export function regrowTick(
  biome: Uint8Array,
  food: Uint8Array,
  counts: Uint32Array,
  eligible: Uint32Array,
  rng: () => number,
  samples: number,
): void {
  for (let s = 0; s < samples; s++) {
    const i = (rng() * GRID) | 0;
    if (food[i] !== NONE) continue;
    const list = FOODS_BY_BIOME[biome[i]];
    if (list.length === 0) continue;
    const f = list[(rng() * list.length) | 0];
    if (coverage(counts, eligible, f) >= FOODS[f].maxCoverage) continue;
    food[i] = f;
    counts[f]++;
  }
}

/** Food `f`'s share of the cells it could occupy. */
export function coverage(counts: Uint32Array, eligible: Uint32Array, f: number): number {
  return eligible[f] === 0 ? 0 : counts[f] / eligible[f];
}
