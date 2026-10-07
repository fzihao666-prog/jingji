import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { inferStrengthContentAnalysisCategory } from '../../shared/strength-training';

function load(url) {
  const module = { exports: {} };
  vm.runInNewContext(readFileSync(url, 'utf8'), {
    module, require: (path) => load(new URL(`${path}.js`, url))
  });
  return module.exports;
}
const { planView, recordView, metricView, overviewView, contentCategory } = load(new URL('./strength-view.js', import.meta.url));
const period = { from: '2026-09-01', to: '2026-09-30' };
const exercise = { id: 'squat', name: '深蹲', category: '基础力量', maxWeight: 100, lines: [{ id: 'line', weeks: {
  1: { sets: '3', reps: '8', percentage: 70, actualCompleted: '8', arrangement: '周一' },
  2: { sets: '4', reps: '6', percentage: null, actualCompleted: '' }
} }] };
const plans = [{ data: { title: '力量计划', weekKeys: ['1', '2'], exercises: [exercise] } }];

describe('体能小程序视图与网页端数据联动', () => {
  it('按周显示完整处方并从MAX和百分比计算重量', () => {
    const first = planView(plans);
    expect(first.weekLabels).toEqual(['第1周', '第2周']);
    expect(first.planExercises[0].rows[0]).toMatchObject({ prescription: '3 组 × 8 次', weight: '70 kg', completed: '8' });
    const second = planView(plans, 0, 1);
    expect(second.planExercises[0].rows[0]).toMatchObject({ prescription: '4 组 × 6 次', weight: '—', percentage: '—', completed: '—' });
  });
  it('保留超过12个动作并按网页分类筛选', () => {
    const many = [{ data: { exercises: Array.from({ length: 15 }, (_, i) => ({ ...exercise, id: String(i) })) } }];
    expect(planView(many).planExercises).toHaveLength(15);
    expect(planView(plans, 0, 0, '核心力量').planExercises).toHaveLength(0);
    expect(planView(plans, 0, 0, '基础力量').planExercises).toHaveLength(1);
  });
  it('记录支持日期筛选、分页及展开实际结果，缺值不变零', () => {
    const sessions = Array.from({ length: 15 }, (_, i) => ({ id: i + 1, trainingDate: i === 14 ? '2026-09-02' : '2026-09-01', durationMin: null, srpe: null, sets: [{ id: 'set', exerciseName: '深蹲', actualReps: 0, actualWeightKg: null, completed: false }] }));
    expect(recordView(sessions).records).toHaveLength(12);
    expect(recordView(sessions).hasMoreRecords).toBe(true);
    expect(recordView(sessions, '', 24).records).toHaveLength(15);
    const chosen = recordView(sessions, '2026-09-02', 12, '15');
    expect(chosen.recordCount).toBe(1);
    expect(chosen.records[0]).toMatchObject({ load: '—', sets: [{ actual: '0 次 · — kg', completed: '未完成' }] });
    expect(recordView(sessions, '2026-09-03').records).toEqual([]);
  });
  it('无真实数据不显示示例，部分缺失不把空值计为0', () => {
    expect(overviewView([], [], period).trend).toEqual([]);
    expect(overviewView([], [], period).summaryCards[1].value).toBe('—');
    const view = overviewView([], [{ trainingDate: '2026-09-01', durationMin: 30, srpe: null, sets: [] }], period);
    expect(view.trend[0]).toMatchObject({ durationText: '30', loadText: '—', loadHeight: 0 });
    expect(view.summaryCards[2].value).toBe('—');
  });
  it('趋势不再截断到14天，零训练量不替换为示例', () => {
    const sessions = Array.from({ length: 20 }, (_, index) => ({ trainingDate: `2026-09-${String(index + 1).padStart(2, '0')}`, durationMin: 0, srpe: 0 }));
    const view = overviewView([], sessions, period);
    expect(view.trend).toHaveLength(20);
    expect(view.trend[0].durationText).toBe('0');
  });
  it('指标按日期排列，历史参照独立于所选周期且缺失不补零', () => {
    const tests = [{ id: 2, testDate: '2026-09-20', metrics: { squatKg: 90 } }, { id: 1, testDate: '2026-08-01', metrics: { squatKg: 110 } }, { id: 3, testDate: '2026-09-05', metrics: { squatKg: 80 } }, { id: 4, testDate: '2026-09-22', metrics: { squatKg: null } }];
    const view = metricView(tests, 'squatKg', period);
    expect(view.metricHistory.map((item) => item.value)).toEqual(['80', '90']);
    expect(view.metricBest).toBe('110');
    expect(view.metricChange).toBe('10');
    expect(metricView(tests, 'squatKg', { from: '2026-09-19', to: '2026-09-30' }).metricChange).toBe('—');
  });
  it.each(['热身 深蹲', 'crossfit', '泡沫轴', '力量耐力', '卧拉', '抓举', '平板支撑', '药球', '水上划行', '跑步', ''])('分类“%s”与网页共享规则一致', (name) => {
    const input = { sessionLabel: name, exerciseName: '' };
    expect(contentCategory(input, input)).toBe(inferStrengthContentAnalysisCategory(input));
  });
  it('训练内容只使用既有动作事实，范围外内容不进入八类占比', () => {
    const view = overviewView([], [{ trainingDate: '2026-09-01', sets: [{ exerciseName: '卧推' }, { exerciseName: '平板' }, { exerciseName: '跑步' }] }], period);
    expect(view.structure).toEqual([{ name: '最大力量', count: 1, rate: '50', width: 50 }, { name: '核心力量', count: 1, rate: '50', width: 50 }]);
  });
  it('无目标时不计算画像达成率，周期外测试明确标记', () => {
    const view = overviewView([{ testDate: '2026-08-01', metrics: { squatKg: 80 } }], [], period);
    expect(view.latestTestOutsidePeriod).toBe(true);
    expect(view.metrics[0].rate).toBe('—');
  });
});
