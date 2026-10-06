/// <reference types="node" />
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  GRID,
  H,
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
import { GENE_COUNT, GENES, classMaskOf, mutate } from './genetics.ts';
import { Biome, FOODS, FOOD_COUNT, NONE, hexToRgb } from './palette.ts';
import { mulberry32 } from './rng.ts';
import { FOUNDERS, SPECIES_PALETTE_LUT, SpeciesRegistry } from './species.ts';
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
    assert.equal(
      pop.cls[i],
      classMaskOf(pop.foodMask[i], pop.preyMask[i]),
      `slot ${i} trophic class matches its masks`,
    );
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
    let preyMask = 0;
    for (const c of spec.preyClasses) preyMask |= c;
    assert.equal(registry.refPrey[s], preyMask, `${spec.name} prey mask`);
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

test('grazing is replenished, not drained away from the grazers', () => {
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
    assert.ok(grazed.counts[f] >= cap * 0.5, `${FOODS[f].name} is not grazed out`);
  }
  assert.ok(
    grazed.counts.reduce((a, b) => a + b, 0) < stocked.counts.reduce((a, b) => a + b, 0),
    'grazing removes standing crop an unstocked world keeps at capacity',
  );
  // The crop eaten by herbivores has to come back where they are, not somewhere else: their
  // stored energy is what drains away when it does not.
  for (let s = 0; s < FOUNDERS.length; s++) {
    if (FOUNDERS[s].foods.length === 0) continue;
    let sum = 0;
    let n = 0;
    for (let i = 0; i < grazed.population.count; i++) {
      if (grazed.population.species[i] !== s) continue;
      sum += grazed.population.energy[i];
      n++;
    }
    assert.ok(n > 0, `${FOUNDERS[s].name} is still alive`);
    assert.ok(
      sum / n > FOUNDERS[s].maxEnergy * 0.4,
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
    preyMask: registry.refPrey[0],
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
    preyMask: registry.refPrey[0],
  };
  const id = registry.classify(distant, 0, 0, 0);
  assert.ok(id >= FOUNDERS.length, `distant genome founds a new species, got ${id}`);
  assert.equal(registry.parent[id], 0, 'child of Grazer');
  assert.ok(registry.name[id].startsWith('Grazer'), `named after its parent: ${registry.name[id]}`);
  assert.equal(registry.generation[id], 1);
  assert.equal(registry.maxPop[id], FOUNDERS[0].maxPop);

  const same = {
    genes: registry.refGenes[0],
    off: 0,
    biomeMask: registry.refBiome[0],
    foodMask: registry.refFood[0],
    preyMask: registry.refPrey[0],
  };
  assert.equal(registry.classify(same, 0, 0, 0), 0, 'an unchanged genome stays in its species');
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

test('speciation actually happens', () => {
  const world = new World();
  world.reset(12345);
  let firstTick = -1;
  for (let t = 0; t < 12000; t++) {
    world.step();
    if (firstTick < 0 && world.registry.count > FOUNDERS.length) firstTick = world.tick;
  }
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
