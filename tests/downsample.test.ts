import { downsample } from '../src/downsample';
import type { EntityCachePoints } from '../src/types';

const points = (count: number): EntityCachePoints => Array.from({ length: count }, (_, i) => [i, Math.sin(i / 10)]);

describe('pixel-bucket downsampling', () => {
  it('preserves spikes, troughs, first/last samples and temporal order', () => {
    const data = points(10000);
    data[501][1] = 1000;
    data[502][1] = -1000;
    const before = data.map((point) => [...point]);
    const sampled = downsample(data, 100);
    expect(sampled.length).toBeLessThanOrEqual(404);
    expect(sampled[0]).toBe(data[0]);
    expect(sampled.at(-1)).toBe(data.at(-1));
    expect(sampled).toContain(data[501]);
    expect(sampled).toContain(data[502]);
    expect(sampled.every((point, i) => i === 0 || point[0] > sampled[i - 1][0])).toBe(true);
    expect(data).toEqual(before);
  });

  it('preserves every null boundary and both neighboring numeric samples', () => {
    const data = points(10000);
    data[200][1] = null;
    data[201][1] = null;
    data[401][1] = null;
    const sampled = downsample(data, 100);
    for (const index of [199, 200, 201, 202, 400, 401, 402]) expect(sampled).toContain(data[index]);
    expect(sampled.filter((point) => point[1] === null)).toEqual([data[200], data[201], data[401]]);
  });

  it('preserves duplicate timestamps in their original order', () => {
    const data: EntityCachePoints = Array.from({ length: 100 }, (_, i) => [Math.floor(i / 10), i]);
    const sampled = downsample(data, 1);
    expect(sampled[0]).toBe(data[0]);
    expect(sampled.at(-1)).toBe(data.at(-1));
    expect(sampled.every((point, i) => i === 0 || data.indexOf(point) > data.indexOf(sampled[i - 1]))).toBe(true);
  });

  it('allocates visible detail to a zoomed range, retaining offscreen extrema and endpoints', () => {
    const data = points(10000);
    data[10][1] = 1000;
    const overview = downsample(data, 100);
    const zoomed = downsample(data, 100, { min: 5000, max: 5100 });
    const visible = (sampled: EntityCachePoints) => sampled.filter(([time]) => time >= 5000 && time <= 5100);
    expect(visible(zoomed)).toEqual(data.slice(5000, 5101));
    expect(visible(overview).length).toBeLessThan(visible(zoomed).length);
    expect(zoomed).toContain(data[10]);
    expect(zoomed[0]).toBe(data[0]);
    expect(zoomed.at(-1)).toBe(data.at(-1));
  });

  it.each([0, -1, NaN, Infinity])('does not sample an invalid/unmeasured width %s', (width) => {
    const data = points(100);
    expect(downsample(data, width)).toBe(data);
  });

  it('leaves small, unordered and degenerate histories untouched', () => {
    const small = points(100);
    expect(downsample(small, 100)).toBe(small);
    const unordered = points(100).reverse();
    expect(downsample(unordered, 1)).toBe(unordered);
    const flatTime: EntityCachePoints = points(100).map(([, value]) => [0, value]);
    expect(downsample(flatTime, 1)).toBe(flatTime);
    const data = points(100);
    expect(downsample(data, 1, { min: 5, max: 5 })).toBe(data);
  });

  it('retains all-null histories and non-finite gaps instead of connecting across them', () => {
    const data = points(100);
    data[40][1] = NaN;
    data[41][1] = Infinity;
    const sampled = downsample(data, 1);
    for (const index of [39, 40, 41, 42]) expect(sampled).toContain(data[index]);
    const empty: EntityCachePoints = points(100).map(([time]) => [time, null]);
    expect(downsample(empty, 1)).toBe(empty);
  });

  it('handles 300000 samples without argument-limit overflow', () => {
    const data = points(300000);
    const sampled = downsample(data, 360);
    expect(sampled.length).toBeLessThanOrEqual(1444);
    expect(sampled[0]).toBe(data[0]);
    expect(sampled.at(-1)).toBe(data.at(-1));
  });
});
