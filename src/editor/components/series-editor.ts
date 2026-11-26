import { LitElement, html, TemplateResult, nothing, CSSResultGroup } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { HomeAssistant } from 'custom-card-helpers';
import {
  ChartCardAllSeriesExternalConfig,
  ChartCardExternalConfig,
  ChartCardSeriesExternalConfig,
} from '../../types-config';
import { computeColor, isComputedSeries } from '../../utils';
import { computeEntityName } from '../../entity-name';
import { DEFAULT_COLORS } from '../../const';
import { editorStyles } from '../styles';
import { t } from '../localize';
import { listControls } from './list-controls';
import './series-item-editor';

const ICON_ADD = 'M19,13H13V19H11V13H5V11H11V5H13V11H19V13Z';

@customElement('apexcharts-card-series-editor')
export class ApexChartsCardSeriesEditor extends LitElement {
  @property({ attribute: false }) public hass?: HomeAssistant;
  @property({ attribute: false }) public config?: ChartCardExternalConfig;
  @state() private _expanded: Record<number, boolean> = {};
  @state() private _draftIndex?: number;

  static get styles(): CSSResultGroup {
    return editorStyles;
  }

  private _fire(updates: Partial<ChartCardExternalConfig>): void {
    if (!this.config) return;
    const next: ChartCardExternalConfig = { ...this.config, ...updates };
    // Strip keys whose new value is undefined
    for (const k of Object.keys(updates) as (keyof ChartCardExternalConfig)[]) {
      if (updates[k] === undefined) {
        delete (next as unknown as Record<string, unknown>)[k as string];
      }
    }
    this.dispatchEvent(
      new CustomEvent('config-changed', {
        detail: { config: next },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private _seriesSwatch(s: ChartCardSeriesExternalConfig, index: number): string {
    if (s.color) {
      try {
        return computeColor(s.color);
      } catch {
        return 'transparent';
      }
    }
    const list = this.config?.color_list && this.config.color_list.length > 0 ? this.config.color_list : DEFAULT_COLORS;
    try {
      return computeColor(list[index % list.length]);
    } catch {
      return 'transparent';
    }
  }

  private _displayName(s: ChartCardSeriesExternalConfig): string {
    if (typeof s.name === 'string' && s.name) return s.name;
    if (isComputedSeries(s)) return s.id || t('series.source.compute');
    if (s.entity) return computeEntityName(this.hass, this.hass?.states[s.entity], s.name) || s.entity;
    return t('series.newSeries');
  }

  private _toggle(index: number): void {
    this._expanded = { ...this._expanded, [index]: !this._expanded[index] };
  }

  private _add(): void {
    if (!this.config) return;
    if (this._draftIndex != null) return;
    const realLength = (this.config.series || []).length;
    this._draftIndex = realLength;
    this._expanded = { ...this._expanded, [realLength]: true };
  }

  private _remove(index: number): void {
    if (!this.config) return;
    if (this._draftIndex != null && index === this._draftIndex) {
      // Removing the draft row — just drop it locally, no config-changed fired.
      const newExpanded: Record<number, boolean> = { ...this._expanded };
      delete newExpanded[index];
      this._expanded = newExpanded;
      this._draftIndex = undefined;
      return;
    }
    const series = [...(this.config.series || [])];
    if (series.length <= 1) return;
    series.splice(index, 1);
    const newExpanded: Record<number, boolean> = {};
    for (const k of Object.keys(this._expanded)) {
      const n = Number(k);
      if (n < index) newExpanded[n] = this._expanded[n];
      else if (n > index) newExpanded[n - 1] = this._expanded[n];
    }
    this._expanded = newExpanded;
    // Adjust draft index if any (draft sits after real series)
    if (this._draftIndex != null && this._draftIndex > index) {
      this._draftIndex = this._draftIndex - 1;
    }
    this._fire({ series });
  }

  private _move(index: number, delta: -1 | 1): void {
    if (!this.config) return;
    // Do not move the draft row.
    if (this._draftIndex != null && index === this._draftIndex) return;
    const series = [...(this.config.series || [])];
    const target = index + delta;
    if (target < 0 || target >= series.length) return;
    [series[index], series[target]] = [series[target], series[index]];
    const newExpanded: Record<number, boolean> = { ...this._expanded };
    [newExpanded[index], newExpanded[target]] = [newExpanded[target], newExpanded[index]];
    this._expanded = newExpanded;
    this._fire({ series });
  }

  // Thresholds and hidden-by-default only work with their experimental switch: turn it on
  // with the first use
  private _experimentalFor(serie: ChartCardAllSeriesExternalConfig): Partial<ChartCardExternalConfig> {
    const needed = {
      ...(serie.color_threshold?.length ? { color_threshold: true } : {}),
      ...(serie.show?.hidden_by_default ? { hidden_by_default: true } : {}),
    };
    const experimental = this.config?.experimental || {};
    const missing = Object.keys(needed).some((key) => !experimental[key as keyof typeof experimental]);
    return missing ? { experimental: { ...experimental, ...needed } } : {};
  }

  private _seriesChanged(index: number, ev: CustomEvent): void {
    ev.stopPropagation();
    if (!this.config) return;
    const updatedSeries = ev.detail.series as ChartCardSeriesExternalConfig;
    // Draft case: only commit to config once the user picks an entity or computes the series.
    if (this._draftIndex != null && index === this._draftIndex) {
      if (!updatedSeries.entity && !isComputedSeries(updatedSeries)) return;
      const series = [...(this.config.series || []), updatedSeries];
      this._draftIndex = undefined;
      this._fire({ series });
      return;
    }
    const series = [...(this.config.series || [])];
    series[index] = updatedSeries;
    this._fire({ series, ...this._experimentalFor(updatedSeries) });
  }

  private _allSeriesChanged = (ev: CustomEvent): void => {
    ev.stopPropagation();
    const updated = ev.detail.series as ChartCardAllSeriesExternalConfig;
    if (Object.keys(updated || {}).length === 0) {
      this._fire({ all_series_config: undefined });
    } else {
      this._fire({ all_series_config: updated, ...this._experimentalFor(updated) });
    }
  };

  protected render(): TemplateResult {
    if (!this.config || !this.hass) return html``;
    const series = this.config.series || [];
    const renderedSeries: ChartCardSeriesExternalConfig[] =
      this._draftIndex != null ? [...series, { entity: '' } as ChartCardSeriesExternalConfig] : series;
    const canDelete = series.length > 1;

    return html`
      <div class="list-editor">
        ${renderedSeries.map((s, i) => {
          const expanded = !!this._expanded[i];
          const isDraft = this._draftIndex != null && i === this._draftIndex;
          const removable = isDraft || canDelete;
          return html`
            <div class="list-item">
              <div class="list-item-header" @click=${() => this._toggle(i)}>
                <span class="color-swatch" style="background: ${this._seriesSwatch(s, i)};"></span>
                <span class="item-name">${this._displayName(s)}</span>
                ${s.type ? html`<span class="type-badge">${s.type}</span>` : nothing}
                ${listControls({
                  index: i,
                  count: renderedSeries.length,
                  expanded,
                  movable: !isDraft,
                  removable,
                  onMove: (delta) => this._move(i, delta),
                  onRemove: () => this._remove(i),
                  onToggle: () => this._toggle(i),
                })}
              </div>
              ${
                expanded
                  ? html`
                      <div class="list-item-body">
                        <apexcharts-card-series-item-editor
                          .hass=${this.hass}
                          .config=${this.config}
                          .series=${s}
                          @series-changed=${(ev: CustomEvent) => this._seriesChanged(i, ev)}
                        ></apexcharts-card-series-item-editor>
                      </div>
                    `
                  : nothing
              }
            </div>
          `;
        })}

        <button class="add-button" type="button" @click=${this._add}>
          <ha-icon-button .path=${ICON_ADD} .label=${t('series.add')}></ha-icon-button>
          ${t('series.add')}
        </button>

        <ha-expansion-panel outlined header=${t('series.allSeriesConfig')}>
          <apexcharts-card-series-item-editor
            .hass=${this.hass}
            .config=${this.config}
            .series=${this.config.all_series_config || {}}
            .isAllSeriesConfig=${true}
            @series-changed=${this._allSeriesChanged}
          ></apexcharts-card-series-item-editor>
        </ha-expansion-panel>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'apexcharts-card-series-editor': ApexChartsCardSeriesEditor;
  }
}
