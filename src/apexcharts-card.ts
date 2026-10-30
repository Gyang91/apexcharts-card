import { LitElement, html, TemplateResult, PropertyValues, CSSResultGroup } from 'lit';
import { property, customElement, eventOptions } from 'lit/decorators.js';
import { ifDefined } from 'lit/directives/if-defined.js';
import { ClassInfo, classMap } from 'lit/directives/class-map.js';
import {
  ChartCardConfig,
  ChartCardSeriesConfig,
  ChartCardYAxis,
  EntityCachePoints,
  EntityEntryCache,
  HistoryPoint,
  minmax_type,
  StatisticsMetadata,
  ActionHandlerDetail,
} from './types';
import { handleAction, HomeAssistant } from 'custom-card-helpers';
import localForage from 'localforage';
import * as pjson from '../package.json';
import {
  computeColor,
  computeColors,
  computeName,
  computeTextColor,
  computeUom,
  decompress,
  formatApexDate,
  getLang,
  getPercentFromValue,
  interpolateColor,
  is12Hour,
  isExternalStatisticId,
  log,
  mergeConfigTemplates,
  mergeDeep,
  mergeDeepConfig,
  myFormatNumber,
  offsetData,
  prettyPrintTime,
  truncateFloat,
  validateInterval,
  validateOffset,
  getLovelace,
  isUsingServerTimezone,
} from './utils';
import { getStatisticsMetadata } from './recorder';
import { displayTimeZone } from './calendar';
import { computeTimezoneDiffWithLocal, endOf, startOf } from './zone';
import ApexCharts from 'apexcharts';
import type { ApexOptions, ApexYAxis } from 'apexcharts';
import { Ripple } from '@material/mwc-ripple';
import { stylesApex } from './styles';
import { HassEntity } from 'home-assistant-js-websocket';
import { getBrushLayoutConfig, getLayoutConfig } from './apex-layouts';
import GraphEntry from './graphEntry';
import { createCheckers } from 'ts-interface-checker';
import {
  ActionsConfig,
  ChartCardColorThreshold,
  ChartCardExternalConfig,
  ChartCardSeriesExternalConfig,
} from './types-config';
import exportedTypeSuite from './types-config-ti';
import {
  DEFAULT_AREA_OPACITY,
  DEFAULT_FILL_RAW,
  DEFAULT_FLOAT_PRECISION,
  DEFAULT_SHOW_IN_CHART,
  DEFAULT_SHOW_IN_HEADER,
  DEFAULT_SHOW_IN_LEGEND,
  DEFAULT_SHOW_LEGEND_VALUE,
  DEFAULT_SHOW_NAME_IN_HEADER,
  DEFAULT_SHOW_NULL_IN_HEADER,
  DEFAULT_SHOW_ZERO_IN_HEADER,
  DEFAULT_SHOW_OFFSET_IN_NAME,
  DEFAULT_UPDATE_DELAY,
  NO_VALUE,
  PLAIN_COLOR_TYPES,
  TIMESERIES_TYPES,
} from './const';
import {
  DEFAULT_COLORS,
  DEFAULT_DURATION,
  DEFAULT_OFFSET,
  DEFAULT_FUNC,
  DEFAULT_GROUP_BY_FILL,
  DEFAULT_GRAPH_SPAN,
  DEFAULT_SERIE_TYPE,
  HOUR_24,
} from './const';
import parse from 'parse-duration';
import { TinyColor } from '@ctrl/tinycolor';
import { actionHandler } from './action-handler-directive';
import { setLocale, t } from './localize';
import { downsample, SamplingRange } from './downsample';

interface SamplingSeries {
  data: EntityCachePoints;
  hidden?: boolean;
}

/* eslint no-console: 0 */
console.info(
  `%c APEXCHARTS-CARD %c v${pjson.version} `,
  'color: orange; font-weight: bold; background: black',
  'color: white; font-weight: bold; background: dimgray',
);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).ApexCharts = ApexCharts;

type ThresholdColorFn = (opts: { value: number }) => string;

// Optional `entity` of a tap/hold/double_tap action (ActionConfig does not declare it)
const actionEntity = (config: ActionsConfig, action: ActionHandlerDetail['action']): string | undefined =>
  (config[`${action}_action`] as { entity?: string } | undefined)?.entity;

localForage.config({
  name: 'apexchart-card',
  version: 1.0,
  storeName: 'entity_history_cache',
  description: 'ApexCharts-card uses caching for the entity history',
});

localForage
  .iterate((data, key) => {
    const value: EntityEntryCache = key.endsWith('-raw') ? data : decompress(data);
    if (value.card_version !== pjson.version) {
      localForage.removeItem(key);
    }
    const start = new Date();
    start.setTime(start.getTime() - value.span);
    if (new Date(value.last_fetched) < start) {
      localForage.removeItem(key);
    }
  })
  .catch((err) => {
    console.warn('Purging has errored: ', err);
  });

@customElement('apexcharts-card')
export class ChartsCard extends LitElement {
  private _hass?: HomeAssistant;

  private _apexChart?: ApexCharts;

  private _apexBrush?: ApexCharts;

  private _loaded = false;

  @property({ type: Boolean }) private _updating = false;

  private _graphs: (GraphEntry | undefined)[] | undefined;

  @property({ attribute: false }) private _config?: ChartCardConfig;

  private _entities: HassEntity[] = [];

  private _interval?: number;

  private _intervalTimeout?: ReturnType<typeof setTimeout>;

  private _updateTimeout?: ReturnType<typeof setTimeout>;

  private _lifecycle = 0;

  private _initializing?: number;

  private _historyUpdate?: Promise<PromiseSettledResult<boolean | undefined>[]>;

  @property({ attribute: false }) private _loadError?: string;

  @property({ type: Boolean }) private _empty = false;

  private _colors: string[] = [];

  private _brushColors: string[] = [];

  private _headerColors: string[] = [];

  private _graphSpan: number = HOUR_24;

  private _offset = 0;

  @property({ attribute: false }) private _headerState: (number | null)[] = [];

  private _dataLoaded = false;

  private _seriesOffset: number[] = [];

  private _seriesTimeDelta: number[] = [];

  private _updateDelay: number = DEFAULT_UPDATE_DELAY;

  private _brushInit = false;

  private _brushSelectionSpan = 0;

  private _yAxisConfig?: ChartCardYAxis[];

  private _hiddenSeries?: Set<number>;

  private _serverTimeOffset = 0;

  private _resizeObserver?: ResizeObserver;

  // Whether the main chart currently has a fill height, so leaving fill mode can undo it.
  private _heightFilled = false;

  private _lastChartSize?: { width: number; height?: number };

  private _samplingSeries?: { main: SamplingSeries[]; brush: SamplingSeries[] };

  private _samplingFrame?: number;

  private _samplingKey?: string;

  private _samplingBrushWidth?: number;

  private _samplingUpdate?: Promise<unknown>;

  // Set by HA: 'grid' in a sections view.
  @property({ attribute: false }) public layout?: string;

  @property({ attribute: false }) _lastUpdated?: Date;

  @property({ type: Boolean }) private _warning = false;

  public connectedCallback() {
    super.connectedCallback();
    if (this._config && this._hass && !this._loaded) {
      this._initialLoad();
    } else if (this._config && this._hass && this._apexChart && !this._config.update_interval) {
      window.requestAnimationFrame(() => {
        this._updateOnInterval();
      });
    }
    if (this._config?.update_interval) {
      window.requestAnimationFrame(() => {
        this._updateOnInterval();
      });
      // Valid because setConfig has been done.

      this._intervalTimeout = setInterval(() => this._updateOnInterval(), this._interval!);
    }
  }

  disconnectedCallback() {
    if (this._intervalTimeout !== undefined) {
      clearInterval(this._intervalTimeout);
      this._intervalTimeout = undefined;
    }
    // ApexCharts adds a window resize listener that only destroy() removes, so a chart left
    // alive here keeps the whole card in memory after HA discards it (dashboard save or
    // navigation). connectedCallback rebuilds it, and the resize observer, via _initialLoad().
    this._destroyCharts();
    super.disconnectedCallback();
  }

  private _updateOnInterval(): void {
    if (this.isConnected && this._apexChart && !this._warning && !this._updating && this._hass) {
      this._updating = true;
      this._updateData();
    }
  }

  protected updated(changedProperties: PropertyValues) {
    super.updated(changedProperties);
    if (this._config && this._hass && this.isConnected && !this._loaded && !this._loadError) {
      this._initialLoad();
    }
  }

  private _firstDataLoad() {
    if (this._updating || this._dataLoaded || !this._apexChart || !this._config || !this._hass) return;
    this._dataLoaded = true;
    this._updating = true;
    const chart = this._apexChart;
    this._updateData().then(() => {
      if (this._apexChart !== chart) return;
      if (this._config?.experimental?.hidden_by_default && !TIMESERIES_TYPES.includes(this._config.chart_type)) {
        this._config.series_in_graph.forEach((serie, index) => {
          if (serie.show.hidden_by_default) {
            const name = computeName(index, this._config?.series_in_graph, this._entities);
            this._apexChart?.hideSeries(name);
          }
        });
      }
    });
  }

  public set hass(hass: HomeAssistant) {
    this._hass = hass;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    setLocale((hass as any)?.locale?.language || hass?.language);
    if (!this._config || !this._graphs || !hass) return;

    this._graphs.map((graph) => {
      if (graph) graph.hass = hass;
    });

    let updated = false;
    let rawHeaderStatesUpdated = false;
    this._config.series.forEach((serie, index) => {
      if (isExternalStatisticId(serie.entity)) {
        // No state object exists for external statistic IDs: keep a stable
        // synthetic entity (enriched with recorder metadata once fetched) so
        // the card doesn't warn and name/unit resolution keeps working.
        if (!this._entities[index]) {
          this._entities[index] = this._buildExternalStatisticEntity(serie.entity);
        }
        return;
      }
      const entityState = (hass && hass.states[serie.entity]) || undefined;
      if (!entityState) {
        this._entities[index] = entityState;
      } else if (entityState && this._entities[index] !== entityState) {
        this._entities[index] = entityState;
        updated = true;
        if (this._graphs && this._graphs[index]) {
          this._graphs[index]!.hass = this._hass!;
        }
        if (serie.show.in_header === 'raw') {
          this._headerState[index] = truncateFloat(
            serie.attribute ? entityState.attributes[serie.attribute] : entityState.state,
            serie.float_precision,
          ) as number;
          rawHeaderStatesUpdated = true;
        }
      }
    });
    if (rawHeaderStatesUpdated) {
      this._headerState = [...this._headerState];
    }
    if (this._config.series.some((_, index) => this._entities[index] === undefined)) {
      this._warning = true;
      return;
    } else if (this._warning) {
      this._warning = false;
      this._reset();
    }
    if (updated) {
      this._entities = [...this._entities];
      if (!this._updating && !this._config.update_interval) {
        if (!this._dataLoaded) {
          this._firstDataLoad();
        } else {
          if (this.isConnected) {
            this._updating = true;
            // Give HA's recorder time to write history; disconnect cancels this delay.
            this._updateTimeout = setTimeout(() => {
              this._updateTimeout = undefined;
              this._updating = false;
              this._updateOnInterval();
            }, this._updateDelay);
          }
        }
      }
    }
  }

  private _destroyCharts() {
    this._lifecycle++;
    this._initializing = undefined;
    if (this._updateTimeout !== undefined) {
      clearTimeout(this._updateTimeout);
      this._updateTimeout = undefined;
    }
    this._resizeObserver?.disconnect();
    this._resizeObserver = undefined;
    this._loaded = false;
    this._dataLoaded = false;
    this._updating = false;
    this._loadError = undefined;
    this._empty = false;
    this._serverTimeOffset = 0;
    this._heightFilled = false;
    this._lastChartSize = undefined;
    if (this._samplingFrame !== undefined) cancelAnimationFrame(this._samplingFrame);
    this._samplingFrame = undefined;
    this._samplingSeries = undefined;
    this._samplingKey = undefined;
    this._samplingBrushWidth = undefined;
    this._samplingUpdate = undefined;
    this._hiddenSeries = undefined;
    if (this._apexChart) {
      this._apexChart.destroy();
      this._apexChart = undefined;
    }
    if (this._apexBrush) {
      this._apexBrush.destroy();
      this._apexBrush = undefined;
    }
    this._brushInit = false;
  }

  private _reset() {
    this._destroyCharts();
    if (this.isConnected && this._config && this._hass && !this._loaded) {
      this._initialLoad();
    }
  }

  public setConfig(config: ChartCardExternalConfig) {
    let configDup: ChartCardExternalConfig = JSON.parse(JSON.stringify(config));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if ((configDup as any).entities) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      configDup.series = (configDup as any).entities;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (configDup as any).entities;
    }
    configDup = configDup as ChartCardExternalConfig;
    if (configDup.config_templates) {
      configDup.config_templates =
        configDup.config_templates && Array.isArray(configDup.config_templates)
          ? configDup.config_templates
          : [configDup.config_templates];
      configDup = mergeConfigTemplates(getLovelace(), configDup);
    }
    try {
      const { ChartCardExternalConfig } = createCheckers(exportedTypeSuite);
      if (!configDup.experimental?.disable_config_validation) {
        ChartCardExternalConfig.strictCheck(configDup);
      }
      if (configDup.all_series_config) {
        configDup.series.forEach((serie, index) => {
          const allDup = JSON.parse(JSON.stringify(configDup.all_series_config));
          configDup.series[index] = mergeDeepConfig(allDup, serie);
        });
      }
      if (configDup.update_interval) {
        this._interval = validateInterval(configDup.update_interval, 'update_interval');
      }
      if (configDup.graph_span) {
        this._graphSpan = validateInterval(configDup.graph_span, 'graph_span');
      }
      if (configDup.span?.offset) {
        this._offset = validateOffset(configDup.span.offset, 'span.offset');
      }
      if (configDup.span?.end && configDup.span?.start) {
        throw new Error(t('error.span.startEnd'));
      }
      if (configDup.brush?.selection_span) {
        this._brushSelectionSpan = validateInterval(configDup.brush.selection_span, 'brush.selection_span');
      }
      configDup.series.forEach((serie, index) => {
        if (isExternalStatisticId(serie.entity) && !serie.statistics) {
          // External statistic IDs have no recorder history: without the
          // statistics option there is nothing to plot.
          throw new Error(t('error.statistics.externalRequired', { entity: serie.entity }));
        }
        if (serie.offset) {
          this._seriesOffset[index] = validateOffset(serie.offset, `series[${index}].offset`);
        }
        if (serie.time_delta) {
          this._seriesTimeDelta[index] = validateOffset(serie.time_delta, `series[${index}].time_delta`);
        }
      });
      if (configDup.update_delay) {
        this._updateDelay = validateInterval(configDup.update_delay, `update_delay`);
      }

      this._config = mergeDeep(
        {
          graph_span: DEFAULT_GRAPH_SPAN,
          cache: true,
          useCompress: false,
          show: { loading: true },
        },
        configDup,
      );

      const defColors = this._config?.color_list || DEFAULT_COLORS;
      if (this._config) {
        this._graphs = this._config.series.map((serie, index) => {
          serie.index = index;
          serie.ignore_history = !!(
            this._config?.chart_type &&
            ['donut', 'pie', 'radialBar'].includes(this._config?.chart_type) &&
            (!serie.group_by || serie.group_by?.func === 'raw') &&
            !serie.data_generator &&
            !serie.statistics &&
            !serie.offset
          );
          if (!this._headerColors[index]) {
            this._headerColors[index] = defColors[index % defColors.length];
          }
          if (serie.color) {
            this._headerColors[index] = serie.color;
          }
          serie.fill_raw = serie.fill_raw || DEFAULT_FILL_RAW;
          // External statistics have no live state to extend to
          serie.extend_to = isExternalStatisticId(serie.entity)
            ? false
            : serie.extend_to !== undefined
              ? serie.extend_to
              : 'end';
          serie.type = this._config?.chart_type ? undefined : serie.type || DEFAULT_SERIE_TYPE;
          if (!serie.group_by) {
            serie.group_by = {
              duration: DEFAULT_DURATION,
              offset: DEFAULT_OFFSET,
              func: DEFAULT_FUNC,
              fill: DEFAULT_GROUP_BY_FILL,
            };
          } else {
            serie.group_by.duration = serie.group_by.duration || DEFAULT_DURATION;
            serie.group_by.offset = serie.group_by.offset || DEFAULT_OFFSET;
            serie.group_by.func = serie.group_by.func || DEFAULT_FUNC;
            serie.group_by.fill = serie.group_by.fill || DEFAULT_GROUP_BY_FILL;
          }
          if (!serie.show) {
            serie.show = {
              in_legend: DEFAULT_SHOW_IN_LEGEND,
              legend_value: DEFAULT_SHOW_LEGEND_VALUE,
              in_header: DEFAULT_SHOW_IN_HEADER,
              in_chart: DEFAULT_SHOW_IN_CHART,
              name_in_header: DEFAULT_SHOW_NAME_IN_HEADER,
              null_in_header: DEFAULT_SHOW_NULL_IN_HEADER,
              zero_in_header: DEFAULT_SHOW_ZERO_IN_HEADER,
              offset_in_name: DEFAULT_SHOW_OFFSET_IN_NAME,
            };
          } else {
            serie.show.in_legend = serie.show.in_legend === undefined ? DEFAULT_SHOW_IN_LEGEND : serie.show.in_legend;
            serie.show.legend_value =
              serie.show.legend_value === undefined ? DEFAULT_SHOW_LEGEND_VALUE : serie.show.legend_value;
            serie.show.in_chart = serie.show.in_chart === undefined ? DEFAULT_SHOW_IN_CHART : serie.show.in_chart;
            serie.show.in_header =
              serie.show.in_header === undefined
                ? !serie.show.in_chart && serie.show.in_brush
                  ? false
                  : DEFAULT_SHOW_IN_HEADER
                : serie.show.in_header;
            serie.show.name_in_header =
              serie.show.name_in_header === undefined ? DEFAULT_SHOW_NAME_IN_HEADER : serie.show.name_in_header;
            serie.show.null_in_header =
              serie.show.null_in_header === undefined ? DEFAULT_SHOW_NULL_IN_HEADER : serie.show.null_in_header;
            serie.show.zero_in_header =
              serie.show.zero_in_header === undefined ? DEFAULT_SHOW_ZERO_IN_HEADER : serie.show.zero_in_header;
            serie.show.offset_in_name =
              serie.show.offset_in_name === undefined ? DEFAULT_SHOW_OFFSET_IN_NAME : serie.show.offset_in_name;
          }
          validateInterval(serie.group_by.duration, `series[${index}].group_by.duration`);
          validateOffset(serie.group_by.offset, `series[${index}].group_by.offset`);
          if (serie.color_threshold && serie.color_threshold.length > 0) {
            const sorted: ChartCardColorThreshold[] = JSON.parse(JSON.stringify(serie.color_threshold));
            sorted.sort((a, b) => (a.value < b.value ? -1 : 1));
            serie.color_threshold = sorted;
          }

          if (serie.entity) {
            const editMode = getLovelace()?.editMode;
            // disable caching for editor

            const caching = editMode === true ? false : this._config!.cache;
            const graphEntry = new GraphEntry(
              index,

              this._graphSpan!,

              caching,
              serie,
              this._config?.span,
            );
            if (this._hass) graphEntry.hass = this._hass;
            return graphEntry;
          }
          return undefined;
        });
        this._config.series_in_graph = [];
        this._config.series_in_brush = [];
        this._config.series.forEach((serie, index) => {
          if (serie.show.in_chart) {
            this._colors.push(this._headerColors[index]);

            this._config!.series_in_graph.push(serie);
          }
          if (this._config?.experimental?.brush && serie.show.in_brush) {
            this._brushColors.push(this._headerColors[index]);

            this._config!.series_in_brush.push(serie);
          }
        });
        if (this._config.yaxis && this._config.yaxis.length > 1) {
          if (
            this._config.series_in_graph.some((serie) => {
              return !serie.yaxis_id;
            })
          ) {
            throw new Error(t('error.yaxis.missingYaxisId'));
          }
          if (
            this._config.yaxis.some((yaxis) => {
              return !yaxis.id;
            })
          ) {
            throw new Error(t('error.yaxis.missingId'));
          }
        }
        if (this._config.yaxis) {
          const ids = new Set<string>();
          this._config.yaxis.forEach((axis) => {
            if (axis.id) {
              if (ids.has(axis.id)) throw new Error(t('error.yaxis.duplicateId', { id: axis.id }));
              ids.add(axis.id);
            }
            const logarithmic = axis.logarithmic ?? axis.apex_config?.logarithmic ?? false;
            const base = axis.log_base ?? axis.apex_config?.logBase ?? 10;
            if (typeof base !== 'number' || !Number.isFinite(base) || base <= 1) {
              throw new Error(t('error.yaxis.logBase'));
            }
            if (logarithmic) {
              for (const limit of [axis.min, axis.max]) {
                if (limit === undefined || limit === 'auto') continue;
                const [value, type] = this._getTypeOfMinMax(limit);
                if (
                  type !== minmax_type.ABSOLUTE &&
                  (typeof value !== 'number' || !Number.isFinite(value) || value <= 0)
                ) {
                  throw new Error(t('error.yaxis.logLimit'));
                }
              }
            }
          });
          const yAxisConfig = this._generateYAxisConfig(this._config);
          if (this._config.apex_config) {
            this._config.apex_config.yaxis = yAxisConfig;
          } else {
            this._config.apex_config = {
              yaxis: yAxisConfig,
            };
          }
          this._yAxisConfig?.forEach((yaxis) => {
            [yaxis.min, yaxis.min_type] = this._getTypeOfMinMax(yaxis.min);
            [yaxis.max, yaxis.max_type] = this._getTypeOfMinMax(yaxis.max);
          });
        }
        this._headerColors = this._headerColors.slice(0, this._config?.series.length);
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (e: any) {
      throw new Error(`/// apexcharts-card version ${pjson.version} /// ${e.message}`, { cause: e });
    }
    // Full reset only happens in editor mode
    // this._reset();
  }

  private _generateYAxisConfig(config: ChartCardConfig): ApexYAxis[] | undefined {
    if (!config.yaxis) return undefined;
    const burned: boolean[] = [];
    this._yAxisConfig = JSON.parse(JSON.stringify(config.yaxis));
    const yaxisConfig: ApexYAxis[] = config.series_in_graph.map((serie, serieIndex) => {
      let idx: number;
      if (config.yaxis?.length !== 1) {
        idx = config.yaxis!.findIndex((yaxis) => {
          return yaxis.id === serie.yaxis_id;
        });
      } else {
        idx = 0;
      }
      if (idx < 0) {
        throw new Error(t('error.yaxis.idNotFound', { id: String(serie.yaxis_id) }));
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let yAxisDup: any = JSON.parse(JSON.stringify(config.yaxis![idx]));
      delete yAxisDup.apex_config;
      delete yAxisDup.decimals;
      yAxisDup.decimalsInFloat =
        config.yaxis![idx].decimals === undefined ? DEFAULT_FLOAT_PRECISION : config.yaxis![idx].decimals;
      if (this._yAxisConfig?.[idx].series_id) {
        this._yAxisConfig?.[idx].series_id?.push(serieIndex);
      } else {
        this._yAxisConfig![idx].series_id! = [serieIndex];
      }

      if (config.yaxis![idx].apex_config) {
        yAxisDup = mergeDeep(yAxisDup, config.yaxis![idx].apex_config);
        delete yAxisDup.apex_config;
      }
      if (config.yaxis![idx].logarithmic !== undefined) yAxisDup.logarithmic = config.yaxis![idx].logarithmic;
      if (config.yaxis![idx].log_base !== undefined) yAxisDup.logBase = config.yaxis![idx].log_base;
      delete yAxisDup.log_base;
      if (typeof yAxisDup.min !== 'number') delete yAxisDup.min;
      if (typeof yAxisDup.max !== 'number') delete yAxisDup.max;
      if (burned[idx]) {
        yAxisDup.show = false;
      } else {
        yAxisDup.show = config.yaxis![idx].show === undefined ? true : config.yaxis![idx].show;
        burned[idx] = true;
      }
      return yAxisDup;
    });
    return yaxisConfig;
  }

  static get styles(): CSSResultGroup {
    return stylesApex;
  }

  protected render(): TemplateResult {
    if (!this._config || !this._hass) return html``;
    if (this._warning || this._config.series.some((_, index) => this._entities[index] === undefined)) {
      return this._renderWarnings();
    }

    this.dataset.appearance = this._config.appearance ?? 'premium';
    const fillHeight = this._fillsHeight();
    this.toggleAttribute('data-fill-height', fillHeight);
    const spinnerClass: ClassInfo = {
      'lds-ring': this._config.show?.loading && this._updating ? true : false,
    };
    const wrapperClasses: ClassInfo = {
      wrapper: true,
      'with-header': this._config.header?.show || true,
    };
    const haCardClasses: ClassInfo = {
      section: fillHeight,
    };

    const standardHeaderTitle = this._config.header?.standard_format ? this._config.header?.title : undefined;

    return html`
      <ha-card header=${ifDefined(standardHeaderTitle)} class=${classMap(haCardClasses)}>
        ${
          this._loadError || this._empty
            ? html`<div class="data-status" role="status" aria-live="polite">
                ${
                  this._loadError ||
                  t(
                    this._config.series_in_graph.every((serie) => serie.statistics)
                      ? 'card.warning.noStatistics'
                      : 'card.warning.noHistory',
                  )
                }
              </div>`
            : ''
        }
        <div id="spinner-wrapper">
          <div id="spinner" class=${classMap(spinnerClass)}>
            <div></div>
            <div></div>
            <div></div>
            <div></div>
          </div>
        </div>
        <div class=${classMap(wrapperClasses)}>
          ${
            this._config.header?.show && (this._config.header.show_states || !this._config.header.standard_format)
              ? this._renderHeader()
              : html``
          }
          <div id="graph-wrapper">
            <div id="graph"></div>
            ${this._config.series_in_brush.length ? html`<div id="brush"></div>` : ``}
          </div>
        </div>
        ${this._renderLastUpdated()} ${this._renderVersion()}
      </ha-card>
    `;
  }

  private _renderWarnings(): TemplateResult {
    return html`
      <ha-card class="warning">
        <hui-warning>
          <div style="font-weight: bold;">apexcharts-card</div>
          ${this._config?.series.map((_, index) =>
            !this._entities[index]
              ? html`
                  <div>
                    ${t('card.warning.entityNotAvailable', { entity: this._config?.series[index].entity ?? '' })}
                  </div>
                `
              : html``,
          )}
        </hui-warning>
      </ha-card>
    `;
  }

  private _renderHeader(): TemplateResult {
    const classes: ClassInfo = {
      floating: this._config?.header?.floating || false,
    };
    return html`
      <div id="header" class=${classMap(classes)}>
        ${!this._config?.header?.standard_format && this._config?.header?.title ? this._renderTitle() : html``}
        ${this._config?.header?.show_states ? this._renderStates() : html``}
      </div>
    `;
  }

  private _renderTitle(): TemplateResult {
    const classes =
      this._config?.header?.disable_actions ||
      !this._config?.header?.title_actions ||
      (this._config?.header?.title_actions?.tap_action?.action === 'none' &&
        (!this._config?.header?.title_actions?.hold_action?.action ||
          this._config?.header?.title_actions?.hold_action?.action === 'none') &&
        (!this._config?.header?.title_actions?.double_tap_action?.action ||
          this._config?.header?.title_actions?.double_tap_action?.action === 'none'))
        ? 'disabled'
        : 'actions';

    return html`<div
      id="header__title"
      class="${classes}"
      role=${ifDefined(classes === 'actions' ? 'button' : undefined)}
      tabindex=${ifDefined(classes === 'actions' ? '0' : undefined)}
      aria-label=${ifDefined(classes === 'actions' ? this._config?.header?.title : undefined)}
      @action=${(ev: Event) => {
        this._handleTitleAction(ev);
      }}
      .actionHandler=${actionHandler({
        hasDoubleClick:
          this._config?.header?.title_actions?.double_tap_action?.action &&
          this._config?.header?.title_actions.double_tap_action.action !== 'none',
        hasHold:
          this._config?.header?.title_actions?.hold_action?.action &&
          this._config?.header?.title_actions?.hold_action.action !== 'none',
      })}
      @focus="${(ev: Event) => {
        this.handleRippleFocus(ev, 'title');
      }}"
      @blur="${(ev: Event) => {
        this.handleRippleBlur(ev, 'title');
      }}"
      @mousedown="${(ev: Event) => {
        this.handleRippleActivate(ev, 'title');
      }}"
      @mouseup="${(ev: Event) => {
        this.handleRippleDeactivate(ev, 'title');
      }}"
      @touchstart="${(ev: Event) => {
        this.handleRippleActivate(ev, 'title');
      }}"
      @touchend="${(ev: Event) => {
        this.handleRippleDeactivate(ev, 'title');
      }}"
      @touchcancel="${(ev: Event) => {
        this.handleRippleDeactivate(ev, 'title');
      }}"
    >
      <span>${this._config?.header?.title}</span>
      <mwc-ripple unbounded id="ripple-title" aria-hidden="true"></mwc-ripple>
    </div>`;
  }

  private _renderStates(): TemplateResult {
    return html`
      <div id="header__states">
        ${this._config?.series.map((serie, index) => {
          if (
            serie.show.in_header &&
            (serie.show.null_in_header || this._headerState?.[index] !== null) &&
            (serie.show.zero_in_header || this._headerState?.[index] !== 0)
          ) {
            const stateClasses =
              this._config?.header?.disable_actions ||
              // Default tap action is more-info: meaningless without an entity
              (this._isExternalStatSerie(index) && !serie.header_actions) ||
              (serie.header_actions?.tap_action?.action === 'none' &&
                (!serie.header_actions?.hold_action?.action || serie.header_actions?.hold_action?.action === 'none') &&
                (!serie.header_actions?.double_tap_action?.action ||
                  serie.header_actions?.double_tap_action?.action === 'none'))
                ? 'disabled'
                : 'actions';
            return html`
              <div
                id="states__state"
                class="${stateClasses}"
                role=${ifDefined(stateClasses === 'actions' ? 'button' : undefined)}
                tabindex=${ifDefined(stateClasses === 'actions' ? '0' : undefined)}
                aria-label=${ifDefined(
                  stateClasses === 'actions' ? computeName(index, this._config?.series, this._entities) : undefined,
                )}
                @action=${(ev: Event) => {
                  this._handleAction(ev, serie);
                }}
                .actionHandler=${actionHandler({
                  hasDoubleClick:
                    serie.header_actions?.double_tap_action?.action &&
                    serie.header_actions.double_tap_action.action !== 'none',
                  hasHold:
                    serie.header_actions?.hold_action?.action && serie.header_actions?.hold_action.action !== 'none',
                })}
                @focus="${(ev: Event) => {
                  this.handleRippleFocus(ev, index);
                }}"
                @blur="${(ev: Event) => {
                  this.handleRippleBlur(ev, index);
                }}"
                @mousedown="${(ev: Event) => {
                  this.handleRippleActivate(ev, index);
                }}"
                @mouseup="${(ev: Event) => {
                  this.handleRippleDeactivate(ev, index);
                }}"
                @touchstart="${(ev: Event) => {
                  this.handleRippleActivate(ev, index);
                }}"
                @touchend="${(ev: Event) => {
                  this.handleRippleDeactivate(ev, index);
                }}"
                @touchcancel="${(ev: Event) => {
                  this.handleRippleDeactivate(ev, index);
                }}"
              >
                <div id="state__value">
                  <span id="state" style="${this._computeHeaderStateColor(serie, this._headerState?.[index])}"
                    >${
                      this._headerState?.[index] === 0
                        ? 0
                        : serie.show.as_duration
                          ? prettyPrintTime(this._headerState?.[index], serie.show.as_duration)
                          : this._computeLastState(this._headerState?.[index], index) || NO_VALUE
                    }</span
                  >
                  ${
                    !serie.show.as_duration
                      ? html`<span id="uom">${computeUom(index, this._config?.series, this._entities)}</span>`
                      : ''
                  }
                </div>
                ${
                  serie.show.name_in_header
                    ? html`<div id="state__name">${computeName(index, this._config?.series, this._entities)}</div>`
                    : ''
                }
                <mwc-ripple unbounded id="ripple-${index}" aria-hidden="true"></mwc-ripple>
              </div>
            `;
          } else {
            return html``;
          }
        })}
      </div>
    `;
  }

  private _renderLastUpdated(): TemplateResult {
    if (this._config?.show?.last_updated && this._lastUpdated) {
      return html` <div id="last_updated">${formatApexDate(this._config, this._hass, this._lastUpdated, true)}</div> `;
    }
    return html``;
  }

  private _renderVersion(): TemplateResult {
    if (this._config?.show?.version) {
      return html` <div id="version_info">apexcharts-card v${pjson.version}</div> `;
    }
    return html``;
  }

  private async _initialLoad() {
    const lifecycle = this._lifecycle;
    if (this._initializing === lifecycle) return;
    this._initializing = lifecycle;
    const current = () => this.isConnected && this._lifecycle === lifecycle;
    try {
      await new Promise((resolve) => requestAnimationFrame(resolve));
      await this.updateComplete;
      if (!current()) return;
      if (isUsingServerTimezone(this._hass)) {
        this._serverTimeOffset = computeTimezoneDiffWithLocal(this._hass?.config.time_zone);
      }
      const graph = this.shadowRoot?.querySelector<HTMLElement>('#graph');
      const brush = this.shadowRoot?.querySelector<HTMLElement>('#brush');
      if (!this._apexChart && graph && this._config) {
        this._loaded = true;
        let chartWidth = graph.clientWidth;
        if (chartWidth < 50) {
          await new Promise((resolve) => setTimeout(resolve, 300));
          await this.updateComplete;
          if (!current()) return;
          chartWidth = graph.clientWidth;
          if (chartWidth < 50) {
            chartWidth = graph.parentElement?.clientWidth || chartWidth;
          }
        }
        // Resolve external statistics names/units before the layout is built so
        // legends and tooltips pick them up on first render.
        await this._applyExternalStatisticsMetadata();
        if (!current()) return;
        const layout = getLayoutConfig(this._config, this._hass, this._graphs);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const chartCfg: any = layout;
        chartCfg.chart.width = chartWidth > 50 ? chartWidth : '100%';
        const fillHeight = this._chartFillHeight(graph);
        if (fillHeight !== undefined) {
          chartCfg.chart.height = fillHeight;
          this._heightFilled = true;
        }
        chartCfg.chart.redrawOnParentResize = true;
        this._configureSeriesVisibility(chartCfg);
        this._configureSampling(chartCfg);
        if (this._config.series_in_brush.length) {
          chartCfg.chart.id = Math.random().toString(36).substring(7);
        }
        this._apexChart = new ApexCharts(graph, chartCfg);
        const promises: Promise<unknown>[] = [];
        promises.push(this._apexChart.render());
        if (this._config.series_in_brush.length && brush) {
          const brushCfg = getBrushLayoutConfig(this._config, this._hass, chartCfg.chart.id);
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (brushCfg as any).chart.redrawOnParentResize = true;
          this._apexBrush = new ApexCharts(brush, brushCfg as ApexOptions);
          promises.push(this._apexBrush.render());
        }
        const renders = await Promise.allSettled(promises);
        if (!current()) return;
        const failure = renders.find((result) => result.status === 'rejected');
        if (failure?.status === 'rejected') throw failure.reason;
        if (graph && this._apexChart) {
          this._resizeObserver = new ResizeObserver(() => {
            if (current()) this._resizeCharts(graph);
          });
          this._resizeObserver.observe(graph);
          if (brush && this._apexBrush) this._resizeObserver.observe(brush);
        }
        this._firstDataLoad();
      }
    } catch (err) {
      if (current()) {
        log(err);
        this._destroyCharts();
        this._loadError = t('card.warning.initializationFailed');
      }
    } finally {
      if (this._initializing === lifecycle) this._initializing = undefined;
    }
  }

  private _resizeCharts(graph: HTMLElement): void {
    const width = graph.clientWidth;
    if (width <= 50 || !this._apexChart) return;
    const chart: { width: number; height?: number | string } = { width };
    const height = this._chartFillHeight(graph);
    if (this._lastChartSize?.width === width && this._lastChartSize.height === height) return;
    const size = { width, height };
    this._lastChartSize = size;
    if (height !== undefined) {
      chart.height = height;
      this._heightFilled = true;
    } else if (this._heightFilled && !this._fillsHeight()) {
      // Rows set back to 'auto' in the editor: hand the height back to ApexCharts.
      chart.height = 'auto';
      this._heightFilled = false;
    }
    const onError = (error: unknown) => {
      if (this._lastChartSize === size) this._lastChartSize = undefined;
      log(error);
    };
    Promise.resolve(this._apexChart.updateOptions({ chart }, false, true)).catch(onError);
    Promise.resolve(this._apexBrush?.updateOptions({ chart: { width } }, false, true)).catch(onError);
    this._queueResample();
  }

  private _configureSampling(layout: ApexOptions): void {
    if (!this._hasSampling()) return;
    layout.chart ??= {};
    layout.chart.events ??= {};
    const updated = layout.chart.events.updated;
    layout.chart.events.updated = (...args) => {
      updated?.(...args);
      this._queueResample();
    };
  }

  private _canSample(index: number, brush: boolean): boolean {
    if (!this._config?.downsample || (this._config.chart_type && this._config.chart_type !== 'line')) return false;
    const apex = brush ? this._config.brush?.apex_config : this._config.apex_config;
    if (this._config.stacked || apex?.chart?.stacked) return false;
    if (apex?.chart?.type && !['line', 'area'].includes(apex.chart.type)) return false;
    const config = (brush ? this._config.series_in_brush : this._config.series_in_graph)[index];
    if (!config || config.type === 'column') return false;
    const curves = apex?.stroke?.curve;
    const curve = config.curve ?? (Array.isArray(curves) ? curves[index] : curves);
    return curve !== 'stepline' && curve !== 'linestep';
  }

  private _hasSampling(): boolean {
    return (
      !!this._config?.downsample &&
      (this._config.series_in_graph.some((_, index) => this._canSample(index, false)) ||
        this._config.series_in_brush.some((_, index) => this._canSample(index, true)))
    );
  }

  private _sampleSeries(series: SamplingSeries[], brush: boolean, range?: SamplingRange): SamplingSeries[] {
    const width = this.shadowRoot?.querySelector<HTMLElement>(brush ? '#brush' : '#graph')?.clientWidth ?? 0;
    return series.map((entry, index) => {
      if (!this._canSample(index, brush)) return entry;
      const data = downsample(entry.data, width, range);
      return data === entry.data ? entry : { ...entry, data };
    });
  }

  private _queueResample(): void {
    if (!this._samplingSeries || this._samplingFrame !== undefined || !this.isConnected) return;
    const chart = this._apexChart;
    const lifecycle = this._lifecycle;
    this._samplingFrame = requestAnimationFrame(() => {
      this._samplingFrame = undefined;
      if (chart !== this._apexChart || lifecycle !== this._lifecycle) return;
      try {
        this._resampleCharts();
      } catch (error) {
        this._samplingKey = undefined;
        this._samplingBrushWidth = undefined;
        this._loadError = t('card.warning.refreshFailed');
        log(error);
      }
    });
  }

  private _resampleCharts(): void {
    if (!this._samplingSeries || !this._apexChart || this._updating || this._samplingUpdate) return;
    const chart = this._apexChart;
    const range = this._readChartRange(chart);
    const graphWidth = this.shadowRoot?.querySelector<HTMLElement>('#graph')?.clientWidth ?? 0;
    const brushWidth = this.shadowRoot?.querySelector<HTMLElement>('#brush')?.clientWidth ?? 0;
    const key = `${graphWidth}|${brushWidth}|${range?.min}|${range?.max}`;
    if (this._samplingKey === key) return;
    this._samplingKey = key;
    const lifecycle = this._lifecycle;
    const update = (target: ApexCharts, options: ApexOptions) =>
      Promise.resolve().then(() => {
        if (chart !== this._apexChart || lifecycle !== this._lifecycle) return;
        return target.updateOptions(options, false, false, false);
      });
    const main = this._sampleSeries(this._samplingSeries.main, false, range);
    const updates = [update(chart, { series: main, ...(range ? { xaxis: range } : {}) })];
    // Redrawing the brush during a drag restores its configured selection.
    // Its overview depends on width/data, not the main chart's visible range.
    if (this._apexBrush && this._samplingBrushWidth !== brushWidth) {
      this._samplingBrushWidth = brushWidth;
      updates.push(update(this._apexBrush, { series: this._sampleSeries(this._samplingSeries.brush, true) }));
    }
    const pending = Promise.allSettled(updates).then((results) => {
      if (this._samplingUpdate !== pending) return;
      this._samplingUpdate = undefined;
      const failure = results.find((result) => result.status === 'rejected');
      if (failure?.status === 'rejected') {
        this._samplingKey = undefined;
        this._samplingBrushWidth = undefined;
        this._loadError = t('card.warning.refreshFailed');
        log(failure.reason);
      } else {
        this._queueResample();
      }
    });
    this._samplingUpdate = pending;
  }

  // A sections cell only has a fixed height when rows is a number. 'auto' rows size to the
  // content, where filling would freeze the chart at its first height, so section_mode (which
  // the editor used to recommend for every sections card) only opts in outside sections.
  private _fillsHeight(): boolean {
    if (this.layout === 'grid') return typeof this._config?.grid_options?.rows === 'number';
    return this._config?.section_mode === true;
  }

  // CSS gives #graph whatever the header, ha-card title and brush leave of the card, so its
  // height is what the chart must be. An explicit apex_config height still wins.
  private _chartFillHeight(graph: HTMLElement): number | undefined {
    if (!this._fillsHeight() || this._config?.apex_config?.chart?.height !== undefined) return undefined;
    return graph.clientHeight > 50 ? graph.clientHeight : undefined;
  }

  private _isExternalStatSerie(index: number): boolean {
    return isExternalStatisticId(this._config?.series[index]?.entity);
  }

  private _buildExternalStatisticEntity(statisticId: string, metadata?: StatisticsMetadata): HassEntity {
    return {
      entity_id: statisticId,
      state: 'unknown',
      last_updated: new Date().toISOString(),
      last_changed: new Date().toISOString(),
      attributes: {
        friendly_name: metadata?.name || statisticId,
        unit_of_measurement: metadata?.statistics_unit_of_measurement || undefined,
      },
      context: { id: '', parent_id: null, user_id: null },
    } as unknown as HassEntity;
  }

  // Default name/unit of external statistics come from the recorder metadata
  // (cached per ID); fallback is the raw statistic ID.
  private async _applyExternalStatisticsMetadata(): Promise<void> {
    if (!this._config || !this._hass) return;
    const config = this._config;
    const lifecycle = this._lifecycle;
    if (!this._config.series.some((serie) => isExternalStatisticId(serie.entity))) return;
    await Promise.all(
      this._config.series.map(async (serie, index) => {
        if (!isExternalStatisticId(serie.entity)) return;
        const metadata = await getStatisticsMetadata(this._hass, serie.entity);
        if (this._config !== config || this._lifecycle !== lifecycle) return;
        if (!serie.name && metadata?.name) serie.name = metadata.name;
        if (!serie.unit && metadata?.statistics_unit_of_measurement) {
          serie.unit = metadata.statistics_unit_of_measurement;
        }
        this._entities[index] = this._buildExternalStatisticEntity(serie.entity, metadata);
      }),
    );
    if (this._config === config && this._lifecycle === lifecycle) this._entities = [...this._entities];
  }

  private async _updateData() {
    if (!this._config || !this._apexChart || !this._graphs) {
      this._updating = false;
      return;
    }

    const chart = this._apexChart;
    const lifecycle = this._lifecycle;
    const current = () => this._apexChart === chart && this._lifecycle === lifecycle;
    const { start, end } = this._getSpanDates();
    const now = new Date();
    const editMode = getLovelace()?.editMode;

    const caching = editMode === true ? false : this._config!.cache;
    let errorMessage = t('card.warning.refreshFailed');
    try {
      // Reusing GraphEntry while its previous fetch is pending would skip the new refresh.
      await this._historyUpdate;
      if (this._samplingUpdate) await this._samplingUpdate;
      if (!current()) return;
      const promise = this._graphs.map((graph, index) => {
        if (graph) graph.cache = caching;
        return graph?._updateHistory(
          this._seriesOffset[index] ? new Date(start.getTime() + this._seriesOffset[index]) : start,
          this._seriesOffset[index] ? new Date(end.getTime() + this._seriesOffset[index]) : end,
        );
      });
      const historyUpdate = Promise.allSettled(promise);
      this._historyUpdate = historyUpdate;
      const results = await historyUpdate;
      if (this._historyUpdate === historyUpdate) this._historyUpdate = undefined;
      // The chart was destroyed (card disconnected) while history loaded. Leave _updating
      // alone: disconnect already reset it and a reconnect may have started a fresh load.
      if (!current()) return;
      const failedIndex = results.findIndex((result) => result.status === 'rejected');
      if (failedIndex !== -1) {
        errorMessage = t('card.warning.historyFailed', { entity: this._config.series[failedIndex].entity });
        const failure = results[failedIndex];
        if (failure.status === 'rejected') throw failure.reason;
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let graphData: any = { series: [] };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const brushData: any = { series: [] };
      if (TIMESERIES_TYPES.includes(this._config.chart_type)) {
        this._graphs.forEach((graph, index) => {
          if (!graph) return [];
          const inHeader = this._config?.series[index].show.in_header;
          if (inHeader && inHeader !== 'raw') {
            if (inHeader === 'after_now' || inHeader === 'before_now') {
              // before_now / after_now
              this._headerState[index] = graph.nowValue(
                now.getTime() + (this._seriesOffset[index] ? this._seriesOffset[index] : 0),
                inHeader === 'before_now',
              );
            } else {
              // not raw
              this._headerState[index] = graph.lastState;
            }
          } else if (inHeader === 'raw' && this._isExternalStatSerie(index)) {
            // External statistics have no entity state: `raw` shows the
            // latest statistic value instead.
            this._headerState[index] = graph.lastState;
          }
          if (!this._config?.series[index].show.in_chart && !this._config?.series[index].show.in_brush) {
            return;
          }
          if (graph.history.length === 0) {
            if (this._config?.series[index].show.in_chart) graphData.series.push({ data: [] });
            if (this._config?.series[index].show.in_brush) brushData.series.push({ data: [] });
            return;
          }
          let data: EntityCachePoints;
          const offset =
            this._serverTimeOffset + (this._seriesOffset[index] || 0) - (this._seriesTimeDelta[index] || 0);
          if (offset) {
            data = offsetData(graph.history, offset);
          } else {
            data = [...graph.history];
          }
          if (this._config?.series[index].type !== 'column' && this._config?.series[index].extend_to) {
            const lastPoint = data.slice(-1)[0]!;
            if (
              this._config?.series[index].extend_to === 'end' &&
              lastPoint[0] < end.getTime() - this._serverTimeOffset
            ) {
              data.push([end.getTime() - this._serverTimeOffset, lastPoint[1]]);
            } else if (
              this._config?.series[index].extend_to === 'now' &&
              lastPoint[0] < now.getTime() - this._serverTimeOffset
            ) {
              data.push([now.getTime() - this._serverTimeOffset, lastPoint[1]]);
            }
          }
          const result = this._config?.series[index].invert ? { data: this._invertData(data) } : { data };
          if (this._config?.series[index].show.in_chart) graphData.series.push(result);
          if (this._config?.series[index].show.in_brush) brushData.series.push(result);
          return;
        });
        graphData.annotations = this._computeAnnotations(start, end, new Date(now.getTime() - this._serverTimeOffset));
        if (this._yAxisConfig) {
          graphData.yaxis = this._computeYAxisAutoMinMax(start, end);
        }
        if (!this._apexBrush) {
          const newMinMax = this._findStartAndEndOfChart(
            new Date(start.getTime() - this._serverTimeOffset),
            new Date(end.getTime() - this._serverTimeOffset),
            false,
          );
          graphData.xaxis = {
            min: newMinMax.start,
            max: newMinMax.end,
          };
        }
      } else {
        // No timeline charts
        graphData = {
          series: this._graphs.flatMap((graph, index) => {
            if (!graph) return [];
            let data: number;
            // For external statistics, `raw` also resolves to the latest
            // statistic value (there is no entity state to read from).
            const computedHeader =
              this._config?.series[index].show.in_header !== 'raw' || this._isExternalStatSerie(index);
            if (graph.history.length === 0) {
              if (computedHeader) {
                this._headerState[index] = null;
              }
              data = 0;
            } else {
              const lastState = graph.lastState;
              data = lastState || 0;
              if (computedHeader) {
                this._headerState[index] = lastState;
              }
            }
            if (!this._config?.series[index].show.in_chart) {
              return [];
            }
            if (this._config?.chart_type === 'radialBar') {
              return [getPercentFromValue(data, this._config.series[index].min, this._config.series[index].max)];
            } else {
              return [data];
            }
          }),
        };
      }
      if (TIMESERIES_TYPES.includes(this._config.chart_type) && this._config.experimental?.hidden_by_default) {
        // Partial series updates otherwise inherit the original hidden flag in ApexCharts.
        graphData.series = graphData.series.map((series: { hidden?: boolean }, index: number) => {
          const config = this._config!.series_in_graph[index];
          return {
            ...series,
            hidden: this._hiddenSeries ? this._hiddenSeries.has(config.index) : config.show.hidden_by_default === true,
          };
        });
      }
      if (this._hasSampling()) {
        this._samplingSeries = { main: graphData.series, brush: brushData.series };
        this._samplingKey = undefined;
        graphData.series = this._sampleSeries(graphData.series, false, this._readChartRange(chart));
        brushData.series = this._sampleSeries(brushData.series, true);
      }
      graphData.colors = this._computeChartColors(false);
      if (this._apexBrush) {
        brushData.colors = this._computeChartColors(true);
      }
      if (this._config.experimental?.color_threshold && this._config.series.some((serie) => serie.color_threshold)) {
        graphData.markers = {
          colors: computeColors(
            this._config.series_in_graph.flatMap((serie, index) => {
              if (serie.type === 'column') return [];
              return [this._colors[index]];
            }),
          ),
        };
        graphData.legend = { markers: { fillColors: computeColors(this._colors) } };
        graphData.tooltip = { marker: { fillColors: graphData.legend.markers.fillColors } };
        const mainFill = this._computeThresholdFill(false);
        if (mainFill) graphData.fill = mainFill;
        if (this._apexBrush) {
          const brushFill = this._computeThresholdFill(true);
          if (brushFill) brushData.fill = brushFill;
        }
      }
      // graphData.tooltip = { marker: { fillColors: ['#ff0000', '#00ff00'] } };
      const currentRange = this._apexBrush ? this._readChartRange(this._apexChart) : undefined;
      const brushRange = this._apexBrush ? this._readChartRange(this._apexBrush) : undefined;
      const brushIsAtEnd = currentRange && brushRange && currentRange.max === brushRange.max;
      this._headerState = [...this._headerState];
      const chartUpdates: Promise<unknown>[] = [];
      chartUpdates.push(
        this._apexChart?.updateOptions(
          graphData,
          false,
          TIMESERIES_TYPES.includes(this._config.chart_type) ? false : true,
        ),
      );
      if (this._apexBrush) {
        const newMinMax = this._findStartAndEndOfChart(
          new Date(start.getTime() - this._serverTimeOffset),
          new Date(end.getTime() - this._serverTimeOffset),
          true,
        );
        brushData.xaxis = {
          min: newMinMax.start,
          max: newMinMax.end,
        };
        if (this._brushInit && !currentRange) {
          log('Brush selection bounds are unavailable or invalid; resetting to the latest range.');
        }
        if (brushIsAtEnd || !this._brushInit || !currentRange) {
          brushData.chart = {
            selection: {
              enabled: true,
              xaxis: {
                min: Math.max(
                  newMinMax.start,
                  newMinMax.end - (this._brushSelectionSpan ? this._brushSelectionSpan : this._graphSpan / 4),
                ),
                max: brushData.xaxis.max,
              },
            },
          };
        } else {
          const selectionWidth = Math.min(currentRange.max - currentRange.min, newMinMax.end - newMinMax.start);
          const selectionStart = Math.max(newMinMax.start, Math.min(currentRange.min, newMinMax.end - selectionWidth));
          brushData.chart = {
            selection: {
              enabled: true,
              xaxis: {
                min: selectionStart,
                max: selectionStart + selectionWidth,
              },
            },
          };
        }
        const selectionColor = computeColor('var(--primary-text-color)');
        brushData.chart.selection.stroke = { color: selectionColor };
        brushData.chart.selection.fill = { color: selectionColor, opacity: 0.1 };
        this._brushInit = true;
        chartUpdates.push(this._apexBrush?.updateOptions(brushData, false, false));
      }
      const updates = await Promise.allSettled(chartUpdates);
      if (!current()) return;
      const failure = updates.find((result) => result.status === 'rejected');
      if (failure?.status === 'rejected') throw failure.reason;
      this._lastUpdated = now;
      this._loadError = undefined;
      this._empty =
        this._config.series_in_graph.length > 0 &&
        !this._config.series_in_graph.some((serie) =>
          this._graphs?.[serie.index]?.history.some(([, value]) => value !== null && Number.isFinite(value)),
        );
    } catch (err) {
      if (current()) {
        log(err);
        this._loadError = errorMessage;
      }
    } finally {
      if (current()) {
        this._updating = false;
        this._queueResample();
      }
    }
  }

  private _readChartRange(chart: ApexCharts): { min: number; max: number } | undefined {
    // ApexCharts exposes these bounds internally, not in its public type definitions.
    const globals = (chart as ApexCharts & { axes?: { w?: { globals?: { minX?: unknown; maxX?: unknown } } } }).axes?.w
      ?.globals;
    const min = globals?.minX;
    const max = globals?.maxX;
    if (
      typeof min !== 'number' ||
      typeof max !== 'number' ||
      !Number.isFinite(min) ||
      !Number.isFinite(max) ||
      min >= max
    ) {
      return undefined;
    }
    return { min, max };
  }

  private _computeAnnotations(start: Date, end: Date, now: Date) {
    return {
      ...this._computeMinMaxPointsAnnotations(start, end),
      ...this._computeNowAnnotation(now),
    };
  }

  private _computeMinMaxPointsAnnotations(start: Date, end: Date) {
    const sameDay =
      start.getFullYear() === end.getFullYear() &&
      start.getMonth() === end.getMonth() &&
      start.getDate() === end.getDate();
    const minMaxPoints = this._config?.series_in_graph.flatMap((serie, index) => {
      if (serie.show.extremas) {
        const { min, max } = this._graphs?.[serie.index]?.minMaxWithTimestamp(
          this._seriesOffset[serie.index]
            ? new Date(start.getTime() + this._seriesOffset[serie.index]).getTime()
            : start.getTime(),
          this._seriesOffset[serie.index]
            ? new Date(end.getTime() + this._seriesOffset[serie.index]).getTime()
            : end.getTime(),
          this._serverTimeOffset - (this._seriesTimeDelta[serie.index] || 0),
        ) || {
          min: [0, null],
          max: [0, null],
        };
        const bgColor = computeColor(this._colors[index]);
        const txtColor = computeTextColor(bgColor);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const extremas: any = [];
        if (min[0] && ['min', 'min+time', true, 'time'].includes(serie.show.extremas)) {
          const withTime = serie.show.extremas === 'time' || serie.show.extremas === 'min+time';
          extremas.push(
            ...this._getPointAnnotationStyle(
              min,
              this._seriesOffset[serie.index],
              bgColor,
              txtColor,
              serie,
              index,
              serie.invert,
              sameDay,
              withTime,
            ),
          );
        }
        if (max[0] && ['max', 'max+time', true, 'time'].includes(serie.show.extremas)) {
          const withTime = serie.show.extremas === 'time' || serie.show.extremas === 'max+time';
          extremas.push(
            ...this._getPointAnnotationStyle(
              max,
              this._seriesOffset[serie.index],
              bgColor,
              txtColor,
              serie,
              index,
              serie.invert,
              sameDay,
              withTime,
            ),
          );
        }
        return extremas;
      } else {
        return [];
      }
    });
    return { points: [...(minMaxPoints || []), ...(this._config?.apex_config?.annotations?.points || [])] };
  }

  private _getPointAnnotationStyle(
    value: HistoryPoint,
    offset: number,
    bgColor: string,
    txtColor: string,
    serie: ChartCardSeriesConfig,
    index: number,
    invert = false,
    sameDay: boolean,
    withTime: boolean,
  ) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const points: any = [];
    const multiYAxis =
      this._config?.apex_config?.yaxis &&
      Array.isArray(this._config.apex_config.yaxis) &&
      this._config.apex_config.yaxis.length > 1;
    points.push({
      x: offset ? value[0] - offset : value[0],
      y: invert && value[1] ? -value[1] : value[1],
      seriesIndex: index,
      yAxisIndex: multiYAxis ? index : 0,
      marker: {
        strokeColor: bgColor,
        fillColor: 'var(--card-background-color)',
      },
      label: {
        text: myFormatNumber(value[1], this._hass?.locale, serie.float_precision),
        borderColor: 'var(--card-background-color)',
        offsetY: (value[1] ?? 0) < 0 ? 30 : 0,
        borderWidth: 2,
        style: {
          background: bgColor,
          color: txtColor,
        },
      },
    });
    if (withTime) {
      let bgColorTime = new TinyColor(computeColor('var(--card-background-color)'));
      bgColorTime =
        bgColorTime.isValid && bgColorTime.getLuminance() > 0.5 ? bgColorTime.darken(20) : bgColorTime.lighten(20);
      const txtColorTime = computeTextColor(bgColorTime.toHexString());
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let options: any = { timeStyle: 'medium' };
      if (!sameDay) {
        options.dateStyle = 'medium';
      }
      options = { ...options, ...(is12Hour(this._config, this._hass) ? { hour12: true } : { hourCycle: 'h23' }) };
      const lang = getLang(this._config, this._hass);
      points.push({
        x: offset ? value[0] - offset : value[0],
        y: invert && value[1] ? -value[1] : value[1],
        seriesIndex: index,
        yAxisIndex: multiYAxis ? index : 0,
        marker: {
          size: 0,
        },
        label: {
          text: `${Intl.DateTimeFormat(lang, options).format(value[0])}`,
          borderColor: 'var(--card-background-color)',
          offsetY: (value[1] ?? 0) < 0 ? 38 : -22,
          borderWidth: 0,
          style: {
            background: bgColorTime.toHexString(),
            color: txtColorTime,
            fontSize: '8px',
            fontWeight: 200,
          },
        },
      });
    }
    return points;
  }

  private _computeNowAnnotation(now: Date) {
    if (this._config?.now?.show) {
      const color = computeColor(this._config.now.color || 'var(--primary-color)');
      const textColor = computeTextColor(color);
      return {
        xaxis: [
          {
            x: now.getTime(),
            strokeDashArray: 3,
            label: {
              text: this._config.now.label,
              borderColor: color,
              style: {
                color: textColor,
                background: color,
              },
            },
            borderColor: color,
          },
          ...(this._config?.apex_config?.annotations?.xaxis || []),
        ],
      };
    }
    return {};
  }

  private _configureSeriesVisibility(layout: ApexOptions): void {
    this._hiddenSeries = new Set(
      this._config?.series_in_graph
        .filter((serie) => this._config?.experimental?.hidden_by_default && serie.show.hidden_by_default)
        .map((serie) => serie.index),
    );
    if (
      !this._config?.experimental?.hidden_by_default ||
      !TIMESERIES_TYPES.includes(this._config.chart_type) ||
      layout.plotOptions?.bar?.distributed === true ||
      layout.legend?.onItemClick?.toggleDataSeries === false
    ) {
      return;
    }
    layout.chart ??= {};
    layout.chart.events ??= {};
    const customLegendClick = layout.chart.events.legendClick;
    layout.chart.events.legendClick = (chart, index, options) => {
      customLegendClick?.(chart, index, options);
      const serie = index === undefined ? undefined : this._config?.series_in_graph[index];
      if (!serie || chart !== this._apexChart) return;
      if (this._hiddenSeries!.has(serie.index)) this._hiddenSeries!.delete(serie.index);
      else this._hiddenSeries!.add(serie.index);
      if (this._samplingSeries) {
        this._samplingSeries.main.forEach((entry, i) => {
          entry.hidden = this._hiddenSeries!.has(this._config!.series_in_graph[i].index);
        });
      }
      if (!this._yAxisConfig) return;
      window.requestAnimationFrame(() => {
        if (chart !== this._apexChart) return;
        const { start, end } = this._getSpanDates();
        const yaxis = this._computeYAxisAutoMinMax(start, end);
        chart.updateOptions({ yaxis }, false, false, false).catch(log);
      });
    };
  }

  private _computeYAxisAutoMinMax(start: Date, end: Date) {
    if (!this._config) return;
    this._yAxisConfig?.map((yaxis) => {
      if (yaxis.min_type !== minmax_type.FIXED || yaxis.max_type !== minmax_type.FIXED) {
        const minMax = yaxis.series_id?.map((id) => {
          const serie = this._config!.series_in_graph[id];
          const hidden = this._hiddenSeries
            ? this._hiddenSeries.has(serie.index)
            : this._config?.experimental?.hidden_by_default && serie.show.hidden_by_default;
          if (hidden) return undefined;
          const graphIndex = serie.index;
          const lMinMax = this._graphs![graphIndex]?.minMaxWithTimestampForYAxis(
            start.getTime() + (this._seriesOffset[graphIndex] || 0),
            end.getTime() + (this._seriesOffset[graphIndex] || 0),
          );
          if (!lMinMax) return undefined;
          if (serie.invert) {
            const cmin = lMinMax.min[1];
            const cmax = lMinMax.max[1];
            if (cmin !== null) {
              lMinMax.max[1] = -cmin;
            }
            if (cmax !== null) {
              lMinMax.min[1] = -cmax;
            }
          }
          return lMinMax;
        });
        let min: number | null = null;
        let max: number | null = null;
        minMax?.forEach((elt) => {
          if (!elt) return;
          if (min === undefined || min === null) {
            min = elt.min[1];
          } else if (elt.min[1] !== null && min > elt.min[1]) {
            min = elt.min[1];
          }
          if (max === undefined || max === null) {
            max = elt.max[1];
          } else if (elt.max[1] !== null && max < elt.max[1]) {
            max = elt.max[1];
          }
        });
        const logarithmic = yaxis.logarithmic ?? yaxis.apex_config?.logarithmic ?? false;
        if (yaxis.align_to !== undefined && !logarithmic) {
          if (min !== null && yaxis.min_type !== minmax_type.FIXED) {
            if (min % yaxis.align_to !== 0) {
              min = min >= 0 ? min - (min % yaxis.align_to) : -(yaxis.align_to + (min % yaxis.align_to) - min);
            }
          }
          if (max !== null && yaxis.max_type !== minmax_type.FIXED) {
            if (max % yaxis.align_to !== 0) {
              max = max >= 0 ? yaxis.align_to - (max % yaxis.align_to) + max : (max % yaxis.align_to) - max;
            }
          }
        }
        yaxis.series_id?.forEach((id) => {
          const apexYAxis = (this._config!.apex_config!.yaxis as ApexYAxis[])[id];
          if (yaxis.min_type !== minmax_type.FIXED) {
            apexYAxis.min =
              min === null
                ? yaxis.min_type === minmax_type.SOFT
                  ? yaxis.min
                  : undefined
                : this._getMinMaxBasedOnType(true, min, yaxis.min as number, yaxis.min_type!);
          }
          if (yaxis.max_type !== minmax_type.FIXED) {
            apexYAxis.max =
              max === null
                ? yaxis.max_type === minmax_type.SOFT
                  ? yaxis.max
                  : undefined
                : this._getMinMaxBasedOnType(false, max, yaxis.max as number, yaxis.max_type!);
          }
        });
      }
    });
    return this._config?.apex_config?.yaxis;
  }

  private _getMinMaxBasedOnType(isMin: boolean, value: number, configMinMax: number, type: minmax_type): number {
    switch (type) {
      case minmax_type.AUTO:
        return value;
      case minmax_type.SOFT:
        if ((isMin && value > configMinMax) || (!isMin && value < configMinMax)) {
          return configMinMax;
        } else {
          return value;
        }
      case minmax_type.ABSOLUTE:
        return value + configMinMax;
      default:
        return value;
    }
  }

  private _getTypeOfMinMax(value?: 'auto' | number | string): [number | undefined, minmax_type] {
    const regexFloat = /[+-]?\d+(\.\d+)?/g;
    if (typeof value === 'number') {
      return [value, minmax_type.FIXED];
    } else if (value === undefined || value === 'auto') {
      return [undefined, minmax_type.AUTO];
    }
    if (typeof value === 'string' && value !== 'auto') {
      const matched = value.match(regexFloat);
      if (!matched || matched.length !== 1) {
        throw new Error(t('error.yaxis.badMinMaxFormat', { value }));
      }
      const floatValue = parseFloat(matched[0]);
      if (value.startsWith('~')) {
        return [floatValue, minmax_type.SOFT];
      } else if (value.startsWith('|') && value.endsWith('|')) {
        return [floatValue, minmax_type.ABSOLUTE];
      }
    }
    throw new Error(t('error.yaxis.badMinMaxFormat', { value }));
  }

  private _computeChartColors(brush: boolean): (string | ThresholdColorFn)[] {
    const colors = brush ? this._brushColors : this._colors;
    const defaultColors: (string | ThresholdColorFn)[] = computeColors(colors);
    const series = brush ? this._config?.series_in_brush : this._config?.series_in_graph;
    series?.forEach((serie, index) => {
      if (
        this._config?.experimental?.color_threshold &&
        (PLAIN_COLOR_TYPES.includes(this._config!.chart_type!) || serie.type === 'column') &&
        serie.color_threshold &&
        serie.color_threshold.length > 0
      ) {
        defaultColors[index] = function (
          { value }: { value: number },
          sortedL = serie.color_threshold!,
          defColor = colors[index],
        ) {
          let returnValue = sortedL[0].color || defColor;
          sortedL.forEach((color) => {
            if (value > color.value) returnValue = color.color || defColor;
          });
          return computeColor(returnValue);
        };
      }
    });
    return defaultColors.slice(0, series?.length);
  }

  private _computeThresholdFill(brush: boolean): ApexOptions['fill'] {
    if (!this._config) return undefined;
    const customFill = brush ? this._config.brush?.apex_config?.fill : this._config.apex_config?.fill;
    if (customFill !== undefined) return undefined;
    const series = brush ? this._config.series_in_brush : this._config.series_in_graph;
    const colors = brush ? this._brushColors : this._colors;
    return {
      gradient: {
        type: 'vertical',
        colorStops: series.map((serie, index) => {
          if (!serie.color_threshold || ![undefined, 'area', 'line'].includes(serie.type)) return [];
          const min = this._graphs?.[serie.index]?.min;
          const max = this._graphs?.[serie.index]?.max;
          if (min === undefined || max === undefined) return [];
          return this._computeFillColorStops(serie, min, max, computeColor(colors[index]), serie.invert) || [];
        }),
      },
    };
  }

  private _computeFillColorStops(
    serie: ChartCardSeriesConfig,
    min: number,
    max: number,
    defColor: string,
    invert = false,
  ): { offset: number; color: string; opacity: number }[] | undefined {
    if (!serie.color_threshold) return undefined;
    const scale = max - min;

    const result = serie.color_threshold.flatMap((thres, index, arr) => {
      if (
        (thres.value > max && arr[index - 1] && arr[index - 1].value > max) ||
        (thres.value < min && arr[index + 1] && arr[index + 1].value < min)
      ) {
        return [];
      }
      let color: string | undefined = undefined;
      const defaultOp = serie.opacity !== undefined ? serie.opacity : serie.type === 'area' ? DEFAULT_AREA_OPACITY : 1;
      let opacity = thres.opacity === undefined ? defaultOp : thres.opacity;
      if (thres.value > max && arr[index - 1]) {
        const factor = (max - arr[index - 1].value) / (thres.value - arr[index - 1].value);
        color = interpolateColor(
          new TinyColor(arr[index - 1].color || defColor).toHexString(),
          new TinyColor(thres.color || defColor).toHexString(),
          factor,
        );

        const prevOp = arr[index - 1].opacity === undefined ? defaultOp : arr[index - 1].opacity!;

        const curOp = thres.opacity === undefined ? defaultOp : thres.opacity!;

        if (prevOp > curOp) {
          opacity = (prevOp - curOp) * (1 - factor) + curOp;
        } else {
          opacity = (curOp - prevOp) * factor + prevOp;
        }
        opacity = opacity < 0 ? -opacity : opacity;
      } else if (thres.value < min && arr[index + 1]) {
        const factor = (arr[index + 1].value - min) / (arr[index + 1].value - thres.value);
        color = interpolateColor(
          new TinyColor(arr[index + 1].color || defColor).toHexString(),
          new TinyColor(thres.color || defColor).toHexString(),
          factor,
        );

        const nextOp = arr[index + 1].opacity === undefined ? defaultOp : arr[index + 1].opacity!;

        const curOp = thres.opacity === undefined ? defaultOp : thres.opacity!;
        if (nextOp > curOp) {
          opacity = (nextOp - curOp) * (1 - factor) + curOp;
        } else {
          opacity = (curOp - nextOp) * factor + nextOp;
        }
        opacity = opacity < 0 ? -opacity : opacity;
      }
      color = color || new TinyColor(thres.color || defColor).toHexString();
      if ([undefined, 'line'].includes(serie.type)) color = new TinyColor(color).setAlpha(opacity).toHex8String();
      const position = Math.max(0, Math.min(100, (max - thres.value) * (100 / scale)));
      return [
        {
          color: color || new TinyColor(thres.color || defColor).toHexString(),
          offset: scale <= 0 ? 0 : invert ? 100 - position : position,
          opacity,
        },
      ];
    });
    return invert ? result : result.reverse();
  }

  private _computeHeaderStateColor(serie: ChartCardSeriesConfig, value: number | null): string {
    let color = '';
    if (this._config?.header?.colorize_states) {
      if (
        this._config.experimental?.color_threshold &&
        serie.show.header_color_threshold &&
        serie.color_threshold &&
        serie.color_threshold.length > 0 &&
        value !== null
      ) {
        const index = serie.color_threshold.findIndex((thres) => {
          return thres.value > value;
        });
        if (index < 0) {
          color = computeColor(
            serie.color_threshold[serie.color_threshold.length - 1].color || this._headerColors[serie.index],
          );
        } else if (index === 0) {
          color = computeColor(serie.color_threshold[0].color || this._headerColors[serie.index]);
        } else {
          const prev = serie.color_threshold[index - 1];
          const next = serie.color_threshold[index];
          if (serie.type === 'column') {
            color = computeColor(prev.color || this._headerColors[serie.index]);
          } else {
            const factor = (value - prev.value) / (next.value - prev.value);
            color = interpolateColor(
              computeColor(prev.color || this._headerColors[serie.index]),
              computeColor(next.color || this._headerColors[serie.index]),
              factor,
            );
          }
        }
      } else {
        return this._headerColors && this._headerColors.length > 0 ? `color: ${this._headerColors[serie.index]};` : '';
      }
    }
    return color ? `color: ${color};` : '';
  }

  private _computeLastState(value: number | null, index: number): string | number | null {
    if (value === null) return value;
    return myFormatNumber(value, this._hass?.locale, this._config?.series[index].float_precision);
  }

  /*
    Makes the chart start and end at the first / last timestamp of the data when everything displayed is a
    column and group_by is enabled for every serie
  */
  private _findStartAndEndOfChart(start: Date, end: Date, brush: boolean): { start: number; end: number } {
    let offsetStart: number | undefined = 0;
    let offsetEnd: number | undefined = 0;
    const series = brush ? this._config?.series_in_brush : this._config?.series_in_graph;
    const onlyGroupBy = series?.reduce((acc, serie) => {
      return acc && serie.group_by.func !== 'raw';
    }, series?.length > 0);
    if (onlyGroupBy) {
      const range = end.getTime() - start.getTime();
      // Calendar buckets (group_by.period) already start and end on period
      // boundaries: they need no trimming.
      offsetStart = series?.reduce((acc, serie) => {
        if (serie.group_by.period) return acc === -1 ? 0 : Math.min(acc, 0);
        const dur = parse(serie.group_by.duration)!;
        const off = ((parse(serie.group_by.offset)! % dur) + dur) % dur; // Any possible offset is identiacal to one within [0, duration)
        if (acc === -1 || (range + off) % dur < acc) return (range + off) % dur;
        return acc;
      }, -1);
      offsetEnd = series?.reduce((acc, serie) => {
        if (serie.group_by.period) return acc === -1 ? 0 : Math.min(acc, 0);
        const dur = parse(serie.group_by.duration)!;
        const off = ((parse(serie.group_by.offset)! % dur) + dur) % dur; // Any possible offset is identiacal to one within [0, duration)
        if (acc === -1 || dur - off < acc) return dur - off;
        return acc;
      }, -1);
    }
    return {
      start: new Date(start.getTime() + (offsetStart ?? 0)).getTime(),
      end: new Date(end.getTime() - (offsetEnd ?? 0)).getTime(),
    };
  }

  private _invertData(data: EntityCachePoints): EntityCachePoints {
    return data.map((item) => {
      if (item[1] === null) return item;
      return [item[0], -item[1]];
    });
  }

  private _getSpanDates(): { start: Date; end: Date } {
    let end = new Date();
    let start = new Date(end.getTime() - this._graphSpan + 1);
    const timeZone = displayTimeZone(this._hass);
    if (this._config?.span?.start) {
      // Just Span
      start = new Date(startOf(end.getTime(), this._config.span.start, timeZone));
      end = new Date(start.getTime() + this._graphSpan);
    } else if (this._config?.span?.end) {
      end = new Date(endOf(end.getTime(), this._config.span.end, timeZone) + 1);
      start = new Date(end.getTime() - this._graphSpan + 1);
    }
    if (this._offset) {
      end.setTime(end.getTime() + this._offset);
      start.setTime(start.getTime() + this._offset);
    }
    return { start, end };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private _handleAction(ev: any, serieConfig: ChartCardSeriesConfig) {
    if (ev.detail?.action) {
      const isExternalStat = isExternalStatisticId(serieConfig.entity);
      // Without explicit header_actions the default action is more-info,
      // which cannot open on an external statistic ID.
      if (isExternalStat && !serieConfig.header_actions) return;
      const configDup: ActionsConfig = serieConfig.header_actions
        ? JSON.parse(JSON.stringify(serieConfig.header_actions))
        : {};

      switch (ev.detail.action) {
        case 'tap':
        case 'hold':
        case 'double_tap':
          configDup.entity =
            actionEntity(configDup, ev.detail.action) || (isExternalStat ? undefined : serieConfig.entity);

          handleAction(this, this._hass!, configDup, ev.detail.action);
          break;
        default:
          break;
      }
    }
    return;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private _handleTitleAction(ev: any) {
    if (ev.detail?.action) {
      const configDup: ActionsConfig = this._config?.header?.title_actions
        ? JSON.parse(JSON.stringify(this._config?.header?.title_actions))
        : {};

      switch (ev.detail.action) {
        case 'tap':
        case 'hold':
        case 'double_tap':
          configDup.entity = actionEntity(configDup, ev.detail.action);

          handleAction(this, this._hass!, configDup, ev.detail.action);
          break;
        default:
          break;
      }
    }
    return;
  }

  // backward compatibility
  @eventOptions({ passive: true })
  private handleRippleActivate(evt: Event, index: number | string): void {
    const r = this.shadowRoot?.getElementById(`ripple-${index}`) as Ripple;
    if (r && typeof r.startPress === 'function') r.startPress(evt);
  }

  private handleRippleDeactivate(_: Event, index: number | string): void {
    const r = this.shadowRoot?.getElementById(`ripple-${index}`) as Ripple;
    if (r && typeof r.endPress === 'function') r.endPress();
  }

  private handleRippleFocus(_: Event, index: number | string): void {
    const r = this.shadowRoot?.getElementById(`ripple-${index}`) as Ripple;
    if (r && typeof r.startFocus === 'function') r.startFocus();
  }

  private handleRippleBlur(_: Event, index: number | string): void {
    const r = this.shadowRoot?.getElementById(`ripple-${index}`) as Ripple;
    if (r && typeof r.endFocus === 'function') r.endFocus();
  }

  public getCardSize(): number {
    return 3;
  }

  public getGridOptions(): { columns: number | 'full'; rows: number | 'auto'; min_columns: number; min_rows: number } {
    // Charts are content-driven: HA only fixes the card height when `rows` is a
    // number (fit-rows), which would truncate legends/extra series. `rows: 'auto'`
    // lets the section grid size the card from its content; user-set grid_options
    // from the resize handle still win over these defaults.
    return {
      columns: 12,
      rows: 'auto',
      min_columns: 6,
      min_rows: 2,
    };
  }

  static getStubConfig(hass: HomeAssistant, entities: string[], entitiesFallback: string[]) {
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

  static async getConfigElement(): Promise<HTMLElement> {
    await import('./editor/index');
    return document.createElement('apexcharts-card-editor');
  }
}

// Configure the preview in the Lovelace card picker
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
