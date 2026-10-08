import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import {
  STRENGTH_TRAINING_CATEGORIES,
  inferStrengthCategory,
} from '../../shared/strength-training';

function load(url) {
  const module = { exports: {} };
  vm.runInNewContext(readFileSync(url, 'utf8'), {
    module, require: (path) => load(new URL(`${path}.js`, url))
  });
  return module.exports;
}
const { planView, recordView, metricView, overviewView, structureCategory } = load(new URL('./strength-view.js', import.meta.url));
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
  it.each(['深蹲', '跑步间歇', '平板支撑', '高拉', '药球抛', '水上专项划行', ''])('分类“%s”与共享推断规则一致', (name) => {
    expect(structureCategory({ exerciseName: name })).toBe(inferStrengthCategory(name));
  });
  it('训练结构固定五类展示，0 值行保留', () => {
    const view = overviewView([], [{ trainingDate: '2026-09-01', sets: [
      { exerciseName: '深蹲', trainingCategory: '基础力量' },
      { exerciseName: '卧推', trainingCategory: '基础力量' },
      { exerciseName: '平板支撑', trainingCategory: '核心力量' },
      { exerciseName: '跑步间歇', trainingCategory: '代谢训练' },
    ] }], period);
    expect(view.structure.map((item) => item.name)).toEqual([...STRENGTH_TRAINING_CATEGORIES]);
    expect(view.structure.map((item) => item.count)).toEqual([2, 0, 1, 0, 1]);
    expect(view.structure[0]).toMatchObject({ rate: '50', width: 50 });
    expect(view.structureNote).toContain('共 4 项');
  });
  it('训练分类缺失或不在字典时才按动作名推断，明细事实优先', () => {
    expect(structureCategory({ exerciseName: '高拉速度力量', trainingCategory: '专项力量' })).toBe('专项力量');
    expect(structureCategory({ exerciseName: '深蹲', trainingCategory: '乱填分类' })).toBe('基础力量');
    expect(structureCategory({ exerciseName: '跑步间歇' })).toBe('代谢训练');
    const view = overviewView([], [{ trainingDate: '2026-09-01', sets: [{ exerciseName: '高拉速度力量', trainingCategory: '专项力量' }] }], period);
    expect(view.structure.find((item) => item.name === '专项力量')).toMatchObject({ count: 1, rate: '100' });
  });
  it('无目标时不计算画像达成率，周期外测试明确标记', () => {
    const view = overviewView([{ testDate: '2026-08-01', metrics: { squatKg: 80 } }], [], period);
    expect(view.latestTestOutsidePeriod).toBe(true);
    expect(view.metrics[0].rate).toBe('—');
  });
});
