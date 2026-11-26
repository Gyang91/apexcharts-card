import type { ChartCardExternalConfig, ChartCardSeriesExternalConfig } from '../types-config';
import { isExternalStatisticId } from '../utils';

export type EditorPreset = 'measurement' | 'consumption' | 'heatmap';

export const PRESETS: EditorPreset[] = ['measurement', 'consumption', 'heatmap'];

// The chart type a preset uses; the editor switches to it first, so settings the type can't
// use are set aside and come back later
export function presetChartType(preset: EditorPreset): ChartCardExternalConfig['chart_type'] {
  return preset === 'heatmap' ? 'heatmap' : undefined;
}

export function applyPreset(config: ChartCardExternalConfig, preset: EditorPreset): ChartCardExternalConfig {
  const next: ChartCardExternalConfig = {
    ...config,
    graph_span: preset === 'consumption' ? '7d' : '24h',
    series: config.series.map((serie): ChartCardSeriesExternalConfig => {
      const result = { ...serie };
      if (preset === 'consumption') {
        result.type = 'column';
        result.statistics = { type: 'change', period: 'day', align: 'middle' };
        result.group_by = { func: 'raw' };
        result.extend_to = false;
      } else if (isExternalStatisticId(serie.entity)) {
        result.type = 'line';
        result.statistics = { type: 'mean', period: 'hour', align: 'middle' };
        result.group_by = { func: 'raw' };
        result.extend_to = false;
      } else {
        delete result.statistics;
        if (preset === 'heatmap') {
          delete result.type;
          result.group_by = { func: 'avg', period: 'hour' };
        } else {
          result.type = 'line';
          result.group_by = { func: 'avg', duration: '5min', fill: 'null' };
        }
      }
      return result;
    }),
  };
  if (presetChartType(preset)) next.chart_type = presetChartType(preset);
  else delete next.chart_type;
  if (next.all_series_config) {
    next.all_series_config = { ...next.all_series_config };
    delete next.all_series_config.type;
    delete next.all_series_config.statistics;
    delete next.all_series_config.group_by;
  }
  return next;
}

// The preset the config is set up as, if any: applying it again would change nothing
export function activePreset(config: ChartCardExternalConfig | undefined): EditorPreset | undefined {
  if (!config?.series?.length) return undefined;
  const current = JSON.stringify(config);
  return PRESETS.find((preset) => JSON.stringify(applyPreset(config, preset)) === current);
}
