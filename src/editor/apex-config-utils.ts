import { ChartCardExternalConfig } from '../types-config';

type AnyRec = Record<string, unknown>;

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v));
}

// Value at a dotted path of `root`, undefined when a step is missing
function getPath(root: unknown, path: string): unknown {
  let cur: unknown = root;
  for (const s of path.split('.')) {
    if (cur === undefined || cur === null) return undefined;
    cur = (cur as AnyRec)[s];
  }
  return cur;
}

// Sets root.<path> = value. When value is `undefined`, '' or null, removes the
// leaf and prunes any empty objects up the chain so the YAML stays tidy.
// Returns false, for the caller to drop `root`, on a prototype-polluting path.
function setPath(root: AnyRec, path: string, value: unknown): boolean {
  const segs = path.split('.');
  const leaf = segs[segs.length - 1];
  if (segs.some((s) => s === '__proto__' || s === 'constructor' || s === 'prototype')) return false;

  const parents: AnyRec[] = [root];
  let cur: AnyRec = root;
  for (let i = 0; i < segs.length - 1; i++) {
    const k = segs[i];
    // Defense in depth on top of the upfront segs check (recognized by CodeQL)
    if (k === '__proto__' || k === 'constructor' || k === 'prototype') return false;
    if (typeof cur[k] !== 'object' || cur[k] === null || Array.isArray(cur[k])) {
      cur[k] = {};
    }
    cur = cur[k] as AnyRec;
    parents.push(cur);
  }

  const shouldRemove = value === undefined || value === '' || value === null;
  if (shouldRemove) {
    delete cur[leaf];
  } else {
    cur[leaf] = value;
  }

  // Prune empty parent objects bottom-up
  for (let i = parents.length - 1; i > 0; i--) {
    const node = parents[i];
    if (Object.keys(node).length === 0) {
      const parent = parents[i - 1];
      const parentKey = segs[i - 1];
      delete parent[parentKey];
    } else {
      break;
    }
  }
  return true;
}

export function getApexValue(config: ChartCardExternalConfig | undefined, path: string): unknown {
  if (!config?.apex_config) return undefined;
  return getPath(config.apex_config, path);
}

// Set apex_config.<path> = value; see setPath for removal.
export function setApexValue(config: ChartCardExternalConfig, path: string, value: unknown): ChartCardExternalConfig {
  const apex: AnyRec = config.apex_config ? clone(config.apex_config as AnyRec) : {};
  if (!setPath(apex, path, value)) return config;
  return {
    ...config,
    apex_config: Object.keys(apex).length > 0 ? apex : undefined,
  };
}

export function setApexValues(
  config: ChartCardExternalConfig,
  patches: Record<string, unknown>,
): ChartCardExternalConfig {
  let next = config;
  for (const [path, value] of Object.entries(patches)) {
    next = setApexValue(next, path, value);
  }
  return next;
}

// Read/write to config.yaxis[index].apex_config.<path>.
// (apexcharts-card overwrites the top-level apex_config.yaxis with its own generated array,
//  but merges each yaxis entry's per-axis `apex_config` field into the generated entry.)
export function getApexYaxisValue(config: ChartCardExternalConfig | undefined, index: number, path: string): unknown {
  const yaxis = config?.yaxis?.[index];
  if (!yaxis) return undefined;
  const apex = (yaxis as unknown as { apex_config?: AnyRec }).apex_config;
  if (!apex) return undefined;
  return getPath(apex, path);
}

export function setApexYaxisValue(
  config: ChartCardExternalConfig,
  index: number,
  // axisCount kept for API parity; unused now since we mutate the yaxis array directly
  _axisCount: number,
  path: string,
  value: unknown,
): ChartCardExternalConfig {
  if (!config.yaxis || !config.yaxis[index]) return config;

  const yaxisList = config.yaxis.map((y) => ({ ...y }));
  const target = yaxisList[index] as unknown as { apex_config?: AnyRec };
  const apex: AnyRec = target.apex_config ? clone(target.apex_config) : {};
  if (!setPath(apex, path, value)) return config;

  if (Object.keys(apex).length > 0) {
    target.apex_config = apex;
  } else {
    delete target.apex_config;
  }

  return { ...config, yaxis: yaxisList };
}

// EVAL wrappers/unwrappers for formatter strings.
const EVAL_PREFIX = 'EVAL:function(value) {';
const EVAL_SUFFIX = '}';

export function unwrapEvalBody(value: unknown): string {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  if (!trimmed.startsWith('EVAL:')) return trimmed;
  // Strip the EVAL:function(...) { ... } wrapper if it matches our shape; otherwise show as-is.
  const m = trimmed.match(/^EVAL:function\s*\([^)]*\)\s*\{([\s\S]*)\}\s*$/);
  return m ? m[1].trim() : trimmed.substring(5).trim();
}

export function wrapEvalBody(body: string): string | undefined {
  const trimmed = body.trim();
  if (!trimmed) return undefined;
  if (trimmed.startsWith('EVAL:')) return trimmed;
  return `${EVAL_PREFIX}\n  ${trimmed}\n${EVAL_SUFFIX}`;
}
