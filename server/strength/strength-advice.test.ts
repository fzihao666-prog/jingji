import { afterEach, describe, expect, it, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';

const fixture = vi.hoisted(() => ({ db: null as DatabaseSync | null }));
vi.mock('../core/db.ts', () => ({
  get db() {
    return fixture.db;
  },
}));
import { buildAiAdvice, type AdviceTestRow } from './strength-advice.ts';

const testRow: AdviceTestRow = {
  strengthTestId: 1,
  athleteId: 1,
  athleteName: '测试运动员',
  project: 'ROWING',
  team: '测试队',
  gender: '男',
  testDate: '2026-11-03',
  metricsJson: '{}',
  targetsJson: '{}',
};
afterEach(() => {
  fixture.db?.close();
  fixture.db = null;
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
function configure(effort: string) {
  fixture.db = new DatabaseSync(':memory:');
  fixture.db.exec(`
    CREATE TABLE training_sessions (athlete_id INTEGER, session_date TEXT, training_type TEXT,
      duration_min REAL, rpe REAL, srpe REAL, session_order INTEGER);
    CREATE TABLE daily_wellness (athlete_id INTEGER, wellness_date TEXT, sleep_hours REAL,
      fatigue_index REAL, status TEXT);
  `);
  vi.stubEnv('AI_BASE_URL', 'https://api.deepseek.com');
  vi.stubEnv('AI_MODEL', 'deepseek-v4-pro');
  vi.stubEnv('AI_API_KEY', 'synthetic-test-key');
  vi.stubEnv('AI_REASONING_EFFORT', effort);
  const fetcher = vi.fn().mockResolvedValue(
    new Response(
      JSON.stringify({
        choices: [{ message: { content: '{"title":"测试建议"}' } }],
      })
    )
  );
  vi.stubGlobal('fetch', fetcher);
  return fetcher;
}
describe('体能建议 DeepSeek 配置', () => {
  it.each(['none', 'low', 'high', 'max'])('实际请求携带 %s', async (effort) => {
    const fetcher = configure(effort);
    const result = await buildAiAdvice(testRow);
    expect(result.source).toBe('ai');
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toMatchObject({ reasoning_effort: effort });
  });
  it('未配置时保留默认行为', async () => {
    const fetcher = configure('');
    expect((await buildAiAdvice(testRow)).source).toBe('ai');
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).not.toHaveProperty('reasoning_effort');
  });
  it('其他供应商不受影响', async () => {
    const fetcher = configure('high');
    vi.stubEnv('AI_BASE_URL', 'https://example.invalid');
    expect((await buildAiAdvice(testRow)).source).toBe('ai');
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).not.toHaveProperty('reasoning_effort');
  });
  it('非法配置报错，避免被规则兜底掩盖', async () => {
    const fetcher = configure('invalid');
    await expect(buildAiAdvice(testRow)).rejects.toThrow('AI_REASONING_EFFORT');
    expect(fetcher).not.toHaveBeenCalled();
  });
});
