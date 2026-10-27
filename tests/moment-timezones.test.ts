// moment.tz() for user code, with zone data built from the browser's rules
// (offsets, DST dates) and the IANA abbreviation eras of zone-abbreviations.ts.
import { readFileSync } from 'node:fs';
import MomentTz from 'moment-timezone/moment-timezone';
import data from 'moment-timezone/data/packed/latest.json';
import { moment } from '../src/const';
import { packZone } from '../src/moment-timezones';
import { zoneOffset } from '../src/zone';
// @ts-expect-error plain JavaScript build script
import { buildZoneAbbreviations } from '../scripts/build-zone-abbreviations.mjs';

interface Unpacked {
  abbrs: string[];
  offsets: number[];
  untils: number[];
}
const unpack = (packed: string): Unpacked => MomentTz.tz.unpack(packed) as unknown as Unpacked;
const at = (zone: Unpacked, ts: number) => {
  let i = 0;
  while (zone.untils[i] <= ts) i++;
  return { offset: zone.offsets[i], abbr: zone.abbrs[i] };
};

describe('zone abbreviation table', () => {
  it('is up to date with the installed moment-timezone data (else: npm run build:zone-abbreviations)', () => {
    expect(readFileSync('src/zone-abbreviations.ts', 'utf8')).toBe(buildZoneAbbreviations());
  });
});

describe('zones generated from the browser, every zone and alias, 1970-2037', () => {
  const FROM = Date.UTC(1970, 0, 1);
  const TO = Date.UTC(2037, 0, 1);
  const zones = new Map<string, string>();
  for (const packed of data.zones as string[]) zones.set(packed.split('|')[0], packed);
  for (const link of data.links as string[]) {
    const [target, alias] = link.split('|');
    const packed = zones.get(target);
    if (packed) zones.set(alias, alias + packed.slice(target.length));
  }

  it('the browser knows every zone, offsets follow its rules and names match the IANA database', () => {
    const offsetErrors: string[] = [];
    const nameErrors: string[] = [];
    for (const [name, packed] of zones) {
      const generated = packZone(name);
      expect(generated, name).toBeDefined();
      const ours = unpack(generated!);
      const iana = unpack(packed);
      const checks = new Set<number>([FROM]);
      for (const until of [...ours.untils, ...iana.untils]) {
        if (until > FROM && until < TO) [until - 1, until, until + 1].forEach((ts) => checks.add(ts));
      }
      for (const ts of checks) {
        const mine = at(ours, ts);
        // Offsets: exactly the browser's (whatever its tz data version)
        const browser = -Math.round(zoneOffset(ts, name) / 1000) / 60;
        if (mine.offset !== browser) offsetErrors.push(`${name} ${new Date(ts).toISOString()}`);
        // Names: the IANA database's, wherever its offset agrees
        const theirs = at(iana, ts);
        if (theirs.offset === mine.offset && theirs.abbr !== mine.abbr) {
          nameErrors.push(`${name} ${new Date(ts).toISOString()} ${theirs.abbr} != ${mine.abbr}`);
        }
      }
    }
    expect(offsetErrors.slice(0, 10)).toEqual([]);
    expect(nameErrors.slice(0, 10)).toEqual([]);
  }, 300000);
});

describe('moment.tz() given to data_generator', () => {
  it('converts, parses and formats in a time zone, across DST changes', () => {
    const ts = Date.parse('2026-07-01T12:00:00Z');
    expect(moment(ts).tz('Europe/Berlin').format('YYYY-MM-DD HH:mm Z z')).toBe('2026-07-01 14:00 +02:00 CEST');
    expect(moment(ts).tz('Asia/Kathmandu').format('HH:mm Z z')).toBe('17:45 +05:45 +0545');
    expect(moment.tz('2026-01-15 08:00', 'America/New_York').toISOString()).toBe('2026-01-15T13:00:00.000Z');
    // Adding a day across the change keeps the wall-clock time
    expect(moment.tz('2026-10-24 12:00', 'Europe/Berlin').add(1, 'day').format('HH:mm z')).toBe('12:00 CET');
  });

  it('knows aliases, zone names and unknown zones like before', () => {
    expect(moment.tz.zone('US/Eastern')?.name).toBe('US/Eastern');
    expect(moment.tz('2026-07-01 12:00', 'US/Eastern').format('z')).toBe('EDT');
    expect(moment.tz.names()).toContain('Europe/Berlin');
    expect(moment.tz.zone('Not/AZone')).toBeNull();
  });

  it('honours settings and the default zone', () => {
    moment.tz.setDefault('Asia/Tokyo');
    try {
      expect(moment(Date.parse('2026-07-01T00:00:00Z')).format('HH:mm z')).toBe('09:00 JST');
    } finally {
      moment.tz.setDefault();
    }
    // A setting written through moment.tz reaches moment-timezone itself
    const before = moment.tz.moveAmbiguousForward;
    moment.tz.moveAmbiguousForward = !before;
    expect(MomentTz.tz.moveAmbiguousForward).toBe(!before);
    moment.tz.moveAmbiguousForward = before;
  });
});
