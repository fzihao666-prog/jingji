import { describe, expect, it } from 'vitest';
import { athleteAccountAreaComplete, athleteAccountAreaForEdit } from './athlete-account-area.js';

const county = { areaLevel: 'county' as const, province: '四川', city: '成都市', county: '武侯区' };
describe('运动员账号区域状态', () => {
  it('仅一个具体区县视为已完善', () => {
    expect(athleteAccountAreaComplete([county])).toBe(true);
    expect(athleteAccountAreaComplete([])).toBe(false);
    expect(athleteAccountAreaComplete([county, county])).toBe(false);
    expect(athleteAccountAreaComplete([{ ...county, county: '' }])).toBe(false);
    expect(athleteAccountAreaComplete([{ ...county, areaLevel: 'national' }])).toBe(false);
    expect(athleteAccountAreaComplete([{ ...county, areaLevel: 'province' }])).toBe(false);
  });
  it('历史全国范围进入区县补全表单，不预填默认地域', () => {
    expect(
      athleteAccountAreaForEdit([{ areaLevel: 'national', province: '', city: '', county: '' }])
    ).toEqual({ areaLevel: 'county', province: '', city: '', county: '' });
    expect(athleteAccountAreaForEdit([])).toEqual({
      areaLevel: 'county',
      province: '',
      city: '',
      county: '',
    });
  });
  it('保留本人已有归属和待补全的省市', () => {
    expect(athleteAccountAreaForEdit([county])).toEqual(county);
    expect(athleteAccountAreaForEdit([{ ...county, areaLevel: 'city', county: '' }])).toEqual({
      ...county,
      county: '',
    });
  });
});
