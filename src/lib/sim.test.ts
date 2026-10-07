/// <reference types="node" />
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CARNIVORE_MIN,
  GRID,
  H,
  HERBIVORE_MAX,
  MAX_CREATURES,
  MAX_SPECIES,
  REGEN_SAMPLES_PER_TICK,
  SEASON_AMPLITUDE,
  SEASON_PERIOD_TICKS,
  W,
} from './config.ts';
import { seasonName, seasonOffset } from './climate.ts';
import { Population, spawnInitialCreatures } from './creatures.ts';
import { computeEligibleCells, regrowTick } from './food.ts';
import { GENE, GENE_COUNT, GENES, dietClassOf, mutate } from './genetics.ts';
import { Biome, Food, FOODS, FOOD_COUNT, NONE, hexToRgb } from './palette.ts';
import { mulberry32 } from './rng.ts';
import {
  FOUNDERS,
  SPECIES_PALETTE_LUT,
  type SpeciesTraits,
  SpeciesRegistry,
  habitatLabel,
  writeTraits,
} from './species.ts';
import { classify, generateTerrain } from './terrain.ts';
import { World } from './world.ts';

/** A registry with all four founders registered and an empty population to go with it. */
function founderPop(): { pop: Population; registry: SpeciesRegistry } {
  const registry = new SpeciesRegistry();
  for (let s = 0; s < FOUNDERS.length; s++) registry.addFounder(FOUNDERS[s], s);
  return { pop: new Population(), registry };
}

/** Spawn founder `s` at `cell` with the founder's reference genome. */
function spawnFounder(
  pop: Population,
  registry: SpeciesRegistry,
  s: number,
  cell: number,
  energy: number,
): number {
  return pop.spawn(cell, energy, s, registry.colorSlot[s], registry.refOf(s), registry);
}

/**
 * Spawn founder `speciesId`'s genome with `overrides`-patched traits, so a test can put an
 * arbitrary size/carnivory/diet combination on the grid while keeping the species' masks.
 */
function spawnCustom(
  pop: Population,
  registry: SpeciesRegistry,
  cell: number,
  energy: number,
  speciesId: number,
  overrides: Partial<SpeciesTraits>,
): number {
  const spec = FOUNDERS[speciesId];
  const genes = new Float32Array(GENE_COUNT);
  writeTraits(genes, 0, { ...spec, ...overrides });
  let biomeMask = 0;
  for (const b of spec.biomes) biomeMask |= 1 << b;
  let foodMask = 0;
  for (const f of spec.foods) foodMask |= 1 << f;
  return pop.spawn(
    cell,
    energy,
    speciesId,
    registry.colorSlot[speciesId],
    { genes, off: 0, biomeMask, foodMask },
    registry,
  );
}

/**
 * Every live slot is well formed and the occupant grid agrees with the slots.
 *
 * Note: standing on a biome the individual's `biomeMask` excludes is NOT a violation. The
 * mask gates movement, so a categorical mutation at birth, or a climate shift under a
 * creature, can legitimately strand a live creature on ground it can no longer re-enter.
 * Placement of freshly seeded creatures is checked against the species reference mask in the
 * spawn-placement test instead.
 */
function assertPopulationSound(pop: Population, registry: SpeciesRegistry): void {
  let sum = 0;
  for (let s = 0; s < MAX_SPECIES; s++) sum += pop.speciesCounts[s];
  assert.equal(sum, pop.count, 'speciesCounts must sum to count');
  for (let i = 0; i < pop.count; i++) {
    assert.ok(pop.species[i] < registry.count, `slot ${i} species in range`);
    assert.ok(pop.pos[i] >= 0 && pop.pos[i] < GRID, `slot ${i} pos in range`);
    assert.equal(pop.dead[i], 0, `slot ${i} is not a zombie`);
    for (let g = 0; g < GENE_COUNT; g++) {
      const v = pop.genes[i * GENE_COUNT + g];
      assert.ok(
        v >= GENES[g].min - 0.01 && v <= GENES[g].max + 0.01,
        `slot ${i} gene ${g} within [${GENES[g].min}, ${GENES[g].max}], got ${v}`,
      );
    }
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

test('founder registry describes FOUNDERS', () => {
  const registry = new SpeciesRegistry();
  FOUNDERS.forEach((spec, s) => registry.addFounder(spec, s));
  assert.equal(registry.count, FOUNDERS.length);
  for (let s = 0; s < FOUNDERS.length; s++) {
    const spec = FOUNDERS[s];
    assert.equal(registry.name[s], spec.name);
    assert.equal(registry.colorSlot[s], s);
    assert.equal(registry.parent[s], -1);
    assert.equal(registry.generation[s], 0);
    assert.equal(registry.extinctTick[s], -1);
    assert.equal(registry.maxPop[s], spec.maxPop);
    // Trait order must match the GENE order in genetics.ts.
    const traits = [
      spec.vision,
      spec.speed,
      spec.moveChance,
      spec.metabolism,
      spec.maxEnergy,
      spec.reproEnergy,
      spec.maxAge,
      spec.eatGain,
      spec.startEnergy,
      spec.tempMin,
      spec.tempMax,
      spec.comfortMin,
      spec.comfortMax,
      spec.size,
      spec.carnivory,
    ];
    for (let g = 0; g < GENE_COUNT; g++) {
      assert.ok(
        Math.abs(registry.refGenes[s][g] - traits[g]) < 1e-5,
        `${spec.name} gene ${g}: ${registry.refGenes[s][g]} != ${traits[g]}`,
      );
    }
    let biomeMask = 0;
    for (const b of spec.biomes) biomeMask |= 1 << b;
    assert.equal(registry.refBiome[s], biomeMask, `${spec.name} biome mask`);
    let foodMask = 0;
    for (const f of spec.foods) foodMask |= 1 << f;
    assert.equal(registry.refFood[s], foodMask, `${spec.name} food mask`);
    const [r, g, b] = hexToRgb(spec.hex);
    assert.deepEqual(
      [
        SPECIES_PALETTE_LUT[registry.colorSlot[s] * 3],
        SPECIES_PALETTE_LUT[registry.colorSlot[s] * 3 + 1],
        SPECIES_PALETTE_LUT[registry.colorSlot[s] * 3 + 2],
      ],
      [r, g, b],
      `${spec.name} palette colour`,
    );
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
  const { pop, registry } = founderPop();
  const tempBase = new Float32Array(GRID).fill(0.5);
  assert.ok(spawnFounder(pop, registry, 3, 100 * W + 100, FOUNDERS[3].startEnergy) >= 0, 'pike spawned');
  assert.ok(
    spawnFounder(pop, registry, 1, 106 * W + 100, FOUNDERS[1].startEnergy) >= 0,
    'minnow spawned',
  );

  let ticks = 0;
  while (pop.speciesCounts[1] > 0 && ticks < 200) {
    pop.step(biome, food, foodCounts, rng, tempBase, 0, registry, ticks);
    ticks++;
  }
  assert.equal(pop.speciesCounts[1], 0, `minnow killed within ${ticks} ticks`);
  assert.ok(pop.speciesCounts[3] >= 1, 'pike survived the hunt');
  assert.deepEqual(assertFoodCountsMatch(food, foodCounts), undefined);
});

test('herbivores eat the plants they stand on and the counters keep up', () => {
  const world = new World();
  world.reset(12345);
  for (let t = 0; t < 60; t++) world.step();
  assertFoodCountsMatch(world.food, world.counts);
  world.population.step(
    world.biome,
    world.food,
    world.counts,
    world.rng,
    world.tempBase,
    world.seasonOffset,
    world.registry,
    world.tick,
  );
  regrowTick(world.biome, world.food, world.counts, world.rng, REGEN_SAMPLES_PER_TICK);
  assertFoodCountsMatch(world.food, world.counts);
  assertPopulationSound(world.population, world.registry);
});

test('a seed reproduces the same run', () => {
  const run = () => {
    const w = new World();
    w.reset(4242);
    for (let t = 0; t < 300; t++) w.step();
    return {
      counts: Array.from(w.counts),
      species: Array.from(w.population.speciesCounts),
      names: w.registry.name.slice(),
      tick: w.tick,
    };
  };
  assert.deepEqual(run(), run());
});

test('creature populations stay bounded by their caps', () => {
  const world = new World();
  world.reset(99);
  for (let t = 0; t < 1500; t++) {
    world.step();
    assert.ok(world.population.count <= MAX_CREATURES, 'total within pool capacity');
    for (let s = 0; s < world.registry.count; s++) {
      assert.ok(
        world.population.speciesCounts[s] <= world.registry.maxPop[s],
        `${world.registry.name[s]} within maxPop`,
      );
    }
  }
  assertPopulationSound(world.population, world.registry);
  assertFoodCountsMatch(world.food, world.counts);
});

test('spawn placement respects biomes, occupancy and the pool limit', () => {
  const terrain = generateTerrain(12345);
  const biome = terrain.biome;
  const { pop, registry } = founderPop();
  spawnInitialCreatures(biome, pop, registry, mulberry32(5));
  assertPopulationSound(pop, registry);
  for (let i = 0; i < pop.count; i++) {
    assert.equal(
      (registry.refBiome[pop.species[i]] >>> biome[pop.pos[i]]) & 1,
      1,
      `slot ${i} seeded on a biome its species allows`,
    );
  }
  for (let s = 0; s < FOUNDERS.length; s++) {
    assert.ok(pop.speciesCounts[s] <= FOUNDERS[s].initial, `${FOUNDERS[s].name} seeded at most initial`);
  }
  const tinyPool = new Population(4);
  const tinyRegistry = new SpeciesRegistry();
  for (let s = 0; s < FOUNDERS.length; s++) tinyRegistry.addFounder(FOUNDERS[s], s);
  spawnInitialCreatures(biome, tinyPool, tinyRegistry, mulberry32(11));
  assert.equal(tinyPool.count, 4, 'stops at pool capacity');
  assert.equal(spawnFounder(tinyPool, tinyRegistry, 0, 0, 10), -1, 'spawn refuses when full');
});

test('habitat records where members go, not the genome mask', () => {
  // A Grazer's genome allows seven land biomes, but on an all-Fields map it can only ever
  // stand on Fields, so the menu must not claim Snow/Desert/Mountain as its habitat.
  const biome = new Uint8Array(GRID).fill(Biome.Fields);
  const food = new Uint8Array(GRID).fill(NONE);
  const foodCounts = new Uint32Array(FOOD_COUNT);
  const rng = mulberry32(3);
  const tempBase = new Float32Array(GRID).fill(0.5);
  const { pop, registry } = founderPop();
  assert.notEqual((registry.refBiome[0] >>> Biome.Snow) & 1, 0, 'genome mask lists Snow');
  assert.ok(spawnFounder(pop, registry, 0, 100 * W + 100, FOUNDERS[0].startEnergy) >= 0);
  assert.equal(registry.habitat[0], 0, 'no habitat before the first tick');

  for (let t = 0; t < 50; t++) pop.step(biome, food, foodCounts, rng, tempBase, 0, registry, t);

  assert.equal(registry.habitat[0], 1 << Biome.Fields, 'only the occupied biome is listed');
  assert.notEqual(registry.habitat[0], registry.refBiome[0], 'habitat is not the genome mask');
  assert.equal(habitatLabel(registry.habitat[0]), 'Fields', 'the menu names the visited biome');
  assert.ok(
    habitatLabel(registry.refBiome[0]).includes('Snow'),
    'the genome mask lists Snow, which no member visits',
  );
});

test('a big fish crosses deep water but not the beach, a small one neither', () => {
  // Row 100 is Water at x=10 (start) and x=12 (goal), with a foodless `barrier` at x=11.
  const barrierRow = (barrier: number): Uint8Array => {
    const biome = new Uint8Array(GRID).fill(Biome.Fields);
    const row = 100 * W;
    biome[row + 10] = Biome.Water;
    biome[row + 11] = barrier;
    biome[row + 12] = Biome.Water;
    return biome;
  };
  const tempBase = new Float32Array(GRID).fill(0.5);
  const row = 100 * W;

  // Pike (water lineage, size 2.5) is big enough to swim the foodless Deep Water and reach the
  // minnow beyond.
  const crossed = barrierRow(Biome.DeepWater);
  const crossedFood = new Uint8Array(GRID).fill(NONE);
  const crossedCounts = new Uint32Array(FOOD_COUNT);
  const a = founderPop();
  assert.ok(spawnFounder(a.pop, a.registry, 3, row + 10, FOUNDERS[3].startEnergy) >= 0, 'pike spawned');
  assert.ok(
    spawnCustom(a.pop, a.registry, row + 12, 100, 1, { size: 0.6, carnivory: 0, moveChance: 0 }) >= 0,
    'prey spawned beyond Deep Water',
  );
  const rngA = mulberry32(1);
  for (let t = 0; t < 20 && a.pop.speciesCounts[1] > 0; t++) {
    a.pop.step(crossed, crossedFood, crossedCounts, rngA, tempBase, 0, a.registry, t);
  }
  assert.equal(a.pop.speciesCounts[1], 0, 'pike crossed Deep Water to catch the prey');

  // Deep Water is the only barrier a swimmer passes: the same Pike cannot leave the water for
  // Beach, so a minnow across the sand survives. The lineage check keeps swimmers off land.
  const beached = barrierRow(Biome.Beach);
  const beachedFood = new Uint8Array(GRID).fill(NONE);
  const beachedCounts = new Uint32Array(FOOD_COUNT);
  const b = founderPop();
  assert.ok(spawnFounder(b.pop, b.registry, 3, row + 10, FOUNDERS[3].startEnergy) >= 0, 'pike spawned');
  assert.ok(
    spawnCustom(b.pop, b.registry, row + 12, 100, 1, { size: 0.6, carnivory: 0, moveChance: 0 }) >= 0,
    'prey spawned beyond Beach',
  );
  const rngB = mulberry32(1);
  for (let t = 0; t < 30; t++) {
    b.pop.step(beached, beachedFood, beachedCounts, rngB, tempBase, 0, b.registry, t);
  }
  assert.equal(b.pop.pos[0], row + 10, 'pike never entered Beach');
  assert.equal(b.pop.speciesCounts[1], 1, 'prey beyond the sand survived');

  // Minnow (size 0.6) is too small: the algae beyond either barrier is never reached.
  for (const [barrier, label] of [
    [Biome.DeepWater, 'Deep Water'],
    [Biome.Beach, 'Beach'],
  ] as const) {
    const blocked = barrierRow(barrier);
    const blockedFood = new Uint8Array(GRID).fill(NONE);
    const blockedCounts = new Uint32Array(FOOD_COUNT);
    blockedFood[row + 12] = Food.Algae;
    blockedCounts[Food.Algae] = 1;
    const c = founderPop();
    assert.ok(spawnFounder(c.pop, c.registry, 1, row + 10, FOUNDERS[1].startEnergy) >= 0, 'minnow spawned');
    const rngC = mulberry32(1);
    for (let t = 0; t < 30; t++) {
      c.pop.step(blocked, blockedFood, blockedCounts, rngC, tempBase, 0, c.registry, t);
    }
    assert.equal(c.pop.pos[0], row + 10, `minnow never entered ${label}`);
    assert.equal(blockedFood[row + 12], Food.Algae, `algae beyond ${label} is untouched`);
  }
});

test('a big land creature wades shallow water, a small one cannot', () => {
  // A one-cell Water channel at x=11 between the grazer and the grain, spanning every row so
  // the diagonal step around a lone cell cannot get past it.
  const build = (): Uint8Array => {
    const biome = new Uint8Array(GRID).fill(Biome.Fields);
    for (let y = 0; y < H; y++) biome[y * W + 11] = Biome.Water;
    return biome;
  };
  const tempBase = new Float32Array(GRID).fill(0.5);
  const row = 100 * W;

  const waded = build();
  const wadedFood = new Uint8Array(GRID).fill(NONE);
  const wadedCounts = new Uint32Array(FOOD_COUNT);
  wadedFood[row + 12] = Food.Grain;
  wadedCounts[Food.Grain] = 1;
  const big = founderPop();
  assert.ok(
    spawnCustom(big.pop, big.registry, row + 10, 120, 0, { size: 3, moveChance: 1, speed: 1 }) >= 0,
    'big grazer spawned',
  );
  const rngBig = mulberry32(1);
  for (let t = 0; t < 20 && wadedCounts[Food.Grain] > 0; t++) {
    big.pop.step(waded, wadedFood, wadedCounts, rngBig, tempBase, 0, big.registry, t);
  }
  assert.equal(wadedCounts[Food.Grain], 0, 'the big grazer waded the channel to the grain');

  const blocked = build();
  const blockedFood = new Uint8Array(GRID).fill(NONE);
  const blockedCounts = new Uint32Array(FOOD_COUNT);
  blockedFood[row + 12] = Food.Grain;
  blockedCounts[Food.Grain] = 1;
  const small = founderPop();
  assert.ok(
    spawnCustom(small.pop, small.registry, row + 10, 120, 0, { size: 0.6, moveChance: 1, speed: 1 }) >= 0,
    'small grazer spawned',
  );
  const rngSmall = mulberry32(1);
  for (let t = 0; t < 30; t++) {
    small.pop.step(blocked, blockedFood, blockedCounts, rngSmall, tempBase, 0, small.registry, t);
  }
  assert.equal(blockedFood[row + 12], Food.Grain, 'the small grazer could not cross the channel');
});

test('the ecosystem survives 5000 ticks', () => {
  for (const seed of [12345, 1]) {
    const world = new World();
    world.reset(seed);
    for (let t = 0; t < 5000; t++) world.step();
    assert.ok(world.population.count > 0, `seed ${seed}: population survives 5000 ticks`);
    let sum = 0;
    for (let s = 0; s < MAX_SPECIES; s++) sum += world.population.speciesCounts[s];
    assert.equal(sum, world.population.count, `seed ${seed}: speciesCounts sum to count`);
    assert.ok(world.population.count <= MAX_CREATURES);
    assertPopulationSound(world.population, world.registry);
    assertFoodCountsMatch(world.food, world.counts);
  }
});

test('all three trophic strategies persist', () => {
  for (const seed of [12345, 1, 7]) {
    const world = new World();
    world.reset(seed);
    for (let t = 0; t < 5000; t++) world.step();
    let herb = 0, omni = 0, carn = 0;
    for (let i = 0; i < world.population.count; i++) {
      const c = world.population.genes[i * GENE_COUNT + GENE.carnivory];
      if (c >= CARNIVORE_MIN) carn++;
      else if (c >= HERBIVORE_MAX) omni++;
      else herb++;
    }
    assert.ok(herb > 0, `seed ${seed}: herbivores persist (h/o/c ${herb}/${omni}/${carn})`);
    assert.ok(omni > 0, `seed ${seed}: omnivores persist (h/o/c ${herb}/${omni}/${carn})`);
    assert.ok(carn > 0, `seed ${seed}: carnivores persist (h/o/c ${herb}/${omni}/${carn})`);
    assertPopulationSound(world.population, world.registry);
  }
});

test('grazing is replenished where the grazers are', () => {
  const grazed = new World();
  grazed.reset(7);
  const stocked = new World();
  stocked.reset(7);
  stocked.population.count = 0;
  stocked.population.speciesCounts.fill(0);
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
  }
  assert.ok(
    grazed.counts.reduce((a, b) => a + b, 0) < stocked.counts.reduce((a, b) => a + b, 0),
    'grazing removes standing crop an unstocked world keeps at capacity',
  );
  // The crop is grazed down to the food-limited equilibrium the population settles at, but it
  // has to keep coming back where the grazers are: their stored energy drains away when it does
  // not. Founders are tracked by lineage root, since a founder species is often absorbed by
  // speciation into its daughters.
  for (let s = 0; s < FOUNDERS.length; s++) {
    if (FOUNDERS[s].foods.length === 0) continue;
    let sum = 0;
    let n = 0;
    for (let i = 0; i < grazed.population.count; i++) {
      let r = grazed.population.species[i];
      while (grazed.registry.parent[r] !== -1) r = grazed.registry.parent[r];
      if (r !== s) continue;
      sum += grazed.population.energy[i];
      n++;
    }
    assert.ok(n > 0, `${FOUNDERS[s].name} lineage is still alive`);
    assert.ok(
      sum / n > FOUNDERS[s].maxEnergy * 0.15,
      `${FOUNDERS[s].name} stays fed (mean energy ${(sum / n).toFixed(0)})`,
    );
  }
});

test('the season offset peaks mid-summer and troughs mid-winter', () => {
  const q = SEASON_PERIOD_TICKS / 4;
  assert.ok(Math.abs(seasonOffset(1.5 * q) - SEASON_AMPLITUDE) < 1e-9, 'mid-summer is the peak');
  assert.ok(Math.abs(seasonOffset(3.5 * q) + SEASON_AMPLITUDE) < 1e-9, 'mid-winter is the trough');
  assert.ok(Math.abs(seasonOffset(0.5 * q)) < 1e-9, 'mid-spring crosses zero rising');
  assert.ok(Math.abs(seasonOffset(2.5 * q)) < 1e-9, 'mid-autumn crosses zero falling');
  assert.equal(seasonName(0), 'Spring');
  assert.equal(seasonName(q), 'Summer');
  assert.equal(seasonName(2 * q), 'Autumn');
  assert.equal(seasonName(3 * q), 'Winter');
});

test('snow recedes through spring and summer, then grows through autumn and winter', () => {
  const world = new World();
  world.reset(12345);
  const q = SEASON_PERIOD_TICKS / 4;
  const snow = (): number => {
    let n = 0;
    for (let i = 0; i < GRID; i++) if (world.biome[i] === Biome.Snow) n++;
    return n;
  };
  const at = (tick: number): number => {
    while (world.tick < tick) world.step();
    return snow();
  };
  const start = at(0);
  const midSpring = at(0.5 * q);
  const midSummer = at(1.5 * q);
  const midAutumn = at(2.5 * q);
  const midWinter = at(3.5 * q);
  assert.ok(midSpring < start, `snow melts through spring (${start} -> ${midSpring})`);
  assert.ok(midSummer < midSpring, `snow keeps melting into summer (${midSpring} -> ${midSummer})`);
  assert.ok(midAutumn > midSummer, `snow rebuilds through autumn (${midSummer} -> ${midAutumn})`);
  assert.ok(midWinter > midAutumn, `snow keeps growing into winter (${midAutumn} -> ${midWinter})`);
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

test('the snow line is jittered, not a straight isotherm', () => {
  // On a flat, evenly moist plain the snow edge would otherwise be a latitude line: the
  // only thing that can move it column to column is the static per-cell snow jitter.
  const { snowBias } = generateTerrain(12345);
  const edge: number[] = [];
  for (let x = 0; x < W; x++) {
    let y = 0;
    while (y < H / 2) {
      const lat = 1 - Math.abs((y / (H - 1)) * 2 - 1);
      if (classify(0.6, 0.6, lat, snowBias[y * W + x]) !== Biome.Snow) break;
      y++;
    }
    edge.push(y);
  }
  const mean = edge.reduce((s, v) => s + v, 0) / edge.length;
  const sd = Math.sqrt(edge.reduce((s, v) => s + (v - mean) ** 2, 0) / edge.length);
  assert.ok(sd > 2, `snow edge is ragged, got row sd ${sd.toFixed(2)}`);
});

test('a creature outside its comfort band moves toward a better temperature', () => {
  const biome = new Uint8Array(GRID).fill(Biome.Fields);
  const food = new Uint8Array(GRID).fill(NONE);
  const counts = new Uint32Array(FOOD_COUNT);
  const tempBase = new Float32Array(GRID).fill(0.5);
  const { pop, registry } = founderPop();
  const start = 100 * W + 100;
  tempBase[start] = 0.85; // inside the Grazer's survival band, above its comfort band
  assert.ok(spawnFounder(pop, registry, 0, start, FOUNDERS[0].startEnergy) >= 0, 'grazer spawned');

  pop.step(biome, food, counts, mulberry32(3), tempBase, 0, registry, 0);

  assert.equal(pop.speciesCounts[0], 1, 'grazer survives the step');
  assert.notEqual(pop.pos[0], start, 'grazer left the hot cell');
  assert.ok(tempBase[pop.pos[0]] < 0.85, 'grazer stepped somewhere cooler');
});

test('a creature outside its survival band dies', () => {
  const biome = new Uint8Array(GRID).fill(Biome.Fields);
  const food = new Uint8Array(GRID).fill(NONE);
  const counts = new Uint32Array(FOOD_COUNT);
  const tempBase = new Float32Array(GRID).fill(0.5);
  const { pop, registry } = founderPop();
  const start = 50 * W + 50;
  tempBase[start] = 2; // far above the Grazer's survival maximum (1.08)
  assert.ok(spawnFounder(pop, registry, 0, start, FOUNDERS[0].startEnergy) >= 0, 'grazer spawned');

  pop.step(biome, food, counts, mulberry32(3), tempBase, 0, registry, 0);

  assert.equal(pop.speciesCounts[0], 0, 'grazer died of heat');
  assert.equal(pop.count, 0);
});

test('mutation respects gene bounds and changes the genome', () => {
  const registry = new SpeciesRegistry();
  for (let s = 0; s < FOUNDERS.length; s++) registry.addFounder(FOUNDERS[s], s);
  const scratch = new Float32Array(GENE_COUNT);
  scratch.set(registry.refGenes[0]);
  const masks = {
    biomeMask: registry.refBiome[0],
    foodMask: registry.refFood[0],
  };
  mutate(scratch, 0, masks, mulberry32(1));

  let changed = 0;
  for (let g = 0; g < GENE_COUNT; g++) {
    assert.ok(
      scratch[g] >= GENES[g].min - 0.01 && scratch[g] <= GENES[g].max + 0.01,
      `mutated gene ${g} stays within bounds, got ${scratch[g]}`,
    );
    if (scratch[g] !== registry.refGenes[0][g]) changed++;
  }
  assert.ok(changed > 0, 'mutation changes at least one gene for seed 1');
});

test('a distant genome founds a new species', () => {
  const registry = new SpeciesRegistry();
  for (let s = 0; s < FOUNDERS.length; s++) registry.addFounder(FOUNDERS[s], s);

  const genes = new Float32Array(GENE_COUNT);
  genes.set(registry.refGenes[0]);
  for (let g = 0; g < GENE_COUNT; g++) genes[g] = GENES[g].max;
  const distant = {
    genes,
    off: 0,
    biomeMask: registry.refBiome[0],
    foodMask: registry.refFood[0],
  };
  const id = registry.classify(distant, 0, 0, 0, mulberry32(1));
  assert.ok(id >= FOUNDERS.length, `distant genome founds a new species, got ${id}`);
  assert.equal(registry.parent[id], 0, 'child of Grazer');
  assert.ok(registry.name[id].length > 0, `daughter is named: ${registry.name[id]}`);
  assert.ok(
    !registry.name[id].startsWith('Grazer'),
    'daughter is not named after its parent',
  );
  assert.equal(registry.generation[id], 1);
  assert.equal(registry.maxPop[id], FOUNDERS[0].maxPop);

  const same = {
    genes: registry.refGenes[0],
    off: 0,
    biomeMask: registry.refBiome[0],
    foodMask: registry.refFood[0],
  };
  assert.equal(registry.classify(same, 0, 0, 0, mulberry32(2)), 0, 'an unchanged genome stays in its species');
});

test('distant genomes do not mate', () => {
  const biome = new Uint8Array(GRID).fill(Biome.Water);
  const food = new Uint8Array(GRID).fill(NONE);
  const counts = new Uint32Array(FOOD_COUNT);
  const tempBase = new Float32Array(GRID).fill(0.5);

  const { pop, registry } = founderPop();
  const start = 100 * W + 100;
  assert.ok(spawnFounder(pop, registry, 0, start, FOUNDERS[0].startEnergy) >= 0, 'grazer spawned');
  assert.ok(
    spawnFounder(pop, registry, 3, start + 1, FOUNDERS[3].startEnergy) >= 0,
    'pike spawned',
  );
  let max = 0;
  for (let t = 0; t < 50; t++) {
    pop.step(biome, food, counts, mulberry32(100 + t), tempBase, 0, registry, t);
    max = Math.max(max, pop.count);
  }
  assert.ok(max <= 2, `opposite genomes never mate, peak population ${max}`);
  assert.equal(registry.count, FOUNDERS.length, 'no offspring species was founded');

  const pair = founderPop();
  assert.ok(spawnFounder(pair.pop, pair.registry, 0, start, FOUNDERS[0].startEnergy) >= 0);
  assert.ok(spawnFounder(pair.pop, pair.registry, 0, start + 1, FOUNDERS[0].startEnergy) >= 0);
  for (let t = 0; t < 50 && pair.pop.count < 3; t++) {
    pair.pop.step(biome, food, counts, mulberry32(200 + t), tempBase, 0, pair.registry, t);
  }
  assert.ok(pair.pop.count >= 3, `compatible neighbours reproduce, population ${pair.pop.count}`);
});

/**
 * Seed-12345 world stepped for 12000 ticks, computed once and shared by the tests that need
 * a speciated run. `firstTick` is the tick the first daughter species appeared.
 */
let speciationRun: { world: World; firstTick: number } | null = null;
function seededSpeciationRun(): { world: World; firstTick: number } {
  if (!speciationRun) {
    const world = new World();
    world.reset(12345);
    let firstTick = -1;
    for (let t = 0; t < 12000; t++) {
      world.step();
      if (firstTick < 0 && world.registry.count > FOUNDERS.length) firstTick = world.tick;
    }
    speciationRun = { world, firstTick };
  }
  return speciationRun;
}

test('speciation actually happens', () => {
  const { world, firstTick } = seededSpeciationRun();
  console.log(
    `speciation: first new species at tick ${firstTick}, ${world.registry.count} species after ${world.tick} ticks (seed 12345)`,
  );
  assert.ok(
    world.registry.count > FOUNDERS.length,
    `at least one new species after 12000 ticks, got ${world.registry.count}`,
  );
  for (let s = 0; s < world.registry.count; s++) {
    assert.ok(world.population.speciesCounts[s] >= 0, `species ${s} live count valid`);
    assert.ok(world.registry.name[s].length > 0, `species ${s} named`);
  }
});

test('daughter species get unique random names', () => {
  const { world } = seededSpeciationRun();
  const names = world.registry.name.slice(0, world.registry.count);
  assert.ok(names.length > FOUNDERS.length, 'the run speciated');
  assert.equal(new Set(names).size, names.length, `names are distinct: ${names.join(', ')}`);
  for (const name of names) {
    assert.ok(name.length > 0, 'every species is named');
    assert.doesNotMatch(name, / (2|3|4)$/, `"${name}" is not an old-style ordinal name`);
  }
  for (const name of names.slice(FOUNDERS.length)) {
    assert.doesNotMatch(
      name,
      /^(Grazer|Minnow|Hunter|Pike)$/,
      `daughter "${name}" does not reuse a founder name`,
    );
  }
});

test('a predator eats a much smaller creature', () => {
  const biome = new Uint8Array(GRID).fill(Biome.Fields);
  const food = new Uint8Array(GRID).fill(NONE);
  const counts = new Uint32Array(FOOD_COUNT);
  const tempBase = new Float32Array(GRID).fill(0.5);
  const { pop, registry } = founderPop();
  assert.ok(
    spawnCustom(pop, registry, 100 * W + 100, 110, 2, {
      size: 4,
      carnivory: 1,
      vision: 8,
      speed: 2,
      moveChance: 1,
    }) >= 0,
    'hunter spawned',
  );
  assert.ok(
    spawnCustom(pop, registry, 100 * W + 102, 60, 0, {
      size: 1,
      carnivory: 0,
      speed: 1,
      moveChance: 0,
    }) >= 0,
    'prey spawned',
  );
  const rng = mulberry32(9);
  let ticks = 0;
  while (pop.speciesCounts[0] > 0 && ticks < 100) {
    pop.step(biome, food, counts, rng, tempBase, 0, registry, ticks);
    ticks++;
  }
  assert.equal(pop.speciesCounts[0], 0, `prey eaten within ${ticks} ticks`);
  assert.ok(pop.speciesCounts[2] >= 1, 'hunter survived the hunt');
});

test('a marginal hunter needs a bigger edge than a dedicated carnivore', () => {
  const biome = new Uint8Array(GRID).fill(Biome.Fields);
  const food = new Uint8Array(GRID).fill(NONE);
  const counts = new Uint32Array(FOOD_COUNT);
  const tempBase = new Float32Array(GRID).fill(0.5);

  // A pure carnivore can tackle prey of equal mass; a marginal hunter cannot.
  const pure = founderPop();
  assert.ok(
    spawnCustom(pure.pop, pure.registry, 100 * W + 100, 200, 2, { size: 2, carnivory: 1, moveChance: 0 }) >= 0,
    'pure carnivore spawned',
  );
  assert.ok(
    spawnCustom(pure.pop, pure.registry, 100 * W + 101, 30, 0, { size: 2, carnivory: 0, moveChance: 0 }) >= 0,
    'equal-mass prey spawned',
  );
  pure.pop.step(biome, food, counts, mulberry32(4), tempBase, 0, pure.registry, 0);
  assert.equal(pure.pop.speciesCounts[0], 0, 'the pure carnivore ate its equal-mass prey');

  const marginal = founderPop();
  assert.ok(
    spawnCustom(marginal.pop, marginal.registry, 100 * W + 100, 200, 2, { size: 2, carnivory: 0.4, moveChance: 0 }) >= 0,
    'marginal hunter spawned',
  );
  assert.ok(
    spawnCustom(marginal.pop, marginal.registry, 100 * W + 101, 30, 0, { size: 2, carnivory: 0, moveChance: 0 }) >= 0,
    'equal-mass prey spawned',
  );
  marginal.pop.step(biome, food, counts, mulberry32(4), tempBase, 0, marginal.registry, 0);
  assert.equal(marginal.pop.speciesCounts[0], 1, 'the marginal hunter did not eat equal-mass prey');
});

test('a herbivore does not eat creatures and a carnivore does not graze', () => {
  const biome = new Uint8Array(GRID).fill(Biome.Fields);
  const food = new Uint8Array(GRID).fill(NONE);
  const counts = new Uint32Array(FOOD_COUNT);
  const tempBase = new Float32Array(GRID).fill(0.5);

  const grazers = founderPop();
  assert.ok(
    spawnCustom(grazers.pop, grazers.registry, 100 * W + 100, 200, 0, {
      size: 5,
      carnivory: 0,
      moveChance: 0,
    }) >= 0,
    'big herbivore spawned',
  );
  assert.ok(
    spawnCustom(grazers.pop, grazers.registry, 100 * W + 101, 30, 1, {
      size: 1,
      carnivory: 0,
      moveChance: 0,
    }) >= 0,
    'small creature spawned',
  );
  grazers.pop.step(biome, food, counts, mulberry32(5), tempBase, 0, grazers.registry, 0);
  assert.equal(grazers.pop.count, 2, 'the herbivore did not eat the small creature');
  assert.equal(grazers.pop.speciesCounts[1], 1, 'the small creature is alive');

  const carnivores = founderPop();
  const cell = 100 * W + 100;
  food[cell] = Food.Grain; // digestible for a Grazer, not for a pure carnivore
  counts[Food.Grain] = 1;
  assert.ok(
    spawnCustom(carnivores.pop, carnivores.registry, cell, 200, 0, {
      size: 5,
      carnivory: 1,
      moveChance: 0,
    }) >= 0,
    'big carnivore spawned',
  );
  carnivores.pop.step(biome, food, counts, mulberry32(6), tempBase, 0, carnivores.registry, 0);
  assert.equal(food[cell], Food.Grain, 'the carnivore did not graze the plant');
  assert.equal(counts[Food.Grain], 1, 'the food counter is unchanged');
});

test('an omnivore grazes at reduced yield', () => {
  const biome = new Uint8Array(GRID).fill(Biome.Fields);
  const food = new Uint8Array(GRID).fill(NONE);
  const counts = new Uint32Array(FOOD_COUNT);
  const tempBase = new Float32Array(GRID).fill(0.5);
  const { pop, registry } = founderPop();
  const cell = 100 * W + 100;
  const eatGain = 80;
  const metabolism = 0.5;
  food[cell] = Food.Grain;
  counts[Food.Grain] = 1;
  assert.ok(
    spawnCustom(pop, registry, cell, 100, 0, {
      size: 2,
      carnivory: 0.5,
      eatGain,
      metabolism,
      maxEnergy: 400,
      moveChance: 0,
    }) >= 0,
    'omnivore spawned',
  );
  pop.step(biome, food, counts, mulberry32(8), tempBase, 0, registry, 0);

  const expected = 100 - metabolism * Math.pow(2, 0.75) + eatGain * 0.5;
  assert.ok(
    Math.abs(pop.energy[0] - expected) < 1e-4,
    `omnivore energy ${pop.energy[0]} ~= ${expected}`,
  );
  assert.equal(food[cell], NONE, 'the grazed cell is cleared');
  assert.equal(counts[Food.Grain], 0, 'the food counter is decremented');
});

test('a bigger body pays more upkeep for the same plant meal', () => {
  const biome = new Uint8Array(GRID).fill(Biome.Fields);
  const food = new Uint8Array(GRID).fill(NONE);
  const counts = new Uint32Array(FOOD_COUNT);
  const tempBase = new Float32Array(GRID).fill(0.5);
  const { pop, registry } = founderPop();
  // Far apart — beyond even the widened rare-species mate search — so the two cannot mate.
  const smallCell = 100 * W + 100;
  const bigCell = 100 * W + 140;
  food[smallCell] = Food.Grain;
  food[bigCell] = Food.Grain;
  counts[Food.Grain] = 2;
  const common = { carnivory: 0, eatGain: 40, metabolism: 0.5, maxEnergy: 400, moveChance: 0 };
  assert.ok(spawnCustom(pop, registry, smallCell, 100, 0, { ...common, size: 1 }) >= 0, 'size 1 spawned');
  assert.ok(spawnCustom(pop, registry, bigCell, 100, 0, { ...common, size: 2 }) >= 0, 'size 2 spawned');
  pop.step(biome, food, counts, mulberry32(3), tempBase, 0, registry, 0);

  // The plant meal is a fixed `eatGain` for both; only upkeep scales with size, so the bigger
  // body ends the tick with less.
  assert.ok(
    Math.abs((pop.energy[0] - pop.energy[1]) - common.metabolism * (Math.pow(2, 0.75) - 1)) < 1e-4,
    `size 1 ends ${(pop.energy[0] - pop.energy[1]).toFixed(3)} ahead of size 2`,
  );
});

test('dietClassOf partitions the carnivory gene', () => {
  assert.equal(dietClassOf(0), 'Herbivore');
  assert.equal(dietClassOf(0.5), 'Omnivore');
  assert.equal(dietClassOf(1), 'Carnivore');
});

test('extinction is recorded', () => {
  const biome = new Uint8Array(GRID).fill(Biome.Fields);
  const food = new Uint8Array(GRID).fill(NONE);
  const counts = new Uint32Array(FOOD_COUNT);
  const tempBase = new Float32Array(GRID).fill(0.5);
  const { pop, registry } = founderPop();
  assert.ok(spawnFounder(pop, registry, 0, 100 * W + 100, 1) >= 0, 'grazer spawned');
  for (let t = 0; t < 50 && pop.count > 0; t++) {
    pop.step(biome, food, counts, mulberry32(t), tempBase, 0, registry, t);
  }
  assert.equal(pop.speciesCounts[0], 0, 'the lone grazer starved');
  assert.ok(registry.extinctTick[0] >= 0, `extinction tick recorded, got ${registry.extinctTick[0]}`);
});
