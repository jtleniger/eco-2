# eco-2

Browser ecosystem sandbox. This milestone is the world only: a procedurally
generated 512 × 384 pixel landscape whose color encodes its biome (water,
beach, desert, fields, forest, swamp, mountain, snow), plus biome-appropriate
food that regrows toward a per-type carrying capacity. No creatures yet.

## Run

```bash
npm install
npm run dev      # http://localhost:5173
npm run check    # svelte-check + tsc
npm run build    # dist/
```

## Controls

The world boots **paused** with a freshly generated seed.

| Control | Effect |
| --- | --- |
| `Start` / `Pause` | run or freeze the simulation |
| `Reset` | regenerate the world with a new seed and pause |
| `0.5x` / `1x` / `2x` | simulation speed; `1x` = 10 ticks/second |
| `Menu` | right-hand drawer: color legend, live biome/food statistics, seed, tick |

Food never decays and is never consumed (nothing eats it yet), so it saturates at
each type's coverage cap. One world cell = one pixel of the canvas backing store;
the canvas is integer-upscaled with `image-rendering: pixelated`.

## Layout

| Path | Role |
| --- | --- |
| `src/lib/config.ts` | every tunable: world size, tick rate, speeds, terrain thresholds |
| `src/lib/palette.ts` | biome/food ids, colors, densities, biome eligibility — single source of truth for cell values |
| `src/lib/rng.ts`, `noise.ts`, `terrain.ts`, `food.ts` | pure, DOM-free simulation core (runs under plain `node`); terrain generation and food regrowth live here |
| `src/lib/renderer.ts` | Canvas 2D `ImageData` blitter, one pixel per cell |
| `src/lib/engine.ts` | world state + fixed-timestep loop (accumulator, spiral guard) |
| `src/lib/ui.svelte.ts` | `$state` object bridging engine → components |
| `src/lib/components/` | `Toolbar.svelte`, `MenuPanel.svelte` |
