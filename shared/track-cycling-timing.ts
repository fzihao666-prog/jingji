const splits = ['分段一', '分段二', '分段三', '分段四', '分段五', '分段六', '分段七', '分段八'];
const laps = ['第一圈', '第二圈', '第三圈', '第四圈'];
const events = [
  { code: 'flying_200', name: '俯冲200米测试', splits: 2, laps: 0 },
  { code: 'flying_500', name: '俯冲500米测试', splits: 4, laps: 2 },
  { code: 'standing_250', name: '原地启动250米测试', splits: 3, laps: 0 },
  { code: 'standing_1000', name: '原地启动一公里测试', splits: 8, laps: 4 },
];

export const TRACK_CYCLING_TIMING_METRICS = events.flatMap(event => {
  const prefix = `track_${event.code}`;
  return [
    { field: '总时间', code: `${prefix}_total` },
    ...splits.slice(0, event.splits).map((field, index) => ({ field, code: `${prefix}_split_${index + 1}` })),
    ...laps.slice(0, event.laps).map((field, index) => ({ field, code: `${prefix}_lap_${index + 1}` })),
  ].map(metric => ({ ...metric, event: event.name, label: `场地自行车${event.name}${metric.field}` }));
});
