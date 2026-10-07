/// <reference types="node" />
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PRESETS,
  TROPHIC_WARMUP_TICKS,
  decisiveFail,
  evaluateAssertion,
  parseAssertion,
  runSeed,
  sampleWorld,
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
