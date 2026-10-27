import { computeTimezoneDiffWithLocal } from '../src/calendar';
import {
  compress,
  decompress,
  getMilli,
  mergeDeep,
  mergeDeepConfig,
  computeName,
  computeUom,
  computeColors,
  computeColor,
  computeTextColor,
  validateInterval,
  validateOffset,
  offsetData,
  prettyPrintTime,
  getPercentFromValue,
  getLovelace,
  interpolateColor,
  mergeConfigTemplates,
  is12HourFromLocale,
  is12Hour,
  formatApexDate,
  getLang,
  truncateFloat,
  myFormatNumber,
  isUsingServerTimezone,
} from '../src/utils';
import { NO_VALUE } from '../src/const';
import { mkState } from './fixtures/hass';

describe('utils.ts', () => {
  describe('compress / decompress', () => {
    it('round-trips arbitrary JSON data', () => {
      const data = { a: 1, b: [1, 2, 3], c: 'hello' };
      const compressed = compress(data);
      expect(typeof compressed).toBe('string');
      expect(decompress(compressed)).toEqual(data);
    });

    it('decompress returns the value untouched when not a string', () => {
      expect(decompress(undefined)).toBeUndefined();
      const obj = { a: 1 };
      expect(decompress(obj)).toBe(obj);
    });
  });

  describe('getMilli', () => {
    it('converts hours to milliseconds', () => {
      expect(getMilli(1)).toBe(3600000);
      expect(getMilli(0)).toBe(0);
      expect(getMilli(2)).toBe(7200000);
    });
  });

  describe('mergeDeep', () => {
    it('merges nested objects', () => {
      const target = { a: 1, nested: { x: 1, y: 2 } };
      const result = mergeDeep(target, { nested: { y: 3, z: 4 } });
      expect(result).toEqual({ a: 1, nested: { x: 1, y: 3, z: 4 } });
    });

    it('concatenates arrays instead of overwriting', () => {
      const result = mergeDeep({ list: [1, 2] }, { list: [3, 4] });
      expect(result.list).toEqual([1, 2, 3, 4]);
    });

    it('overwrites primitive values', () => {
      expect(mergeDeep({ a: 1 }, { a: 2 })).toEqual({ a: 2 });
    });

    it('returns source when target is not an object', () => {
      expect(mergeDeep(null, { a: 1 })).toEqual({ a: 1 });
      expect(mergeDeep(1, { a: 1 })).toEqual({ a: 1 });
    });

    it('returns source when source is not an object', () => {
      expect(mergeDeep({ a: 1 }, null)).toBeNull();
    });
  });

  describe('mergeDeepConfig', () => {
    it('merges arrays deeply (index-wise) instead of concatenating', () => {
      const result = mergeDeepConfig({ list: [{ a: 1 }] }, { list: [{ b: 2 }] });
      expect(result.list).toEqual([{ a: 1, b: 2 }]);
    });

    it('merges nested objects', () => {
      const result = mergeDeepConfig({ nested: { x: 1 } }, { nested: { y: 2 } });
      expect(result).toEqual({ nested: { x: 1, y: 2 } });
    });

    it('returns source for non-object target/source', () => {
      expect(mergeDeepConfig(null, { a: 1 })).toEqual({ a: 1 });
      expect(mergeDeepConfig({ a: 1 }, null)).toBeNull();
    });
  });

  describe('computeName', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const series: any[] = [{ name: undefined, show: {} }];

    it('returns empty string when series or entities/entity missing', () => {
      expect(computeName(0, undefined, undefined, undefined)).toBe('');
      expect(computeName(0, series, undefined, undefined)).toBe('');
    });

    it('prefers series.name over entity attributes', () => {
      const entity = mkState('sensor.x', '1', { friendly_name: 'Friendly' });
      const s = [{ name: 'Custom Name', show: {} }];
      expect(computeName(0, s, undefined, entity)).toBe('Custom Name');
    });

    it('falls back to friendly_name then entity_id', () => {
      const entityWithFriendly = mkState('sensor.x', '1', { friendly_name: 'Friendly' });
      expect(computeName(0, series, undefined, entityWithFriendly)).toBe('Friendly');

      const entityNoFriendly = mkState('sensor.y', '1', {});
      expect(computeName(0, series, undefined, entityNoFriendly)).toBe('sensor.y');
    });

    it('reads from entities array when entity is not provided', () => {
      const entities = [mkState('sensor.z', '1', { friendly_name: 'From Array' })];
      expect(computeName(0, series, entities, undefined)).toBe('From Array');
    });

    it('appends the offset when show.offset_in_name and offset are set', () => {
      const entity = mkState('sensor.x', '1', { friendly_name: 'Friendly' });
      const s = [{ name: 'N', offset: '-1d', show: { offset_in_name: true } }];
      expect(computeName(0, s, undefined, entity)).toBe('N (-1d)');
    });

    it('does not append offset when show.offset_in_name is false', () => {
      const entity = mkState('sensor.x', '1', { friendly_name: 'Friendly' });
      const s = [{ name: 'N', offset: '-1d', show: { offset_in_name: false } }];
      expect(computeName(0, s, undefined, entity)).toBe('N');
    });
  });

  describe('computeUom', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const series: any[] = [{ unit: undefined }];

    it('returns empty string when series or entities/entity missing', () => {
      expect(computeUom(0, undefined, undefined, undefined)).toBe('');
      expect(computeUom(0, series, undefined, undefined)).toBe('');
    });

    it('prefers series.unit over entity unit_of_measurement', () => {
      const entity = mkState('sensor.x', '1', { unit_of_measurement: 'W' });
      const s = [{ unit: 'kWh' }];
      expect(computeUom(0, s, undefined, entity)).toBe('kWh');
    });

    it('falls back to entity unit_of_measurement', () => {
      const entity = mkState('sensor.x', '1', { unit_of_measurement: 'W' });
      expect(computeUom(0, series, undefined, entity)).toBe('W');
    });

    it('reads from entities array when entity is not provided', () => {
      const entities = [mkState('sensor.z', '1', { unit_of_measurement: 'A' })];
      expect(computeUom(0, series, entities, undefined)).toBe('A');
    });

    it('returns empty string when nothing resolves', () => {
      const entity = mkState('sensor.x', '1', {});
      expect(computeUom(0, series, undefined, entity)).toBe('');
    });
  });

  describe('computeColor / computeColors', () => {
    it('resolves a hex color', () => {
      expect(computeColor('#123456')).toBe('#123456');
    });

    it('resolves a named color', () => {
      expect(computeColor('red')).toBe('#ff0000');
    });

    it('resolves a CSS variable via getComputedStyle', () => {
      document.documentElement.style.setProperty('--my-test-color', '#00ff00');
      expect(computeColor('var(--my-test-color)')).toBe('#00ff00');
    });

    it('computeColors maps an array of colors, returns [] for undefined', () => {
      expect(computeColors(undefined)).toEqual([]);
      expect(computeColors(['red', '#000000'])).toEqual(['#ff0000', '#000000']);
    });
  });

  describe('computeTextColor', () => {
    it('returns black for light backgrounds', () => {
      expect(computeTextColor('#ffffff')).toBe('#000');
    });

    it('returns white for dark backgrounds', () => {
      expect(computeTextColor('#000000')).toBe('#fff');
    });

    it('returns white for invalid colors (isValid false path)', () => {
      expect(computeTextColor('not-a-color')).toBe('#fff');
    });
  });

  describe('validateInterval', () => {
    it('parses a valid duration string', () => {
      expect(validateInterval('1h', 'graph_span')).toBe(3600000);
      expect(validateInterval('30min', 'graph_span')).toBe(1800000);
    });

    it('throws on an invalid duration string', () => {
      expect(() => validateInterval('not-a-duration', 'graph_span')).toThrow(/is not a valid range of time/);
    });
  });

  describe('validateOffset', () => {
    it('accepts a leading + or -', () => {
      expect(validateOffset('+1h', 'offset')).toBe(3600000);
      expect(validateOffset('-1h', 'offset')).toBe(-3600000);
    });

    it('throws when missing the +/- prefix', () => {
      expect(() => validateOffset('1h', 'offset')).toThrow(/should start with a/);
    });

    it('throws when the underlying interval is invalid', () => {
      expect(() => validateOffset('+bogus', 'offset')).toThrow(/is not a valid range of time/);
    });
  });

  describe('offsetData', () => {
    it('shifts every timestamp by the offset', () => {
      const data: [number, number | null][] = [
        [1000, 1],
        [2000, 2],
      ];
      expect(offsetData(data, 500)).toEqual([
        [500, 1],
        [1500, 2],
      ]);
    });

    it('returns the data untouched when offset is undefined or 0', () => {
      const data: [number, number | null][] = [[1000, 1]];
      expect(offsetData(data, undefined)).toBe(data);
      expect(offsetData(data, 0)).toBe(data);
    });
  });

  describe('prettyPrintTime', () => {
    it('returns NO_VALUE for null', () => {
      expect(prettyPrintTime(null, 'ms')).toBe(NO_VALUE);
    });

    it('formats a duration value', () => {
      expect(prettyPrintTime(90000, 'ms')).toBe('1m 30s');
    });
  });

  describe('getPercentFromValue', () => {
    it('computes a percentage within default 0-100 range', () => {
      expect(getPercentFromValue(50, undefined, undefined)).toBe(50);
    });

    it('computes a percentage within a custom range', () => {
      expect(getPercentFromValue(5, 0, 10)).toBe(50);
      expect(getPercentFromValue(15, 10, 20)).toBe(50);
    });
  });

  describe('getLovelace', () => {
    it('returns null when there is no home-assistant element in the DOM', () => {
      expect(getLovelace()).toBeNull();
    });
  });

  describe('interpolateColor', () => {
    it('returns the start color at factor 0', () => {
      expect(interpolateColor('#000000', '#ffffff', 0)).toBe('#000000');
    });

    it('returns the end color at factor 1', () => {
      expect(interpolateColor('#000000', '#ffffff', 1)).toBe('#ffffff');
    });

    it('interpolates midway', () => {
      expect(interpolateColor('#000000', '#ffffff', 0.5)).toBe('#7f7f7f');
    });
  });

  describe('mergeConfigTemplates', () => {
    it('returns the config unchanged when there are no templates', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const config = { series: [] } as any;
      expect(mergeConfigTemplates({ config: {} }, config)).toEqual(config);
    });

    it('merges a named template into the config', () => {
      const ll = { config: { apexcharts_card_templates: { tpl1: { graph_span: '1h' } } } };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = mergeConfigTemplates(ll, { config_templates: ['tpl1'], series: [] } as any);
      expect(result.graph_span).toBe('1h');
    });

    it('throws when the referenced template is missing', () => {
      const ll = { config: {} };
      expect(() =>
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        mergeConfigTemplates(ll, { config_templates: ['missing'], series: [] } as any),
      ).toThrow(/is missing from your config/);
    });
  });

  describe('is12HourFromLocale', () => {
    it('detects 24h locales', () => {
      expect(is12HourFromLocale('fr-FR')).toBe(false);
    });

    it('detects 12h locales', () => {
      expect(is12HourFromLocale('en-US')).toBe(true);
    });
  });

  describe('is12Hour', () => {
    it('honors config.hours_12 when explicitly set', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect(is12Hour({ hours_12: true } as any, undefined)).toBe(true);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect(is12Hour({ hours_12: false } as any, undefined)).toBe(false);
    });

    it('uses hass.locale.time_format when hours_12 is not set', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const hass12 = { locale: { time_format: '12' } } as any;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const hass24 = { locale: { time_format: '24' } } as any;
      expect(is12Hour({} as never, hass12)).toBe(true);
      expect(is12Hour({} as never, hass24)).toBe(false);
    });

    it('resolves time_format "language" via is12HourFromLocale', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const hass = { locale: { time_format: 'language', language: 'en-US' } } as any;
      expect(is12Hour({} as never, hass)).toBe(true);
    });

    it('resolves time_format "system" via navigator.language', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const hass = { locale: { time_format: 'system' } } as any;
      expect(typeof is12Hour({} as never, hass)).toBe('boolean');
    });

    it('falls back to getLang()-based locale detection with no hass locale', () => {
      expect(is12Hour(undefined, undefined)).toBe(true); // 'en' default locale is 12h
    });
  });

  describe('formatApexDate', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const config = { locale: 'en' } as any;
    const date = new Date(Date.UTC(2024, 0, 15, 13, 30, 0));

    it('formats with the date portion by default', () => {
      const result = formatApexDate(config, undefined, date, true);
      expect(result).toContain('2024');
    });

    it('formats without the date portion when withDate is false', () => {
      const result = formatApexDate(config, undefined, date, false);
      expect(result).not.toContain('2024');
    });
  });

  describe('getLang', () => {
    it('prioritizes config.locale, then hass.language, then "en"', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect(getLang({ locale: 'de' } as any, { language: 'fr' } as any)).toBe('de');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect(getLang(undefined, { language: 'fr' } as any)).toBe('fr');
      expect(getLang(undefined, undefined)).toBe('en');
    });
  });

  describe('truncateFloat', () => {
    it('returns null for undefined', () => {
      expect(truncateFloat(undefined, 2)).toBeNull();
    });

    it('returns null for null', () => {
      expect(truncateFloat(null, 2)).toBeNull();
    });

    it('parses numeric strings', () => {
      expect(truncateFloat('5', 2)).toBe(5);
      expect(truncateFloat('5.6789', 2)).toBe('5.68');
    });

    it('returns NaN for non-numeric strings', () => {
      expect(Number.isNaN(truncateFloat('abc', 2))).toBe(true);
    });

    it('leaves integers untouched', () => {
      expect(truncateFloat(5, 2)).toBe(5);
    });

    it('formats floats with the given precision', () => {
      expect(truncateFloat(5.6789, 2)).toBe('5.68');
    });

    it('uses the default precision when none is given', () => {
      expect(truncateFloat(5.6789, undefined)).toBe('5.7');
    });
  });

  describe('myFormatNumber', () => {
    it('returns null for undefined/null', () => {
      expect(myFormatNumber(undefined)).toBeNull();
      expect(myFormatNumber(null)).toBeNull();
    });

    it('returns the original string when it does not parse to a number', () => {
      expect(myFormatNumber('abc')).toBe('abc');
    });

    it('formats a numeric value using the locale options', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const localeOptions = { language: 'en', number_format: 'comma_decimal' } as any;
      expect(myFormatNumber(1234.5, localeOptions, 1)).toBe('1,234.5');
    });

    it('parses numeric strings before formatting', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const localeOptions = { language: 'en', number_format: 'comma_decimal' } as any;
      expect(myFormatNumber('10', localeOptions, 0)).toBe('10');
    });
  });

  describe('computeTimezoneDiffWithLocal', () => {
    it('returns 0 when no timezone is given', () => {
      expect(computeTimezoneDiffWithLocal(undefined)).toBe(0);
    });

    it('returns 0 when the timezone matches the local one', () => {
      const localTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      expect(computeTimezoneDiffWithLocal(localTz)).toBe(0);
    });

    it('returns a number for a different timezone', () => {
      expect(typeof computeTimezoneDiffWithLocal('Pacific/Kiritimati')).toBe('number');
    });
  });

  describe('isUsingServerTimezone', () => {
    it('returns true when hass.locale.time_zone is "server"', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect(isUsingServerTimezone({ locale: { time_zone: 'server' } } as any)).toBe(true);
    });

    it('returns false when hass.locale.time_zone is "local"', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect(isUsingServerTimezone({ locale: { time_zone: 'local' } } as any)).toBe(false);
    });

    // BUG: isUsingServerTimezone does `(hass?.locale as OverrideFrontendLocaleData).time_zone`
    // instead of `hass?.locale?.time_zone` -- when `hass` is undefined this throws a
    // TypeError instead of gracefully returning false. Documented here, not fixed
    // (out of scope: no src/ changes allowed).
    it('BUG: throws instead of returning false when hass is undefined', () => {
      expect(() => isUsingServerTimezone(undefined)).toThrow();
    });
  });
});
