import { css, CSSResultGroup } from 'lit';

export const stylesApex: CSSResultGroup = css`
  .time-navigation {
    padding: 8px 12px;
    color: var(--secondary-text-color);
  }
  .time-navigation-buttons {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }
  .time-navigation button {
    min-width: 44px;
    min-height: 44px;
    padding: 6px 10px;
    cursor: pointer;
    border: 1px solid var(--divider-color);
    border-radius: 8px;
    background: var(--card-background-color);
    color: var(--primary-text-color);
    font: inherit;
  }
  .time-navigation button[aria-pressed='true'] {
    border-color: var(--primary-color);
    color: var(--primary-color);
  }
  .time-navigation button:focus-visible {
    outline: 2px solid var(--primary-color);
    outline-offset: 2px;
  }
  .time-navigation button:disabled {
    opacity: 0.5;
    cursor: default;
  }
  .time-navigation-range {
    margin-top: 6px;
    font-size: 0.85em;
  }
  :host {
    display: block;
    container-type: inline-size;

    /* --- Premium design tokens (derived from HA theme, overridable) --- */
    --p-space-1: 4px;
    --p-space-2: 8px;
    --p-space-3: 12px;
    --p-space-4: 16px;
    --p-space-5: 20px;

    --p-radius-sm: 8px;
    --p-radius-md: 12px;
    --p-radius-lg: 16px;

    --p-font-stack: -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Helvetica Neue', Roboto, system-ui, sans-serif;
    --p-letter-tight: -0.022em;
    --p-letter-normal: -0.011em;

    --p-fg-1: var(--primary-text-color);
    --p-fg-2: var(--secondary-text-color);
    --p-accent: var(--primary-color);
    --p-surface: var(--ha-card-background, var(--card-background-color));

    --p-elev-1:
      0 1px 0 color-mix(in oklab, var(--p-fg-1) 4%, transparent),
      0 1px 3px color-mix(in oklab, var(--p-fg-1) 6%, transparent);
    --p-elev-2:
      0 1px 0 color-mix(in oklab, var(--p-fg-1) 6%, transparent),
      0 4px 12px color-mix(in oklab, var(--p-fg-1) 10%, transparent),
      0 12px 32px color-mix(in oklab, var(--p-fg-1) 8%, transparent);
    --p-elev-pressed: inset 0 1px 2px color-mix(in oklab, var(--p-fg-1) 10%, transparent);

    --p-motion-fast: 160ms cubic-bezier(0.32, 0.72, 0, 1);
    --p-motion-normal: 240ms cubic-bezier(0.32, 0.72, 0, 1);

    --p-blur-glass: saturate(180%) blur(20px);
    --p-glass-bg: color-mix(in oklab, var(--p-surface) 72%, transparent);
    --p-glass-border: 1px solid color-mix(in oklab, var(--p-fg-1) 10%, transparent);
  }

  @media (prefers-reduced-motion: reduce) {
    :host {
      --p-motion-fast: 1ms cubic-bezier(0.32, 0.72, 0, 1);
      --p-motion-normal: 1ms cubic-bezier(0.32, 0.72, 0, 1);
    }
    /* also covers ApexCharts internal transitions/animations */
    * {
      animation-duration: 0.01ms !important;
      transition-duration: 0.01ms !important;
    }
  }

  ha-card {
    /* overflow must stay visible: apexcharts tooltips/toolbar render outside the canvas */
    overflow: visible;
    position: relative;
    isolation: isolate;
  }

  .data-status {
    padding: 8px 16px;
    color: var(--secondary-text-color);
    font-size: 0.875rem;
  }

  /* Fill a fixed-height cell: the header, ha-card title and brush keep their height and #graph
     gets the rest. The host is a block, so it needs a height too for ha-card's 100% to resolve. */
  :host([data-fill-height]) {
    height: 100%;
  }
  ha-card.section {
    height: 100%;
    display: flex;
    flex-direction: column;
  }
  /* The footers are absolutely positioned; auto height leaves them a gap below the chart. */
  ha-card.section:has(> #last_updated, > #version_info) {
    padding-bottom: 1em;
  }

  .wrapper {
    display: grid;
    grid-template-areas: 'header' 'graph';
    /* minmax(0, 1fr), not 1fr: a track cannot shrink below its content's min-content width,
       so a chart wider than the card would keep the header and #graph at that width (#160). */
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: min-content 1fr;
  }
  ha-card.section .wrapper {
    flex: 1 1 auto;
    grid-template-rows: min-content minmax(0, 1fr);
    min-width: 0;
    min-height: 0;
  }

  #graph-wrapper {
    height: 100%;
    grid-area: graph;
    min-width: 0;
  }

  /* Skeleton while ApexCharts has not rendered yet (#graph is empty until then) */
  :host(:not([data-appearance='minimal'])) #graph:empty {
    min-height: 120px;
    margin: var(--p-space-3) var(--p-space-4);
    border-radius: var(--p-radius-sm);
    background: linear-gradient(
      100deg,
      color-mix(in oklab, var(--p-fg-1) 6%, transparent) 30%,
      color-mix(in oklab, var(--p-fg-1) 11%, transparent) 50%,
      color-mix(in oklab, var(--p-fg-1) 6%, transparent) 70%
    );
    background-size: 200% 100%;
    animation: skeleton-shimmer 1.4s linear infinite;
  }
  @keyframes skeleton-shimmer {
    to {
      background-position: -200% 0;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    :host #graph:empty {
      animation: none;
    }
  }
  ha-card.section #graph-wrapper {
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
  }
  ha-card.section #graph {
    flex: 1 1 auto;
    /* ApexCharts pins an inline min-height to the drawn chart, which would stop it shrinking. */
    min-height: 0 !important;
  }
  ha-card.section #brush {
    flex: none;
  }

  /* Needed for minimal layout */
  svg:not(:root) {
    overflow: visible !important;
  }

  #header {
    padding: var(--p-space-3) var(--p-space-4) 0px;
    grid-area: header;
    overflow: hidden;
  }
  ha-card.section #header {
    min-width: 0;
  }
  #header.floating {
    position: absolute;
    top: 0px;
    left: 0px;
    right: 0px;
    z-index: 2;
  }
  /* Liquid Glass: only when the header floats over the chart content */
  :host(:not([data-appearance='minimal'])) #header.floating {
    margin: var(--p-space-2);
    padding: var(--p-space-2) var(--p-space-3);
    border-radius: var(--p-radius-md);
    background: var(--p-glass-bg);
    border: var(--p-glass-border);
    backdrop-filter: var(--p-blur-glass);
    -webkit-backdrop-filter: var(--p-blur-glass);
    box-shadow: var(--p-elev-1);
  }
  @supports not (backdrop-filter: blur(20px)) {
    :host(:not([data-appearance='minimal'])) #header.floating {
      background: var(--p-surface);
    }
  }

  #header__title {
    color: var(--secondary-text-color);
    font: 500 16px/1.3 var(--p-font-stack);
    letter-spacing: var(--p-letter-tight);
    text-wrap: pretty;
    -webkit-font-smoothing: antialiased;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
    padding-bottom: 5px;
  }

  #header__states {
    display: flex;
    justify-content: space-between;
    flex-flow: row wrap;
    margin: -5px;
  }

  #header__states > * {
    margin: 5px;
  }

  #states__state {
    flex: 0 0 10%;
    position: relative;
  }

  #header__title {
    position: relative;
  }

  #header__title.actions,
  #states__state.actions {
    cursor: pointer;
    border-radius: var(--p-radius-sm);
    transition:
      transform var(--p-motion-fast),
      background var(--p-motion-fast),
      box-shadow var(--p-motion-fast);
    transform-origin: center;
  }
  @media (hover: hover) {
    :host(:not([data-appearance='minimal'])) #header__title.actions:hover,
    :host(:not([data-appearance='minimal'])) #states__state.actions:hover {
      background: color-mix(in oklab, var(--p-fg-1) 6%, transparent);
    }
  }
  :host(:not([data-appearance='minimal'])) #header__title.actions:active,
  :host(:not([data-appearance='minimal'])) #states__state.actions:active {
    transform: scale(0.96);
    box-shadow: var(--p-elev-pressed);
    transition-duration: 80ms;
  }
  #header__title.actions:focus-visible,
  #states__state.actions:focus-visible {
    outline: 2px solid var(--p-accent);
    outline-offset: 3px;
  }

  #header__title.disabled,
  #states__state.disabled {
    pointer-events: none;
  }

  #state__value {
    display: table;
    white-space: nowrap;
  }

  #state__value > #state {
    font: 500 1.8em/1.15 var(--p-font-stack);
    letter-spacing: var(--p-letter-tight);
    white-space: nowrap;
    font-variant-numeric: tabular-nums;
    -webkit-font-smoothing: antialiased;
  }

  #state__value > #uom {
    font: 400 1em/1.3 var(--p-font-stack);
    opacity: 0.8;
    white-space: nowrap;
  }

  #state__name {
    font: 400 0.8em/1.3 var(--p-font-stack);
    letter-spacing: var(--p-letter-normal);
    color: var(--p-fg-2);
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  #last_updated {
    font-size: 0.63em;
    font-weight: 300;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
    position: absolute;
    bottom: 0px;
    right: 4px;
    opacity: 0.5;
  }

  #version_info {
    font-size: 0.63em;
    font-weight: 300;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
    position: absolute;
    bottom: 0px;
    left: 4px;
    opacity: 0.5;
  }

  /* Apex Charts Default CSS */
  @keyframes opaque {
    0% {
      opacity: 0;
    }

    to {
      opacity: 1;
    }
  }

  @keyframes resizeanim {
    0%,
    to {
      opacity: 0;
    }
  }

  .apexcharts-canvas {
    position: relative;
    direction: ltr !important;
    user-select: none;
    overflow: visible !important;
  }

  .apexcharts-canvas ::-webkit-scrollbar {
    -webkit-appearance: none;
    width: 6px;
  }

  .apexcharts-canvas ::-webkit-scrollbar-thumb {
    border-radius: 4px;
    background-color: color-mix(in oklab, var(--primary-text-color) 40%, transparent);
  }

  .apexcharts-inner {
    position: relative;
  }

  .apexcharts-text tspan {
    font-family: inherit;
  }

  rect.legend-mouseover-inactive,
  .legend-mouseover-inactive rect,
  .legend-mouseover-inactive path,
  .legend-mouseover-inactive circle,
  .legend-mouseover-inactive line,
  .legend-mouseover-inactive text.apexcharts-yaxis-title-text,
  .legend-mouseover-inactive text.apexcharts-yaxis-label {
    transition: opacity 150ms cubic-bezier(0.4, 0, 0.2, 1);
    opacity: 0.2;
  }

  .apexcharts-legend-text {
    padding-left: 15px;
    margin-left: -15px;
  }

  .apexcharts-series-collapsed {
    opacity: 0;
  }

  .apexcharts-tooltip {
    border-radius: 8px;
    box-shadow:
      0 1px 3px color-mix(in oklab, var(--primary-text-color) 12%, transparent),
      0 4px 12px color-mix(in oklab, var(--primary-text-color) 10%, transparent);
    cursor: default;
    font-size: 14px;
    left: 62px;
    opacity: 0;
    pointer-events: none;
    position: absolute;
    top: 20px;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    white-space: nowrap;
    z-index: 12;
    transition: opacity 150ms cubic-bezier(0.4, 0, 0.2, 1);
  }

  .apexcharts-tooltip.apexcharts-active {
    opacity: 1;
  }

  .apexcharts-tooltip.apexcharts-theme-light,
  .apexcharts-tooltip.apexcharts-theme-dark {
    color: var(--primary-text-color);
    border: 1px solid var(--divider-color);
    background: var(--card-background-color);
  }

  .apexcharts-tooltip * {
    font-family: inherit;
  }

  .apexcharts-tooltip-title {
    padding: 6px;
    font-size: 15px;
    margin-bottom: 4px;
  }

  .apexcharts-tooltip.apexcharts-theme-light .apexcharts-tooltip-title,
  .apexcharts-tooltip.apexcharts-theme-dark .apexcharts-tooltip-title {
    background: var(--primary-background-color);
    border-bottom: 1px solid var(--divider-color);
  }

  .apexcharts-tooltip-text-goals-value,
  .apexcharts-tooltip-text-y-value,
  .apexcharts-tooltip-text-z-value {
    display: inline-block;
    margin-left: 5px;
    font-weight: 600;
  }

  .apexcharts-tooltip-text-goals-label:empty,
  .apexcharts-tooltip-text-goals-value:empty,
  .apexcharts-tooltip-text-y-label:empty,
  .apexcharts-tooltip-text-y-value:empty,
  .apexcharts-tooltip-text-z-value:empty,
  .apexcharts-tooltip-title:empty {
    display: none;
  }

  .apexcharts-tooltip-text-goals-label,
  .apexcharts-tooltip-text-goals-value {
    padding: 6px 0 5px;
  }

  .apexcharts-tooltip-goals-group,
  .apexcharts-tooltip-text-goals-label,
  .apexcharts-tooltip-text-goals-value {
    display: flex;
  }

  .apexcharts-tooltip-text-goals-label:not(:empty),
  .apexcharts-tooltip-text-goals-value:not(:empty) {
    margin-top: -6px;
  }

  .apexcharts-tooltip-series-group {
    padding: 0 10px;
    display: none;
    text-align: left;
    justify-content: left;
    align-items: center;
  }

  .apexcharts-tooltip-series-group.apexcharts-active .apexcharts-tooltip-marker {
    opacity: 1;
  }

  .apexcharts-tooltip-series-group.apexcharts-active,
  .apexcharts-tooltip-series-group:last-child {
    padding-bottom: 4px;
  }

  .apexcharts-tooltip-y-group {
    padding: 6px 0 5px;
  }

  .apexcharts-custom-tooltip,
  .apexcharts-tooltip-box {
    padding: 4px 8px;
  }

  .apexcharts-tooltip-boxPlot {
    display: flex;
    flex-direction: column-reverse;
  }

  .apexcharts-tooltip-box > div {
    margin: 4px 0;
  }

  .apexcharts-tooltip-box span.value {
    font-weight: 700;
  }

  .apexcharts-tooltip-rangebar {
    padding: 5px 8px;
  }

  .apexcharts-tooltip-rangebar .category {
    font-weight: 600;
    color: var(--secondary-text-color);
  }

  .apexcharts-tooltip-rangebar .series-name {
    font-weight: 700;
    display: block;
    margin-bottom: 5px;
  }

  .apexcharts-xaxistooltip,
  .apexcharts-yaxistooltip {
    opacity: 0;
    pointer-events: none;
    color: var(--primary-text-color);
    font-size: 13px;
    text-align: center;
    border-radius: 4px;
    position: absolute;
    z-index: 10;
    background: var(--card-background-color);
    border: 1px solid var(--divider-color);
  }

  .apexcharts-xaxistooltip {
    padding: 9px 10px;
    transition: opacity 150ms cubic-bezier(0.4, 0, 0.2, 1);
  }

  .apexcharts-xaxistooltip.apexcharts-theme-dark {
    background: var(--card-background-color);
    border: 1px solid var(--divider-color);
    color: var(--primary-text-color);
  }

  .apexcharts-xaxistooltip:after,
  .apexcharts-xaxistooltip:before {
    left: 50%;
    border: solid transparent;
    content: ' ';
    height: 0;
    width: 0;
    position: absolute;
    pointer-events: none;
  }

  .apexcharts-xaxistooltip:after {
    border-color: transparent;
    border-width: 6px;
    margin-left: -6px;
  }

  .apexcharts-xaxistooltip:before {
    border-color: transparent;
    border-width: 7px;
    margin-left: -7px;
  }

  .apexcharts-xaxistooltip-bottom:after,
  .apexcharts-xaxistooltip-bottom:before {
    bottom: 100%;
  }

  .apexcharts-xaxistooltip-top:after,
  .apexcharts-xaxistooltip-top:before {
    top: 100%;
  }

  .apexcharts-xaxistooltip-bottom:after {
    border-bottom-color: var(--card-background-color);
  }

  .apexcharts-xaxistooltip-bottom:before {
    border-bottom-color: var(--divider-color);
  }

  .apexcharts-xaxistooltip-bottom.apexcharts-theme-dark:after {
    border-bottom-color: var(--card-background-color);
  }

  .apexcharts-xaxistooltip-bottom.apexcharts-theme-dark:before {
    border-bottom-color: var(--divider-color);
  }

  .apexcharts-xaxistooltip-top:after {
    border-top-color: var(--card-background-color);
  }

  .apexcharts-xaxistooltip-top:before {
    border-top-color: var(--divider-color);
  }

  .apexcharts-xaxistooltip-top.apexcharts-theme-dark:after {
    border-top-color: var(--card-background-color);
  }

  .apexcharts-xaxistooltip-top.apexcharts-theme-dark:before {
    border-top-color: var(--divider-color);
  }

  .apexcharts-xaxistooltip.apexcharts-active {
    opacity: 1;
  }

  .apexcharts-yaxistooltip {
    padding: 4px 10px;
  }

  .apexcharts-yaxistooltip.apexcharts-theme-dark {
    background: var(--card-background-color);
    border: 1px solid var(--divider-color);
    color: var(--primary-text-color);
  }

  .apexcharts-yaxistooltip:after,
  .apexcharts-yaxistooltip:before {
    top: 50%;
    border: solid transparent;
    content: ' ';
    height: 0;
    width: 0;
    position: absolute;
    pointer-events: none;
  }

  .apexcharts-yaxistooltip:after {
    border-color: transparent;
    border-width: 6px;
    margin-top: -6px;
  }

  .apexcharts-yaxistooltip:before {
    border-color: transparent;
    border-width: 7px;
    margin-top: -7px;
  }

  .apexcharts-yaxistooltip-left:after,
  .apexcharts-yaxistooltip-left:before {
    left: 100%;
  }

  .apexcharts-yaxistooltip-right:after,
  .apexcharts-yaxistooltip-right:before {
    right: 100%;
  }

  .apexcharts-yaxistooltip-left:after {
    border-left-color: var(--card-background-color);
  }

  .apexcharts-yaxistooltip-left:before {
    border-left-color: var(--divider-color);
  }

  .apexcharts-yaxistooltip-left.apexcharts-theme-dark:after {
    border-left-color: var(--card-background-color);
  }

  .apexcharts-yaxistooltip-left.apexcharts-theme-dark:before {
    border-left-color: var(--divider-color);
  }

  .apexcharts-yaxistooltip-right:after {
    border-right-color: var(--card-background-color);
  }

  .apexcharts-yaxistooltip-right:before {
    border-right-color: var(--divider-color);
  }

  .apexcharts-yaxistooltip-right.apexcharts-theme-dark:after {
    border-right-color: var(--card-background-color);
  }

  .apexcharts-yaxistooltip-right.apexcharts-theme-dark:before {
    border-right-color: var(--divider-color);
  }

  .apexcharts-yaxistooltip.apexcharts-active {
    opacity: 1;
  }

  .apexcharts-yaxistooltip-hidden {
    display: none;
  }

  .apexcharts-xcrosshairs,
  .apexcharts-ycrosshairs {
    pointer-events: none;
    opacity: 0;
    transition: opacity 150ms cubic-bezier(0.4, 0, 0.2, 1);
  }

  .apexcharts-xcrosshairs.apexcharts-active,
  .apexcharts-ycrosshairs.apexcharts-active {
    opacity: 1;
  }

  .apexcharts-ycrosshairs-hidden {
    opacity: 0;
  }

  .apexcharts-selection-rect {
    cursor: move;
  }

  .svg_select_shape {
    stroke-width: 1;
    stroke-dasharray: 10 10;
    stroke: var(--primary-text-color);
    stroke-opacity: 0.1;
    pointer-events: none;
    fill: none;
  }

  .svg_select_handle {
    stroke-width: 3;
    stroke: var(--primary-color);
    fill: none;
  }

  .svg_select_handle_r {
    cursor: e-resize;
  }

  .svg_select_handle_l {
    cursor: w-resize;
  }

  .apexcharts-svg.apexcharts-zoomable.hovering-zoom {
    cursor: crosshair;
  }

  .apexcharts-svg.apexcharts-zoomable.hovering-pan {
    cursor: move;
  }

  .apexcharts-menu-icon,
  .apexcharts-pan-icon,
  .apexcharts-reset-icon,
  .apexcharts-selection-icon,
  .apexcharts-toolbar-custom-icon,
  .apexcharts-zoom-icon,
  .apexcharts-zoomin-icon,
  .apexcharts-zoomout-icon {
    cursor: pointer;
    width: 20px;
    height: 20px;
    line-height: 24px;
    color: var(--primary-text-color);
    text-align: center;
  }

  .apexcharts-menu-icon svg,
  .apexcharts-reset-icon svg,
  .apexcharts-zoom-icon svg,
  .apexcharts-zoomin-icon svg,
  .apexcharts-zoomout-icon svg {
    fill: var(--primary-text-color);
  }

  .apexcharts-selection-icon svg {
    fill: var(--primary-text-color);
    transform: scale(0.76);
  }

  .apexcharts-theme-dark .apexcharts-menu-icon svg,
  .apexcharts-theme-dark .apexcharts-pan-icon svg,
  .apexcharts-theme-dark .apexcharts-reset-icon svg,
  .apexcharts-theme-dark .apexcharts-selection-icon svg,
  .apexcharts-theme-dark .apexcharts-toolbar-custom-icon svg,
  .apexcharts-theme-dark .apexcharts-zoom-icon svg,
  .apexcharts-theme-dark .apexcharts-zoomin-icon svg,
  .apexcharts-theme-dark .apexcharts-zoomout-icon svg {
    fill: var(--primary-text-color);
  }

  .apexcharts-canvas .apexcharts-reset-zoom-icon.apexcharts-selected svg,
  .apexcharts-canvas .apexcharts-selection-icon.apexcharts-selected svg,
  .apexcharts-canvas .apexcharts-zoom-icon.apexcharts-selected svg {
    fill: var(--primary-color);
  }

  .apexcharts-theme-light .apexcharts-menu-icon:hover svg,
  .apexcharts-theme-light .apexcharts-reset-icon:hover svg,
  .apexcharts-theme-light .apexcharts-selection-icon:not(.apexcharts-selected):hover svg,
  .apexcharts-theme-light .apexcharts-zoom-icon:not(.apexcharts-selected):hover svg,
  .apexcharts-theme-light .apexcharts-zoomin-icon:hover svg,
  .apexcharts-theme-light .apexcharts-zoomout-icon:hover svg {
    fill: var(--primary-color);
  }

  .apexcharts-menu-icon,
  .apexcharts-selection-icon {
    position: relative;
  }

  .apexcharts-reset-icon {
    margin-left: 5px;
  }

  .apexcharts-menu-icon,
  .apexcharts-reset-icon,
  .apexcharts-zoom-icon {
    transform: scale(0.85);
  }

  .apexcharts-zoomin-icon,
  .apexcharts-zoomout-icon {
    transform: scale(0.7);
  }

  .apexcharts-zoomout-icon {
    margin-right: 3px;
  }

  .apexcharts-pan-icon {
    transform: scale(0.62);
    position: relative;
    left: 1px;
    top: 0;
  }

  .apexcharts-pan-icon svg {
    fill: var(--primary-text-color);
    stroke: var(--secondary-text-color);
    stroke-width: 2;
  }

  .apexcharts-pan-icon.apexcharts-selected svg {
    stroke: var(--primary-color);
  }

  .apexcharts-pan-icon:not(.apexcharts-selected):hover svg {
    stroke: var(--primary-color);
  }

  .apexcharts-toolbar {
    position: absolute;
    z-index: 1;
    max-width: 176px;
    text-align: right;
    border-radius: 3px;
    padding: 0 6px 2px;
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .apexcharts-menu {
    background: var(--card-background-color);
    color: var(--primary-text-color);
    position: absolute;
    top: 100%;
    border: 1px solid var(--divider-color);
    border-radius: 8px;
    box-shadow:
      0 1px 3px color-mix(in oklab, var(--primary-text-color) 12%, transparent),
      0 4px 12px color-mix(in oklab, var(--primary-text-color) 10%, transparent);
    padding: 3px;
    right: 10px;
    opacity: 0;
    min-width: 110px;
    transition: opacity 150ms cubic-bezier(0.4, 0, 0.2, 1);
    pointer-events: none;
  }

  .apexcharts-menu.apexcharts-menu-open {
    opacity: 1;
    pointer-events: all;
  }

  .apexcharts-menu-item {
    padding: 6px 7px;
    font-size: 12px;
    cursor: pointer;
    border-radius: 4px;
  }

  .apexcharts-menu-item:hover {
    /* MD3 state layer: primary at low opacity keeps the label readable */
    background: color-mix(in oklab, var(--primary-color) 12%, transparent);
  }

  .apexcharts-theme-dark .apexcharts-menu {
    background: var(--card-background-color);
    color: var(--primary-text-color);
  }

  @media (hover: hover) {
    .apexcharts-canvas:hover .apexcharts-toolbar {
      opacity: 1;
    }
  }

  .apexcharts-canvas .apexcharts-element-hidden,
  .apexcharts-datalabel.apexcharts-element-hidden,
  .apexcharts-hide .apexcharts-series-points {
    opacity: 0;
  }

  .apexcharts-hidden-element-shown {
    opacity: 1;
    transition: opacity 250ms cubic-bezier(0.4, 0, 0.2, 1);
  }

  .apexcharts-datalabel,
  .apexcharts-datalabel-label,
  .apexcharts-datalabel-value,
  .apexcharts-datalabels,
  .apexcharts-pie-label {
    cursor: default;
    pointer-events: none;
  }

  .apexcharts-pie-label-delay {
    opacity: 0;
    animation-name: opaque;
    animation-duration: 0.3s;
    animation-fill-mode: forwards;
    animation-timing-function: cubic-bezier(0.4, 0, 0.2, 1);
  }

  .apexcharts-radialbar-label {
    cursor: pointer;
  }

  .apexcharts-annotation-rect,
  .apexcharts-area-series .apexcharts-area,
  .apexcharts-gridline,
  .apexcharts-line,
  .apexcharts-point-annotation-label,
  .apexcharts-radar-series path:not(.apexcharts-marker),
  .apexcharts-radar-series polygon,
  .apexcharts-toolbar svg,
  .apexcharts-tooltip .apexcharts-marker,
  .apexcharts-xaxis-annotation-label,
  .apexcharts-yaxis-annotation-label,
  .apexcharts-zoom-rect,
  .no-pointer-events {
    pointer-events: none;
  }

  .apexcharts-tooltip-active .apexcharts-marker {
    transition: opacity 150ms cubic-bezier(0.4, 0, 0.2, 1);
  }

  .apexcharts-radar-series .apexcharts-yaxis {
    pointer-events: none;
  }

  .resize-triggers {
    animation: 1ms resizeanim;
    visibility: hidden;
    opacity: 0;
    height: 100%;
    width: 100%;
    overflow: hidden;
  }

  .contract-trigger:before,
  .resize-triggers,
  .resize-triggers > div {
    content: ' ';
    display: block;
    position: absolute;
    top: 0;
    left: 0;
  }

  .resize-triggers > div {
    height: 100%;
    width: 100%;
    background: transparent;
    overflow: auto;
  }

  .contract-trigger:before {
    overflow: hidden;
    width: 200%;
    height: 200%;
  }

  .apexcharts-bar-goals-markers {
    pointer-events: none;
  }

  .apexcharts-bar-shadows {
    pointer-events: none;
  }

  .apexcharts-rangebar-goals-markers {
    pointer-events: none;
  }

  .apexcharts-disable-transitions * {
    transition: none !important;
  }

  /* spinner */
  #spinner-wrapper {
    position: absolute;
    top: 5px;
    right: 5px;
    height: 20px;
    width: 20px;
    opacity: 0.5;
  }

  #spinner {
    position: relative;
  }

  .lds-ring,
  .lds-ring div {
    box-sizing: border-box;
  }
  .lds-ring {
    display: inline-block;
    position: relative;
    width: 20px;
    height: 20px;
  }
  .lds-ring div {
    box-sizing: border-box;
    display: block;
    position: absolute;
    width: 16px;
    height: 16px;
    margin: 2px;
    border: 2px solid var(--primary-text-color);
    border-radius: 50%;
    animation: lds-ring 1.2s cubic-bezier(0.5, 0, 0.5, 1) infinite;
    border-color: var(--primary-text-color) transparent transparent transparent;
  }
  .lds-ring div:nth-child(1) {
    animation-delay: -0.45s;
  }
  .lds-ring div:nth-child(2) {
    animation-delay: -0.3s;
  }
  .lds-ring div:nth-child(3) {
    animation-delay: -0.15s;
  }
  @keyframes lds-ring {
    0% {
      transform: rotate(0deg);
    }
    100% {
      transform: rotate(360deg);
    }
  }
`;
