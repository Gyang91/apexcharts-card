// Series colors: the chart colors (with `color_threshold` as a function of the
// value), the threshold gradient of line and area series, and the color of a
// series' state in the header.
import { TinyColor } from '@ctrl/tinycolor';
import type { ApexOptions } from 'apexcharts';
import { DEFAULT_AREA_OPACITY, PLAIN_COLOR_TYPES } from './const';
import { ChartCardConfig, ChartCardSeriesConfig } from './types';
import { computeColor, computeColors, interpolateColor } from './utils';

export type ThresholdColorFn = (opts: { value: number }) => string;

/**
 * Colors of the chart's series, by index in `series`. `colors` is read when a
 * threshold color is computed, not copied.
 */
export function computeChartColors(
  config: ChartCardConfig | undefined,
  series: ChartCardSeriesConfig[] | undefined,
  colors: string[],
): (string | ThresholdColorFn)[] {
  const defaultColors: (string | ThresholdColorFn)[] = computeColors(colors);
  series?.forEach((serie, index) => {
    if (
      config?.experimental?.color_threshold &&
      (PLAIN_COLOR_TYPES.includes(config!.chart_type!) || serie.type === 'column') &&
      serie.color_threshold &&
      serie.color_threshold.length > 0
    ) {
      defaultColors[index] = function (
        { value }: { value: number },
        sortedL = serie.color_threshold!,
        defColor = colors[index],
      ) {
        let returnValue = sortedL[0].color || defColor;
        sortedL.forEach((color) => {
          if (value > color.value) returnValue = color.color || defColor;
        });
        return computeColor(returnValue);
      };
    }
  });
  return defaultColors.slice(0, series?.length);
}

/** Gradient fill of the threshold series, unless apex_config sets its own fill. */
export function computeThresholdFill(
  config: ChartCardConfig | undefined,
  brush: boolean,
  colors: string[],
  range: (serie: ChartCardSeriesConfig) => { min?: number; max?: number } | undefined,
): ApexOptions['fill'] {
  if (!config) return undefined;
  const customFill = brush ? config.brush?.apex_config?.fill : config.apex_config?.fill;
  if (customFill !== undefined) return undefined;
  const series = brush ? config.series_in_brush : config.series_in_graph;
  return {
    gradient: {
      type: 'vertical',
      colorStops: series.map((serie, index) => {
        if (!serie.color_threshold || ![undefined, 'area', 'line'].includes(serie.type)) return [];
        const min = range(serie)?.min;
        const max = range(serie)?.max;
        if (min === undefined || max === undefined) return [];
        return computeFillColorStops(serie, min, max, computeColor(colors[index]), serie.invert) || [];
      }),
    },
  };
}

/** Gradient stops of a series' thresholds between the min and max of its data. */
export function computeFillColorStops(
  serie: ChartCardSeriesConfig,
  min: number,
  max: number,
  defColor: string,
  invert = false,
): { offset: number; color: string; opacity: number }[] | undefined {
  if (!serie.color_threshold) return undefined;
  const scale = max - min;

  const result = serie.color_threshold.flatMap((thres, index, arr) => {
    if (
      (thres.value > max && arr[index - 1] && arr[index - 1].value > max) ||
      (thres.value < min && arr[index + 1] && arr[index + 1].value < min)
    ) {
      return [];
    }
    let color: string | undefined = undefined;
    const defaultOp = serie.opacity !== undefined ? serie.opacity : serie.type === 'area' ? DEFAULT_AREA_OPACITY : 1;
    let opacity = thres.opacity === undefined ? defaultOp : thres.opacity;
    if (thres.value > max && arr[index - 1]) {
      const factor = (max - arr[index - 1].value) / (thres.value - arr[index - 1].value);
      color = interpolateColor(
        new TinyColor(arr[index - 1].color || defColor).toHexString(),
        new TinyColor(thres.color || defColor).toHexString(),
        factor,
      );

      const prevOp = arr[index - 1].opacity === undefined ? defaultOp : arr[index - 1].opacity!;

      const curOp = thres.opacity === undefined ? defaultOp : thres.opacity!;

      if (prevOp > curOp) {
        opacity = (prevOp - curOp) * (1 - factor) + curOp;
      } else {
        opacity = (curOp - prevOp) * factor + prevOp;
      }
      opacity = opacity < 0 ? -opacity : opacity;
    } else if (thres.value < min && arr[index + 1]) {
      const factor = (arr[index + 1].value - min) / (arr[index + 1].value - thres.value);
      color = interpolateColor(
        new TinyColor(arr[index + 1].color || defColor).toHexString(),
        new TinyColor(thres.color || defColor).toHexString(),
        factor,
      );

      const nextOp = arr[index + 1].opacity === undefined ? defaultOp : arr[index + 1].opacity!;

      const curOp = thres.opacity === undefined ? defaultOp : thres.opacity!;
      if (nextOp > curOp) {
        opacity = (nextOp - curOp) * (1 - factor) + curOp;
      } else {
        opacity = (curOp - nextOp) * factor + nextOp;
      }
      opacity = opacity < 0 ? -opacity : opacity;
    }
    color = color || new TinyColor(thres.color || defColor).toHexString();
    if ([undefined, 'line'].includes(serie.type)) color = new TinyColor(color).setAlpha(opacity).toHex8String();
    const position = Math.max(0, Math.min(100, (max - thres.value) * (100 / scale)));
    return [
      {
        color: color || new TinyColor(thres.color || defColor).toHexString(),
        offset: scale <= 0 ? 0 : invert ? 100 - position : position,
        opacity,
      },
    ];
  });
  return invert ? result : result.reverse();
}

/** Inline style of a series' state in the header, empty for the default color. */
export function computeHeaderStateColor(
  config: ChartCardConfig | undefined,
  serie: ChartCardSeriesConfig,
  value: number | null,
  headerColors: string[],
): string {
  let color = '';
  if (config?.header?.colorize_states) {
    if (
      config.experimental?.color_threshold &&
      serie.show.header_color_threshold &&
      serie.color_threshold &&
      serie.color_threshold.length > 0 &&
      value !== null
    ) {
      const index = serie.color_threshold.findIndex((thres) => {
        return thres.value > value;
      });
      if (index < 0) {
        color = computeColor(
          serie.color_threshold[serie.color_threshold.length - 1].color || headerColors[serie.index],
        );
      } else if (index === 0) {
        color = computeColor(serie.color_threshold[0].color || headerColors[serie.index]);
      } else {
        const prev = serie.color_threshold[index - 1];
        const next = serie.color_threshold[index];
        if (serie.type === 'column') {
          color = computeColor(prev.color || headerColors[serie.index]);
        } else {
          const factor = (value - prev.value) / (next.value - prev.value);
          color = interpolateColor(
            computeColor(prev.color || headerColors[serie.index]),
            computeColor(next.color || headerColors[serie.index]),
            factor,
          );
        }
      }
    } else {
      return headerColors && headerColors.length > 0 ? `color: ${headerColors[serie.index]};` : '';
    }
  }
  return color ? `color: ${color};` : '';
}

/** Line and area series drawn with a threshold gradient. */
export function thresholdGradientSeries(
  config: ChartCardConfig | undefined,
  brush: boolean,
): { serie: ChartCardSeriesConfig; index: number }[] {
  if (!config?.experimental?.color_threshold) return [];
  if ((brush ? config.brush?.apex_config : config.apex_config)?.fill !== undefined) return [];
  return (brush ? config.series_in_brush : config.series_in_graph)
    .map((serie, index) => ({ serie, index }))
    .filter(({ serie }) => serie.color_threshold?.length && [undefined, 'area', 'line'].includes(serie.type));
}
