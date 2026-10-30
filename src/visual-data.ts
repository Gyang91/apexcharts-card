import type { EntityCachePoints } from './types';
import { t } from './localize';
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

function indexed(data: EntityCachePoints): Map<number, number | null> {
  const result = new Map<number, number | null>();
  let previous = -Infinity;
  for (const [time, value] of data) {
    if (!Number.isFinite(time) || time <= previous) throw new Error(t('error.visual.timestamps'));
    previous = time;
    result.set(time, value !== null && Number.isFinite(value) ? value : null);
  }
  return result;
}

export function rangeAreaData(lower: EntityCachePoints, upper: EntityCachePoints) {
  const low = indexed(lower);
  const high = indexed(upper);
  const times = Array.from(new Set([...low.keys(), ...high.keys()])).sort((a, b) => a - b);
  return times.map((x) => {
    const min = low.get(x);
    const max = high.get(x);
    if (min == null || max == null) return { x, y: [null, null] };
    if (min > max) throw new Error(t('error.visual.bounds'));
    return { x, y: [min, max] };
  });
}

export function heatmapData(rows: EntityCachePoints[], limit = DEFAULT_HEATMAP_CELLS) {
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_HEATMAP_CELLS) {
    throw new Error(t('error.heatmap.limit'));
  }
  const times = new Set<number>();
  for (const row of rows) {
    for (const [time] of row) {
      times.add(time);
      if (times.size * rows.length > limit) throw new Error(t('error.heatmap.budget', { limit }));
    }
  }
  const columns = Array.from(times).sort((a, b) => a - b);
  return rows.map((row) => {
    const values = indexed(row);
    return columns.map((x) => ({ x, y: values.get(x) ?? null }));
  });
}
