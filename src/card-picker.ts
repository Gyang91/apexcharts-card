// Card picker support: the stub config shown when the card is added, and the
// entity suggestions of the card picker preview.
import type { HomeAssistant } from 'custom-card-helpers';
import type { HassEntity } from 'home-assistant-js-websocket';
import type { ChartCardSeriesExternalConfig } from './types-config';

export function getStubConfig(hass: HomeAssistant, entities: string[], entitiesFallback: string[]) {
  const entityFilter = (stateObj: HassEntity): boolean => {
    return !isNaN(Number(stateObj.state));
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const _arrayFilter = (array: any[], conditions: Array<(value: any) => boolean>, maxSize: number) => {
    if (!maxSize || maxSize > array.length) {
      maxSize = array.length;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const filteredArray: any[] = [];

    for (let i = 0; i < array.length && filteredArray.length < maxSize; i++) {
      let meetsConditions = true;

      for (const condition of conditions) {
        if (!condition(array[i])) {
          meetsConditions = false;
          break;
        }
      }

      if (meetsConditions) {
        filteredArray.push(array[i]);
      }
    }

    return filteredArray;
  };
  const _findEntities = (
    hass: HomeAssistant,
    maxEntities: number,
    entities: string[],
    entitiesFallback: string[],
    includeDomains?: string[],
    entityFilter?: (stateObj: HassEntity) => boolean,
  ) => {
    const conditions: Array<(value: string) => boolean> = [];

    if (includeDomains?.length) {
      conditions.push((eid) => includeDomains!.includes(eid.split('.')[0]));
    }

    if (entityFilter) {
      conditions.push((eid) => hass.states[eid] && entityFilter(hass.states[eid]));
    }

    const entityIds = _arrayFilter(entities, conditions, maxEntities);

    if (entityIds.length < maxEntities && entitiesFallback.length) {
      const fallbackEntityIds = _findEntities(
        hass,
        maxEntities - entityIds.length,
        entitiesFallback,
        [],
        includeDomains,
        entityFilter,
      );

      entityIds.push(...fallbackEntityIds);
    }

    return entityIds;
  };
  const includeDomains = ['sensor'];
  const maxEntities = 2;

  const foundEntities = _findEntities(hass, maxEntities, entities, entitiesFallback, includeDomains, entityFilter);
  const conf = {
    header: { show: true, title: 'ApexCharts-Card', show_states: true, colorize_states: true },
    series: [] as ChartCardSeriesExternalConfig[],
  };
  if (foundEntities[0]) {
    conf.series[0] = {
      entity: foundEntities[0],
      data_generator: `// REMOVE ME
const now = new Date();
const data = [];
for(let i = 0; i <= 24; i++) {
data.push([now.getTime() - i * 1000 * 60 * 60, Math.floor((Math.random() * 10) + 1)])
}
return data.reverse();
`,
    };
  }
  if (foundEntities[1]) {
    conf.series[1] = {
      entity: foundEntities[1],
      type: 'column',
      data_generator: `// REMOVE ME
const now = new Date();
const data = [];
for(let i = 0; i <= 24; i++) {
data.push([now.getTime() - i * 1000 * 60 * 60, Math.floor((Math.random() * 10) + 1)])
}
return data.reverse();
`,
    };
  }
  return conf;
}
const NUMERIC_DOMAINS = ['counter', 'input_number', 'number'];

const isNumericEntity = (hass: HomeAssistant, entityId: string): boolean => {
  const domain = entityId.split('.')[0];
  if (NUMERIC_DOMAINS.includes(domain)) return true;
  if (domain !== 'sensor') return false;
  const stateObj = hass.states[entityId];
  if (!stateObj) return false;
  return !!stateObj.attributes.unit_of_measurement || !!stateObj.attributes.state_class;
};

const getEntitySuggestion = (hass: HomeAssistant, entityId: string) => {
  if (!isNumericEntity(hass, entityId)) return null;
  const stateClass = hass.states[entityId]?.attributes.state_class;
  if (stateClass === 'total' || stateClass === 'total_increasing') {
    return [
      {
        label: 'Last 7 days',
        config: {
          type: 'custom:apexcharts-card',
          graph_span: '7d',
          span: { end: 'day' },
          series: [{ entity: entityId, type: 'column', statistics: { type: 'change', period: 'day' } }],
        },
      },
      {
        label: 'Last 30 days',
        config: {
          type: 'custom:apexcharts-card',
          graph_span: '30d',
          span: { end: 'day' },
          series: [{ entity: entityId, type: 'column', statistics: { type: 'change', period: 'day' } }],
        },
      },
    ];
  }
  if (stateClass === 'measurement') {
    return [
      {
        label: 'Last 24 hours',
        config: {
          type: 'custom:apexcharts-card',
          graph_span: '24h',
          series: [{ entity: entityId, statistics: { type: 'mean', period: 'hour' } }],
        },
      },
      {
        label: 'Last 7 days',
        config: {
          type: 'custom:apexcharts-card',
          graph_span: '7d',
          span: { end: 'day' },
          series: [{ entity: entityId, statistics: { type: 'mean', period: 'day' } }],
        },
      },
    ];
  }
  return {
    config: {
      type: 'custom:apexcharts-card',
      graph_span: '24h',
      series: [{ entity: entityId, group_by: { func: 'avg' } }],
    },
  };
};

// Lists the card in the Lovelace card picker
export function registerCustomCard(): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).customCards = (window as any).customCards || [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).customCards.push({
    type: 'apexcharts-card',
    name: 'ApexCharts Card',
    preview: true,
    description: 'A graph card based on ApexCharts',
    documentationURL: 'https://github.com/foXaCe/apexcharts-card',
    getEntitySuggestion,
  });
}
