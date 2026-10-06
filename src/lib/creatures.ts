import { GRID, H, MAX_CREATURES, MIN_HABITAT_AREA, W } from './config.ts';
import { NONE } from './palette.ts';
import {
  SPECIES,
  SPECIES_COUNT,
  SPECIES_EATS,
  SPECIES_HUNTS,
  SPECIES_PASSABLE,
  type SpeciesId,
} from './species.ts';

/**
 * Creature agents in a fixed-capacity slot pool. Every array is preallocated, so a tick
 * allocates nothing. DOM-free: usable from a headless harness.
 */
export class Population {
  readonly capacity: number;
  count: number;
  /** Live count per species. */
  readonly counts: Uint32Array;
  /** slot -> species id */
  readonly species: Uint8Array;
  /** slot -> cell index (`y * W + x`) */
  readonly pos: Int32Array;
  readonly energy: Float32Array;
  readonly age: Uint32Array;
  /** slot -> 1 when killed earlier this tick and awaiting sweep */
  readonly dead: Uint8Array;
  /** cell -> slot index | -1 (last writer wins) */
  readonly occupant: Int32Array;

  constructor(capacity: number = MAX_CREATURES) {
    this.capacity = capacity;
    this.count = 0;
    this.counts = new Uint32Array(SPECIES_COUNT);
    this.species = new Uint8Array(capacity);
    this.pos = new Int32Array(capacity);
    this.energy = new Float32Array(capacity);
    this.age = new Uint32Array(capacity);
    this.dead = new Uint8Array(capacity);
    this.occupant = new Int32Array(GRID).fill(-1);
  }

  /** Create one individual at cell `at`. Returns `false` when the pool is full. */
  spawn(s: SpeciesId, at: number, energy: number): boolean {
    if (this.count === this.capacity) return false;
    const i = this.count;
    this.species[i] = s;
    this.pos[i] = at;
    this.energy[i] = energy;
    this.age[i] = 0;
    this.dead[i] = 0;
    this.occupant[at] = i;
    this.counts[s]++;
    this.count = i + 1;
    return true;
  }

  /** Swap-remove slot `i`, patching up the occupant grid for both moved cells. */
  private remove(i: number): void {
    const last = this.count - 1;
    this.counts[this.species[i]]--;
    if (this.occupant[this.pos[i]] === i) this.occupant[this.pos[i]] = -1;
    if (i !== last) {
      this.species[i] = this.species[last];
      this.pos[i] = this.pos[last];
      this.energy[i] = this.energy[last];
      this.age[i] = this.age[last];
      this.dead[i] = this.dead[last];
      if (this.occupant[this.pos[i]] === last) this.occupant[this.pos[i]] = i;
    }
    this.dead[last] = 0;
    this.count = last;
  }

  /** Relocate slot `i`; returns the occupant slot it displaced, or `-1`. */
  private move(i: number, to: number): number {
    const prev = this.occupant[to];
    if (this.occupant[this.pos[i]] === i) this.occupant[this.pos[i]] = -1;
    this.pos[i] = to;
    this.occupant[to] = i;
    return prev === i ? -1 : prev;
  }

  /** Nearest visible food (herbivore) or prey (predator) cell, or `-1`. */
  private findTarget(i: number, biome: Uint8Array, food: Uint8Array): number {
    const s = this.species[i];
    const sp = SPECIES[s];
    const vision = sp.vision;
    const herbivore = sp.foods.length > 0;
    const cx = this.pos[i] % W;
    const cy = (this.pos[i] / W) | 0;
    let best = -1;
    let bestD = vision * vision + 1;

    for (let dy = -vision; dy <= vision; dy++) {
      const y = cy + dy;
      if (y < 0 || y >= H) continue;
      for (let dx = -vision; dx <= vision; dx++) {
        const d2 = dx * dx + dy * dy;
        if (d2 > vision * vision || d2 >= bestD) continue;
        const x = cx + dx;
        if (x < 0 || x >= W) continue;
        const cell = y * W + x;
        if (herbivore) {
          const f = food[cell];
          if (f !== NONE && SPECIES_EATS[s][f] === 1) {
            best = cell;
            bestD = d2;
          }
        } else {
          const j = this.occupant[cell];
          if (j >= 0 && j !== i && !this.dead[j] && SPECIES_HUNTS[s][this.species[j]] === 1) {
            best = cell;
            bestD = d2;
          }
        }
      }
    }
    return best;
  }

  /**
   * One step toward `target`: the diagonal `(dx, dy)`, then the single-axis fallbacks `(dx, 0)`
   * and `(0, dy)`, skipping duplicates. `-1` when each candidate is out of bounds or impassable.
   */
  private stepToward(i: number, target: number, biome: Uint8Array): number {
    const s = this.species[i];
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
      if (SPECIES_PASSABLE[s][biome[cell]] === 1) return cell;
    }
    return -1;
  }

  /** Single random step; `-1` when the drawn cell is out of bounds or impassable. */
  private randomStep(i: number, biome: Uint8Array, rng: () => number): number {
    const ox = (rng() * 3 | 0) - 1;
    const oy = (rng() * 3 | 0) - 1;
    if (ox === 0 && oy === 0) return -1;
    const here = this.pos[i];
    const x = (here % W) + ox;
    const y = ((here / W) | 0) + oy;
    if (x < 0 || x >= W || y < 0 || y >= H) return -1;
    const cell = y * W + x;
    return SPECIES_PASSABLE[this.species[i]][biome[cell]] === 1 ? cell : -1;
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
    const passable = SPECIES_PASSABLE[this.species[i]];
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
        if (passable[biome[c]] !== 1) continue;
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
   * `displaced` — the creature whose occupant entry this tick's move overwrote.
   */
  private eat(i: number, food: Uint8Array, foodCounts: Uint32Array, displaced: number): void {
    const s = this.species[i];
    const sp = SPECIES[s];
    const cell = this.pos[i];

    if (sp.foods.length > 0) {
      const f = food[cell];
      if (f !== NONE && SPECIES_EATS[s][f] === 1) {
        foodCounts[f]--;
        food[cell] = NONE;
        this.energy[i] = Math.min(sp.maxEnergy, this.energy[i] + sp.eatGain);
      }
    }

    if (sp.prey.length > 0) {
      let j = this.occupant[cell];
      if (j < 0 || j === i) j = displaced;
      if (j >= 0 && j !== i && !this.dead[j] && SPECIES_HUNTS[s][this.species[j]] === 1) {
        this.dead[j] = 1; // swept later; never remove another slot mid-loop
        this.energy[i] = Math.min(sp.maxEnergy, this.energy[i] + sp.eatGain);
      }
    }
  }

  /** Advance every live creature one tick: age, starve, move, eat, reproduce. */
  step(
    biome: Uint8Array,
    food: Uint8Array,
    foodCounts: Uint32Array,
    rng: () => number,
    tempBase: Float32Array,
    tempOffset: number,
  ): void {
    let i = 0;
    while (i < this.count) {
      if (this.dead[i]) {
        this.remove(i);
        continue;
      }
      const s = this.species[i];
      const sp = SPECIES[s];
      this.age[i]++;
      this.energy[i] -= sp.metabolism;
      if (this.energy[i] <= 0 || this.age[i] >= sp.maxAge) {
        this.dead[i] = 1;
        this.remove(i);
        continue;
      }

      const temp = tempBase[this.pos[i]] + tempOffset;
      if (temp < sp.tempMin || temp > sp.tempMax) {
        this.dead[i] = 1;
        this.remove(i);
        continue;
      }

      const center = (sp.comfortMin + sp.comfortMax) / 2;
      const distressed = temp < sp.comfortMin || temp > sp.comfortMax;
      let displaced = -1;
      if (distressed) {
        // Out of its preferred band: one step toward a better temperature, ignoring food/prey.
        let to = this.comfortStep(i, biome, tempBase, tempOffset, center);
        if (to < 0) to = this.randomStep(i, biome, rng);
        if (to >= 0) displaced = this.move(i, to);
      } else {
        for (let n = 0; n < sp.speed; n++) {
          const target = this.findTarget(i, biome, food);
          if (target >= 0 && target !== this.pos[i]) {
            let to = this.stepToward(i, target, biome);
            if (to < 0) to = this.randomStep(i, biome, rng); // blocked, e.g. water edge
            if (to >= 0) {
              const d = this.move(i, to);
              if (n === 0 || d >= 0) displaced = d;
            }
          } else if (n === 0 && rng() < sp.moveChance) {
            const to = this.randomStep(i, biome, rng);
            if (to >= 0) displaced = this.move(i, to);
          } else if (n > 0) {
            break; // nothing to pursue: no second step, no extra rng draw
          }
        }
      }

      this.eat(i, food, foodCounts, displaced);

      if (
        this.energy[i] >= sp.reproEnergy &&
        this.counts[s] < sp.maxPop &&
        this.count < this.capacity
      ) {
        const to = this.randomStep(i, biome, rng);
        const child = this.energy[i] / 2;
        this.energy[i] = child;
        this.spawn(s as SpeciesId, to >= 0 ? to : this.pos[i], child);
      }
      i++;
    }

    i = 0;
    while (i < this.count) {
      if (this.dead[i]) this.remove(i);
      else i++;
    }
  }
}

/** Habitat cell counts for species `s`: 0 on impassable cells, else its component's size. */
function habitatAreas(biome: Uint8Array, s: number, area: Int32Array, members: Int32Array): Int32Array {
  const passable = SPECIES_PASSABLE[s];
  area.fill(0);
  for (let start = 0; start < GRID; start++) {
    if (area[start] !== 0 || passable[biome[start]] !== 1) continue;
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
          if (area[n] !== 0 || passable[biome[n]] !== 1) continue;
          area[n] = -1;
          members[count++] = n;
        }
      }
    }
    for (let k = 0; k < count; k++) area[members[k]] = count;
  }
  return area;
}

/**
 * Place `SPECIES[s].initial` individuals of each species on random unoccupied cells of a
 * habitat at least `MIN_HABITAT_AREA` cells large. The passable cells of a species are not
 * always one connected habitat — this terrain's water is 23 disconnected lakes, several of
 * them a few dozen cells — and a handful of founders in a micro-pond breed up to their
 * species cap inside it, where no crop can regrow, and starve. Habitats smaller than the
 * threshold are left unpopulated, which keeps them unpopulated: nothing can walk in.
 */
export function spawnInitialCreatures(biome: Uint8Array, pop: Population, rng: () => number): void {
  const area = new Int32Array(GRID);
  const members = new Int32Array(GRID);
  for (let s = 0; s < SPECIES_COUNT; s++) {
    const sp = SPECIES[s];
    habitatAreas(biome, s, area, members);
    for (let n = 0; n < sp.initial; n++) {
      for (let attempt = 0; attempt < 30; attempt++) {
        const cell = (rng() * GRID) | 0;
        if (area[cell] < MIN_HABITAT_AREA || pop.occupant[cell] !== -1) continue;
        if (!pop.spawn(s as SpeciesId, cell, sp.startEnergy)) return; // pool full: stop seeding
        break;
      }
    }
  }
}
