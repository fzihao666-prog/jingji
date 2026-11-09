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
    '../../services/api': { teamTrainingStats }, '../../services/data-import': { teams },
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
  return { component, teamTrainingStats };
}

it('接收实际导入项目、空队和日期，月和年选择发送完整日期', async () => {
  const { component, teamTrainingStats } = setup();
  await component.applyScope({ project: 'ROWING', teamId: 2, date: '2024-02-29', open: true });
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
