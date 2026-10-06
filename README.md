# eco-2

Browser ecosystem sandbox: a procedurally generated 512 × 384 pixel landscape
whose color encodes its biome (water, beach, desert, fields, forest, swamp,
mountain, snow), biome-appropriate food that regrows toward a per-type carrying
capacity, and four creature species that live off it.

| Species | Colour | Diet | Habitat |
| --- | --- | --- | --- |
| Grazer | `#ffff00` | land plants | land |
| Minnow | `#00f0ff` | Algae | water |
| Hunter | `#ff1a1a` | Grazers | land |
| Pike | `#ff00ff` | Minnows | water |

Each creature is one agent with energy, age and a cell: it steers toward the
nearest visible food or prey, eats what it lands on, splits its energy to
reproduce, and dies of starvation or old age. Predators move two cells per tick,
herbivores one. One creature = one pixel; the menu's Creatures section shows the
live counts.

The climate is seasonal: a sinusoid of amplitude `±0.12` with a ~6-minute period
at `1x` (`SEASON_PERIOD_TICKS = 3600`) shifts every cell's temperature, and every
30 ticks the snow/desert/forest/swamp bands are reclassified — the map's colours
advance and retreat through Spring/Summer/Autumn/Winter. The snow line carries a
static per-cell jitter (`SNOW_EDGE_AMPLITUDE`), so it melts back as a ragged,
terrain-like edge instead of a smooth isotherm. Each species has a
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
| `Menu` | right-hand drawer: color legend, live biome/food/creature statistics, seed, tick |

Food regrows on random cells, but only where its local density is still under its
coverage cap, so a grazed patch is replenished where it was eaten instead of the
crop drifting away from its consumers. One world cell = one pixel of the canvas
backing store; the canvas is integer-upscaled with `image-rendering: pixelated`.

## Layout

| Path | Role |
| --- | --- |
| `src/lib/config.ts` | every tunable: world size, tick rate, speeds, terrain thresholds |
| `src/lib/palette.ts` | biome/food ids, colors, densities, biome eligibility — single source of truth for cell values |
| `src/lib/rng.ts`, `noise.ts`, `terrain.ts`, `climate.ts`, `food.ts`, `species.ts`, `creatures.ts` | pure, DOM-free simulation core (runs under plain `node`): terrain, the season clock, food regrowth, the species table and the creature agents |
| `src/lib/world.ts` | all simulated state + one tick; no canvas, DOM or UI coupling |
| `src/lib/sim.test.ts` | headless tests over `World`: creature bookkeeping, hunting, determinism, caps, a 5000-tick four-species survival run |
| `src/lib/renderer.ts` | Canvas 2D `ImageData` blitter, one pixel per cell (creature over food over biome) |
| `src/lib/engine.ts` | canvas, clock and UI mirror driving `World` (accumulator, spiral guard) |
| `src/lib/ui.svelte.ts` | `$state` object bridging engine → components |
| `src/lib/components/` | `Toolbar.svelte`, `MenuPanel.svelte` |
