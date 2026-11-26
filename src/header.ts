// The card's header: its title and the state of each series, both able to run tap, hold
// and double-tap actions with a ripple
import { html, TemplateResult } from 'lit';
import { ifDefined } from 'lit/directives/if-defined.js';
import { classMap } from 'lit/directives/class-map.js';
import { handleAction, HomeAssistant } from 'custom-card-helpers';
import type { HassEntity } from 'home-assistant-js-websocket';
import type { Ripple } from '@material/mwc-ripple';
import { actionHandler } from './action-handler-directive';
import { computeName, computeUom, isExternalStatisticId, prettyPrintTime } from './utils';
import { NO_VALUE } from './const';
import type { ActionHandlerDetail, ChartCardConfig, ChartCardSeriesConfig } from './types';
import type { ActionsConfig } from './types-config';

export interface HeaderContext {
  // Runs actions and holds the ripples in its shadow root
  host: HTMLElement;
  config: ChartCardConfig;
  hass?: HomeAssistant;
  entities: (HassEntity | undefined)[];
  states: (number | null)[];
  hasNoEntityState(index: number): boolean;
  stateStyle(serie: ChartCardSeriesConfig, value: number | null): string;
  formatState(value: number | null, index: number): string | number | null;
}

const isSet = (action?: { action?: string }) => !!action?.action && action.action !== 'none';

// Whether any gesture does something: a missing tap action still means the default one
const hasActions = (actions: ActionsConfig) =>
  actions.tap_action?.action !== 'none' || isSet(actions.hold_action) || isSet(actions.double_tap_action);

// Optional `entity` of a tap/hold/double_tap action (ActionConfig does not declare it)
const actionEntity = (config: ActionsConfig, action: ActionHandlerDetail['action']): string | undefined =>
  (config[`${action}_action`] as { entity?: string } | undefined)?.entity;

function runAction(ctx: HeaderContext, ev: CustomEvent, actions: ActionsConfig | undefined, entity?: string): void {
  const action = ev.detail?.action as ActionHandlerDetail['action'] | undefined;
  if (!action || !['tap', 'hold', 'double_tap'].includes(action)) return;
  const config: ActionsConfig = actions ? JSON.parse(JSON.stringify(actions)) : {};
  config.entity = actionEntity(config, action) || entity;
  handleAction(ctx.host, ctx.hass!, config, action);
}

function ripple(ctx: HeaderContext, id: number | string): Ripple | undefined {
  return ctx.host.shadowRoot?.getElementById(`ripple-${id}`) as Ripple | undefined;
}

// One element that takes the gestures of `actions` when enabled, with its ripple
function actionable(
  ctx: HeaderContext,
  id: string,
  rippleId: number | string,
  enabled: boolean,
  label: string | undefined,
  actions: ActionsConfig | undefined,
  onAction: (ev: CustomEvent) => void,
  content: TemplateResult,
): TemplateResult {
  const press = (ev: Event) => ripple(ctx, rippleId)?.startPress?.(ev);
  const release = () => ripple(ctx, rippleId)?.endPress?.();
  return html`<div
    id=${id}
    class=${enabled ? 'actions' : 'disabled'}
    role=${ifDefined(enabled ? 'button' : undefined)}
    tabindex=${ifDefined(enabled ? '0' : undefined)}
    aria-label=${ifDefined(enabled ? label : undefined)}
    @action=${onAction}
    .actionHandler=${actionHandler({
      hasDoubleClick: isSet(actions?.double_tap_action),
      hasHold: isSet(actions?.hold_action),
    })}
    @focus=${() => ripple(ctx, rippleId)?.startFocus?.()}
    @blur=${() => ripple(ctx, rippleId)?.endFocus?.()}
    @mousedown=${press}
    @mouseup=${release}
    @touchstart=${{ handleEvent: press, passive: true }}
    @touchend=${release}
    @touchcancel=${release}
  >
    ${content}
    <mwc-ripple unbounded id="ripple-${rippleId}" aria-hidden="true"></mwc-ripple>
  </div>`;
}

function renderTitle(ctx: HeaderContext): TemplateResult {
  const header = ctx.config.header;
  const actions = header?.title_actions;
  const enabled = !header?.disable_actions && !!actions && hasActions(actions);
  return actionable(
    ctx,
    'header__title',
    'title',
    enabled,
    header?.title,
    actions,
    (ev) => runAction(ctx, ev, actions),
    html`<span>${header?.title}</span>`,
  );
}

function renderState(ctx: HeaderContext, serie: ChartCardSeriesConfig, index: number): TemplateResult {
  const value = ctx.states[index];
  const actions = serie.header_actions;
  const external = isExternalStatisticId(serie.entity);
  // Without its own actions a state opens more-info, which needs an entity
  const enabled = !ctx.config.header?.disable_actions && (actions ? hasActions(actions) : !ctx.hasNoEntityState(index));
  const name = computeName(ctx.hass, index, ctx.config.series, ctx.entities);
  const shown =
    value === 0
      ? 0
      : serie.show.as_duration
        ? prettyPrintTime(value, serie.show.as_duration)
        : ctx.formatState(value, index) || NO_VALUE;
  return actionable(
    ctx,
    'states__state',
    index,
    enabled,
    name,
    actions,
    (ev) => {
      // An external statistic has no entity to open more-info for
      if (external && !actions) return;
      runAction(ctx, ev, actions, external ? undefined : serie.entity);
    },
    html`<div id="state__value">
        <span id="state" style=${ctx.stateStyle(serie, value)}>${shown}</span>
        ${serie.show.as_duration ? '' : html`<span id="uom">${computeUom(index, ctx.config.series, ctx.entities)}</span>`}
      </div>
      ${serie.show.name_in_header ? html`<div id="state__name">${name}</div>` : ''}`,
  );
}

export function renderHeader(ctx: HeaderContext): TemplateResult {
  const header = ctx.config.header;
  return html`<div id="header" class=${classMap({ floating: !!header?.floating })}>
    ${!header?.standard_format && header?.title ? renderTitle(ctx) : ''}
    ${
      header?.show_states
        ? html`<div id="header__states">
            ${ctx.config.series.map((serie, index) =>
              serie.show.in_header &&
              (serie.show.null_in_header || ctx.states[index] !== null) &&
              (serie.show.zero_in_header || ctx.states[index] !== 0)
                ? renderState(ctx, serie, index)
                : '',
            )}
          </div>`
        : ''
    }
  </div>`;
}
