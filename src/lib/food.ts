import { GRID, H, LOCAL_DENSITY_RADIUS, LOCAL_DENSITY_SCALE, W } from './config.ts';
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

/**
 * Grow food toward its per-type carrying capacity on `samples` random cells. A sample takes
 * root only where the *local* density is still under `maxCoverage`, so grazed patches are
 * replenished while a patch already at capacity is left alone. A single global cap would
 * instead stop growth everywhere the moment the crop as a whole reached capacity: the food a
 * grazer ate then came back at random cells — including habitat no creature can reach — and
 * the crop drained away from its consumers until they starved.
 */
export function regrowTick(
  biome: Uint8Array,
  food: Uint8Array,
  counts: Uint32Array,
  rng: () => number,
  samples: number,
): void {
  for (let s = 0; s < samples; s++) {
    const i = (rng() * GRID) | 0;
    if (food[i] !== NONE) continue;
    const list = FOODS_BY_BIOME[biome[i]];
    if (list.length === 0) continue;
    const f = list[(rng() * list.length) | 0];
    const x = i % W;
    const y = (i / W) | 0;
    let near = 0;
    let window = 0;
    for (let dy = -LOCAL_DENSITY_RADIUS; dy <= LOCAL_DENSITY_RADIUS; dy++) {
      const ny = y + dy;
      if (ny < 0 || ny >= H) continue;
      for (let dx = -LOCAL_DENSITY_RADIUS; dx <= LOCAL_DENSITY_RADIUS; dx++) {
        const nx = x + dx;
        if (nx < 0 || nx >= W) continue;
        window++;
        if (food[ny * W + nx] === f) near++;
      }
    }
    if (near >= window * FOODS[f].maxCoverage * LOCAL_DENSITY_SCALE) continue;
    food[i] = f;
    counts[f]++;
  }
}

/** Food `f`'s share of the cells it could occupy. */
export function coverage(counts: Uint32Array, eligible: Uint32Array, f: number): number {
  return eligible[f] === 0 ? 0 : counts[f] / eligible[f];
}
