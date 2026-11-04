// Which series can be sampled (src/sampling.ts), without a card
import { canSample, hasSampling, sampleSeries } from '../src/sampling';
import { ChartCardConfig } from '../src/types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const config = (extra: any = {}, series: any[] = [{ type: 'line' }]): ChartCardConfig =>
  ({ downsample: true, series_in_graph: series, series_in_brush: series, ...extra }) as ChartCardConfig;

describe('canSample', () => {
  it('samples unstacked line and area series of a line chart with downsample on', () => {
    expect(canSample(config(), 0, false)).toBe(true);
    expect(canSample(config({}, [{ type: 'area' }]), 0, true)).toBe(true);
    expect(canSample(config({ chart_type: 'line' }), 0, false)).toBe(true);
  });

  it('keeps everything else at full resolution', () => {
    expect(canSample(config({ downsample: false }), 0, false)).toBe(false);
    expect(canSample(undefined, 0, false)).toBe(false);
    expect(canSample(config({ chart_type: 'scatter' }), 0, false)).toBe(false);
    expect(canSample(config({ stacked: true }), 0, false)).toBe(false);
    expect(canSample(config({ apex_config: { chart: { stacked: true } } }), 0, false)).toBe(false);
    expect(canSample(config({ apex_config: { chart: { type: 'bar' } } }), 0, false)).toBe(false);
    expect(canSample(config({}, [{ type: 'column' }]), 0, false)).toBe(false);
    expect(canSample(config({}, [{ type: 'line', curve: 'stepline' }]), 0, false)).toBe(false);
    expect(canSample(config(), 3, false)).toBe(false);
  });

  it('reads the curve from apex_config, a series curve, or the curve list by index', () => {
    expect(canSample(config({ apex_config: { stroke: { curve: 'stepline' } } }), 0, false)).toBe(false);
    const list = { apex_config: { stroke: { curve: ['smooth', 'linestep'] } } };
    const two = [{ type: 'line' }, { type: 'line' }];
    expect(canSample(config(list, two), 0, false)).toBe(true);
    expect(canSample(config(list, two), 1, false)).toBe(false);
    expect(canSample(config(list, [{ type: 'line' }, { type: 'line', curve: 'smooth' }]), 1, false)).toBe(true);
  });

  it('checks the brush against its own apex_config', () => {
    const conf = config({ brush: { apex_config: { chart: { stacked: true } } } });
    expect(canSample(conf, 0, true)).toBe(false);
    expect(canSample(conf, 0, false)).toBe(true);
  });
});

describe('hasSampling and sampleSeries', () => {
  it('is on when any series of the chart or brush can be sampled', () => {
    expect(hasSampling(config())).toBe(true);
    expect(hasSampling(config({}, [{ type: 'column' }]))).toBe(false);
    expect(hasSampling(config({ downsample: false }))).toBe(false);
  });

  it('leaves series that cannot be sampled untouched', () => {
    const data: [number, number][] = Array.from({ length: 5000 }, (_, i) => [i, Math.sin(i / 10)]);
    const series = [{ data }, { data }];
    const out = sampleSeries(config({}, [{ type: 'line' }, { type: 'column' }]), series, false, 100);
    expect(out[0].data.length).toBeLessThan(data.length);
    expect(out[1]).toBe(series[1]);
  });
});
