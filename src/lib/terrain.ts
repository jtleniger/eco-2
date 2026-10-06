import {
  ALPINE_SNOW_TEMP,
  BEACH_TOP,
  COLD_MAX,
  DESERT_DRY,
  FALLOFF,
  FIELD_MOIST,
  FOREST_MOIST,
  FREQ,
  GRID,
  H,
  MOUNTAIN,
  P_HIGH,
  P_LOW,
  SEA_DEEP,
  SEA_SHALLOW,
  SNOW_EDGE_AMPLITUDE,
  SNOW_EDGE_FREQ,
  SNOW_TEMP,
  SWAMP_WET,
  TEMP_ALT_PENALTY,
  W,
  WARP,
} from './config.ts';
import { fbm2 } from './noise.ts';
import { Biome, type BiomeId } from './palette.ts';

/** Rescale `a` so its P_LOW/P_HIGH percentiles map to 0/1; clamps the tails. */
function normalizePercentiles(a: Float32Array): void {
  const n = a.length;
  const s = new Float32Array(a);
  s.sort();
  const lo = s[Math.floor(P_LOW * n)];
  const hi = s[Math.floor(P_HIGH * n)];
  if (hi - lo < 1e-6) {
    a.fill(0.5);
    return;
  }
  const inv = 1 / (hi - lo);
  for (let i = 0; i < n; i++) {
    const v = (a[i] - lo) * inv;
    a[i] = v < 0 ? 0 : v > 1 ? 1 : v;
  }
}

/**
 * First match wins; order is load-bearing. `snowBias` is the per-cell snow-line jitter that
 * turns the otherwise smooth isotherm into an irregular, terrain-like edge.
 */
export function classify(elev: number, moist: number, temp: number, snowBias = 0): BiomeId {
  if (elev < SEA_DEEP) return Biome.DeepWater;
  if (elev < SEA_SHALLOW) return Biome.Water;
  if (elev < BEACH_TOP) return Biome.Beach;
  const t = temp + snowBias;
  if (elev >= MOUNTAIN) return t < ALPINE_SNOW_TEMP ? Biome.Snow : Biome.Mountain;
  if (t < SNOW_TEMP) return Biome.Snow;
  if (temp < COLD_MAX) return moist > SWAMP_WET ? Biome.Swamp : Biome.Fields;
  if (moist < DESERT_DRY) return Biome.Desert;
  if (moist < FIELD_MOIST) return Biome.Fields;
  if (moist < FOREST_MOIST) return Biome.Forest;
  return Biome.Swamp;
}

/** Procedural landscape fields; `biome` is derived from the other three plus a season offset. */
export interface Terrain {
  biome: Uint8Array;
  elev: Float32Array; // percentile-normalized elevation, static in seed
  moist: Float32Array; // percentile-normalized moisture, static in seed
  tempBase: Float32Array; // latitude minus altitude penalty; season offset added at runtime
  snowBias: Float32Array; // static snow-line jitter (±SNOW_EDGE_AMPLITUDE) in temperature units
}

/** Procedural landscape: one BiomeId per cell, deterministic in `seed`. */
export function generateTerrain(seed: number): Terrain {
  const elevRaw = new Float32Array(GRID);
  const moistRaw = new Float32Array(GRID);
  const snowBias = new Float32Array(GRID);

  for (let y = 0; y < H; y++) {
    const ny = y / (H - 1);
    for (let x = 0; x < W; x++) {
      const nx = x / (W - 1);
      const i = y * W + x;

      const wx = fbm2(nx * FREQ + 13.7, ny * FREQ + 71.3, 3, seed ^ 0x51ed);
      const wy = fbm2(nx * FREQ - 41.2, ny * FREQ + 9.1, 3, seed ^ 0x27b1);
      let e = fbm2(nx * FREQ + WARP * (wx - 0.5), ny * FREQ + WARP * (wy - 0.5), 5, seed);

      const dx = nx * 2 - 1;
      const dy = ny * 2 - 1;
      let d = Math.min(1, Math.sqrt(dx * dx + dy * dy) / 1.414);
      d = d * d * (3 - 2 * d);
      e -= FALLOFF * d;

      elevRaw[i] = e;
      moistRaw[i] = fbm2(nx * FREQ * 2 + 300.5, ny * FREQ * 2 + 120.5, 4, seed ^ 0x1f3a);
      snowBias[i] =
        (fbm2(
          nx * FREQ * SNOW_EDGE_FREQ + 501.7,
          ny * FREQ * SNOW_EDGE_FREQ + 233.1,
          3,
          seed ^ 0x7a2b,
        ) -
          0.5) *
        2 *
        SNOW_EDGE_AMPLITUDE;
    }
  }

  normalizePercentiles(elevRaw);
  normalizePercentiles(moistRaw);

  const biome = new Uint8Array(GRID);
  const tempBase = new Float32Array(GRID);
  for (let y = 0; y < H; y++) {
    const ny = y / (H - 1);
    const lat = 1 - Math.abs(ny * 2 - 1);
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const elev = elevRaw[i];
      const temp = lat - Math.max(0, elev - 0.5) * TEMP_ALT_PENALTY;
      tempBase[i] = temp;
      biome[i] = classify(elev, moistRaw[i], temp, snowBias[i]);
    }
  }
  return { biome, elev: elevRaw, moist: moistRaw, tempBase, snowBias };
}
