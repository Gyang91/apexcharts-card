// Series names through hass.formatEntityName (RomRider PR #1104)
import { computeEntityName, entityNamesChanged } from '../src/entity-name';
import { computeName } from '../src/utils';
import { mkHass, mkState } from './fixtures/hass';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyHass = any;

const state = { ...mkState('sensor.living_room_temp', '21'), attributes: { friendly_name: 'Living room Temp' } };
const withFormatter = (version: string): AnyHass => ({
  ...mkHass(),
  config: { version },
  formatEntityName: vi.fn((_stateObj, name) => (Array.isArray(name) ? 'Living room Temperature' : 'Temperature')),
});

describe('computeEntityName', () => {
  it('uses the Home Assistant name from 2026.4', () => {
    const hass = withFormatter('2026.4.0');
    expect(computeEntityName(hass, state, undefined)).toBe('Temperature');
    expect(computeEntityName(hass, state, [{ type: 'area' }, { type: 'entity' }])).toBe('Living room Temperature');
    expect(computeEntityName(hass, state, '')).toBe('Temperature');
    expect(hass.formatEntityName).toHaveBeenLastCalledWith(state, undefined);
  });

  it('keeps a string name and falls back to friendly_name before 2026.4', () => {
    expect(computeEntityName(withFormatter('2026.4.1'), state, 'Mine')).toBe('Mine');
    expect(computeEntityName(withFormatter('2026.3.4'), state, [{ type: 'area' }])).toBe('Living room Temp');
    expect(computeEntityName(mkHass() as AnyHass, state, undefined)).toBe('Living room Temp');
    expect(computeEntityName(undefined, undefined, [{ type: 'area' }])).toBe('');
  });

  it('is used by computeName, with the offset suffix', () => {
    const series = [{ entity: state.entity_id, offset: '-1d', show: { offset_in_name: true } }];
    expect(computeName(withFormatter('2026.10.0'), 0, series as AnyHass, undefined, state)).toBe('Temperature (-1d)');
  });
});

describe('entityNamesChanged', () => {
  it('detects registry and formatter changes, not state changes', () => {
    const hass = withFormatter('2026.4.0');
    expect(entityNamesChanged(hass, { ...hass, states: {} })).toBe(false);
    expect(entityNamesChanged(hass, { ...hass, areas: {} })).toBe(true);
    expect(entityNamesChanged(hass, { ...hass, formatEntityName: vi.fn() })).toBe(true);
    expect(entityNamesChanged(undefined, hass)).toBe(false);
  });
});
