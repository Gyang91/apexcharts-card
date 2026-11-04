// Optional sampling (`downsample`) of long line/area histories to the chart's
// width: which series can be sampled, and sampling them. The card schedules
// when to sample again (resize, zoom, refresh).
import { downsample, SamplingRange } from './downsample';
import { ChartCardConfig, EntityCachePoints } from './types';

export interface SamplingSeries {
  data: EntityCachePoints;
  hidden?: boolean;
}

/**
 * Whether series `index` of the main chart (or the brush) can be sampled:
 * unstacked line and area series only, without step curves, which would
 * change the state durations they show.
 */
export function canSample(config: ChartCardConfig | undefined, index: number, brush: boolean): boolean {
  if (!config?.downsample || (config.chart_type && config.chart_type !== 'line')) return false;
  const apex = brush ? config.brush?.apex_config : config.apex_config;
  if (config.stacked || apex?.chart?.stacked) return false;
  if (apex?.chart?.type && !['line', 'area'].includes(apex.chart.type)) return false;
  const serie = (brush ? config.series_in_brush : config.series_in_graph)[index];
  if (!serie || serie.type === 'column') return false;
  const curves = apex?.stroke?.curve;
  const curve = typeof curves === 'string' ? curves : (serie.curve ?? (Array.isArray(curves) ? curves[index] : curves));
  return curve !== 'stepline' && curve !== 'linestep';
}

export function hasSampling(config: ChartCardConfig | undefined): boolean {
  return (
    !!config?.downsample &&
    (config.series_in_graph.some((_, index) => canSample(config, index, false)) ||
      config.series_in_brush.some((_, index) => canSample(config, index, true)))
  );
}

/** The series with each one that can be sampled reduced to `width` pixels. */
export function sampleSeries(
  config: ChartCardConfig | undefined,
  series: SamplingSeries[],
  brush: boolean,
  width: number,
  range?: SamplingRange,
): SamplingSeries[] {
  return series.map((entry, index) => {
    if (!canSample(config, index, brush)) return entry;
    const data = downsample(entry.data, width, range);
    return data === entry.data ? entry : { ...entry, data };
  });
}
