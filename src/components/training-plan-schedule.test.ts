import { describe, expect, it } from 'vitest';
import type { StrengthResultSet, TrainingPlan, TrainingPlanData } from '../types';
import {
  derivePlannedSessions,
  matchTrainingRows,
  parseWeekdays,
  type ScopedStrengthSession,
} from './training-plan-schedule';

function planFixture(id: number, athleteId: number, data: Partial<TrainingPlanData>): TrainingPlan {
  return {
    id,
    athleteId,
    athleteName: `运动员${athleteId}`,
    project: '皮划艇',
    team: '一队',
    photoUrl: '',
    updatedAt: '2026-01-01',
    updatedBy: '教练',
    data: {
      startDate: '2026-03-02',
      endDate: '2026-03-29',
      title: '四周体能训练',
      scheduleLabel: '周二 / 周五',
      bodyWeight: null,
      age: null,
      exercises: [],
      ...data,
    },
  };
}

function exercise(
  name: string,
  weekSets: string,
  weekReps: string,
  estimatedMinutes: number | null = null
) {
  return {
    id: `ex-${name}`,
    name,
    maxWeight: 80,
    unitNote: '',
    estimatedMinutes,
    lines: [
      {
        id: `line-${name}`,
        weeks: {
          '1': {
            sets: weekSets,
            reps: weekReps,
            percentage: 80,
            actualCompleted: '',
            arrangement: '',
          },
        },
      },
    ],
  };
}

function setFixture(exerciseName: string, completed: boolean): StrengthResultSet {
  return {
    id: 1,
    exerciseName,
    setIndex: 1,
    targetReps: 5,
    actualReps: 5,
    actualWeightKg: 60,
    plannedWeightKg: 60,
    trainingCategory: '基础力量',
    bodyPosition: '上肢',
    trainingEnvironment: '陆上',
    durationMin: 3,
    distanceKm: 0,
    intensityPercent: null,
    intensityZone: 'U2',
    rpe: null,
    completed,
    note: '',
    importBatchId: 'batch',
    confidence: null,
  };
}

function sessionFixture(
  id: number,
  athleteId: number,
  trainingDate: string,
  sets: StrengthResultSet[]
): ScopedStrengthSession {
  return {
    id,
    athleteId,
    trainingDate,
    sessionOrder: 1,
    sessionLabel: '力量课',
    rpe: null,
    volume: 0,
    durationMin: 60,
    distanceKm: 0,
    trainingType: '体能训练',
    structureType: '力量',
    intensityZone: 'U2',
    srpe: 0,
    source: 'import',
    sourceFilename: '',
    modelUsed: '',
    importedAt: '2026-03-03',
    sets,
  };
}

describe('parseWeekdays', () => {
  it('解析中文训练日并去重排序', () => {
    expect(parseWeekdays('周二 / 周五')).toEqual([2, 5]);
    expect(parseWeekdays('星期一、星期三、礼拜六')).toEqual([1, 3, 6]);
    expect(parseWeekdays('每周三次')).toEqual([]);
    expect(parseWeekdays('Monday & Friday')).toEqual([1, 5]);
  });
});

describe('derivePlannedSessions', () => {
  it('按 scheduleLabel 推导计划训练日并给出计划量与计划时长', () => {
    const plans = [
      planFixture(1, 1, {
        weekKeys: ['1'],
        exercises: [exercise('卧拉', '5', '5', 30), exercise('深蹲', '4', '6', 20)],
      }),
    ];
    const planned = derivePlannedSessions(plans, '2026-03-01', '2026-03-31');
    expect(planned.map((item) => item.date)).toEqual(['2026-03-03', '2026-03-06']);
    expect(planned[0]).toMatchObject({
      athleteId: 1,
      source: 'schedule_label',
      plannedSets: 9,
      plannedReps: 49,
      plannedMinutes: 50,
      exerciseNames: ['卧拉', '深蹲'],
    });
  });

  it('AI 计划的 weeklyPlans 训练日优先于 scheduleLabel', () => {
    const plans = [
      planFixture(2, 1, {
        weekKeys: ['1'],
        scheduleLabel: '周日',
        weeklyPlans: [{ weekNumber: 1, days: [{ dayOfWeek: '周四' }] }],
        exercises: [exercise('卧推', '5', '5')],
      }),
    ];
    const planned = derivePlannedSessions(plans, '2026-03-01', '2026-03-31');
    expect(planned.map((item) => item.date)).toEqual(['2026-03-05']);
    expect(planned[0].source).toBe('week_days');
  });

  it('不可推导训练日或无计划动作时生成空计划，不虚构课次', () => {
    const noSchedule = derivePlannedSessions(
      [
        planFixture(3, 1, {
          weekKeys: ['1'],
          scheduleLabel: '每周三次',
          exercises: [exercise('卧拉', '5', '5')],
        }),
      ],
      '2026-03-01',
      '2026-03-31'
    );
    expect(noSchedule).toEqual([]);
    const noExercise = derivePlannedSessions(
      [planFixture(4, 1, { weekKeys: ['1'], scheduleLabel: '周二', exercises: [] })],
      '2026-03-01',
      '2026-03-31'
    );
    expect(noExercise).toEqual([]);
  });

  it('同一运动员只保留与周期重叠的最新计划', () => {
    const plans = [
      planFixture(5, 1, {
        startDate: '2026-02-02',
        endDate: '2026-03-01',
        weekKeys: ['1'],
        exercises: [exercise('旧动作', '5', '5')],
      }),
      planFixture(6, 1, {
        weekKeys: ['1'],
        exercises: [exercise('新动作', '5', '5')],
      }),
    ];
    const planned = derivePlannedSessions(plans, '2026-03-01', '2026-03-31');
    expect(planned.every((item) => item.planId === 6)).toBe(true);
    expect(planned.map((item) => item.date)).toEqual(['2026-03-03', '2026-03-06']);
  });
});

describe('matchTrainingRows', () => {
  const plans = [
    planFixture(1, 1, {
      weekKeys: ['1'],
      exercises: [exercise('卧拉', '5', '5', 30)],
    }),
  ];

  it('日期与动作名称双重匹配才算关联，仅日期相同不算', () => {
    const planned = derivePlannedSessions(plans, '2026-03-01', '2026-03-31');
    const rows = matchTrainingRows(planned, [
      sessionFixture(10, 1, '2026-03-03', [setFixture('卧推', true)]),
      sessionFixture(11, 1, '2026-03-06', [setFixture('卧拉', true), setFixture('卧拉', true)]),
    ]);
    expect(rows.map((row) => [row.date, row.status])).toEqual([
      ['2026-03-06', '完成'],
      ['2026-03-03', '未进行'],
      ['2026-03-03', '计划外'],
    ]);
  });

  it('区分完成、部分完成与未完成，并保留计划外课次', () => {
    const planned = derivePlannedSessions(plans, '2026-03-01', '2026-03-31');
    const rows = matchTrainingRows(planned, [
      sessionFixture(20, 1, '2026-03-03', [setFixture('卧拉', true), setFixture('卧拉', false)]),
      sessionFixture(21, 1, '2026-03-04', [setFixture('卧拉', false)]),
      sessionFixture(22, 1, '2026-03-05', []),
    ]);
    const byKey = Object.fromEntries(rows.map((row) => [row.key, row.status]));
    expect(Object.values(byKey)).toContain('部分完成');
    expect(Object.values(byKey)).toContain('计划外');
    expect(Object.values(byKey).filter((status) => status === '计划外').length).toBe(2);
  });

  it('不同运动员同日记录不互相匹配', () => {
    const planned = derivePlannedSessions(plans, '2026-03-01', '2026-03-31');
    const rows = matchTrainingRows(planned, [
      sessionFixture(30, 2, '2026-03-03', [setFixture('卧拉', true)]),
    ]);
    expect(rows.every((row) => row.status !== '完成')).toBe(true);
  });
});
