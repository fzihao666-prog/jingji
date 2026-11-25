import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

const cjsModule = { exports: {} };
const url = new URL('./training-comparison-groups.js', import.meta.url);
function loadNumberFormatter() {
  const dataModule = { exports: {} };
  vm.runInNewContext(readFileSync(new URL('../data/format-data.js', import.meta.url), 'utf8'), { module: dataModule });
  const formatModule = { exports: {} };
  vm.runInNewContext(readFileSync(new URL('./format.js', import.meta.url), 'utf8'), {
    module: formatModule,
    require(path) {
      if (path === '../data/format-data') return dataModule.exports;
      throw new Error(`未预期的依赖：${path}`);
    },
  });
  return formatModule.exports.number;
}

const number = loadNumberFormatter();
vm.runInNewContext(readFileSync(url, 'utf8'), {
  module: cjsModule,
  require(path) {
    if (path === './format') return { number };
    throw new Error(`未预期的依赖：${path}`);
  },
});
const { trainingComparisonSummary } = cjsModule.exports;

function loadWithoutIntl() {
  const module = { exports: {} };
  vm.runInNewContext(readFileSync(new URL('./training-comparison-groups.js', import.meta.url), 'utf8'), {
    module,
    exports: module.exports,
    Intl: undefined,
    require(path) {
      if (path === './format') return { number };
      throw new Error(`未预期的依赖：${path}`);
    },
  });
  return module.exports;
}

describe('训练对比精简摘要', () => {
  it('运行环境没有 Intl 时仍可加载并格式化训练对比数值', () => {
    const { trainingComparisonSummary: summarize } = loadWithoutIntl();
    const view = summarize({ items: [
      { key: 'trainingDuration', personalValue: 150, teamMean: 120, teamSampleCount: 3 }
    ] });

    expect(view.metrics[0].personalText).toBe('2.5');
  });

  it('固定三个可参照维度，时长换算小时，排除身体和测试指标', () => {
    const items = [
      { key: 'weightKg', personalValue: 80, teamMean: 75 },
      { key: 'measurement:jump', personalValue: 30, teamMean: 32 },
      { key: 'specialDistance', personalValue: 40, teamMean: 50, teamSampleCount: 8 },
      { key: 'trainingDuration', personalValue: 180, teamMean: 150, teamSampleCount: 8 },
      { key: 'trainingLoad', personalValue: 800, teamMean: 1000, teamSampleCount: 6 }
    ];
    const view = trainingComparisonSummary({ items });
    expect(view.hasData).toBe(true);
    expect(view.metrics.map((metric) => metric.key)).toEqual(['trainingDuration', 'trainingLoad', 'specialDistance']);
    expect(view.metrics[0].personalText).toBe('3');
    expect(view.metrics[0].teamText).toBe('2.5');
    expect(view.metrics[0].unit).toBe('h');
    expect(view.metrics[0].referenceText).toBe('高于队均 20%');
    expect(view.metrics[1].referenceText).toBe('低于队均 20%');
    expect(view.metrics[1].sampleText).toBe('6 人参照');
    expect(items[3].personalValue).toBe(180);
  });

  it('保留真实零值，队均为零时不计算比例', () => {
    const view = trainingComparisonSummary({ items: [
      { key: 'trainingDuration', personalValue: 0, teamMean: 0, teamSampleCount: 2 },
      { key: 'trainingLoad', personalValue: 100, teamMean: 0, teamSampleCount: 2 },
      { key: 'specialDistance', personalValue: 0, teamMean: 20, teamSampleCount: 2 }
    ] });
    expect(view.metrics[0].personalText).toBe('0');
    expect(view.metrics[0].referenceText).toBe('与队均持平');
    expect(view.metrics[1].referenceText).toBe('队均为 0，暂不计算比例');
    expect(view.metrics[2].referenceText).toBe('低于队均 100%');
  });

  it('缺失、非数值与样本不足不冒充零或有效对照', () => {
    const view = trainingComparisonSummary({ items: [
      { key: 'trainingDuration', personalValue: null, teamMean: 120, teamSampleCount: 4 },
      { key: 'trainingLoad', personalValue: 800, teamMean: 700, teamSampleCount: 1 },
      { key: 'specialDistance', personalValue: NaN, teamMean: Infinity }
    ] });
    expect(view.metrics[0].personalText).toBe('—');
    expect(view.metrics[0].referenceText).toBe('个人未记录');
    expect(view.metrics[1].teamText).toBe('—');
    expect(view.metrics[1].referenceText).toBe('暂无可比队均');
    expect(view.metrics[2].personalText).toBe('—');
    expect(view.metrics[2].teamText).toBe('—');
    expect(view.metrics[2].sampleText).toBe('');
  });

  it('很小的非零值不显示成零，微小差异不显示成完全持平', () => {
    const view = trainingComparisonSummary({ items: [
      { key: 'trainingDuration', personalValue: 1, teamMean: 2, teamSampleCount: 3 },
      { key: 'trainingLoad', personalValue: 1000.1, teamMean: 1000, teamSampleCount: 3 }
    ] });
    expect(view.metrics[0].personalText).toBe('＜0.1');
    expect(view.metrics[0].teamText).toBe('＜0.1');
    expect(view.metrics[0].referenceText).toBe('低于队均 50%');
    expect(view.metrics[1].referenceText).toBe('接近队均');
  });

  it('无训练数据时输出空状态，不使用体重或测试指标填充', () => {
    expect(trainingComparisonSummary(null).hasData).toBe(false);
    expect(trainingComparisonSummary({ items: [] }).hasData).toBe(false);
    expect(trainingComparisonSummary({ items: [{ key: 'weightKg', personalValue: 80 }] }).hasData).toBe(false);
  });
});
