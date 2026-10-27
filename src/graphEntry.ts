import { HomeAssistant } from 'custom-card-helpers';
import {
  ChartCardSeriesConfig,
  EntityCachePoints,
  EntityEntryCache,
  HassHistoryEntry,
  HistoryBuckets,
  HistoryPoint,
  StatisticValue,
} from './types';
import { compileUserFunction, compress, decompress, isExternalStatisticId, log } from './utils';
import { fetchHistory, fetchStatistics } from './recorder';
import localForage from 'localforage';
import { HassEntity } from 'home-assistant-js-websocket';
import { DateRange } from 'moment-range';
import type { Moment } from 'moment-timezone';
import { DEFAULT_STATISTICS_PERIOD, DEFAULT_STATISTICS_TYPE, moment } from './const';
import parse from 'parse-duration';
import SparkMD5 from 'spark-md5';
import { ChartCardSpanExtConfig, StatisticsPeriod } from './types-config';
import * as pjson from '../package.json';

// Signatures of the user functions documented for `transform` and `data_generator`
type TransformFn = (x: unknown, hass: HomeAssistant | undefined, entity: unknown) => number | null;
type DataGeneratorFn = (
  entity: HassEntity | undefined,
  start: Date,
  end: Date,
  hass: HomeAssistant | undefined,
  momentLib: typeof moment,
) => Promise<EntityCachePoints>;

export default class GraphEntry {
  private _computedHistory?: EntityCachePoints;

  private _hass?: HomeAssistant;

  private _entityID: string;

  private _entityState?: HassEntity;

  private _updating = false;

  private _cache: boolean;

  // private _hoursToShow: number;

  private _graphSpan: number;

  private _useCompress = false;

  private _index: number;

  private _config: ChartCardSeriesConfig;

  private _func: (item: EntityCachePoints) => number;

  private _realStart: Date;

  private _realEnd: Date;

  private _groupByDurationMs: number;

  private _groupByOffsetMs: number;

  private _md5Config: string;

  // External statistic IDs (source:object_id) have no state object in
  // hass.states: everything relying on _entityState must be bypassed.
  private _isExternalStat: boolean;

  // Set when span padding is applied: the header/legend must keep showing the
  // last REAL value, not the trailing null padding points.
  private _lastRealState: number | null | undefined = undefined;

  // User functions from the config, compiled on first use
  private _transformFn?: TransformFn;

  private _dataGeneratorFn?: DataGeneratorFn;

  constructor(
    index: number,
    graphSpan: number,
    cache: boolean,
    config: ChartCardSeriesConfig,
    span: ChartCardSpanExtConfig | undefined,
  ) {
    const aggregateFuncMap = {
      avg: this._average,
      max: this._maximum,
      min: this._minimum,
      first: this._first,
      last: this._last,
      sum: this._sum,
      median: this._median,
      delta: this._delta,
      diff: this._diff,
    };
    this._index = index;
    this._cache = config.statistics ? false : cache;
    this._entityID = config.entity;
    this._isExternalStat = isExternalStatisticId(config.entity);
    this._graphSpan = graphSpan;
    this._config = config;
    this._func = aggregateFuncMap[config.group_by.func];
    this._realEnd = new Date();
    this._realStart = new Date();
    // Valid because tested during init;

    this._groupByDurationMs = parse(this._config.group_by.duration)!;
    this._groupByOffsetMs =
      ((parse(this._config.group_by.offset)! % this._groupByDurationMs) + this._groupByDurationMs) %
      this._groupByDurationMs; // Any possible offset is identiacal to one within [0, duration)
    this._md5Config = SparkMD5.hash(`${this._graphSpan}${JSON.stringify(this._config)}${JSON.stringify(span)}`);
  }

  set hass(hass: HomeAssistant) {
    this._hass = hass;
    this._entityState = this._hass.states[this._entityID];
  }

  get history(): EntityCachePoints {
    return this._computedHistory || [];
  }

  get index(): number {
    return this._index;
  }

  get start(): Date {
    return this._realStart;
  }

  get end(): Date {
    return this._realEnd;
  }

  // Attribute series and transforms (which receive the full history item)
  // need complete history rows; plain state series only need the states.
  private get _needsFullHistoryRows(): boolean {
    return !!(this._config.attribute || this._config.transform);
  }

  set cache(cache: boolean) {
    this._cache = this._config.statistics ? false : cache;
  }

  get lastState(): number | null {
    if (this._lastRealState !== undefined) return this._lastRealState;
    return this.history.length > 0 ? this.history[this.history.length - 1][1] : null;
  }

  public nowValue(now: number, before: boolean): number | null {
    if (this.history.length === 0) return null;
    const index = this.history.findIndex((point, index, arr) => {
      if (!before && point[0] > now) return true;
      if (before && point[0] < now && arr[index + 1] && arr[index + 1][0] > now) return true;
      return false;
    });
    if (index === -1) return null;
    return this.history[index][1];
  }

  get min(): number | undefined {
    if (!this._computedHistory || this._computedHistory.length === 0) return undefined;
    return Math.min(...this._computedHistory.flatMap((item) => (item[1] === null ? [] : [item[1]])));
  }

  get max(): number | undefined {
    if (!this._computedHistory || this._computedHistory.length === 0) return undefined;
    return Math.max(...this._computedHistory.flatMap((item) => (item[1] === null ? [] : [item[1]])));
  }

  public minMaxWithTimestamp(
    start: number,
    end: number,
    offset: number,
  ): { min: HistoryPoint; max: HistoryPoint } | undefined {
    if (!this._computedHistory || this._computedHistory.length === 0) return undefined;
    if (this._computedHistory.length === 1)
      return { min: [start, this._computedHistory[0][1]], max: [end, this._computedHistory[0][1]] };
    const minMax = this._computedHistory.reduce(
      (acc: { min: HistoryPoint; max: HistoryPoint }, point) => {
        if (point[1] === null) return acc;
        if (point[0] > end || point[0] < start) return acc;
        if (acc.max[1] === null || acc.max[1] < point[1]) acc.max = [...point];
        if (acc.min[1] === null || (point[1] !== null && acc.min[1] > point[1])) acc.min = [...point];
        return acc;
      },
      { min: [0, null], max: [0, null] },
    );
    if (offset) {
      if (minMax.min[0]) minMax.min[0] -= offset;
      if (minMax.max[0]) minMax.max[0] -= offset;
    }
    return minMax;
  }

  public minMaxWithTimestampForYAxis(start: number, end: number): { min: HistoryPoint; max: HistoryPoint } | undefined {
    if (!this._computedHistory || this._computedHistory.length === 0) return undefined;
    let lastTimestampBeforeStart = start;
    const lastHistoryIndexBeforeStart =
      this._computedHistory.findIndex((hist) => {
        return hist[0] >= start;
      }) - 1;
    if (lastHistoryIndexBeforeStart >= 0)
      lastTimestampBeforeStart = this._computedHistory[lastHistoryIndexBeforeStart][0];
    return this.minMaxWithTimestamp(lastTimestampBeforeStart, end, 0);
  }

  private async _getCache(key: string, compressed: boolean): Promise<EntityEntryCache | undefined> {
    const data: EntityEntryCache | undefined | null = await localForage.getItem(
      `${key}_${this._md5Config}${compressed ? '' : '-raw'}`,
    );
    return data ? (compressed ? decompress(data) : data) : undefined;
  }

  private async _setCache(
    key: string,
    data: EntityEntryCache,
    compressed: boolean,
  ): Promise<string | EntityEntryCache> {
    return compressed
      ? localForage.setItem(`${key}_${this._md5Config}`, compress(data))
      : localForage.setItem(`${key}_${this._md5Config}-raw`, data);
  }

  public async _updateHistory(start: Date, end: Date): Promise<boolean> {
    if ((!this._entityState && !this._isExternalStat) || this._updating) return false;
    this._updating = true;
    // Always release the lock: a failed fetch must not freeze this series
    // until the page is reloaded.
    try {
      return await this._computeHistory(start, end);
    } finally {
      this._updating = false;
    }
  }

  private async _computeHistory(start: Date, end: Date): Promise<boolean> {
    let startHistory = new Date(start);
    if (this._config.group_by.func !== 'raw') {
      const range = end.getTime() - start.getTime() + this._groupByOffsetMs;
      const nbBuckets = Math.ceil(range / this._groupByDurationMs);
      startHistory = new Date(end.getTime() + this._groupByOffsetMs - nbBuckets * this._groupByDurationMs);
    }
    this._lastRealState = undefined;

    // ignore_history is never set for statistics series (hence never for
    // external statistic IDs), so _entityState is always defined here.
    if (this._config.ignore_history && this._entityState) {
      let currentState: null | number | string;
      if (this._config.attribute) {
        currentState = this._entityState.attributes?.[this._config.attribute];
      } else {
        currentState = this._entityState.state;
      }
      if (this._config.transform) {
        currentState = this._applyTransform(currentState, this._entityState);
      }
      let stateParsed: number | null = parseFloat(currentState as string);
      stateParsed = !Number.isNaN(stateParsed) ? stateParsed : null;
      this._computedHistory = [[new Date(this._entityState.last_updated).getTime(), stateParsed]];
      return true;
    }

    let history: EntityEntryCache | undefined;

    if (this._config.data_generator) {
      history = await this._generateData(start, end);
    } else {
      this._realStart = new Date(start);
      this._realEnd = new Date(end);

      let skipInitialState = false;

      history = this._cache ? await this._getCache(this._entityID, this._useCompress) : undefined;

      if (history && history.span === this._graphSpan) {
        const currDataIndex = history.data.findIndex(
          (item) => item && new Date(item[0]).getTime() > startHistory.getTime(),
        );
        if (currDataIndex !== -1) {
          // skip initial state when fetching recent/not-cached data
          skipInitialState = true;
        }
        if (currDataIndex > 4) {
          // >4 so that the graph has some more history
          history.data = history.data.slice(currDataIndex === 0 ? 0 : currDataIndex - 4);
        } else if (currDataIndex === -1) {
          // there was no state which could be used in current graph so clearing
          history.data = [];
        }
      } else {
        history = undefined;
      }
      const usableCache = !!(
        history &&
        history.data &&
        history.data.length !== 0 &&
        history.data[history.data.length - 1]
      );

      // if data in cache, get data from last data's time + 1ms
      const fetchStart = usableCache
        ? new Date(history!.data[history!.data.length - 1][0] + 1)
        : new Date(startHistory.getTime() + (this._config.group_by.func !== 'raw' ? 0 : -1));
      const fetchEnd = end;

      let newStateHistory: EntityCachePoints = [];
      let updateGraphHistory = false;

      if (this._config.statistics) {
        const newHistory = await fetchStatistics(
          this._hass,
          this._entityID,
          fetchStart,
          fetchEnd,
          this._config.statistics.period,
        );
        if (newHistory && newHistory.length > 0) {
          updateGraphHistory = true;

          let prevItem: StatisticValue | null = null;
          const newFilledHistory: StatisticValue[] = [];
          newHistory.forEach((item) => {
            if (prevItem) {
              const step = Number(item.end) - Number(item.start);
              let currentStart = Number(prevItem.end);
              const targetEnd = Number(item.start);
              while (currentStart < targetEnd && step > 0) {
                const currentEnd = Math.min(currentStart + step, targetEnd);
                newFilledHistory.push({
                  statistic_id: prevItem.statistic_id,
                  start: currentStart.toString(),
                  end: currentEnd.toString(),
                  last_reset: null,
                  max: null,
                  mean: null,
                  min: null,
                  sum: null,
                  state: null,
                  change: null,
                });
                currentStart = currentEnd;
              }
            }
            newFilledHistory.push(item);
            prevItem = item;
          });

          let lastNonNull: number | null = null;
          if (history && history.data && history.data.length > 0) {
            lastNonNull = history.data[history.data.length - 1][1];
          }
          newStateHistory = newFilledHistory.map((item) => {
            let stateParsed: number | null;
            [lastNonNull, stateParsed] = this._transformAndFill(
              item[this._config.statistics?.type || DEFAULT_STATISTICS_TYPE],
              item,
              lastNonNull,
            );

            return [
              this._statDisplayDate(Number(item.start), Number(item.end)),
              !Number.isNaN(stateParsed) ? stateParsed : null,
            ];
          });

          // Column widths in ApexCharts derive from the smallest gap between
          // consecutive points: a single (or irregular) statistics bucket makes
          // the column span (almost) the whole graph. Since the bucket interval
          // is known by construction, pad the whole [start, end] span with
          // empty ([ts, null]) buckets so the spacing is always regular.
          // group_by (non-raw) series are already padded by _dataBucketer.
          if (this._config.type === 'column' && this._config.group_by.func === 'raw') {
            this._lastRealState = newStateHistory.length ? newStateHistory[newStateHistory.length - 1][1] : null;
            newStateHistory = this._padStatisticsSpan(newStateHistory, newHistory, start, end);
          }
        }
      } else {
        const newHistory = await fetchHistory(this._hass, this._entityID, fetchStart, fetchEnd, {
          includeStartState: this._needsFullHistoryRows || !skipInitialState,
          minimal: !this._needsFullHistoryRows,
        });
        if (newHistory && newHistory.length > 0) {
          updateGraphHistory = true;
          /*
          hack because HA doesn't return anything if skipInitialState is false
          when retrieving for attributes so we retrieve it and we remove it.
          */
          if (this._needsFullHistoryRows && skipInitialState) {
            newHistory.shift();
          }
          let lastNonNull: number | null = null;
          if (history && history.data && history.data.length > 0) {
            lastNonNull = history.data[history.data.length - 1][1];
          }
          newStateHistory = newHistory.map((item) => {
            let currentState: unknown = null;
            if (this._config.attribute) {
              if (item.attributes && item.attributes[this._config.attribute] !== undefined) {
                currentState = item.attributes[this._config.attribute];
              }
            } else {
              currentState = item.state;
            }
            let stateParsed: number | null;
            [lastNonNull, stateParsed] = this._transformAndFill(currentState, item, lastNonNull);

            if (this._config.attribute) {
              return [new Date(item.last_updated).getTime(), !Number.isNaN(stateParsed) ? stateParsed : null];
            } else {
              return [new Date(item.last_changed).getTime(), !Number.isNaN(stateParsed) ? stateParsed : null];
            }
          });
        }
      }

      if (updateGraphHistory) {
        if (history?.data.length) {
          history.span = this._graphSpan;
          history.last_fetched = new Date();
          history.card_version = pjson.version;
          if (history.data.length !== 0) {
            history.data.push(...newStateHistory);
          }
        } else {
          history = {
            span: this._graphSpan,
            card_version: pjson.version,
            last_fetched: new Date(),
            data: newStateHistory,
          };
        }

        if (this._cache) {
          await this._setCache(this._entityID, history, this._useCompress).catch((err) => {
            log(err);
            localForage.clear();
          });
        }
      }
    }

    if (!history || history.data.length === 0) {
      this._computedHistory = undefined;
      return false;
    }
    if (this._config.group_by.func !== 'raw') {
      const res: EntityCachePoints = this._dataBucketer(history, moment.range(startHistory, end)).map((bucket) => {
        return [bucket.timestamp, this._func(bucket.data)];
      });
      if ([undefined, 'line', 'area'].includes(this._config.type)) {
        while (res.length > 0 && res[0][1] === null) res.shift();
      }
      this._computedHistory = res;
    } else {
      this._computedHistory = history.data;
    }
    return true;
  }

  // Display timestamp of a statistics bucket according to `statistics.align`.
  // Recorder API buckets carry epoch-ms start/end (internal gap fillers store
  // them as numeric strings, hence the Number() at the call sites).
  private _statDisplayDate(startMs: number, endMs: number): number {
    const align = this._config.statistics?.align || 'middle';
    if (align === 'start') return startMs;
    if (align === 'end') return endMs;
    const period = this._config.statistics?.period;
    if (period === '5minute') return startMs + 150000; // 2min30s
    if (!period || period === 'hour') return startMs + 1800000; // 30min
    if (period === 'day') return startMs + 43200000; // 12h
    if (period === 'week') return startMs + 259200000; // 3.5d
    return startMs + 1296000000; // 15d
  }

  // Pad the whole [start, end] span with [ts, null] points at every statistics
  // bucket boundary that carries no data, so ApexCharts always sees a constant
  // interval between points (correct column width even with a single bucket).
  // Boundaries are anchored on the real API bucket timestamps and extended with
  // moment calendar arithmetic, which follows local DST transitions for
  // day/week/month periods instead of assuming fixed-length periods.
  private _padStatisticsSpan(
    points: EntityCachePoints,
    stats: StatisticValue[],
    start: Date,
    end: Date,
  ): EntityCachePoints {
    if (points.length === 0 || stats.length === 0) return points;
    const period = this._config.statistics?.period || DEFAULT_STATISTICS_PERIOD;
    const UNITS: Record<StatisticsPeriod, [number, 'minute' | 'hour' | 'day' | 'week' | 'month']> = {
      '5minute': [5, 'minute'],
      hour: [1, 'hour'],
      day: [1, 'day'],
      week: [1, 'week'],
      month: [1, 'month'],
    };
    const [amount, unit] = UNITS[period];
    // Safety net against pathological spans (e.g. misconfigured graph_span)
    const MAX_PADDING_POINTS = 5000;
    const padded = [...points];

    // Backward from the first real bucket start down to the graph start
    let curEnd: Moment = moment(Number(stats[0].start));
    let guard = 0;
    while (curEnd.valueOf() > start.getTime() && guard++ < MAX_PADDING_POINTS) {
      const curStart = curEnd.clone().subtract(amount, unit);
      padded.unshift([this._statDisplayDate(curStart.valueOf(), curEnd.valueOf()), null]);
      curEnd = curStart;
    }

    // Forward from the last real bucket end up to the graph end
    let curStart: Moment = moment(Number(stats[stats.length - 1].end));
    guard = 0;
    while (curStart.valueOf() < end.getTime() && guard++ < MAX_PADDING_POINTS) {
      const nextEnd = curStart.clone().add(amount, unit);
      padded.push([this._statDisplayDate(curStart.valueOf(), nextEnd.valueOf()), null]);
      curStart = nextEnd;
    }

    return padded;
  }

  private _transformAndFill(
    currentState: unknown,
    item: HassHistoryEntry | StatisticValue,
    lastNonNull: number | null,
  ): [number | null, number | null] {
    if (this._config.transform) {
      currentState = this._applyTransform(currentState, item);
    }
    let stateParsed: number | null = parseFloat(currentState as string);
    stateParsed = !Number.isNaN(stateParsed) ? stateParsed : null;
    if (stateParsed === null) {
      if (this._config.fill_raw === 'zero') {
        stateParsed = 0;
      } else if (this._config.fill_raw === 'last') {
        stateParsed = lastNonNull;
      }
    } else {
      lastNonNull = stateParsed;
    }
    return [lastNonNull, stateParsed];
  }

  private _applyTransform(value: unknown, historyItem: HassHistoryEntry | StatisticValue): number | null {
    this._transformFn ??= compileUserFunction<TransformFn>(['x', 'hass', 'entity'], this._config.transform!);
    return this._transformFn.call(this, value, this._hass, historyItem);
  }

  private async _generateData(start: Date, end: Date): Promise<EntityEntryCache> {
    let data;
    try {
      this._dataGeneratorFn ??= compileUserFunction<DataGeneratorFn>(
        ['entity', 'start', 'end', 'hass', 'moment'],
        this._config.data_generator!,
        true,
      );
      data = await this._dataGeneratorFn(this._entityState, start, end, this._hass, moment);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (e: any) {
      const funcTrimmed =
        this._config.data_generator!.length <= 100
          ? this._config.data_generator!.trim()
          : `${this._config.data_generator!.trim().substring(0, 98)}...`;
      e.message = `${e.name}: ${e.message} in '${funcTrimmed}'`;
      e.name = 'Error';
      throw e;
    }
    return {
      span: 0,
      card_version: pjson.version,
      last_fetched: new Date(),
      data,
    };
  }

  private _dataBucketer(history: EntityEntryCache, timeRange: DateRange): HistoryBuckets {
    timeRange.end.add(this._groupByOffsetMs, 'ms');
    const ranges = Array.from(timeRange.reverseBy('milliseconds', { step: this._groupByDurationMs })).reverse();
    // const res: EntityCachePoints[] = [[]];
    const buckets: HistoryBuckets = [];
    ranges.forEach((range, index) => {
      buckets[index] = { timestamp: range.valueOf(), data: [] };
    });
    history?.data.forEach((entry) => {
      buckets.some((bucket, index) => {
        if (bucket.timestamp > entry[0] && index > 0) {
          if (entry[0] >= buckets[index - 1].timestamp) {
            buckets[index - 1].data.push(entry);
            return true;
          }
        }
        return false;
      });
    });
    let lastNonNullBucketValue: number | null = null;
    const now = new Date().getTime();
    buckets.forEach((bucket, index) => {
      if (bucket.data.length === 0) {
        if (this._config.group_by.fill === 'last' && (bucket.timestamp <= now || this._config.data_generator)) {
          bucket.data[0] = [bucket.timestamp, lastNonNullBucketValue];
        } else if (this._config.group_by.fill === 'zero' && (bucket.timestamp <= now || this._config.data_generator)) {
          bucket.data[0] = [bucket.timestamp, 0];
        } else if (this._config.group_by.fill === 'null') {
          bucket.data[0] = [bucket.timestamp, null];
        }
      } else {
        lastNonNullBucketValue = bucket.data.slice(-1)[0][1];
      }
      if (this._config.group_by.start_with_last) {
        if (index > 0) {
          if (bucket.data.length === 0 || bucket.data[0][0] !== bucket.timestamp) {
            const prevBucketData = buckets[index - 1].data;
            bucket.data.unshift([bucket.timestamp, prevBucketData[prevBucketData.length - 1][1]]);
          }
        } else {
          const firstIndexAfter = history.data.findIndex((entry) => {
            if (entry[0] > bucket.timestamp) return true;
            return false;
          });
          if (firstIndexAfter > 0) {
            bucket.data.unshift([bucket.timestamp, history.data[firstIndexAfter - 1][1]]);
          }
        }
      }
    });
    buckets.shift();
    buckets.pop();
    // Remove nulls at the end
    while (
      buckets.length > 0 &&
      (buckets[buckets.length - 1].data.length === 0 ||
        (buckets[buckets.length - 1].data.length === 1 && buckets[buckets.length - 1].data[0][1] === null))
    ) {
      buckets.pop();
    }
    return buckets;
  }

  private _sum(items: EntityCachePoints): number {
    if (items.length === 0) return 0;
    let lastIndex = 0;
    return items.reduce((sum, entry, index) => {
      let val: number;
      if (entry && entry[1] === null) {
        val = items[lastIndex][1]!;
      } else {
        val = entry[1]!;
        lastIndex = index;
      }
      return sum + val;
    }, 0);
  }

  private _average(items: EntityCachePoints): number | null {
    const nonNull = this._filterNulls(items);
    if (nonNull.length === 0) return null;
    return this._sum(nonNull) / nonNull.length;
  }

  private _minimum(items: EntityCachePoints): number | null {
    let min: number | null = null;
    items.forEach((item) => {
      if (item[1] !== null)
        if (min === null) min = item[1];
        else min = Math.min(item[1], min);
    });
    return min;
  }

  private _maximum(items: EntityCachePoints): number | null {
    let max: number | null = null;
    items.forEach((item) => {
      if (item[1] !== null)
        if (max === null) max = item[1];
        else max = Math.max(item[1], max);
    });
    return max;
  }

  private _last(items: EntityCachePoints): number | null {
    if (items.length === 0) return null;
    return items.slice(-1)[0][1];
  }

  private _first(items: EntityCachePoints): number | null {
    if (items.length === 0) return null;
    return items[0][1];
  }

  private _median(items: EntityCachePoints) {
    const itemsDup = this._filterNulls([...items]).sort((a, b) => a[1]! - b[1]!);
    if (itemsDup.length === 0) return null;
    if (itemsDup.length === 1) return itemsDup[0][1];
    const mid = Math.floor((itemsDup.length - 1) / 2);
    if (itemsDup.length % 2 === 1) return itemsDup[mid][1];

    return (itemsDup[mid][1]! + itemsDup[mid + 1][1]!) / 2;
  }

  private _delta(items: EntityCachePoints): number | null {
    const max = this._maximum(items);
    const min = this._minimum(items);
    return max === null || min === null ? null : max - min;
  }

  private _diff(items: EntityCachePoints): number | null {
    const noNulls = this._filterNulls(items);
    const first = this._first(noNulls);
    const last = this._last(noNulls);
    if (first === null || last === null) {
      return null;
    }
    return last - first;
  }

  private _filterNulls(items: EntityCachePoints): EntityCachePoints {
    return items.filter((item) => item[1] !== null);
  }
}
