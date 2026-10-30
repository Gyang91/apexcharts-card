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

// Only coalesce identical requests while pending; successful history is not
// retained here. The connection boundary prevents cross-instance data sharing.
const pendingRequests = new WeakMap<object, Map<string, Promise<unknown>>>();

function request<T>(hass: HomeAssistant, message: { type: string; [key: string]: unknown }): Promise<T> {
  const connection = hass.connection ?? hass;
  let pending = pendingRequests.get(connection);
  if (!pending) {
    pending = new Map();
    pendingRequests.set(connection, pending);
  }
  const key = JSON.stringify(message);
  const existing = pending.get(key);
  if (existing) return existing as Promise<T>;
  const result = hass.callWS<T>(message);
  if (pending.size < 64) {
    pending.set(key, result);
    const remove = () => {
      if (pending.get(key) === result) pending.delete(key);
    };
    result.then(remove, remove);
  }
  return result;
}

export async function fetchHistory(
  hass: HomeAssistant | undefined,
  entityId: string,
  start: Date,
  end: Date,
  options: HistoryRequestOptions,
): Promise<HassHistoryEntry[] | undefined> {
  if (!hass) return undefined;
  const result = await request<Record<string, HassCompressedState[]>>(hass, {
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
    if (row.a) attributes = structuredClone(row.a);
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
const STATISTICS_CACHE_MAX_ENTRIES = 64;
const STATISTICS_CACHE_MAX_ROWS = 32000;

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
  const now = Date.now();
  for (const [key, entry] of cache) {
    if (now - entry.fetchedAt >= STATISTICS_CACHE_TTL_MS) cache.delete(key);
  }
  return cache;
}

function cacheStatistics(
  cache: Map<string, StatisticsCacheEntry> | undefined,
  key: string,
  entry: StatisticsCacheEntry,
): void {
  if (!cache) return;
  cache.delete(key);
  if (entry.rows.length > STATISTICS_CACHE_MAX_ROWS) return;
  let rows = entry.rows.length;
  for (const value of cache.values()) rows += value.rows.length;
  while (cache.size >= STATISTICS_CACHE_MAX_ENTRIES || rows > STATISTICS_CACHE_MAX_ROWS) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    rows -= cache.get(oldest)!.rows.length;
    cache.delete(oldest);
  }
  cache.set(key, entry);
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
    Number(cached.rows[cached.rows.length - 1].start) < end.getTime() &&
    now - cached.fetchedAt < STATISTICS_CACHE_TTL_MS
      ? cached
      : undefined;
  const from = reusable ? Number(reusable.rows[reusable.rows.length - 1].start) : start.getTime();

  const statistics = await request<Statistics>(hass, {
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
  cacheStatistics(cache, key, {
    from: reusable ? reusable.from : start.getTime(),
    fetchedAt: reusable ? reusable.fetchedAt : now,
    rows,
  });
  return rows.filter((row) => Number(row.end) > start.getTime() && Number(row.start) < end.getTime());
}

const statisticsMetadataCaches = new WeakMap<
  object,
  Map<
    string,
    {
      expiresAt: number;
      promise: Promise<StatisticsMetadata | undefined>;
    }
  >
>();

export function getStatisticsMetadata(
  hass: HomeAssistant | undefined,
  statisticId: string,
): Promise<StatisticsMetadata | undefined> {
  if (!hass) return Promise.resolve(undefined);
  const connection = hass.connection ?? hass;
  let cache = statisticsMetadataCaches.get(connection);
  if (!cache) {
    cache = new Map();
    statisticsMetadataCaches.set(connection, cache);
  }
  const now = Date.now();
  for (const [id, entry] of cache) {
    if (entry.expiresAt <= now) cache.delete(id);
  }
  let cached = cache.get(statisticId)?.promise;
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
        if (cache.get(statisticId)?.promise === cached) cache.delete(statisticId);
        return undefined;
      });
    if (cache.size >= STATISTICS_CACHE_MAX_ENTRIES) {
      const oldest = cache.keys().next().value;
      if (oldest !== undefined) cache.delete(oldest);
    }
    cache.set(statisticId, { expiresAt: now + STATISTICS_CACHE_TTL_MS, promise: cached });
  } else {
    const entry = cache.get(statisticId)!;
    cache.delete(statisticId);
    cache.set(statisticId, entry);
  }
  return cached;
}
