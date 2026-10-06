export const W = 512; // world cells (x)
export const H = 384; // world cells (y)
export const GRID = W * H;
export const TICK_MS = 100; // 10 sim-ticks/second at 1x
export const SPEEDS = [0.5, 1, 2] as const;
export const MAX_TICKS_PER_FRAME = 20; // accumulator spiral guard
export const REGEN_SAMPLES_PER_TICK = 1500;
export const MAX_CREATURES = 800; // hard capacity of the creature slot arrays; per-species maxPop values multiply as species split, so this pool cap binds before their sum does
export const MIN_HABITAT_AREA = 256; // cells; species are never seeded into smaller habitats
export const MAX_SPECIES = 256; // species id ceiling; at the cap, classify assigns to the nearest existing species
export const SPECIATION_DISTANCE = 0.2; // genome distance a lineage must exceed to found a new species (also the mating barrier); tuned to 17 species after 12000 ticks on the test seed
export const MATING_RADIUS = 6; // Chebyshev cells searched for a mate
export const MATING_ENERGY_FRACTION = 0.5; // fraction of reproEnergy a creature needs before it will mate
export const MUTATION_SCALE = 3; // multiplier on each gene's step size when mutating
// A single flipped categorical bit already moves a genome ~0.13-0.27, so a rate as high as
// 0.03 founds species faster than selection can act and pins the registry at MAX_SPECIES.
export const MUTATION_PROB_CATEGORICAL = 0.002; // chance to flip one bit of each categorical mask per birth
export const LOCAL_DENSITY_RADIUS = 3; // cells; window for the per-food density check in regrowTick
// That window is noisy (49 cells), so growth only stops once its typical count is well above
// the threshold: a half-scale threshold lands the crop's equilibrium cover at its stated
// maxCoverage instead of about twice it.
export const LOCAL_DENSITY_SCALE = 0.5;
export const STATS_INTERVAL_MS = 250;
export const FREQ = 6; // base noise frequency across the map
export const WARP = 1.5; // domain-warp displacement
export const FALLOFF = 0.35; // continental falloff toward map edges
export const TEMP_ALT_PENALTY = 1.2; // temperature lost per unit elevation > 0.5
export const SNOW_EDGE_FREQ = 8; // snow-line jitter frequency, as a multiple of FREQ
export const SNOW_EDGE_AMPLITUDE = 0.09; // temperature jitter along the snow line, deg C
export const SEASON_PERIOD_TICKS = 3600; // one warm/cool year; 6 min at 1x (10 ticks/s)
export const SEASON_AMPLITUDE = 0.12; // +/- temperature offset over a year
export const CLIMATE_STEP_TICKS = 30; // recompute biomes every 3 s at 1x
export const P_LOW = 0.02; // percentile-normalization clip points
export const P_HIGH = 0.98;
export const SEA_DEEP = 0.3;
export const SEA_SHALLOW = 0.4;
export const BEACH_TOP = 0.435;
export const MOUNTAIN = 0.72;
export const ALPINE_SNOW_TEMP = 0.4;
export const SNOW_TEMP = 0.32;
export const COLD_MAX = 0.45;
export const SWAMP_WET = 0.55;
export const DESERT_DRY = 0.3;
export const FIELD_MOIST = 0.5;
export const FOREST_MOIST = 0.72;
