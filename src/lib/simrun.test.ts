/// <reference types="node" />
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PRESETS,
  TROPHIC_FAVOURED_FROM,
  TROPHIC_MAX_FAVOURED_FRACTION,
  TROPHIC_MAX_HERBIVORE_SHARE,
  TROPHIC_MIN_CARNIVORE_SPREAD,
  TROPHIC_MIN_SHARE,
  TROPHIC_WARMUP_TICKS,
  decisiveFail,
  evaluateAssertion,
  parseAssertion,
  runSeed,
  sampleWorld,
  trophicMixVerdict,
  type Agg,
  type Cmp,
  type Sample,
} from './simrun.ts';
import { World } from './world.ts';

test('parseAssertion reads every aggregation, comparison and window clause', () => {
  const aggs: Agg[] = ['all', 'any', 'min', 'max', 'mean', 'last', 'first'];
  for (const agg of aggs) {
    assert.equal(parseAssertion(`${agg}(population) >= 3`).agg, agg);
  }
  const cmps: Cmp[] = ['>=', '<=', '>', '<', '==', '!='];
  for (const cmp of cmps) {
    assert.equal(parseAssertion(`min(population) ${cmp} 3`).cmp, cmp);
  }

  const wide = parseAssertion(' mean( meanCarnivory ) >= 0.25 ');
  assert.deepEqual(wide, {
    expr: 'mean( meanCarnivory ) >= 0.25',
    agg: 'mean',
    metric: 'meanCarnivory',
    cmp: '>=',
    value: 0.25,
    from: 0,
    to: Infinity,
  });

  const windowed = parseAssertion('all(trophicClasses,ticks>=100,ticks<=9000)>=3');
  assert.equal(windowed.from, 100);
  assert.equal(windowed.to, 9000);

  assert.throws(() => parseAssertion('trophicClasses >= 3'), /bad assertion/);
  assert.throws(() => parseAssertion('all(trophicClasses) >='), /bad assertion/);
});

/** A series with the given `population` values, sampled one tick apart from tick 0. */
function series(values: number[]): Sample[] {
  return values.map((population, tick) => ({ tick, population }));
}

test('evaluateAssertion aggregates the filtered window, and an empty window fails', () => {
  const samples = series([3, 5, 7]);

  assert.equal(evaluateAssertion(parseAssertion('all(population)>=3'), samples).pass, true);
  assert.equal(evaluateAssertion(parseAssertion('all(population)>=4'), samples).pass, false);
  assert.equal(evaluateAssertion(parseAssertion('any(population)>=7'), samples).pass, true);
  assert.equal(evaluateAssertion(parseAssertion('any(population)>=8'), samples).pass, false);

  assert.equal(evaluateAssertion(parseAssertion('min(population)==3'), samples).pass, true);
  assert.equal(evaluateAssertion(parseAssertion('max(population)==7'), samples).pass, true);
  assert.equal(evaluateAssertion(parseAssertion('mean(population)==5'), samples).pass, true);
  assert.match(evaluateAssertion(parseAssertion('mean(population)==5'), samples).detail, /^mean 5 /);

  assert.equal(evaluateAssertion(parseAssertion('first(population)==3'), samples).pass, true);
  assert.equal(evaluateAssertion(parseAssertion('last(population)==7'), samples).pass, true);
  assert.equal(evaluateAssertion(parseAssertion('first(population)!=3'), samples).pass, false);
  assert.equal(evaluateAssertion(parseAssertion('last(population)!=7'), samples).pass, false);

  // The window filters by tick, so a violation inside the window still decides.
  const windowed = parseAssertion('all(population,ticks>=1)>=4');
  assert.equal(evaluateAssertion(windowed, samples).pass, true);
  assert.equal(evaluateAssertion(parseAssertion('all(population,ticks>=1,ticks<=1)>=6'), samples).pass, false);
  assert.equal(evaluateAssertion(parseAssertion('all(population,ticks>=1,ticks<=2)>=6'), samples).pass, false);
  assert.equal(evaluateAssertion(parseAssertion('min(population,ticks>=1)>=5'), samples).pass, true);

  const empty = evaluateAssertion(parseAssertion('all(population,ticks>=10)>=1'), samples);
  assert.equal(empty.pass, false);
  assert.equal(empty.detail, 'no samples in window');

  assert.throws(() => evaluateAssertion(parseAssertion('all(noSuchMetric)>=1'), samples), /unknown metric: noSuchMetric/);
});

test('decisiveFail only fires where the verdict can no longer change', () => {
  assert.equal(decisiveFail(parseAssertion('all(population)>=4'), series([3, 5, 7])), true);
  assert.equal(decisiveFail(parseAssertion('all(population)>=3'), series([3, 5, 7])), false);
  assert.equal(decisiveFail(parseAssertion('min(population)>=4'), series([3, 5, 7])), true);
  // A later sample can raise the maximum, the mean, the first and the aggregate of `any`, and
  // the minimum of an upper bound is not decided by one high sample.
  assert.equal(decisiveFail(parseAssertion('max(population)<=2'), series([3, 5, 7])), false);
  assert.equal(decisiveFail(parseAssertion('mean(population)<=1'), series([3, 5, 7])), false);
  assert.equal(decisiveFail(parseAssertion('any(population)>=9'), series([3, 5, 7])), false);
  assert.equal(decisiveFail(parseAssertion('first(population)>=9'), series([3, 5, 7])), false);
  assert.equal(decisiveFail(parseAssertion('last(population)>=9'), series([3, 5, 7])), false);
  assert.equal(decisiveFail(parseAssertion('min(population)<=4'), series([3, 5, 7])), false);
  // A violation outside the window decides nothing.
  assert.equal(decisiveFail(parseAssertion('all(population,ticks>=2)>=4'), series([3, 5, 7])), false);
});

test('sampleWorld reports the founder world every metric needs', () => {
  const world = new World();
  world.reset(12345);
  const s = sampleWorld(world);

  assert.equal(s.countersOk, 1);
  assert.equal(s.herbivore + s.omnivore + s.carnivore, s.population);
  // Founders: Grazer 80, Minnow 80, Hunter 48, Pike 48.
  assert.equal(s.population, 256);
  assert.equal(s.trophicClasses, 2);
  assert.equal(s.speciesTotal, 4);
  assert.ok(s.meanCarnivory > 0 && s.meanCarnivory < 1);

  const biomeKeys = Object.keys(s).filter((k) => k.startsWith('biome.'));
  assert.equal(biomeKeys.length, 9);
  let share = 0;
  for (const key of biomeKeys) share += s[key];
  assert.ok(Math.abs(share - 1) < 1e-9, `biome shares sum to ${share}`);

  // Sampling must not consume the world's rng: the same tick samples identically, and a
  // sampled world steps to the same state as an unsampled one.
  const again = sampleWorld(world);
  assert.deepEqual(again, s);
  const sampled = new World();
  sampled.reset(7);
  for (let i = 0; i < 20; i++) {
    sampled.step();
    sampleWorld(sampled);
  }
  const untouched = new World();
  untouched.reset(7);
  for (let i = 0; i < 20; i++) untouched.step();
  assert.deepEqual(sampleWorld(sampled), sampleWorld(untouched));
});

test('runSeed stops at the first sample that can no longer pass', () => {
  const result = runSeed({
    seed: 12345,
    ticks: 5000,
    every: 50,
    assertions: [parseAssertion('all(population)>=1000000')],
  });
  assert.equal(result.truncatedAt, 0);
  assert.equal(result.samples.length, 1);
  assert.equal(result.failedExpr, 'all(population)>=1000000');
  assert.equal(result.seed, 12345);
  assert.equal(result.ticks, 5000);

  const seen: Sample[] = [];
  const clean = runSeed({
    seed: 7,
    ticks: 20,
    every: 10,
    assertions: [parseAssertion(`all(trophicClasses,ticks>=${TROPHIC_WARMUP_TICKS})>=3`)],
    onSample: (s) => seen.push(s),
  });
  assert.equal(clean.truncatedAt, null);
  assert.equal(clean.failedExpr, null);
  assert.deepEqual(
    clean.samples.map((s) => s.tick),
    [0, 10, 20],
  );
  assert.deepEqual(seen, clean.samples);

  assert.equal(PRESETS.trophic.length, 1);
  assert.ok(PRESETS.trophic[0].includes(String(TROPHIC_WARMUP_TICKS)));
});

/** `[herbivore, omnivore, carnivore]` shares. */
type Shares = readonly [number, number, number];

/**
 * A synthetic run whose class shares at tick 0 and `TROPHIC_FAVOURED_FROM` are `from`, and at
 * tick 6000 are `to`, so the favoured class is the one with the largest `to - from` gain.
 */
function shareRun(
  seed: number,
  from: Shares,
  to: Shares,
): { seed: number; samples: Sample[] } {
  const sample = (tick: number, s: Shares): Sample => ({
    tick,
    herbivoreShare: s[0],
    omnivoreShare: s[1],
    carnivoreShare: s[2],
  });
  return { seed, samples: [sample(0, from), sample(TROPHIC_FAVOURED_FROM, from), sample(6000, to)] };
}

test('trophicMixVerdict names each gate and passes only when all four hold', () => {
  const balanced: Shares = [0.6, 0.2, 0.2];
  const verdicts = trophicMixVerdict([
    shareRun(1, balanced, [0.55, 0.25, 0.2]), // favoured: omnivore
    shareRun(2, balanced, [0.45, 0.25, 0.3]), // favoured: carnivore
    shareRun(3, balanced, [0.62, 0.19, 0.19]), // favoured: herbivore
  ]);
  assert.deepEqual(
    verdicts.map((v) => v.expr),
    [
      `viable(herbivoreShare,omnivoreShare,carnivoreShare)>=${TROPHIC_MIN_SHARE}`,
      `max(herbivoreShare)<=${TROPHIC_MAX_HERBIVORE_SHARE}`,
      `spread(carnivoreShare)>=${TROPHIC_MIN_CARNIVORE_SPREAD}`,
      'favouredClass is not constant',
    ],
  );
  assert.ok(verdicts.every((v) => v.pass), JSON.stringify(verdicts));
  // The detail names the failing/worst edge of the check.
  assert.match(verdicts[0].detail, /seed 3/);

  assert.throws(() => trophicMixVerdict([shareRun(1, balanced, balanced)]), /need >= 3 seeds/);
});

test('trophicMixVerdict fails G1 when a class dips below the viability floor', () => {
  const balanced: Shares = [0.6, 0.2, 0.2];
  const [g1] = trophicMixVerdict([
    shareRun(1, balanced, [0.55, 0.25, 0.2]),
    shareRun(2, balanced, [0.45, 0.25, 0.3]),
    shareRun(3, balanced, [0.62, 0.33, 0.05 - 0.005]), // carnivore share 0.045
  ]);
  assert.equal(g1.pass, false);
  assert.match(g1.detail, /carnivoreShare 0\.045 on seed 3/);
});

test('trophicMixVerdict fails G2 on a herbivore monoculture', () => {
  const balanced: Shares = [0.6, 0.2, 0.2];
  const [, g2] = trophicMixVerdict([
    shareRun(1, balanced, [0.55, 0.25, 0.2]),
    shareRun(2, balanced, [0.45, 0.25, 0.3]),
    shareRun(3, balanced, [TROPHIC_MAX_HERBIVORE_SHARE + 0.1, 0.05, 0.05]),
  ]);
  assert.equal(g2.pass, false);
  assert.match(g2.detail, /max herbivoreShare 0\.800 on seed 3/);
});

test('trophicMixVerdict fails G3(a) when the carnivore share barely varies', () => {
  const balanced: Shares = [0.6, 0.2, 0.2];
  const [, , g3a] = trophicMixVerdict([
    shareRun(1, balanced, [0.58, 0.22, 0.2]),
    shareRun(2, balanced, [0.56, 0.22, 0.22]),
    shareRun(3, balanced, [0.52, 0.24, 0.25]), // spread 0.05
  ]);
  assert.equal(g3a.pass, false);
  assert.match(g3a.detail, /spread 0\.050/);
});

test('trophicMixVerdict fails G3(b) when one class is favoured on every seed', () => {
  const balanced: Shares = [0.6, 0.2, 0.2];
  const [, , , g3b] = trophicMixVerdict([
    shareRun(1, balanced, [0.6, 0.3, 0.1]), // favoured: omnivore
    shareRun(2, balanced, [0.55, 0.3, 0.15]), // favoured: omnivore
    shareRun(3, balanced, [0.5, 0.3, 0.2]), // favoured: omnivore
  ]);
  assert.equal(g3b.pass, false);
  assert.match(g3b.detail, new RegExp(`favoured omnivore on 3/3 seeds \\(max ${TROPHIC_MAX_FAVOURED_FRACTION * 3}\\)`));
});
