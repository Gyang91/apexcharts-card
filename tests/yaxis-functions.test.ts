// The pure y-axis functions of src/yaxis.ts, without a card
import { applyTickStep, getMinMaxBasedOnType, getTypeOfMinMax, stackTotals, YAxisDataSource } from '../src/yaxis';
import { ChartCardConfig, ChartCardYAxis, minmax_type } from '../src/types';

describe('getTypeOfMinMax', () => {
  it('reads fixed, auto, soft and absolute limits', () => {
    expect(getTypeOfMinMax(5)).toEqual([5, minmax_type.FIXED]);
    expect(getTypeOfMinMax(undefined)).toEqual([undefined, minmax_type.AUTO]);
    expect(getTypeOfMinMax('auto')).toEqual([undefined, minmax_type.AUTO]);
    expect(getTypeOfMinMax('~-2.5')).toEqual([-2.5, minmax_type.SOFT]);
    expect(getTypeOfMinMax('|10|')).toEqual([10, minmax_type.ABSOLUTE]);
  });

  it('rejects other strings', () => {
    expect(() => getTypeOfMinMax('5')).toThrow();
    expect(() => getTypeOfMinMax('~1~2')).toThrow();
    expect(() => getTypeOfMinMax('|5')).toThrow();
    expect(() => getTypeOfMinMax('~x')).toThrow();
  });
});

describe('getMinMaxBasedOnType', () => {
  it('applies soft and absolute limits', () => {
    expect(getMinMaxBasedOnType(true, 3, 0, minmax_type.SOFT)).toBe(0);
    expect(getMinMaxBasedOnType(true, -3, 0, minmax_type.SOFT)).toBe(-3);
    expect(getMinMaxBasedOnType(false, 3, 10, minmax_type.SOFT)).toBe(10);
    expect(getMinMaxBasedOnType(false, 3, 2, minmax_type.ABSOLUTE)).toBe(5);
    expect(getMinMaxBasedOnType(true, 3, 2, minmax_type.AUTO)).toBe(3);
    expect(getMinMaxBasedOnType(true, 3, 2, minmax_type.FIXED)).toBe(3);
  });
});

describe('applyTickStep', () => {
  const config = (yaxis: object[]) => ({ apex_config: { yaxis } }) as unknown as ChartCardConfig;

  it('rounds non-fixed limits outwards and sets the tick amount', () => {
    const conf = config([{ min: 0.3, max: 9.2 }]);
    applyTickStep({ tick_step: 2, series_id: [0] } as ChartCardYAxis, conf);
    expect(conf.apex_config!.yaxis).toEqual([{ min: 0, max: 10, tickAmount: 5 }]);
  });

  it('leaves axes without numeric limits, logarithmic axes and fixed limits alone', () => {
    const open = config([{ max: 9 }]);
    applyTickStep({ tick_step: 2, series_id: [0] } as ChartCardYAxis, open);
    expect(open.apex_config!.yaxis).toEqual([{ max: 9 }]);
    const log = config([{ min: 1, max: 9 }]);
    applyTickStep({ tick_step: 2, logarithmic: true, series_id: [0] } as ChartCardYAxis, log);
    expect(log.apex_config!.yaxis).toEqual([{ min: 1, max: 9 }]);
    const fixed = config([{ min: 1, max: 9 }]);
    applyTickStep(
      { tick_step: 2, min_type: minmax_type.FIXED, max_type: minmax_type.FIXED, series_id: [0] } as ChartCardYAxis,
      fixed,
    );
    expect(fixed.apex_config!.yaxis).toEqual([{ min: 1, max: 9, tickAmount: 4 }]);
  });

  it('does not read the y axes when there is no tick step', () => {
    expect(() => applyTickStep({ series_id: [0] } as ChartCardYAxis, {} as ChartCardConfig)).not.toThrow();
  });
});

describe('stackTotals', () => {
  const source = (histories: [number, number | null][][]): YAxisDataSource => ({
    isHidden: () => false,
    minMax: () => undefined,
    history: (serie) => histories[serie.index],
    offset: () => 0,
  });
  const series = [
    { index: 0, type: 'column' },
    { index: 1, type: 'column' },
  ];

  it('is empty unless the chart is stacked', () => {
    const config = { series_in_graph: series } as unknown as ChartCardConfig;
    expect(stackTotals(config, [0, 1], new Date(0), new Date(10), source([[], []]))).toEqual({});
  });

  it('sums positive and negative values per timestamp', () => {
    const config = { stacked: true, series_in_graph: series } as unknown as ChartCardConfig;
    const data = source([
      [
        [1, 2],
        [2, -1],
      ],
      [
        [1, 3],
        [2, -4],
      ],
    ]);
    expect(stackTotals(config, [0, 1], new Date(0), new Date(10), data)).toEqual({ max: 5, min: -5 });
  });
});
