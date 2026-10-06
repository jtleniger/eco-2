import type { Status } from './engine.ts';

/**
 * Single reactive bridge between the vanilla simulation core and the Svelte UI.
 * Mutated in place by `Engine`; read by components.
 */
export const ui = $state({
  status: 'paused' as Status,
  speed: 1,
  tick: 0,
  seed: 0,
  menuOpen: false,
  counts: [] as number[],
  creatureCounts: [] as number[],
  coverage: [] as number[],
  biomeShare: [] as number[],
  season: 'Spring' as string,
  seasonOffset: 0,
  meanTemp: 0,
});
