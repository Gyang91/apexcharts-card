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
  isComputedSeries,
  seriesState,
  computeUom,
  decompress,
  formatApexDate,
  getLang,
  getPercentFromValue,
  isExternalStatisticId,
  log,
  mergeDeep,
  myFormatNumber,
  offsetData,
  prettyPrintTime,
  parseNumericState,
  truncateFloat,
  validateInterval,
  validateOffset,
  getLovelace,
  isUsingServerTimezone,
} from './utils';
import { getStatisticsMetadata } from './recorder';
import { addPeriods, displayTimeZone, navigationRange } from './calendar';
import { computeTimezoneDiffWithLocal, endOf, startOf } from './zone';
import ApexCharts from 'apexcharts';
import type { ApexOptions } from 'apexcharts';
import { Ripple } from '@material/mwc-ripple';
import { stylesApex } from './styles';
import { computeAnnotations } from './annotations';
import {
  computeChartColors,
  computeHeaderStateColor,
  computeThresholdFill,
  thresholdGradientSeries,
  ThresholdColorFn,
} from './series-colors';
import {
  applySeriesDefaults,
  checkSchemaAndMergeAllSeries,
  checkSeries,
  checkSpanAndNavigation,
  checkVisualChart,
  checkYAxes,
  prepareConfig,
} from './config';
import { getStubConfig, registerCustomCard } from './card-picker';
import { computeYAxisAutoMinMax, generateYAxisConfig, getTypeOfMinMax, YAxisDataSource } from './yaxis';
import { HassEntity } from 'home-assistant-js-websocket';
import { getBrushLayoutConfig, getLayoutConfig } from './apex-layouts';
import { entityNamesChanged } from './entity-name';
import GraphEntry from './graphEntry';
import { ActionsConfig, ChartCardExternalConfig, NavigationPeriod } from './types-config';
import { DEFAULT_UPDATE_DELAY, NO_VALUE, TIMESERIES_TYPES } from './const';
import { DEFAULT_COLORS, DEFAULT_GRAPH_SPAN, HOUR_24 } from './const';
import parse from 'parse-duration';
import { actionHandler } from './action-handler-directive';
import { setLocale, t } from './localize';
import { downsample, SamplingRange } from './downsample';
import { assertHeatmapBudget, heatmapData, rangeAreaData } from './visual-data';

// Options passed to ApexCharts' updateOptions on each refresh
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ChartUpdate = any;

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

  private _entities: (HassEntity | undefined)[] = [];

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

  private _navigationPeriod: NavigationPeriod = 'day';

  private _navigationAnchor?: number;

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
    }
    this._startIntervalTimer();
  }

  disconnectedCallback() {
    this._stopIntervalTimer();
    // ApexCharts adds a window resize listener that only destroy() removes, so a chart left
    // alive here keeps the whole card in memory after HA discards it (dashboard save or
    // navigation). connectedCallback rebuilds it, and the resize observer, via _initialLoad().
    this._destroyCharts();
    super.disconnectedCallback();
  }

  // `update_interval` refreshes; one timer at most, only while connected
  private _startIntervalTimer(): void {
    this._stopIntervalTimer();
    if (this._config?.update_interval && this._interval) {
      this._intervalTimeout = setInterval(() => this._updateOnInterval(), this._interval);
    }
  }

  private _stopIntervalTimer(): void {
    if (this._intervalTimeout !== undefined) {
      clearInterval(this._intervalTimeout);
      this._intervalTimeout = undefined;
    }
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
        this._config.series_in_graph.forEach((serie) => {
          if (serie.show.hidden_by_default) {
            const name = computeName(this._hass, serie.index, this._config?.series, this._entities);
            this._apexChart?.hideSeries(name);
          }
        });
      }
    });
  }

  public set hass(hass: HomeAssistant) {
    const oldHass = this._hass;
    this._hass = hass;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    setLocale((hass as any)?.locale?.language || hass?.language);
    if (!this._config || !this._graphs || !hass) return;

    // A device or area rename changes names but no entity state: redraw the
    // header now, the chart takes the new names on its next refresh
    if (entityNamesChanged(oldHass, hass)) this.requestUpdate();

    this._graphs.forEach((graph) => {
      if (graph) graph.hass = hass;
    });

    let updated = false;
    let rawHeaderStatesUpdated = false;
    this._config.series.forEach((serie, index) => {
      // A computed series has no entity: it follows the series it is computed from
      if (isComputedSeries(serie)) return;
      if (isExternalStatisticId(serie.entity)) {
        // No state object exists for external statistic IDs: keep a stable
        // synthetic entity (enriched with recorder metadata once fetched) so
        // the card doesn't warn and name/unit resolution keeps working.
        if (!this._entities[index]) {
          this._entities[index] = this._buildExternalStatisticEntity(serie.entity);
        }
        return;
      }
      const entityState = seriesState(hass, serie);
      if (!entityState) {
        this._entities[index] = entityState;
      } else if (entityState && this._entities[index] !== entityState) {
        this._entities[index] = entityState;
        updated = true;
        if (serie.show.in_header === 'raw') {
          this._headerState[index] = truncateFloat(
            serie.attribute
              ? entityState.attributes[serie.attribute]
              : parseNumericState(entityState.state, entityState.entity_id.startsWith('binary_sensor.')),
            serie.float_precision,
          ) as number;
          rawHeaderStatesUpdated = true;
        }
      }
    });
    if (rawHeaderStatesUpdated) {
      this._headerState = [...this._headerState];
    }
    if (this._hasMissingEntity()) {
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

  // All or nothing: a config that fails leaves the card as it was, and a
  // valid one starts from the defaults, not from the previous config.
  public setConfig(config: ChartCardExternalConfig) {
    const configDup = prepareConfig(config, getLovelace);
    try {
      checkSchemaAndMergeAllSeries(configDup);
      checkVisualChart(configDup);
      const interval = configDup.update_interval
        ? validateInterval(configDup.update_interval, 'update_interval')
        : undefined;
      const graphSpan = configDup.graph_span ? validateInterval(configDup.graph_span, 'graph_span') : HOUR_24;
      const offset = configDup.span?.offset ? validateOffset(configDup.span.offset, 'span.offset') : 0;
      checkSpanAndNavigation(configDup);
      const brushSelectionSpan = configDup.brush?.selection_span
        ? validateInterval(configDup.brush.selection_span, 'brush.selection_span')
        : 0;
      const { offsets: seriesOffset, timeDeltas: seriesTimeDelta } = checkSeries(configDup);
      const updateDelay = configDup.update_delay
        ? validateInterval(configDup.update_delay, `update_delay`)
        : DEFAULT_UPDATE_DELAY;

      const newConfig: ChartCardConfig = mergeDeep(
        {
          graph_span: DEFAULT_GRAPH_SPAN,
          cache: true,
          useCompress: false,
          show: { loading: true },
        },
        configDup,
      );

      const defColors = newConfig.color_list || DEFAULT_COLORS;
      const headerColors: string[] = [];
      const colors: string[] = [];
      const brushColors: string[] = [];
      let yAxisConfig: ChartCardYAxis[] | undefined;
      const editMode = getLovelace()?.editMode;
      const graphs = newConfig.series.map((serie, index) => {
        serie.index = index;
        serie.ignore_history = !!(
          newConfig.chart_type &&
          ['donut', 'pie', 'radialBar'].includes(newConfig.chart_type) &&
          (!serie.group_by || serie.group_by?.func === 'raw') &&
          !serie.data_generator &&
          !isComputedSeries(serie) &&
          !serie.statistics &&
          !serie.offset
        );
        headerColors[index] = serie.color || defColors[index % defColors.length];
        applySeriesDefaults(serie, index, newConfig.chart_type);
        if (serie.entity || isComputedSeries(serie)) {
          // disable caching for editor
          const caching = editMode === true ? false : newConfig.cache;
          const graphEntry = new GraphEntry(index, graphSpan, caching, serie, newConfig.span);
          if (this._hass) graphEntry.hass = this._hass;
          return graphEntry;
        }
        return undefined;
      });
      newConfig.series_in_graph = [];
      newConfig.series_in_brush = [];
      newConfig.series.forEach((serie, index) => {
        if (serie.show.in_chart) {
          colors.push(headerColors[index]);
          newConfig.series_in_graph.push(serie);
        }
        if (newConfig.experimental?.brush && serie.show.in_brush) {
          brushColors.push(headerColors[index]);
          newConfig.series_in_brush.push(serie);
        }
      });
      checkYAxes(newConfig);
      if (newConfig.yaxis) {
        const generated = generateYAxisConfig(newConfig);
        yAxisConfig = generated?.yAxes;
        if (newConfig.apex_config) {
          newConfig.apex_config.yaxis = generated?.apexYAxes;
        } else {
          newConfig.apex_config = { yaxis: generated?.apexYAxes };
        }
        yAxisConfig?.forEach((yaxis) => {
          [yaxis.min, yaxis.min_type] = getTypeOfMinMax(yaxis.min);
          [yaxis.max, yaxis.max_type] = getTypeOfMinMax(yaxis.max);
        });
      }

      // Everything is valid: switch the card to the new config
      this._interval = interval;
      this._graphSpan = graphSpan;
      this._offset = offset;
      this._navigationPeriod = configDup.navigation?.initial ?? 'day';
      this._navigationAnchor = undefined;
      this._brushSelectionSpan = brushSelectionSpan;
      this._seriesOffset = seriesOffset;
      this._seriesTimeDelta = seriesTimeDelta;
      this._updateDelay = updateDelay;
      this._headerColors = headerColors;
      this._colors = colors;
      this._brushColors = brushColors;
      this._yAxisConfig = yAxisConfig;
      this._graphs = graphs;
      this._config = newConfig;
      // A connected card keeps its timer from connectedCallback: follow the new interval
      if (this.isConnected) this._startIntervalTimer();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (e: any) {
      throw new Error(`/// apexcharts-card version ${pjson.version} /// ${e.message}`, { cause: e });
    }
    // Full reset only happens in editor mode
    // this._reset();
  }

  static get styles(): CSSResultGroup {
    return stylesApex;
  }

  protected render(): TemplateResult {
    if (!this._config || !this._hass) return html``;
    if (this._warning || this._hasMissingEntity()) {
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
          ${this._renderNavigation()}
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
            this._isEntityMissing(index)
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

  private _renderNavigation(): TemplateResult {
    if (!this._config?.navigation?.show) return html``;
    const { start, end } = this._getSpanDates();
    const formatter = new Intl.DateTimeFormat(getLang(this._config, this._hass), {
      timeZone: displayTimeZone(this._hass),
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
    const busy = this._updating || !this._dataLoaded;
    return html` <nav class="time-navigation" aria-label=${t('navigation.label')}>
      <div class="time-navigation-buttons">
        <div class="time-navigation-group">
          ${(['day', 'week', 'month'] as const).map(
            (period) => html`
              <button
                type="button"
                aria-pressed=${this._navigationPeriod === period}
                ?disabled=${busy}
                @click=${() => this._navigate(period)}
              >
                ${t(`common.period.${period}`)}
              </button>
            `,
          )}
        </div>
        <div class="time-navigation-group">
          <button
            type="button"
            aria-label=${t('navigation.previous')}
            ?disabled=${busy}
            @click=${() => this._navigate(this._navigationPeriod, -1)}
          >
            &#x2039;
          </button>
          <button type="button" ?disabled=${busy} @click=${() => this._navigate(this._navigationPeriod, 0)}>
            ${t('navigation.current')}
          </button>
          <button
            type="button"
            aria-label=${t('navigation.next')}
            ?disabled=${busy}
            @click=${() => this._navigate(this._navigationPeriod, 1)}
          >
            &#x203a;
          </button>
        </div>
      </div>
      <div class="time-navigation-range" role="status" aria-live="polite">
        ${formatter.format(start)} &ndash; ${formatter.format(new Date(end.getTime() - 1))}
      </div>
    </nav>`;
  }

  private async _navigate(period: NavigationPeriod, direction?: number): Promise<void> {
    if (!this._config?.navigation?.show || this._updating || !this._apexChart) return;
    const timeZone = displayTimeZone(this._hass);
    this._navigationAnchor =
      direction === undefined || direction === 0
        ? undefined
        : addPeriods(this._getSpanDates().start.getTime(), this._navigationPeriod, direction, timeZone);
    this._navigationPeriod = period;
    this._graphs?.forEach((graph) => graph?.resetHistory());
    this._brushInit = false;
    this._updating = true;
    await this._updateData();
    this.requestUpdate();
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
              (this._hasNoEntityState(index) && !serie.header_actions) ||
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
                  stateClasses === 'actions'
                    ? computeName(this._hass, index, this._config?.series, this._entities)
                    : undefined,
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
                    ? html`<div id="state__name">
                        ${computeName(this._hass, index, this._config?.series, this._entities)}
                      </div>`
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
        this._configureThresholdGradients(chartCfg, false);
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
          this._configureThresholdGradients(brushCfg as ApexOptions, true);
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

  // color_threshold stops span each series' min..max. ApexCharts sizes a vertical
  // gradient to each path's own bounding box, so a line split by null values gave
  // the same value different colors in each piece (RomRider#1111). After every
  // draw, span each threshold gradient over the series' min..max in plot
  // coordinates instead: the same as before for a line without gaps.
  private _configureThresholdGradients(layout: ApexOptions, brush: boolean): void {
    if (!this._thresholdGradientSeries(brush).length) return;
    layout.chart ??= {};
    layout.chart.events ??= {};
    const events = layout.chart.events;
    (['mounted', 'updated'] as const).forEach((name) => {
      const custom = events[name];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      events[name] = (chart: any, options?: any) => {
        custom?.(chart, options);
        this._anchorThresholdGradients(chart, brush);
      };
    });
  }

  private _thresholdGradientSeries(brush: boolean): { serie: ChartCardSeriesConfig; index: number }[] {
    return thresholdGradientSeries(this._config, brush);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private _anchorThresholdGradients(chart: any, brush: boolean): void {
    const w = chart?.w;
    const root: ParentNode | undefined = chart?.el;
    if (!w?.globals || !w.layout || !root) return;
    this._thresholdGradientSeries(brush).forEach(({ serie, index }) => {
      const graph = this._graphs?.[serie.index];
      const axisMin = w.globals.minYArr?.[index];
      const axisMax = w.globals.maxYArr?.[index];
      const axis = w.config?.yaxis?.[w.globals.seriesYAxisReverseMap?.[index] ?? 0];
      if (graph?.min === undefined || graph?.max === undefined || graph.min === graph.max) return;
      if (typeof axisMin !== 'number' || typeof axisMax !== 'number' || axisMax <= axisMin) return;
      if (axis?.logarithmic || axis?.reversed) return;
      // Offset 0 of the stops is the highest value drawn, 100 the lowest
      const top = serie.invert ? -graph.min : graph.max;
      const bottom = serie.invert ? -graph.max : graph.min;
      const toY = (value: number) => (w.layout.gridHeight * (axisMax - value)) / (axisMax - axisMin);
      const ids = new Set<string>();
      root.querySelectorAll(`.apexcharts-series[data\\:realIndex="${index}"] path`).forEach((path) => {
        ['fill', 'stroke'].forEach((attribute) => {
          const id = /^url\(["']?#([^"')]+)["']?\)$/.exec(path.getAttribute(attribute) ?? '')?.[1];
          if (id) ids.add(id);
        });
      });
      ids.forEach((id) => {
        const gradient = root.querySelector(`linearGradient[id="${id}"]`);
        if (!gradient) return;
        gradient.setAttribute('gradientUnits', 'userSpaceOnUse');
        gradient.setAttribute('x1', '0');
        gradient.setAttribute('x2', '0');
        gradient.setAttribute('y1', String(toY(top)));
        gradient.setAttribute('y2', String(toY(bottom)));
      });
    });
  }

  private _canSample(index: number, brush: boolean): boolean {
    if (!this._config?.downsample || (this._config.chart_type && this._config.chart_type !== 'line')) return false;
    const apex = brush ? this._config.brush?.apex_config : this._config.apex_config;
    if (this._config.stacked || apex?.chart?.stacked) return false;
    if (apex?.chart?.type && !['line', 'area'].includes(apex.chart.type)) return false;
    const config = (brush ? this._config.series_in_brush : this._config.series_in_graph)[index];
    if (!config || config.type === 'column') return false;
    const curves = apex?.stroke?.curve;
    const curve =
      typeof curves === 'string' ? curves : (config.curve ?? (Array.isArray(curves) ? curves[index] : curves));
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

  // A series whose entity isn't in Home Assistant (computed series have none)
  private _isEntityMissing(index: number): boolean {
    return !isComputedSeries(this._config?.series[index]) && this._entities[index] === undefined;
  }

  private _hasMissingEntity(): boolean {
    return !!this._config?.series.some((_, index) => this._isEntityMissing(index));
  }

  // External statistics and computed series have no entity state: no live
  // value, no more-info dialog.
  private _hasNoEntityState(index: number): boolean {
    const serie = this._config?.series[index];
    return isComputedSeries(serie) || isExternalStatisticId(serie?.entity);
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

    const caching = editMode === true || this._config.navigation?.show ? false : this._config!.cache;
    let errorMessage = t('card.warning.refreshFailed');
    try {
      // Reusing GraphEntry while its previous fetch is pending would skip the new refresh.
      await this._historyUpdate;
      if (this._samplingUpdate) await this._samplingUpdate;
      if (!current()) return;
      if (this._config.chart_type === 'heatmap') {
        assertHeatmapBudget(
          this._config.series_in_graph,
          start.getTime(),
          end.getTime(),
          displayTimeZone(this._hass),
          this._config.heatmap?.max_cells,
        );
      }
      const historyUpdate = this._updateHistories(start, end, caching);
      this._historyUpdate = historyUpdate;
      const results = await historyUpdate;
      if (this._historyUpdate === historyUpdate) this._historyUpdate = undefined;
      // The chart was destroyed (card disconnected) while history loaded. Leave _updating
      // alone: disconnect already reset it and a reconnect may have started a fresh load.
      if (!current()) return;
      const failedIndex = results.findIndex((result) => result.status === 'rejected');
      if (failedIndex !== -1) {
        const failed = this._config.series[failedIndex];
        errorMessage = isComputedSeries(failed)
          ? t('card.warning.computeFailed', { series: computeName(this._hass, failedIndex, this._config.series) })
          : t('card.warning.historyFailed', { entity: failed.entity ?? '' });
        const failure = results[failedIndex];
        if (failure.status === 'rejected') throw failure.reason;
      }
      let graphData: ChartUpdate;
      let brushData: ChartUpdate = { series: [] };
      let visualEmpty: boolean | undefined;
      if (TIMESERIES_TYPES.includes(this._config.chart_type)) {
        ({ graphData, brushData } = this._timelineData(start, end, now));
      } else {
        graphData = this._valueData();
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
      if (this._config.chart_type === 'rangeArea' || this._config.chart_type === 'heatmap') {
        visualEmpty = this._reshapeVisualSeries(graphData);
      }
      if (this._hasSampling()) {
        this._samplingSeries = { main: graphData.series, brush: brushData.series };
        this._samplingKey = undefined;
        graphData.series = this._sampleSeries(graphData.series, false, this._readChartRange(chart));
        brushData.series = this._sampleSeries(brushData.series, true);
      }
      this._applySeriesColors(graphData, brushData);
      this._headerState = [...this._headerState];
      const brushSelection = this._brushSelection(start, end, graphData, brushData);
      const chartUpdates: Promise<unknown>[] = [];
      chartUpdates.push(
        this._apexChart?.updateOptions(
          graphData,
          false,
          TIMESERIES_TYPES.includes(this._config.chart_type) ? false : true,
        ),
      );
      if (this._apexBrush && brushSelection) {
        const selectionColor = computeColor('var(--primary-text-color)');
        brushData.chart = {
          selection: {
            enabled: true,
            xaxis: { ...brushSelection },
            stroke: { color: selectionColor },
            fill: { color: selectionColor, opacity: 0.1 },
          },
        };
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
        visualEmpty ??
        (this._config.series_in_graph.length > 0 &&
          !this._config.series_in_graph.some((serie) =>
            this._graphs?.[serie.index]?.history.some(([, value]) => value !== null && Number.isFinite(value)),
          ));
    } catch (err) {
      if (current()) {
        log(err);
        this._loadError =
          this._config.chart_type === 'rangeArea' || this._config.chart_type === 'heatmap'
            ? `${errorMessage} ${err instanceof Error ? err.message : ''}`
            : errorMessage;
      }
    } finally {
      if (current()) {
        this._updating = false;
        this._queueResample();
      }
    }
  }

  // Timeline charts: header states, and the series of the main chart and brush
  // with their offsets, extend_to and invert applied
  private _timelineData(start: Date, end: Date, now: Date): { graphData: ChartUpdate; brushData: ChartUpdate } {
    const graphData: ChartUpdate = { series: [] };
    const brushData: ChartUpdate = { series: [] };
    this._graphs!.forEach((graph, index) => {
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
      } else if (inHeader === 'raw' && this._hasNoEntityState(index)) {
        // Without an entity state, `raw` shows the latest value instead.
        this._headerState[index] = graph.lastState;
      }
      if (!this._config?.series[index].show.in_chart && !this._config?.series[index].show.in_brush) {
        return;
      }
      // Names go with every refresh so a renamed entity, device or area shows up
      const name = computeName(this._hass, index, this._config?.series, this._entities);
      if (graph.history.length === 0) {
        if (this._config?.series[index].show.in_chart) graphData.series.push({ name, data: [] });
        if (this._config?.series[index].show.in_brush) brushData.series.push({ name, data: [] });
        return;
      }
      let data: EntityCachePoints;
      const offset = this._serverTimeOffset + (this._seriesOffset[index] || 0) - (this._seriesTimeDelta[index] || 0);
      if (offset) {
        data = offsetData(graph.history, offset);
      } else {
        data = [...graph.history];
      }
      if (this._config?.series[index].type !== 'column' && this._config?.series[index].extend_to) {
        const lastPoint = data.slice(-1)[0]!;
        if (this._config?.series[index].extend_to === 'end' && lastPoint[0] < end.getTime() - this._serverTimeOffset) {
          data.push([end.getTime() - this._serverTimeOffset, lastPoint[1]]);
        } else if (
          this._config?.series[index].extend_to === 'now' &&
          lastPoint[0] < now.getTime() - this._serverTimeOffset
        ) {
          data.push([now.getTime() - this._serverTimeOffset, lastPoint[1]]);
        }
      }
      const result = { name, data: this._config?.series[index].invert ? this._invertData(data) : data };
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
    return { graphData, brushData };
  }

  // Pie, donut and radialBar: the latest value of each series, and the header states
  private _valueData(): ChartUpdate {
    return {
      series: this._graphs!.flatMap((graph, index) => {
        if (!graph) return [];
        let data: number;
        // Without an entity state, `raw` also resolves to the latest value.
        const computedHeader = this._config?.series[index].show.in_header !== 'raw' || this._hasNoEntityState(index);
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
      // Names go with every refresh so a renamed entity, device or area shows up
      labels: this._config!.series_in_graph.map((serie, index) =>
        computeName(this._hass, index, this._config!.series_in_graph, undefined, seriesState(this._hass, serie)),
      ),
    };
  }

  // rangeArea and heatmap: turn the series into the chart's own shape. Returns
  // whether a rangeArea has no data at all.
  private _reshapeVisualSeries(graphData: ChartUpdate): boolean | undefined {
    let visualEmpty: boolean | undefined;
    if (this._config!.chart_type === 'rangeArea') {
      const [lower, upper] = graphData.series as { name: string; data: EntityCachePoints }[];
      const data = rangeAreaData(lower.data, upper.data);
      visualEmpty = data.every((point) => point.y[0] === null);
      graphData.series = [{ name: `${lower.name} - ${upper.name}`, data }];
    } else if (this._config!.chart_type === 'heatmap') {
      const series = graphData.series as { name: string; data: EntityCachePoints }[];
      const rows = heatmapData(
        series.map((serie) => serie.data),
        this._config!.heatmap?.max_cells,
      );
      // Native datetime heatmaps position sparse cells by timestamp. Omit
      // missing cells: native heatmap shading otherwise treats null as zero.
      graphData.series = rows.map((data, row) => ({
        name: series[row].name,
        data: data.filter((point) => point.y !== null),
      }));
    }
    return visualEmpty;
  }

  // Series colors, and the markers, legend, tooltip and gradient fill of threshold colors
  private _applySeriesColors(graphData: ChartUpdate, brushData: ChartUpdate): void {
    const config = this._config!;
    graphData.colors = this._computeChartColors(false);
    if (config.chart_type === 'heatmap' && !config.color_list && !config.series.some((serie) => serie.color)) {
      graphData.colors = config.series.map(() => graphData.colors[0]);
    }
    if (this._apexBrush) {
      brushData.colors = this._computeChartColors(true);
    }
    if (config.experimental?.color_threshold && config.series.some((serie) => serie.color_threshold)) {
      graphData.markers = {
        colors: computeColors(
          config.series_in_graph.flatMap((serie, index) => {
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
  }

  // With a brush: the brush's x range, and the selection the main chart shows
  private _brushSelection(
    start: Date,
    end: Date,
    graphData: ChartUpdate,
    brushData: ChartUpdate,
  ): { min: number; max: number } | undefined {
    const currentRange = this._apexBrush ? this._readChartRange(this._apexChart!) : undefined;
    const brushRange = this._apexBrush ? this._readChartRange(this._apexBrush) : undefined;
    const brushIsAtEnd = currentRange && brushRange && currentRange.max === brushRange.max;
    // With a brush, the main chart shows the brush selection. Work it out
    // before updating either chart: without an x range of its own, a data
    // update would reset the main chart to the full graph span.
    let brushSelection: { min: number; max: number } | undefined;
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
        brushSelection = {
          min: Math.max(
            newMinMax.start,
            newMinMax.end - (this._brushSelectionSpan ? this._brushSelectionSpan : this._graphSpan / 4),
          ),
          max: newMinMax.end,
        };
      } else {
        const selectionWidth = Math.min(currentRange.max - currentRange.min, newMinMax.end - newMinMax.start);
        const selectionStart = Math.max(newMinMax.start, Math.min(currentRange.min, newMinMax.end - selectionWidth));
        brushSelection = { min: selectionStart, max: selectionStart + selectionWidth };
      }
      if (TIMESERIES_TYPES.includes(this._config!.chart_type)) {
        graphData.xaxis = { ...graphData.xaxis, min: brushSelection.min, max: brushSelection.max };
      }
    }
    return brushSelection;
  }

  // Loads every series. Computed series come last, in config order: each one
  // reads the series above it and every non-computed series.
  private async _updateHistories(
    start: Date,
    end: Date,
    caching: boolean,
  ): Promise<PromiseSettledResult<boolean | undefined>[]> {
    const series = this._config!.series;
    const update = (index: number) => {
      const graph = this._graphs?.[index];
      if (!graph) return undefined;
      graph.cache = caching;
      const offset = this._seriesOffset[index] || 0;
      return graph._updateHistory(
        new Date(start.getTime() + offset),
        new Date(end.getTime() + offset),
        isComputedSeries(series[index]) ? this._computeInputs(index) : undefined,
      );
    };
    const results = await Promise.allSettled(
      series.map((serie, index) => (isComputedSeries(serie) ? undefined : update(index))),
    );
    for (const [index, serie] of series.entries()) {
      if (isComputedSeries(serie)) [results[index]] = await Promise.allSettled([update(index)]);
    }
    return results;
  }

  // Inputs of a computed series, by series `id`, on the chart's time axis (each
  // source's own `offset` and `time_delta` applied): every non-computed series
  // and every computed series above it.
  private _computeInputs(index: number): Record<string, EntityCachePoints> {
    const inputs: Record<string, EntityCachePoints> = {};
    this._config!.series.forEach((serie, source) => {
      if (serie.id === undefined || source === index || (isComputedSeries(serie) && source > index)) return;
      const shift = (this._seriesOffset[source] || 0) - (this._seriesTimeDelta[source] || 0);
      inputs[serie.id] = offsetData(this._graphs?.[source]?.history ?? [], shift);
    });
    return inputs;
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
    return computeAnnotations(
      {
        config: this._config,
        hass: this._hass,
        colors: this._colors,
        source: {
          minMax: (serie, from, to, timeOffset) =>
            this._graphs?.[serie.index]?.minMaxWithTimestamp(from, to, timeOffset),
          offset: (serie) => this._seriesOffset[serie.index],
          timeOffset: (serie) => this._serverTimeOffset - (this._seriesTimeDelta[serie.index] || 0),
        },
      },
      start,
      end,
      now,
    );
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
    return computeYAxisAutoMinMax(this._config, this._yAxisConfig, start, end, this._yAxisDataSource());
  }

  // The card's series data, as the y-axis extremas read it
  private _yAxisDataSource(): YAxisDataSource {
    return {
      isHidden: (serie) => this._isHiddenInChart(serie),
      minMax: (serie, start, end) => this._graphs![serie.index]?.minMaxWithTimestampForYAxis(start, end),
      history: (serie) => this._graphs?.[serie.index]?.history ?? [],
      offset: (serie) => this._seriesOffset[serie.index] || 0,
    };
  }

  private _isHiddenInChart(serie: ChartCardSeriesConfig): boolean {
    return this._hiddenSeries
      ? this._hiddenSeries.has(serie.index)
      : !!(this._config?.experimental?.hidden_by_default && serie.show.hidden_by_default);
  }

  private _computeChartColors(brush: boolean): (string | ThresholdColorFn)[] {
    return computeChartColors(
      this._config,
      brush ? this._config?.series_in_brush : this._config?.series_in_graph,
      brush ? this._brushColors : this._colors,
    );
  }

  private _computeThresholdFill(brush: boolean): ApexOptions['fill'] {
    return computeThresholdFill(
      this._config,
      brush,
      brush ? this._brushColors : this._colors,
      (serie) => this._graphs?.[serie.index],
    );
  }

  private _computeHeaderStateColor(serie: ChartCardSeriesConfig, value: number | null): string {
    return computeHeaderStateColor(this._config, serie, value, this._headerColors);
  }

  private _computeLastState(value: number | null, index: number): string | number | null {
    if (value === null) return value;
    return myFormatNumber(value, this._hass?.locale, this._config?.series[index]);
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
    if (this._config?.navigation?.show) {
      return navigationRange(Date.now(), this._navigationPeriod, displayTimeZone(this._hass), this._navigationAnchor);
    }
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
    return getStubConfig(hass, entities, entitiesFallback);
  }

  static async getConfigElement(): Promise<HTMLElement> {
    await import('./editor/index');
    return document.createElement('apexcharts-card-editor');
  }
}

registerCustomCard();
