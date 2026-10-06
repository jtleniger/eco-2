import { BIOME_COUNT, Biome, Food, FOOD_COUNT, hexToRgb, type Ids } from './palette.ts';

const LAND = [
  Biome.Beach,
  Biome.Desert,
  Biome.Fields,
  Biome.Forest,
  Biome.Swamp,
  Biome.Mountain,
  Biome.Snow,
] as const;

/** Single source of truth for the four creature species; index === species id. DO NOT reorder. */
export const SPECIES = [
  // Field meanings, all read verbatim by `creatures.ts`:
  //   biomes     biomes the species may occupy
  //   foods      food ids it eats off the ground
  //   prey       species ids it hunts
  //   vision     search radius in cells (disk)
  //   speed      cells it may move toward a target per tick
  //   moveChance probability of a random step when it has no target
  //   metabolism energy lost per tick
  //   maxEnergy  energy cap
  //   reproEnergy energy needed to split
  //   maxAge     ticks before old-age death
  //   eatGain    energy per meal
  //   startEnergy energy at spawn
  //   initial    individuals at world reset
  //   maxPop     live cap for this species
  //   tempMin/tempMax       normalized temperature [0,1]+season the species dies outside of
  //   comfortMin/comfortMax normalized temperature band it seeks when outside
  {
    name: 'Grazer',
    hex: '#ffff00',
    biomes: LAND,
    foods: [Food.CactusFruit, Food.Grain, Food.Berries, Food.Mushroom, Food.Lichen],
    prey: [],
    vision: 6,
    speed: 1,
    moveChance: 0.8,
    metabolism: 0.8,
    maxEnergy: 120,
    reproEnergy: 100,
    maxAge: 6000,
    eatGain: 40,
    startEnergy: 70,
    initial: 80,
    maxPop: 300,
    tempMin: -0.08,
    tempMax: 1.08,
    comfortMin: 0.28,
    comfortMax: 0.72,
  },
  {
    name: 'Minnow',
    hex: '#00f0ff',
    biomes: [Biome.Water],
    foods: [Food.Algae],
    prey: [],
    vision: 6,
    speed: 1,
    moveChance: 0.9,
    metabolism: 0.7,
    maxEnergy: 120,
    reproEnergy: 100,
    maxAge: 5000,
    eatGain: 35,
    startEnergy: 70,
    initial: 80,
    maxPop: 300,
    tempMin: -0.12,
    tempMax: 0.98,
    comfortMin: 0.16,
    comfortMax: 0.58,
  },
  {
    name: 'Hunter',
    hex: '#ff1a1a',
    biomes: LAND,
    foods: [],
    prey: [0], // prey ids are species indices: 0 = Grazer
    vision: 8,
    speed: 2,
    moveChance: 1,
    metabolism: 0.05,
    maxEnergy: 200,
    reproEnergy: 120,
    maxAge: 8000,
    eatGain: 90,
    startEnergy: 110,
    initial: 12,
    maxPop: 60,
    tempMin: -0.05,
    tempMax: 1.08,
    comfortMin: 0.3,
    comfortMax: 0.7,
  },
  {
    name: 'Pike',
    hex: '#ff00ff',
    biomes: [Biome.Water],
    foods: [],
    prey: [1], // 1 = Minnow
    vision: 8,
    speed: 2,
    moveChance: 1,
    metabolism: 0.05,
    maxEnergy: 200,
    reproEnergy: 120,
    maxAge: 7000,
    eatGain: 90,
    startEnergy: 110,
    initial: 16,
    maxPop: 16,
    tempMin: -0.05,
    tempMax: 1.12,
    comfortMin: 0.42,
    comfortMax: 0.85,
  },
] as const;

export const SPECIES_COUNT = SPECIES.length;

export type SpeciesId = Ids<typeof SPECIES>;

/** `SPECIES_COUNT * 3` bytes: RGB per species id. */
export const SPECIES_LUT = new Uint8Array(SPECIES_COUNT * 3);

/** Entry `s` = `[biome] -> 0/1`; which biomes species `s` may occupy. */
export const SPECIES_PASSABLE: readonly Uint8Array[] = [];
/** Entry `s` = `[food] -> 0/1`; which foods species `s` eats off the ground. */
export const SPECIES_EATS: readonly Uint8Array[] = [];
/** Entry `s` = `[species] -> 0/1`; which species `s` hunts. */
export const SPECIES_HUNTS: readonly Uint8Array[] = [];

const passableLists = SPECIES_PASSABLE as Uint8Array[];
const eatsLists = SPECIES_EATS as Uint8Array[];
const huntsLists = SPECIES_HUNTS as Uint8Array[];

for (let s = 0; s < SPECIES_COUNT; s++) {
  const sp = SPECIES[s];
  const [r, g, b] = hexToRgb(sp.hex);
  SPECIES_LUT[s * 3] = r;
  SPECIES_LUT[s * 3 + 1] = g;
  SPECIES_LUT[s * 3 + 2] = b;

  const passable = new Uint8Array(BIOME_COUNT);
  for (const biome of sp.biomes as readonly number[]) passable[biome] = 1;
  passableLists.push(passable);

  const eats = new Uint8Array(FOOD_COUNT);
  for (const food of sp.foods as readonly number[]) eats[food] = 1;
  eatsLists.push(eats);

  const hunts = new Uint8Array(SPECIES_COUNT);
  for (const prey of sp.prey as readonly number[]) hunts[prey] = 1;
  huntsLists.push(hunts);
}
