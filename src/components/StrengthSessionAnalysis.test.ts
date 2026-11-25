import { expect, it } from 'vitest';
import { strengthSessionSummary } from './StrengthSessionAnalysis';
import type { StrengthTrainingSession } from '../types';
it('缺失负荷和RPE不补零，空数据不生成可比次数', () => {
  expect(strengthSessionSummary([])).toMatchObject({ load: null, rpe: null, comparableCount: 0, actions: [] });
});
it('真实零保留，次数对照只统计可比组', () => {
  const row: StrengthTrainingSession = { id: 1, trainingDate: '2026-10-28', sessionOrder: 1, sessionLabel: '', rpe: 0, srpe: 0, volume: 0, durationMin: 30, distanceKm: 0, trainingType: '', structureType: '', intensityZone: 'U3', source: '', sourceFilename: '', modelUsed: '', importedAt: '', sets: [] };
  expect(strengthSessionSummary([row, { ...row, id: 2, rpe: null, srpe: null }])).toMatchObject({ duration: 60, load: 0, loadCount: 1, rpe: 0, rpeCount: 1 });
});
