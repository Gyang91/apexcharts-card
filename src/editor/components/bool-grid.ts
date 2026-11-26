import { LitElement, html, TemplateResult, CSSResultGroup } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { editorStyles } from '../styles';
import { computeHelper, computeLabel, stable } from '../helpers';

export interface BoolField {
  name: string;
  label: string;
  helper?: string;
  value: boolean;
}

// Switches rendered by ha-form, which loads Home Assistant's own switch element: using
// ha-switch directly would depend on HA having loaded it (as ha-textfield showed)
@customElement('apexcharts-card-bool-grid')
export class ApexChartsCardBoolGrid extends LitElement {
  @property({ attribute: false }) public fields: BoolField[] = [];
  @property({ type: Number }) public columns = 2;

  static get styles(): CSSResultGroup {
    return editorStyles;
  }

  private _changed = (ev: CustomEvent): void => {
    ev.stopPropagation();
    const data = ev.detail.value as Record<string, boolean>;
    const field = this.fields.find((f) => !!data[f.name] !== !!f.value);
    if (!field) return;
    this.dispatchEvent(
      new CustomEvent('value-changed', {
        detail: { name: field.name, value: !!data[field.name] },
        bubbles: true,
        composed: true,
      }),
    );
  };

  protected render(): TemplateResult {
    const switches = this.fields.map((f) => ({
      name: f.name,
      label: f.label,
      helper: f.helper,
      selector: { boolean: {} },
    }));
    const schema =
      this.columns > 1 ? [{ type: 'grid', name: '', column_min_width: '180px', schema: switches }] : switches;
    return html`<ha-form
      .data=${stable(Object.fromEntries(this.fields.map((f) => [f.name, !!f.value])))}
      .schema=${stable(schema)}
      .computeLabel=${computeLabel}
      .computeHelper=${computeHelper}
      @value-changed=${this._changed}
    ></ha-form>`;
  }
}
