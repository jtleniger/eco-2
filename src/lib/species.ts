import { MAX_SPECIES, PREY_SIZE_RATIO, SPECIATION_DISTANCE } from './config.ts';
import {
  GENE,
  GENE_COUNT,
  type GenomeSource,
  dietClassOf,
  geneDistance,
  writeGene,
} from './genetics.ts';
import { generateName } from './names.ts';
import { BIOMES, BIOME_COUNT, Biome, FOODS, FOOD_COUNT, Food, hexToRgb } from './palette.ts';

const LAND = [
  Biome.Beach,
  Biome.Desert,
  Biome.Fields,
  Biome.Forest,
  Biome.Swamp,
  Biome.Mountain,
  Biome.Snow,
] as const;

/** The heritable, continuous part of a creature's genome, in plain-object form. */
export interface SpeciesTraits {
  vision: number;
  speed: number;
  moveChance: number;
  metabolism: number;
  maxEnergy: number;
  reproEnergy: number;
  maxAge: number;
  eatGain: number;
  startEnergy: number;
  tempMin: number;
  tempMax: number;
  comfortMin: number;
  comfortMax: number;
  size: number;
  carnivory: number;
}

/** A founder lineage: its traits plus the categorical genes and initial population. */
export interface FounderSpec extends SpeciesTraits {
  name: string;
  hex: string;
  biomes: readonly number[];
  foods: readonly number[];
  initial: number;
  maxPop: number;
}

/**
 * The only four founder lineages; every genome in the world descends from these. Values are
 * the original hand-tuned species, unchanged, and carry zero genetic variance.
 */
export const FOUNDERS: readonly FounderSpec[] = [
  {
    name: 'Grazer',
    hex: '#ffff00',
    biomes: LAND,
    foods: [Food.CactusFruit, Food.Grain, Food.Berries, Food.Mushroom, Food.Lichen],
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
    size: 1.0,
    carnivory: 0.0,
  },
  {
    name: 'Minnow',
    hex: '#00f0ff',
    biomes: [Biome.Water],
    foods: [Food.Algae],
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
    size: 0.6,
    carnivory: 0.0,
  },
  {
    name: 'Hunter',
    hex: '#ff1a1a',
    biomes: LAND,
    foods: [],
    vision: 8,
    speed: 2,
    moveChance: 1,
    metabolism: 0.6,
    maxEnergy: 200,
    reproEnergy: 120,
    maxAge: 8000,
    eatGain: 90,
    startEnergy: 110,
    initial: 48,
    maxPop: 160,
    tempMin: -0.05,
    tempMax: 1.08,
    comfortMin: 0.3,
    comfortMax: 0.7,
    size: 3.0,
    carnivory: 1.0,
  },
  {
    name: 'Pike',
    hex: '#ff00ff',
    biomes: [Biome.Water],
    foods: [],
    vision: 8,
    speed: 2,
    moveChance: 1,
    metabolism: 0.6,
    maxEnergy: 200,
    reproEnergy: 120,
    maxAge: 7000,
    eatGain: 90,
    startEnergy: 110,
    initial: 48,
    maxPop: 64,
    tempMin: -0.05,
    tempMax: 1.12,
    comfortMin: 0.42,
    comfortMax: 0.85,
    size: 2.5,
    carnivory: 1.0,
  },
];

/** Write every trait of `traits` into the genome row at `off`. */
export function writeTraits(genes: Float32Array, off: number, traits: SpeciesTraits): void {
  writeGene(genes, off, GENE.vision, traits.vision);
  writeGene(genes, off, GENE.speed, traits.speed);
  writeGene(genes, off, GENE.moveChance, traits.moveChance);
  writeGene(genes, off, GENE.metabolism, traits.metabolism);
  writeGene(genes, off, GENE.maxEnergy, traits.maxEnergy);
  writeGene(genes, off, GENE.reproEnergy, traits.reproEnergy);
  writeGene(genes, off, GENE.maxAge, traits.maxAge);
  writeGene(genes, off, GENE.eatGain, traits.eatGain);
  writeGene(genes, off, GENE.startEnergy, traits.startEnergy);
  writeGene(genes, off, GENE.tempMin, traits.tempMin);
  writeGene(genes, off, GENE.tempMax, traits.tempMax);
  writeGene(genes, off, GENE.comfortMin, traits.comfortMin);
  writeGene(genes, off, GENE.comfortMax, traits.comfortMax);
  writeGene(genes, off, GENE.size, traits.size);
  writeGene(genes, off, GENE.carnivory, traits.carnivory);
}

function hslToHex(h: number, s: number, l: number): string {
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const c = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(255 * c)
      .toString(16)
      .padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

/** The four founder colours, then 20 generated ones; species take a slot, never a derived hex. */
export const SPECIES_PALETTE: readonly string[] = [
  ...FOUNDERS.map((f) => f.hex),
  ...Array.from({ length: 20 }, (_, i) => hslToHex((i / 20) * 360, 0.85, 0.6)),
];
export const SPECIES_PALETTE_COUNT = SPECIES_PALETTE.length;

/** `SPECIES_PALETTE_COUNT * 3` bytes: RGB per colour slot, `NONE = 255` stays free. */
export const SPECIES_PALETTE_LUT = new Uint8Array(SPECIES_PALETTE_COUNT * 3);
for (let i = 0; i < SPECIES_PALETTE_COUNT; i++) {
  const [r, g, b] = hexToRgb(SPECIES_PALETTE[i]);
  SPECIES_PALETTE_LUT[i * 3] = r;
  SPECIES_PALETTE_LUT[i * 3 + 1] = g;
  SPECIES_PALETTE_LUT[i * 3 + 2] = b;
}

/** UI-facing snapshot of one species; `pushSpecies` rebuilds these from the registry. */
export interface SpeciesInfo {
  id: number;
  name: string;
  hex: string;
  live: number;
  peak: number;
  maxPop: number;
  founderTick: number;
  extinctTick: number;
  parentName: string | null;
  generation: number;
  diet: string;
  habitat: string;
  dietClass: string;
  prey: string;
  traits: SpeciesTraits;
}

/** Names of the biomes whose bit is set in `mask`, or `none` when it is empty. */
export function habitatLabel(mask: number): string {
  const names: string[] = [];
  for (let b = 0; b < BIOME_COUNT; b++) if ((mask >>> b) & 1) names.push(BIOMES[b].name);
  return names.length ? names.join(', ') : 'none';
}

/** Names of the foods a `foodMask` allows, or `—`. */
export function dietLabel(mask: number): string {
  const names: string[] = [];
  for (let f = 0; f < FOOD_COUNT; f++) if ((mask >>> f) & 1) names.push(FOODS[f].name);
  return names.length ? names.join(', ') : '—';
}

/** Description of the creatures a predator can eat, or `''` for a Herbivore. */
export function preyLabel(carnivory: number, size: number): string {
  if (dietClassOf(carnivory) === 'Herbivore') return '';
  return `creatures under ${(size / PREY_SIZE_RATIO).toFixed(1)}`;
}

/** First `generateName` (Title-cased) not already used by a species. */
function uniqueName(used: readonly string[], rng: () => number): string {
  for (let i = 0; i < 200; i++) {
    const w = generateName(rng);
    const name = w[0].toUpperCase() + w.slice(1);
    if (!used.includes(name)) return name;
  }
  return `Species ${used.length}`;
}

/**
 * Bookkeeping for every species ever created: ids are dense and never reused. Founder i is
 * registered by `addFounder`; a genome far enough from both parents founds a new id via
 * `classify`. Each species keeps one reference genome, the anchor its descendants are
 * measured against.
 */
export class SpeciesRegistry {
  count = 0;
  readonly name: string[] = [];
  /** Parent species id, `-1` for a founder. */
  readonly parent: number[] = [];
  readonly colorSlot: number[] = [];
  readonly founderTick: number[] = [];
  /** `-1` while alive, else the tick its live count hit zero. */
  readonly extinctTick: number[] = [];
  readonly peak: number[] = [];
  readonly maxPop: number[] = [];
  readonly generation: number[] = [];
  readonly refGenes: Float32Array[] = [];
  readonly refBiome: number[] = [];
  readonly refFood: number[] = [];
  /**
   * slot -> bit `b` set once a live member of this species has stood on biome `b`. This is the
   * species' observed habitat: its genome's `biomeMask` is only a passability capability, and
   * mutation can add bits (Deep Water and Beach host no food) that no member ever visits, so
   * the capability is not what the menu should report.
   */
  readonly habitat: Uint16Array = new Uint16Array(MAX_SPECIES);

  /** Register founder `index` (0..FOUNDERS.length-1) at species id `index`. */
  addFounder(spec: FounderSpec, index: number): void {
    const genes = new Float32Array(GENE_COUNT);
    writeTraits(genes, 0, spec);
    let biomeMask = 0;
    for (const b of spec.biomes) biomeMask |= 1 << b;
    let foodMask = 0;
    for (const f of spec.foods) foodMask |= 1 << f;

    this.name[index] = spec.name;
    this.parent[index] = -1;
    this.colorSlot[index] = index;
    this.founderTick[index] = 0;
    this.extinctTick[index] = -1;
    this.peak[index] = 0;
    this.maxPop[index] = spec.maxPop;
    this.generation[index] = 0;
    this.refGenes[index] = genes;
    this.refBiome[index] = biomeMask;
    this.refFood[index] = foodMask;
    if (index >= this.count) this.count = index + 1;
  }

  /**
   * Found a new species descended from `parentId`, copying `src` as its reference genome and
   * naming it with a fresh seeded word.
   */
  addChild(src: GenomeSource, parentId: number, tick: number, rng: () => number): number {
    const id = this.count++;
    const genes = new Float32Array(GENE_COUNT);
    for (let g = 0; g < GENE_COUNT; g++) genes[g] = src.genes[src.off + g];

    this.name[id] = uniqueName(this.name, rng);
    this.parent[id] = parentId;
    this.colorSlot[id] = 4 + ((id - 4) % (SPECIES_PALETTE_COUNT - 4));
    this.founderTick[id] = tick;
    this.extinctTick[id] = -1;
    this.peak[id] = 0;
    this.maxPop[id] = this.maxPop[parentId];
    this.generation[id] = this.generation[parentId] + 1;
    this.refGenes[id] = genes;
    this.refBiome[id] = src.biomeMask;
    this.refFood[id] = src.foodMask;
    return id;
  }

  /** A view onto species `id`'s reference genome. Allocates; not for the per-creature path. */
  refOf(id: number): GenomeSource {
    return {
      genes: this.refGenes[id],
      off: 0,
      biomeMask: this.refBiome[id],
      foodMask: this.refFood[id],
    };
  }

  private distanceTo(src: GenomeSource, id: number): number {
    return geneDistance(
      src.genes,
      src.off,
      src.biomeMask,
      src.foodMask,
      this.refGenes[id],
      0,
      this.refBiome[id],
      this.refFood[id],
    );
  }

  /**
   * Assign a newborn genome to a species: `parentA` when it is still close enough to it,
   * else `parentB`, else a new species. Once `MAX_SPECIES` is reached, the nearest existing
   * species is used instead (ties go to the lowest id).
   */
  classify(src: GenomeSource, parentA: number, parentB: number, tick: number, rng: () => number): number {
    if (this.distanceTo(src, parentA) <= SPECIATION_DISTANCE) return parentA;
    if (parentB !== parentA && this.distanceTo(src, parentB) <= SPECIATION_DISTANCE) return parentB;
    if (this.count < MAX_SPECIES) return this.addChild(src, parentA, tick, rng);

    let best = parentA;
    let bestD = this.distanceTo(src, parentA);
    for (let s = 0; s < this.count; s++) {
      const d = this.distanceTo(src, s);
      if (d < bestD) {
        bestD = d;
        best = s;
      }
    }
    return best;
  }
}
