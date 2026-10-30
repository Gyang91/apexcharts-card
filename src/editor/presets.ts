import type { ChartCardExternalConfig, ChartCardSeriesExternalConfig } from '../types-config';
import { isExternalStatisticId } from '../utils';

export type EditorPreset = 'temperature' | 'power' | 'consumption';

export function applyPreset(config: ChartCardExternalConfig, preset: EditorPreset): ChartCardExternalConfig {
  const next: ChartCardExternalConfig = {
    ...config,
    graph_span: preset === 'consumption' ? '7d' : '24h',
    series: config.series.map((serie): ChartCardSeriesExternalConfig => {
      const result = { ...serie, type: preset === 'consumption' ? ('column' as const) : ('line' as const) };
      if (preset === 'consumption') {
        result.statistics = { type: 'change', period: 'day', align: 'middle' };
        result.group_by = { func: 'raw' };
        result.extend_to = false;
      } else if (isExternalStatisticId(serie.entity)) {
        result.statistics = { type: 'mean', period: 'hour', align: 'middle' };
        result.group_by = { func: 'raw' };
        result.extend_to = false;
      } else {
        delete result.statistics;
        result.group_by = { func: 'avg', duration: '5min', fill: 'null' };
      }
      return result;
    }),
  };
  delete next.chart_type;
  delete next.heatmap;
  if (next.all_series_config) {
    next.all_series_config = { ...next.all_series_config };
    delete next.all_series_config.type;
    delete next.all_series_config.statistics;
    delete next.all_series_config.group_by;
  }
  return next;
}
