import {
  toSelectValue,
  fromSelectValue,
  parseStrokeDash,
  serializeStrokeDash,
  computeLabel,
  computeHelper,
  isValidDuration,
  isValidOffset,
  isValidYaxisLimit,
  newSeriesConfig,
  newYAxisConfig,
  updateConfig,
  updateNestedConfig,
  pruneEmpty,
} from '../src/editor/helpers';
import {
  getApexValue,
  setApexValue,
  setApexValues,
  getApexYaxisValue,
  setApexYaxisValue,
  unwrapEvalBody,
  wrapEvalBody,
} from '../src/editor/apex-config-utils';
import { setEditorLocale } from '../src/editor/localize';
import { HaFormSchema } from '../src/editor/types';
import { ChartCardExternalConfig } from '../src/types-config';

const schema = (name: string): HaFormSchema => ({ name }) as HaFormSchema;

const baseConfig = (): ChartCardExternalConfig => ({
  type: 'custom:apexcharts-card',
  series: [{ entity: 'sensor.temp' }],
});

afterEach(() => {
  setEditorLocale('en');
});

describe('select value coercion', () => {
  it('round-trips booleans, undefined and strings', () => {
    expect(fromSelectValue(toSelectValue(true))).toBe(true);
    expect(fromSelectValue(toSelectValue(false))).toBe(false);
    expect(fromSelectValue(toSelectValue(undefined))).toBeUndefined();
    expect(fromSelectValue(toSelectValue(null))).toBeUndefined();
    expect(fromSelectValue(toSelectValue('smooth'))).toBe('smooth');
    expect(toSelectValue(42)).toBe('42');
  });

  it('fromSelectValue treats empty/undefined as undefined', () => {
    expect(fromSelectValue(undefined)).toBeUndefined();
    expect(fromSelectValue('')).toBeUndefined();
  });
});

describe('stroke_dash conversion', () => {
  it('parses single numbers and comma lists', () => {
    expect(parseStrokeDash('5')).toBe(5);
    expect(parseStrokeDash('5, 3, 2')).toEqual([5, 3, 2]);
    expect(parseStrokeDash(' ')).toBeUndefined();
    expect(parseStrokeDash(undefined)).toBeUndefined();
    expect(parseStrokeDash('abc')).toBeUndefined();
    expect(parseStrokeDash('a,b')).toBeUndefined();
  });

  it('serializes back to string', () => {
    expect(serializeStrokeDash(5)).toBe('5');
    expect(serializeStrokeDash([5, 3])).toBe('5, 3');
    expect(serializeStrokeDash(undefined)).toBe('');
  });
});

describe('computeLabel / computeHelper', () => {
  it('returns translated labels for the active locale', () => {
    setEditorLocale('en');
    expect(computeLabel(schema('graph_span'))).toBe('X Axis Span');
    setEditorLocale('fr');
    expect(computeLabel(schema('graph_span'))).toBe('Étendue de l’axe X');
  });

  it('falls back to a title-cased name for unknown fields', () => {
    expect(computeLabel(schema('totally_unknown_field'))).toBe('Totally Unknown Field');
  });

  it('computeHelper returns text for known fields and empty for unknown', () => {
    setEditorLocale('en');
    expect(computeHelper(schema('update_interval'))).not.toBe('');
    expect(computeHelper(schema('totally_unknown_field'))).toBe('');
  });
});

describe('validators', () => {
  it('isValidDuration', () => {
    expect(isValidDuration(undefined)).toBe(true);
    expect(isValidDuration('')).toBe(true);
    expect(isValidDuration('1h')).toBe(true);
    expect(isValidDuration('12min')).toBe(true);
    expect(isValidDuration('1d')).toBe(true);
    expect(isValidDuration('10sec')).toBe(true);
    expect(isValidDuration('nope')).toBe(false);
    expect(isValidDuration('h1')).toBe(false);
  });

  it('isValidOffset requires a sign prefix', () => {
    expect(isValidOffset(undefined)).toBe(true);
    expect(isValidOffset('-1d')).toBe(true);
    expect(isValidOffset('+6h')).toBe(true);
    expect(isValidOffset('1d')).toBe(false);
    expect(isValidOffset('-nope')).toBe(false);
  });

  it('isValidYaxisLimit accepts numbers, auto, soft (~) and absolute (|x|) forms', () => {
    expect(isValidYaxisLimit(undefined)).toBe(true);
    expect(isValidYaxisLimit('auto')).toBe(true);
    expect(isValidYaxisLimit('42')).toBe(true);
    expect(isValidYaxisLimit('-3.14')).toBe(true);
    expect(isValidYaxisLimit('~10')).toBe(true);
    expect(isValidYaxisLimit('|5|')).toBe(true);
    expect(isValidYaxisLimit('abc')).toBe(false);
    expect(isValidYaxisLimit('~abc')).toBe(false);
  });
});

describe('config factories and immutable updates', () => {
  it('newSeriesConfig / newYAxisConfig', () => {
    expect(newSeriesConfig()).toEqual({ entity: '' });
    expect(newYAxisConfig()).toEqual({ id: '', show: true });
  });

  it('updateConfig merges without mutating', () => {
    const cfg = baseConfig();
    const next = updateConfig(cfg, { graph_span: '48h' });
    expect(next.graph_span).toBe('48h');
    expect(cfg.graph_span).toBeUndefined();
  });

  it('updateNestedConfig merges a nested object', () => {
    const cfg = baseConfig();
    const next = updateNestedConfig(cfg, 'header', { show: true });
    expect(next.header).toEqual({ show: true });
    expect(cfg.header).toBeUndefined();
  });

  it('pruneEmpty strips undefined/null/empty-string values', () => {
    expect(pruneEmpty({ a: 1, b: undefined, c: '', d: null, e: 'x', f: 0, g: false })).toEqual({
      a: 1,
      e: 'x',
      f: 0,
      g: false,
    });
  });
});

describe('apex-config-utils', () => {
  it('getApexValue reads nested paths', () => {
    const cfg = { ...baseConfig(), apex_config: { chart: { height: 200 } } };
    expect(getApexValue(cfg, 'chart.height')).toBe(200);
    expect(getApexValue(cfg, 'chart.missing')).toBeUndefined();
    expect(getApexValue(cfg, 'missing.path')).toBeUndefined();
    expect(getApexValue(baseConfig(), 'chart.height')).toBeUndefined();
  });

  it('setApexValue sets a nested value without mutating the input', () => {
    const cfg = baseConfig();
    const next = setApexValue(cfg, 'legend.show', false);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((next.apex_config as any).legend.show).toBe(false);
    expect(cfg.apex_config).toBeUndefined();
  });

  it('setApexValue with undefined removes the leaf and prunes empty parents', () => {
    const cfg = { ...baseConfig(), apex_config: { legend: { show: false } } };
    const next = setApexValue(cfg, 'legend.show', undefined);
    expect(next.apex_config).toBeUndefined();
  });

  it('setApexValue keeps siblings when removing a leaf', () => {
    const cfg = { ...baseConfig(), apex_config: { legend: { show: false, position: 'top' } } };
    const next = setApexValue(cfg, 'legend.show', undefined);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((next.apex_config as any).legend).toEqual({ position: 'top' });
  });

  it('setApexValue ignores prototype-polluting paths', () => {
    const cfg = baseConfig();
    const next = setApexValue(cfg, '__proto__.polluted', true);
    expect(next).toBe(cfg);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(({} as any).polluted).toBeUndefined();
  });

  it('setApexValues applies several patches at once', () => {
    const cfg = baseConfig();
    const next = setApexValues(cfg, { 'legend.show': false, 'chart.height': 150 });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const apex = next.apex_config as any;
    expect(apex.legend.show).toBe(false);
    expect(apex.chart.height).toBe(150);
  });
});

describe('apex-config-utils — per-yaxis apex_config', () => {
  const yaxisConfig = (): ChartCardExternalConfig => ({
    ...baseConfig(),
    yaxis: [{ id: 'first' }, { id: 'second' }],
  });

  it('getApexYaxisValue reads a nested per-axis value', () => {
    const cfg = yaxisConfig();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (cfg.yaxis![0] as any).apex_config = { labels: { show: false } };
    expect(getApexYaxisValue(cfg, 0, 'labels.show')).toBe(false);
    expect(getApexYaxisValue(cfg, 0, 'labels.missing')).toBeUndefined();
    expect(getApexYaxisValue(cfg, 1, 'labels.show')).toBeUndefined();
    expect(getApexYaxisValue(cfg, 9, 'labels.show')).toBeUndefined();
    expect(getApexYaxisValue(undefined, 0, 'labels.show')).toBeUndefined();
  });

  it('setApexYaxisValue writes without mutating and prunes on removal', () => {
    const cfg = yaxisConfig();
    const next = setApexYaxisValue(cfg, 1, 2, 'tickAmount', 4);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((next.yaxis![1] as any).apex_config.tickAmount).toBe(4);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((cfg.yaxis![1] as any).apex_config).toBeUndefined();

    const removed = setApexYaxisValue(next, 1, 2, 'tickAmount', undefined);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((removed.yaxis![1] as any).apex_config).toBeUndefined();
  });

  it('setApexYaxisValue is a no-op for a missing index or polluting path', () => {
    const cfg = yaxisConfig();
    expect(setApexYaxisValue(cfg, 9, 2, 'tickAmount', 4)).toBe(cfg);
    expect(setApexYaxisValue(cfg, 0, 2, '__proto__.x', 4)).toBe(cfg);
  });
});

describe('apex-config-utils — EVAL formatter wrappers', () => {
  it('unwrapEvalBody extracts the function body', () => {
    expect(unwrapEvalBody("EVAL:function(value) {\n  return value + ' kWh';\n}")).toBe("return value + ' kWh';");
    expect(unwrapEvalBody('plain text')).toBe('plain text');
    expect(unwrapEvalBody('EVAL:not-a-function-shape')).toBe('not-a-function-shape');
    expect(unwrapEvalBody(42)).toBe('');
    expect(unwrapEvalBody(undefined)).toBe('');
  });

  it('wrapEvalBody wraps a body and round-trips with unwrapEvalBody', () => {
    expect(wrapEvalBody('')).toBeUndefined();
    expect(wrapEvalBody('EVAL:function(value) { return 1; }')).toBe('EVAL:function(value) { return 1; }');
    const wrapped = wrapEvalBody('return value;');
    expect(wrapped).toMatch(/^EVAL:function\(value\) \{/);
    expect(unwrapEvalBody(wrapped)).toBe('return value;');
  });
});

// Pinned before setApexValue and setApexYaxisValue share their path setter
describe('apex_config path setters', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cfg = (extra: any = {}): any => ({ type: 'custom:apexcharts-card', series: [], ...extra });

  it('setApexYaxisValue sets, replaces non-objects on the way and prunes', () => {
    const base = cfg({ yaxis: [{ id: 'a' }, { id: 'b', apex_config: { labels: 'x', tickAmount: 2 } }] });
    const set = setApexYaxisValue(base, 1, 2, 'labels.style.color', 'red');
    expect(set.yaxis).toEqual([
      { id: 'a' },
      { id: 'b', apex_config: { labels: { style: { color: 'red' } }, tickAmount: 2 } },
    ]);
    expect(base.yaxis[1].apex_config).toEqual({ labels: 'x', tickAmount: 2 });
    const removed = setApexYaxisValue(set, 1, 2, 'labels.style.color', '');
    expect(removed.yaxis[1]).toEqual({ id: 'b', apex_config: { tickAmount: 2 } });
    const empty = setApexYaxisValue(removed, 1, 2, 'tickAmount', null);
    expect(empty.yaxis[1]).toEqual({ id: 'b' });
  });

  it('setApexYaxisValue ignores missing axes and prototype-polluting paths', () => {
    const base = cfg({ yaxis: [{ id: 'a' }] });
    expect(setApexYaxisValue(base, 3, 1, 'min', 1)).toBe(base);
    expect(setApexYaxisValue(cfg(), 0, 1, 'min', 1)).toEqual(cfg());
    expect(setApexYaxisValue(base, 0, 1, 'labels.__proto__.polluted', true)).toBe(base);
    expect(setApexYaxisValue(base, 0, 1, 'constructor', true)).toBe(base);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('setApexValue replaces arrays and nulls on the way, and drops an empty apex_config', () => {
    const base = cfg({ apex_config: { chart: [1], legend: null } });
    expect(setApexValue(base, 'chart.height', 100).apex_config).toEqual({ chart: { height: 100 }, legend: null });
    expect(setApexValue(cfg({ apex_config: { a: 1 } }), 'a', undefined).apex_config).toBeUndefined();
    expect(setApexValue(base, 'x.prototype.y', 1)).toBe(base);
  });
});
