import { expect, it } from 'vitest';
import { createTeamWeeklyFixture } from './team-weekly-fixture.ts';
import { readTeamWeeklyReport } from './team-weekly-report.ts';
import { teamWeeklyAiInput, teamWeeklyFingerprint } from './team-weekly-ai.ts';
const query = { project: 'ROWING', teamId: 1, date: '2026-10-05', reportType: 'combined' } as const;
it('训练白名单排除身份健康备注，并保留数据指纹', () => {
  const db = createTeamWeeklyFixture();
  try {
    const report = readTeamWeeklyReport(db, query, [1, 3]);
    const input = JSON.stringify(teamWeeklyAiInput(report));
    expect(input).not.toContain('示例队员');
    expect(input).not.toContain('合成测试队');
    expect(input).not.toContain('sleep');
    expect(teamWeeklyFingerprint({ ...report, generatedAt: 'different' })).toBe(
      teamWeeklyFingerprint(report)
    );
  } finally {
    db.close();
  }
});
