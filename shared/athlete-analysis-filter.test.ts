import { describe, expect, it } from 'vitest';

import { filterAnalysisAthletes } from './athlete-analysis-filter.js';

describe('filterAnalysisAthletes', () => {
  const athletes = [
    {
      id: 7,
      name: '张 三',
      team: '一队',
      identityNumber: 'A-07',
      specialties: '单人艇',
    },
  ];

  it('按姓名、队伍、编号和小项归一化过滤', () => {
    expect(filterAnalysisAthletes(athletes, '张三')).toHaveLength(1);
    expect(filterAnalysisAthletes(athletes, ' a-07 ')).toHaveLength(1);
    expect(filterAnalysisAthletes(athletes, '单人艇')).toHaveLength(1);
    expect(filterAnalysisAthletes(athletes, '二队')).toHaveLength(0);
  });
});
