import { GRID, H, W } from './config.ts';
import { BIOME_LUT, FOOD_LUT, NONE } from './palette.ts';

/** Blits the world into one pixel per cell on a Canvas 2D backing store. */
export class Renderer {
  readonly canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
  readonly img: ImageData;
  readonly data: Uint8ClampedArray;

  constructor(canvas: HTMLCanvasElement) {
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('Canvas 2D context unavailable');
    this.canvas = canvas;
    this.ctx = ctx;
    this.img = ctx.createImageData(W, H);
    this.data = this.img.data;
  }

  paint(biome: Uint8Array, food: Uint8Array): void {
    const d = this.data;
    for (let i = 0, o = 0; i < GRID; i++, o += 4) {
      const isFood = food[i] !== NONE;
      const lut = isFood ? FOOD_LUT : BIOME_LUT;
      const c = (isFood ? food[i] : biome[i]) * 3;
      d[o] = lut[c];
      d[o + 1] = lut[c + 1];
      d[o + 2] = lut[c + 2];
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
