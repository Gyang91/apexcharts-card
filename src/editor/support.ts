import type { ChartCardExternalConfig } from '../types-config';

// Which chart types use which settings, so the editor shows only what applies.
// Unlisted settings apply to every chart type.
type ChartType = NonNullable<ChartCardExternalConfig['chart_type']>;

const TIME: ChartType[] = ['line', 'scatter', 'rangeArea', 'heatmap'];
const NOT_BANDS: ChartType[] = ['line', 'scatter', 'pie', 'donut', 'radialBar'];

const SUPPORT = {
  yaxis: ['line', 'scatter'],
  stacked: ['line'],
  brush: ['line', 'scatter'],
  hidden_by_default: ['line', 'scatter'],
  color_threshold: ['line', 'radialBar', 'pie', 'donut'],
  heatmap: ['heatmap'],
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

// Settings the card rejects on other chart types: `paths` at the top, `seriesPaths` per series
interface Setting {
  feature: Feature;
  label: string;
  paths?: string[];
  seriesPaths?: string[];
  isSet?: (value: unknown) => boolean;
}

const SETTINGS: Setting[] = [
  { feature: 'yaxis', label: 'tabs.yaxis', paths: ['yaxis'], seriesPaths: ['yaxis_id'] },
  { feature: 'stacked', label: 'field.stacked', paths: ['stacked', 'apex_config.chart.stacked'] },
  { feature: 'brush', label: 'field.brush', paths: ['experimental.brush'] },
  { feature: 'hidden_by_default', label: 'field.hidden_by_default', paths: ['experimental.hidden_by_default'] },
  {
    feature: 'color_threshold',
    label: 'field.color_threshold',
    paths: ['experimental.color_threshold'],
    seriesPaths: ['color_threshold'],
  },
  { feature: 'heatmap', label: 'field.heatmap', paths: ['heatmap'] },
  {
    feature: 'navigation',
    label: 'field.navigation',
    paths: ['navigation'],
    isSet: (value) => !!(value as { show?: boolean } | undefined)?.show,
  },
  { feature: 'invert', label: 'field.invert', seriesPaths: ['invert'] },
  { feature: 'in_chart', label: 'field.in_chart', seriesPaths: ['show.in_chart'], isSet: (value) => value === false },
  { feature: 'extremas', label: 'field.extremas', seriesPaths: ['show.extremas'] },
  { feature: 'datalabels', label: 'field.datalabels', seriesPaths: ['show.datalabels'] },
];

type Obj = Record<string, unknown>;

function get(obj: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((at, key) => (at as Obj | undefined)?.[key], obj);
}

function set(obj: Obj, path: string, value: unknown): void {
  const keys = path.split('.');
  const last = keys.pop()!;
  let at = obj;
  for (const key of keys) at = (at[key] ??= {}) as Obj;
  at[last] = value;
}

// Deletes the value, then any object it leaves empty
function unset(obj: Obj, path: string): void {
  const keys = path.split('.');
  const parents = [obj];
  for (const key of keys.slice(0, -1)) {
    const next = parents[parents.length - 1][key];
    if (!next || typeof next !== 'object') return;
    parents.push(next as Obj);
  }
  delete parents[parents.length - 1][keys[keys.length - 1]];
  for (let i = parents.length - 1; i > 0 && !Object.keys(parents[i]).length; i--) delete parents[i - 1][keys[i - 1]];
}

const isSet = (setting: Setting, value: unknown) =>
  setting.isSet ? setting.isSet(value) : value !== undefined && value !== false && value !== null;

type Series = Obj[];
const seriesOf = (config: unknown): Series => ((config as Obj | undefined)?.series as Series | undefined) ?? [];

function used(config: ChartCardExternalConfig, setting: Setting): boolean {
  return (
    (setting.paths ?? []).some((path) => isSet(setting, get(config, path))) ||
    seriesOf(config).some((serie) => (setting.seriesPaths ?? []).some((path) => isSet(setting, get(serie, path))))
  );
}

const unsupported = (config: ChartCardExternalConfig) =>
  SETTINGS.filter((setting) => !supports(config, setting.feature) && used(config, setting));

// Translation keys of the settings in use that the chart type cannot use
export function unsupportedSettings(config: ChartCardExternalConfig): string[] {
  return unsupported(config).map(({ label }) => label);
}

// Copies each setting's values from `from` to `to`; with `remove`, deletes them from `from`
function move(from: Obj, to: Obj, settings: Setting[], remove: boolean): void {
  for (const setting of settings) {
    for (const path of setting.paths ?? []) {
      const value = get(from, path);
      if (value === undefined) continue;
      set(to, path, value);
      if (remove) unset(from, path);
    }
    seriesOf(from).forEach((serie, index) => {
      const target = ((to.series as Series | undefined) ?? [])[index];
      for (const path of setting.seriesPaths ?? []) {
        const value = get(serie, path);
        if (value === undefined || !target) continue;
        set(target, path, value);
        if (remove) unset(serie, path);
      }
    });
  }
}

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));

// A copy of the config without those settings
export function removeUnsupported(config: ChartCardExternalConfig): ChartCardExternalConfig {
  const next = clone(config);
  move(next as unknown as Obj, { series: seriesOf(next).map(() => ({})) }, unsupported(next), true);
  return next;
}

// Settings set aside while the editor is open, for when the chart type comes back
export type Stash = Obj & { series: Series; extraSeries?: Series };

export function emptyStash(): Stash {
  return { series: [] };
}

// Settings the new type can't use go to the stash, stashed ones it can use come back,
// and a heatmap gets the grouping it needs
export function changeChartType(
  config: ChartCardExternalConfig,
  type: ChartCardExternalConfig['chart_type'],
  stash: Stash,
): ChartCardExternalConfig {
  const next = clone(config);
  if (type) next.chart_type = type;
  else delete next.chart_type;
  const nextObj = next as unknown as Obj;

  // A range band reads exactly two series: keep the first two, and the others until the type changes
  const series = (next.series ?? []) as unknown as Series;
  if (next.chart_type === 'rangeArea' && series.length > 2) {
    stash.extraSeries = series.slice(2);
    next.series = series.slice(0, 2) as unknown as ChartCardExternalConfig['series'];
  } else if (next.chart_type !== 'rangeArea' && stash.extraSeries) {
    next.series = [...series, ...stash.extraSeries] as unknown as ChartCardExternalConfig['series'];
    delete stash.extraSeries;
  }

  const back = SETTINGS.filter((setting) => supports(next, setting.feature) && !used(next, setting));
  // Series are matched by position, and only while they still read the same entity
  stash.series = stash.series.map((serie, index) =>
    serie.entity === seriesOf(next)[index]?.entity ? serie : { entity: serie.entity },
  );
  move(stash, nextObj, back, true);

  seriesOf(next).forEach((serie, index) => (stash.series[index] ??= { entity: serie.entity }));
  move(nextObj, stash, unsupported(next), true);

  if (next.chart_type === 'heatmap') {
    for (const serie of next.series ?? []) {
      if (!serie.statistics && (!serie.group_by?.func || serie.group_by.func === 'raw')) {
        serie.group_by = { ...serie.group_by, func: 'avg', ...(serie.group_by?.duration ? {} : { period: 'hour' }) };
      }
    }
  }
  return next;
}
