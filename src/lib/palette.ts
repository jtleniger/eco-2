export const NONE = 255; // sentinel: no food on a cell

export function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export const BIOMES = [
  // index === biome id; DO NOT reorder
  { name: 'Deep Water', hex: '#0a2540' }, // 0
  { name: 'Water', hex: '#1d6fa5' }, // 1
  { name: 'Beach', hex: '#ddcc94' }, // 2
  { name: 'Desert', hex: '#e3c268' }, // 3
  { name: 'Fields', hex: '#8cc152' }, // 4
  { name: 'Forest', hex: '#34703a' }, // 5
  { name: 'Swamp', hex: '#4e6b4a' }, // 6
  { name: 'Mountain', hex: '#8d8d88' }, // 7
  { name: 'Snow', hex: '#f0f4f8' }, // 8
] as const;

export const FOODS = [
  // index === food id; DO NOT reorder
  { name: 'Algae', hex: '#2fbf71', biomes: [1], density: 0.06, maxCoverage: 0.14 },
  { name: 'Cactus Fruit', hex: '#e0632c', biomes: [3], density: 0.015, maxCoverage: 0.04 },
  { name: 'Grain', hex: '#f2d35e', biomes: [4], density: 0.07, maxCoverage: 0.16 },
  { name: 'Berries', hex: '#b5457f', biomes: [5], density: 0.05, maxCoverage: 0.12 },
  { name: 'Mushroom', hex: '#b06f3a', biomes: [6], density: 0.05, maxCoverage: 0.12 },
  { name: 'Lichen', hex: '#a8e0d0', biomes: [7, 8], density: 0.025, maxCoverage: 0.07 },
] as const;

export const BIOME_COUNT = BIOMES.length;
export const FOOD_COUNT = FOODS.length;

/** Numeric index union of an array/tuple type. */
export type Ids<T extends readonly unknown[]> = {
  [K in keyof T]: K extends `${infer N extends number}` ? N : never;
}[number];

export type BiomeId = Ids<typeof BIOMES>;
export type FoodId = Ids<typeof FOODS>;

/** Named ids for the BIOMES order above; values MUST match its indices. */
export const Biome = {
  DeepWater: 0,
  Water: 1,
  Beach: 2,
  Desert: 3,
  Fields: 4,
  Forest: 5,
  Swamp: 6,
  Mountain: 7,
  Snow: 8,
} as const;

/** Named ids for the FOODS order above; values MUST match its indices. */
export const Food = {
  Algae: 0,
  CactusFruit: 1,
  Grain: 2,
  Berries: 3,
  Mushroom: 4,
  Lichen: 5,
} as const;

/** `BIOME_COUNT * 3` bytes: RGB per biome id. */
export const BIOME_LUT = new Uint8Array(BIOME_COUNT * 3);
/** `FOOD_COUNT * 3` bytes: RGB per food id. */
export const FOOD_LUT = new Uint8Array(FOOD_COUNT * 3);

for (let i = 0; i < BIOME_COUNT; i++) {
  const [r, g, b] = hexToRgb(BIOMES[i].hex);
  BIOME_LUT[i * 3] = r;
  BIOME_LUT[i * 3 + 1] = g;
  BIOME_LUT[i * 3 + 2] = b;
}
for (let i = 0; i < FOOD_COUNT; i++) {
  const [r, g, b] = hexToRgb(FOODS[i].hex);
  FOOD_LUT[i * 3] = r;
  FOOD_LUT[i * 3 + 1] = g;
  FOOD_LUT[i * 3 + 2] = b;
}

/** Entry `b` = food ids eligible on biome `b`. Beach and Deep Water have none. */
export const FOODS_BY_BIOME: readonly Uint8Array[] = (() => {
  const lists: number[][] = Array.from({ length: BIOME_COUNT }, () => []);
  for (let id = 0; id < FOOD_COUNT; id++) {
    for (const b of FOODS[id].biomes) lists[b].push(id);
  }
  return lists.map((l) => Uint8Array.from(l));
})();
