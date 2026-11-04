import { HassEntities, HassEntity } from 'home-assistant-js-websocket';
import { compress as lzStringCompress, decompress as lzStringDecompress } from 'lz-string';
import { ChartCardConfig, EntityCachePoints } from './types';
import { TinyColor } from '@ctrl/tinycolor';
import parse from 'parse-duration';
import {
  ChartCardAllSeriesExternalConfig,
  ChartCardExternalConfig,
  ChartCardPrettyTime,
  ChartCardSeriesExternalConfig,
} from './types-config';
import { DEFAULT_FLOAT_PRECISION, DEFAULT_MAX, DEFAULT_MIN, moment, NO_VALUE } from './const';
import { formatNumber, FrontendLocaleData, HomeAssistant } from 'custom-card-helpers';
import { OverrideFrontendLocaleData } from './types-ha';
import { t } from './localize';
import { computeEntityName, computeStatisticName } from './entity-name';

export function compress(data: unknown): string {
  return lzStringCompress(JSON.stringify(data));
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function decompress(data: unknown | undefined): any | undefined {
  if (data !== undefined && typeof data === 'string') {
    const dec = lzStringDecompress(data);
    return dec && JSON.parse(dec);
  }
  return data;
}

export function getMilli(hours: number): number {
  return hours * 60 ** 2 * 10 ** 3;
}

export function log(message: unknown): void {
  console.warn('apexcharts-card: ', message);
}

const isObject = (obj: unknown): boolean => !!obj && typeof obj === 'object';

// Keys that would reach Object.prototype through user-supplied YAML/JSON
const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

// How two arrays under the same key are combined:
// 'concat' appends the source items, 'byIndex' merges item by item in place.
type ArrayMerge = 'concat' | 'byIndex';

/**
 * Deep merge of `source` into `target`, shared by mergeDeep and
 * mergeDeepConfig. Mutates `target`; nested objects are copied before being
 * merged into.
 *
 * @author inspired by [jhildenbiddle](https://stackoverflow.com/a/48218209).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mergeDeepWith(target: any, source: any, arrays: ArrayMerge): any {
  if (!isObject(target) || !isObject(source)) {
    return source;
  }

  Object.keys(source).forEach((key) => {
    if (UNSAFE_KEYS.has(key)) return;
    const targetValue = target[key];
    const sourceValue = source[key];

    if (Array.isArray(targetValue) && Array.isArray(sourceValue)) {
      target[key] =
        arrays === 'concat' ? targetValue.concat(sourceValue) : mergeDeepWith(targetValue, sourceValue, arrays);
    } else if (isObject(targetValue) && isObject(sourceValue)) {
      target[key] = mergeDeepWith(Object.assign({}, targetValue), sourceValue, arrays);
    } else {
      target[key] = sourceValue;
    }
  });

  return target;
}

/**
 * Deep merge for ApexCharts options: arrays are concatenated.
 * Mutates `target` only but not its objects and arrays.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function mergeDeep(target: any, source: any): any {
  return mergeDeepWith(target, source, 'concat');
}

// External long-term statistics use a `source:object_id` ID (e.g.
// `veolia:1235075_daily_consumption`) instead of an `entity_id`: they have no
// state object in `hass.states` and no recorder history, only LTS data.
export function isExternalStatisticId(entityId: string | undefined): entityId is string {
  return !!entityId && /^[a-z0-9_]+:[a-z0-9_]+$/.test(entityId);
}

// A series computed from other series (`compute`) instead of read from an entity
export function isComputedSeries(serie: Pick<ChartCardSeriesExternalConfig, 'compute'> | undefined): boolean {
  return serie?.compute !== undefined;
}

export function parseNumericState(value: unknown, binary = false): number | null {
  if (binary && value === 'on') return 1;
  if (binary && value === 'off') return 0;
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const parsed = typeof value === 'number' ? value : parseFloat(value);
  return Number.isNaN(parsed) ? null : parsed;
}

// Compile user code from the card config (transform, data_generator, compute) into a
// strict-mode function. Compile once and reuse: it runs per point/refresh.
export function compileUserFunction<F extends (...args: never[]) => unknown>(
  params: string[],
  body: string,
  isAsync = false,
): F {
  const FunctionCtor: FunctionConstructor = isAsync
    ? Object.getPrototypeOf(async function () {}).constructor
    : Function;
  return new FunctionCtor(...params, `'use strict'; ${body}`) as F;
}

// State object of a series' entity; a computed series has none
export function seriesState(
  hass: HomeAssistant | undefined,
  serie: Pick<ChartCardSeriesExternalConfig, 'entity'>,
): HassEntity | undefined {
  return serie.entity ? hass?.states[serie.entity] : undefined;
}

export function computeName(
  hass: HomeAssistant | undefined,
  index: number,
  series: ChartCardSeriesExternalConfig[] | undefined,
  entities: (HassEntity | undefined)[] | HassEntities | undefined = undefined,
  entity: HassEntity | undefined = undefined,
): string {
  if (!series || !series[index]) return '';
  const stateObj = entity ?? (entities as Record<number, HassEntity | undefined> | undefined)?.[index];
  const external = isExternalStatisticId(series[index].entity);
  let name = external
    ? computeStatisticName(stateObj, series[index].name)
    : computeEntityName(hass, stateObj, series[index].name);
  if (!name && external) name = series[index].entity!;
  if (!name && isComputedSeries(series[index])) name = series[index].id ?? '';
  return name + (series[index].show?.offset_in_name && series[index].offset ? ` (${series[index].offset})` : '');
}

export function computeUom(
  index: number,
  series: ChartCardSeriesExternalConfig[] | undefined,
  entities: (HassEntity | undefined)[] | undefined = undefined,
  entity: HassEntity | undefined = undefined,
): string {
  if (!series || !series[index]) return '';
  return (
    series[index].unit ||
    entity?.attributes?.unit_of_measurement ||
    (entities ? entities[index]?.attributes?.unit_of_measurement : undefined) ||
    ''
  );
}

export function computeColors(colors: string[] | undefined): string[] {
  if (!colors) return [];
  return colors.map((color) => {
    return computeColor(color);
  });
}

export function computeColor(color: string): string {
  if (color[0] === '#') {
    return new TinyColor(color).toHexString();
  } else if (color.substring(0, 3) === 'var') {
    return new TinyColor(
      window.getComputedStyle(document.documentElement).getPropertyValue(color.substring(4).slice(0, -1)).trim(),
    ).toHexString();
  } else {
    return new TinyColor(color).toHexString();
  }
}

export function computeTextColor(backgroundColor: string): string {
  const colorObj = new TinyColor(backgroundColor);
  if (colorObj.isValid && colorObj.isLight()) {
    return '#000'; // bright colors - black font
  } else {
    return '#fff'; // dark colors - white font
  }
}

export function validateInterval(interval: string, prefix: string): number {
  const parsed = parse(interval);
  if (parsed === null) {
    throw new Error(t('error.interval.invalid', { prefix, interval }));
  }
  return parsed;
}

export function validateOffset(interval: string, prefix: string): number {
  if (interval[0] !== '+' && interval[0] !== '-') {
    throw new Error(t('error.offset.invalidSign', { prefix, interval }));
  }
  return validateInterval(interval, prefix);
}

export function offsetData(data: EntityCachePoints, offset: number | undefined): EntityCachePoints {
  if (offset) {
    return data.map((entry) => {
      return [entry[0] - offset, entry[1]];
    });
  }
  return data;
}

export function prettyPrintTime(value: string | number | null, unit: ChartCardPrettyTime): string {
  if (value === null) return NO_VALUE;
  return moment.duration(value, unit).format('y[y] d[d] h[h] m[m] s[s] S[ms]', { trim: 'both' });
}

export function getPercentFromValue(value: number, min: number | undefined, max: number | undefined): number {
  const lMin = min === undefined ? DEFAULT_MIN : min;
  const lMax = max === undefined ? DEFAULT_MAX : max;
  return ((value - lMin) * 100) / (lMax - lMin);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getLovelace(): any | null {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let root: any = document.querySelector('home-assistant');
  root = root && root.shadowRoot;
  root = root && root.querySelector('home-assistant-main');
  root = root && root.shadowRoot;
  root = root && root.querySelector('app-drawer-layout partial-panel-resolver, ha-drawer partial-panel-resolver');
  root = (root && root.shadowRoot) || root;
  root = root && root.querySelector('ha-panel-lovelace');
  root = root && root.shadowRoot;
  root = root && root.querySelector('hui-root');
  if (root) {
    const ll = root.lovelace;
    ll.current_view = root.___curView;
    return ll;
  }
  return null;
}

export function interpolateColor(a: string, b: string, factor: number): string {
  const ah = +a.replace('#', '0x');
  const ar = ah >> 16;
  const ag = (ah >> 8) & 0xff;
  const ab = ah & 0xff;
  const bh = +b.replace('#', '0x');
  const br = bh >> 16;
  const bg = (bh >> 8) & 0xff;
  const bb = bh & 0xff;
  const rr = ar + factor * (br - ar);
  const rg = ag + factor * (bg - ag);
  const rb = ab + factor * (bb - ab);

  return `#${(((1 << 24) + (rr << 16) + (rg << 8) + rb) | 0).toString(16).slice(1)}`;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function mergeConfigTemplates(ll: any, config: ChartCardExternalConfig): ChartCardExternalConfig {
  const tpl = config.config_templates;
  if (!tpl) return config;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let result: any = {};
  const tpls = tpl && Array.isArray(tpl) ? tpl : [tpl];
  tpls?.forEach((template) => {
    if (!ll.config.apexcharts_card_templates?.[template]) throw new Error(t('error.template.missing', { template }));
    const res = mergeConfigTemplates(ll, JSON.parse(JSON.stringify(ll.config.apexcharts_card_templates[template])));
    result = mergeDeepConfig(result, res);
  });
  result = mergeDeepConfig(result, config);
  return result as ChartCardExternalConfig;
}

/**
 * Deep merge for card configs (templates, all_series_config): arrays such as
 * `series` are merged item by item, so a template's series is extended, not
 * duplicated. Mutates `target`, including its arrays.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function mergeDeepConfig(target: any, source: any): any {
  return mergeDeepWith(target, source, 'byIndex');
}

export function is12HourFromLocale(locale: string): boolean {
  return !(new Date(2021, 1, 1, 15, 0, 0, 0).toLocaleTimeString(locale).indexOf('15') > -1);
}

export function is12Hour(config: ChartCardConfig | undefined, hass: HomeAssistant | undefined): boolean {
  if (config?.hours_12 !== undefined) {
    return config.hours_12;
  } else {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const hassLocale = (hass as any)?.locale;
    if (hassLocale?.time_format) {
      if (hassLocale.time_format === 'language') {
        return is12HourFromLocale(hassLocale.language);
      } else if (hassLocale.time_format === 'system') {
        return is12HourFromLocale(navigator.language);
      } else {
        return hassLocale.time_format === '12';
      }
    } else {
      return is12HourFromLocale(getLang(config, hass));
    }
  }
}

export function formatApexDate(
  config: ChartCardConfig,
  hass: HomeAssistant | undefined,
  value: Date,
  withDate = true,
): string {
  const hours12 = is12Hour(config, hass) ? { hour12: true } : { hourCycle: 'h23' };
  const lang = getLang(config, hass);
  if (withDate) {
    return new Intl.DateTimeFormat(lang, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
      ...hours12,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any).format(value);
  } else {
    return new Intl.DateTimeFormat(lang, {
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
      ...hours12,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any).format(value);
  }
}

export function getLang(config: ChartCardConfig | undefined, hass: HomeAssistant | undefined): string {
  return config?.locale || hass?.language || 'en';
}

export function truncateFloat(
  value: string | number | null | undefined,
  precision: number | undefined,
): string | number | null {
  let lValue: string | number | null | undefined = value;
  if (lValue === undefined) return null;
  if (typeof lValue === 'string') {
    lValue = parseFloat(lValue);
    if (Number.isNaN(lValue)) {
      return lValue;
    }
  }
  if (lValue !== null && typeof lValue === 'number' && !Number.isInteger(lValue)) {
    lValue = (lValue as number).toFixed(precision === undefined ? DEFAULT_FLOAT_PRECISION : precision);
  }
  return lValue;
}

export function myFormatNumber(
  num: string | number | null | undefined,
  localeOptions?: FrontendLocaleData,
  format?: Pick<ChartCardAllSeriesExternalConfig, 'float_precision' | 'fixed_decimals'>,
): string | null {
  let lValue: string | number | null | undefined = num;
  if (lValue === undefined || lValue === null) return null;
  if (typeof lValue === 'string') {
    lValue = parseFloat(lValue);
    if (Number.isNaN(lValue)) {
      return num as string;
    }
  }
  const precision = format?.float_precision ?? DEFAULT_FLOAT_PRECISION;
  if (!format?.fixed_decimals) return formatNumber(lValue, localeOptions, { maximumFractionDigits: precision });
  // Always show `precision` decimals (13 -> 13.0) and never a negative zero (-0.04 -> 0.0)
  const rounded = Number(lValue.toFixed(precision)) || 0;
  return formatNumber(rounded, localeOptions, { minimumFractionDigits: precision, maximumFractionDigits: precision });
}

export function isUsingServerTimezone(/*config: ChartCardConfig, */ hass: HomeAssistant | undefined): boolean {
  return (hass?.locale as OverrideFrontendLocaleData).time_zone === 'server';
}
