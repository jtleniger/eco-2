# eco-2

Browser ecosystem sandbox: a procedurally generated 512 × 384 pixel landscape
whose color encodes its biome (water, beach, desert, fields, forest, swamp,
mountain, snow), biome-appropriate food that regrows toward a per-type carrying
capacity, and four creature founder lineages that live off it and evolve.

| Founder | Colour | Diet | Habitat | Size | Class |
| --- | --- | --- | --- | --- | --- |
| Grazer | `#ffff00` | land plants | land | 1.0 | Herbivore |
| Minnow | `#00f0ff` | Algae | water | 0.6 | Herbivore |
| Hunter | `#ff1a1a` | smaller creatures | land | 3.0 | Carnivore |
| Pike | `#ff00ff` | smaller creatures | water | 2.5 | Carnivore |

Every individual carries its own genome — fifteen continuous traits (vision,
speed, metabolism, energy caps, age, thermal bands, body `size`, and a
`carnivory` axis from 0 Herbivore to 1 Carnivore) plus two categorical bitmasks
for habitat and digestible plants. The habitat mask gates which biomes a creature
may enter, but a mutation can add bits no member ever uses — Deep Water and Beach
host no food — so the menu's habitat line reports the biomes the species'
members have actually stood on, not the mask. The mask is not the only way in:
foodless barriers also yield to body size, so a creature can cross them without
carrying the bit, but only along its own lineage: a water creature whose `size`
reaches 1 may swim open Deep Water, and a land creature of `size` 1 may wade
shallow Water or walk the Beach between them. A swimmer therefore never gains
land, nor a walker open water. So the larger fish can range between lakes across
the deep while the smallest stay in their own shallows, and a big land animal can
ford a channel to reach the far bank. Eating is one unified edibility rule:
a creature grazes a plant cell when the plant's bit is set in its `foodMask` and
its `carnivory` is below `CARNIVORE_MIN`, and it kills a creature it lands on
when its `carnivory` is at least `HERBIVORE_MAX` and its mass clears a multiple of
the target's. That multiple is `PREY_SIZE_RATIO` (1.3) for anything below
`CARNIVORE_MIN` and falls linearly to `PREY_SIZE_RATIO_SPECIALIST` (0.55) at pure
carnivory, so a dedicated carnivore can tackle prey up to ~1.8× its own mass while
a marginal hunter must outweigh its prey; a fellow predator is dangerous prey and
always needs the full 1.3 margin, so the widened reach cannot turn the predator
band into cannibals. The trophic class shown in the menu is derived
from `carnivory` (`< 0.34` Herbivore, `< 0.66` Omnivore, else Carnivore). A plant
meal is a small fixed yield, `(1 - carnivory)^3` of `eatGain`, the same for a mouse
and an elephant: the exponent is a mixed gut's assimilation penalty, and it is what
keeps the omnivore band — which keeps a kill channel *and* a grazing channel — from
being the single best strategy on every seed. A kill transfers the prey's stored
energy, scaled by
`carnivory` and by the run's per-seed `huntEfficiency` (at most 1), so predation
moves energy rather than minting it and the crop is the
ecosystem's only influx. Upkeep is `metabolism * size^0.75` (Kleiber-like) plus
`vision * VISION_UPKEEP`, so both body size and a sharp eye are real costs — met by
eating more, or bigger prey, not a bigger mouthful of grass. Metabolism is a
trade-off rather than a free saving: a high rate burns
energy but lowers the energy a creature must bank before it breeds, while a low
rate is cheap to keep but breeds later, so neither extreme sweeps the gene pool
and upkeep keeps the population bounded by primary production. Offspring recombine both parents' genomes and mutate, so
traits drift within a lineage. Two creatures can only mate when their genomes are
close enough, so a newborn that is still within `SPECIATION_DISTANCE` of either
parent stays in that parent's species however far the species' reference genome
has drifted. Only a child too distant from both parents to breed with either is
reproductively isolated: it founds a new species and both parents leave their old
species to become its founding pair, so the daughter lineage can reproduce
instead of dying out as a single member. A founding child is named by a local,
seeded pronounceable generator (`src/lib/names.ts`), so a seeded run reproduces
the same species names.

Each creature is one agent with energy, age and a cell: it steers toward the
nearest visible food or prey, eats what it lands on, and reproduces sexually by
splitting both parents' energy to raise one child. One creature = one pixel; the
menu's Species section lists every species this run has ever created, sorted by
live population with the extinct ones greyed out at the bottom, and scrolls inside
a bounded box so a long run cannot push the World section off the panel. Selecting
a species opens its detail in place, directly under its row.

The climate is seasonal: a sinusoid of amplitude `±0.12` with a ~6-minute period
at `1x` (`SEASON_PERIOD_TICKS = 3600`) shifts every cell's temperature, and every
30 ticks the snow/desert/forest/swamp bands are reclassified — the map's colours
advance and retreat through Spring/Summer/Autumn/Winter. The offset is phased to
the seasons so it crosses zero rising at mid-Spring, peaks mid-Summer and troughs
mid-Winter: snow recedes through Spring and the first half of Summer, then
rebuilds through Autumn and the first half of Winter. The snow line carries a
static per-cell jitter (`SNOW_EDGE_AMPLITUDE`), so it melts back as a ragged,
terrain-like edge instead of a smooth isotherm. Each creature's genome carries a
survival band it dies outside of and a narrower comfort band it walks toward when
it drifts out of it. Each seed also draws its own environmental profile from a
dedicated stream — never the run's own `rng`, so a seed still reproduces its exact
history — a `huntEfficiency` (the fraction of a carcass a predator can use,
0.55–1.0) and a `seasonAmplitude` (0.10–0.26, so harsh worlds swing harder);
`npm run sim --json` reports both per run. The toolbar shows the current season; the menu's World
section shows the mean temperature and the current offset.

## Run

```bash
npm install
npm run dev      # http://localhost:5173
npm run check    # svelte-check + tsc
npm test         # headless simulation tests (node --test, no browser)
npm run sim      # headless long-run verification (see below)
npm run build    # dist/
```

## Verification

A claim about a long run ("trophic diversity persists") is checked headless, for many seeds at
once, without watching the browser at 10 ticks/second and without a throwaway script:

```bash
npm run sim -- --ticks 9000 --seeds 1,7,99,12345 --check trophic
```

Each seed runs in its own worker thread; the CLI samples the standard metric set every
`--every` ticks, evaluates the assertions and exits `0` on PASS, `1` on FAIL, `2` on a usage
error. `--help` prints every flag, the preset sets and the metric keys, which come from a real
`sampleWorld` sample and so cannot drift from the code. `--progress` streams per-sample lines
on stderr; `--json` puts the whole report on stdout (use `npm run --silent sim -- …` when
piping it into a parser, since `npm` writes its own banner to stdout).

An assertion is `<agg>(<metric>[,ticks>=<n>][,ticks<=<n>]) <cmp> <number>` — for example
`all(population)>=1`, `mean(meanCarnivory,ticks>=2000)>0.15`, `last(speciesTotal)>4`. The
`ticks` clauses restrict the window that is aggregated, and a window selecting no sample
fails rather than passing vacuously. `all`, `any`, `min`, `max`, `mean`, `last` and `first`
aggregate as named. Only a failure that can no longer be repaired stops a run early — `all`
under any comparison, and `min` under a lower bound — so a PASS always spends the full tick
budget and a truncated series is always a failing one. Presets: `survival`, `trophic`
(`trophicClasses` back to 3 after `TROPHIC_WARMUP_TICKS`, because the omnivore band can only
appear by mutation) and `speciation`.

`--check trophic-mix` is a *seed-set* check rather than a per-seed assertion: it is evaluated
once over every run and needs at least three seeds. It asserts that all three trophic classes
hold at least 5% of the final population on every seed, that no seed ends above 70% herbivore,
that the final carnivore share spans at least 0.10 across the seeds, and that the class gaining
most share between tick 1000 and the end is not the same on more than two thirds of them.

```bash
npm run sim -- --ticks 6000 --seeds 1..8,12345 --every 250 --jobs 8 --check trophic-mix --check survival
```

## Controls

The world boots **paused** with a freshly generated seed.

| Control | Effect |
| --- | --- |
| `Start` / `Pause` | run or freeze the simulation |
| `Reset` | regenerate the world with a new seed and pause |
| `0.5x` / `1x` / `2x` | simulation speed; `1x` = 10 ticks/second |
| `Menu` | right-hand drawer: color legend, live biome/food/species statistics, seed, tick |

Food regrows on random cells, but only where its local density is still under its
coverage cap, so a grazed patch is replenished where it was eaten instead of the
crop drifting away from its consumers. One world cell = one pixel of the canvas
backing store; the canvas is integer-upscaled with `image-rendering: pixelated`.

## Layout

| Path | Role |
| --- | --- |
| `src/lib/config.ts` | every tunable: world size, tick rate, speeds, terrain thresholds |
| `src/lib/palette.ts` | biome/food ids, colors, densities, biome eligibility — single source of truth for cell values |
| `src/lib/rng.ts`, `noise.ts`, `terrain.ts`, `climate.ts`, `food.ts`, `genetics.ts`, `names.ts`, `species.ts`, `creatures.ts` | pure, DOM-free simulation core (runs under plain `node`): terrain, the season clock, food regrowth, the genome operators, the seeded name generator, the founder/species registry and the creature agents |
| `src/lib/world.ts` | all simulated state + one tick; no canvas, DOM or UI coupling |
| `src/lib/simrun.ts` | headless long-run harness: the metric sampling, the assertion grammar, `runSeed` (the only run loop), the presets and the cross-seed `trophic-mix` check |
| `src/lib/simrun.test.ts` | tests for the harness itself: parsing, aggregation, fail-fast, metric soundness, sampling that does not perturb a run |
| `scripts/sim.ts`, `scripts/sim-worker.ts` | `npm run sim` CLI and its one-seed-per-thread worker entry |
| `src/lib/sim.test.ts` | headless tests over `World`: creature bookkeeping, hunting, the unified edibility rule, size/carnivory tradeoffs, seeded species names, determinism, caps, speciation and extinction, a 5000-tick ecosystem survival run |
| `src/lib/renderer.ts` | Canvas 2D `ImageData` blitter, one pixel per cell (creature over food over biome) |
| `src/lib/engine.ts` | canvas, clock and UI mirror driving `World` (accumulator, spiral guard) |
| `src/lib/ui.svelte.ts` | `$state` object bridging engine → components |
| `src/lib/components/` | `Toolbar.svelte`, `MenuPanel.svelte` |
