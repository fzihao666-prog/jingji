import { expect, it } from 'vitest';
import {
  normalizeAiPlan,
  diffTeamPlanData,
  undoTeamPlanAiChange,
  TeamPlanAiError,
  type TeamPlanAiMetadata,
} from './team-plan-ai.ts';
import type { TeamPlanData } from '../../shared/team-plan.ts';

const rawPlan = {
  date: '2026-10-17',
  focus: '有氧耐力与基础力量',
  goal: '阶段目标：有氧基础',
  dataNotes: ['晨检数据不足，强度请教练确认'],
  sessions: [
    {
      date: '2026-10-17',
      category: 'special',
      period: 'morning',
      content: '水上有氧训练',
      durationMin: 90,
      distanceKm: 16,
      intensity: 'U2',
      sets: null,
      reps: null,
      load: null,
      notes: '',
      items: [
        { title: '热身', description: '低强度划行' },
        { title: '主训练', description: '持续划行12公里' },
      ],
    },
    {
      date: '2026-10-17',
      category: 'physical',
      period: 'afternoon',
      content: '基础力量',
      durationMin: 60,
      distanceKm: null,
      intensity: '',
      sets: 3,
      reps: 8,
      load: 60,
      notes: '深蹲卧拉',
    },
  ],
};

it('AI输出映射到既有计划结构：编号补齐、强度校验、缺失数值保持null', () => {
  const { data, dataNotes, warnings } = normalizeAiPlan(rawPlan, '2026-10-17');
  expect(data.sessions).toHaveLength(2);
  expect(data.sessions[0].id).toBe('s1');
  expect(data.sessions[0].items?.map((item) => item.id)).toEqual(['s1-1', 's1-2']);
  expect(data.sessions[0].durationMin).toBe(90);
  expect(data.sessions[1].distanceKm).toBeNull();
  expect(data.sessions[1].intensity).toBe('');
  expect(data.focus).toBe('有氧耐力与基础力量');
  expect(dataNotes).toEqual(['晨检数据不足，强度请教练确认']);
  expect(warnings).toEqual([]);
});

it('非竞迹强度体系的代号被清空并提示，不臆造换算', () => {
  const bad = {
    ...rawPlan,
    sessions: [{ ...rawPlan.sessions[0], intensity: 'Z5' }],
  };
  const { data, warnings } = normalizeAiPlan(bad, '2026-10-17');
  expect(data.sessions[0].intensity).toBe('');
  expect(warnings.join()).toContain('Z5');
});

it('日期不一致、重复标识或结构不合法时拒绝保存', () => {
  expect(() => normalizeAiPlan(rawPlan, '2026-10-18')).toThrow(TeamPlanAiError);
  expect(() =>
    normalizeAiPlan({ ...rawPlan, sessions: [] }, '2026-10-17')
  ).toThrow(TeamPlanAiError);
  expect(() =>
    normalizeAiPlan(
      {
        ...rawPlan,
        sessions: [
          { ...rawPlan.sessions[0], id: 'x', date: '2026-10-18' },
        ],
      },
      '2026-10-17'
    )
  ).toThrow(TeamPlanAiError);
});

it('修改差异列出新增、删除与字段级修改', () => {
  const { data: prev } = normalizeAiPlan(rawPlan, '2026-10-17');
  const next: TeamPlanData = {
    ...prev,
    sessions: [
      { ...prev.sessions[0], durationMin: 70, items: prev.sessions[0].items },
      {
        id: 's3',
        date: '2026-10-17',
        category: 'recovery',
        period: 'evening',
        content: '拉伸放松',
        durationMin: 30,
        distanceKm: null,
        intensity: '',
        sets: null,
        reps: null,
        load: null,
        notes: '',
      },
    ],
  };
  const diff = diffTeamPlanData(prev, next);
  expect(diff.added.map((item) => item.id)).toEqual(['s3']);
  expect(diff.removed.map((item) => item.id)).toEqual(['s2']);
  expect(diff.modified).toHaveLength(1);
  expect(diff.modified[0].id).toBe('s1');
  expect(diff.modified[0].changes.durationMin).toEqual({ from: 90, to: 70 });
});

it('撤销上一次AI修改恢复历史快照，无历史时拒绝', () => {
  const { data: first } = normalizeAiPlan(rawPlan, '2026-10-17');
  const second: TeamPlanData = {
    ...first,
    sessions: [{ ...first.sessions[0], durationMin: 70 }],
  };
  const metadata: TeamPlanAiMetadata = {
    source: 'ai_generated',
    promptVersion: 'v',
    model: 'm',
    generatedAt: new Date().toISOString(),
    targetDate: '2026-10-17',
    dataNotes: [],
    warnings: [],
    conversation: [],
    history: [{ at: new Date().toISOString(), instruction: '减量', data: first }],
  };
  const restored = undoTeamPlanAiChange({ data: second, metadata });
  expect(restored.data.sessions[0].durationMin).toBe(90);
  expect(restored.metadata.history).toHaveLength(0);
  expect(() => undoTeamPlanAiChange(restored)).toThrow(TeamPlanAiError);
});
