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
carrying the bit. A water creature whose `size` reaches 1 may swim open Deep
Water, a land creature of `size` 1 may wade shallow Water, and Beach is walkable
by anything of `size` 1 — so the larger fish can range between lakes across the
deep and along the sand while the smallest stay in their own shallows, and a big
land animal can ford a channel to reach the far bank. Eating is one unified edibility rule:
a creature grazes a plant cell when the plant's bit is set in its `foodMask` and
its `carnivory` is below `CARNIVORE_MIN`, and it kills a creature it lands on
when its `carnivory` is at least `HERBIVORE_MAX` and its mass is at least
`PREY_SIZE_RATIO` (1.3) times the target's — so predators eat creatures that are
significantly smaller, not a fixed taxonomic class. The trophic class shown in
the menu is derived from `carnivory` (`< 0.34` Herbivore, `< 0.66` Omnivore,
else Carnivore), a plant meal is worth `(1 - carnivory)` of its `eatGain` so
omnivores graze at reduced yield, a kill's calories scale with the prey's mass
(`PREY_CALORIE_MULT`), and upkeep scales with `size^0.75` (Kleiber-like). A meal
is credited at that same `size^0.75`, so a bigger body eats a bigger mouthful: the
larger upkeep is met by larger meals, size is not a pure tax, and fish grow past
their founding size instead of shrinking to the gene floor. Offspring recombine both parents' genomes and mutate, so
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
it drifts out of it. The toolbar shows the current season; the menu's World
section shows the mean temperature and the current offset.

## Run

```bash
npm install
npm run dev      # http://localhost:5173
npm run check    # svelte-check + tsc
npm test         # headless simulation tests (node --test, no browser)
npm run build    # dist/
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
| `src/lib/sim.test.ts` | headless tests over `World`: creature bookkeeping, hunting, the unified edibility rule, size/carnivory tradeoffs, seeded species names, determinism, caps, speciation and extinction, a 5000-tick ecosystem survival run |
| `src/lib/renderer.ts` | Canvas 2D `ImageData` blitter, one pixel per cell (creature over food over biome) |
| `src/lib/engine.ts` | canvas, clock and UI mirror driving `World` (accumulator, spiral guard) |
| `src/lib/ui.svelte.ts` | `$state` object bridging engine → components |
| `src/lib/components/` | `Toolbar.svelte`, `MenuPanel.svelte` |
