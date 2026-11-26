import { LitElement, html, TemplateResult, CSSResultGroup } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { HomeAssistant } from 'custom-card-helpers';
import { ChartCardExternalConfig } from '../types-config';
import { EDITOR_TABS } from './types';
import { editorStyles } from './styles';
import { setEditorLocale, t } from './localize';
import { changeChartType, emptyStash, removeUnsupported, supports, unsupportedSettings } from './support';

// Registers the custom elements
import './components/series-editor';
import './components/header-editor';
import './components/yaxis-editor';
import './components/color-list-editor';
import './components/yaml-editor';
import './tabs/general-tab';
import './tabs/display-tab';
import './tabs/advanced-tab';

const SEND_INTERVAL = 250;

@customElement('apexcharts-card-editor')
export class ApexChartsCardEditor extends LitElement {
  @property({ attribute: false }) public hass?: HomeAssistant;
  @state() private _config?: ChartCardExternalConfig;
  @state() private _activeTab = 'tabs.general';
  private _stash = emptyStash();

  public setConfig(config: ChartCardExternalConfig): void {
    const json = JSON.stringify(config);
    // Our own change coming back, or an older one while a newer waits to be sent:
    // nothing new to show, and re-rendering every field would only cost time
    if (this._config && (json === JSON.stringify(this._config) || (this._pending && json === this._sentJson))) return;
    this._cancelPending();
    const configDup = JSON.parse(json);
    // Migrate legacy 'entities' key (same as the card's setConfig does)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if ((configDup as any).entities) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      configDup.series = (configDup as any).entities;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (configDup as any).entities;
    }
    this._config = configDup;
  }

  // Home Assistant rebuilds the preview card for every config it gets: a change goes out at
  // once, then at most every SEND_INTERVAL ms while typing, and before focus leaves the editor
  private _pending?: ReturnType<typeof setTimeout>;
  private _sentJson?: string;
  private _lastSent = 0;

  private _fireConfig(config: ChartCardExternalConfig): void {
    this._config = config;
    this._cancelPending();
    const wait = this._lastSent + SEND_INTERVAL - Date.now();
    if (wait <= 0) this._send();
    else this._pending = setTimeout(() => this._send(), wait);
  }

  private _send = (): void => {
    this._cancelPending();
    if (!this._config) return;
    this._lastSent = Date.now();
    this._sentJson = JSON.stringify(this._config);
    this.dispatchEvent(
      new CustomEvent('config-changed', {
        detail: { config: this._config },
        bubbles: true,
        composed: true,
      }),
    );
  };

  private _cancelPending(): void {
    clearTimeout(this._pending);
    this._pending = undefined;
  }

  private _flush = (): void => {
    if (this._pending) this._send();
  };

  connectedCallback(): void {
    super.connectedCallback();
    this.addEventListener('focusout', this._flush);
    // A tap on Save need not move focus (iOS): a press anywhere sends first
    window.addEventListener('pointerdown', this._flush, true);
  }

  disconnectedCallback(): void {
    this._flush();
    this.removeEventListener('focusout', this._flush);
    window.removeEventListener('pointerdown', this._flush, true);
    super.disconnectedCallback();
  }

  private _onConfigChanged = (ev: CustomEvent): void => {
    ev.stopPropagation();
    const cfg = ev.detail?.config as ChartCardExternalConfig | undefined;
    if (cfg) this._fireConfig(cfg);
  };

  private _onChartTypeChanged = (ev: CustomEvent): void => {
    ev.stopPropagation();
    if (this._config) this._fireConfig(changeChartType(this._config, ev.detail.value, this._stash));
  };

  static get styles(): CSSResultGroup {
    return editorStyles;
  }

  protected render(): TemplateResult {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    setEditorLocale((this.hass as any)?.locale?.language || this.hass?.language);
    if (!this._config || !this.hass) return html``;

    // The Y-Axis tab only where the chart has a y axis; elsewhere it falls back to General
    const tabs = EDITOR_TABS.filter((tab) => tab.label !== 'tabs.yaxis' || supports(this._config, 'yaxis'));
    const active = tabs.some((tab) => tab.label === this._activeTab) ? this._activeTab : 'tabs.general';
    const unsupported = unsupportedSettings(this._config);

    return html`
      ${
        unsupported.length
          ? html`<div class="unsupported" role="alert">
              <span>${t('editor.unsupported')} ${unsupported.map((key) => t(key)).join(', ')}</span>
              <button
                type="button"
                @click=${() => this._fireConfig(removeUnsupported(this._config as ChartCardExternalConfig))}
              >
                ${t('editor.unsupported.remove')}
              </button>
            </div>`
          : ''
      }
      ${
        this._config.chart_type === 'rangeArea' && (this._config.series || []).length !== 2
          ? html`<div class="unsupported" role="alert">
              <span>${t('editor.rangeAreaPair', { count: (this._config.series || []).length })}</span>
            </div>`
          : ''
      }
      <div class="tab-bar" role="tablist">
        ${tabs.map(
          (tab) => html`
            <button
              class="tab ${tab.label === active ? 'active' : ''}"
              role="tab"
              aria-selected=${tab.label === active}
              @click=${() => {
                this._activeTab = tab.label;
              }}
            >
              <ha-icon icon=${tab.icon}></ha-icon>
              <span>${t(tab.label)}</span>
            </button>
          `,
        )}
      </div>
      <div class="tab-content">${this._renderTab(active)}</div>
    `;
  }

  private _renderTab(active: string): TemplateResult {
    switch (active) {
      case 'tabs.series':
        return this._renderSeriesTab();
      case 'tabs.display':
        return this._renderDisplayTab();
      case 'tabs.yaxis':
        return this._renderYAxisTab();
      case 'tabs.advanced':
        return this._renderAdvancedTab();
      default:
        return this._renderGeneralTab();
    }
  }

  private _renderGeneralTab(): TemplateResult {
    return html`
      <apexcharts-card-editor-general
        .hass=${this.hass}
        .config=${this._config}
        @config-changed=${this._onConfigChanged}
        @chart-type-changed=${this._onChartTypeChanged}
      ></apexcharts-card-editor-general>
    `;
  }

  private _renderSeriesTab(): TemplateResult {
    return html`
      <apexcharts-card-series-editor
        .hass=${this.hass}
        .config=${this._config}
        @config-changed=${this._onConfigChanged}
      ></apexcharts-card-series-editor>
    `;
  }

  private _renderDisplayTab(): TemplateResult {
    return html`
      <apexcharts-card-editor-display
        .hass=${this.hass}
        .config=${this._config}
        @config-changed=${this._onConfigChanged}
      ></apexcharts-card-editor-display>
    `;
  }

  private _renderYAxisTab(): TemplateResult {
    return html`
      <apexcharts-card-yaxis-editor
        .hass=${this.hass}
        .config=${this._config}
        @config-changed=${this._onConfigChanged}
      ></apexcharts-card-yaxis-editor>
    `;
  }

  private _renderAdvancedTab(): TemplateResult {
    return html`
      <apexcharts-card-editor-advanced
        .hass=${this.hass}
        .config=${this._config}
        @config-changed=${this._onConfigChanged}
      ></apexcharts-card-editor-advanced>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'apexcharts-card-editor': ApexChartsCardEditor;
  }
}
