import { HomeAssistant } from 'custom-card-helpers';
import { HassEntity } from 'home-assistant-js-websocket';
import { EntityName } from './types-config';

function atLeastVersion(hass: HomeAssistant, major: number, minor: number): boolean {
  const [haMajor, haMinor] = (hass.config?.version ?? '').split('.', 2).map(Number);
  return haMajor > major || (haMajor === major && haMinor >= minor);
}

type HassWithEntityNames = HomeAssistant & {
  formatEntityName: (stateObj: HassEntity, name: EntityName | undefined) => string;
};

/**
 * `hass.formatEntityName` accepts a series' `name` option (a string, a
 * structured name or undefined) from Home Assistant 2026.4. Earlier versions
 * have the helper with other signatures, so the version is checked too.
 */
function supportsEntityNames(hass: HomeAssistant | undefined): hass is HassWithEntityNames {
  return (
    !!hass &&
    typeof (hass as Partial<HassWithEntityNames>).formatEntityName === 'function' &&
    atLeastVersion(hass, 2026, 4)
  );
}

/**
 * The name Home Assistant shows for an entity, composed from its entity,
 * device, area and floor like the built-in cards. A string `name` wins; a
 * structured `name` falls back to the friendly name on older versions.
 */
export function computeEntityName(
  hass: HomeAssistant | undefined,
  stateObj: HassEntity | undefined,
  name: EntityName | undefined,
): string {
  // An empty name has always meant "use Home Assistant's name"
  if (typeof name === 'string' && name !== '') return name;
  if (!stateObj) return '';
  if (supportsEntityNames(hass)) {
    // The formatter is a moving frontend API: a throw would blank the whole
    // card and an empty result would leave the series unnamed, so fall back.
    try {
      const formatted = hass.formatEntityName(stateObj, name || undefined);
      if (formatted) return formatted;
    } catch {
      // fall through to the friendly name
    }
  }
  return friendlyName(stateObj);
}

function friendlyName(stateObj: HassEntity): string {
  return stateObj.attributes?.friendly_name || stateObj.entity_id || '';
}

/**
 * Name of an external statistic. It is not a Home Assistant entity (no
 * registry entry, device or area), so Home Assistant's formatter is not asked:
 * the card's own state object carries the recorder metadata name.
 */
export function computeStatisticName(stateObj: HassEntity | undefined, name: EntityName | undefined): string {
  if (typeof name === 'string' && name !== '') return name;
  return stateObj ? friendlyName(stateObj) : '';
}

// Inputs of formatEntityName that change without an entity state change: a
// device or area rename, or HA swapping in the real formatter after loading.
const NAME_SOURCES = ['formatEntityName', 'entities', 'devices', 'areas', 'floors'] as const;

export function entityNamesChanged(oldHass: HomeAssistant | undefined, newHass: HomeAssistant | undefined): boolean {
  if (!oldHass || !newHass) return false;
  const before = oldHass as unknown as Record<string, unknown>;
  const after = newHass as unknown as Record<string, unknown>;
  return NAME_SOURCES.some((key) => before[key] !== after[key]);
}
