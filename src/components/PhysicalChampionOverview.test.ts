import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import type { PhysicalChampionPayload, PhysicalReference } from '../../shared/physical-champion';
import { PhysicalChampionOverview } from './PhysicalChampionOverview';

const reference: PhysicalReference = {
  id: 1,
  revision: 0,
  key: 'vertical_jump',
  label: '纵跳',
  unit: 'cm',
  value: 50,
  protocol: 'CMJ双手叉腰',
  protocolVersion: '',
  testContext: '',
  side: 'center',
  direction: 'higher_better',
  sourceType: 'estimated',
  sourceNote: '估算资料',
  project: 'ROWING',
  reviewStatus: 'reviewed',
  sourceNature: 'estimated',
  version: 1,
  effectiveFrom: '2026-01-01',
  effectiveTo: null,
  position: 'open',
  referenceLevel: 'open',
  referenceLabel: '纵跳参考',
  dimensionVersion: 'v1',
  measurementCodes: ['vertical_jump_cm'],
  measurementUnit: 'cm',
  weightRelative: false,
  gender: '男',
  event: 'open',
  weightClass: 'open',
  ageGroup: 'adult',
};
it.each([
  [null, null],
  [null, 0],
  [null, 120],
  [1, null],
  [1, 0],
  [1, 120],
] as const)('简洁模型保留缺测、真实0及超标达成度（运动员%s，达成度%s）', (athleteId, achieved) => {
  const dimension = {
    key: reference.key,
    value: achieved === null ? null : achieved / 2,
    achievedPercent: achieved,
    difference: achieved === null ? null : achieved / 2 - 50,
    scoringEligible: false,
    testDate: null,
    pendingReason: null,
    referenceId: 1,
    referenceVersion: 1,
    factMeasurementId: null,
    calculationVersion: 'test',
    appliedReference: reference,
  };
  const group: PhysicalChampionPayload['groups'][number] = {
    id: 'g',
    label: '男子',
    gender: '男',
    event: 'open',
    weightClass: 'open',
    ageGroup: 'adult',
    referenceLevel: 'open',
    references: [reference],
    team: [{ ...dimension, sampleCount: achieved === null ? 0 : 1 }],
    athletes: [
      {
        athleteId: 1,
        athleteName: '合成运动员',
        score: achieved,
        scoringEligible: false,
        coverage: achieved === null ? 0 : 1,
        dimensions: [dimension],
      },
    ],
    trend: [
      {
        date: '2026-10-01',
        score: achieved,
        scoringEligible: false,
        sampleCount: achieved === null ? 0 : 1,
        athleteId: null,
        coverage: achieved === null ? 0 : 1,
      },
    ],
  };
  const html = renderToStaticMarkup(
    createElement(PhysicalChampionOverview, { group, athleteId, scopeName: '当前表现' })
  );
  expect(html.match(/<dt>/g) || []).toHaveLength(3);
  expect(html).toContain('含估算参考，不参与正式评分');
  expect(html).toContain('<details class="physical-champion-data"><summary>查看指标数据</summary>');
  expect(html).not.toContain(' open');
  expect(html).not.toContain('趋势');
  expect(html).not.toContain('参考差距分析');
  expect(html).toContain(
    achieved === null ? '暂无同协议可比成绩' : '<dd>' + achieved + '<small>%</small></dd>'
  );
});
