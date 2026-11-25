import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { expect, it, vi } from 'vitest';

function load(file, mocks) {
  const module = { exports: {} };
  vm.runInNewContext(readFileSync(new URL(file, import.meta.url), 'utf8'), {
    module, require: (path) => mocks[path],
  });
  return module.exports;
}

const date = load('../../utils/date.js', {});
const formatData = load('../../data/format-data.js', {});
const format = load('../../utils/format.js', { '../data/format-data': formatData });
const view = load('./view.js', { '../../utils/date': date, '../../utils/format': format });

function stats(days = 7, options = {}) {
  const buckets = Array.from({ length: days }, (_, index) => ({
    start: `2024-02-${String(index + 1).padStart(2, '0')}`,
    minutes: null, distance: null,
  }));
  return { start: buckets[0].start, end: buckets.at(-1).start, anchorDate: buckets.at(-1).start,
    buckets, totals: { minutes: null, distance: null }, lessonRatio: [], waterRatio: [], timeAnalysis: [], details: [], ...options };
}

function setup() {
  const teamTrainingStats = vi.fn(async () => stats());
  const teams = vi.fn(async () => ({ teams: [
    { id: 1, project: 'CYCLING_ROAD', name: '公路队' },
    { id: 2, project: 'ROWING', name: '空队', athleteCount: 0 },
  ] }));
  const mocks = {
    '../../services/api': { teamTrainingStats, overviewTeams: teams },
    '../../data/register-data': { sportRules: { ROWING: { activities: ['on_water'] } } },
    '../../utils/project-label': { projectLabel: (project) => project }, './view': view,
  };
  let definition;
  vm.runInNewContext(readFileSync(new URL('./index.js', import.meta.url), 'utf8'), {
    Component(value) { definition = value; }, require: (path) => mocks[path],
  });
  const component = {
    ...definition.methods, data: structuredClone(definition.data),
    setData(values) { Object.assign(this.data, values); },
  };
  return { component, teamTrainingStats, teams };
}

it('接收实际导入项目、空队和日期，月和年选择发送完整日期', async () => {
  const { component, teamTrainingStats, teams } = setup();
  await component.applyScope({ project: 'ROWING', teamId: 2, date: '2024-02-29', open: true });
  expect(teams).toHaveBeenCalledWith('ROWING');
  expect(component.data.teamName).toBe('空队');
  expect(teamTrainingStats).toHaveBeenLastCalledWith('ROWING', 2, 'week', '2024-02-29');
  await component.onPeriodChange({ currentTarget: { dataset: { period: 'month' } } });
  await component.onDateChange({ detail: { value: '2024-03' } });
  expect(teamTrainingStats).toHaveBeenLastCalledWith('ROWING', 2, 'month', '2024-03-01');
  await component.onPeriodChange({ currentTarget: { dataset: { period: 'year' } } });
  await component.onDateChange({ detail: { value: '2025-04-08' } });
  expect(teamTrainingStats).toHaveBeenLastCalledWith('ROWING', 2, 'year', '2025-01-01');
});

it('闰年 2 月保留完整日期桶，缺失和零值分别展示', () => {
  const source = stats(29);
  source.buckets[0].minutes = 0;
  source.buckets[28].minutes = 60;
  source.totals.minutes = 60;
  source.details = [{ category: '耐力', unit: 'min', total: 60, values: { '2024-02-01': 0, '2024-02-29': 60 } }];
  source.waterProject = true;
  source.lessonRatio = [{ name: '辅课', value: 60, percentage: 100 }];
  source.waterRatio = [{ name: '陆上', value: 60, percentage: 100 }];
  const result = view.buildView(source, 'month');
  expect(result.volumes[0].points).toHaveLength(29);
  expect(result.volumes[0].points[0]).toMatchObject({ value: '0', zero: true, missing: false });
  expect(result.volumes[0].points[1]).toMatchObject({ value: '—', zero: false, missing: true });
  expect(result.volumes.map(({ total }) => total)).toEqual(['60', '—']);
  expect(result.ratios.map(({ rows }) => rows[0].name)).toEqual(['辅课', '陆上']);
  const detail = view.buildDetails(source, 'month', false, 0);
  expect(detail.pageCount).toBe(5);
  expect(detail.rows[0].cells.slice(0, 2).map(({ text }) => text)).toEqual(['0', '—']);
  expect(view.buildDetails(source, 'month', false, 4).rows[0].cells[0].text).toBe('60');
});

it('仅有原始单位也可显示，年度总量和其他单位原值分别处理', () => {
  const source = stats(12, {
    buckets: Array.from({ length: 12 }, (_, index) => ({
      start: `2024-${String(index + 1).padStart(2, '0')}-01`, minutes: null, distance: null, water: index === 0 ? 0 : null,
    })),
    details: [{ category: '负重', unit: 'kg', total: null, values: { '2024-02-01': 20, '2024-02-02': 15 } }],
  });
  const result = view.buildView(source, 'year');
  expect(result.hasData).toBe(true);
  expect(result.hasTotals).toBe(false);
  expect(result.volumes[0].points).toHaveLength(12);
  expect(view.buildDetails(source, 'year', true, 0).rows[0].cells.map(({ text }) => text)).toEqual(['20', '15']);
});

it('切换项目时旧响应不能覆盖新结果，越范围的导入队伍不发统计请求', async () => {
  const { component, teamTrainingStats } = setup();
  let resolve;
  teamTrainingStats.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
  const pending = component.applyScope({ project: 'ROWING', teamId: 2 });
  await vi.waitFor(() => expect(teamTrainingStats).toHaveBeenCalledTimes(1));
  await component.applyScope({ project: 'CYCLING_ROAD', teamId: 1 });
  resolve(stats(29));
  await pending;
  expect(component.data.teamName).toBe('公路队');
  expect(component.data.view.end).toBe('2024-02-07');
  await component.applyScope({ project: 'ROWING', teamId: 999, open: true });
  expect(component.data.view).toBeNull();
  expect(component.data.error).toContain('不在可查看范围');
  expect(teamTrainingStats).toHaveBeenCalledTimes(2);
});


it('训练量保留所有柱位，月末标签不挤在一起，刻度按指标独立计算', () => {
  const source = stats(31);
  source.buckets = source.buckets.map((bucket) => ({ ...bucket, start: bucket.start.replace('2024-02', '2024-03') }));
  source.end = '2024-03-31';
  source.buckets[0].minutes = 80;
  source.buckets[0].distance = 3;
  source.totals = { minutes: 80, distance: 3 };
  const [duration, distance] = view.buildView(source, 'month').volumes;
  expect(duration.points).toHaveLength(31);
  expect(distance.points.map(({ date }) => date)).toEqual(duration.points.map(({ date }) => date));
  expect(duration.points.map(({ label }) => label).filter(Boolean)).toEqual(['1', '5', '10', '15', '20', '25', '31']);
  expect(duration.ticks.map(({ label }) => label)).toEqual(['100', '50', '0']);
  expect(distance.ticks.map(({ label }) => label)).toEqual(['5', '2.50', '0']);
  expect(duration.points[0].height).toBe(80);
  expect(distance.points[0].height).toBe(60);
});

it('点选柱位联动显示两项数值，切换周期后清除旧选中', async () => {
  const { component, teamTrainingStats } = setup();
  const source = stats();
  source.buckets[1].minutes = 0;
  source.totals.minutes = 0;
  teamTrainingStats.mockResolvedValue(source);
  await component.applyScope({ project: 'ROWING', teamId: 2 });
  component.onPoint({ currentTarget: { dataset: { index: 1 } } });
  expect(component.data.volumeIndex).toBe(1);
  expect(component.data.volumeSelection).toEqual({ date: '2024-02-02', minutes: '0', distance: '—' });
  await component.onPeriodChange({ currentTarget: { dataset: { period: 'year' } } });
  expect(component.data.volumeIndex).toBe(-1);
  expect(component.data.volumeSelection).toBeNull();
});


it('水陆分项使用服务端组内占比，明细按归属分组', () => {
  const source = stats(7, {
    waterProject: true,
    totals: { minutes: 90, distance: null },
    timeAnalysis: [{ title: '水上训练时间分析', total: 60, points: [{ name: '测功仪', value: 60, percentage: 100 }] }],
    details: [
      { category: '大力量', unit: 'min', total: 30, values: {}, waterGroup: 'land' },
      { category: '测功仪', unit: 'min', total: 60, values: {}, waterGroup: 'water' },
      { category: '未知分项', unit: 'min', total: 0, values: {}, waterGroup: null },
    ],
  });
  source.waterRatio = [{ name: '水上', value: 60, percentage: 2 / 3 * 100 }, { name: '陆上', value: 30, percentage: 1 / 3 * 100 }];
  const dashboard = view.buildView(source, 'week');
  expect(dashboard.summary.map(({ total }) => total)).toEqual(['90', '—', '60', '30']);
  expect(dashboard.timeAnalysis[0].rows[0].share).toBe('100%');
  expect(dashboard.timeAnalysis[0].background).toContain(dashboard.timeAnalysis[0].rows[0].color);
  expect(view.buildDetails(source, 'week', false, 0).rows.map(({ group }) => group)).toEqual(['水上', '陆上', '未分类']);
});
