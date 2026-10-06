/// <reference types="node" />
import assert from 'node:assert/strict';
import test from 'node:test';
import { GRID, MAX_CREATURES, REGEN_SAMPLES_PER_TICK, SEASON_AMPLITUDE, SEASON_PERIOD_TICKS, W } from './config.ts';
import { seasonName, seasonOffset } from './climate.ts';
import { Population, spawnInitialCreatures } from './creatures.ts';
import { computeEligibleCells, regrowTick } from './food.ts';
import { Biome, FOODS, FOOD_COUNT, NONE } from './palette.ts';
import { mulberry32 } from './rng.ts';
import {
  SPECIES,
  SPECIES_COUNT,
  SPECIES_EATS,
  SPECIES_HUNTS,
  SPECIES_LUT,
  SPECIES_PASSABLE,
} from './species.ts';
import { generateTerrain } from './terrain.ts';
import { World } from './world.ts';

/** Every live slot is well formed and the occupant grid agrees with the slots. */
function assertPopulationSound(pop: Population, biome: Uint8Array): void {
  let sum = 0;
  for (let s = 0; s < SPECIES_COUNT; s++) sum += pop.counts[s];
  assert.equal(sum, pop.count, 'counts must sum to count');
  for (let i = 0; i < pop.count; i++) {
    assert.ok(pop.species[i] < SPECIES_COUNT, `slot ${i} species in range`);
    assert.ok(pop.pos[i] >= 0 && pop.pos[i] < GRID, `slot ${i} pos in range`);
    assert.equal(pop.dead[i], 0, `slot ${i} is not a zombie`);
    assert.equal(
      SPECIES_PASSABLE[pop.species[i]][biome[pop.pos[i]]],
      1,
      `slot ${i} stands on a passable biome`,
    );
  }
  for (let c = 0; c < GRID; c++) {
    const j = pop.occupant[c];
    if (j < 0) continue;
    assert.ok(j < pop.count, `occupant of cell ${c} is a live slot`);
    assert.equal(pop.pos[j], c, `occupant of cell ${c} stands there`);
    assert.equal(pop.dead[j], 0, `occupant of cell ${c} is alive`);
  }
}

/** The food counters must mirror the array exactly (eat, regrow and relocation all edit both). */
function assertFoodCountsMatch(food: Uint8Array, counts: Uint32Array): void {
  const actual = new Uint32Array(FOOD_COUNT);
  let none = 0;
  for (let i = 0; i < GRID; i++) {
    if (food[i] === NONE) none++;
    else actual[food[i]]++;
  }
  assert.deepEqual(Array.from(actual), Array.from(counts), 'food counters match the grid');
  assert.equal(
    none + counts.reduce((a, b) => a + b, 0),
    GRID,
    'every cell is either food or empty',
  );
}

test('species tables describe the SPECIES list', () => {
  for (let s = 0; s < SPECIES_COUNT; s++) {
    const sp = SPECIES[s];
    const n = parseInt(sp.hex.slice(1), 16);
    assert.deepEqual(
      [SPECIES_LUT[s * 3], SPECIES_LUT[s * 3 + 1], SPECIES_LUT[s * 3 + 2]],
      [(n >> 16) & 255, (n >> 8) & 255, n & 255],
      `${sp.name} LUT colour`,
    );
    for (let b = 0; b < sp.biomes.length; b++) {
      assert.equal(SPECIES_PASSABLE[s][sp.biomes[b]], 1, `${sp.name} may occupy biome ${b}`);
    }
    assert.equal(
      SPECIES_PASSABLE[s].reduce((a, b2) => a + b2, 0),
      sp.biomes.length,
      `${sp.name} has no extra biomes`,
    );
    for (let f = 0; f < FOOD_COUNT; f++) {
      assert.equal(SPECIES_EATS[s][f], sp.foods.includes(f as never) ? 1 : 0, `${sp.name} diet ${f}`);
    }
    for (let p = 0; p < SPECIES_COUNT; p++) {
      assert.equal(SPECIES_HUNTS[s][p], sp.prey.includes(p as never) ? 1 : 0, `${sp.name} prey ${p}`);
    }
  }
});

test('a pike runs down a minnow it can see', () => {
  const biome = new Uint8Array(GRID).fill(1); // all Water
  const food = new Uint8Array(GRID).fill(NONE);
  const foodCounts = new Uint32Array(FOOD_COUNT);
  const rng = mulberry32(7);
  for (let c = 0; c < GRID; c++) {
    if (rng() < 0.14) {
      food[c] = 0; // Algae, so the minnow always has something to chase
      foodCounts[0]++;
    }
  }
  const pop = new Population();
  const tempBase = new Float32Array(GRID).fill(0.5);
  assert.ok(pop.spawn(3, 100 * W + 100, SPECIES[3].startEnergy), 'pike spawned');
  assert.ok(pop.spawn(1, 106 * W + 100, SPECIES[1].startEnergy), 'minnow spawned');

  let ticks = 0;
  while (pop.counts[1] > 0 && ticks < 200) {
    pop.step(biome, food, foodCounts, rng, tempBase, 0);
    ticks++;
  }
  assert.equal(pop.counts[1], 0, `minnow killed within ${ticks} ticks`);
  assert.ok(pop.counts[3] >= 1, 'pike survived the hunt');
  assert.deepEqual(assertFoodCountsMatch(food, foodCounts), undefined);
});

test('herbivores eat the plants they stand on and the counters keep up', () => {
  const world = new World();
  world.reset(12345);
  for (let t = 0; t < 60; t++) world.step();
  assertFoodCountsMatch(world.food, world.counts);
  world.population.step(world.biome, world.food, world.counts, world.rng, world.tempBase, world.seasonOffset);
  regrowTick(world.biome, world.food, world.counts, world.rng, REGEN_SAMPLES_PER_TICK);
  assertFoodCountsMatch(world.food, world.counts);
  assertPopulationSound(world.population, world.biome);
});

test('a seed reproduces the same run', () => {
  const run = () => {
    const w = new World();
    w.reset(4242);
    for (let t = 0; t < 300; t++) w.step();
    return { counts: Array.from(w.counts), creatures: Array.from(w.population.counts), tick: w.tick };
  };
  assert.deepEqual(run(), run());
});

test('creature populations stay bounded by their caps', () => {
  const world = new World();
  world.reset(99);
  for (let t = 0; t < 1500; t++) {
    world.step();
    assert.ok(world.population.count <= MAX_CREATURES, 'total within pool capacity');
    for (let s = 0; s < SPECIES_COUNT; s++) {
      assert.ok(world.population.counts[s] <= SPECIES[s].maxPop, `${SPECIES[s].name} within maxPop`);
    }
  }
  assertPopulationSound(world.population, world.biome);
  assertFoodCountsMatch(world.food, world.counts);
});

test('spawn placement respects biomes, occupancy and the pool limit', () => {
  const terrain = generateTerrain(12345);
  const biome = terrain.biome;
  const pop = new Population();
  spawnInitialCreatures(biome, pop, mulberry32(5));
  assertPopulationSound(pop, biome);
  for (let s = 0; s < SPECIES_COUNT; s++) {
    assert.ok(pop.counts[s] <= SPECIES[s].initial, `${SPECIES[s].name} seeded at most initial`);
  }
  const tiny = new Population(4);
  const rng = mulberry32(11);
  spawnInitialCreatures(biome, tiny, rng);
  assert.equal(tiny.count, 4, 'stops at pool capacity');
  assert.equal(tiny.spawn(0, 0, 10), false, 'spawn refuses when full');
});

test('all four species survive 5000 ticks and the world keeps its books', () => {
  for (const seed of [12345, 1]) {
    const world = new World();
    world.reset(seed);
    for (let t = 0; t < 5000; t++) world.step();
    const counts = Array.from(world.population.counts);
    assert.ok(
      counts.every((c) => c >= 1),
      `seed ${seed}: every species alive at tick 5000, got ${counts.join('/')}`,
    );
    counts.forEach((c, s) =>
      assert.ok(c <= SPECIES[s].maxPop, `seed ${seed}: ${SPECIES[s].name} within maxPop`),
    );
    assert.ok(world.population.count <= MAX_CREATURES);
    assertPopulationSound(world.population, world.biome);
    assertFoodCountsMatch(world.food, world.counts);
  }
});

test('grazing is replenished, not drained away from the grazers', () => {
  const grazed = new World();
  grazed.reset(7);
  const stocked = new World();
  stocked.reset(7);
  stocked.population.count = 0;
  stocked.population.counts.fill(0);
  stocked.population.occupant.fill(-1);

  for (let t = 0; t < SEASON_PERIOD_TICKS; t++) {
    grazed.step();
    stocked.step();
  }

  // A full climate year returns the world to its start-of-run biomes, so the end-of-year
  // eligible map is the area that actually hosted each food at this sampled phase.
  const eligible = computeEligibleCells(grazed.biome);

  for (let f = 0; f < FOOD_COUNT; f++) {
    const cap = FOODS[f].maxCoverage * eligible[f];
    assert.ok(grazed.counts[f] <= cap * 2, `${FOODS[f].name} stays near its carrying capacity`);
    assert.ok(grazed.counts[f] >= cap * 0.5, `${FOODS[f].name} is not grazed out`);
  }
  assert.ok(
    grazed.counts.reduce((a, b) => a + b, 0) < stocked.counts.reduce((a, b) => a + b, 0),
    'grazing removes standing crop an unstocked world keeps at capacity',
  );
  // The crop eaten by herbivores has to come back where they are, not somewhere else: their
  // stored energy is what drains away when it does not.
  for (let s = 0; s < SPECIES_COUNT; s++) {
    if (SPECIES[s].foods.length === 0) continue;
    let sum = 0;
    let n = 0;
    for (let i = 0; i < grazed.population.count; i++) {
      if (grazed.population.species[i] !== s) continue;
      sum += grazed.population.energy[i];
      n++;
    }
    assert.ok(n > 0, `${SPECIES[s].name} is still alive`);
    assert.ok(
      sum / n > SPECIES[s].maxEnergy * 0.4,
      `${SPECIES[s].name} stays fed (mean energy ${(sum / n).toFixed(0)})`,
    );
  }
});

test('the season offset is a sinusoid that starts at zero', () => {
  assert.equal(seasonOffset(0), 0);
  assert.ok(Math.abs(seasonOffset(900) - SEASON_AMPLITUDE) < 1e-9, 'quarter year is the peak');
  assert.ok(Math.abs(seasonOffset(1800)) < 1e-9, 'half year crosses zero');
  assert.ok(Math.abs(seasonOffset(2700) + SEASON_AMPLITUDE) < 1e-9, 'three-quarters is the trough');
  assert.equal(seasonName(0), 'Spring');
  assert.equal(seasonName(900), 'Summer');
  assert.equal(seasonName(1800), 'Autumn');
  assert.equal(seasonName(2700), 'Winter');
});

test('biome bands advance and retreat with the season', () => {
  const world = new World();
  world.reset(12345);
  const base = Uint8Array.from(world.biome);
  for (let t = 0; t < 900; t++) world.step();

  let changed = 0;
  for (let i = 0; i < GRID; i++) if (world.biome[i] !== base[i]) changed++;
  assert.ok(changed > 0, `summer reclassifies cells, got ${changed}`);
  assert.deepEqual(Array.from(world.eligible), Array.from(computeEligibleCells(world.biome)));
  assertFoodCountsMatch(world.food, world.counts);
});

test('a creature outside its comfort band moves toward a better temperature', () => {
  const biome = new Uint8Array(GRID).fill(Biome.Fields);
  const food = new Uint8Array(GRID).fill(NONE);
  const counts = new Uint32Array(FOOD_COUNT);
  const tempBase = new Float32Array(GRID).fill(0.5);
  const pop = new Population();
  const start = 100 * W + 100;
  tempBase[start] = 0.85; // inside the Grazer's survival band, above its comfort band
  assert.ok(pop.spawn(0, start, SPECIES[0].startEnergy), 'grazer spawned');

  pop.step(biome, food, counts, mulberry32(3), tempBase, 0);

  assert.equal(pop.counts[0], 1, 'grazer survives the step');
  assert.notEqual(pop.pos[0], start, 'grazer left the hot cell');
  assert.ok(tempBase[pop.pos[0]] < 0.85, 'grazer stepped somewhere cooler');
});

test('a creature outside its survival band dies', () => {
  const biome = new Uint8Array(GRID).fill(Biome.Fields);
  const food = new Uint8Array(GRID).fill(NONE);
  const counts = new Uint32Array(FOOD_COUNT);
  const tempBase = new Float32Array(GRID).fill(0.5);
  const pop = new Population();
  const start = 50 * W + 50;
  tempBase[start] = 2; // far above the Grazer's survival maximum (1.08)
  assert.ok(pop.spawn(0, start, SPECIES[0].startEnergy), 'grazer spawned');

  pop.step(biome, food, counts, mulberry32(3), tempBase, 0);

  assert.equal(pop.counts[0], 0, 'grazer died of heat');
  assert.equal(pop.count, 0);
});
