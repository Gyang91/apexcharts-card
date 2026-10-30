import type { EntityCachePoints } from './types';

export interface SamplingRange {
  min: number;
  max: number;
}

// Keep the first, last and both extrema in each horizontal pixel bucket.
// Gaps split buckets, so sampling never joins disconnected numeric runs.
export function downsample(data: EntityCachePoints, width: number, range?: SamplingRange): EntityCachePoints {
  if (!Number.isFinite(width) || width < 1 || data.length < 3) return data;
  const pixels = Math.min(4096, Math.floor(width));
  if (data.length <= pixels * 4) return data;
  for (let i = 0; i < data.length; i++) {
    if (!Number.isFinite(data[i][0]) || (i > 0 && data[i][0] < data[i - 1][0])) return data;
  }
  const min = range?.min ?? data[0][0];
  const max = range?.max ?? data[data.length - 1][0];
  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) return data;
  const result: EntityCachePoints = [];
  let first = -1;
  let last = -1;
  let low = -1;
  let high = -1;
  let bucket = NaN;
  const flush = () => {
    if (first < 0) return;
    const indices = [first, low, high, last].sort((a, b) => a - b);
    indices.forEach((index, i) => {
      if (i === 0 || index !== indices[i - 1]) result.push(data[index]);
    });
    first = -1;
  };
  for (let i = 0; i < data.length; i++) {
    const value = data[i][1];
    if (value === null || !Number.isFinite(value)) {
      flush();
      result.push(data[i]);
      continue;
    }
    // Outside the viewport, two buckets preserve endpoints and global extrema
    // without spending the visible plot's point budget on offscreen history.
    const next = Math.max(-1, Math.min(pixels, Math.floor(((data[i][0] - min) / (max - min)) * pixels)));
    if (next !== bucket) flush();
    if (first < 0) {
      first = low = high = i;
      bucket = next;
    }
    last = i;
    if (value < data[low][1]!) low = i;
    if (value > data[high][1]!) high = i;
  }
  flush();
  return result.length < data.length ? result : data;
}
