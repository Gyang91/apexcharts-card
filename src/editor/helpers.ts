import { ChartCardExternalConfig } from '../types-config';
import { HaFormSchema, SEL_FALSE, SEL_TRUE, SEL_UNDEFINED } from './types';
import { t } from './localize';

// Selects hold strings: booleans and undefined go through sentinels to keep their type

export type SelectMixed = boolean | string | number | undefined | null;

export function toSelectValue(value: SelectMixed): string {
  if (value === true) return SEL_TRUE;
  if (value === false) return SEL_FALSE;
  if (value === undefined || value === null) return SEL_UNDEFINED;
  return String(value);
}

export function fromSelectValue(str: string | undefined): boolean | string | undefined {
  if (str === undefined || str === SEL_UNDEFINED || str === '') return undefined;
  if (str === SEL_TRUE) return true;
  if (str === SEL_FALSE) return false;
  return str;
}

export function parseStrokeDash(val: string | undefined): number | number[] | undefined {
  if (val === undefined || val === null) return undefined;
  const trimmed = String(val).trim();
  if (trimmed === '') return undefined;
  if (trimmed.includes(',')) {
    const arr = trimmed
      .split(',')
      .map((s) => Number(s.trim()))
      .filter((n) => !isNaN(n));
    return arr.length > 0 ? arr : undefined;
  }
  const n = Number(trimmed);
  return isNaN(n) ? undefined : n;
}

export function serializeStrokeDash(val: number | number[] | undefined): string {
  if (val === undefined || val === null) return '';
  if (Array.isArray(val)) return val.join(', ');
  return String(val);
}

// Translation keys, looked up on every render so a locale change applies at once

const LABEL_MAP: Record<string, string> = {
  chart_type: 'field.chart_type',
  graph_span: 'field.graph_span',
  stacked: 'field.stacked',
  update_interval: 'field.update_interval',
  update_delay: 'field.update_delay',
  layout: 'field.layout',
  section_mode: 'field.section_mode',
  locale: 'field.locale',
  hours_12: 'field.hours_12',
  entity: 'field.entity',
  name: 'field.name',
  type: 'field.type',
  color: 'field.color',
  opacity: 'field.opacity',
  curve: 'field.curve',
  stroke_width: 'field.stroke_width',
  stroke_dash: 'field.stroke_dash',
  extend_to: 'field.extend_to',
  invert: 'field.invert',
  fill_raw: 'field.fill_raw',
  transform: 'field.transform',
  data_generator: 'field.data_generator',
  compute: 'field.compute',
  source: 'field.source',
  float_precision: 'field.float_precision',
  fixed_decimals: 'field.fixed_decimals',
  attribute: 'field.attribute',
  unit: 'field.unit',
  offset: 'field.offset',
  time_delta: 'field.time_delta',
  min: 'field.min',
  max: 'field.max',
  yaxis_id: 'field.yaxis_id',
  stack_group: 'field.stack_group',
  duration: 'field.duration',
  func: 'field.func',
  fill: 'field.fill',
  start_with_last: 'field.start_with_last',
  period: 'field.period',
  align: 'field.align',
  show: 'field.show',
  title: 'field.title',
  floating: 'field.floating',
  show_states: 'field.show_states',
  colorize_states: 'field.colorize_states',
  standard_format: 'field.standard_format',
  disable_actions: 'field.disable_actions',
  label: 'field.label',
  loading: 'field.loading',
  last_updated: 'field.last_updated',
  version: 'field.version',
  id: 'field.id',
  axis: 'field.axis',
  opposite: 'field.opposite',
  decimals: 'field.decimals',
  logarithmic: 'field.logarithmic',
  log_base: 'field.log_base',
  align_to: 'field.align_to',
  cache: 'field.cache',
  downsample: 'field.downsample',
  selection_span: 'field.selection_span',
  color_threshold: 'field.color_threshold',
  disable_config_validation: 'field.disable_config_validation',
  hidden_by_default: 'field.hidden_by_default',
  brush: 'field.brush',
  in_header: 'field.in_header',
  in_legend: 'field.in_legend',
  legend_value: 'field.legend_value',
  in_chart: 'field.in_chart',
  name_in_header: 'field.name_in_header',
  null_in_header: 'field.null_in_header',
  zero_in_header: 'field.zero_in_header',
  header_color_threshold: 'field.header_color_threshold',
  as_duration: 'field.as_duration',
  extremas: 'field.extremas',
  datalabels: 'field.datalabels',
  in_brush: 'field.in_brush',
  offset_in_name: 'field.offset_in_name',
  start: 'field.start',
  end: 'field.end',
  group_by: 'field.group_by',
  smoothing: 'field.smoothing',
  statistics: 'field.statistics',
  value: 'field.value',
  tap_action: 'field.tap_action',
  hold_action: 'field.hold_action',
  double_tap_action: 'field.double_tap_action',
  action: 'field.action',
  service: 'field.service',
  service_data: 'field.service_data',
  navigation_path: 'field.navigation_path',
  url_path: 'field.url_path',
  haptic: 'field.haptic',
  confirmation: 'field.confirmation',
  text: 'field.text',
  experimental: 'field.experimental',
  header: 'field.header',
  now: 'field.now',
  appearance: 'field.appearance',
  visibility: 'field.visibility',
  data_processing: 'field.data_processing',
  advanced: 'field.advanced',
};

export function computeLabel(schema: HaFormSchema): string {
  if (schema.label) return schema.label;
  const key = LABEL_MAP[schema.name];
  if (key) return t(key);
  return schema.name.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

const HELPER_MAP: Record<string, string> = {
  graph_span: 'helper.graph_span',
  update_interval: 'helper.update_interval',
  update_delay: 'helper.update_delay',
  locale: 'helper.locale',
  offset: 'helper.offset',
  time_delta: 'helper.time_delta',
  duration: 'helper.duration',
  smoothing: 'helper.smoothing',
  transform: 'helper.transform',
  data_generator: 'helper.data_generator',
  compute: 'helper.compute',
  stroke_dash: 'helper.stroke_dash',
  selection_span: 'helper.selection_span',
  color: 'helper.color',
  attribute: 'helper.attribute',
  unit: 'helper.unit',
  float_precision: 'helper.float_precision',
  fixed_decimals: 'helper.fixed_decimals',
  section_mode: 'helper.section_mode',
  id: 'helper.id',
  axis: 'helper.axis',
  align_to: 'helper.align_to',
  selection_span_text: 'helper.selection_span_text',
};

export function computeHelper(schema: HaFormSchema): string {
  if (schema.helper) return schema.helper;
  const key = HELPER_MAP[schema.name];
  return key ? t(key) : '';
}

const DURATION_RE =
  /^\d+(\.\d+)?\s*(ms|milliseconds?|s|sec|seconds?|m|min|minutes?|h|hours?|d|days?|w|weeks?)(\s*\d+(\.\d+)?\s*(ms|milliseconds?|s|sec|seconds?|m|min|minutes?|h|hours?|d|days?|w|weeks?))*$/i;

export function isValidDuration(val: string | undefined): boolean {
  if (!val || String(val).trim() === '') return true;
  return DURATION_RE.test(String(val).trim());
}

export function isValidOffset(val: string | undefined): boolean {
  if (!val || String(val).trim() === '') return true;
  const t = String(val).trim();
  if (!/^[+-]/.test(t)) return false;
  return isValidDuration(t.substring(1));
}

// Y-axis min/max accepts: number, "auto", "~5" (soft), "|5|" (absolute)
export function isValidYaxisLimit(val: string | undefined): boolean {
  if (val === undefined || val === null) return true;
  const t = String(val).trim();
  if (t === '' || t === 'auto') return true;
  if (/^~-?\d+(\.\d+)?$/.test(t)) return true;
  if (/^\|[+-]?\d+(\.\d+)?\|$/.test(t)) return true;
  return !isNaN(Number(t));
}

export function newSeriesConfig(): { entity: string } {
  return { entity: '' };
}

export function newYAxisConfig(): { id: string; show: boolean } {
  return { id: '', show: true };
}

export function updateConfig(
  config: ChartCardExternalConfig,
  updates: Partial<ChartCardExternalConfig>,
): ChartCardExternalConfig {
  return { ...config, ...updates };
}

export function updateNestedConfig<K extends keyof ChartCardExternalConfig>(
  config: ChartCardExternalConfig,
  key: K,
  updates: Record<string, unknown>,
): ChartCardExternalConfig {
  const current = (config[key] as unknown as Record<string, unknown>) || {};
  return {
    ...config,
    [key]: { ...current, ...updates },
  };
}

// Without undefined and empty-string values
export function pruneEmpty<T extends Record<string, unknown>>(obj: T): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(obj)) {
    const v = obj[k];
    if (v === undefined || v === null) continue;
    if (typeof v === 'string' && v === '') continue;
    out[k] = v;
  }
  return out as Partial<T>;
}

// Runs fn once typing pauses; pending calls are kept per key, so one field never drops another's
export function debounced<A extends unknown[]>(
  fn: (...args: A) => void,
  keyOf: (...args: A) => string = () => '',
  wait = 350,
): (...args: A) => void {
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  return (...args: A) => {
    const key = keyOf(...args);
    clearTimeout(timers.get(key));
    timers.set(
      key,
      setTimeout(() => {
        timers.delete(key);
        fn(...args);
      }, wait),
    );
  };
}

// A complete number: partial input such as "1." or "-" waits, so the field isn't rewritten
export function typedNumber(text: string): number | undefined {
  return /^-?\d+(\.\d+)?$/.test(text.trim()) ? Number(text) : undefined;
}

export const SPAN_PRESETS = ['1h', '6h', '12h', '24h', '2d', '7d', '30d'];
export const INTERVAL_PRESETS = ['30s', '1min', '5min', '15min', '1h'];
export const BUCKET_PRESETS = ['5min', '15min', '30min', '1h', '6h', '1d'];
export const OFFSET_PRESETS = ['-1h', '-1d', '-7d', '+1h', '+1d'];

// A dropdown of presets that also takes a typed value; the helper says the format.
export function durationField(name: string, presets: string[], helper?: string): HaFormSchema {
  return {
    name,
    ...(helper ? { helper } : {}),
    selector: { select: { mode: 'dropdown', custom_value: true, options: presets } },
  };
}

export type YaxisLimitMode = 'auto' | 'fixed' | 'soft' | 'padding';

export function parseYaxisLimit(limit: string | number | undefined): { mode: YaxisLimitMode; value?: number } {
  if (limit === undefined || limit === null || limit === '' || limit === 'auto') return { mode: 'auto' };
  if (typeof limit === 'number') return { mode: 'fixed', value: limit };
  const text = limit.trim();
  if (text.startsWith('~')) return { mode: 'soft', value: Number(text.slice(1)) };
  if (text.startsWith('|')) return { mode: 'padding', value: Number(text.slice(1, -1)) };
  return { mode: 'fixed', value: Number(text) };
}

export function serializeYaxisLimit(mode: YaxisLimitMode, value: number | undefined): string | number | undefined {
  if (mode === 'auto' || value === undefined || isNaN(value)) return undefined;
  if (mode === 'soft') return `~${value}`;
  if (mode === 'padding') return `|${value >= 0 ? '+' : ''}${value}|`;
  return value;
}

type GroupBy = NonNullable<ChartCardExternalConfig['series'][number]['group_by']>;

export const SMOOTHING_PRESETS: Record<string, Pick<GroupBy, 'func' | 'duration'>> = {
  avg_5min: { func: 'avg', duration: '5min' },
  avg_15min: { func: 'avg', duration: '15min' },
  avg_1h: { func: 'avg', duration: '1h' },
  avg_1d: { func: 'avg', duration: '1d' },
  max_1d: { func: 'max', duration: '1d' },
  min_1d: { func: 'min', duration: '1d' },
};

// The preset a group_by matches: 'none' without grouping, 'custom' for anything else.
export function smoothingOf(groupBy: GroupBy | undefined): string {
  if (!groupBy?.func || groupBy.func === 'raw') return groupBy?.duration ? 'custom' : 'none';
  const found = Object.entries(SMOOTHING_PRESETS).find(
    ([, preset]) => preset.func === groupBy.func && preset.duration === groupBy.duration,
  );
  return found ? found[0] : 'custom';
}

// The schema without the fields `keep` rejects; grids left empty go too.
export function filterSchema(schema: HaFormSchema[], keep: (name: string) => boolean): HaFormSchema[] {
  return schema.flatMap((field) => {
    if (!field.schema || field.type === 'expandable') return keep(field.name) ? [field] : [];
    const inner = filterSchema(field.schema, keep);
    return inner.length ? [{ ...field, schema: inner }] : [];
  });
}
