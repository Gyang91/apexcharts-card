import { LitElement, html, TemplateResult, CSSResultGroup } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { ChartCardColorThreshold, ChartCardHeatmapColorRange } from '../../types-config';
import { editorStyles } from '../styles';
import { t } from '../localize';
import { debounced, typedNumber } from '../helpers';
import './color-input';
import { bandLimits } from '../../visual-data';

const ICON_DELETE =
  'M19,6.41L17.59,5L12,10.59L6.41,5L5,6.41L10.59,12L5,17.59L6.41,19L12,13.41L17.59,19L19,17.59L13.41,12L19,6.41Z';
const ICON_ADD = 'M19,13H13V19H11V13H5V11H11V5H13V11H19V13Z';

// A value and a colour per row: series colour thresholds (with an opacity) or
// heatmap colour bands (with a legend name), chosen by `third`.
type Threshold = ChartCardColorThreshold & Partial<ChartCardHeatmapColorRange>;

@customElement('apexcharts-card-color-threshold-editor')
export class ApexChartsCardColorThresholdEditor extends LitElement {
  @property({ attribute: false }) public thresholds: Threshold[] = [];

  @property({ attribute: false }) public third: 'opacity' | 'name' = 'opacity';

  @property({ attribute: false }) public addLabel?: string;

  // Bands only: the unit the series share, shown with the value and each band's range
  @property({ attribute: false }) public unit?: string;

  static get styles(): CSSResultGroup {
    return editorStyles;
  }

  private _fire(thresholds: Threshold[]): void {
    // Kept in the order shown, so the row being edited stays put; the card sorts by value.
    this.dispatchEvent(
      new CustomEvent('value-changed', {
        detail: { value: thresholds },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private _update(index: number, key: keyof Threshold, value: unknown): void {
    const list = [...this.thresholds];
    const item = { ...list[index] };
    if (value === undefined || value === null || value === '') {
      delete (item as Record<string, unknown>)[key];
    } else {
      (item as Record<string, unknown>)[key] = value;
    }
    list[index] = item;
    this._fire(list);
  }

  // Typing waits for a pause; a cleared or half-typed number keeps the row as it was.
  private _typed = debounced(
    (index: number, key: keyof Threshold, text: string, isNumber: boolean) => {
      if (!isNumber) {
        this._update(index, key, text.trim() || undefined);
        return;
      }
      if (text.trim() === '') {
        if (key !== 'value') this._update(index, key, undefined);
        return;
      }
      const value = typedNumber(text);
      if (value !== undefined) this._update(index, key, value);
    },
    (index, key) => `${index}:${key}`,
  );

  private _field(item: Threshold, index: number, key: 'value' | 'opacity' | 'name'): TemplateResult {
    const isNumber = key !== 'name';
    const current = item[key];
    const onInput = (ev: Event) => this._typed(index, key, (ev.target as HTMLInputElement).value, isNumber);
    return html`<ha-textfield
      type=${isNumber ? 'number' : 'text'}
      step="any"
      label=${key === 'value' && this.unit ? `${t('field.value')} (${this.unit})` : t(`field.${key}`)}
      .value=${current === undefined ? '' : String(current)}
      .helper=${t(`helper.threshold_${key}`)}
      helperPersistent
      @input=${onInput}
      @change=${onInput}
    ></ha-textfield>`;
  }

  private _add(): void {
    const last = this.thresholds[this.thresholds.length - 1];
    this._fire([...this.thresholds, { value: last ? last.value + 10 : 0 } as Threshold]);
  }

  private _remove(index: number): void {
    const list = [...this.thresholds];
    list.splice(index, 1);
    this._fire(list);
  }

  // The bands in value order as a colour strip, with the values where one band ends and the next begins
  private _bar(): TemplateResult {
    const sorted = [...this.thresholds].sort((a, b) => a.value - b.value);
    const unit = this.unit ? ` ${this.unit}` : '';
    return html`<div class="band-bar">
        ${sorted.map((band) => html`<div style="background: ${band.color || 'transparent'}"></div>`)}
      </div>
      <div class="band-scale">
        ${sorted
          .slice(1)
          .map((band, i) => html`<span style="left: ${((i + 1) * 100) / sorted.length}%">${band.value}</span>`)}
        <span class="band-unit">${unit}</span>
      </div>`;
  }

  protected render(): TemplateResult {
    const bands = this.third === 'name';
    const limits = bands ? bandLimits(this.thresholds, this.unit) : [];
    return html`
      <div class="list-editor">
        ${bands ? '' : html`<div class="hint">${t('hint.thresholds')}</div>`}
        ${bands && this.thresholds.length ? this._bar() : ''}
        ${this.thresholds.map(
          (item, i) => html`
            <div class="list-item">
              <div class="list-item-body" style="padding-top: 12px;">
                ${bands ? html`<div class="band-range">${limits[i]}</div>` : ''}
                <div class="grid-2">${this._field(item, i, 'value')} ${this._field(item, i, this.third)}</div>
                <apexcharts-card-color-input
                  .value=${item.color}
                  @value-changed=${(ev: CustomEvent) => {
                    ev.stopPropagation();
                    this._update(i, 'color', ev.detail.value);
                  }}
                ></apexcharts-card-color-input>
              </div>
              <div class="item-controls" style="position: absolute; right: 8px; top: 8px;">
                <ha-icon-button
                  .path=${ICON_DELETE}
                  .label=${t('series.colorThreshold.remove')}
                  @click=${() => this._remove(i)}
                ></ha-icon-button>
              </div>
            </div>
          `,
        )}
        <button class="add-button" type="button" @click=${this._add}>
          <ha-svg-icon .path=${ICON_ADD}></ha-svg-icon>
          ${this.addLabel ?? t('series.colorThreshold.add')}
        </button>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'apexcharts-card-color-threshold-editor': ApexChartsCardColorThresholdEditor;
  }
}
