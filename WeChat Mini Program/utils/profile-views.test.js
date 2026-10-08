import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

function loadCjs(url, mocks = {}) {
  const module = { exports: {} };
  vm.runInNewContext(readFileSync(url, 'utf8'), {
    module,
    exports: module.exports,
    require(path) {
      if (Object.prototype.hasOwnProperty.call(mocks, path)) return mocks[path];
      throw new Error(`未预期的依赖：${path}`);
    },
    Date,
    Number,
    String,
    Boolean,
    Array,
    Object,
    Math,
    Map,
    Error,
    RegExp
  });
  return module.exports;
}

function fakeNumber(value, digits = 1) {
  return Number(value).toFixed(digits).replace(/\.0+$/, '');
}

const { bodyCompositionTrendView, trainingComparisonView, radarGroupView, wellnessTrendsView } = loadCjs(
  new URL('./profile-views.js', import.meta.url),
  { './format': { number: fakeNumber } }
);

describe('身体成分趋势视图', () => {
  const history = [
    {
      measurementDate: '2026-09-30',
      items: [
        { key: 'weightKg', label: '体重', value: 72.4, unit: 'kg', delta: -0.4 },
        { key: 'bodyFatPct', label: '体脂率', value: 12.8, unit: '%', delta: -0.2 }
      ]
    },
    {
      measurementDate: '2026-08-31',
      items: [
        { key: 'weightKg', label: '体重', value: 72.8, unit: 'kg', delta: null },
        { key: 'bodyFatPct', label: '体脂率', value: 13, unit: '%', delta: null }
      ]
    }
  ];

  it('按指标生成趋势柱并保留最近值与环比', () => {
    const view = bodyCompositionTrendView(history);
    expect(view.dates).toEqual(['2026-09-30', '2026-08-31']);
    expect(view.metrics.map((metric) => metric.key)).toEqual(['weightKg', 'bodyFatPct']);
    const weight = view.metrics[0];
    expect(weight.latest).toBe(72.4);
    expect(weight.delta).toBe(-0.4);
    expect(weight.recorded).toBe(2);
    expect(weight.points[1].height).toBeGreaterThan(weight.points[0].height);
  });

  it('单次实测不做高度归一，缺失日期保留空位', () => {
    const view = bodyCompositionTrendView([
      history[0],
      {
        measurementDate: '2026-08-31',
        items: [{ key: 'weightKg', label: '体重', value: 72.8, unit: 'kg', delta: null }]
      },
      {
        measurementDate: '2026-07-31',
        items: [{ key: 'weightKg', label: '体重', value: 73, unit: 'kg', delta: null }]
      }
    ]);
    const weight = view.metrics.find((metric) => metric.key === 'weightKg');
    expect(weight.points).toHaveLength(3);
    const bodyFat = view.metrics.find((metric) => metric.key === 'bodyFatPct');
    expect(bodyFat.points).toHaveLength(3);
    expect(bodyFat.points[1]).toEqual({ date: '2026-08-31', missing: true });
    expect(bodyFat.points[2]).toEqual({ date: '2026-07-31', missing: true });
    expect(bodyFat.recorded).toBe(1);
    expect(bodyFat.points[0].height).toBe(55);
  });

  it('无记录时输出空结构', () => {
    expect(bodyCompositionTrendView([])).toEqual({ dates: [], metrics: [] });
    expect(bodyCompositionTrendView(null)).toEqual({ dates: [], metrics: [] });
  });
});

describe('训练情况对比视图', () => {
  it('个人与队均同指标内归一，差值按个人减队均', () => {
    const view = trainingComparisonView({
      items: [
        { key: 'durationMin', label: '训练时长', unit: 'min', personalValue: 300, teamMean: 400 },
        { key: 'load', label: '训练负荷', unit: 'AU', personalValue: null, teamMean: 120 }
      ]
    });
    expect(view.items[0].personalPct).toBe(75);
    expect(view.items[0].teamPct).toBe(100);
    expect(view.items[0].diffText).toBe('-100');
    expect(view.items[0].diffClass).toBe('down');
    expect(view.items[0].note).toBe('个人 − 队均');
    expect(view.items[1].personalText).toBe('—');
    expect(view.items[1].personalPct).toBe(0);
    expect(view.items[1].note).toBe('个人未记录');
    expect(view.items[1].diffText).toBe('—');
  });

  it('队均缺失标注样本不足，不用 0 代替', () => {
    const view = trainingComparisonView({
      items: [{ key: 'distanceKm', label: '训练距离', unit: 'km', personalValue: 12, teamMean: null }]
    });
    expect(view.items[0].teamText).toBe('—');
    expect(view.items[0].teamPct).toBe(0);
    expect(view.items[0].note).toBe('队均样本不足');
    expect(view.items[0].diffText).toBe('—');
  });
});

describe('恢复状态视图', () => {
  const trends = [
    {
      key: 'sleepHours',
      label: '睡眠时长',
      unit: '小时',
      points: [
        { date: '2026-09-30', personalValue: 7.5, teamMean: 7, teamSampleCount: 4, hasPersonalValue: true },
        { date: '2026-09-29', personalValue: null, teamMean: 7.2, teamSampleCount: 3, hasPersonalValue: false },
        { date: '2026-09-28', personalValue: 6.5, teamMean: null, teamSampleCount: null, hasPersonalValue: true }
      ]
    }
  ];

  it('输出最近实测值与个人减队均差值，缺测日期留空位', () => {
    const view = wellnessTrendsView(trends);
    const metric = view.metrics[0];
    expect(metric.latestText).toBe('7.5');
    expect(metric.latestDate).toBe('2026-09-30');
    expect(metric.diffText).toBe('+0.5');
    expect(metric.recorded).toBe(2);
    expect(metric.points).toHaveLength(3);
    expect(metric.points[0].missing).toBe(false);
    expect(metric.points[0].height).toBe(100);
    expect(metric.points[0].teamPct).toBe(57);
    expect(metric.points[1].missing).toBe(true);
    expect(metric.points[1].valueText).toBe('未测');
    expect(metric.points[1].teamPct).toBe(74);
    expect(metric.points[2].teamPct).toBeNull();
    expect(metric.points[2].height).toBe(14);
  });

  it('无个人实测时保留行并标注未测，无点位输出空结构', () => {
    const view = wellnessTrendsView([
      {
        key: 'rpe',
        label: 'RPE',
        unit: '',
        points: [{ date: '2026-09-30', personalValue: null, teamMean: 6, teamSampleCount: 2, hasPersonalValue: false }]
      }
    ]);
    expect(view.metrics[0].latestText).toBe('—');
    expect(view.metrics[0].note).toBe('周期内未测');
    expect(view.metrics[0].points[0].missing).toBe(true);
    expect(wellnessTrendsView([{ key: 'x', label: 'X', unit: '', points: [] }]).metrics).toEqual([]);
    expect(wellnessTrendsView(null)).toEqual({ metrics: [] });
  });

  it('日期乱序时取最新实测，跳过更新的缺测日期并保留真实零值', () => {
    const points = [
      { date: '2026-09-29', personalValue: 0, teamMean: 2, hasPersonalValue: true },
      { date: '2026-09-28', personalValue: 6, teamMean: 5, hasPersonalValue: true },
      { date: '2026-09-30', personalValue: null, teamMean: 3, hasPersonalValue: false }
    ];
    const metric = wellnessTrendsView([{ key: 'rpe', label: 'RPE', points }]).metrics[0];
    expect(metric.latestDate).toBe('2026-09-29');
    expect(metric.latestText).toBe('0');
    expect(metric.diffText).toBe('-2');
    expect(metric.points.map((point) => point.date)).toEqual(['2026-09-29', '2026-09-28', '2026-09-30']);
    expect(points[0].personalValue).toBe(0);
  });

  it('队均缺失时差值为占位文本，不用 0 代替', () => {
    const view = wellnessTrendsView([
      {
        key: 'rpe',
        label: 'RPE',
        unit: '',
        points: [{ date: '2026-09-30', personalValue: 5, teamMean: null, teamSampleCount: null, hasPersonalValue: true }]
      }
    ]);
    expect(view.metrics[0].diffText).toBe('—');
    expect(view.metrics[0].note).toBe('最近一次 · 当日队均样本不足');
    expect(view.metrics[0].points[0].teamPct).toBeNull();
  });
});

describe('雷达模型视图', () => {
  const group = {
    dimensions: [
      { key: 'a', label: '甲', unit: 'cm', currentValue: 50, referenceValue: 60, achievedPercent: 83.3, status: 'ready' },
      { key: 'b', label: '乙', unit: '次', currentValue: 30, referenceValue: 30, achievedPercent: 100, status: 'ready' },
      { key: 'c', label: '丙', unit: '秒', currentValue: null, referenceValue: 90, achievedPercent: null, status: 'measurement_pending' },
      { key: 'd', label: '丁', unit: 'W', currentValue: 130, referenceValue: 100, achievedPercent: 130, status: 'ready' }
    ]
  };

  it('有效维度不足三个不画多边形，上限按达成度抬升', () => {
    const view = radarGroupView(group, { title: '专项测试雷达', canvasId: 'radarSpecial' });
    expect(view.hasChart).toBe(true);
    expect(view.maxValue).toBe(140);
    expect(view.personalValues).toEqual([83.3, 100, null, 130]);
    expect(view.referenceValues).toEqual([100, 100, 100, 100]);
    expect(view.dimensions[2].valueText).toBe('—');
    expect(view.dimensions[2].achievedText).toBe('—');
    expect(view.dimensions[2].statusLabel).toBe('待测量');
    const small = radarGroupView(
      { dimensions: group.dimensions.slice(0, 2) },
      { title: '体能测试雷达', canvasId: 'radarPhysical' }
    );
    expect(small.hasChart).toBe(false);
  });

  it('空分组输出安全默认值', () => {
    const view = radarGroupView(null, {});
    expect(view.hasChart).toBe(false);
    expect(view.dimensions).toEqual([]);
    expect(view.maxValue).toBe(120);
    expect(view.canvasId).toBe('');
  });
});
