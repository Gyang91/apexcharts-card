import { LitElement, html, nothing, TemplateResult, CSSResultGroup } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import parse from 'parse-duration';
import { HomeAssistant } from 'custom-card-helpers';
import { ChartCardExternalConfig, ChartCardHeaderExternalConfig, ChartCardHeatmapColorRange } from '../../types-config';
import { computeHelper, computeLabel } from '../helpers';
import { editorStyles } from '../styles';
import { NOW_SCHEMA, SHOW_BOOL_FIELDS } from '../schemas/display';
import {
  getChartColorsSchema,
  getGridBoolFields,
  getGridSchema,
  getLegendSchema,
  getMarkersSchema,
  getToolbarBoolFields,
  getTooltipSchema,
} from '../schemas/apex';
import { HaFormSchema } from '../types';
import { BoolField } from '../components/bool-grid';
import { AnnotationItem } from '../components/annotations-editor';
import { getApexValue, setApexValue, setApexValues } from '../apex-config-utils';
import { t } from '../localize';
import { supports } from '../support';
import { sharedUnit, suggestBands } from '../../visual-data';
import { fetchStatistics } from '../../recorder';
import { BRUSH_SCHEMA } from '../schemas/advanced';
import '../components/header-editor';
import '../components/color-list-editor';
import '../components/color-threshold-editor';
import '../components/color-input';
import '../components/bool-grid';
import '../components/annotations-editor';

function msToLocalDateTimeString(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number): string => String(n).padStart(2, '0');
  const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  return `${date} ${time}`;
}

@customElement('apexcharts-card-editor-display')
export class ApexChartsCardEditorDisplay extends LitElement {
  @property({ attribute: false }) public hass?: HomeAssistant;
  @property({ attribute: false }) public config?: ChartCardExternalConfig;

  static get styles(): CSSResultGroup {
    return editorStyles;
  }

  private _fire(updates: Partial<ChartCardExternalConfig>): void {
    if (!this.config) return;
    const next: ChartCardExternalConfig = { ...this.config, ...updates };
    for (const k of Object.keys(updates) as (keyof ChartCardExternalConfig)[]) {
      if (updates[k] === undefined) delete (next as unknown as Record<string, unknown>)[k as string];
    }
    this.dispatchEvent(
      new CustomEvent('config-changed', {
        detail: { config: next },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private _headerChanged = (ev: CustomEvent): void => {
    ev.stopPropagation();
    const value = ev.detail.value as ChartCardHeaderExternalConfig | undefined;
    this._fire({ header: value });
  };

  private _nowChanged = (ev: CustomEvent): void => {
    ev.stopPropagation();
    this._setNow(ev.detail.value);
  };

  private _setNow(data: { color?: string; label?: string }): void {
    const existing = this.config?.now || {};
    const next: NonNullable<ChartCardExternalConfig['now']> = { ...existing };
    if ('color' in data) {
      if (data.color) next.color = data.color;
      else delete next.color;
    }
    if ('label' in data) {
      if (data.label) next.label = data.label;
      else delete next.label;
    }
    this._fire({ now: Object.keys(next).length > 0 ? next : undefined });
  }

  private _nowShowChanged = (ev: CustomEvent): void => {
    ev.stopPropagation();
    const { value } = ev.detail as { name: string; value: boolean };
    const existing = this.config?.now || {};
    const next: NonNullable<ChartCardExternalConfig['now']> = { ...existing };
    if (value) next.show = true;
    else delete next.show;
    this._fire({ now: Object.keys(next).length > 0 ? next : undefined });
  };

  private _showBoolChanged = (ev: CustomEvent): void => {
    ev.stopPropagation();
    const { name, value } = ev.detail as { name: string; value: boolean };
    const existing = this.config?.show || {};
    const next: NonNullable<ChartCardExternalConfig['show']> = { ...existing };
    if (name === 'loading') {
      // loading defaults to true; only persist explicit false
      if (value === false) next.loading = false;
      else delete next.loading;
    } else if (name === 'last_updated') {
      if (value) next.last_updated = true;
      else delete next.last_updated;
    }
    this._fire({ show: Object.keys(next).length > 0 ? next : undefined });
  };

  // The brush switch and its settings: turning it off keeps the settings for later
  private _brushSwitched = (ev: CustomEvent): void => {
    ev.stopPropagation();
    const experimental = { ...this.config?.experimental, brush: ev.detail.value || undefined };
    if (!experimental.brush) delete experimental.brush;
    this._fire({ experimental: Object.keys(experimental).length ? experimental : undefined });
  };

  private _brushChanged = (ev: CustomEvent): void => {
    ev.stopPropagation();
    const span = (ev.detail.value as { selection_span?: string }).selection_span;
    const brush = { ...this.config?.brush, selection_span: span || undefined };
    if (!brush.selection_span) delete brush.selection_span;
    this._fire({ brush: Object.keys(brush).length ? brush : undefined });
  };

  private _colorListChanged = (ev: CustomEvent): void => {
    ev.stopPropagation();
    const value = ev.detail.value as string[] | undefined;
    this._fire({ color_list: value });
  };

  // Heatmap colour bands, keeping the other heatmap options
  // The unit the series share: their own, all_series_config's, else the entity's
  private _bandUnit(): { unit?: string; mixed: boolean } {
    const cfg = this.config!;
    return sharedUnit(
      (cfg.series || []).map(
        (serie) =>
          serie.unit ??
          cfg.all_series_config?.unit ??
          this.hass?.states[serie.entity ?? '']?.attributes?.unit_of_measurement,
      ),
    );
  }

  @state() private _suggesting = false;
  @state() private _suggestNote?: string;

  // Bands across the min and max the series' statistics recorded over the chart's span,
  // else their current states
  private _suggestBands = async (): Promise<void> => {
    const cfg = this.config!;
    const ids = (cfg.series || []).map((serie) => serie.entity).filter((id): id is string => !!id);
    const end = new Date();
    const start = new Date(end.getTime() - (parse(cfg.graph_span ?? '24h') ?? 86400000));
    this._suggesting = true;
    try {
      const rows = await Promise.all(
        ids.map((id) => fetchStatistics(this.hass, id, start, end, 'hour').catch(() => undefined)),
      );
      const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
      let values = rows.flatMap((list) => (list ?? []).flatMap((row) => [row.min ?? row.mean, row.max ?? row.mean]));
      if (!values.some(isNumber)) values = ids.map((id) => Number(this.hass?.states[id]?.state));
      const found = values.filter(isNumber);
      const bands = found.length ? suggestBands(Math.min(...found), Math.max(...found)) : [];
      this._suggestNote = bands.length ? undefined : t('display.heatmapBands.noData');
      if (bands.length) this._setBands(bands);
    } finally {
      this._suggesting = false;
    }
  };

  private _heatmapBandsChanged = (ev: CustomEvent): void => {
    ev.stopPropagation();
    this._setBands(ev.detail.value as ChartCardHeatmapColorRange[]);
  };

  private _setBands(bands: ChartCardHeatmapColorRange[]): void {
    const heatmap = { ...this.config?.heatmap, color_ranges: bands.length ? bands : undefined };
    if (!heatmap.color_ranges) delete heatmap.color_ranges;
    this._fire({ heatmap: Object.keys(heatmap).length ? heatmap : undefined });
  }

  private _appearanceChanged = (ev: CustomEvent): void => {
    ev.stopPropagation();
    const data = ev.detail.value as { appearance?: 'minimal' | 'premium' };
    // premium is the default; only persist the explicit 'minimal'
    this._fire({ appearance: data.appearance === 'minimal' ? 'minimal' : undefined });
  };

  private _fireConfig(next: ChartCardExternalConfig): void {
    this.dispatchEvent(
      new CustomEvent('config-changed', {
        detail: { config: next },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private _setApex(path: string, value: unknown): void {
    if (!this.config) return;
    this._fireConfig(setApexValue(this.config, path, value));
  }

  private _setApexMany(patches: Record<string, unknown>): void {
    if (!this.config) return;
    this._fireConfig(setApexValues(this.config, patches));
  }

  private _gridSelectChanged = (ev: CustomEvent): void => {
    ev.stopPropagation();
    const data = ev.detail.value as { position?: string; borderColor?: string };
    this._setApexMany({
      'grid.position': data.position || undefined,
      'grid.borderColor': data.borderColor || undefined,
    });
  };

  private _gridBoolChanged = (ev: CustomEvent): void => {
    ev.stopPropagation();
    const { name, value } = ev.detail as { name: string; value: boolean };
    const pathMap: Record<string, string> = {
      show: 'grid.show',
      xaxis_lines_show: 'grid.xaxis.lines.show',
      yaxis_lines_show: 'grid.yaxis.lines.show',
    };
    const path = pathMap[name];
    if (!path) return;
    // Persist only what differs from ApexCharts' defaults (grid and y lines shown, x lines hidden)
    if (name === 'xaxis_lines_show') {
      this._setApex(path, value ? true : undefined);
    } else {
      this._setApex(path, value ? undefined : false);
    }
  };

  private _legendSelectChanged = (ev: CustomEvent): void => {
    ev.stopPropagation();
    const data = ev.detail.value as { position?: string; horizontalAlign?: string };
    this._setApexMany({
      'legend.position': data.position || undefined,
      'legend.horizontalAlign': data.horizontalAlign || undefined,
    });
  };

  private _legendShowChanged = (ev: CustomEvent): void => {
    ev.stopPropagation();
    const { value } = ev.detail as { name: string; value: boolean };
    // Default is shown; persist only explicit false
    this._setApex('legend.show', value ? undefined : false);
  };

  private _tooltipChanged = (ev: CustomEvent): void => {
    ev.stopPropagation();
    const data = ev.detail.value as { theme?: string; x_format?: string };
    this._setApexMany({
      'tooltip.theme': data.theme || undefined,
      'tooltip.x.format': data.x_format || undefined,
    });
  };

  private _tooltipSharedChanged = (ev: CustomEvent): void => {
    ev.stopPropagation();
    const { value } = ev.detail as { name: string; value: boolean };
    // ApexCharts requires `intersect: false` for shared tooltips
    this._setApexMany({
      'tooltip.shared': value ? true : undefined,
      'tooltip.intersect': value ? false : undefined,
    });
  };

  private _toolbarBoolChanged = (ev: CustomEvent): void => {
    ev.stopPropagation();
    const { name, value } = ev.detail as { name: string; value: boolean };
    if (name === 'show') {
      // The card turns zoom off, and ApexCharts hides the zoom/pan/reset tools without it:
      // the toolbar switch turns zoom on and off with it.
      this._setApexMany({
        'chart.toolbar.show': value ? true : undefined,
        'chart.zoom.enabled': value ? true : undefined,
      });
      return;
    }
    const toolMap: Record<string, string> = {
      tool_zoom: 'chart.toolbar.tools.zoom',
      tool_pan: 'chart.toolbar.tools.pan',
      tool_download: 'chart.toolbar.tools.download',
      tool_reset: 'chart.toolbar.tools.reset',
    };
    const path = toolMap[name];
    if (!path) return;
    this._setApex(path, value ? undefined : false);
  };

  private _markersChanged = (ev: CustomEvent): void => {
    ev.stopPropagation();
    const data = ev.detail.value as { size?: number | string; shape?: string; strokeWidth?: number | string };
    const patches: Record<string, unknown> = {};
    if ('size' in data) {
      patches['markers.size'] = data.size === undefined || data.size === '' ? undefined : Number(data.size);
    }
    if ('shape' in data) {
      patches['markers.shape'] = data.shape || undefined;
    }
    if ('strokeWidth' in data) {
      patches['markers.strokeWidth'] =
        data.strokeWidth === undefined || data.strokeWidth === '' ? undefined : Number(data.strokeWidth);
    }
    this._setApexMany(patches);
  };

  private _chartColorsChanged = (ev: CustomEvent): void => {
    ev.stopPropagation();
    const data = ev.detail.value as { background?: string; foreColor?: string };
    this._setApexMany({
      'chart.background': data.background || undefined,
      'chart.foreColor': data.foreColor || undefined,
    });
  };

  private _annotationsChanged = (axis: 'xaxis' | 'yaxis', ev: CustomEvent): void => {
    ev.stopPropagation();
    const value = ev.detail.value as AnnotationItem[] | undefined;
    const mapped = value?.map((it) => {
      const out: Record<string, unknown> = {};
      if (axis === 'xaxis') {
        if (it.value !== undefined && it.value !== '') {
          const raw = String(it.value).trim();
          const asNum = Number(raw);
          if (!isNaN(asNum) && /^[\d.eE+-]+$/.test(raw)) {
            out.x = asNum;
          } else {
            // A datetime axis needs a numeric x: store a date string as ms since 1970
            const parsed = Date.parse(raw);
            out.x = isNaN(parsed) ? raw : parsed;
          }
        }
      } else {
        if (it.value !== undefined && it.value !== '') {
          const n = Number(it.value);
          out.y = isNaN(n) ? it.value : n;
        }
      }
      if (it.color) {
        out.borderColor = it.color;
      }
      if (it.label) {
        out.label = {
          text: it.label,
          ...(it.color ? { style: { background: it.color, color: '#fff' } } : {}),
        };
      }
      return out;
    });
    this._setApex(axis === 'xaxis' ? 'annotations.xaxis' : 'annotations.yaxis', mapped);
  };

  private _readAnnotations(axis: 'xaxis' | 'yaxis'): AnnotationItem[] {
    const list = getApexValue(this.config, axis === 'xaxis' ? 'annotations.xaxis' : 'annotations.yaxis');
    if (!Array.isArray(list)) return [];
    return list.map((a) => {
      const rec = a as Record<string, unknown>;
      const rawValue = (axis === 'xaxis' ? rec.x : rec.y) as string | number | undefined;
      const labelObj = rec.label as Record<string, unknown> | undefined;
      const labelText = labelObj?.text as string | undefined;
      const color =
        (rec.borderColor as string | undefined) ||
        ((labelObj?.style as Record<string, unknown> | undefined)?.background as string | undefined);
      const item: AnnotationItem = {};
      if (rawValue !== undefined) {
        // Show ms since 1970 as a local date; values below 10^11 (1973) are plain numbers
        if (axis === 'xaxis' && typeof rawValue === 'number' && rawValue >= 1e11) {
          item.value = msToLocalDateTimeString(rawValue);
        } else {
          item.value = rawValue;
        }
      }
      if (labelText) item.label = labelText;
      if (color) item.color = color;
      return item;
    });
  }

  protected render(): TemplateResult {
    if (!this.hass || !this.config) return html``;
    const cfg = this.config;
    const showFields: BoolField[] = SHOW_BOOL_FIELDS.map((name) => {
      const isLoading = name === 'loading';
      return {
        name,
        label: computeLabel({ name } as HaFormSchema),
        value: isLoading ? (cfg.show?.loading ?? true) : !!cfg.show?.[name as keyof NonNullable<typeof cfg.show>],
      };
    });
    const nowShowFields: BoolField[] = [
      {
        name: 'show',
        label: computeLabel({ name: 'show' } as HaFormSchema),
        value: !!cfg.now?.show,
      },
    ];

    const gridBoolFields: BoolField[] = getGridBoolFields().map((f) => {
      const pathMap: Record<string, string> = {
        show: 'grid.show',
        xaxis_lines_show: 'grid.xaxis.lines.show',
        yaxis_lines_show: 'grid.yaxis.lines.show',
      };
      const raw = getApexValue(cfg, pathMap[f.name]);
      const defaultsTrue = f.name !== 'xaxis_lines_show';
      const value = raw === undefined ? defaultsTrue : raw !== false;
      return {
        name: f.name,
        label: f.label,
        helper: f.helper,
        value,
      };
    });
    const gridSelectData = {
      position: (getApexValue(cfg, 'grid.position') as string) || '',
      borderColor: (getApexValue(cfg, 'grid.borderColor') as string) || '',
    };

    const legendShowFields: BoolField[] = [
      {
        name: 'show',
        label: t('display.legend.show.label'),
        value: getApexValue(cfg, 'legend.show') === false ? false : true,
      },
    ];
    const legendSelectData = {
      position: (getApexValue(cfg, 'legend.position') as string) || '',
      horizontalAlign: (getApexValue(cfg, 'legend.horizontalAlign') as string) || '',
    };

    const tooltipData = {
      theme: (getApexValue(cfg, 'tooltip.theme') as string) || '',
      x_format: (getApexValue(cfg, 'tooltip.x.format') as string) || '',
    };
    const tooltipSharedFields: BoolField[] = [
      {
        name: 'shared',
        label: t('display.tooltip.shared.label'),
        helper: t('display.tooltip.shared.helper'),
        value: !!getApexValue(cfg, 'tooltip.shared'),
      },
    ];

    const toolbarFields: BoolField[] = getToolbarBoolFields().map((f) => {
      const pathMap: Record<string, string> = {
        show: 'chart.toolbar.show',
        tool_zoom: 'chart.toolbar.tools.zoom',
        tool_pan: 'chart.toolbar.tools.pan',
        tool_download: 'chart.toolbar.tools.download',
        tool_reset: 'chart.toolbar.tools.reset',
      };
      const raw = getApexValue(cfg, pathMap[f.name]);
      // The card hides the toolbar; its tools default to shown
      const defaultValue = f.name === 'show' ? false : true;
      return {
        name: f.name,
        label: f.label,
        helper: f.helper,
        value: raw === undefined ? defaultValue : raw === true,
      };
    });

    const markersData = {
      size: getApexValue(cfg, 'markers.size'),
      shape: (getApexValue(cfg, 'markers.shape') as string) || '',
      strokeWidth: getApexValue(cfg, 'markers.strokeWidth'),
    };

    const chartColorsData = {
      background: (getApexValue(cfg, 'chart.background') as string) || '',
      foreColor: (getApexValue(cfg, 'chart.foreColor') as string) || '',
    };

    const xAnnotations = this._readAnnotations('xaxis');
    const yAnnotations = this._readAnnotations('yaxis');

    const unit = this._bandUnit();
    return html`
      <div class="section">
        ${
          cfg.chart_type === 'heatmap'
            ? html`<ha-expansion-panel outlined header=${t('display.panel.heatmapBands')} expanded>
                <p class="hint">${t('display.heatmapBands.helper')}</p>
                ${unit.mixed ? html`<p class="hint">${t('display.heatmapBands.mixedUnits')}</p>` : nothing}
                <apexcharts-card-color-threshold-editor
                  .thresholds=${cfg.heatmap?.color_ranges || []}
                  .third=${'name'}
                  .unit=${unit.unit}
                  .addLabel=${t('display.heatmapBands.add')}
                  @value-changed=${this._heatmapBandsChanged}
                ></apexcharts-card-color-threshold-editor>
                <button class="add-button" type="button" ?disabled=${this._suggesting} @click=${this._suggestBands}>
                  ${t(this._suggesting ? 'display.heatmapBands.suggesting' : 'display.heatmapBands.suggest')}
                </button>
                <p class="hint">${this._suggestNote ?? t('display.heatmapBands.suggestHelper')}</p>
              </ha-expansion-panel>`
            : nothing
        }
        <ha-expansion-panel outlined header=${t('display.panel.header')} expanded>
          <apexcharts-card-header-editor
            .hass=${this.hass}
            .header=${cfg.header}
            @value-changed=${this._headerChanged}
          ></apexcharts-card-header-editor>
        </ha-expansion-panel>

        ${
          supports(cfg, 'now')
            ? html`<ha-expansion-panel outlined header=${t('display.panel.nowMarker')}>
                <div class="section">
                  <apexcharts-card-bool-grid
                    .fields=${nowShowFields}
                    .columns=${1}
                    @value-changed=${this._nowShowChanged}
                  ></apexcharts-card-bool-grid>
                  <apexcharts-card-color-input
                    .value=${cfg.now?.color}
                    @value-changed=${(ev: CustomEvent) => {
                      ev.stopPropagation();
                      this._setNow({ color: ev.detail.value });
                    }}
                  ></apexcharts-card-color-input>
                  <ha-form
                    .hass=${this.hass}
                    .data=${{ label: cfg.now?.label || '' }}
                    .schema=${NOW_SCHEMA}
                    .computeLabel=${computeLabel}
                    .computeHelper=${computeHelper}
                    @value-changed=${this._nowChanged}
                  ></ha-form>
                </div>
              </ha-expansion-panel>`
            : nothing
        }

        <ha-expansion-panel outlined header=${t('display.panel.showOptions')}>
          <apexcharts-card-bool-grid
            .fields=${showFields}
            .columns=${2}
            @value-changed=${this._showBoolChanged}
          ></apexcharts-card-bool-grid>
          <ha-form
            .hass=${this.hass}
            .data=${{ appearance: cfg.appearance || 'premium' }}
            .schema=${[
              {
                name: 'appearance',
                selector: {
                  select: {
                    mode: 'dropdown',
                    options: [
                      { value: 'premium', label: t('display.appearance.premium') },
                      { value: 'minimal', label: t('display.appearance.minimal') },
                    ],
                  },
                },
              },
            ]}
            .computeLabel=${computeLabel}
            .computeHelper=${computeHelper}
            @value-changed=${this._appearanceChanged}
          ></ha-form>
        </ha-expansion-panel>

        ${
          supports(cfg, 'grid')
            ? html`<ha-expansion-panel outlined header=${t('display.panel.grid')}>
                <div class="section">
                  <apexcharts-card-bool-grid
                    .fields=${gridBoolFields}
                    .columns=${2}
                    @value-changed=${this._gridBoolChanged}
                  ></apexcharts-card-bool-grid>
                  <ha-form
                    .hass=${this.hass}
                    .data=${gridSelectData}
                    .schema=${getGridSchema()}
                    .computeLabel=${computeLabel}
                    .computeHelper=${computeHelper}
                    @value-changed=${this._gridSelectChanged}
                  ></ha-form>
                </div>
              </ha-expansion-panel>`
            : nothing
        }

        <ha-expansion-panel outlined header=${t('display.panel.legend')}>
          <div class="section">
            <apexcharts-card-bool-grid
              .fields=${legendShowFields}
              .columns=${1}
              @value-changed=${this._legendShowChanged}
            ></apexcharts-card-bool-grid>
            <ha-form
              .hass=${this.hass}
              .data=${legendSelectData}
              .schema=${getLegendSchema()}
              .computeLabel=${computeLabel}
              .computeHelper=${computeHelper}
              @value-changed=${this._legendSelectChanged}
            ></ha-form>
          </div>
        </ha-expansion-panel>

        <ha-expansion-panel outlined header=${t('display.panel.tooltip')}>
          <div class="section">
            <ha-form
              .hass=${this.hass}
              .data=${tooltipData}
              .schema=${getTooltipSchema()}
              .computeLabel=${computeLabel}
              .computeHelper=${computeHelper}
              @value-changed=${this._tooltipChanged}
            ></ha-form>
            <apexcharts-card-bool-grid
              .fields=${tooltipSharedFields}
              .columns=${1}
              @value-changed=${this._tooltipSharedChanged}
            ></apexcharts-card-bool-grid>
          </div>
        </ha-expansion-panel>

        <ha-expansion-panel outlined header=${t('display.panel.toolbar')}>
          <apexcharts-card-bool-grid
            .fields=${toolbarFields}
            .columns=${2}
            @value-changed=${this._toolbarBoolChanged}
          ></apexcharts-card-bool-grid>
        </ha-expansion-panel>

        ${
          supports(cfg, 'markers')
            ? html`<ha-expansion-panel outlined header=${t('display.panel.markers')}>
                <ha-form
                  .hass=${this.hass}
                  .data=${markersData}
                  .schema=${getMarkersSchema()}
                  .computeLabel=${computeLabel}
                  .computeHelper=${computeHelper}
                  @value-changed=${this._markersChanged}
                ></ha-form>
              </ha-expansion-panel>`
            : nothing
        }

        <ha-expansion-panel outlined header=${t('display.panel.chartBackground')}>
          <ha-form
            .hass=${this.hass}
            .data=${chartColorsData}
            .schema=${getChartColorsSchema()}
            .computeLabel=${computeLabel}
            .computeHelper=${computeHelper}
            @value-changed=${this._chartColorsChanged}
          ></ha-form>
        </ha-expansion-panel>

        ${
          supports(cfg, 'annotations')
            ? html`<ha-expansion-panel outlined header=${t('display.panel.annotations')}>
                <div class="section">
                  <div style="font-weight: 500; margin-top: 4px;">${t('display.annotations.xaxis')}</div>
                  <apexcharts-card-annotations-editor
                    axis="xaxis"
                    .items=${xAnnotations}
                    @value-changed=${(ev: CustomEvent) => this._annotationsChanged('xaxis', ev)}
                  ></apexcharts-card-annotations-editor>
                  <div style="font-weight: 500; margin-top: 12px;">${t('display.annotations.yaxis')}</div>
                  <apexcharts-card-annotations-editor
                    axis="yaxis"
                    .items=${yAnnotations}
                    @value-changed=${(ev: CustomEvent) => this._annotationsChanged('yaxis', ev)}
                  ></apexcharts-card-annotations-editor>
                </div>
              </ha-expansion-panel>`
            : nothing
        }
        ${
          supports(cfg, 'brush')
            ? html`<ha-expansion-panel outlined header=${t('advanced.panel.brush')}>
                <div class="section">
                  <apexcharts-card-bool-grid
                    .fields=${[
                      {
                        name: 'brush',
                        label: t('field.brush'),
                        helper: t('helper.brush'),
                        value: !!cfg.experimental?.brush,
                      },
                    ]}
                    .columns=${1}
                    @value-changed=${this._brushSwitched}
                  ></apexcharts-card-bool-grid>
                  ${
                    cfg.experimental?.brush
                      ? html`<ha-form
                          .hass=${this.hass}
                          .data=${cfg.brush || {}}
                          .schema=${BRUSH_SCHEMA}
                          .computeLabel=${computeLabel}
                          .computeHelper=${computeHelper}
                          @value-changed=${this._brushChanged}
                        ></ha-form>`
                      : nothing
                  }
                </div>
              </ha-expansion-panel>`
            : nothing
        }
        <ha-expansion-panel outlined header=${t('display.panel.colorPalette')}>
          <apexcharts-card-color-list-editor
            .colors=${cfg.color_list || []}
            @value-changed=${this._colorListChanged}
          ></apexcharts-card-color-list-editor>
        </ha-expansion-panel>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'apexcharts-card-editor-display': ApexChartsCardEditorDisplay;
  }
}
