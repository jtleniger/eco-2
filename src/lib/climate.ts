import { SEASON_AMPLITUDE, SEASON_PERIOD_TICKS } from './config.ts';

export type SeasonName = 'Spring' | 'Summer' | 'Autumn' | 'Winter';

/**
 * Signed temperature offset for `tick`, phased to the season quarters (Spring starts at 0):
 * crosses zero rising at mid-Spring, peaks (+A) at mid-Summer, crosses zero falling at
 * mid-Autumn and troughs (-A) at mid-Winter. So Summer is the warmest quarter and Winter the
 * coldest, i.e. biomes recede through Spring and the first half of Summer, and readvance
 * through Autumn and the first half of Winter.
 */
export function seasonOffset(tick: number): number {
  return SEASON_AMPLITUDE * Math.sin((2 * Math.PI * tick) / SEASON_PERIOD_TICKS - Math.PI / 4);
}

/** Calendar season for `tick`, starting at Spring. */
export function seasonName(tick: number): SeasonName {
  const p = (tick % SEASON_PERIOD_TICKS) / SEASON_PERIOD_TICKS;
  if (p < 0.25) return 'Spring';
  if (p < 0.5) return 'Summer';
  if (p < 0.75) return 'Autumn';
  return 'Winter';
}
