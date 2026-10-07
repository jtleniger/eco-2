// `npm run sim` — fast-forward the simulation headless for many seeds in parallel worker
// threads, sample a fixed metric set, and print a verdict for declarative assertions over time.
// No browser, no per-claim script: `scripts/sim-worker.ts` runs one seed per thread.
import { availableParallelism } from 'node:os';
import { Worker } from 'node:worker_threads';
import {
  PRESETS,
  assertionMeasure,
  evaluateAssertion,
  parseAssertion,
  sampleWorld,
  type Assertion,
  type Sample,
} from '../src/lib/simrun.ts';
import { World } from '../src/lib/world.ts';

interface RunReport {
  seed: number;
  ticks: number;
  truncatedAt: number | null;
  failedExpr: string | null;
  samples: Sample[];
}

interface Verdict {
  expr: string;
  pass: boolean;
  failures: { seed: number; detail: string }[];
}

type WorkerMessage =
  | { type: 'sample'; sample: Sample }
  | { type: 'done'; seed: number; ticks: number; truncatedAt: number | null; failedExpr: string | null };

const USAGE =
  'usage: npm run sim -- [--ticks <n>] [--seeds <list>] [--every <n>] [--jobs <n>] [--check <name>] [--assert <expr>] [--progress] [--json]';

function usageError(message: string): never {
  process.stderr.write(`eco-2 sim: ${message}\n${USAGE}\n`);
  process.exit(2);
}

function helpText(): string {
  // The metric list comes from a real sample, so it cannot drift from `sampleWorld`.
  const metrics = Object.keys(sampleWorld(new World())).sort();
  const presets = Object.keys(PRESETS)
    .map((name) => `  ${name.padEnd(12)}${PRESETS[name].join('; ')}`)
    .join('\n');
  return `eco-2 sim — fast-forward the simulation headless and check a claim over time

${USAGE}

flags:
  --ticks <n>      ticks per seed (default 5000)
  --seeds <list>   comma-separated seeds; "a..b" is an inclusive range (default 1,7,12345)
  --every <n>      sample every n ticks (default max(1, floor(ticks / 100)))
  --jobs <n>       worker threads (default ${availableParallelism()}), capped at the seed count
  --check <name>   a preset below, repeatable; "survival" is the default when neither
                   --check nor --assert is given
  --assert <expr>  custom assertion, repeatable; presets run first, in the order given
  --progress       per-sample progress lines on stderr
  --json           machine-readable report on stdout
  -h, --help       this text

assertion grammar (whitespace-tolerant):
  <agg>(<metric>[,ticks>=<n>][,ticks<=<n>]) <cmp> <number>

  aggregations   all, any, min, max, mean, last, first
  comparators    >=, <=, >, <, ==, !=
  A window that selects no sample fails with "no samples in window"; an empty tick window
  never passes vacuously.

presets:
${presets}

metrics (${metrics.length}):
  ${metrics.join(', ')}
`;
}

function positiveInt(flag: string, text: string): number {
  if (!/^\d+$/.test(text) || Number(text) < 1) usageError(`${flag}: expected a positive integer, got "${text}"`);
  return Number(text);
}

function parseSeeds(text: string): number[] {
  const seeds: number[] = [];
  const add = (seed: number): void => {
    if (!seeds.includes(seed)) seeds.push(seed);
  };
  for (const raw of text.split(',')) {
    const token = raw.trim();
    const range: readonly (string | undefined)[] | null = /^(\d+)(?:\.\.(\d+))?$/.exec(token);
    if (range === null) usageError(`--seeds: bad seed "${raw}"`);
    const first = Number(range[1]);
    if (range[2] === undefined) {
      add(first);
      continue;
    }
    if (Number(range[2]) < first) usageError(`--seeds: descending range "${token}"`);
    if (Number(range[2]) - first + 1 > 256) usageError(`--seeds: range "${token}" holds more than 256 seeds`);
    for (let seed = first; seed <= Number(range[2]); seed++) add(seed);
  }
  if (seeds.length === 0) usageError('--seeds: no seeds given');
  return seeds;
}

/** Run every seed on a fresh worker thread, at most `jobs` at a time. */
function runSeeds(
  seeds: number[],
  ticks: number,
  every: number,
  jobs: number,
  assertions: Assertion[],
  onSample: (seed: number, s: Sample) => void,
): Promise<RunReport[]> {
  const { promise, resolve, reject } = Promise.withResolvers<RunReport[]>();
  const reports: RunReport[] = [];
  const workerUrl = new URL('./sim-worker.ts', import.meta.url);
  const live = new Map<number, Worker>();
  let started = 0;
  let finished = 0;
  let stalled = false;

  const abort = (reason: string): void => {
    if (stalled) return;
    stalled = true;
    for (const worker of live.values()) void worker.terminate();
    live.clear();
    reject(new Error(reason));
  };

  const start = (index: number): void => {
    const seed = seeds[index];
    const samples: Sample[] = [];
    const worker = new Worker(workerUrl, {
      workerData: { seed, ticks, every, assertions },
    });
    live.set(index, worker);
    started++;

    worker.on('message', (message: WorkerMessage) => {
      if (stalled) return;
      if (message.type === 'sample') {
        samples.push(message.sample);
        onSample(seed, message.sample);
        return;
      }
      live.delete(index);
      reports[index] = {
        seed: message.seed,
        ticks: message.ticks,
        truncatedAt: message.truncatedAt,
        failedExpr: message.failedExpr,
        samples,
      };
      void worker.terminate();
      finished++;
      if (finished === seeds.length) {
        resolve(reports);
        return;
      }
      pump();
    });

    worker.on('error', (err: Error) => abort(`seed ${seed}: ${err.message}`));
    // A worker that reported `done` has already left `live`: an exit while still live means
    // the run never finished.
    worker.on('exit', (code: number) => {
      if (!live.has(index)) return;
      abort(`seed ${seed}: worker exited with code ${code} before reporting`);
    });
  };

  const pump = (): void => {
    while (started < seeds.length && live.size < jobs) start(started);
  };

  pump();
  return promise;
}

function worstSeed(a: Assertion, reports: RunReport[]): { seed: number; detail: string } {
  // For a lower bound the smallest measure is closest to failing, for an upper bound the
  // largest; `==` / `!=` have no direction, so the first seed stands in.
  const lowerBound = a.cmp === '>=' || a.cmp === '>';
  const upperBound = a.cmp === '<=' || a.cmp === '<';
  let best: { seed: number; detail: string; measure: number } | null = null;
  for (const run of reports) {
    const measure = assertionMeasure(a, run.samples);
    if (measure === null) continue;
    if (best === null || (lowerBound && measure < best.measure) || (upperBound && measure > best.measure)) {
      best = { seed: run.seed, detail: evaluateAssertion(a, run.samples).detail, measure };
    }
  }
  const chosen = best ?? { seed: reports[0].seed, detail: evaluateAssertion(a, reports[0].samples).detail };
  return { seed: chosen.seed, detail: chosen.detail };
}

function main(): void {
  const argv = process.argv.slice(2);
  let ticks = 5000;
  let seedsText = '1,7,12345';
  let every = 0;
  let jobs = 0;
  let progress = false;
  let json = false;
  let help = false;
  const checks: string[] = [];
  const asserts: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const take = (): string => {
      const value = argv[++i];
      if (value === undefined || value.startsWith('--')) usageError(`${arg}: missing value`);
      return value;
    };
    switch (arg) {
      case '--ticks':
        ticks = positiveInt('--ticks', take());
        break;
      case '--seeds':
        seedsText = take();
        break;
      case '--every':
        every = positiveInt('--every', take());
        break;
      case '--jobs':
        jobs = positiveInt('--jobs', take());
        break;
      case '--check':
        checks.push(take());
        break;
      case '--assert':
        asserts.push(take());
        break;
      case '--progress':
        progress = true;
        break;
      case '--json':
        json = true;
        break;
      case '-h':
      case '--help':
        help = true;
        break;
      default:
        usageError(`unknown flag "${arg}"`);
    }
  }

  if (help) {
    process.stdout.write(helpText());
    return;
  }

  const seeds = parseSeeds(seedsText);
  if (checks.length === 0 && asserts.length === 0) checks.push('survival');
  if (every === 0) every = Math.max(1, Math.floor(ticks / 100));
  if (jobs === 0) jobs = availableParallelism();
  jobs = Math.min(jobs, seeds.length);

  const exprs: string[] = [];
  for (const name of checks) {
    if (!Object.hasOwn(PRESETS, name)) {
      usageError(`--check: unknown preset "${name}" (have: ${Object.keys(PRESETS).join(', ')})`);
    }
    for (const expr of PRESETS[name]) exprs.push(expr);
  }
  for (const expr of asserts) exprs.push(expr);
  const assertions = exprs.map((expr) => {
    try {
      return parseAssertion(expr);
    } catch (err) {
      usageError(err instanceof Error ? err.message : String(err));
    }
  });

  if (!json) {
    process.stdout.write(
      `eco-2 sim — ${seeds.length} seeds × ${ticks} ticks, sample every ${every}, ${jobs} jobs\n\n`,
    );
  }

  const startedAt = Date.now();
  runSeeds(seeds, ticks, every, jobs, assertions, (seed, sample) => {
    if (progress) {
      process.stderr.write(`seed ${seed}  ${sample.tick}/${ticks} ticks  pop ${sample.population}\n`);
    }
  })
    .then((reports) => {
      const wallMs = Date.now() - startedAt;
      const verdicts: Verdict[] = assertions.map((a) => {
        const failures: { seed: number; detail: string }[] = [];
        for (const run of reports) {
          if (run.truncatedAt !== null) {
            failures.push(
              run.failedExpr === a.expr
                ? {
                    seed: run.seed,
                    detail: `${evaluateAssertion(a, run.samples).detail} (run truncated at tick ${run.truncatedAt})`,
                  }
                : { seed: run.seed, detail: `not evaluated (run truncated at tick ${run.truncatedAt})` },
            );
            continue;
          }
          const { pass, detail } = evaluateAssertion(a, run.samples);
          if (!pass) failures.push({ seed: run.seed, detail });
        }
        return { expr: a.expr, pass: failures.length === 0, failures };
      });
      const failedSeeds = new Set<number>();
      for (const verdict of verdicts) for (const failure of verdict.failures) failedSeeds.add(failure.seed);
      const pass = failedSeeds.size === 0;

      if (json) {
        process.stdout.write(
          `${JSON.stringify(
            {
              options: { ticks, seeds, every, jobs, assertions: exprs, checks },
              runs: reports,
              verdicts,
              pass,
              wallMs,
            },
            null,
            2,
          )}\n`,
        );
        process.exitCode = pass ? 0 : 1;
        return;
      }

      for (const run of reports) {
        const last = run.samples[run.samples.length - 1];
        const mark = run.truncatedAt !== null ? `truncated@${run.truncatedAt}` : failedSeeds.has(run.seed) ? '✘' : '✔';
        process.stdout.write(
          `seed${String(run.seed).padStart(7)}  ${run.ticks}t  pop ${last.population}  ` +
            `live ${last.speciesLive}/${last.speciesTotal}  extinct ${last.speciesExtinct}  ` +
            `h/o/c ${last.herbivore}/${last.omnivore}/${last.carnivore}  ` +
            `meanCarn ${last.meanCarnivory.toFixed(3)}  ${mark}\n`,
        );
      }

      process.stdout.write('\n');
      verdicts.forEach((verdict, index) => {
        if (verdict.pass) {
          const worst = worstSeed(assertions[index], reports);
          process.stdout.write(`assert ${verdict.expr}  PASS  all seeds (worst seed ${worst.seed}: ${worst.detail})\n`);
          return;
        }
        process.stdout.write(`✘ assert ${verdict.expr}  FAIL\n`);
        for (const failure of verdict.failures) {
          process.stdout.write(`    seed ${failure.seed}: ${failure.detail}\n`);
        }
      });
      process.stdout.write(
        `\nRESULT ${pass ? 'PASS' : 'FAIL'}  (${seeds.length} seeds × ${ticks} ticks, ${(wallMs / 1000).toFixed(1)}s)\n`,
      );
      process.exitCode = pass ? 0 : 1;
    })
    .catch((err: Error) => {
      process.stderr.write(`eco-2 sim: ${err.message}\n`);
      process.exitCode = 1;
    });
}

main();
