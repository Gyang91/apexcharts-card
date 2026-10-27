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

// Recent statistics, shared by every card on the page: a dashboard rebuilds a
// card each time it is shown again (tabs, visibility conditions), and long
// periods are slow to query. Closed periods do not change, so within the TTL
// only the last cached period (possibly still open) onwards is asked again.
// After the TTL everything is fetched anew, which also picks up statistics
// imported later for past periods.
const STATISTICS_CACHE_TTL_MS = 10 * 60 * 1000;

interface StatisticsCacheEntry {
  from: number; // start of the range the rows cover
  fetchedAt: number; // time of the last full fetch
  rows: StatisticValue[];
}

// One cache per Home Assistant connection
const statisticsCaches: WeakMap<object, Map<string, StatisticsCacheEntry>> = new WeakMap();

function statisticsCacheFor(hass: HomeAssistant): Map<string, StatisticsCacheEntry> | undefined {
  const connection = hass.connection as object | undefined;
  if (!connection) return undefined;
  let cache = statisticsCaches.get(connection);
  if (!cache) {
    cache = new Map();
    statisticsCaches.set(connection, cache);
  }
  return cache;
}

export async function fetchStatistics(
  hass: HomeAssistant | undefined,
  statisticId: string,
  start: Date,
  end: Date,
  period: StatisticsPeriod = DEFAULT_STATISTICS_PERIOD,
): Promise<StatisticValue[] | undefined> {
  if (!hass) return undefined;
  const cache = statisticsCacheFor(hass);
  const key = `${statisticId}|${period}`;
  const now = Date.now();
  const cached = cache?.get(key);
  const reusable =
    cached &&
    cached.rows.length > 0 &&
    cached.from <= start.getTime() &&
    now - cached.fetchedAt < STATISTICS_CACHE_TTL_MS
      ? cached
      : undefined;
  const from = reusable ? Number(reusable.rows[reusable.rows.length - 1].start) : start.getTime();

  const statistics = await hass.callWS<Statistics>({
    type: 'recorder/statistics_during_period',
    start_time: new Date(from).toISOString(),
    end_time: end.toISOString(),
    statistic_ids: [statisticId],
    period,
  });
  const fresh = statistics?.[statisticId] ?? [];
  if (!reusable && fresh.length === 0) return statistics?.[statisticId];

  const rows = reusable
    ? [...reusable.rows.filter((row) => Number(row.start) < from), ...fresh.filter((row) => Number(row.start) >= from)]
    : fresh;
  cache?.set(key, {
    from: reusable ? reusable.from : start.getTime(),
    fetchedAt: reusable ? reusable.fetchedAt : now,
    rows,
  });
  return rows.filter((row) => Number(row.end) > start.getTime() && Number(row.start) < end.getTime());
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
