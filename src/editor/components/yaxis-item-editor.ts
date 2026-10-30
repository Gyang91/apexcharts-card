import { LitElement, html, TemplateResult, nothing, CSSResultGroup } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { HomeAssistant } from 'custom-card-helpers';
import { ChartCardYAxisExternal } from '../../types-config';
import { HaFormSchema } from '../types';
import { editorStyles } from '../styles';
import { computeHelper, computeLabel, isValidYaxisLimit } from '../helpers';
import { BoolField } from './bool-grid';
import { t } from '../localize';
import './bool-grid';

// Boolean options use bool-grid; other fields use ha-form.
// A function (not a module-level constant) so option labels re-resolve to the current locale
// on every render.
function getSchema(): HaFormSchema[] {
  return [
    {
      type: 'grid',
      name: '',
      schema: [
        { name: 'id', selector: { text: {} } },
        {
          name: 'axis',
          selector: {
            select: {
              mode: 'dropdown',
              options: [
                { value: 'left', label: t('common.position.left') },
                { value: 'right', label: t('common.position.right') },
              ],
            },
          },
        },
      ],
    },
    {
      type: 'grid',
      name: '',
      schema: [
        { name: 'min', selector: { text: {} } },
        { name: 'max', selector: { text: {} } },
      ],
    },
    {
      type: 'grid',
      name: '',
      schema: [
        { name: 'decimals', selector: { number: { min: 0, max: 10, step: 1, mode: 'box' } } },
        { name: 'align_to', selector: { number: { mode: 'box' } } },
        { name: 'log_base', selector: { number: { mode: 'box' } } },
      ],
    },
  ];
}

@customElement('apexcharts-card-yaxis-item-editor')
export class ApexChartsCardYAxisItemEditor extends LitElement {
  @property({ attribute: false }) public hass?: HomeAssistant;
  @property({ attribute: false }) public yaxis?: ChartCardYAxisExternal;
  // Labels (apex_config.yaxis[i].labels) — handled separately from the yaxis core fields.
  @property({ type: Boolean }) public labelsShow = true;
  @property({ type: String }) public labelsFormatterBody = '';
  // Tick amount (apex_config.yaxis[i].tickAmount) — handled separately
  @property({ type: Number }) public tickAmount?: number;

  static get styles(): CSSResultGroup {
    return editorStyles;
  }

  private _formData(): Record<string, unknown> {
    const y = this.yaxis || {};
    return {
      id: y.id || '',
      axis: y.opposite ? 'right' : 'left',
      min: y.min === undefined ? '' : String(y.min),
      max: y.max === undefined ? '' : String(y.max),
      decimals: y.decimals,
      align_to: y.align_to,
      log_base: y.log_base ?? y.apex_config?.logBase,
    };
  }

  private _showChanged = (ev: CustomEvent): void => {
    ev.stopPropagation();
    const { name, value } = ev.detail as { name: string; value: boolean };
    const next: ChartCardYAxisExternal = { ...(this.yaxis || {}) };
    if (name === 'logarithmic') {
      next.logarithmic = value;
    } else {
      // show defaults to true; persist only the explicit `false`
      if (value === false) next.show = false;
      else delete next.show;
    }
    this.dispatchEvent(
      new CustomEvent('value-changed', {
        detail: { value: next },
        bubbles: true,
        composed: true,
      }),
    );
  };

  private _fireLabels(show: boolean | undefined, formatterBody: string): void {
    this.dispatchEvent(
      new CustomEvent('labels-changed', {
        detail: { show, formatterBody },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private _labelsShowChanged = (ev: CustomEvent): void => {
    ev.stopPropagation();
    const { value } = ev.detail as { name: string; value: boolean };
    // Default is true; persist only the explicit `false`
    this._fireLabels(value === false ? false : undefined, this.labelsFormatterBody);
  };

  private _labelsFormatterChanged = (ev: Event): void => {
    const body = (ev.target as HTMLInputElement | HTMLTextAreaElement).value;
    this._fireLabels(this.labelsShow === false ? false : undefined, body);
  };

  private _tickAmountChanged = (ev: Event): void => {
    const raw = (ev.target as HTMLInputElement).value;
    const trimmed = raw.trim();
    let value: number | undefined;
    if (trimmed === '') {
      value = undefined;
    } else {
      const n = Number(trimmed);
      value = isNaN(n) || n < 0 ? undefined : Math.floor(n);
    }
    this.dispatchEvent(
      new CustomEvent('tick-amount-changed', {
        detail: { value },
        bubbles: true,
        composed: true,
      }),
    );
  };

  private _onChange = (ev: CustomEvent): void => {
    ev.stopPropagation();
    const data = ev.detail.value as Record<string, unknown>;
    const next: ChartCardYAxisExternal = { ...(this.yaxis || {}) };
    if ('id' in data) {
      if (data.id) next.id = data.id as string;
      else delete next.id;
    }
    if ('axis' in data) {
      if (data.axis === 'right') next.opposite = true;
      else delete next.opposite;
    }
    if ('min' in data) {
      const raw = (data.min as string | undefined) ?? '';
      const v = typeof raw === 'string' ? raw.trim() : String(raw);
      if (v === '' || data.min === undefined || data.min === null) {
        delete next.min;
      } else if (!isNaN(Number(v)) && !v.startsWith('~') && !v.startsWith('|')) {
        next.min = Number(v);
      } else {
        next.min = v;
      }
    }
    if ('max' in data) {
      const raw = (data.max as string | undefined) ?? '';
      const v = typeof raw === 'string' ? raw.trim() : String(raw);
      if (v === '' || data.max === undefined || data.max === null) {
        delete next.max;
      } else if (!isNaN(Number(v)) && !v.startsWith('~') && !v.startsWith('|')) {
        next.max = Number(v);
      } else {
        next.max = v;
      }
    }
    if ('decimals' in data) {
      if (data.decimals === undefined || data.decimals === '') delete next.decimals;
      else next.decimals = Number(data.decimals);
    }
    if ('align_to' in data) {
      if (data.align_to === undefined || data.align_to === '') delete next.align_to;
      else next.align_to = Number(data.align_to);
    }
    if ('log_base' in data) {
      if (data.log_base === undefined || data.log_base === '' || data.log_base === null) delete next.log_base;
      else next.log_base = Number(data.log_base);
    }
    this.dispatchEvent(
      new CustomEvent('value-changed', {
        detail: { value: next },
        bubbles: true,
        composed: true,
      }),
    );
  };

  private _validation(): TemplateResult | typeof nothing {
    const y = this.yaxis;
    if (!y) return nothing;
    const errors: string[] = [];
    if (y.min !== undefined && !isValidYaxisLimit(String(y.min))) {
      errors.push(t('yaxis.validation.min'));
    }
    if (y.max !== undefined && !isValidYaxisLimit(String(y.max))) {
      errors.push(t('yaxis.validation.max'));
    }
    const base = y.log_base ?? y.apex_config?.logBase ?? 10;
    if (typeof base !== 'number' || !Number.isFinite(base) || base <= 1) {
      errors.push(t('error.yaxis.logBase'));
    }
    if (y.logarithmic ?? y.apex_config?.logarithmic ?? false) {
      for (const limit of [y.min, y.max]) {
        if (limit === undefined || limit === 'auto' || String(limit).startsWith('|')) continue;
        const value = Number(String(limit).replace(/^~/, ''));
        if (!Number.isFinite(value) || value <= 0) {
          errors.push(t('error.yaxis.logLimit'));
          break;
        }
      }
    }
    if (errors.length === 0) return nothing;
    return html`<div class="validation-error">${errors.map((e) => html`<div>• ${e}</div>`)}</div>`;
  }

  protected render(): TemplateResult {
    if (!this.hass) return html``;
    const showFields: BoolField[] = [
      {
        name: 'show',
        label: computeLabel({ name: 'show' } as HaFormSchema),
        value: this.yaxis?.show ?? true,
      },
      {
        name: 'logarithmic',
        label: computeLabel({ name: 'logarithmic' } as HaFormSchema),
        value: this.yaxis?.logarithmic ?? this.yaxis?.apex_config?.logarithmic ?? false,
      },
    ];
    const labelsShowFields: BoolField[] = [
      {
        name: 'labels_show',
        label: t('yaxis.labels.show.label'),
        helper: t('yaxis.labels.show.helper'),
        value: this.labelsShow,
      },
    ];
    return html`
      <div class="section">
        <ha-form
          .hass=${this.hass}
          .data=${this._formData()}
          .schema=${getSchema()}
          .computeLabel=${computeLabel}
          .computeHelper=${computeHelper}
          @value-changed=${this._onChange}
        ></ha-form>
        <apexcharts-card-bool-grid
          .fields=${showFields}
          .columns=${1}
          @value-changed=${this._showChanged}
        ></apexcharts-card-bool-grid>
        <div class="tick-amount-block">
          <ha-textfield
            class="tick-amount-input"
            label=${t('yaxis.tickAmount.label')}
            type="number"
            min="0"
            step="1"
            placeholder=${t('common.auto')}
            .value=${this.tickAmount === undefined ? '' : String(this.tickAmount)}
            @change=${this._tickAmountChanged}
          ></ha-textfield>
          <div class="tick-amount-helper">
            ${t('yaxis.tickAmount.helperPrefix')}
            <code>10</code> ${t('yaxis.tickAmount.helperMiddle')} <code>1</code> ${t('yaxis.tickAmount.helperMiddle2')}
            <code>10</code> ${t('yaxis.tickAmount.helperSuffix')}
          </div>
        </div>
        <ha-expansion-panel outlined header=${t('yaxis.panel.labels')}>
          <div class="section">
            <apexcharts-card-bool-grid
              .fields=${labelsShowFields}
              .columns=${1}
              @value-changed=${this._labelsShowChanged}
            ></apexcharts-card-bool-grid>
            <div class="formatter-block">
              <ha-textarea
                class="formatter-textarea"
                label=${t('yaxis.formatter.label')}
                rows="4"
                placeholder="return value + ' kWh';"
                .value=${this.labelsFormatterBody}
                @change=${this._labelsFormatterChanged}
              ></ha-textarea>
              <div class="formatter-helper">
                ${t('yaxis.formatter.helperPrefix')} <code>value</code>. ${t('yaxis.formatter.helperMiddle')}
                <code>EVAL:function(value) { ... }</code> ${t('yaxis.formatter.helperSuffix')}
              </div>
            </div>
          </div>
        </ha-expansion-panel>
      </div>
      ${this._validation()}
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'apexcharts-card-yaxis-item-editor': ApexChartsCardYAxisItemEditor;
  }
}
