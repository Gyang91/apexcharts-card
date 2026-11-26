import { LitElement, html, TemplateResult, CSSResultGroup } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { computeColor } from '../../utils';
import { editorStyles } from '../styles';
import { t } from '../localize';
import { debounced } from '../helpers';
import { formField } from './form-field';

// A colour as text (hex, CSS name or var(--x)) next to a swatch that opens the
// browser's colour picker. Fires value-changed while typing or picking, after a
// short pause, so the preview follows without redrawing on every key.
@customElement('apexcharts-card-color-input')
export class ApexChartsCardColorInput extends LitElement {
  @property() public value?: string;

  @property() public label?: string;

  static get styles(): CSSResultGroup {
    return editorStyles;
  }

  private _resolved(fallback: string): string {
    if (!this.value) return fallback;
    try {
      return computeColor(this.value);
    } catch {
      return fallback;
    }
  }

  private _fire = debounced((value: string) => {
    this.dispatchEvent(
      new CustomEvent('value-changed', {
        detail: { value: value.trim() || undefined },
        bubbles: true,
        composed: true,
      }),
    );
  });

  private _picked = (ev: Event): void => {
    const value = (ev.target as HTMLInputElement).value;
    this.value = value;
    this._fire(value);
  };

  protected render(): TemplateResult {
    const resolved = this._resolved('');
    return html`
      <div class="color-field">
        <label class="color-preview" title=${t('common.pickColor')}>
          <span style="display:block;width:100%;height:100%;background: ${resolved || 'transparent'};"></span>
          <input
            type="color"
            .value=${/^#[0-9a-f]{6}$/i.test(resolved) ? resolved : '#000000'}
            @input=${this._picked}
          />
        </label>
        ${formField({
          name: 'color',
          value: this.value ?? '',
          selector: { text: {} },
          label: this.label ?? t('field.color'),
          helper: t('helper.color'),
          onChange: (value) => this._fire(String(value ?? '')),
        })}
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'apexcharts-card-color-input': ApexChartsCardColorInput;
  }
}
