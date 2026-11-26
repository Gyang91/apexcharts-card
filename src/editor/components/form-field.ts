import { html, TemplateResult } from 'lit';
import { HomeAssistant } from 'custom-card-helpers';
import { computeHelper, computeLabel, stable } from '../helpers';

export interface FormField {
  name: string;
  value: unknown;
  selector: Record<string, unknown>;
  label: string;
  helper?: string;
  hass?: HomeAssistant;
  onChange: (value: unknown) => void;
}

// One field through ha-form, which loads Home Assistant's current input element itself:
// ha-textfield, used directly before, no longer exists in recent versions
export function formField(field: FormField): TemplateResult {
  return html`<ha-form
    .hass=${field.hass}
    .data=${stable({ [field.name]: field.value })}
    .schema=${stable([{ name: field.name, label: field.label, helper: field.helper, selector: field.selector }])}
    .computeLabel=${computeLabel}
    .computeHelper=${computeHelper}
    @value-changed=${(ev: CustomEvent) => {
      ev.stopPropagation();
      field.onChange((ev.detail.value as Record<string, unknown>)?.[field.name]);
    }}
  ></ha-form>`;
}
