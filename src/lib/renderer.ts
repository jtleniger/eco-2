import { GRID, H, W } from './config.ts';
import { BIOME_LUT, FOOD_LUT, NONE } from './palette.ts';
import { SPECIES_LUT } from './species.ts';
import type { Population } from './creatures.ts';

/** Blits the world into one pixel per cell on a Canvas 2D backing store. */
export class Renderer {
  readonly canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
  readonly img: ImageData;
  readonly data: Uint8ClampedArray;
  /** Scratch layer: species id per cell, `NONE` when empty. */
  readonly creatureLayer: Uint8Array;

  constructor(canvas: HTMLCanvasElement) {
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('Canvas 2D context unavailable');
    this.canvas = canvas;
    this.ctx = ctx;
    this.img = ctx.createImageData(W, H);
    this.data = this.img.data;
    this.creatureLayer = new Uint8Array(GRID);
  }

  paint(biome: Uint8Array, food: Uint8Array, pop: Population): void {
    const d = this.data;
    const layer = this.creatureLayer;
    layer.fill(NONE);
    for (let k = 0; k < pop.count; k++) layer[pop.pos[k]] = pop.species[k];

    for (let i = 0, o = 0; i < GRID; i++, o += 4) {
      const c = layer[i];
      let lut: Uint8Array;
      let id: number;
      if (c !== NONE) {
        lut = SPECIES_LUT;
        id = c;
      } else if (food[i] !== NONE) {
        lut = FOOD_LUT;
        id = food[i];
      } else {
        lut = BIOME_LUT;
        id = biome[i];
      }
      const rgb = id * 3;
      d[o] = lut[rgb];
      d[o + 1] = lut[rgb + 1];
      d[o + 2] = lut[rgb + 2];
      d[o + 3] = 255;
    }
    this.ctx.putImageData(this.img, 0, 0);
  }

  /** Integer-upscale the backing store to the largest size that fits the stage. */
  fit(stageW: number, stageH: number): void {
    const scale = Math.max(1, Math.floor(Math.min(stageW / W, stageH / H)));
    this.canvas.style.width = W * scale + 'px';
    this.canvas.style.height = H * scale + 'px';
  }
}
