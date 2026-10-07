// Headless long-run harness: drive `World` at full speed, sample a fixed metric set, and
// evaluate declarative assertions over the samples. DOM-free and free of `node:` imports so it
// typechecks under `svelte-check`, runs under `node --test`, and can be imported by
// `scripts/sim.ts` (see `npm run sim`).
import { CARNIVORE_MIN, GRID, HERBIVORE_MAX, MAX_CREATURES, MAX_SPECIES } from './config.ts';
import { coverage } from './food.ts';
import { GENE, GENE_COUNT } from './genetics.ts';
import { BIOMES, FOODS, FOOD_COUNT } from './palette.ts';
import { World } from './world.ts';

/**
 * One sampled instant: every value is a number and every sample carries the same keys, so an
 * assertion can name any metric of any sample. `tick` is always present.
 */
export type Sample = Record<string, number>;

export type Agg = 'all' | 'any' | 'min' | 'max' | 'mean' | 'last' | 'first';
export type Cmp = '>=' | '<=' | '>' | '<' | '==' | '!=';

export interface Assertion {
  /** The expression this was parsed from, as written. */
  expr: string;
  agg: Agg;
  metric: string;
  cmp: Cmp;
  value: number;
  /** First tick of the window the aggregation runs over. */
  from: number;
  /** Last tick of the window, `Infinity` when open-ended. */
  to: number;
}

export interface RunOptions {
  seed: number;
  ticks: number;
  every: number;
  assertions: Assertion[];
  onSample?: (s: Sample) => void;
}

export interface RunResult {
  seed: number;
  ticks: number;
  samples: Sample[];
  /** Tick the run stopped at early because an assertion could no longer pass, else `null`. */
  truncatedAt: number | null;
  /** `expr` of the assertion that truncated the run, else `null`. */
  failedExpr: string | null;
}

/** Metric key fragment for a display name: lowercased, every non-alphanumeric run becomes `_`. */
function slug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '_');
}

/**
 * Read the standard metric set off `world` in one pass. Numbers only, same keys every time.
 * Never touches `world.rng` and never writes world state: sampling must not perturb a run.
 * A population of zero is legal and leaves every mean at zero.
 */
export function sampleWorld(world: World): Sample {
  const pop = world.population;
  const counts = world.counts;
  const eligible = world.eligible;
  const registry = world.registry;
  const n = pop.count;

  let speciesLive = 0;
  for (let id = 0; id < MAX_SPECIES; id++) if (pop.speciesCounts[id] > 0) speciesLive++;
  let speciesExtinct = 0;
  for (let id = 0; id < registry.count; id++) if (registry.extinctTick[id] >= 0) speciesExtinct++;

  let herbivore = 0;
  let omnivore = 0;
  let carnivore = 0;
  let sumCarnivory = 0;
  let sumSize = 0;
  for (let i = 0; i < n; i++) {
    const o = i * GENE_COUNT;
    const carnivory = pop.genes[o + GENE.carnivory];
    sumCarnivory += carnivory;
    sumSize += pop.genes[o + GENE.size];
    if (carnivory < HERBIVORE_MAX) herbivore++;
    else if (carnivory < CARNIVORE_MIN) omnivore++;
    else carnivore++;
  }

  let counterSum = 0;
  for (let id = 0; id < MAX_SPECIES; id++) counterSum += pop.speciesCounts[id];

  let coverageSum = 0;
  let coverageCount = 0;
  for (let f = 0; f < FOOD_COUNT; f++) {
    if (eligible[f] === 0) continue;
    coverageSum += coverage(counts, eligible, f);
    coverageCount++;
  }

  const cells = new Uint32Array(BIOMES.length);
  for (let i = 0; i < GRID; i++) cells[world.biome[i]]++;

  const s: Sample = {
    tick: world.tick,
    population: n,
    speciesTotal: registry.count,
    speciesLive,
    speciesExtinct,
    herbivore,
    omnivore,
    carnivore,
    trophicClasses: (herbivore > 0 ? 1 : 0) + (omnivore > 0 ? 1 : 0) + (carnivore > 0 ? 1 : 0),
    meanCarnivory: n === 0 ? 0 : sumCarnivory / n,
    meanSize: n === 0 ? 0 : sumSize / n,
    countersOk: counterSum === n ? 1 : 0,
    foodCoverage: coverageCount === 0 ? 0 : coverageSum / coverageCount,
    seasonOffset: world.seasonOffset,
    meanTemp: world.meanTempBase + world.seasonOffset,
  };
  for (let b = 0; b < BIOMES.length; b++) s[`biome.${slug(BIOMES[b].name)}`] = cells[b] / GRID;
  for (let f = 0; f < FOOD_COUNT; f++) s[`food.${slug(FOODS[f].name)}.coverage`] = coverage(counts, eligible, f);
  return s;
}

const AGG_PATTERN = 'all|any|min|max|mean|last|first';
const CMP_PATTERN = '>=|<=|==|!=|>|<';
const NUMBER_PATTERN = '-?(?:\\d+(?:\\.\\d+)?|\\.\\d+)(?:[eE][+-]?\\d+)?';

/** `<agg>(<metric>[,ticks>=<n>][,ticks<=<n>]) <cmp> <number>`, whitespace-tolerant. */
const ASSERTION_RE = new RegExp(
  `^\\s*(${AGG_PATTERN})\\s*\\(\\s*([A-Za-z][A-Za-z0-9_.]*)\\s*` +
    `(?:,\\s*ticks\\s*>=\\s*(\\d+)\\s*)?(?:,\\s*ticks\\s*<=\\s*(\\d+)\\s*)?\\)\\s*` +
    `(${CMP_PATTERN})\\s*(${NUMBER_PATTERN})\\s*$`,
);

/** Parse one assertion expression; throws `Error` naming the offending text. */
export function parseAssertion(expr: string): Assertion {
  // Typed as possibly-`undefined` entries: an optional window clause that did not participate is
  // `undefined`, which the typed `RegExpExecArray` does not express.
  const m: readonly (string | undefined)[] | null = ASSERTION_RE.exec(expr);
  if (m === null) throw new Error(`bad assertion: ${expr.trim()}`);
  return {
    expr: expr.trim(),
    agg: m[1] as Agg,
    metric: m[2] as string,
    cmp: m[5] as Cmp,
    value: Number(m[6]),
    from: m[3] === undefined ? 0 : Number(m[3]),
    to: m[4] === undefined ? Infinity : Number(m[4]),
  };
}

function satisfies(cmp: Cmp, observed: number, value: number): boolean {
  switch (cmp) {
    case '>=':
      return observed >= value;
    case '<=':
      return observed <= value;
    case '>':
      return observed > value;
    case '<':
      return observed < value;
    case '==':
      return observed === value;
    case '!=':
      return observed !== value;
  }
}

function inWindow(s: Sample, a: Assertion): boolean {
  return s.tick >= a.from && s.tick <= a.to;
}

/**
 * The sample in `win` closest to breaking `a`'s comparison: the minimum for a lower bound, the
 * maximum for an upper bound, the first for an equality test, where no direction applies.
 */
function edge(win: Sample[], a: Assertion): Sample {
  const lowerEdge = a.cmp === '>=' || a.cmp === '>';
  const upperEdge = a.cmp === '<=' || a.cmp === '<';
  let best = win[0];
  for (const s of win) {
    if (lowerEdge && s[a.metric] < best[a.metric]) best = s;
    else if (upperEdge && s[a.metric] > best[a.metric]) best = s;
  }
  return best;
}

/**
 * Evaluate `a` over `samples` (window-filtered by tick). A window that selects nothing is a
 * failure with the detail `no samples in window`, never a vacuous pass. Throws `Error` for a
 * metric no sample carries.
 */
export function evaluateAssertion(a: Assertion, samples: Sample[]): { pass: boolean; detail: string } {
  if (samples.length > 0 && !Object.hasOwn(samples[0], a.metric)) {
    throw new Error(`unknown metric: ${a.metric}`);
  }
  const win: Sample[] = [];
  for (const s of samples) if (inWindow(s, a)) win.push(s);
  if (win.length === 0) return { pass: false, detail: 'no samples in window' };
  const tail = `${a.cmp} ${a.value} (${win.length} samples)`;

  switch (a.agg) {
    case 'first':
    case 'last': {
      const s = a.agg === 'first' ? win[0] : win[win.length - 1];
      return {
        pass: satisfies(a.cmp, s[a.metric], a.value),
        detail: `${a.agg} ${s[a.metric]} at tick ${s.tick} ${tail}`,
      };
    }
    case 'min':
    case 'max': {
      let v = win[0][a.metric];
      let tick = win[0].tick;
      for (const s of win) {
        const x = s[a.metric];
        if (a.agg === 'min' ? x < v : x > v) {
          v = x;
          tick = s.tick;
        }
      }
      return { pass: satisfies(a.cmp, v, a.value), detail: `${a.agg} ${v} at tick ${tick} ${tail}` };
    }
    case 'mean': {
      let sum = 0;
      for (const s of win) sum += s[a.metric];
      const v = sum / win.length;
      return { pass: satisfies(a.cmp, v, a.value), detail: `mean ${v} ${tail}` };
    }
    case 'all': {
      let pass = true;
      for (const s of win) {
        if (!satisfies(a.cmp, s[a.metric], a.value)) {
          pass = false;
          break;
        }
      }
      const e = edge(win, a);
      return { pass, detail: `${a.agg} ${e[a.metric]} at tick ${e.tick} ${tail}` };
    }
    case 'any': {
      let pass = false;
      for (const s of win) {
        if (satisfies(a.cmp, s[a.metric], a.value)) {
          pass = true;
          break;
        }
      }
      const e = edge(win, a);
      return { pass, detail: `${a.agg} ${e[a.metric]} at tick ${e.tick} ${tail}` };
    }
  }
}

/**
 * The quantity `evaluateAssertion` aggregates or edges towards for `a` over `samples`, or `null`
 * when the window selects nothing. Lets a caller reporting several runs name the run closest to
 * failing.
 */
export function assertionMeasure(a: Assertion, samples: Sample[]): number | null {
  const win: Sample[] = [];
  for (const s of samples) if (inWindow(s, a)) win.push(s);
  if (win.length === 0) return null;
  switch (a.agg) {
    case 'min': {
      let v = win[0][a.metric];
      for (const s of win) if (s[a.metric] < v) v = s[a.metric];
      return v;
    }
    case 'max': {
      let v = win[0][a.metric];
      for (const s of win) if (s[a.metric] > v) v = s[a.metric];
      return v;
    }
    case 'mean': {
      let sum = 0;
      for (const s of win) sum += s[a.metric];
      return sum / win.length;
    }
    case 'first':
      return win[0][a.metric];
    case 'last':
      return win[win.length - 1][a.metric];
    case 'all':
    case 'any':
      return edge(win, a)[a.metric];
  }
}

/**
 * Whether `a` is already failing on `samples` and can never recover, so the run may stop early.
 * Only `all` (every sample must hold, and a violating sample stays in the window as it grows)
 * and `min` under a lower bound (a later sample can only lower the minimum further) can decide
 * this; for the rest a later sample or the aggregate itself can still flip the verdict, so
 * early exit would report a failure for a series that would have passed.
 */
export function decisiveFail(a: Assertion, samples: Sample[]): boolean {
  if (a.agg === 'all') {
    // Every comparison direction is decidable: one violating sample fails `all` for good.
  } else if (a.agg === 'min') {
    if (a.cmp !== '>=' && a.cmp !== '>') return false;
  } else {
    return false;
  }
  for (const s of samples) {
    if (!inWindow(s, a)) continue;
    if (!Object.hasOwn(s, a.metric)) continue;
    if (!satisfies(a.cmp, s[a.metric], a.value)) return true;
  }
  return false;
}

/**
 * Reset a fresh `World` to `seed` and step it `ticks` times, sampling at tick 0, every `every`
 * ticks and at the final tick. After each sample, an assertion that can no longer pass
 * (`decisiveFail`) stops the run; a PASS always consumes the full tick budget, so a truncated
 * series is always a failing series. `onSample` is called per sample and is not guarded: its
 * exceptions propagate.
 */
export function runSeed(o: RunOptions): RunResult {
  const world = new World();
  world.reset(o.seed);
  const every = o.every >= 1 ? Math.floor(o.every) : 1;
  const samples: Sample[] = [];

  const emit = (): string | null => {
    const s = sampleWorld(world);
    samples.push(s);
    if (o.onSample !== undefined) o.onSample(s);
    for (let i = 0; i < o.assertions.length; i++) {
      const a = o.assertions[i];
      if (decisiveFail(a, samples)) return a.expr;
    }
    return null;
  };

  const base = { seed: o.seed, ticks: o.ticks, samples };
  const failed = emit();
  if (failed !== null) return { ...base, truncatedAt: samples[0].tick, failedExpr: failed };

  for (let tick = 1; tick <= o.ticks; tick++) {
    world.step();
    if (tick % every !== 0 && tick !== o.ticks) continue;
    const bad = emit();
    if (bad !== null) return { ...base, truncatedAt: tick, failedExpr: bad };
  }
  return { ...base, truncatedAt: null, failedExpr: null };
}

/**
 * Ticks a trophic preset ignores while the omnivore band establishes itself. The four founders
 * are herbivores and carnivores, so `trophicClasses` starts at 2 and the middle band can only
 * appear by mutation; measured first tick with all three bands on seeds 1, 2, 3, 7, 99 and
 * 12345 is 5-13.
 */
export const TROPHIC_WARMUP_TICKS = 100;

/** Named assertion sets, built from the config constants rather than repeat literals. */
export const PRESETS: Record<string, readonly string[]> = {
  survival: [`all(population)>=1`, `all(population)<=${MAX_CREATURES}`, `all(countersOk)>=1`],
  trophic: [`all(trophicClasses,ticks>=${TROPHIC_WARMUP_TICKS})>=3`],
  speciation: [`last(speciesTotal)>4`],
};
