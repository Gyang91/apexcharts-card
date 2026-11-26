import { LitElement, html, TemplateResult, CSSResultGroup } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { editorStyles } from '../styles';
import { t } from '../localize';
import './color-input';

const ICON_DELETE =
  'M19,6.41L17.59,5L12,10.59L6.41,5L5,6.41L10.59,12L5,17.59L6.41,19L12,13.41L17.59,19L19,17.59L13.41,12L19,6.41Z';
const ICON_ADD = 'M19,13H13V19H11V13H5V11H11V5H13V11H19V13Z';

@customElement('apexcharts-card-color-list-editor')
export class ApexChartsCardColorListEditor extends LitElement {
  @property({ attribute: false }) public colors: string[] = [];

  static get styles(): CSSResultGroup {
    return editorStyles;
  }

  private _fire(colors: string[]): void {
    this.dispatchEvent(
      new CustomEvent('value-changed', {
        detail: { value: colors.length > 0 ? colors : undefined },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private _update(index: number, value: string): void {
    const list = [...this.colors];
    list[index] = value;
    this._fire(list);
  }

  private _add(): void {
    this._fire([...this.colors, '']);
  }

  private _remove(index: number): void {
    const list = [...this.colors];
    list.splice(index, 1);
    this._fire(list);
  }

  protected render(): TemplateResult {
    return html`
      <div class="list-editor">
        ${this.colors.map(
          (c, i) => html`
            <div class="color-field" style="padding: 0 4px;">
              <apexcharts-card-color-input
                .value=${c}
                @value-changed=${(ev: CustomEvent) => {
                  ev.stopPropagation();
                  this._update(i, ev.detail.value ?? '');
                }}
              ></apexcharts-card-color-input>
              <ha-icon-button
                .path=${ICON_DELETE}
                .label=${t('display.colorList.remove')}
                @click=${() => this._remove(i)}
              ></ha-icon-button>
            </div>
          `,
        )}
        <button class="add-button" type="button" @click=${this._add}>
          <ha-icon-button .path=${ICON_ADD} .label=${t('display.colorList.add')}></ha-icon-button>
          ${t('display.colorList.add')}
        </button>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'apexcharts-card-color-list-editor': ApexChartsCardColorListEditor;
  }
}
