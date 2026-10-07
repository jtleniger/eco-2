import { CARNIVORE_MIN, HERBIVORE_MAX, MUTATION_PROB_CATEGORICAL, MUTATION_SCALE } from './config.ts';
import { BIOME_COUNT, FOOD_COUNT } from './palette.ts';
import type { SpeciesTraits } from './species.ts';

/**
 * Heritable genome: continuous genes plus two categorical bitmasks. Pure and DOM-free.
 * `GENES` index order is load-bearing: it is the stride order of every genome row, and it
 * matches the numeric order of `GENE` below.
 */
export const GENE = {
  vision: 0,
  speed: 1,
  moveChance: 2,
  metabolism: 3,
  maxEnergy: 4,
  reproEnergy: 5,
  maxAge: 6,
  eatGain: 7,
  startEnergy: 8,
  tempMin: 9,
  tempMax: 10,
  comfortMin: 11,
  comfortMax: 12,
  size: 13,
  carnivory: 14,
} as const;
export const GENE_COUNT = 15;

export interface GeneSpec {
  min: number;
  max: number;
  /** Maximum mutation offset before `MUTATION_SCALE`; the clamp bounds the result. */
  step: number;
  integer: boolean;
}

/** One row per `GENE` member, in `GENE` order. */
export const GENES: readonly GeneSpec[] = [
  { min: 3, max: 12, step: 0.35, integer: true }, // vision
  { min: 1, max: 4, step: 0.12, integer: true }, // speed
  { min: 0, max: 1, step: 0.04, integer: false }, // moveChance
  { min: 0.3, max: 1.5, step: 0.04, integer: false }, // metabolism
  { min: 60, max: 320, step: 6, integer: false }, // maxEnergy
  { min: 40, max: 260, step: 6, integer: false }, // reproEnergy
  { min: 1500, max: 12000, step: 150, integer: true }, // maxAge
  { min: 15, max: 160, step: 4, integer: false }, // eatGain
  { min: 20, max: 170, step: 5, integer: false }, // startEnergy
  { min: -0.35, max: 0.45, step: 0.02, integer: false }, // tempMin
  { min: 0.6, max: 1.45, step: 0.02, integer: false }, // tempMax
  { min: -0.15, max: 0.65, step: 0.02, integer: false }, // comfortMin
  { min: 0.25, max: 1.05, step: 0.02, integer: false }, // comfortMax
  { min: 0.4, max: 6, step: 0.06, integer: false }, // size (mass)
  // Diet breadth carries more standing variation than the other continuous genes (0.04 -> 0.08).
  // The trophic classes are thirds of this axis and the equilibrium distribution is a single hump
  // of sd ~0.075, so with the older step the mode sits ~1.5 sd from each band edge and the outer
  // bands hold only 3-7% of the population. Doubling the step widens the hump enough that both
  // outer bands clear the 5% viability floor.
  { min: 0, max: 1, step: 0.08, integer: false }, // carnivory
];

export type DietClass = 'Herbivore' | 'Omnivore' | 'Carnivore';

/** Trophic class derived from the continuous carnivory gene. */
export function dietClassOf(carnivory: number): DietClass {
  return carnivory >= CARNIVORE_MIN ? 'Carnivore'
    : carnivory >= HERBIVORE_MAX ? 'Omnivore'
    : 'Herbivore';
}

/**
 * A view onto a flat genome plus its masks. Lets pool slots and registry references be
 * passed around without copying.
 */
export interface GenomeSource {
  genes: Float32Array;
  off: number;
  biomeMask: number;
  foodMask: number;
}

export interface Masks {
  biomeMask: number;
  foodMask: number;
}

/** Write one gene, clamped to its spec's range and rounded when the spec is integral. */
export function writeGene(dst: Float32Array, off: number, gene: number, value: number): void {
  const spec = GENES[gene];
  let v = value;
  if (v < spec.min) v = spec.min;
  else if (v > spec.max) v = spec.max;
  dst[off + gene] = spec.integer ? Math.round(v) : v;
}

/**
 * Mutate every gene of the genome at `off`, then independently toggle at most one bit of each
 * mask. Masks are carried in the passed `masks` object and mutated in place. A creature left
 * unable to eat anything is not special-cased: that is selection.
 */
export function mutate(dst: Float32Array, off: number, masks: Masks, rng: () => number): void {
  for (let g = 0; g < GENE_COUNT; g++) {
    const delta = (rng() * 2 - 1) * GENES[g].step * MUTATION_SCALE;
    writeGene(dst, off, g, dst[off + g] + delta);
  }
  if (rng() < MUTATION_PROB_CATEGORICAL) {
    masks.biomeMask ^= 1 << ((rng() * BIOME_COUNT) | 0);
  }
  if (rng() < MUTATION_PROB_CATEGORICAL) {
    masks.foodMask ^= 1 << ((rng() * FOOD_COUNT) | 0);
  }
}

/**
 * Sexual recombination: each gene comes from A or B by an independent coin flip, and each
 * mask is taken whole from A or B by an independent coin flip. Writes `GENE_COUNT` values
 * into `scratch[0..GENE_COUNT)` and returns the chosen masks.
 */
export function crossover(
  scratch: Float32Array,
  a: GenomeSource,
  b: GenomeSource,
  rng: () => number,
): Masks {
  for (let g = 0; g < GENE_COUNT; g++) {
    scratch[g] = rng() < 0.5 ? a.genes[a.off + g] : b.genes[b.off + g];
  }
  return {
    biomeMask: rng() < 0.5 ? a.biomeMask : b.biomeMask,
    foodMask: rng() < 0.5 ? a.foodMask : b.foodMask,
  };
}

/** Decode the genes at `off` into the plain trait object the UI and founders use. */
export function decodeTraits(genes: Float32Array, off: number): SpeciesTraits {
  return {
    vision: genes[off + GENE.vision],
    speed: genes[off + GENE.speed],
    moveChance: genes[off + GENE.moveChance],
    metabolism: genes[off + GENE.metabolism],
    maxEnergy: genes[off + GENE.maxEnergy],
    reproEnergy: genes[off + GENE.reproEnergy],
    maxAge: genes[off + GENE.maxAge],
    eatGain: genes[off + GENE.eatGain],
    startEnergy: genes[off + GENE.startEnergy],
    tempMin: genes[off + GENE.tempMin],
    tempMax: genes[off + GENE.tempMax],
    comfortMin: genes[off + GENE.comfortMin],
    comfortMax: genes[off + GENE.comfortMax],
    size: genes[off + GENE.size],
    carnivory: genes[off + GENE.carnivory],
  };
}

/** Weight of one mismatched categorical class relative to the continuous gene term. */
export const W_CAT = 0.25;

function popcount16(n: number): number {
  let x = n & 0xffff;
  x -= (x >> 1) & 0x5555;
  x = (x & 0x3333) + ((x >> 2) & 0x3333);
  x = (x + (x >> 4)) & 0x0f0f;
  return (x * 0x0101) >> 8;
}

/**
 * Normalized genomic distance in `[0, 1]`; `0` for identical genomes. Continuous genes are
 * scaled by their spec range; each of the two categorical masks contributes its Hamming
 * fraction, so a full habitat swap alone is a sizeable step toward the maximum.
 */
export function geneDistance(
  ga: Float32Array,
  oa: number,
  bma: number,
  fma: number,
  gb: Float32Array,
  ob: number,
  bmb: number,
  fmb: number,
): number {
  let aug = 0;
  for (let g = 0; g < GENE_COUNT; g++) {
    const spec = GENES[g];
    const d = (ga[oa + g] - gb[ob + g]) / (spec.max - spec.min);
    aug += d * d;
  }
  aug /= GENE_COUNT;
  const raw =
    aug +
    W_CAT * (popcount16(bma ^ bmb) / BIOME_COUNT) +
    W_CAT * (popcount16(fma ^ fmb) / FOOD_COUNT);
  return Math.sqrt(raw / (1 + 2 * W_CAT));
}
