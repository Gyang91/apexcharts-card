import { stable } from '../helpers';
import { LitElement, html, TemplateResult, nothing, CSSResultGroup, PropertyValues } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { HomeAssistant } from 'custom-card-helpers';
import { editorStyles } from '../styles';
import {
  ChartCardAllSeriesExternalConfig,
  ChartCardExternalConfig,
  ChartCardSeriesExternalConfig,
} from '../../types-config';
import { isComputedSeries, isExternalStatisticId } from '../../utils';
import { COMPUTE_EXCLUDED_OPTIONS } from '../../const';
import { HaFormSchema } from '../types';
import {
  computeHelper,
  computeLabel,
  filterSchema,
  fromSelectValue,
  parseStrokeDash,
  serializeStrokeDash,
  SMOOTHING_PRESETS,
  smoothingOf,
  toSelectValue,
} from '../helpers';
import {
  getSeriesAdvancedBaseSchema,
  getSeriesAppearanceSchema,
  getSeriesCoreSchema,
  getSeriesDataProcessingSchema,
  getSeriesSourceSchema,
  SeriesSource,
  getSeriesGroupBySchema,
  getSmoothingSchema,
  getSeriesVisibilitySelectSchema,
  SERIES_VISIBILITY_BOOL_FIELDS,
} from '../schemas/series';
import { BoolField } from './bool-grid';
import { t } from '../localize';
import { Feature, supports } from '../support';
import './color-threshold-editor';
import './color-input';
import './actions-editor';
import './bool-grid';

type Series = ChartCardSeriesExternalConfig | ChartCardAllSeriesExternalConfig;

const seriesKey = (serie: Series | undefined) => {
  const s = serie as ChartCardSeriesExternalConfig | undefined;
  return `${s?.entity ?? ''}|${s?.id ?? ''}`;
};

// Series fields only some chart types use
const FIELD_FEATURES: Record<string, Feature> = {
  type: 'series_type',
  curve: 'line_style',
  stroke_width: 'line_style',
  stroke_dash: 'line_style',
  opacity: 'opacity',
  extend_to: 'extend_to',
  invert: 'invert',
  in_chart: 'in_chart',
  extremas: 'extremas',
  datalabels: 'datalabels',
  yaxis_id: 'yaxis',
};

// Body a new computed series starts with: valid, and shows where the values are
const COMPUTE_STARTER = 'return null; // e.g. return values.import - values.export;';

@customElement('apexcharts-card-series-item-editor')
export class ApexChartsCardSeriesItemEditor extends LitElement {
  @property({ attribute: false }) public hass?: HomeAssistant;
  @property({ attribute: false }) public config?: ChartCardExternalConfig;
  @property({ attribute: false }) public series?: Series;
  @property({ attribute: false }) public isAllSeriesConfig = false;

  static get styles(): CSSResultGroup {
    return editorStyles;
  }

  private _fire(updates: Partial<Series>): void {
    const next: Series = { ...(this.series || {}), ...updates };
    // Strip keys whose new value is undefined so the YAML stays clean
    for (const k of Object.keys(updates) as (keyof Series)[]) {
      if (updates[k] === undefined) {
        delete (next as Record<string, unknown>)[k as string];
      }
    }
    this.dispatchEvent(
      new CustomEvent('series-changed', {
        detail: { series: next },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private _applies = (name: string): boolean => !FIELD_FEATURES[name] || supports(this.config, FIELD_FEATURES[name]);

  private _source(): SeriesSource {
    return isComputedSeries(this.series as ChartCardSeriesExternalConfig | undefined) ? 'compute' : 'entity';
  }

  private _sourceChanged = (ev: CustomEvent): void => {
    ev.stopPropagation();
    const data = ev.detail.value as { source?: SeriesSource; entity?: string; compute?: string; id?: string };
    const updates: Partial<ChartCardSeriesExternalConfig> = {};
    if (data.source && data.source !== this._source()) {
      if (data.source === 'compute') {
        // A computed series reads other series: drop the options that pick an entity's data
        COMPUTE_EXCLUDED_OPTIONS.forEach((key) => (updates[key] = undefined));
        updates.compute = COMPUTE_STARTER;
      } else {
        Object.assign(updates, { compute: undefined, entity: '' });
      }
    } else if (this._source() === 'compute') {
      if ('compute' in data) updates.compute = data.compute ?? '';
    } else if ('entity' in data) {
      updates.entity = data.entity || '';
    }
    if ('id' in data) updates.id = data.id || undefined;
    this._fire(updates);
  };

  private _textName(): string {
    const name = this.series?.name;
    return typeof name === 'string' ? name : '';
  }

  private _coreChanged = (ev: CustomEvent): void => {
    ev.stopPropagation();
    const data = ev.detail.value as { name?: string; type?: string };
    const updates: Partial<Series> = {};
    // A structured name (YAML only) shows as empty and stays until a name is typed
    if ('name' in data && (data.name || '') !== this._textName()) updates.name = data.name || undefined;
    if ('type' in data) {
      updates.type = (data.type || undefined) as Series['type'];
    }
    this._fire(updates);
  };

  private _colorChanged = (ev: CustomEvent): void => {
    ev.stopPropagation();
    this._fire({ color: ev.detail.value } as Partial<Series>);
  };

  private _dataProcessingData(): Record<string, unknown> {
    const s = this.series || {};
    return {
      statistics: s.statistics || {},
      fill_raw: s.fill_raw,
      transform: s.transform,
      data_generator: s.data_generator,
    };
  }

  private _groupByData(): Record<string, unknown> {
    const g = this.series?.group_by || {};
    return {
      duration: g.duration || '',
      func: g.func || '',
      fill: g.fill || '',
      align: g.align || '',
    };
  }

  // Custom stays open once picked, even when its values happen to match a preset
  @state() private _customSmoothing = false;

  // The list reuses this element for whichever series sits at its place: choices made here
  // belong to the series, not the place
  protected willUpdate(changed: PropertyValues): void {
    const before = changed.get('series') as Series | undefined;
    if (before && seriesKey(before) !== seriesKey(this.series)) this._customSmoothing = false;
  }

  // Heatmaps need grouped points, unless the series reads statistics
  private _needsGrouping(): boolean {
    return this.config?.chart_type === 'heatmap' && !this.series?.statistics;
  }

  private _smoothing(): string {
    const preset = smoothingOf(this.series?.group_by);
    return this._customSmoothing ? 'custom' : preset;
  }

  private _smoothingChanged = (ev: CustomEvent): void => {
    ev.stopPropagation();
    const picked = (ev.detail.value as { smoothing?: string }).smoothing;
    this._customSmoothing = picked === 'custom';
    if (!picked || picked === 'custom') return;
    const g: NonNullable<Series['group_by']> = { ...(this.series?.group_by || {}) };
    delete g.func;
    delete g.duration;
    if (picked !== 'none') Object.assign(g, SMOOTHING_PRESETS[picked]);
    this._fire({ group_by: Object.keys(g).length > 0 ? g : undefined } as Partial<Series>);
  };

  private _groupByChanged = (ev: CustomEvent): void => {
    ev.stopPropagation();
    const data = ev.detail.value as { duration?: string; func?: string; fill?: string; align?: string };
    const g: NonNullable<Series['group_by']> = { ...(this.series?.group_by || {}) };
    if ('duration' in data) {
      if (data.duration) g.duration = data.duration;
      else delete g.duration;
    }
    if ('func' in data) {
      if (data.func) g.func = data.func as NonNullable<Series['group_by']>['func'];
      else delete g.func;
    }
    if ('fill' in data) {
      if (data.fill) g.fill = data.fill as NonNullable<Series['group_by']>['fill'];
      else delete g.fill;
    }
    if ('align' in data) {
      if (data.align) g.align = data.align as NonNullable<Series['group_by']>['align'];
      else delete g.align;
    }
    this._fire({ group_by: Object.keys(g).length > 0 ? g : undefined } as Partial<Series>);
  };

  private _dataProcessingChanged = (ev: CustomEvent): void => {
    ev.stopPropagation();
    const data = ev.detail.value as {
      statistics?: { type?: string; period?: string; align?: string };
      fill_raw?: string;
      transform?: string;
      data_generator?: string;
    };

    const updates: Partial<Series> = {};

    if (data.statistics) {
      const st: NonNullable<Series['statistics']> = {};
      if (data.statistics.type) st.type = data.statistics.type as NonNullable<Series['statistics']>['type'];
      if (data.statistics.period) st.period = data.statistics.period as NonNullable<Series['statistics']>['period'];
      if (data.statistics.align) st.align = data.statistics.align as NonNullable<Series['statistics']>['align'];
      updates.statistics = Object.keys(st).length > 0 ? st : undefined;
    }
    if ('fill_raw' in data) updates.fill_raw = (data.fill_raw || undefined) as Series['fill_raw'];
    if ('transform' in data) updates.transform = data.transform || undefined;
    if ('data_generator' in data) updates.data_generator = data.data_generator || undefined;

    this._fire(updates);
  };

  private _appearanceData(): Record<string, unknown> {
    const s = this.series || {};
    return {
      curve: s.curve || '',
      opacity: s.opacity,
      stroke_width: s.stroke_width,
      stroke_dash: serializeStrokeDash(s.stroke_dash),
      extend_to: toSelectValue(s.extend_to),
    };
  }

  private _appearanceChanged = (ev: CustomEvent): void => {
    ev.stopPropagation();
    const data = ev.detail.value as Record<string, unknown>;
    const updates: Partial<Series> = {};
    if ('curve' in data) updates.curve = (data.curve as Series['curve']) || undefined;
    if ('opacity' in data) updates.opacity = data.opacity === undefined ? undefined : Number(data.opacity);
    if ('stroke_width' in data)
      updates.stroke_width = data.stroke_width === undefined ? undefined : Number(data.stroke_width);
    if ('stroke_dash' in data) {
      const sd = parseStrokeDash(data.stroke_dash as string);
      updates.stroke_dash = sd;
    }
    if ('extend_to' in data) {
      const v = fromSelectValue(data.extend_to as string);
      if (v === false) updates.extend_to = false;
      else if (v === 'end' || v === 'now') updates.extend_to = v;
      else updates.extend_to = undefined;
    }
    this._fire(updates);
  };

  private _invertChanged = (ev: CustomEvent): void => {
    ev.stopPropagation();
    const { value } = ev.detail as { name: string; value: boolean };
    this._fire({ invert: value ? true : undefined } as Partial<Series>);
  };

  private _groupByStartWithLastChanged = (ev: CustomEvent): void => {
    ev.stopPropagation();
    const { value } = ev.detail as { name: string; value: boolean };
    const g: NonNullable<Series['group_by']> = { ...(this.series?.group_by || {}) };
    if (value) g.start_with_last = true;
    else delete g.start_with_last;
    this._fire({ group_by: Object.keys(g).length > 0 ? g : undefined } as Partial<Series>);
  };

  private _visibilitySelectData(): Record<string, unknown> {
    const show = (this.series?.show || {}) as Record<string, unknown>;
    return {
      in_header: toSelectValue(show.in_header as undefined),
      as_duration: toSelectValue(show.as_duration as undefined),
      extremas: toSelectValue(show.extremas as undefined),
      datalabels: toSelectValue(show.datalabels as undefined),
    };
  }

  private _visibilityBoolFields(): BoolField[] {
    const show = (this.series?.show || {}) as Record<string, unknown>;
    const fields: BoolField[] = SERIES_VISIBILITY_BOOL_FIELDS.filter(({ name }) => this._applies(name)).map(
      ({ name, defaultValue }) => ({
        name,
        label: computeLabel({ name } as HaFormSchema),
        value: (show[name] as boolean | undefined) ?? defaultValue,
      }),
    );
    if (this.config?.experimental?.color_threshold || this.series?.color_threshold?.length) {
      fields.push({
        name: 'header_color_threshold',
        label: computeLabel({ name: 'header_color_threshold' } as HaFormSchema),
        value: !!show.header_color_threshold,
      });
    }
    if (supports(this.config, 'hidden_by_default')) {
      fields.push({
        name: 'hidden_by_default',
        label: computeLabel({ name: 'hidden_by_default' } as HaFormSchema),
        value: !!show.hidden_by_default,
      });
    }
    if (this.config?.experimental?.brush) {
      fields.push({
        name: 'in_brush',
        label: computeLabel({ name: 'in_brush' } as HaFormSchema),
        value: !!show.in_brush,
      });
    }
    return fields;
  }

  private _visibilityBoolChanged = (ev: CustomEvent): void => {
    ev.stopPropagation();
    const { name, value } = ev.detail as { name: string; value: boolean };
    const show: Record<string, unknown> = { ...(this.series?.show || {}) };
    const def = SERIES_VISIBILITY_BOOL_FIELDS.find((f) => f.name === name);
    if (def) {
      // Persist only when value differs from the schema default
      if (value === def.defaultValue) delete show[name];
      else show[name] = value;
    } else {
      // Optional/experimental fields: persist only when true
      if (value) show[name] = true;
      else delete show[name];
    }
    this._fire({ show: Object.keys(show).length > 0 ? (show as Series['show']) : undefined });
  };

  private _visibilitySelectChanged = (ev: CustomEvent): void => {
    ev.stopPropagation();
    const data = ev.detail.value as Record<string, unknown>;
    const show: Record<string, unknown> = { ...(this.series?.show || {}) };
    for (const k of ['in_header', 'as_duration', 'extremas', 'datalabels']) {
      if (k in data) {
        const v = fromSelectValue(data[k] as string);
        if (v === undefined) delete show[k];
        else show[k] = v;
      }
    }
    this._fire({ show: Object.keys(show).length > 0 ? (show as Series['show']) : undefined });
  };

  private _advancedData(): Record<string, unknown> {
    const s = this.series || {};
    return {
      attribute: s.attribute,
      unit: s.unit,
      float_precision: s.float_precision,
      fixed_decimals: s.fixed_decimals,
      offset: s.offset,
      time_delta: s.time_delta,
      min: s.min,
      max: s.max,
      stack_group: s.stack_group,
    };
  }

  private _advancedSchema(): HaFormSchema[] {
    const schema: HaFormSchema[] = [...getSeriesAdvancedBaseSchema()];
    if (this.config?.chart_type === 'radialBar') {
      schema.push({
        type: 'grid',
        name: '',
        schema: [
          { name: 'min', selector: { number: { mode: 'box' } } },
          { name: 'max', selector: { number: { mode: 'box' } } },
        ],
      });
    }
    if (this.config?.stacked) {
      schema.push({ name: 'stack_group', selector: { text: {} } });
    }
    return schema;
  }

  private _yaxisIdSchema(): HaFormSchema[] {
    const yaxes = this.config?.yaxis;
    if (!yaxes || yaxes.length === 0) return [];
    const options = yaxes.filter((y) => y.id).map((y) => ({ value: y.id as string, label: y.id as string }));
    if (options.length === 0) return [];
    const currentId = (this.series as ChartCardSeriesExternalConfig | undefined)?.yaxis_id;
    if (currentId && !options.some((o) => o.value === currentId)) {
      options.push({ value: currentId, label: `${currentId} ${t('series.yaxisId.missing')}` });
    }
    return [
      {
        name: 'yaxis_id',
        selector: {
          select: {
            mode: 'dropdown',
            options: [{ value: '', label: t('common.defaultParen') }, ...options],
          },
        },
      },
    ];
  }

  private _yaxisIdChanged = (ev: CustomEvent): void => {
    ev.stopPropagation();
    const data = ev.detail.value as { yaxis_id?: string };
    const updates: Partial<Series> = {};
    if ('yaxis_id' in data) {
      (updates as Partial<ChartCardSeriesExternalConfig>).yaxis_id = data.yaxis_id || undefined;
    }
    if (Object.keys(updates).length === 0) return;
    this._fire(updates);
  };

  private _advancedChanged = (ev: CustomEvent): void => {
    ev.stopPropagation();
    const data = ev.detail.value as Record<string, unknown>;
    const updates: Partial<Series> = {};
    const stringKeys: (keyof Series)[] = ['attribute', 'unit', 'offset', 'time_delta', 'stack_group'];
    for (const k of stringKeys) {
      if (k in data) (updates as Record<string, unknown>)[k as string] = (data[k as string] as string) || undefined;
    }
    const numKeys: (keyof Series)[] = ['float_precision', 'min', 'max'];
    for (const k of numKeys) {
      if (k in data) {
        const v = data[k as string];
        (updates as Record<string, unknown>)[k as string] = v === undefined || v === '' ? undefined : Number(v);
      }
    }
    if ('fixed_decimals' in data) updates.fixed_decimals = data.fixed_decimals ? true : undefined;
    this._fire(updates);
  };

  private _thresholdsChanged = (ev: CustomEvent): void => {
    ev.stopPropagation();
    const value = ev.detail.value as ChartCardSeriesExternalConfig['color_threshold'];
    this._fire({ color_threshold: value && value.length > 0 ? value : undefined } as Partial<Series>);
  };

  private _actionsChanged = (ev: CustomEvent): void => {
    ev.stopPropagation();
    const value = ev.detail.value as ChartCardSeriesExternalConfig['header_actions'];
    this._fire({ header_actions: value } as Partial<Series>);
  };

  protected render(): TemplateResult {
    if (!this.hass || !this.series) return html``;
    const s = this.series as ChartCardSeriesExternalConfig;
    const showColorThreshold = !this.isAllSeriesConfig && supports(this.config, 'color_threshold');
    const showHeaderActions = !this.isAllSeriesConfig;
    // Hidden when the chart type uses none of its settings, as on heatmaps
    const appearance = filterSchema(getSeriesAppearanceSchema(), this._applies);
    const yaxisIdSchema = filterSchema(this._yaxisIdSchema(), this._applies);

    return html`
      <div class="section">
        ${
          this.isAllSeriesConfig
            ? nothing
            : html`
                <ha-form
                  .hass=${this.hass}
                  .data=${stable({ source: this._source(), entity: s.entity || '', compute: s.compute ?? '', id: s.id || '' })}
                  .schema=${stable(getSeriesSourceSchema(this._source(), !!s.statistics || isExternalStatisticId(s.entity)))}
                  .computeLabel=${computeLabel}
                  .computeHelper=${computeHelper}
                  @value-changed=${this._sourceChanged}
                ></ha-form>
                ${
                  this._source() === 'entity' && !s.entity
                    ? html`<div class="validation-error">${t('series.validation.entityRequired')}</div>`
                    : nothing
                }
              `
        }

        <ha-form
          .hass=${this.hass}
          .data=${stable({ name: this._textName(), type: s.type || '' })}
          .schema=${stable(filterSchema(getSeriesCoreSchema(), this._applies))}
          .computeLabel=${computeLabel}
          .computeHelper=${computeHelper}
          @value-changed=${this._coreChanged}
        ></ha-form>
        <apexcharts-card-color-input
          .value=${s.color}
          @value-changed=${this._colorChanged}
        ></apexcharts-card-color-input>

        ${
          yaxisIdSchema.length > 0
            ? html`
                <ha-form
                  .hass=${this.hass}
                  .data=${stable({ yaxis_id: s.yaxis_id || '' })}
                  .schema=${stable(yaxisIdSchema)}
                  .computeLabel=${computeLabel}
                  .computeHelper=${computeHelper}
                  @value-changed=${this._yaxisIdChanged}
                ></ha-form>
              `
            : nothing
        }
        ${
          appearance.length || this._applies('invert')
            ? html`<ha-expansion-panel outlined header=${t('series.panel.appearance')}>
                <div class="section">
                  <ha-form
                    .hass=${this.hass}
                    .data=${stable(this._appearanceData())}
                    .schema=${stable(appearance)}
                    .computeLabel=${computeLabel}
                    .computeHelper=${computeHelper}
                    @value-changed=${this._appearanceChanged}
                  ></ha-form>
                  ${
                    this._applies('invert')
                      ? html`<apexcharts-card-bool-grid
                          .fields=${[
                            {
                              name: 'invert',
                              label: computeLabel({ name: 'invert' } as HaFormSchema),
                              value: s.invert ?? false,
                            },
                          ]}
                          .columns=${1}
                          @value-changed=${this._invertChanged}
                        ></apexcharts-card-bool-grid>`
                      : nothing
                  }
                </div>
              </ha-expansion-panel>`
            : nothing
        }

        <ha-expansion-panel outlined header=${t('series.panel.visibility')}>
          <div class="section">
            <apexcharts-card-bool-grid
              .fields=${this._visibilityBoolFields()}
              .columns=${2}
              @value-changed=${this._visibilityBoolChanged}
            ></apexcharts-card-bool-grid>
            <ha-form
              .hass=${this.hass}
              .data=${stable(this._visibilitySelectData())}
              .schema=${stable(filterSchema(getSeriesVisibilitySelectSchema(), this._applies))}
              .computeLabel=${computeLabel}
              .computeHelper=${computeHelper}
              @value-changed=${this._visibilitySelectChanged}
            ></ha-form>
          </div>
        </ha-expansion-panel>

        <ha-expansion-panel outlined header=${t('series.panel.dataProcessing')}>
          <div class="section">
            <ha-form
              .hass=${this.hass}
              .data=${stable({ smoothing: this._smoothing() })}
              .schema=${stable(getSmoothingSchema(this._needsGrouping()))}
              .computeLabel=${computeLabel}
              .computeHelper=${computeHelper}
              @value-changed=${this._smoothingChanged}
            ></ha-form>
            ${
              this._smoothing() === 'custom'
                ? html`<ha-form
                      .hass=${this.hass}
                      .data=${stable(this._groupByData())}
                      .schema=${stable(getSeriesGroupBySchema(this._needsGrouping()))}
                      .computeLabel=${computeLabel}
                      .computeHelper=${computeHelper}
                      @value-changed=${this._groupByChanged}
                    ></ha-form>
                    <apexcharts-card-bool-grid
                      .fields=${[
                        {
                          name: 'start_with_last',
                          label: computeLabel({ name: 'start_with_last' } as HaFormSchema),
                          value: !!this.series?.group_by?.start_with_last,
                        },
                      ]}
                      .columns=${1}
                      @value-changed=${this._groupByStartWithLastChanged}
                    ></apexcharts-card-bool-grid>`
                : nothing
            }
            ${
              this._source() === 'compute'
                ? nothing
                : html`<ha-form
                    .hass=${this.hass}
                    .data=${stable(this._dataProcessingData())}
                    .schema=${stable(getSeriesDataProcessingSchema())}
                    .computeLabel=${computeLabel}
                    .computeHelper=${computeHelper}
                    @value-changed=${this._dataProcessingChanged}
                  ></ha-form>`
            }
          </div>
        </ha-expansion-panel>

        <ha-expansion-panel outlined header=${t('field.advanced')}>
          <ha-form
            .hass=${this.hass}
            .data=${stable(this._advancedData())}
            .schema=${stable(this._advancedSchema())}
            .computeLabel=${computeLabel}
            .computeHelper=${computeHelper}
            @value-changed=${this._advancedChanged}
          ></ha-form>
        </ha-expansion-panel>

        ${
          showColorThreshold
            ? html`
                <ha-expansion-panel outlined header=${t('series.panel.colorThresholds')}>
                  ${
                    this.config?.experimental?.color_threshold
                      ? nothing
                      : html`<div class="hint">${t('hint.thresholdsExperimental')}</div>`
                  }
                  <apexcharts-card-color-threshold-editor
                    .thresholds=${s.color_threshold || []}
                    @value-changed=${this._thresholdsChanged}
                  ></apexcharts-card-color-threshold-editor>
                </ha-expansion-panel>
              `
            : nothing
        }
        ${
          showHeaderActions
            ? html`
                <ha-expansion-panel outlined header=${t('series.panel.headerActions')}>
                  <apexcharts-card-actions-editor
                    .hass=${this.hass}
                    .actions=${s.header_actions}
                    @value-changed=${this._actionsChanged}
                  ></apexcharts-card-actions-editor>
                </ha-expansion-panel>
              `
            : nothing
        }
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'apexcharts-card-series-item-editor': ApexChartsCardSeriesItemEditor;
  }
}
