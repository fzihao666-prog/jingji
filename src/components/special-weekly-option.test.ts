import { expect, it } from 'vitest';
import { specialWeeklyRows } from './special-weekly-option';
it('周训练量保留真实零与缺失，不跨周合并', () => {
  expect(specialWeeklyRows([
    {date:'2026-10-25',durationMin:0,distanceKm:null,load:null,sessionCount:1},
    {date:'2026-10-26',durationMin:30,distanceKm:2,load:null,sessionCount:1},
    {date:'2026-10-27',durationMin:null,distanceKm:3,load:null,sessionCount:1},
  ])).toEqual([{week:'2026-10-19',durationMin:0,distanceKm:null},{week:'2026-10-26',durationMin:30,distanceKm:5}]);
  expect(specialWeeklyRows([])).toEqual([]);
});
