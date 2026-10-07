import {
  BEACH_CROSS_SIZE,
  CARNIVORE_MIN,
  DEEP_WATER_CROSS_SIZE,
  FOUNDER_CLUSTER_R,
  FOUNDER_GROUP,
  FOUNDER_MIN_FOOD_DENSITY,
  GRID,
  H,
  HERBIVORE_MAX,
  MATING_ENERGY_FRACTION,
  MATING_RADIUS,
  MAX_CREATURES,
  MAX_SPECIES,
  METABOLIC_EXP,
  METABOLISM_REPRO_REF,
  MIN_HABITAT_AREA,
  PREY_SIZE_RATIO,
  RARE_MATING_RADIUS,
  RARE_SPECIES_COUNT,
  SHALLOW_WATER_CROSS_SIZE,
  SPECIATION_DISTANCE,
  W,
} from './config.ts';
import { BIOME_COUNT, Biome, FOODS, FOODS_BY_BIOME, LAND_MASK, NONE } from './palette.ts';
import {
  GENE,
  GENE_COUNT,
  type GenomeSource,
  type Masks,
  crossover,
  geneDistance,
  mutate,
} from './genetics.ts';
import { FOUNDERS, SpeciesRegistry } from './species.ts';

/**
 * Creature agents in a fixed-capacity slot pool. Every array is preallocated, so a tick
 * allocates nothing. Behaviour is read from each individual's own genome, so lineages drift;
 * DOM-free: usable from a headless harness.
 */
export class Population {
  readonly capacity: number;
  count: number;
  /** Live count per species id (`MAX_SPECIES` entries). */
  readonly speciesCounts: Uint32Array;
  /** slot -> species id */
  readonly species: Uint32Array;
  /** slot -> species colour slot */
  readonly color: Uint8Array;
  /** `capacity * GENE_COUNT` floats: the genome of each slot. */
  readonly genes: Float32Array;
  /** slot -> bit `b` set when the creature may stand on biome `b`. */
  readonly biomeMask: Uint16Array;
  /** slot -> bit `f` set when the creature eats food `f`. */
  readonly foodMask: Uint16Array;
  /** slot -> 1 once it has mated this tick. */
  readonly mated: Uint8Array;
  /** slot -> cell index (`y * W + x`) */
  readonly pos: Int32Array;
  readonly energy: Float32Array;
  readonly age: Uint32Array;
  /** slot -> 1 when killed earlier this tick and awaiting sweep */
  readonly dead: Uint8Array;
  /** cell -> slot index | -1 (last writer wins) */
  readonly occupant: Int32Array;

  /** Reused offspring genome; never read outside `mate`. */
  private readonly genesScratch = new Float32Array(GENE_COUNT);

  constructor(capacity: number = MAX_CREATURES) {
    this.capacity = capacity;
    this.count = 0;
    this.speciesCounts = new Uint32Array(MAX_SPECIES);
    this.species = new Uint32Array(capacity);
    this.color = new Uint8Array(capacity);
    this.genes = new Float32Array(capacity * GENE_COUNT);
    this.biomeMask = new Uint16Array(capacity);
    this.foodMask = new Uint16Array(capacity);
    this.mated = new Uint8Array(capacity);
    this.pos = new Int32Array(capacity);
    this.energy = new Float32Array(capacity);
    this.age = new Uint32Array(capacity);
    this.dead = new Uint8Array(capacity);
    this.occupant = new Int32Array(GRID).fill(-1);
  }

  /**
   * Create one individual at cell `at` from genome `src`, crediting `registry`'s peak.
   * Returns the slot index, or `-1` when the pool is full.
   */
  spawn(
    at: number,
    energy: number,
    speciesId: number,
    colorSlot: number,
    src: GenomeSource,
    registry: SpeciesRegistry,
  ): number {
    if (this.count === this.capacity) return -1;
    const i = this.count;
    const o = i * GENE_COUNT;
    for (let g = 0; g < GENE_COUNT; g++) this.genes[o + g] = src.genes[src.off + g];
    this.biomeMask[i] = src.biomeMask;
    this.foodMask[i] = src.foodMask;
    this.color[i] = colorSlot;
    this.species[i] = speciesId;
    this.pos[i] = at;
    this.energy[i] = energy;
    this.age[i] = 0;
    this.dead[i] = 0;
    this.mated[i] = 0;
    this.occupant[at] = i;
    const live = ++this.speciesCounts[speciesId];
    if (live === 1) registry.extinctTick[speciesId] = -1;
    if (live > registry.peak[speciesId]) registry.peak[speciesId] = live;
    this.count = i + 1;
    return i;
  }

  /** Distance from the offspring genome left in `genesScratch` to the genome of live slot `k`. */
  private childDistance(k: number, masks: Masks): number {
    return geneDistance(
      this.genesScratch,
      0,
      masks.biomeMask,
      masks.foodMask,
      this.genes,
      k * GENE_COUNT,
      this.biomeMask[k],
      this.foodMask[k],
    );
  }

  /** A view onto slot `k`'s genome. Allocates; only used on the mating path. */
  private srcOf(k: number): GenomeSource {
    return {
      genes: this.genes,
      off: k * GENE_COUNT,
      biomeMask: this.biomeMask[k],
      foodMask: this.foodMask[k],
    };
  }

  /** Swap-remove slot `i`, patching the occupant grid and recording extinction in `registry`. */
  private remove(i: number, registry: SpeciesRegistry, tick: number): void {
    const last = this.count - 1;
    const s = this.species[i];
    if (--this.speciesCounts[s] === 0) registry.extinctTick[s] = tick;
    if (this.occupant[this.pos[i]] === i) this.occupant[this.pos[i]] = -1;
    if (i !== last) {
      const oi = i * GENE_COUNT;
      const ol = last * GENE_COUNT;
      this.genes.copyWithin(oi, ol, ol + GENE_COUNT);
      this.biomeMask[i] = this.biomeMask[last];
      this.foodMask[i] = this.foodMask[last];
      this.color[i] = this.color[last];
      this.species[i] = this.species[last];
      this.mated[i] = this.mated[last];
      this.pos[i] = this.pos[last];
      this.energy[i] = this.energy[last];
      this.age[i] = this.age[last];
      this.dead[i] = this.dead[last];
      if (this.occupant[this.pos[i]] === last) this.occupant[this.pos[i]] = i;
    }
    this.dead[last] = 0;
    this.count = last;
  }

  /**
   * Move live slot `k` into `speciesId`, keeping the per-species counters, colour and peak in
   * step, and recording the extinction of the species it leaves behind. Called when a birth
   * founds a species: both parents join it, so the daughter lineage starts as a breeding pair
   * (or more) instead of a single member that can never reproduce.
   */
  private adopt(k: number, speciesId: number, registry: SpeciesRegistry, tick: number): void {
    const old = this.species[k];
    if (old === speciesId) return;
    if (--this.speciesCounts[old] === 0) registry.extinctTick[old] = tick;
    this.species[k] = speciesId;
    this.color[k] = registry.colorSlot[speciesId];
    const live = ++this.speciesCounts[speciesId];
    if (live === 1) registry.extinctTick[speciesId] = -1;
    if (live > registry.peak[speciesId]) registry.peak[speciesId] = live;
  }

  /** Relocate slot `i`; returns the occupant slot it displaced, or `-1`. */
  private move(i: number, to: number): number {
    const prev = this.occupant[to];
    if (this.occupant[this.pos[i]] === i) this.occupant[this.pos[i]] = -1;
    this.pos[i] = to;
    this.occupant[to] = i;
    return prev === i ? -1 : prev;
  }

  /** Body mass (gene `size`) of live slot `k`. */
  private massOf(k: number): number {
    return this.genes[k * GENE_COUNT + GENE.size];
  }

  /**
   * Whether slot `i` may enter biome `b` without it being set in its genome mask: a foodless
   * barrier its body is big enough to cross. A big water creature can swim open Deep Water and
   * a big land creature can wade shallow Water or walk the Beach between them.
   * The lineage check keeps swimmers in the water and walkers on land; size is the gate.
   */
  private canCross(i: number, b: number): boolean {
    const mask = this.biomeMask[i];
    if (b === Biome.DeepWater) {
      return (mask & (1 << Biome.Water)) !== 0 && this.massOf(i) >= DEEP_WATER_CROSS_SIZE;
    }
    if (b === Biome.Water) {
      return (mask & LAND_MASK) !== 0 && this.massOf(i) >= SHALLOW_WATER_CROSS_SIZE;
    }
    if (b === Biome.Beach) {
      return (mask & LAND_MASK) !== 0 && this.massOf(i) >= BEACH_CROSS_SIZE;
    }
    return false;
  }

  /** True when slot `i` may stand on biome `b`: a genome mask bit, or a wading/swimming cross. */
  private canEnter(i: number, b: number): boolean {
    return ((this.biomeMask[i] >>> b) & 1) === 1 || this.canCross(i, b);
  }

  /** Creatures slot `i` may kill: it hunts, and `j` is small enough for its carnivory. */
  private canEatCreature(i: number, j: number, biome: Uint8Array): boolean {
    if (j < 0 || j === i || this.dead[j]) return false;
    const o = i * GENE_COUNT;
    const carnivory = this.genes[o + GENE.carnivory];
    if (carnivory < HERBIVORE_MAX) return false;
    // A dedicated carnivore can tackle prey near its own size; a marginal hunter needs a big
    // edge. Rewards carnivory, and stops prey becoming invulnerable by maxing body size —
    // with a flat ratio an arms race pushed herbivores to the size ceiling, where nothing
    // could eat them and every seed ended herbivore-only.
    const ratio = 1 + (PREY_SIZE_RATIO - 1) * (1 - carnivory);
    if (this.massOf(i) < this.massOf(j) * ratio) return false;
    return this.canEnter(i, biome[this.pos[j]]);
  }

  /** Plant `f` slot `i` may graze: digestible bit set and it is not a pure predator. */
  private canEatPlant(i: number, f: number): boolean {
    if (f === NONE) return false;
    if (((this.foodMask[i] >>> f) & 1) !== 1) return false;
    return this.genes[i * GENE_COUNT + GENE.carnivory] < CARNIVORE_MIN;
  }

  /**
   * Energy slot `i` must bank before it will reproduce. A high metabolic rate burns energy but
   * brings reproduction forward; a low rate is cheap to keep but must bank more first. Clamped
   * to `maxEnergy`, so the slowest metabolism is never sterile, only slow. Without this,
   * metabolism appeared only in upkeep, selection drove it to its floor and upkeep vanished,
   * so no amount of food could bound the population.
   */
  private reproNeed(i: number): number {
    const o = i * GENE_COUNT;
    const need = this.genes[o + GENE.reproEnergy] * MATING_ENERGY_FRACTION
      * (METABOLISM_REPRO_REF / this.genes[o + GENE.metabolism]);
    return Math.min(need, this.genes[o + GENE.maxEnergy]);
  }

  /**
   * Nearest visible target, or `-1`. Tracks the nearest plant and the nearest edible creature
   * separately: a hunter prefers prey it can see (a pure carnivore has no other option), while
   * a herbivore takes the plant. An omnivore takes the nearer prey only when it is not far past
   * the plant it is standing among — otherwise it grazes. A single nearest-edible scan made
   * omnivores chase whatever was closest, and since crop cover is a hundredfold denser than
   * prey they almost always chased a plant, so their carnivory was paid for but never used.
   */
  private findTarget(i: number, biome: Uint8Array, food: Uint8Array): number {
    const o = i * GENE_COUNT;
    const vision = this.genes[o + GENE.vision];
    const hunter = this.genes[o + GENE.carnivory] >= HERBIVORE_MAX;
    const cx = this.pos[i] % W;
    const cy = (this.pos[i] / W) | 0;
    const r2 = vision * vision;
    let plant = -1;
    let plantD = r2 + 1;
    let prey = -1;
    let preyD = r2 + 1;

    for (let dy = -vision; dy <= vision; dy++) {
      const y = cy + dy;
      if (y < 0 || y >= H) continue;
      for (let dx = -vision; dx <= vision; dx++) {
        const d2 = dx * dx + dy * dy;
        if (d2 > r2) continue;
        const x = cx + dx;
        if (x < 0 || x >= W) continue;
        const cell = y * W + x;
        if (d2 < preyD && this.canEatCreature(i, this.occupant[cell], biome)) {
          prey = cell;
          preyD = d2;
        }
        if (d2 < plantD && this.canEatPlant(i, food[cell])) {
          plant = cell;
          plantD = d2;
        }
      }
    }
    // Prey within twice the plant's distance is worth the detour; farther, and grazing wins.
    if (hunter && prey >= 0 && preyD <= plantD * 4) return prey;
    return plant >= 0 ? plant : prey;
  }

  /**
   * One step toward `target`: the diagonal `(dx, dy)`, then the single-axis fallbacks `(dx, 0)`
   * and `(0, dy)`, skipping duplicates. `-1` when each candidate is out of bounds or impassable.
   */
  private stepToward(i: number, target: number, biome: Uint8Array): number {
    const here = this.pos[i];
    const hx = here % W;
    const hy = (here / W) | 0;
    const dx = Math.sign((target % W) - hx);
    const dy = Math.sign(((target / W) | 0) - hy);
    for (let k = 0; k < 3; k++) {
      const ox = k === 2 ? 0 : dx;
      const oy = k === 1 ? 0 : dy;
      if (ox === 0 && oy === 0) continue;
      if (k === 1 && dy === 0) continue; // (dx, 0) duplicates (dx, dy)
      if (k === 2 && dx === 0) continue; // (0, dy) duplicates (dx, dy)
      const x = hx + ox;
      const y = hy + oy;
      if (x < 0 || x >= W || y < 0 || y >= H) continue;
      const cell = y * W + x;
      if (this.canEnter(i, biome[cell])) return cell;
    }
    return -1;
  }

  /** Single random step; `-1` when the drawn cell is out of bounds or impassable. */
  private randomStep(i: number, biome: Uint8Array, rng: () => number): number {
    const ox = ((rng() * 3) | 0) - 1;
    const oy = ((rng() * 3) | 0) - 1;
    if (ox === 0 && oy === 0) return -1;
    const here = this.pos[i];
    const x = (here % W) + ox;
    const y = ((here / W) | 0) + oy;
    if (x < 0 || x >= W || y < 0 || y >= H) return -1;
    const cell = y * W + x;
    return this.canEnter(i, biome[cell]) ? cell : -1;
  }

  /**
   * Neighbouring passable cell whose temperature is strictly closer to `center` than the
   * current cell's, or `-1`. Ties keep the first scanned neighbour (row-major, dx ascending).
   */
  private comfortStep(
    i: number,
    biome: Uint8Array,
    tempBase: Float32Array,
    tempOffset: number,
    center: number,
  ): number {
    const here = this.pos[i];
    const hx = here % W;
    const hy = (here / W) | 0;
    let best = -1;
    let bestD = Math.abs(tempBase[here] + tempOffset - center);
    for (let dy = -1; dy <= 1; dy++) {
      const y = hy + dy;
      if (y < 0 || y >= H) continue;
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const x = hx + dx;
        if (x < 0 || x >= W) continue;
        const c = y * W + x;
        if (!this.canEnter(i, biome[c])) continue;
        const d = Math.abs(tempBase[c] + tempOffset - center);
        if (d < bestD) {
          bestD = d;
          best = c;
        }
      }
    }
    return best;
  }

  /**
   * Consume the food at slot `i`'s cell, or a creature sharing it: the cell's occupant, or
   * `displaced` — the creature whose occupant entry this tick's move overwrote. A plant meal is
   * a small fixed yield, `eatGain * (1 - carnivory)`; it does not grow with the eater, so a
   * plant is worth the same to a mouse and an elephant. A kill transfers the prey's stored
   * energy scaled by `carnivory` (how much of the carcass the hunter can use), so the two diets
   * are a genuine trade-off: a pure herbivore grazes at full yield and cannot hunt, a pure
   * carnivore hunts at full yield and cannot graze, an omnivore splits both. Without the
   * `carnivory` factor hunting paid no better at 1.0 than at the 0.34 kill threshold while
   * grazing still fell with every step toward carnivory, so the trait had no interior optimum
   * and could only decay. A kill is capped by the prey's own energy — predation moves energy,
   * it does not mint it — so the crop is the ecosystem's only influx and the population is
   * bounded by primary production. Upkeep still scales with `size^METABOLIC_EXP`, so body size
   * is a real cost, met by eating more or bigger prey, not by a bigger mouthful of grass.
   */
  private eat(i: number, biome: Uint8Array, food: Uint8Array, foodCounts: Uint32Array, displaced: number): void {
    const o = i * GENE_COUNT;
    const cell = this.pos[i];
    const carnivory = this.genes[o + GENE.carnivory];
    const maxEnergy = this.genes[o + GENE.maxEnergy];
    const e = food[cell];
    if (this.canEatPlant(i, e)) {
      foodCounts[e]--;
      food[cell] = NONE;
      // Grazing yield falls off as the diet shifts toward carnivory.
      this.energy[i] = Math.min(maxEnergy, this.energy[i] + this.genes[o + GENE.eatGain] * (1 - carnivory));
    }
    let j = this.occupant[cell];
    if (j < 0 || j === i) j = displaced;
    if (this.canEatCreature(i, j, biome)) {
      const preyEnergy = this.energy[j];
      this.dead[j] = 1; // swept later; never remove another slot mid-loop
      this.energy[i] = Math.min(maxEnergy, this.energy[i] + preyEnergy * carnivory);
    }
  }

  /**
   * Chebyshev window around slot `i`, scanning `dy` then `dx` ascending: the first compatible,
   * willing neighbour, or `-1`. Deterministic, no `rng`. The window is `MATING_RADIUS` unless
   * the species is rare (`<= RARE_SPECIES_COUNT` live), when it widens to `RARE_MATING_RADIUS`
   * so a post-crash remnant can still pair up instead of dying out as singletons.
   */
  private findMate(i: number, registry: SpeciesRegistry): number {
    const here = this.pos[i];
    const cx = here % W;
    const cy = (here / W) | 0;
    const oi = i * GENE_COUNT;
    const radius = this.speciesCounts[this.species[i]] <= RARE_SPECIES_COUNT ? RARE_MATING_RADIUS : MATING_RADIUS;
    for (let dy = -radius; dy <= radius; dy++) {
      const y = cy + dy;
      if (y < 0 || y >= H) continue;
      for (let dx = -radius; dx <= radius; dx++) {
        const x = cx + dx;
        if (x < 0 || x >= W) continue;
        const j = this.occupant[y * W + x];
        if (j < 0 || j === i || this.dead[j] || this.mated[j]) continue;
        const oj = j * GENE_COUNT;
        if (this.energy[j] < this.reproNeed(j)) continue;
        const sj = this.species[j];
        if (this.speciesCounts[sj] >= registry.maxPop[sj]) continue;
        const d = geneDistance(
          this.genes,
          oi,
          this.biomeMask[i],
          this.foodMask[i],
          this.genes,
          oj,
          this.biomeMask[j],
          this.foodMask[j],
        );
        if (d <= SPECIATION_DISTANCE) return j;
      }
    }
    return -1;
  }

  /**
   * Sexual reproduction: recombine and mutate the two genomes, split both parents' energy,
   * classify the child (possibly founding a species), and spawn it next to `i`.
   */
  private mate(
    i: number,
    j: number,
    biome: Uint8Array,
    registry: SpeciesRegistry,
    tick: number,
    rng: () => number,
  ): void {
    if (this.count === this.capacity) return; // cannot happen: the caller checked
    const masks: Masks = crossover(this.genesScratch, this.srcOf(i), this.srcOf(j), rng);
    mutate(this.genesScratch, 0, masks, rng);
    const src: GenomeSource = {
      genes: this.genesScratch,
      off: 0,
      biomeMask: masks.biomeMask,
      foodMask: masks.foodMask,
    };
    const childEnergy = Math.min(
      (this.energy[i] + this.energy[j]) * 0.5,
      this.genesScratch[GENE.maxEnergy],
    );
    this.energy[i] *= 0.5;
    this.energy[j] *= 0.5;
    // A newborn that can still breed with a parent joins that parent's species even when the
    // species' reference genome has drifted away from it; only a child too far from both
    // parents to breed with either is reproductively isolated enough to found a species.
    const speciesA = this.species[i];
    const speciesB = this.species[j];
    let speciesId: number;
    let founded = false;
    if (this.childDistance(i, masks) <= SPECIATION_DISTANCE) {
      speciesId = speciesA;
    } else if (this.childDistance(j, masks) <= SPECIATION_DISTANCE) {
      speciesId = speciesB;
    } else {
      const before = registry.count;
      speciesId = registry.classify(src, speciesA, speciesB, tick, rng);
      founded = registry.count > before;
    }
    if (founded) {
      // A one-member species can never reproduce, so the isolated newborn takes both parents
      // with it as the daughter species' founding pair.
      this.adopt(i, speciesId, registry, tick);
      this.adopt(j, speciesId, registry, tick);
    }
    const at = this.randomStep(i, biome, rng);
    const slot = this.spawn(
      at >= 0 ? at : this.pos[i],
      childEnergy,
      speciesId,
      registry.colorSlot[speciesId],
      src,
      registry,
    );
    this.mated[i] = 1;
    this.mated[j] = 1;
    if (slot >= 0) this.mated[slot] = 1;
  }

  /** Advance every live creature one tick: age, starve, move, eat, reproduce. */
  step(
    biome: Uint8Array,
    food: Uint8Array,
    foodCounts: Uint32Array,
    rng: () => number,
    tempBase: Float32Array,
    tempOffset: number,
    registry: SpeciesRegistry,
    tick: number,
  ): void {
    this.mated.fill(0, 0, this.count);
    let i = 0;
    while (i < this.count) {
      if (this.dead[i]) {
        this.remove(i, registry, tick);
        continue;
      }
      const o = i * GENE_COUNT;
      const s = this.species[i];
      this.age[i]++;
      this.energy[i] -= this.genes[o + GENE.metabolism] * Math.pow(this.massOf(i), METABOLIC_EXP);
      if (this.energy[i] <= 0 || this.age[i] >= this.genes[o + GENE.maxAge]) {
        this.dead[i] = 1;
        this.remove(i, registry, tick);
        continue;
      }

      const temp = tempBase[this.pos[i]] + tempOffset;
      const comfortMin = this.genes[o + GENE.comfortMin];
      const comfortMax = this.genes[o + GENE.comfortMax];
      if (temp < this.genes[o + GENE.tempMin] || temp > this.genes[o + GENE.tempMax]) {
        this.dead[i] = 1;
        this.remove(i, registry, tick);
        continue;
      }

      const center = (comfortMin + comfortMax) / 2;
      const distressed = temp < comfortMin || temp > comfortMax;
      let displaced = -1;
      if (distressed) {
        // Out of its preferred band: one step toward a better temperature, ignoring food/prey.
        let to = this.comfortStep(i, biome, tempBase, tempOffset, center);
        if (to < 0) to = this.randomStep(i, biome, rng);
        if (to >= 0) displaced = this.move(i, to);
      } else {
        const speed = this.genes[o + GENE.speed];
        const moveChance = this.genes[o + GENE.moveChance];
        for (let n = 0; n < speed; n++) {
          const target = this.findTarget(i, biome, food);
          if (target >= 0 && target !== this.pos[i]) {
            let to = this.stepToward(i, target, biome);
            if (to < 0) to = this.randomStep(i, biome, rng); // blocked, e.g. water edge
            if (to >= 0) {
              const d = this.move(i, to);
              if (n === 0 || d >= 0) displaced = d;
            }
          } else if (n === 0 && rng() < moveChance) {
            const to = this.randomStep(i, biome, rng);
            if (to >= 0) displaced = this.move(i, to);
          } else if (n > 0) {
            break; // nothing to pursue: no second step, no extra rng draw
          }
        }
      }

      // Record the species' observed habitat: its genome mask is only a passability
      // capability, and can name biomes no member ever stands on.
      registry.habitat[s] |= 1 << biome[this.pos[i]];

      this.eat(i, biome, food, foodCounts, displaced);

      if (
        this.energy[i] >= this.reproNeed(i) &&
        !this.mated[i] &&
        this.speciesCounts[s] < registry.maxPop[s] &&
        this.count < this.capacity
      ) {
        const j = this.findMate(i, registry);
        if (j >= 0) this.mate(i, j, biome, registry, tick, rng);
      }
      i++;
    }

    i = 0;
    while (i < this.count) {
      if (this.dead[i]) this.remove(i, registry, tick);
      else i++;
    }
  }
}

/** Habitat cell counts for a passability mask: 0 on impassable cells, else its component size. */
function habitatAreas(
  biome: Uint8Array,
  passableMask: number,
  area: Int32Array,
  members: Int32Array,
): Int32Array {
  area.fill(0);
  for (let start = 0; start < GRID; start++) {
    if (area[start] !== 0 || ((passableMask >>> biome[start]) & 1) !== 1) continue;
    let top = 0;
    let count = 0;
    area[start] = -1;
    members[count++] = start;
    while (top < count) {
      const c = members[top++];
      const x = c % W;
      const y = (c / W) | 0;
      for (let dy = -1; dy <= 1; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= H) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          if (nx < 0 || nx >= W) continue;
          const n = ny * W + nx;
          if (area[n] !== 0 || ((passableMask >>> biome[n]) & 1) !== 1) continue;
          area[n] = -1;
          members[count++] = n;
        }
      }
    }
    for (let k = 0; k < count; k++) area[members[k]] = count;
  }
  return area;
}

/** Per biome, the densest food that can grow there; 0 for Beach and Deep Water. */
const BIOME_FOOD_DENSITY = (() => {
  const d = new Float32Array(BIOME_COUNT);
  for (let b = 0; b < BIOME_COUNT; b++) {
    for (const f of FOODS_BY_BIOME[b]) if (FOODS[f].density > d[b]) d[b] = FOODS[f].density;
  }
  return d;
})();

/**
 * A random cluster centre: a cell in a large-enough habitat whose biome feeds at least
 * `FOUNDER_MIN_FOOD_DENSITY`. Scans from a random offset, so the pick is uniform over the
 * eligible cells; falls back to the first large-habitat cell when none is productive.
 */
function founderCenter(rng: () => number, area: Int32Array, biome: Uint8Array, pop: Population): number {
  const start = (rng() * GRID) | 0;
  let fallback = -1;
  for (let k = 0; k < GRID; k++) {
    const cell = start + k < GRID ? start + k : start + k - GRID;
    if (area[cell] < MIN_HABITAT_AREA || pop.occupant[cell] !== -1) continue;
    if (BIOME_FOOD_DENSITY[biome[cell]] >= FOUNDER_MIN_FOOD_DENSITY) return cell;
    if (fallback < 0) fallback = cell;
  }
  return fallback;
}

/**
 * Place `FOUNDERS[s].initial` individuals of each founder on unoccupied cells of a habitat at
 * least `MIN_HABITAT_AREA` cells large, each with the founder's reference genome. Individuals
 * are seeded in clusters of up to `FOUNDER_GROUP` within `FOUNDER_CLUSTER_R` cells of a shared
 * centre, so every member starts within `MATING_RADIUS` of the rest; the next cluster is then
 * started elsewhere in a large-enough habitat. Spreading a species evenly across the map left a
 * dozen apex predators with no mate in sight: they sat at full energy, never bred, and died out
 * even where prey was plentiful, and their lake-scattered counterparts could not meet at all.
 * A centre is placed only on a biome that feeds at least `FOUNDER_MIN_FOOD_DENSITY`, so no
 * founder starts on the map's ~47% snow or other barren ground and starves before it breeds.
 * The passable cells of a species are not always one connected habitat — this terrain's water
 * is 23 disconnected lakes, several of them a few dozen cells — and habitats smaller than the
 * threshold are left unpopulated, so no founder starts in a pond too small to feed it.
 */
export function spawnInitialCreatures(
  biome: Uint8Array,
  pop: Population,
  registry: SpeciesRegistry,
  rng: () => number,
): void {
  const area = new Int32Array(GRID);
  const members = new Int32Array(GRID);
  for (let s = 0; s < FOUNDERS.length; s++) {
    const spec = FOUNDERS[s];
    habitatAreas(biome, registry.refBiome[s], area, members);
    const src = registry.refOf(s);
    let placed = 0;
    while (placed < spec.initial) {
      const center = founderCenter(rng, area, biome, pop);
      if (center < 0) break; // no room left in any large-enough habitat
      const cx = center % W;
      const cy = (center / W) | 0;
      const group = Math.min(FOUNDER_GROUP, spec.initial - placed);
      for (let k = 0; k < group; k++) {
        let cell = center;
        if (k > 0) {
          cell = -1;
          for (let attempt = 0; attempt < 24; attempt++) {
            const x = cx + (((rng() * (2 * FOUNDER_CLUSTER_R + 1)) | 0) - FOUNDER_CLUSTER_R);
            const y = cy + (((rng() * (2 * FOUNDER_CLUSTER_R + 1)) | 0) - FOUNDER_CLUSTER_R);
            if (x < 0 || x >= W || y < 0 || y >= H) continue;
            const c = y * W + x;
            // Same component: equal component size and passable (0 elsewhere).
            if (area[c] !== area[center] || pop.occupant[c] !== -1) continue;
            cell = c;
            break;
          }
          if (cell < 0) continue; // this cluster is full; the outer loop starts another
        }
        // pool full: stop seeding
        if (pop.spawn(cell, spec.startEnergy, s, registry.colorSlot[s], src, registry) === -1) return;
        registry.habitat[s] |= 1 << biome[cell];
        placed++;
      }
    }
  }
}
