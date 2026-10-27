// moment.tz() for user code (data_generator, transform) without shipping a
// time zone database: moment-timezone's core runs unchanged, and the data of
// a zone is built from the browser's rules (Intl) the first time it is used,
// in moment-timezone's own packed format.
import type { Moment, MomentTimezone } from 'moment-timezone';
import { zoneOffset } from './zone';
import { ZONE_ABBREVIATIONS, ZONE_LINKS } from './zone-abbreviations';

// Range covered by generated data; outside it moment-timezone keeps the
// nearest offset, as it does with its bundled data.
const FROM = Date.UTC(1800, 0, 1);
const UNTIL = Date.UTC(2100, 0, 1);
// Offsets are sampled weekly, then each change is pinned to the second
const STEP = 7 * 24 * 3600 * 1000;

// moment-timezone's base 60 digits: 0-9, a-z, A-X
const BASE60 = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWX';

// Seconds as base-60 minutes (whole minutes, then seconds after '.')
function packMinutes(seconds: number): string {
  const sign = seconds < 0 ? '-' : '';
  let rest = Math.abs(seconds);
  const secs = rest % 60;
  rest = (rest - secs) / 60;
  let whole = '';
  do {
    whole = BASE60[rest % 60] + whole;
    rest = Math.floor(rest / 60);
  } while (rest > 0);
  return sign + whole + (secs ? `.${BASE60[secs]}` : '');
}

function isValidZone(name: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: name });
    return true;
  } catch {
    return false;
  }
}

// Offset in seconds east of UTC
const offsetAt = (ts: number, zone: string): number => Math.round(zoneOffset(ts, zone) / 1000);

// First second in (from, to] whose offset differs from the one at `from`
function findChange(from: number, to: number, zone: string): number {
  const before = offsetAt(from, zone);
  let low = Math.floor(from / 1000);
  let high = Math.floor(to / 1000);
  while (high - low > 1) {
    const mid = Math.floor((low + high) / 2);
    if (offsetAt(mid * 1000, zone) === before) low = mid;
    else high = mid;
  }
  return high * 1000;
}

interface AbbreviationEra {
  start: number; // ms since 1970, -Infinity for the first era
  names: Record<string, string>; // seconds east of UTC -> abbreviation
}

const parsedEras = new Map<string, AbbreviationEra[]>();

// Abbreviation eras of the IANA database for a zone or alias (see
// zone-abbreviations.ts), parsed on first use
function abbreviationEras(zone: string): AbbreviationEra[] {
  let eras = parsedEras.get(zone);
  if (!eras) {
    const encoded = ZONE_ABBREVIATIONS[zone] ?? ZONE_ABBREVIATIONS[ZONE_LINKS[zone]] ?? '';
    eras = encoded
      ? encoded.split(';').map((era) => {
          const [start, names] = era.split('|');
          return {
            start: start === '' ? -Infinity : Number(start) * 60000,
            names: Object.fromEntries(names.split(',').map((pair) => pair.split('='))),
          };
        })
      : [];
    parsedEras.set(zone, eras);
  }
  return eras;
}

const englishFormats = new Map<string, Intl.DateTimeFormat>();

// Abbreviation for an offset the database does not name (a zone or a rule
// newer than its data): a letter abbreviation where an English locale knows
// one, otherwise the numeric form the IANA database uses (+0545, -03).
function browserAbbreviation(ts: number, zone: string, offsetSeconds: number): string {
  for (const locale of ['en-US', 'en-GB', 'en-AU', 'en-NZ', 'en-IN', 'en-ZA', 'en-CA', 'en-IE']) {
    const key = `${locale}|${zone}`;
    let format = englishFormats.get(key);
    if (!format) {
      format = new Intl.DateTimeFormat(locale, { timeZone: zone, timeZoneName: 'short' });
      englishFormats.set(key, format);
    }
    const name = format.formatToParts(ts).find((part) => part.type === 'timeZoneName')?.value ?? '';
    if (/^[A-Z]{2,5}$/.test(name)) return name;
  }
  const sign = offsetSeconds < 0 ? '-' : '+';
  const minutes = Math.round(Math.abs(offsetSeconds) / 60);
  const hh = String(Math.floor(minutes / 60)).padStart(2, '0');
  const mm = minutes % 60 ? String(minutes % 60).padStart(2, '0') : '';
  return `${sign}${hh}${mm}`;
}

// The zone's abbreviation for an offset in effect at `ts`
function abbreviation(ts: number, zone: string, offsetSeconds: number): string {
  const eras = abbreviationEras(zone);
  let era: AbbreviationEra | undefined;
  for (const candidate of eras) if (candidate.start <= ts) era = candidate;
  return era?.names[String(offsetSeconds)] ?? browserAbbreviation(ts, zone, offsetSeconds);
}

// moment-timezone packed zone ("name|abbrs|offsets|indices|untils|population")
// built from the browser's rules, or undefined when the browser does not
// know the zone.
export function packZone(name: string): string | undefined {
  if (!isValidZone(name)) return undefined;
  // Periods of constant offset: [start, offset in seconds east]
  const periods: Array<[number, number]> = [[FROM, offsetAt(FROM, name)]];
  for (let ts = FROM; ts < UNTIL; ts += STEP) {
    const next = Math.min(ts + STEP, UNTIL);
    // Several changes can fall inside one step: find them one after another
    for (let from = ts; offsetAt(next, name) !== periods[periods.length - 1][1];) {
      from = findChange(from, next, name);
      periods.push([from, offsetAt(from, name)]);
    }
  }

  // A zone can rename an offset without changing it: split there too
  for (const { start } of abbreviationEras(name)) {
    if (start <= FROM || start >= UNTIL) continue;
    const i = periods.findIndex(([periodStart]) => periodStart >= start);
    const at = i === -1 ? periods.length : i;
    if (periods[at]?.[0] !== start) periods.splice(at, 0, [start, periods[at - 1][1]]);
  }

  // Distinct (abbreviation, offset) types and the period → type indices
  const types: string[] = [];
  const typeAbbrs: string[] = [];
  const typeOffsets: number[] = [];
  const indices = periods.map(([start, offset]) => {
    const abbr = abbreviation(start, name, offset);
    const key = `${abbr}|${offset}`;
    let index = types.indexOf(key);
    if (index === -1) {
      index = types.push(key) - 1;
      typeAbbrs.push(abbr);
      // moment-timezone offsets are minutes west of UTC
      typeOffsets.push(-offset);
    }
    return BASE60[index];
  });

  // Untils: end of each period but the last, as differences in minutes
  let previous = 0;
  const untils = periods.slice(1).map(([start]) => {
    const seconds = Math.round(start / 1000);
    const diff = seconds - previous;
    previous = seconds;
    return packMinutes(diff);
  });

  return [
    name,
    typeAbbrs.join(' '),
    typeOffsets.map((offset) => packMinutes(offset)).join(' '),
    indices.join(''),
    untils.join(' '),
    '0',
  ].join('|');
}

// Make moment.tz(...) load zones from the browser on first use. Every entry
// point that takes a zone name registers the zone first, then runs
// moment-timezone's own code.
export function useBrowserTimeZones(moment: { tz: MomentTimezone; fn: Moment }): void {
  const tz = moment.tz;
  const zone = tz.zone.bind(tz);
  const ensure = (name: unknown): void => {
    if (typeof name !== 'string' || name === '' || zone(name)) return;
    const packed = packZone(name);
    if (packed) tz.add(packed);
  };
  const setDefault = tz.setDefault.bind(tz);
  const overrides: Partial<MomentTimezone> = {
    zone: (name: string) => {
      ensure(name);
      return zone(name);
    },
    setDefault: (name?: string) => {
      ensure(name);
      return setDefault(name);
    },
    // Every zone the browser knows, plus any registered under another name
    names: () => {
      const known = (Intl as unknown as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf?.(
        'timeZone',
      );
      return [...new Set([...(known ?? []), ...tz.names()])].sort();
    },
  };
  // A proxy, not a copy: settings users change on moment.tz (e.g.
  // moveAmbiguousForward) must reach the object moment-timezone reads.
  moment.tz = new Proxy(tz, {
    apply(target, thisArg, args: unknown[]) {
      ensure(args[args.length - 1]);
      return Reflect.apply(target as unknown as (...a: unknown[]) => unknown, thisArg, args);
    },
    get(target, property, receiver) {
      return property in overrides
        ? overrides[property as keyof MomentTimezone]
        : Reflect.get(target, property, receiver);
    },
  });

  const fnTz = moment.fn.tz;
  moment.fn.tz = function (this: Moment, name?: string, keepTime?: boolean) {
    ensure(name);
    return (fnTz as (n?: string, k?: boolean) => Moment | string | undefined).call(this, name, keepTime);
  } as typeof moment.fn.tz;
}
