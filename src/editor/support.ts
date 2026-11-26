import type { ChartCardExternalConfig, ChartCardSeriesExternalConfig } from '../types-config';

// Which chart types use which settings, so the editor shows only what applies.
// Taken from the card: config.ts rejects these on range bands and heatmaps, and
// pie, donut and radial bar charts have no time axis. Unlisted settings apply to all.
type ChartType = NonNullable<ChartCardExternalConfig['chart_type']>;

const TIME: ChartType[] = ['line', 'scatter', 'rangeArea', 'heatmap'];
const NOT_BANDS: ChartType[] = ['line', 'scatter', 'pie', 'donut', 'radialBar'];

const SUPPORT = {
  yaxis: ['line', 'scatter'],
  stacked: ['line'],
  brush: ['line', 'scatter'],
  hidden_by_default: ['line', 'scatter'],
  color_threshold: ['line', 'radialBar', 'pie', 'donut'],
  navigation: TIME,
  downsample: ['line'],
  now: TIME,
  annotations: TIME,
  grid: TIME,
  markers: ['line', 'scatter', 'rangeArea'],
  series_type: ['line'],
  line_style: ['line'],
  extend_to: ['line', 'scatter'],
  extremas: ['line', 'scatter'],
  opacity: NOT_BANDS,
  invert: NOT_BANDS,
  in_chart: NOT_BANDS,
  datalabels: NOT_BANDS,
} satisfies Record<string, ChartType[]>;

export type Feature = keyof typeof SUPPORT;

export function supports(config: ChartCardExternalConfig | undefined, feature: Feature): boolean {
  return (SUPPORT[feature] as ChartType[]).includes(config?.chart_type ?? 'line');
}

type Series = ChartCardSeriesExternalConfig;

// Settings the chart type cannot use and the card rejects: shown with a way to
// remove them, since their fields are hidden and the card would show an error.
const UNSUPPORTED: {
  feature: Feature;
  label: string;
  used: (config: ChartCardExternalConfig) => boolean;
  remove: (config: ChartCardExternalConfig) => void;
}[] = [
  {
    feature: 'yaxis',
    label: 'tabs.yaxis',
    used: (c) => !!c.yaxis || (c.series || []).some((s) => s.yaxis_id),
    remove: (c) => {
      delete c.yaxis;
      (c.series || []).forEach((s) => delete s.yaxis_id);
    },
  },
  {
    feature: 'stacked',
    label: 'field.stacked',
    used: (c) => !!c.stacked || !!c.apex_config?.chart?.stacked,
    remove: (c) => {
      delete c.stacked;
      if (c.apex_config?.chart) delete c.apex_config.chart.stacked;
    },
  },
  ...(['brush', 'hidden_by_default', 'color_threshold'] as const).map((feature) => ({
    feature,
    label: `field.${feature}`,
    used: (c: ChartCardExternalConfig) =>
      !!c.experimental?.[feature] || (feature === 'color_threshold' && (c.series || []).some((s) => s.color_threshold)),
    remove: (c: ChartCardExternalConfig) => {
      if (c.experimental) delete c.experimental[feature];
      if (feature === 'color_threshold') (c.series || []).forEach((s) => delete s.color_threshold);
    },
  })),
  {
    feature: 'navigation',
    label: 'field.navigation',
    used: (c) => !!c.navigation?.show,
    remove: (c) => delete c.navigation,
  },
  ...(['invert', 'in_chart', 'extremas', 'datalabels'] as const).map((feature) => {
    const used = (s: Series): boolean =>
      feature === 'invert' ? !!s.invert : feature === 'in_chart' ? s.show?.in_chart === false : !!s.show?.[feature];
    return {
      feature,
      label: `field.${feature}`,
      used: (c: ChartCardExternalConfig) => (c.series || []).some(used),
      remove: (c: ChartCardExternalConfig) =>
        (c.series || []).forEach((s) => {
          if (feature === 'invert') delete s.invert;
          else if (s.show) delete s.show[feature];
        }),
    };
  }),
];

// Translation keys of the settings in use that the chart type cannot use
export function unsupportedSettings(config: ChartCardExternalConfig): string[] {
  return UNSUPPORTED.filter(({ feature, used }) => !supports(config, feature) && used(config)).map(
    ({ label }) => label,
  );
}

// A copy of the config without those settings
export function removeUnsupported(config: ChartCardExternalConfig): ChartCardExternalConfig {
  const next: ChartCardExternalConfig = JSON.parse(JSON.stringify(config));
  UNSUPPORTED.forEach(({ feature, used, remove }) => {
    if (!supports(next, feature) && used(next)) remove(next);
  });
  if (next.experimental && !Object.keys(next.experimental).length) delete next.experimental;
  (next.series || []).forEach((s) => {
    if (s.show && !Object.keys(s.show).length) delete s.show;
  });
  return next;
}
