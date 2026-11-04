// Card configuration: the checks setConfig runs and the defaults it fills in.
// Each function works on the config it is given only; the card keeps its own
// state (intervals, offsets, graphs, colors).
import { createCheckers, Checker } from 'ts-interface-checker';
import exportedTypeSuite from './types-config-ti';
import { ChartCardAllSeriesExternalConfig, ChartCardExternalConfig, ChartCardColorThreshold } from './types-config';
import { ChartCardConfig, ChartCardSeriesConfig, minmax_type } from './types';
import {
  COMPUTE_EXCLUDED_OPTIONS,
  DEFAULT_DURATION,
  DEFAULT_FILL_RAW,
  DEFAULT_FUNC,
  DEFAULT_GROUP_BY_FILL,
  DEFAULT_OFFSET,
  DEFAULT_SERIE_TYPE,
  DEFAULT_SHOW_IN_CHART,
  DEFAULT_SHOW_IN_HEADER,
  DEFAULT_SHOW_IN_LEGEND,
  DEFAULT_SHOW_LEGEND_VALUE,
  DEFAULT_SHOW_NAME_IN_HEADER,
  DEFAULT_SHOW_NULL_IN_HEADER,
  DEFAULT_SHOW_OFFSET_IN_NAME,
  DEFAULT_SHOW_ZERO_IN_HEADER,
} from './const';
import { t } from './localize';
import {
  isComputedSeries,
  isExternalStatisticId,
  mergeConfigTemplates,
  mergeDeepConfig,
  validateInterval,
  validateOffset,
} from './utils';
import { DEFAULT_HEATMAP_CELLS, MAX_HEATMAP_CELLS } from './visual-data';
import { getTypeOfMinMax } from './yaxis';

// Building the checker walks the whole type suite: do it once, not on every
// setConfig (the editor calls it on each change).
let checker: Checker | undefined;
function configChecker(): Checker {
  checker ??= createCheckers(exportedTypeSuite).ChartCardExternalConfig;
  return checker;
}

/**
 * A copy of the user's config, with the legacy `entities` key renamed to
 * `series` and the config templates merged in. `lovelace` is only asked for
 * when the config uses templates.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function prepareConfig(config: ChartCardExternalConfig, lovelace: () => any): ChartCardExternalConfig {
  let configDup: ChartCardExternalConfig = JSON.parse(JSON.stringify(config));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if ((configDup as any).entities) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    configDup.series = (configDup as any).entities;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (configDup as any).entities;
  }
  configDup = configDup as ChartCardExternalConfig;
  if (configDup.config_templates) {
    configDup.config_templates =
      configDup.config_templates && Array.isArray(configDup.config_templates)
        ? configDup.config_templates
        : [configDup.config_templates];
    configDup = mergeConfigTemplates(lovelace(), configDup);
  }
  return configDup;
}

/** Checks the config against its schema, then merges `all_series_config` into each series. */
export function checkSchemaAndMergeAllSeries(configDup: ChartCardExternalConfig): void {
  if (!configDup.experimental?.disable_config_validation) {
    configChecker().strictCheck(configDup);
  }
  if (configDup.all_series_config) {
    configDup.series.forEach((serie, index) => {
      const allDup: ChartCardAllSeriesExternalConfig = JSON.parse(JSON.stringify(configDup.all_series_config));
      if (isComputedSeries(serie)) COMPUTE_EXCLUDED_OPTIONS.forEach((key) => delete allDup[key]);
      configDup.series[index] = mergeDeepConfig(allDup, serie);
    });
  }
}

/** rangeArea and heatmap charts: the options they cannot combine with. */
export function checkVisualChart(configDup: ChartCardExternalConfig): void {
  const visual = configDup.chart_type === 'rangeArea' || configDup.chart_type === 'heatmap';
  if (visual) {
    if (
      configDup.stacked ||
      configDup.experimental?.brush ||
      configDup.experimental?.hidden_by_default ||
      configDup.experimental?.color_threshold ||
      configDup.yaxis ||
      configDup.apex_config?.chart?.stacked
    ) {
      throw new Error(t('error.visual.options'));
    }
    if (
      configDup.series.some(
        (serie) =>
          serie.show?.in_chart === false ||
          serie.invert ||
          serie.show?.extremas ||
          serie.show?.datalabels ||
          serie.color_threshold ||
          serie.yaxis_id,
      )
    ) {
      throw new Error(t('error.visual.series'));
    }
    if (configDup.chart_type === 'rangeArea' && configDup.series.length !== 2) {
      throw new Error(t('error.visual.pair'));
    }
    if (configDup.chart_type === 'heatmap') {
      const limit = configDup.heatmap?.max_cells ?? DEFAULT_HEATMAP_CELLS;
      if (!Number.isInteger(limit) || limit < 1 || limit > MAX_HEATMAP_CELLS) {
        throw new Error(t('error.heatmap.limit'));
      }
      if (
        !configDup.series.length ||
        configDup.series.some((serie) => !serie.statistics && (!serie.group_by?.func || serie.group_by.func === 'raw'))
      ) {
        throw new Error(t('error.heatmap.aggregation'));
      }
    }
    configDup.series.forEach((serie) => {
      serie.extend_to = false;
    });
  } else if (configDup.heatmap) {
    throw new Error(t('error.heatmap.type'));
  }
}

export function checkSpanAndNavigation(configDup: ChartCardExternalConfig): void {
  if (configDup.span?.end && configDup.span?.start) {
    throw new Error(t('error.span.startEnd'));
  }
  if (configDup.navigation?.show) {
    if (configDup.span) throw new Error(t('error.navigation.span'));
    if (configDup.chart_type && !['line', 'scatter', 'rangeArea', 'heatmap'].includes(configDup.chart_type)) {
      throw new Error(t('error.navigation.timeline'));
    }
  }
}

/** Per-series checks; returns each series' `offset` and `time_delta` in ms. */
export function checkSeries(configDup: ChartCardExternalConfig): { offsets: number[]; timeDeltas: number[] } {
  const offsets: number[] = [];
  const timeDeltas: number[] = [];
  const seriesIds = new Set<string>();
  configDup.series.forEach((serie, index) => {
    if (isComputedSeries(serie)) {
      const option = COMPUTE_EXCLUDED_OPTIONS.find((key) => serie[key] !== undefined);
      if (option) throw new Error(t('error.series.computeOptions', { index, option }));
    } else if (!serie.entity) {
      throw new Error(t('error.series.entityRequired', { index }));
    }
    if (serie.id !== undefined) {
      if (seriesIds.has(serie.id)) throw new Error(t('error.series.duplicateId', { id: serie.id }));
      seriesIds.add(serie.id);
    }
    if (isExternalStatisticId(serie.entity) && !serie.statistics) {
      // External statistic IDs have no recorder history: without the
      // statistics option there is nothing to plot.
      throw new Error(t('error.statistics.externalRequired', { entity: serie.entity }));
    }
    if (serie.offset) {
      offsets[index] = validateOffset(serie.offset, `series[${index}].offset`);
    }
    if (serie.time_delta) {
      timeDeltas[index] = validateOffset(serie.time_delta, `series[${index}].time_delta`);
    }
  });
  return { offsets, timeDeltas };
}

/** Fills in the defaults of a series and checks its group_by durations. */
export function applySeriesDefaults(
  serie: ChartCardSeriesConfig,
  index: number,
  chartType: ChartCardConfig['chart_type'],
): void {
  serie.fill_raw = serie.fill_raw || DEFAULT_FILL_RAW;
  // External statistics have no live state to extend to
  serie.extend_to = isExternalStatisticId(serie.entity)
    ? false
    : serie.extend_to !== undefined
      ? serie.extend_to
      : 'end';
  serie.type = !chartType || chartType === 'line' ? serie.type || DEFAULT_SERIE_TYPE : undefined;
  if (!serie.group_by) {
    serie.group_by = {
      duration: DEFAULT_DURATION,
      offset: DEFAULT_OFFSET,
      func: DEFAULT_FUNC,
      fill: DEFAULT_GROUP_BY_FILL,
    };
  } else {
    serie.group_by.duration = serie.group_by.duration || DEFAULT_DURATION;
    serie.group_by.offset = serie.group_by.offset || DEFAULT_OFFSET;
    serie.group_by.func = serie.group_by.func || DEFAULT_FUNC;
    serie.group_by.fill = serie.group_by.fill || DEFAULT_GROUP_BY_FILL;
  }
  if (!serie.show) {
    serie.show = {
      in_legend: DEFAULT_SHOW_IN_LEGEND,
      legend_value: DEFAULT_SHOW_LEGEND_VALUE,
      in_header: DEFAULT_SHOW_IN_HEADER,
      in_chart: DEFAULT_SHOW_IN_CHART,
      name_in_header: DEFAULT_SHOW_NAME_IN_HEADER,
      null_in_header: DEFAULT_SHOW_NULL_IN_HEADER,
      zero_in_header: DEFAULT_SHOW_ZERO_IN_HEADER,
      offset_in_name: DEFAULT_SHOW_OFFSET_IN_NAME,
    };
  } else {
    serie.show.in_legend = serie.show.in_legend === undefined ? DEFAULT_SHOW_IN_LEGEND : serie.show.in_legend;
    serie.show.legend_value =
      serie.show.legend_value === undefined ? DEFAULT_SHOW_LEGEND_VALUE : serie.show.legend_value;
    serie.show.in_chart = serie.show.in_chart === undefined ? DEFAULT_SHOW_IN_CHART : serie.show.in_chart;
    serie.show.in_header =
      serie.show.in_header === undefined
        ? !serie.show.in_chart && serie.show.in_brush
          ? false
          : DEFAULT_SHOW_IN_HEADER
        : serie.show.in_header;
    serie.show.name_in_header =
      serie.show.name_in_header === undefined ? DEFAULT_SHOW_NAME_IN_HEADER : serie.show.name_in_header;
    serie.show.null_in_header =
      serie.show.null_in_header === undefined ? DEFAULT_SHOW_NULL_IN_HEADER : serie.show.null_in_header;
    serie.show.zero_in_header =
      serie.show.zero_in_header === undefined ? DEFAULT_SHOW_ZERO_IN_HEADER : serie.show.zero_in_header;
    serie.show.offset_in_name =
      serie.show.offset_in_name === undefined ? DEFAULT_SHOW_OFFSET_IN_NAME : serie.show.offset_in_name;
  }
  validateInterval(serie.group_by.duration, `series[${index}].group_by.duration`);
  validateOffset(serie.group_by.offset, `series[${index}].group_by.offset`);
  if (serie.color_threshold && serie.color_threshold.length > 0) {
    const sorted: ChartCardColorThreshold[] = JSON.parse(JSON.stringify(serie.color_threshold));
    sorted.sort((a, b) => (a.value < b.value ? -1 : 1));
    serie.color_threshold = sorted;
  }
}

/** y-axis ids and logarithmic limits. */
export function checkYAxes(config: ChartCardConfig): void {
  if (config.yaxis && config.yaxis.length > 1) {
    if (
      config.series_in_graph.some((serie) => {
        return !serie.yaxis_id;
      })
    ) {
      throw new Error(t('error.yaxis.missingYaxisId'));
    }
    if (
      config.yaxis.some((yaxis) => {
        return !yaxis.id;
      })
    ) {
      throw new Error(t('error.yaxis.missingId'));
    }
  }
  if (config.yaxis) {
    const ids = new Set<string>();
    config.yaxis.forEach((axis) => {
      if (axis.id) {
        if (ids.has(axis.id)) throw new Error(t('error.yaxis.duplicateId', { id: axis.id }));
        ids.add(axis.id);
      }
      const logarithmic = axis.logarithmic ?? axis.apex_config?.logarithmic ?? false;
      const base = axis.log_base ?? axis.apex_config?.logBase ?? 10;
      if (typeof base !== 'number' || !Number.isFinite(base) || base <= 1) {
        throw new Error(t('error.yaxis.logBase'));
      }
      if (logarithmic) {
        for (const limit of [axis.min, axis.max]) {
          if (limit === undefined || limit === 'auto') continue;
          const [value, type] = getTypeOfMinMax(limit);
          if (type !== minmax_type.ABSOLUTE && (typeof value !== 'number' || !Number.isFinite(value) || value <= 0)) {
            throw new Error(t('error.yaxis.logLimit'));
          }
        }
      }
    });
  }
}
