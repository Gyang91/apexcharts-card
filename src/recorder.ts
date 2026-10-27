// Data access to Home Assistant's recorder: recent history, long-term
// statistics and their metadata. Owns the websocket message shapes and wire
// formats so the rest of the card only deals with plain typed values.
import type { HomeAssistant } from 'custom-card-helpers';
import { DEFAULT_STATISTICS_PERIOD } from './const';
import type { HassCompressedState, HassHistoryEntry, Statistics, StatisticsMetadata, StatisticValue } from './types';
import type { StatisticsPeriod } from './types-config';

export interface HistoryRequestOptions {
  // Include the state the entity had at `start` (as the first row)
  readonly includeStartState: boolean;
  // Drop attributes and attribute-only rows: enough for plain state series
  readonly minimal: boolean;
}

export async function fetchHistory(
  hass: HomeAssistant | undefined,
  entityId: string,
  start: Date,
  end: Date,
  options: HistoryRequestOptions,
): Promise<HassHistoryEntry[] | undefined> {
  if (!hass) return undefined;
  const result = await hass.callWS<Record<string, HassCompressedState[]>>({
    type: 'history/history_during_period',
    start_time: start.toISOString(),
    end_time: end.toISOString(),
    entity_ids: [entityId],
    include_start_time_state: options.includeStartState,
    significant_changes_only: false,
    minimal_response: options.minimal,
    no_attributes: options.minimal,
  });
  const rows = result?.[entityId];
  return rows ? decompressHistory(entityId, rows) : undefined;
}

// Expand compressed rows (epoch seconds, `lc` omitted when equal to `lu`) to
// the history entry shape exposed to `transform`.
function decompressHistory(entityId: string, rows: HassCompressedState[]): HassHistoryEntry[] {
  let attributes: HassHistoryEntry['attributes'];
  return rows.map((row) => {
    // Carry attributes forward should a row omit them
    if (row.a) attributes = row.a;
    return {
      entity_id: entityId,
      state: row.s,
      attributes,
      last_changed: new Date((row.lc ?? row.lu) * 1000).toISOString(),
      last_updated: new Date(row.lu * 1000).toISOString(),
    };
  });
}

export async function fetchStatistics(
  hass: HomeAssistant | undefined,
  statisticId: string,
  start: Date,
  end: Date,
  period: StatisticsPeriod = DEFAULT_STATISTICS_PERIOD,
): Promise<StatisticValue[] | undefined> {
  if (!hass) return undefined;
  const statistics = await hass.callWS<Statistics>({
    type: 'recorder/statistics_during_period',
    start_time: start.toISOString(),
    end_time: end.toISOString(),
    statistic_ids: [statisticId],
    period,
  });
  return statistics?.[statisticId];
}

const statisticsMetadataCache: Map<string, Promise<StatisticsMetadata | undefined>> = new Map();

export function getStatisticsMetadata(
  hass: HomeAssistant | undefined,
  statisticId: string,
): Promise<StatisticsMetadata | undefined> {
  if (!hass) return Promise.resolve(undefined);
  let cached = statisticsMetadataCache.get(statisticId);
  if (!cached) {
    cached = hass
      .callWS<StatisticsMetadata[]>({
        type: 'recorder/get_statistics_metadata',
        statistic_ids: [statisticId],
      })
      .then((metadata) =>
        Array.isArray(metadata) ? metadata.find((item) => item.statistic_id === statisticId) : undefined,
      )
      .catch(() => {
        statisticsMetadataCache.delete(statisticId);
        return undefined;
      });
    statisticsMetadataCache.set(statisticId, cached);
  }
  return cached;
}
