// Chart annotations: the min/max points of series with `show.extremas`, and
// the `now` marker, each followed by the user's own apex_config annotations.
import { TinyColor } from '@ctrl/tinycolor';
import type { HomeAssistant } from 'custom-card-helpers';
import { ChartCardConfig, ChartCardSeriesConfig, HistoryPoint } from './types';
import { computeColor, computeTextColor, getLang, is12Hour, myFormatNumber } from './utils';

/** The card's view of a series' data, as the extremas read it. */
export interface ExtremaSource {
  minMax(
    serie: ChartCardSeriesConfig,
    start: number,
    end: number,
    timeOffset: number,
  ): { min: HistoryPoint; max: HistoryPoint } | undefined;
  // Time shift of the series (`offset`), undefined when there is none
  offset(serie: ChartCardSeriesConfig): number | undefined;
  // Shift between the chart's and the data's clocks for this series
  timeOffset(serie: ChartCardSeriesConfig): number;
}

export interface AnnotationContext {
  config: ChartCardConfig | undefined;
  hass: HomeAssistant | undefined;
  // Chart colors, by index in series_in_graph
  colors: string[];
  source: ExtremaSource;
}

export function computeAnnotations(context: AnnotationContext, start: Date, end: Date, now: Date) {
  return {
    ...computeMinMaxPointsAnnotations(context, start, end),
    ...computeNowAnnotation(context.config, now),
  };
}

function computeMinMaxPointsAnnotations(context: AnnotationContext, start: Date, end: Date) {
  const { config, colors, source } = context;
  const sameDay =
    start.getFullYear() === end.getFullYear() &&
    start.getMonth() === end.getMonth() &&
    start.getDate() === end.getDate();
  const minMaxPoints = config?.series_in_graph.flatMap((serie, index) => {
    if (serie.show.extremas) {
      const offset = source.offset(serie);
      const { min, max } = source.minMax(
        serie,
        offset ? new Date(start.getTime() + offset).getTime() : start.getTime(),
        offset ? new Date(end.getTime() + offset).getTime() : end.getTime(),
        source.timeOffset(serie),
      ) || {
        min: [0, null],
        max: [0, null],
      };
      const bgColor = computeColor(colors[index]);
      const txtColor = computeTextColor(bgColor);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const extremas: any = [];
      if (min[0] && ['min', 'min+time', true, 'time'].includes(serie.show.extremas)) {
        const withTime = serie.show.extremas === 'time' || serie.show.extremas === 'min+time';
        extremas.push(
          ...getPointAnnotationStyle(
            context,
            min,
            offset!,
            bgColor,
            txtColor,
            serie,
            index,
            serie.invert,
            sameDay,
            withTime,
          ),
        );
      }
      if (max[0] && ['max', 'max+time', true, 'time'].includes(serie.show.extremas)) {
        const withTime = serie.show.extremas === 'time' || serie.show.extremas === 'max+time';
        extremas.push(
          ...getPointAnnotationStyle(
            context,
            max,
            offset!,
            bgColor,
            txtColor,
            serie,
            index,
            serie.invert,
            sameDay,
            withTime,
          ),
        );
      }
      return extremas;
    } else {
      return [];
    }
  });
  return { points: [...(minMaxPoints || []), ...(config?.apex_config?.annotations?.points || [])] };
}

function getPointAnnotationStyle(
  context: AnnotationContext,
  value: HistoryPoint,
  offset: number,
  bgColor: string,
  txtColor: string,
  serie: ChartCardSeriesConfig,
  index: number,
  invert = false,
  sameDay: boolean,
  withTime: boolean,
) {
  const { config, hass } = context;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const points: any = [];
  const multiYAxis =
    config?.apex_config?.yaxis && Array.isArray(config.apex_config.yaxis) && config.apex_config.yaxis.length > 1;
  points.push({
    x: offset ? value[0] - offset : value[0],
    y: invert && value[1] ? -value[1] : value[1],
    seriesIndex: index,
    yAxisIndex: multiYAxis ? index : 0,
    marker: {
      strokeColor: bgColor,
      fillColor: 'var(--card-background-color)',
    },
    label: {
      text: myFormatNumber(value[1], hass?.locale, serie),
      borderColor: 'var(--card-background-color)',
      offsetY: (value[1] ?? 0) < 0 ? 30 : 0,
      borderWidth: 2,
      style: {
        background: bgColor,
        color: txtColor,
      },
    },
  });
  if (withTime) {
    let bgColorTime = new TinyColor(computeColor('var(--card-background-color)'));
    bgColorTime =
      bgColorTime.isValid && bgColorTime.getLuminance() > 0.5 ? bgColorTime.darken(20) : bgColorTime.lighten(20);
    const txtColorTime = computeTextColor(bgColorTime.toHexString());
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let options: any = { timeStyle: 'medium' };
    if (!sameDay) {
      options.dateStyle = 'medium';
    }
    options = { ...options, ...(is12Hour(config, hass) ? { hour12: true } : { hourCycle: 'h23' }) };
    const lang = getLang(config, hass);
    points.push({
      x: offset ? value[0] - offset : value[0],
      y: invert && value[1] ? -value[1] : value[1],
      seriesIndex: index,
      yAxisIndex: multiYAxis ? index : 0,
      marker: {
        size: 0,
      },
      label: {
        text: `${Intl.DateTimeFormat(lang, options).format(value[0])}`,
        borderColor: 'var(--card-background-color)',
        offsetY: (value[1] ?? 0) < 0 ? 38 : -22,
        borderWidth: 0,
        style: {
          background: bgColorTime.toHexString(),
          color: txtColorTime,
          fontSize: '8px',
          fontWeight: 200,
        },
      },
    });
  }
  return points;
}

function computeNowAnnotation(config: ChartCardConfig | undefined, now: Date) {
  if (config?.now?.show) {
    const color = computeColor(config.now.color || 'var(--primary-color)');
    const textColor = computeTextColor(color);
    return {
      xaxis: [
        {
          x: now.getTime(),
          strokeDashArray: 3,
          label: {
            text: config.now.label,
            borderColor: color,
            style: {
              color: textColor,
              background: color,
            },
          },
          borderColor: color,
        },
        ...(config?.apex_config?.annotations?.xaxis || []),
      ],
    };
  }
  return {};
}
