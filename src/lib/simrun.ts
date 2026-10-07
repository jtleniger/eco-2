// Headless long-run harness: drive `World` at full speed, sample a fixed metric set, and
// evaluate declarative assertions over the samples. DOM-free and free of `node:` imports so it
// typechecks under `svelte-check`, runs under `node --test`, and can be imported by
// `scripts/sim.ts` (see `npm run sim`).
import { CARNIVORE_MIN, GRID, HERBIVORE_MAX, MAX_CREATURES, MAX_SPECIES } from './config.ts';
import { coverage } from './food.ts';
import { GENE, GENE_COUNT, GENES } from './genetics.ts';
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
  let herbivoreEnergy = 0;
  let omnivoreEnergy = 0;
  let carnivoreEnergy = 0;
  let sumCarnivory = 0;
  let sumSize = 0;
  let sumVision = 0;
  let sizeAtCeiling = 0;
  const ceilingSize = GENES[GENE.size].max - 0.15;
  for (let i = 0; i < n; i++) {
    const o = i * GENE_COUNT;
    const carnivory = pop.genes[o + GENE.carnivory];
    const size = pop.genes[o + GENE.size];
    sumCarnivory += carnivory;
    sumSize += size;
    sumVision += pop.genes[o + GENE.vision];
    if (size >= ceilingSize) sizeAtCeiling++;
    if (carnivory < HERBIVORE_MAX) {
      herbivore++;
      herbivoreEnergy += pop.energy[i];
    } else if (carnivory < CARNIVORE_MIN) {
      omnivore++;
      omnivoreEnergy += pop.energy[i];
    } else {
      carnivore++;
      carnivoreEnergy += pop.energy[i];
    }
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
    herbivoreShare: n === 0 ? 0 : herbivore / n,
    omnivoreShare: n === 0 ? 0 : omnivore / n,
    carnivoreShare: n === 0 ? 0 : carnivore / n,
    herbivoreMeanEnergy: herbivore === 0 ? 0 : herbivoreEnergy / herbivore,
    omnivoreMeanEnergy: omnivore === 0 ? 0 : omnivoreEnergy / omnivore,
    carnivoreMeanEnergy: carnivore === 0 ? 0 : carnivoreEnergy / carnivore,
    trophicClasses: (herbivore > 0 ? 1 : 0) + (omnivore > 0 ? 1 : 0) + (carnivore > 0 ? 1 : 0),
    meanCarnivory: n === 0 ? 0 : sumCarnivory / n,
    meanSize: n === 0 ? 0 : sumSize / n,
    meanVision: n === 0 ? 0 : sumVision / n,
    sizeAtCeiling: n === 0 ? 0 : sizeAtCeiling / n,
    countersOk: counterSum === n ? 1 : 0,
    foodCoverage: coverageCount === 0 ? 0 : coverageSum / coverageCount,
    seasonOffset: world.seasonOffset,
    meanTemp: world.meanTempBase + world.seasonOffset,
    // The run's environmental regime, so a sweep result can be read back per seed.
    huntEfficiency: world.huntEfficiency,
    seasonAmplitude: world.seasonAmplitude,
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

// The `trophic-mix` check is not a per-seed assertion list: no single seed can express "the
// favoured class varies across seeds", so the CLI routes `--check trophic-mix` to
// `trophicMixVerdict` and evaluates it once, over every finished run.
/** Every class must hold at least this share of a run's final population (Gate G1). */
export const TROPHIC_MIN_SHARE = 0.05;
/** A run's final herbivore share must not exceed this (Gate G2: no monoculture). */
export const TROPHIC_MAX_HERBIVORE_SHARE = 0.70;
/** The final carnivore share must span at least this across the seed set (Gate G3a). */
export const TROPHIC_MIN_CARNIVORE_SPREAD = 0.10;
/** No class may be the run's favoured class on more than this fraction of the seed set (G3b). */
export const TROPHIC_MAX_FAVOURED_FRACTION = 2 / 3;
/** Tick the favoured class is measured from: its share at the last sample minus here. */
export const TROPHIC_FAVOURED_FROM = 1000;

export interface SeedSetVerdict {
  expr: string;
  pass: boolean;
  detail: string;
}

const TROPHIC_CLASSES = ['herbivore', 'omnivore', 'carnivore'] as const;
type TrophicClass = (typeof TROPHIC_CLASSES)[number];

/**
 * Evaluate the cross-seed `trophic-mix` check over finished runs, one verdict per Gate G1-G3(b):
 * G1 every class holds `TROPHIC_MIN_SHARE` on every seed (its final `herbivoreShare`,
 * `omnivoreShare`, `carnivoreShare`); G2 no herbivore monoculture (`TROPHIC_MAX_HERBIVORE_SHARE`);
 * G3(a) the final carnivore share spans `TROPHIC_MIN_CARNIVORE_SPREAD` across seeds; G3(b) no
 * class gains the most share from tick `TROPHIC_FAVOURED_FROM` to the end (ties broken herbivore,
 * omnivore, carnivore) on more than `TROPHIC_MAX_FAVOURED_FRACTION` of the seed set. Reads the
 * last sample of each run; throws on fewer than three runs, since "varies across seeds" is
 * meaningless over one or two.
 */
export function trophicMixVerdict(
  runs: readonly { seed: number; samples: Sample[] }[],
): SeedSetVerdict[] {
  if (runs.length < 3) throw new Error('need >= 3 seeds');

  const lastShares = runs.map((run) => run.samples[run.samples.length - 1]);

  const g1: SeedSetVerdict = {
    expr: `viable(herbivoreShare,omnivoreShare,carnivoreShare)>=${TROPHIC_MIN_SHARE}`,
    pass: true,
    detail: '',
  };
  let minShare = Infinity;
  let minShareSeed = runs[0].seed;
  let minShareClass: TrophicClass = TROPHIC_CLASSES[0];
  for (let r = 0; r < runs.length; r++) {
    for (const cls of TROPHIC_CLASSES) {
      const share = lastShares[r][`${cls}Share`];
      if (share < minShare) {
        minShare = share;
        minShareSeed = runs[r].seed;
        minShareClass = cls;
      }
    }
  }
  g1.pass = minShare >= TROPHIC_MIN_SHARE;
  g1.detail = `min ${minShareClass}Share ${minShare.toFixed(3)} on seed ${minShareSeed} >= ${TROPHIC_MIN_SHARE}`;

  const g2: SeedSetVerdict = {
    expr: `max(herbivoreShare)<=${TROPHIC_MAX_HERBIVORE_SHARE}`,
    pass: true,
    detail: '',
  };
  let maxHerb = -Infinity;
  let maxHerbSeed = runs[0].seed;
  for (let r = 0; r < runs.length; r++) {
    const v = lastShares[r].herbivoreShare;
    if (v > maxHerb) {
      maxHerb = v;
      maxHerbSeed = runs[r].seed;
    }
  }
  g2.pass = maxHerb <= TROPHIC_MAX_HERBIVORE_SHARE;
  g2.detail = `max herbivoreShare ${maxHerb.toFixed(3)} on seed ${maxHerbSeed} <= ${TROPHIC_MAX_HERBIVORE_SHARE}`;

  const g3a: SeedSetVerdict = {
    expr: `spread(carnivoreShare)>=${TROPHIC_MIN_CARNIVORE_SPREAD}`,
    pass: true,
    detail: '',
  };
  let minCarn = Infinity;
  let maxCarn = -Infinity;
  let minCarnSeed = runs[0].seed;
  let maxCarnSeed = runs[0].seed;
  for (let r = 0; r < runs.length; r++) {
    const v = lastShares[r].carnivoreShare;
    if (v < minCarn) {
      minCarn = v;
      minCarnSeed = runs[r].seed;
    }
    if (v > maxCarn) {
      maxCarn = v;
      maxCarnSeed = runs[r].seed;
    }
  }
  const spread = maxCarn - minCarn;
  g3a.pass = spread >= TROPHIC_MIN_CARNIVORE_SPREAD;
  g3a.detail =
    `spread ${spread.toFixed(3)} (seed ${minCarnSeed} ${minCarn.toFixed(3)} .. ` +
    `seed ${maxCarnSeed} ${maxCarn.toFixed(3)}) >= ${TROPHIC_MIN_CARNIVORE_SPREAD}`;

  const g3b: SeedSetVerdict = { expr: 'favouredClass is not constant', pass: true, detail: '' };
  const favoured: Record<TrophicClass, number> = { herbivore: 0, omnivore: 0, carnivore: 0 };
  for (const run of runs) {
    const last = run.samples[run.samples.length - 1];
    // The earliest sample at or after `TROPHIC_FAVOURED_FROM`; a run shorter than that falls
    // back to its first sample, where every gain is then measured from tick 0.
    let from = run.samples[0];
    for (const s of run.samples) {
      if (s.tick >= TROPHIC_FAVOURED_FROM) {
        from = s;
        break;
      }
    }
    let best: TrophicClass = TROPHIC_CLASSES[0];
    let bestGain = -Infinity;
    for (const cls of TROPHIC_CLASSES) {
      const gain = last[`${cls}Share`] - from[`${cls}Share`];
      if (gain > bestGain + 1e-12) {
        bestGain = gain;
        best = cls;
      }
    }
    favoured[best]++;
  }
  let top: TrophicClass = TROPHIC_CLASSES[0];
  for (const cls of TROPHIC_CLASSES) if (favoured[cls] > favoured[top]) top = cls;
  const allowed = TROPHIC_MAX_FAVOURED_FRACTION * runs.length;
  g3b.pass = favoured[top] <= allowed;
  g3b.detail =
    `favoured ${top} on ${favoured[top]}/${runs.length} seeds (max ${allowed}); ` +
    TROPHIC_CLASSES.map((c) => `${c} ${favoured[c]}`).join(', ');

  return [g1, g2, g3a, g3b];
}
