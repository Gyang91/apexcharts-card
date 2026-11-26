import { html, nothing, TemplateResult } from 'lit';
import { t } from '../localize';

// mdi arrow-up / arrow-down / delete / chevron-down
const ICON_UP = 'M13,20H11V8L5.5,13.5L4.08,12.08L12,4.16L19.92,12.08L18.5,13.5L13,8V20Z';
const ICON_DOWN = 'M11,4H13V16L18.5,10.5L19.92,11.92L12,19.84L4.08,11.92L5.5,10.5L11,16V4Z';
const ICON_DELETE = 'M19,4H15.5L14.5,3H9.5L8.5,4H5V6H19M6,19A2,2 0 0,0 8,21H16A2,2 0 0,0 18,19V7H6V19Z';
const ICON_CHEVRON = 'M7.41,8.58L12,13.17L16.59,8.58L18,10L12,16L6,10L7.41,8.58Z';

export interface ListControls {
  index: number;
  count: number;
  expanded: boolean;
  movable?: boolean;
  removable?: boolean;
  onMove: (delta: -1 | 1) => void;
  onRemove: () => void;
  onToggle: () => void;
}

// Header buttons of a list item: arrows to move it (only where it can go), delete, and,
// apart from them, a chevron that turns when the item opens
export function listControls(c: ListControls): TemplateResult {
  const movable = c.movable !== false && c.count > 1;
  return html`<div class="item-controls" @click=${(ev: Event) => ev.stopPropagation()}>
    ${
      movable
        ? html`<ha-icon-button
              class="move ${c.index === 0 ? 'unused' : ''}"
              .path=${ICON_UP}
              .label=${t('common.moveUp')}
              @click=${() => c.onMove(-1)}
            ></ha-icon-button>
            <ha-icon-button
              class="move ${c.index === c.count - 1 ? 'unused' : ''}"
              .path=${ICON_DOWN}
              .label=${t('common.moveDown')}
              @click=${() => c.onMove(1)}
            ></ha-icon-button>`
        : nothing
    }
    <ha-icon-button
      .path=${ICON_DELETE}
      .label=${t('common.delete')}
      .disabled=${c.removable === false}
      @click=${c.onRemove}
    ></ha-icon-button>
    <ha-icon-button
      class="chevron ${c.expanded ? 'open' : ''}"
      .path=${ICON_CHEVRON}
      .label=${c.expanded ? t('common.collapse') : t('common.expand')}
      aria-expanded=${c.expanded}
      @click=${c.onToggle}
    ></ha-icon-button>
  </div>`;
}
