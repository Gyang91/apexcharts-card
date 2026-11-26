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

const DAY = 24 * 60 * 60 * 1000;

// ApexCharts' own datetime ticks put the date in every label once the chart spans days.
// Ticks of our own sit on cell edges: how many intervals split `cells` evenly, at most `max`.
export function heatmapTickAmount(cells: number, wanted?: number, max = 8): number | undefined {
  if (wanted) return cells % wanted === 0 ? wanted : undefined;
  for (let amount = Math.min(max, cells); amount >= 3; amount--) if (cells % amount === 0) return amount;
  return undefined;
}

// A time of day, or at midnight the day: "Today", "Yesterday", or a weekday further back
export function heatmapTimeLabel(ts: number, now: number, lang: string, hours12: boolean): string {
  const date = new Date(Math.round(ts / 60000) * 60000);
  if (date.getHours() || date.getMinutes()) {
    const clock: Intl.DateTimeFormatOptions = hours12 ? { hour: 'numeric', hour12: true } : { hourCycle: 'h23' };
    return date.toLocaleTimeString(lang, { hour: '2-digit', minute: '2-digit', ...clock });
  }
  const days = Math.round((date.getTime() - new Date(now).setHours(0, 0, 0, 0)) / DAY);
  const word =
    Math.abs(days) <= 1
      ? new Intl.RelativeTimeFormat(lang, { numeric: 'auto' }).format(days, 'day')
      : date.toLocaleDateString(lang, { weekday: 'short' });
  return word.charAt(0).toLocaleUpperCase(lang) + word.slice(1);
}

// The range each band covers, in the bands' own order: "< 20 °C", "20 – 22 °C", "≥ 23 °C"
export function bandLimits(bands: { value: number }[], unit?: string): string[] {
  const order = bands.map((band, index) => ({ value: band.value, index })).sort((a, b) => a.value - b.value);
  const u = unit ? ` ${unit}` : '';
  const labels: string[] = [];
  order.forEach(({ value, index }, i) => {
    const next = order[i + 1]?.value;
    labels[index] =
      i === 0 && next !== undefined
        ? `< ${next}${u}`
        : next !== undefined
          ? `${value} – ${next}${u}`
          : `≥ ${value}${u}`;
  });
  return labels;
}

// The unit every series shares; mixed when they differ
export function sharedUnit(units: (string | undefined)[]): { unit?: string; mixed: boolean } {
  const found = [...new Set(units.filter((unit): unit is string => !!unit))];
  return { unit: found.length === 1 ? found[0] : undefined, mixed: found.length > 1 };
}

const SUGGESTED_COLORS = ['#3a85d6', '#5f9ac2', '#5f9e6e', '#c9a03e', '#d8742f', '#d85a30'];

// Bands with round limits across [min, max], cool to warm: about 4 to 6 of them
export function suggestBands(min: number, max: number): ChartCardHeatmapColorRange[] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [];
  if (max <= min) max = min + 1;
  const rough = (max - min) / 4;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 2.5, 5, 10].map((factor) => factor * magnitude).find((size) => size >= rough)!;
  const first = Math.floor(min / step) * step;
  const count = Math.min(SUGGESTED_COLORS.length, Math.max(3, Math.ceil((max - first) / step)));
  return Array.from({ length: count }, (_, i) => ({
    value: Number((first + i * step).toPrecision(12)),
    color: SUGGESTED_COLORS[Math.round((i * (SUGGESTED_COLORS.length - 1)) / (count - 1))],
  }));
}

/**
 * ApexCharts colour-scale ranges for `heatmap.color_ranges`: each band runs
 * from its value up to just below the next band's, the lowest one from -∞ and
 * the highest to +∞, so every value gets a band. Bands without a name are
 * named after their limits for the legend.
 */
export function heatmapColorScale(
  bands: ChartCardHeatmapColorRange[],
  color: (value: string) => string = (value) => value,
  unit?: string,
): { from: number; to: number; color: string; name: string }[] {
  const limits = bandLimits(bands, unit);
  const sorted = bands
    .map((band, index) => ({ band, name: band.name ?? limits[index] }))
    .sort((a, b) => a.band.value - b.band.value);
  return sorted.map(({ band, name }, i) => {
    const next = sorted[i + 1]?.band;
    return {
      from: i === 0 ? -Number.MAX_VALUE : band.value,
      // ApexCharts' ranges include both ends: stop just below the next band
      to: next ? next.value - Math.max(Math.abs(next.value), 1) * 1e-9 : Number.MAX_VALUE,
      color: color(band.color),
      name,
    };
  });
}
