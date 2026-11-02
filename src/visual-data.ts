import type { EntityCachePoints } from './types';
import { t } from './localize';
import { alignSeries } from './align';
import type { ChartCardSeriesExternalConfig } from './types-config';
import { addPeriods, startOfPeriod } from './calendar';
import parse from 'parse-duration';

export const DEFAULT_HEATMAP_CELLS = 512;
export const MAX_HEATMAP_CELLS = 2048;

export function assertHeatmapBudget(
  series: ChartCardSeriesExternalConfig[],
  start: number,
  end: number,
  timeZone: string | undefined,
  limit = DEFAULT_HEATMAP_CELLS,
): void {
  for (const serie of series) {
    const group = serie.group_by;
    let columns = 0;
    if (group?.func && group.func !== 'raw' && !group.period) {
      columns = Math.ceil((end - start) / parse(group.duration ?? '1h')!);
    } else {
      const period =
        group?.func && group.func !== 'raw' && group.period ? group.period : (serie.statistics?.period ?? 'hour');
      let cursor = startOfPeriod(start, period === '5minute' ? 'hour' : period, timeZone);
      while (cursor < end) {
        const moved = addPeriods(cursor, period, 1, timeZone);
        const next = period === '5minute' ? moved : startOfPeriod(moved, period, timeZone);
        if (next > start) columns++;
        if (columns * series.length > limit) break;
        cursor = next;
      }
    }
    if (columns * series.length > limit) throw new Error(t('error.heatmap.budget', { limit }));
  }
}

// Range and heatmap points come from one series each: timestamps must be finite
// and strictly increasing.
function assertTimeline(data: EntityCachePoints): void {
  let previous = -Infinity;
  for (const [time] of data) {
    if (!Number.isFinite(time) || time <= previous) throw new Error(t('error.visual.timestamps'));
    previous = time;
  }
}

export function rangeAreaData(lower: EntityCachePoints, upper: EntityCachePoints) {
  assertTimeline(lower);
  assertTimeline(upper);
  return alignSeries([lower, upper]).map(([x, [min, max]]) => {
    if (min === null || max === null) return { x, y: [null, null] };
    if (min > max) throw new Error(t('error.visual.bounds'));
    return { x, y: [min, max] };
  });
}

export function heatmapData(rows: EntityCachePoints[], limit = DEFAULT_HEATMAP_CELLS) {
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_HEATMAP_CELLS) {
    throw new Error(t('error.heatmap.limit'));
  }
  rows.forEach(assertTimeline);
  const columns = alignSeries(rows);
  if (columns.length * rows.length > limit) throw new Error(t('error.heatmap.budget', { limit }));
  return rows.map((_, row) => columns.map(([x, values]) => ({ x, y: values[row] })));
}
