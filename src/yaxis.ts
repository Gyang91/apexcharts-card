// Y axes: parsing of `min`/`max`, the ApexCharts y-axis options generated from
// the card's `yaxis` config, and the auto/soft/absolute extremas recomputed on
// each refresh from the visible data.
import type { ApexYAxis } from 'apexcharts';
import { yAxisLabelFormatter } from './apex-layouts';
import { alignSeries } from './align';
import { DEFAULT_FLOAT_PRECISION, MAX_TICK_STEPS } from './const';
import { t } from './localize';
import {
  ChartCardConfig,
  ChartCardSeriesConfig,
  ChartCardYAxis,
  EntityCachePoints,
  HistoryPoint,
  minmax_type,
} from './types';
import { mergeDeep } from './utils';

/** What the extremas need to know about the chart's series and their data. */
export interface YAxisDataSource {
  isHidden(serie: ChartCardSeriesConfig): boolean;
  // Min and max of the series' data between two timestamps (already offset)
  minMax(
    serie: ChartCardSeriesConfig,
    start: number,
    end: number,
  ): { min: HistoryPoint; max: HistoryPoint } | undefined;
  history(serie: ChartCardSeriesConfig): EntityCachePoints;
  offset(serie: ChartCardSeriesConfig): number;
}

/** `min`/`max` of a y axis: a number is fixed, `~5` soft, `|5|` absolute. */
export function getTypeOfMinMax(value?: 'auto' | number | string): [number | undefined, minmax_type] {
  const regexFloat = /[+-]?\d+(\.\d+)?/g;
  if (typeof value === 'number') {
    return [value, minmax_type.FIXED];
  } else if (value === undefined || value === 'auto') {
    return [undefined, minmax_type.AUTO];
  }
  if (typeof value === 'string' && value !== 'auto') {
    const matched = value.match(regexFloat);
    if (!matched || matched.length !== 1) {
      throw new Error(t('error.yaxis.badMinMaxFormat', { value }));
    }
    const floatValue = parseFloat(matched[0]);
    if (value.startsWith('~')) {
      return [floatValue, minmax_type.SOFT];
    } else if (value.startsWith('|') && value.endsWith('|')) {
      return [floatValue, minmax_type.ABSOLUTE];
    }
  }
  throw new Error(t('error.yaxis.badMinMaxFormat', { value }));
}

export function getMinMaxBasedOnType(isMin: boolean, value: number, configMinMax: number, type: minmax_type): number {
  switch (type) {
    case minmax_type.AUTO:
      return value;
    case minmax_type.SOFT:
      if ((isMin && value > configMinMax) || (!isMin && value < configMinMax)) {
        return configMinMax;
      } else {
        return value;
      }
    case minmax_type.ABSOLUTE:
      return value + configMinMax;
    default:
      return value;
  }
}

/**
 * One ApexCharts y axis per series in the chart, from the card's `yaxis`
 * config, plus a working copy of that config with the series of each axis.
 */
export function generateYAxisConfig(
  config: ChartCardConfig,
): { apexYAxes: ApexYAxis[]; yAxes: ChartCardYAxis[] } | undefined {
  if (!config.yaxis) return undefined;
  const burned: boolean[] = [];
  const yAxes: ChartCardYAxis[] = JSON.parse(JSON.stringify(config.yaxis));
  const apexYAxes: ApexYAxis[] = config.series_in_graph.map((serie, serieIndex) => {
    let idx: number;
    if (config.yaxis?.length !== 1) {
      idx = config.yaxis!.findIndex((yaxis) => {
        return yaxis.id === serie.yaxis_id;
      });
    } else {
      idx = 0;
    }
    if (idx < 0) {
      throw new Error(t('error.yaxis.idNotFound', { id: String(serie.yaxis_id) }));
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let yAxisDup: any = JSON.parse(JSON.stringify(config.yaxis![idx]));
    delete yAxisDup.apex_config;
    delete yAxisDup.decimals;
    delete yAxisDup.tick_step;
    yAxisDup.decimalsInFloat =
      config.yaxis![idx].decimals === undefined ? DEFAULT_FLOAT_PRECISION : config.yaxis![idx].decimals;
    yAxisDup.labels = { formatter: yAxisLabelFormatter(yAxisDup.decimalsInFloat) };
    if (yAxes[idx].series_id) {
      yAxes[idx].series_id!.push(serieIndex);
    } else {
      yAxes[idx].series_id = [serieIndex];
    }

    if (config.yaxis![idx].apex_config) {
      yAxisDup = mergeDeep(yAxisDup, config.yaxis![idx].apex_config);
      delete yAxisDup.apex_config;
    }
    if (config.yaxis![idx].logarithmic !== undefined) yAxisDup.logarithmic = config.yaxis![idx].logarithmic;
    if (config.yaxis![idx].log_base !== undefined) yAxisDup.logBase = config.yaxis![idx].log_base;
    delete yAxisDup.log_base;
    if (typeof yAxisDup.min !== 'number') delete yAxisDup.min;
    if (typeof yAxisDup.max !== 'number') delete yAxisDup.max;
    if (burned[idx]) {
      yAxisDup.show = false;
    } else {
      yAxisDup.show = config.yaxis![idx].show === undefined ? true : config.yaxis![idx].show;
      burned[idx] = true;
    }
    return yAxisDup;
  });
  return { apexYAxes, yAxes };
}

/**
 * Highest positive and lowest negative stack total of the visible range, as
 * ApexCharts stacks them: per timestamp and stack group; when a chart mixes
 * series types, only columns stack (`chart.stackOnlyBar`, on by default).
 */
export function stackTotals(
  config: ChartCardConfig,
  seriesIds: number[] | undefined,
  start: Date,
  end: Date,
  source: YAxisDataSource,
): { min?: number; max?: number } {
  if (!seriesIds || !(config.stacked || config.apex_config?.chart?.stacked)) return {};
  const onlyColumns =
    new Set(config.series_in_graph.map((serie) => serie.type)).size > 1 &&
    config.apex_config?.chart?.stackOnlyBar !== false;
  // Visible points of each stacked series, on the chart's time axis, per stack group
  const groups = new Map<string, EntityCachePoints[]>();
  seriesIds.forEach((id) => {
    const serie = config.series_in_graph[id];
    if (source.isHidden(serie) || (onlyColumns && serie.type !== 'column')) return;
    const offset = source.offset(serie);
    const from = start.getTime() + offset;
    const to = end.getTime() + offset;
    const group = serie.type === 'column' ? (serie.stack_group ?? '') : '';
    const points: EntityCachePoints = source
      .history(serie)
      .filter(([timestamp]) => timestamp >= from && timestamp <= to)
      .map(([timestamp, value]) => [timestamp - offset, value !== null && serie.invert ? -value : value]);
    groups.set(group, [...(groups.get(group) ?? []), points]);
  });
  const totals: [number, number][] = [];
  groups.forEach((members) => {
    alignSeries(members).forEach(([, values]) => {
      const total: [number, number] = [0, 0];
      values.forEach((value) => {
        if (value !== null) total[value > 0 ? 0 : 1] += value;
      });
      totals.push(total);
    });
  });
  const result: { min?: number; max?: number } = {};
  totals.forEach(([positive, negative]) => {
    if (positive > 0 && (result.max === undefined || positive > result.max)) result.max = positive;
    if (negative < 0 && (result.min === undefined || negative < result.min)) result.min = negative;
  });
  return result;
}

/**
 * `tick_step`: a tick every N units. Moves the non-fixed extremas outwards to a
 * multiple of N, then derives ApexCharts' tickAmount from the final range.
 */
export function applyTickStep(yaxis: ChartCardYAxis, config: ChartCardConfig): void {
  const step = yaxis.tick_step;
  if (!step || step <= 0 || (yaxis.logarithmic ?? yaxis.apex_config?.logarithmic)) return;
  yaxis.series_id?.forEach((id) => {
    const apexYAxis = (config.apex_config!.yaxis as ApexYAxis[])[id];
    if (typeof apexYAxis.min !== 'number' || typeof apexYAxis.max !== 'number') return;
    // Rounding guards against floating-point noise (0.30000000000000004 / 0.1)
    const steps = (value: number) => Math.round((value / step) * 1e9) / 1e9;
    if (yaxis.min_type !== minmax_type.FIXED) apexYAxis.min = Math.floor(steps(apexYAxis.min)) * step;
    if (yaxis.max_type !== minmax_type.FIXED) apexYAxis.max = Math.ceil(steps(apexYAxis.max)) * step;
    const tickAmount = Math.round((apexYAxis.max - apexYAxis.min) / step);
    // Past MAX_TICK_STEPS labels overlap: keep ApexCharts' own tick count
    if (tickAmount >= 1 && tickAmount <= MAX_TICK_STEPS) apexYAxis.tickAmount = tickAmount;
  });
}

/**
 * Sets the min/max of each non-fixed ApexCharts y axis (in
 * `config.apex_config.yaxis`) from the data visible between `start` and `end`,
 * and returns those axes.
 */
export function computeYAxisAutoMinMax(
  config: ChartCardConfig,
  yAxes: ChartCardYAxis[] | undefined,
  start: Date,
  end: Date,
  source: YAxisDataSource,
): ApexYAxis | ApexYAxis[] | undefined {
  yAxes?.forEach((yaxis) => {
    if (yaxis.min_type !== minmax_type.FIXED || yaxis.max_type !== minmax_type.FIXED) {
      const minMax = yaxis.series_id?.map((id) => {
        const serie = config.series_in_graph[id];
        if (source.isHidden(serie)) return undefined;
        const lMinMax = source.minMax(
          serie,
          start.getTime() + source.offset(serie),
          end.getTime() + source.offset(serie),
        );
        if (!lMinMax) return undefined;
        if (serie.invert) {
          const cmin = lMinMax.min[1];
          const cmax = lMinMax.max[1];
          if (cmin !== null) {
            lMinMax.max[1] = -cmin;
          }
          if (cmax !== null) {
            lMinMax.min[1] = -cmax;
          }
        }
        return lMinMax;
      });
      let min: number | null = null;
      let max: number | null = null;
      minMax?.forEach((elt) => {
        if (!elt) return;
        if (min === undefined || min === null) {
          min = elt.min[1];
        } else if (elt.min[1] !== null && min > elt.min[1]) {
          min = elt.min[1];
        }
        if (max === undefined || max === null) {
          max = elt.max[1];
        } else if (elt.max[1] !== null && max < elt.max[1]) {
          max = elt.max[1];
        }
      });
      const stacked = stackTotals(config, yaxis.series_id, start, end, source);
      if (stacked.max !== undefined && (max === null || stacked.max > max)) max = stacked.max;
      if (stacked.min !== undefined && (min === null || stacked.min < min)) min = stacked.min;
      const logarithmic = yaxis.logarithmic ?? yaxis.apex_config?.logarithmic ?? false;
      if (yaxis.align_to !== undefined && !logarithmic) {
        if (min !== null && yaxis.min_type !== minmax_type.FIXED) {
          if (min % yaxis.align_to !== 0) {
            min = min >= 0 ? min - (min % yaxis.align_to) : -(yaxis.align_to + (min % yaxis.align_to) - min);
          }
        }
        if (max !== null && yaxis.max_type !== minmax_type.FIXED) {
          if (max % yaxis.align_to !== 0) {
            max = max >= 0 ? yaxis.align_to - (max % yaxis.align_to) + max : (max % yaxis.align_to) - max;
          }
        }
      }
      yaxis.series_id?.forEach((id) => {
        const apexYAxis = (config.apex_config!.yaxis as ApexYAxis[])[id];
        if (yaxis.min_type !== minmax_type.FIXED) {
          apexYAxis.min =
            min === null
              ? yaxis.min_type === minmax_type.SOFT
                ? yaxis.min
                : undefined
              : getMinMaxBasedOnType(true, min, yaxis.min as number, yaxis.min_type!);
        }
        if (yaxis.max_type !== minmax_type.FIXED) {
          apexYAxis.max =
            max === null
              ? yaxis.max_type === minmax_type.SOFT
                ? yaxis.max
                : undefined
              : getMinMaxBasedOnType(false, max, yaxis.max as number, yaxis.max_type!);
        }
      });
    }
  });
  yAxes?.forEach((yaxis) => applyTickStep(yaxis, config));
  return config.apex_config?.yaxis;
}
