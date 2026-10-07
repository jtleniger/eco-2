# Optimization candidates

Where the iteration time actually went during the trophic-viability work, and what to change so the
next tuning pass is cheaper. Times are wall-clock from this session; estimates are marked.

## Where the time went (measured)

| Command | Wall | Runs | Total |
|---|---|---|---|
| `npm run sim -- --ticks 6000 --seeds 1..8,12345 --every 250 --jobs 8 --check trophic-mix --check survival --json` (the gate sweep) | 83-176 s | 9 | ~19 min |
| throwaway diagnostic (`node /tmp/diag.ts`, 1-4 seeds x 6000 ticks, 3 class counters + histogram) | 23-60 s/seed | ~20 runs | ~17 min |
| `npm test` | 220 s (383 s per the plan's baseline; not re-measured) | 1 | ~4 min |
| `node --test --test-name-pattern …` subsets | 30-46 s | 4 | ~3 min |
| `npm run sim -- --ticks 12000 --seeds 12345,7 --check speciation --check trophic` | 109 s | 1 | ~2 min |
| `npm run check` | 1.7 s | ~8 | ~0.2 min |

So roughly **45 minutes of the session was command execution**, and most of it was the gate sweep
plus the diagnostic harness. The knobs themselves were cheap to change (one line each).

## Why it was expensive

1. **One knob change costs a full 9-seed sweep.** The gates are defined over a seed set, and
   single-seed results are actively misleading: `huntEfficiency` looked like a 0.100 -> 0.061
   carnivore-share effect on seed 1, but the whole seed set only spread 0.043. There is no
   "screen on 3 seeds, confirm on 9" step, so every value got the full sweep.
2. **Run cost scales with the quantity being tuned.** Per-tick cost is dominated by the
   `findTarget` vision-radius scan, so a knob that raises vision or population slows the very
   measurement that evaluates it. Measured: meanVision 12 (upkeep 0) ~38 s/seed; meanVision 6.5
   (upkeep 0.04) ~20 s/seed; a weak-predator config grew the population to 15017 and took 48 s for
   a single seed. The tuning loop gets slowest exactly where the ecology gets big.
3. **No snapshot, resume, or incremental run.** `runSeed` always restarts at tick 0, so a
   follow-up question about tick 1000 state costs another full run. Nothing caches a completed
   `(seed, ticks, config)` result, and most sweeps re-ran identical configurations.
4. **No committed diagnostic entry point.** Answering "where does the carnivory gene settle, and
   through which channel does each class feed?" needed a throwaway script that monkey-patched the
   private `Population.prototype.eat` / `findTarget` / `remove` through `as unknown as { … }`
   casts. That script had to be written from scratch, and every signature change broke it (adding
   a parameter to `step`/`eat` silently dropped an argument until the wrapper was changed to
   forward `...args`). It also had to re-implement `preyMassRatio` to calibrate a config constant,
   duplicating the rule in a second place. The scripts live in `/tmp` and were deleted at the end,
   so none of it is reusable.
5. **No per-run config override.** Calibrating a constant meant editing `src/lib/config.ts` per
   value, which invalidates any in-flight sweep and forces a re-run.
6. **The suite is a handful of long World-stepping tests.** `npm test` is ~220 s although almost
   every test is sub-millisecond: `speciation actually happens` (12000 ticks, 66 s), `snow recedes
   …` (3600 ticks, 28 s), `the ecosystem survives 5000 ticks` and `all three trophic strategies
   persist` (2 x 5000 ticks each) dominate. Only `seededSpeciationRun` is memoised; the others each
   step their own world from scratch.
7. **The last seed runs alone.** One worker per seed with `--jobs 8` and 9 seeds leaves the ninth
   seed on a single thread at the end, so the tail is a full run's latency.
8. **Determinism constraints make each measurement fragile.** Anything that consumed `world.rng`
   would have invalidated every recorded baseline, so the per-seed profile needed its own stream -
   and discovering that `mulberry32`'s *first* draw is poorly mixed for small seeds (`seed ^
   0x51ed270b` lands in 0.33-0.97 on 1..8,12345) cost a sweep to find.

## Candidates, ranked by payoff over effort

1. **Result cache keyed by `(seed, ticks, every, config-hash)`.** Most sweeps re-run identical
   configurations across seeds while only one constant changed; a content-addressed cache of
   `RunResult` (JSON on disk under a gitignored dir) would make re-runs of 8 of 9 seeds free. Needs
   a stable hash of the tunables (`config.ts` + `GENES` + the founder table). Biggest single win,
   low risk.
2. **Two-stage check: screen then confirm.** Add `--screen <n>` (or make the gate check itself
   support a fast preset) that evaluates `trophic-mix` on 3 seeds, and only escalates to the full
   set when the screen is within a margin. Halves a typical iteration.
3. **A committed `--hist` / `--class-stats` diagnostic.** Fold the throwaway harness's questions
   into `sampleWorld` (carnivory histogram in 20 bins, per-class meals/kills/deaths) or into a
   `--hist` flag, so the private-method monkey-patching is never needed again. Also add a
   `--override K=V` flag (or env) so a constant can be calibrated without editing the source.
4. **Share mature worlds across tests.** A memoised `matureWorld(seed, ticks)` used by
   `the ecosystem survives`, `all three trophic strategies persist` and the snow/biome tests would
   cut most of the 220 s; `seededSpeciationRun` already shows the pattern. Risk: tests that mutate
   the world must keep their own copy (the `grazing is replenished` test already clones by
   re-stepping).
5. **Work-stealing instead of one worker per seed.** A queue over seeds removes the single-seed
   tail; with 9 seeds/8 jobs that is one full run saved per sweep.
6. **Cut the hot loop.** `findTarget` scans `vision^2` cells per creature-step (the dominant cost at
   ~450 cells when vision hit 12). Candidates: cache the nearest-plant direction per creature and
   only rescan when it moves, or a coarse bucket index of occupants. `VISION_UPKEEP` already caps
   vision at ~6.5, which halved the suite; a directional cache would go further but is a real
   algorithmic change and needs a bit-identical check like the one used for Step 2a.
7. **Cheapen `sampleWorld`.** It allocates a `Uint32Array(BIOMES.length)` and walks all 196608
   cells for biome shares on every sample, plus `MAX_SPECIES` (1024) passes. Reuse the array and
   make the biome walk lazy (only when a `biome.*` metric is actually asserted).
8. **Document the diagnostic recipe in the repo.** The monkey-patch pattern
   (`Population.prototype.eat = … as unknown as { eat: … }`) plus the `node` type-stripping
   invocation is the only way to answer mechanism questions today; a short `docs` note or a
   `scripts/probe.ts` skeleton would make the next pass start from a working harness instead of a
   blank file.

## What is not worth optimizing

- `npm run check` (1.7 s) and the per-sample assertion evaluation are already negligible.
- The at-cap `classify` scan: measured at ~0.2 % of runtime after `MAX_SPECIES = 1024`, so the
  planned bin-index fallback would buy nothing measurable.
- The per-seed profile draw: a handful of `mulberry32` calls per `reset`.
