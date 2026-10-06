import { SEASON_AMPLITUDE, SEASON_PERIOD_TICKS } from './config.ts';

export type SeasonName = 'Spring' | 'Summer' | 'Autumn' | 'Winter';

/** Signed temperature offset for `tick`: 0 at the start, +A at quarter, -A at three-quarters. */
export function seasonOffset(tick: number): number {
  return SEASON_AMPLITUDE * Math.sin((2 * Math.PI * tick) / SEASON_PERIOD_TICKS);
}

/** Calendar season for `tick`, starting at Spring. */
export function seasonName(tick: number): SeasonName {
  const p = (tick % SEASON_PERIOD_TICKS) / SEASON_PERIOD_TICKS;
  if (p < 0.25) return 'Spring';
  if (p < 0.5) return 'Summer';
  if (p < 0.75) return 'Autumn';
  return 'Winter';
}
