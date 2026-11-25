import { expect, it } from 'vitest';
import { strengthReadScope } from './strength-read-scope.ts';
it('批量去重并保留周期，兼容单人', () => {
  expect(strengthReadScope({athleteIds:'1,2,1',from:'2026-10-01',to:'2026-10-28'})).toEqual({ids:[1,2],from:'2026-10-01',to:'2026-10-28'});
  expect(strengthReadScope({athleteId:'3'})).toEqual({ids:[3],from:null,to:null});
});
it('拒绝SQL文本、非正整数、空集合及无效日期', () => {
  for(const athleteIds of ['', '0','-1','1.5','1);DROP TABLE athletes','1,', ['1']]) expect(strengthReadScope({athleteIds})).toBeNull();
  expect(strengthReadScope({athleteIds:'1',from:'2026-10-28',to:'2026-10-01'})).toBeNull();
  expect(strengthReadScope({athleteIds:'1',from:'bad',to:'bad'})).toBeNull();
  expect(strengthReadScope({athleteIds:'1',from:'2026-10-01'})).toBeNull();
});
