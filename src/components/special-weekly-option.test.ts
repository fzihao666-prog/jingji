import { expect, it } from 'vitest';
import { specialWeeklyOption, specialWeeklyRows } from './special-weekly-option';
it('周训练量保留真实零与缺失，不跨周合并', () => {
  expect(specialWeeklyRows([
    {date:'2026-10-25',durationMin:0,distanceKm:null,load:null,sessionCount:1},
    {date:'2026-10-26',durationMin:30,distanceKm:2,load:null,sessionCount:1},
    {date:'2026-10-27',durationMin:null,distanceKm:3,load:null,sessionCount:1},
  ])).toEqual([{week:'2026-10-19',durationMin:0,distanceKm:null},{week:'2026-10-26',durationMin:30,distanceKm:5}]);
  expect(specialWeeklyRows([])).toEqual([]);
});

it('没有训练记录时，周图仍显示所选周期的自然周', () => {
  const option = specialWeeklyOption([], '2026-10-25', '2026-11-02');
  expect(option.xAxis).toMatchObject({ data: ['10-19周', '10-26周', '11-02周'] });
  expect(option.series).toMatchObject([{ data: [null, null, null] }, { data: [null, null, null] }]);
});

it('周图折线跨缺失周连接真实点，不把缺失周补成零', () => {
  const option = specialWeeklyOption(
    [
      { date: '2026-10-25', durationMin: 120, distanceKm: 4, load: null, sessionCount: 1 },
      { date: '2026-11-02', durationMin: 90, distanceKm: null, load: null, sessionCount: 1 },
    ],
    '2026-10-25',
    '2026-11-02'
  );
  expect(option.series).toMatchObject([
    { data: [120, null, 90] },
    { connectNulls: true, data: [4, null, null] },
  ]);
});
