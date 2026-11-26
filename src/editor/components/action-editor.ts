import { LitElement, html, TemplateResult, CSSResultGroup } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { HomeAssistant } from 'custom-card-helpers';
import { editorStyles } from '../styles';
import { ActionConfig } from '../../types-config';
import { HaFormSchema } from '../types';
import { computeHelper, computeLabel } from '../helpers';
import { t } from '../localize';

function getActionOptions(): { value: string; label: string }[] {
  return [
    { value: 'default', label: t('common.default') },
    { value: 'more-info', label: t('action.type.moreInfo') },
    { value: 'toggle', label: t('action.type.toggle') },
    { value: 'toggle-menu', label: t('action.type.toggleMenu') },
    { value: 'call-service', label: t('action.type.callService') },
    { value: 'navigate', label: t('action.type.navigate') },
    { value: 'url', label: t('action.type.url') },
    { value: 'none', label: t('action.type.none') },
    { value: 'fire-dom-event', label: t('action.type.fireDomEvent') },
  ];
}

function getHapticOptions(): { value: string; label: string }[] {
  return [
    { value: '', label: t('common.none') },
    { value: 'success', label: t('action.haptic.success') },
    { value: 'warning', label: t('action.haptic.warning') },
    { value: 'failure', label: t('action.haptic.failure') },
    { value: 'light', label: t('action.haptic.light') },
    { value: 'medium', label: t('action.haptic.medium') },
    { value: 'heavy', label: t('action.haptic.heavy') },
    { value: 'selection', label: t('action.haptic.selection') },
  ];
}

interface FormData {
  action?: string;
  service?: string;
  navigation_path?: string;
  url_path?: string;
  entity?: string;
  haptic?: string;
  confirmation_text?: string;
}

@customElement('apexcharts-card-action-editor')
export class ApexChartsCardActionEditor extends LitElement {
  @property({ attribute: false }) public hass?: HomeAssistant;
  @property({ attribute: false }) public action?: ActionConfig;
  @property({ type: String }) public label?: string;

  // Resolved on access so a locale change after construction is reflected
  private get _label(): string {
    return this.label ?? t('field.action');
  }

  static get styles(): CSSResultGroup {
    return editorStyles;
  }

  private _formData(): FormData {
    const a = (this.action || {}) as ActionConfig & {
      service?: string;
      navigation_path?: string;
      url_path?: string;
      entity?: string;
      haptic?: string;
    };
    const action = a.action || 'default';
    return {
      action,
      service: a.service,
      navigation_path: a.navigation_path,
      url_path: a.url_path,
      entity: a.entity,
      haptic: a.haptic || '',
      confirmation_text: typeof a.confirmation === 'object' ? a.confirmation?.text || '' : '',
    };
  }

  private _schema(): HaFormSchema[] {
    const data = this._formData();
    const schema: HaFormSchema[] = [
      {
        name: 'action',
        selector: { select: { mode: 'dropdown', options: getActionOptions() } },
      },
    ];

    if (data.action === 'more-info') {
      schema.push({ name: 'entity', selector: { entity: {} } });
    }
    if (data.action === 'call-service') {
      schema.push({
        name: 'service',
        selector: { text: {} },
        helper: t('action.helper.service'),
      } as HaFormSchema);
    }
    if (data.action === 'navigate') {
      schema.push({
        name: 'navigation_path',
        selector: { text: {} },
        helper: t('action.helper.navigationPath'),
      } as HaFormSchema);
    }
    if (data.action === 'url') {
      schema.push({
        name: 'url_path',
        selector: { text: { type: 'url' } },
      });
    }

    if (data.action && data.action !== 'default' && data.action !== 'none') {
      schema.push({
        name: 'haptic',
        selector: { select: { mode: 'dropdown', options: getHapticOptions() } },
      });
      schema.push({
        name: 'confirmation_text',
        selector: { text: {} },
        helper: t('action.helper.confirmationText'),
      } as HaFormSchema);
    }

    return schema;
  }

  private _onValueChanged = (ev: CustomEvent): void => {
    ev.stopPropagation();
    const data = ev.detail.value as FormData;
    const actionType = data.action;

    let next: ActionConfig | undefined;

    if (!actionType || actionType === 'default') {
      next = undefined;
    } else {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const prev = (this.action || {}) as any;
      const prevType: string | undefined = prev.action;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const merged: any = { ...prev };

      // A new action type drops the old type's keys, e.g. `service` on a `navigate` action
      if (prevType && prevType !== actionType) {
        const TYPE_KEYS: Record<string, string[]> = {
          'call-service': ['service'],
          navigate: ['navigation_path'],
          url: ['url_path'],
          'more-info': ['entity'],
        };
        const oldKeys = TYPE_KEYS[prevType] || [];
        for (const k of oldKeys) delete merged[k];
      }

      merged.action = actionType;

      if (actionType === 'call-service') {
        merged.service = data.service || '';
      } else if (actionType === 'navigate') {
        merged.navigation_path = data.navigation_path || '';
      } else if (actionType === 'url') {
        merged.url_path = data.url_path || '';
      } else if (actionType === 'more-info') {
        if (data.entity) {
          merged.entity = data.entity;
        } else {
          delete merged.entity;
        }
      }

      if (data.haptic === '' || data.haptic === undefined) {
        delete merged.haptic;
      } else {
        merged.haptic = data.haptic;
      }

      // Confirmation: preserve non-text confirmation state (boolean true, or
      // object with keys beyond `text`) when the user hasn't typed text.
      const prevConfirmation = prev.confirmation;
      if (data.confirmation_text) {
        if (prevConfirmation && typeof prevConfirmation === 'object') {
          merged.confirmation = { ...prevConfirmation, text: data.confirmation_text };
        } else {
          merged.confirmation = { text: data.confirmation_text };
        }
      } else {
        // No text typed. Keep confirmation only if it carries other meaning.
        if (prevConfirmation === true) {
          merged.confirmation = true;
        } else if (
          prevConfirmation &&
          typeof prevConfirmation === 'object' &&
          Object.keys(prevConfirmation).some((k) => k !== 'text')
        ) {
          const rest: Record<string, unknown> = { ...(prevConfirmation as Record<string, unknown>) };
          delete rest.text;
          merged.confirmation = rest;
        } else {
          delete merged.confirmation;
        }
      }

      next = merged as ActionConfig;
    }

    this.dispatchEvent(
      new CustomEvent('value-changed', {
        detail: { value: next },
        bubbles: true,
        composed: true,
      }),
    );
  };

  protected render(): TemplateResult {
    if (!this.hass) return html``;
    const data = this._formData();
    if (data.action === 'default') {
      return html`
        <ha-form
          .hass=${this.hass}
          .data=${data}
          .schema=${this._schema()}
          .computeLabel=${(s: HaFormSchema) => (s.name === 'action' ? this._label : computeLabel(s))}
          .computeHelper=${computeHelper}
          @value-changed=${this._onValueChanged}
        ></ha-form>
      `;
    }
    return html`
      <ha-form
        .hass=${this.hass}
        .data=${data}
        .schema=${this._schema()}
        .computeLabel=${(s: HaFormSchema) => (s.name === 'action' ? this._label : computeLabel(s))}
        .computeHelper=${computeHelper}
        @value-changed=${this._onValueChanged}
      ></ha-form>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'apexcharts-card-action-editor': ApexChartsCardActionEditor;
  }
}
