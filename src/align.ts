import type { EntityCachePoints } from './types';

/** One timestamp and the value of every input series at that time. */
export type AlignedRow = [number, (number | null)[]];

/**
 * Lines several series up on the union of their timestamps.
 *
 * Each input must be sorted by timestamp. A missing, `null` or non-finite
 * value is `null`. With `hold`, a series keeps its last value until its next
 * point, like a Home Assistant state; without it, a series only has a value at
 * its own timestamps. When a series repeats a timestamp, its last point wins.
 */
export function alignSeries(series: EntityCachePoints[], hold = false): AlignedRow[] {
  const times = Array.from(new Set(series.flatMap((points) => points.map(([time]) => time)))).sort((a, b) => a - b);
  const cursors = series.map(() => -1);
  return times.map((time) => [
    time,
    series.map((points, index) => {
      let cursor = cursors[index];
      while (cursor + 1 < points.length && points[cursor + 1][0] <= time) cursor++;
      cursors[index] = cursor;
      if (cursor < 0) return null;
      const [at, value] = points[cursor];
      if (!hold && at !== time) return null;
      return value !== null && Number.isFinite(value) ? value : null;
    }),
  ]);
}
