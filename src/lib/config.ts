export const W = 512; // world cells (x)
export const H = 384; // world cells (y)
export const GRID = W * H;
export const TICK_MS = 100; // 10 sim-ticks/second at 1x
export const SPEEDS = [0.5, 1, 2] as const;
export const MAX_TICKS_PER_FRAME = 20; // accumulator spiral guard
// Regrowth attempts per tick. Each attempt only succeeds on an empty eligible cell whose local
// density is still under its cap, so this sets how fast a grazed patch refills, not the crop's
// equilibrium cover. At 1500 a herbivore almost always had food inside its vision radius (only
// ~5% of creature-ticks had none within sight) and paced between two cells as they regrew. 750
// tripled that blind-search share but the crop still refilled faster than a creature could graze
// a patch down, so nothing ranged. 400 lets a local patch deplete enough to send a hungry
// creature ranging — across the barriers its body can pass — while the crop still refills to
// half its cap or better; it collapses entirely only below ~10.
export const REGEN_SAMPLES_PER_TICK = 400;
// Computational ceiling only: the slot arrays are preallocated to this, but the population is
// meant to settle far below it, limited by food and habitat. The old 800 was hit within a few
// hundred ticks and then bound the ecology — every free slot was a birth lottery the numerous
// herbivores always won, so rare predators could not replace themselves. The physical ceiling
// is GRID (one creature per cell).
export const MAX_CREATURES = 16384;
export const MIN_HABITAT_AREA = 256; // cells; species are never seeded into smaller habitats
export const FOUNDER_GROUP = 6; // founders seeded per cluster; a bigger group finds mates but over-hunts its own patch
export const FOUNDER_CLUSTER_R = 4; // Chebyshev radius of a founder cluster; 2R < MATING_RADIUS, so every cluster member starts within mating range of the rest
// A founder cluster is centred only on a biome whose food is at least this dense. The map is
// ~47% snow at reset and snow hosts only sparse Lichen (0.02), so a uniformly placed cluster
// usually landed there and starved before it could breed — the apex founders especially, which
// cannot graze at all. Excludes Snow/Desert/Mountain (<=0.02); keeps Water (0.045), Forest and
// Swamp (0.04) and Fields (0.055).
export const FOUNDER_MIN_FOOD_DENSITY = 0.04;
// Species id ceiling; at the cap, classify assigns to the nearest existing species instead of
// founding one. 256 pinned on every long run (the test seed reaches it by ~4000 ticks), which
// both stopped speciation and forced classify into its O(count) nearest-species scan per birth.
// 1024 leaves headroom: speciesTotal reaches ~500-700 after 12000 ticks. The only O(MAX_SPECIES)
// loops (sampleWorld, assertPopulationSound) stay cheap at this size.
export const MAX_SPECIES = 1024;
// Genome distance a lineage must exceed to found a new species (also the mating barrier). The
// old 13-gene balance speciated off single categorical jumps; with only two masks left a jump
// tops out near 0.2, so the barrier is retuned to keep ~15 species after 12000 ticks on the
// test seed.
export const SPECIATION_DISTANCE = 0.12;
// Foodless biomes are barriers rather than walls: a creature whose body is up to the crossing
// may leave its genome mask at home and pass through. Body size (`GENE.size`) is the gate — the
// larger fish can swim open Deep Water, a land animal can wade a shallow channel, and a land
// animal can walk the Beach between them. Lineage (`biomeMask`) still decides which of those
// crossings applies: a swimmer never gains land, a walker never gains open water. A mask bit
// always grants a biome outright; these thresholds only widen access. The Deep Water bar is 1 rather than the founder Pike's 2.5
// because body size is only weakly selected (see `eat`): after 5000 ticks about half the fish
// have grown past 1 while almost none reach 2, so a higher bar would never fire.
export const DEEP_WATER_CROSS_SIZE = 1; // a water creature below this stays in the shallows
export const SHALLOW_WATER_CROSS_SIZE = 1; // a land creature below this cannot wade a channel
export const BEACH_CROSS_SIZE = 1; // below this even the sand is too much
export const MATING_RADIUS = 10; // Chebyshev cells searched for a mate; a rare apex predator must be able to find the partner it shares a lake or valley with
// A species at or below this live count widens its mate search to `RARE_MATING_RADIUS`. A fixed
// radius is an extinction vortex: after a predator-prey crash the last handful of hunters
// cannot find each other and die out, so carnivory never recovers once it dips. Common species
// keep the short radius, so this only rescues the rare.
export const RARE_SPECIES_COUNT = 12;
export const RARE_MATING_RADIUS = 24;
export const MATING_ENERGY_FRACTION = 0.5; // fraction of reproEnergy a creature needs before it will mate
export const MUTATION_SCALE = 3; // multiplier on each gene's step size when mutating
// A single flipped categorical bit already moves a genome ~0.13-0.27, so a rate as high as
// 0.03 founds species faster than selection can act and pins the registry at MAX_SPECIES.
export const MUTATION_PROB_CATEGORICAL = 0.002; // chance to flip one bit of each categorical mask per birth
export const HERBIVORE_MAX = 0.34; // carnivory gene below this: Herbivore (eats plants only)
export const CARNIVORE_MIN = 0.66; // carnivory gene at or above this: Carnivore (eats creatures only)
export const PREY_SIZE_RATIO = 1.3; // a predator must outweigh its prey by this factor
// The ratio a *dedicated* carnivore needs: lower, so it can tackle prey up to ~1/0.55 = 1.8x its
// own mass (pack-hunting); a marginal hunter still needs to outweigh its prey. Without it, prey
// max out `size` for immunity (a size-6 prey needs a 7-8 mass predator, above the cap) and every
// seed ends herbivore-only. It applies only at or above `CARNIVORE_MIN`: widening the ratio
// *inside* the omnivore band (measured with a linear and a cubic ramp) made omnivory the single
// best strategy and collapsed all nine seeds to 86-96% omnivore with ~4% carnivore, because a
// mid-band creature then got both the full grazing channel and a usable kill channel.
export const PREY_SIZE_RATIO_SPECIALIST = 0.55;
// A plant meal is `eatGain * (1 - carnivory)^GRAZE_CURVE`. With a linear fall (curve 1) the
// omnivore's grazing loss was proportional to its carnivory, so a mid-band creature paid little
// for grazing and gained the whole kill channel: measured, every configuration then settled at
// 82-96% omnivore and the mode ignored the environment entirely (carnivory 0.51-0.53 on all nine
// seeds whatever the plant quality). A quadratic assimilation penalty (a mixed gut digests
// foliage worse) gives `carnivory` a genuine interior optimum whose position moves with plant
// quality, so a lush seed favours grazers and a lean one favours hunters.
export const GRAZE_CURVE = 3;
export const METABOLIC_EXP = 0.75; // upkeep scales as size^METABOLIC_EXP (Kleiber-like)
// Energy per tick per unit of `vision`. Vision otherwise appears only in `findTarget`'s scan
// bounds, so selection drove it to its maximum (12) and every step scanned ~450 cells: the
// single biggest cost in the whole tick and a gene with no trade-off. A small upkeep makes a
// sharp eye a real expense, so it stays near the founders' 8 and the scan stays bounded.
export const VISION_UPKEEP = 0.04;
// Metabolism is a trade-off, not a free saving: a creature at this rate reproduces at the base
// `reproEnergy * MATING_ENERGY_FRACTION` threshold, a higher rate lowers the energy it must bank
// (breeds sooner) and a lower rate raises it (breeds later, capped at `maxEnergy` so it is never
// sterile). Without this, metabolism appeared only in upkeep, selection drove it to its floor
// and upkeep vanished, so food could not bound the population.
export const METABOLISM_REPRO_REF = 0.7;
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
export const SEASON_AMPLITUDE = 0.12; // +/- temperature offset over a year; the default the climate tests pin
// Per-seed environmental profile, derived from the seed (see `World.reset`) rather than from the
// run's own rng, so it cannot perturb the run or break the determinism test.
// `huntEfficiency` is the fraction of a carcass a predator can use. It is the one per-seed knob
// that moves the diet optimum: scaling the *plant* channel does not, because the prey's stored
// energy (the kill channel) scales with it too, so the ratio of the two channels stays put
// (measured: plant quality 0.71-1.20 moved the mean carnivory only 0.44 -> 0.49). Scaling the
// kill channel's extraction moves that ratio directly, so a lean seed (tough, poorly digestible
// prey) favours pure carnivores and a rich one favours grazers and omnivores. It never exceeds 1,
// so a kill still only moves energy and never mints it. `seasonAmplitude` is the per-seed
// temperature swing: a harsh seed crashes grazers in winter.
export const HUNT_EFFICIENCY_MIN = 0.55;
export const HUNT_EFFICIENCY_MAX = 1.0;
export const SEASON_AMPLITUDE_MIN = 0.10;
export const SEASON_AMPLITUDE_MAX = 0.26;
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
