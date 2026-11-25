import type { EntityCachePoints } from './types';
import { t } from './localize';
import { alignSeries } from './align';
import type { ChartCardHeatmapColorRange, ChartCardSeriesExternalConfig } from './types-config';
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

/**
 * x-axis range of a heatmap: from the start of its first cell to the end of its
 * last. Cells are centred on their timestamps (bucket middles) and laid out
 * side by side, so the time axis must span the cells, not the chart's window:
 * else a label lands beside the grid for a partial bucket that is not drawn.
 */
export function heatmapXRange(columns: number[]): { min: number; max: number } | undefined {
  if (columns.length < 2) return undefined;
  let step = Infinity;
  for (let i = 1; i < columns.length; i++) step = Math.min(step, columns[i] - columns[i - 1]);
  return { min: columns[0] - step / 2, max: columns[columns.length - 1] + step / 2 };
}

/**
 * ApexCharts colour-scale ranges for `heatmap.color_ranges`: each band runs
 * from its value up to just below the next band's, the lowest one from -∞ and
 * the highest to +∞, so every value gets a band. Bands without a name are
 * named after their limits ("< 20", "20 – 22", "≥ 23") for the legend.
 */
export function heatmapColorScale(
  bands: ChartCardHeatmapColorRange[],
  color: (value: string) => string = (value) => value,
): { from: number; to: number; color: string; name: string }[] {
  const sorted = [...bands].sort((a, b) => a.value - b.value);
  return sorted.map((band, i) => {
    const next = sorted[i + 1];
    const name =
      band.name ?? (i === 0 && next ? `< ${next.value}` : next ? `${band.value} – ${next.value}` : `≥ ${band.value}`);
    return {
      from: i === 0 ? -Number.MAX_VALUE : band.value,
      // ApexCharts' ranges include both ends: stop just below the next band
      to: next ? next.value - Math.max(Math.abs(next.value), 1) * 1e-9 : Number.MAX_VALUE,
      color: color(band.color),
      name,
    };
  });
}
