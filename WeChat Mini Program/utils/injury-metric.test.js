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
    Error,
    RegExp,
    Math,
  });
  return module.exports;
}

// 状态标签与线上 injury-form（服务端口径）一致，此处加载真实模块。
const injuryForm = loadCjs(new URL('./injury-form.js', import.meta.url), {
  './date': { todayBeijing: () => '2026-09-27' },
});
const { injuryMetricView } = loadCjs(new URL('./injury-metric.js', import.meta.url), {
  './injury-form': injuryForm,
});

describe('周期核心数据损伤情况卡片', () => {
  it('团队口径统计未愈损伤人数，并标出最需关注个案', () => {
    const none = injuryMetricView([{ status: 'healthy', athleteName: '甲', injuryName: '旧伤' }], false);
    expect(none).toEqual({
      label: '损伤情况',
      value: '0',
      unit: '人',
      note: '当前无未愈损伤',
      tone: 'tone-blue',
    });
    const active = injuryMetricView(
      [
        { status: 'restricted', athleteName: '甲', injuryName: '肩袖损伤', painScore: 6 },
        { status: 'observation', athleteName: '乙', injuryName: '腰肌劳损', painScore: 2 },
      ],
      false
    );
    expect(active).toEqual({
      label: '损伤情况',
      value: '2',
      unit: '人',
      note: '甲 · 肩袖损伤',
      tone: 'tone-red',
    });
  });

  it('个人口径展示当前状态与疼痛评分', () => {
    const restricted = injuryMetricView(
      [{ status: 'restricted', injuryName: '肩袖损伤', painScore: 4 }],
      true
    );
    expect(restricted).toEqual({
      label: '损伤情况',
      value: '受限',
      unit: '',
      note: '肩袖损伤 · 疼痛 4 分',
      tone: 'tone-red',
    });
    const healthy = injuryMetricView([{ status: 'healthy', injuryName: '膝扭伤' }], true);
    expect(healthy).toEqual({
      label: '损伤情况',
      value: '健康',
      unit: '',
      note: '最近一次记录已归为健康',
      tone: 'tone-blue',
    });
    const empty = injuryMetricView([], true);
    expect(empty).toEqual({
      label: '损伤情况',
      value: '健康',
      unit: '',
      note: '暂无伤病记录',
      tone: 'tone-blue',
    });
  });

  it('疼痛评分缺失时不补零值，未知状态收敛为关注', () => {
    const missingPain = injuryMetricView([{ status: 'rehab', injuryName: '' }], true);
    expect(missingPain.note).toBe('伤病记录');
    expect(missingPain.value).toBe('康复');
    const unknown = injuryMetricView([{ status: 'unknown' }], true);
    expect(unknown.value).toBe('关注');
  });
});
