import { describe, expect, it } from 'vitest';
import {
  selectProfilePhysiologyRecords,
  profilePhysiologyRecordSchema,
} from './profile-physiology.js';
const row = {
  measurementId: 1,
  testQuality: 'valid',
  code: 'hemoglobin_g_l',
  label: '血红蛋白',
  domain: 'biochemistry',
  testDate: '2026-09-25',
  value: 145,
  unit: 'g/L',
  quality: 'valid',
  source: 'manual',
  testSource: 'manual',
  isDemo: 0,
  testDemo: 0,
};
describe('档案生理生化检测记录', () => {
  it('保留周期内有效零值和来源，不修改输入，不生成缺测记录', () => {
    const zero = { ...row, value: 0, source: 'synthetic_30d_current_v1' };
    const result = selectProfilePhysiologyRecords([zero], '2026-09-01', '2026-09-30');
    expect(result).toEqual([
      {
        id: 1,
        code: row.code,
        label: row.label,
        date: row.testDate,
        value: 0,
        unit: 'g/L',
        source: zero.source,
        protocol: '',
      },
    ]);
    expect(profilePhysiologyRecordSchema.safeParse(result[0]).success).toBe(true);
    expect(zero.value).toBe(0);
    expect(selectProfilePhysiologyRecords([], '2026-09-01', '2026-09-30')).toEqual([]);
  });
  it('排除周期外、演示、无效会话、无效测量和非生理生化指标', () => {
    const invalid = [
      { testDate: '2026-08-31' },
      { testDate: '2026-10-01' },
      { isDemo: 1 },
      { testDemo: 1 },
      { quality: 'outlier' },
      { testQuality: 'estimated' },
      { domain: 'strength' },
      { value: NaN },
    ];
    expect(
      selectProfilePhysiologyRecords(
        invalid.map((item) => ({ ...row, ...item })),
        '2026-09-01',
        '2026-09-30'
      )
    ).toEqual([]);
  });
  it('保留每条记录原单位，按日期降序而不混算', () => {
    const result = selectProfilePhysiologyRecords(
      [row, { ...row, measurementId: 2, value: 14.5, unit: 'g/dL', testDate: '2026-09-26' }],
      '2026-09-01',
      '2026-09-30'
    );
    expect(result.map((item) => [item.id, item.value, item.unit])).toEqual([
      [2, 14.5, 'g/dL'],
      [1, 145, 'g/L'],
    ]);
  });
});
