import { LitElement, html, TemplateResult, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { computeColor } from '../../utils';
import { t } from '../localize';
import { formField } from './form-field';

const ICON_DELETE = 'M19,4H15.5L14.5,3H9.5L8.5,4H5V6H19M6,19A2,2 0 0,0 8,21H16A2,2 0 0,0 18,19V7H6V19Z';
const ICON_ADD = 'M19,13H13V19H11V13H5V11H11V5H13V11H19V13Z';

export interface AnnotationItem {
  value?: string | number;
  label?: string;
  color?: string;
}

@customElement('apexcharts-card-annotations-editor')
export class ApexChartsCardAnnotationsEditor extends LitElement {
  // 'xaxis' or 'yaxis'; only affects whether `value` is shown as a date string or number hint
  @property({ type: String }) public axis: 'xaxis' | 'yaxis' = 'yaxis';
  @property({ attribute: false }) public items: AnnotationItem[] = [];

  // Render in light DOM so the parent editor's CSS (annotation-row, color-field, etc.) applies,
  // and ha-textfield uses HA's default theming exactly as it does in other forms.
  protected createRenderRoot(): HTMLElement | DocumentFragment {
    return this;
  }

  private _swatch(color?: string): string {
    if (!color) return 'transparent';
    try {
      return computeColor(color);
    } catch {
      return 'transparent';
    }
  }

  private _hex(color?: string): string {
    if (!color) return '#000000';
    try {
      return computeColor(color);
    } catch {
      return '#000000';
    }
  }

  private _fire(items: AnnotationItem[]): void {
    this.dispatchEvent(
      new CustomEvent('value-changed', {
        detail: { value: items.length > 0 ? items : undefined },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private _update(index: number, patch: Partial<AnnotationItem>): void {
    const next = [...this.items];
    next[index] = { ...next[index], ...patch };
    // Strip empty fields
    for (const k of Object.keys(next[index]) as (keyof AnnotationItem)[]) {
      if (next[index][k] === '' || next[index][k] === undefined) {
        delete next[index][k];
      }
    }
    this._fire(next);
  }

  private _add(): void {
    const next = [...this.items, {} as AnnotationItem];
    this._fire(next);
  }

  private _remove(index: number): void {
    const next = [...this.items];
    next.splice(index, 1);
    this._fire(next);
  }

  protected render(): TemplateResult {
    const isXAxis = this.axis === 'xaxis';
    const valuePlaceholder = isXAxis ? '2024-02-11 14:30 or 1707609600000' : '50';
    const valueHelper = isXAxis
      ? html`${t('annotations.value.helper.xaxisPrefix')} <code>2024-02-11</code>
          ${t('annotations.value.helper.xaxisOr')}
          <code>2024-02-11 14:30:00</code> ${t('annotations.value.helper.xaxisMiddle')}
          <code>1707609600000</code> ${t('annotations.value.helper.xaxisSuffix')}`
      : html`${t('annotations.value.helper.yaxisPrefix')} <code>50</code>, <code>-3.14</code>.`;
    return html`
      <div class="list-editor">
        ${
          this.items.length === 0
            ? html`<div style="color: var(--secondary-text-color); font-size: 0.9em;">${t('annotations.none')}</div>`
            : nothing
        }
        ${this.items.map(
          (item, i) => html`
            <div class="annotation-row">
              <div class="annotation-field">
                ${formField({
                  name: 'value',
                  value: item.value === undefined ? '' : String(item.value),
                  selector: { text: {} },
                  label: `${t('field.value')} (${valuePlaceholder})`,
                  onChange: (value) => this._update(i, { value: String(value ?? '') }),
                })}
                <div class="annotation-helper">${valueHelper}</div>
              </div>
              <div class="annotation-field">
                ${formField({
                  name: 'label',
                  value: item.label || '',
                  selector: { text: {} },
                  label: t('field.label'),
                  helper: t('annotations.label.placeholder'),
                  onChange: (value) => this._update(i, { label: String(value ?? '') }),
                })}
              </div>
              <div class="annotation-field">
                <div class="annotation-color-row">
                  <!-- Native color input kept on purpose: only theme-independent color
                       wheel available without relying on unstable HA internals -->
                  <label class="color-preview" title=${t('common.pickColor')}>
                    <span style="display:block;width:100%;height:100%;background: ${this._swatch(item.color)};"></span>
                    <input
                      type="color"
                      .value=${this._hex(item.color)}
                      @input=${(ev: Event) => this._update(i, { color: (ev.target as HTMLInputElement).value })}
                    />
                  </label>
                  ${formField({
                    name: 'color',
                    value: item.color || '',
                    selector: { text: {} },
                    label: t('field.color'),
                    helper: t('helper.color'),
                    onChange: (value) => this._update(i, { color: String(value ?? '') }),
                  })}
                  <ha-icon-button
                    .path=${ICON_DELETE}
                    .label=${t('annotations.remove')}
                    @click=${() => this._remove(i)}
                  ></ha-icon-button>
                </div>
              </div>
            </div>
          `,
        )}
        <button class="add-button" type="button" @click=${this._add}>
          <ha-svg-icon .path=${ICON_ADD}></ha-svg-icon>
          ${this.axis === 'xaxis' ? t('annotations.add.xaxis') : t('annotations.add.yaxis')}
        </button>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'apexcharts-card-annotations-editor': ApexChartsCardAnnotationsEditor;
  }
}
