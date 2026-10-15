import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

function createPage(name, api = {}) {
  let definition;
  const app = { globalData: { athletes: [] } };
  const mocks = { '../../services/api': api };
  function load(url) {
    const module = { exports: {} };
    vm.runInNewContext(readFileSync(url, 'utf8'), {
      module, require: (path) => load(new URL(`${path}.js`, url)),
    });
    return module.exports;
  }
  const url = new URL(`../pages/${name}/${name}.js`, import.meta.url);
  vm.runInNewContext(readFileSync(url, 'utf8'), {
    Page: (value) => { definition = value; },
    require: (path) => mocks[path] || load(new URL(`${path}.js`, url)),
    getApp: () => app, wx: {},
  });
  return { ...definition, data: JSON.parse(JSON.stringify(definition.data)), setData(values) { Object.assign(this.data, values); } };
}
const scope = { selectedAthleteId: 1, athletes: [{ id: 1, name: '测试运动员' }], from: '2026-10-01', to: '2026-10-10', project: 'rowing', teamId: 0 };
const fail = () => Promise.reject(new Error('加载失败，请重试'));

describe('公共运动员模块与训练页选择联动', () => {
  it.each(['strength', 'special'])('%s 仅选择当前名单成员，刷新正确对象且重复选择不请求', async (name) => {
    const page = createPage(name);
    const field = name === 'special' ? 'viewAthleteId' : 'selectedAthleteId';
    page.data = { ...page.data, ...scope, athleteItems: scope.athletes, [field]: 0 };
    page._guard = { next: () => 1, isLatest: () => true };
    const requested = [];
    page.loadPageData = async (current) => { requested.push(current[field]); return {}; };
    await page.onAthleteSelect({ detail: { id: 99 } });
    expect(requested).toEqual([]);
    expect(page.data[field]).toBe(0);
    await page.onAthleteSelect({ detail: { id: 1 } });
    expect(page.data[field]).toBe(1);
    expect(requested).toEqual([1]);
    await page.onAthleteSelect({ detail: { id: 1 } });
    expect(requested).toEqual([1]);
    if (name === 'special') {
      await page.onBackToTeam();
      expect(page.data.viewAthleteId).toBe(0);
      expect(requested).toEqual([1, 0]);
    }
  });
});

describe('训练页空数据与独立失败回归', () => {
  it.each(['strength', 'special'])('%s 首屏保留核心指标和人员分页模型', (name) => {
    const page = createPage(name);
    expect(page.data.metrics.length).toBeGreaterThan(0);
    expect(page.data.metrics.every((row) => row.value === '--')).toBe(true);
    expect(page.data.trend).toEqual([]);
    if (name === 'strength') expect(page.data.athletePager.total).toBe(0);
  });
  it('体能切换到无人员范围清空历史事实，仍保留指标', async () => {
    const page = createPage('strength');
    page._source = { sessions: [{ id: 1 }] };
    const view = await page.loadPageData({ ...scope, selectedAthleteId: 0, athletes: [] }, () => true);
    expect(page._source).toBeNull();
    expect(view.metrics.length).toBeGreaterThan(0);
    expect(view.records).toEqual([]);
    expect(view.athletePager).toMatchObject({ total: 0, hasPrev: false, hasNext: false });
    expect(view.summaryCards.every((row) => row.value === '--')).toBe(true);
  });
  it('体能测试和计划失败不丢失训练零值', async () => {
    const page = createPage('strength', {
      strengthTests: fail, trainingPlans: fail,
      strengthTrainingResults: async () => ({ sessions: [{ trainingDate: '2026-10-05', durationMin: 0, srpe: null, sets: [] }] }),
    });
    const view = await page.loadPageData(scope, () => true);
    expect(view.testError).toContain('加载失败');
    expect(view.planError).toContain('加载失败');
    expect(view.trend[0]).toMatchObject({ durationText: '0', loadText: '--', durationHeight: 0 });
    expect(view.summaryCards[1].value).toBe('0');
    expect(view.metrics.every((row) => row.value === '--')).toBe(true);
  });
  it('专项冠军和测试失败不影响训练与超30人名单', async () => {
    const athletes = Array.from({ length: 32 }, (_, i) => ({ id: i + 1, name: `运动员${i + 1}` }));
    const page = createPage('special', {
      overviewTeams: async () => ({ teams: [] }), specialChampionModels: fail, specialTests: fail,
      specialTrainingOverview: async () => ({ training: { summary: { durationMin: 0, distanceKm: null, load: 0, sessionCount: 1 }, days: [{ date: '2026-10-05', durationMin: 0, distanceKm: null }] }, athletes }),
    });
    const view = await page.loadPageData(scope, true, () => true);
    expect(view.metrics.slice(0, 4).map((row) => row.value)).toEqual(['0', '--', '1', '0']);
    expect(view.trend).toHaveLength(1);
    expect(view.trend[0]).toMatchObject({ duration: 0, distance: null, durationHeight: 0 });
    expect(view.championError).toContain('加载失败');
    expect(view.testError).toContain('加载失败');
    // 人员模块交给 athlete-selector：全量条目 + 汇总分页模型（每页 5 人由组件切片）。
    expect(view.athleteItems).toHaveLength(32);
    expect(view.athleteItems[0].sessionCount).toBe('--');
    expect(view.athleteItems[0].summary[0]).toContain('课次');
    expect(view.athletePager).toMatchObject({ total: 32, pageCount: 7, hasNext: true });
  });
  it('专项全接口失败仍有指标、分类和错误状态，旧请求不覆盖新筛选', async () => {
    const page = createPage('special', { overviewTeams: fail, specialChampionModels: fail, specialTests: fail, specialTrainingOverview: fail });
    const view = await page.loadPageData(scope, true, () => true);
    expect(view.metrics.length).toBe(5);
    expect(view.intensity).toHaveLength(7);
    expect(view.content).toHaveLength(9);
    expect(view.trend).toEqual([]);
    expect(view.trainingError).toContain('加载失败');
    expect(await page.loadPageData(scope, true, () => false)).toBeNull();
  });
  it('专项仅重载队伍训练不清空已加载测试，换项目清空', () => {
    const page = createPage('special');
    page.data.specialTests = [{ id: 1 }];
    page._specialTestsAll = [{ id: 1 }];
    page.resetTrainingView(false);
    expect(page.data.specialTests).toHaveLength(1);
    page.resetTrainingView();
    expect(page.data.specialTests).toEqual([]);
    expect(page._specialTestsAll).toEqual([]);
  });
});

describe('档案与训练总览空数据', () => {
  it('无运动员时档案保留资料、测试、恢复、身体成分和两个雷达分组', async () => {
    const page = createPage('profile');
    const view = await page.loadPageData({ ...scope, selectedAthleteId: 0, athletes: [] });
    expect(view.primaryCells).toHaveLength(8);
    expect(view.trainingSummary).toHaveLength(4);
    expect(view.trainingSummary.every((row) => row.value === '--')).toBe(true);
    expect(view.testMetrics.length).toBeGreaterThan(0);
    expect(view.bodyCompositionSummary.core).toHaveLength(3);
    expect(view.comparisonView.metrics).toHaveLength(3);
    expect(view.wellnessTrend.metrics.length).toBeGreaterThan(0);
    expect(view.radarGroups).toHaveLength(2);
    expect(view.radarGroups.every((group) => !group.hasChart)).toBe(true);
  });
  it('档案可独立显示训练统计零值与恢复加载失败', async () => {
    const page = createPage('profile', {
      injuryRecords: async () => ({ records: [] }),
      personalOverview: async () => ({ overview: { meta: { sessionCount: 0, coverage: null, testCount: 0 }, strengthTests: [] } }),
      championBenchmark: fail, painTrend: fail, wellnessTrends: fail, getBodyCompositionHistory: fail, profileComparison: fail, radarModels: fail,
    });
    const view = await page.loadPageData(scope);
    expect(view.trainingSummary[0].value).toBe('0');
    expect(view.trainingSummary[1].value).toBe('--');
    expect(view.wellnessError).toContain('加载失败');
    expect(view.benchmarkError).toContain('加载失败');
    expect(view.radarGroups).toHaveLength(2);
    expect(view.primaryCells).toHaveLength(8);
  });
  it('总览首屏固定生成核心卡片、分类和空人员分页', () => {
    const page = createPage('index');
    expect(page.data.metrics).toHaveLength(6);
    expect(page.data.metrics.every((row) => row.value === '--')).toBe(true);
    expect(page.data.structure).toHaveLength(3);
    expect(page.data.teamView.teamPager).toMatchObject({ total: 0, hasNext: false });
  });
  it('总览缺失值不补零，合法零负荷与零RPE保留', async () => {
    const page = createPage('index', { overview: async () => ({ overview: {
      trainingAnalytics: { summary: { totalDurationMin: 0, specialDurationMin: null }, days: [{ date: '2026-10-05', physicalLoad: 0, averageRpe: 0 }] },
      trainingLoadRatio: { totalLoad: 0, specialLoad: 0, physicalLoad: null, recoveryLoad: 0 },
    } }) });
    const view = await page.loadPageData(scope);
    expect(view.metrics[0].value).toBe('0');
    expect(view.metrics[1].value).toBe('--');
    expect(view.structure[0].loadText).toBe('0');
    expect(view.structure[1].loadText).toBe('--');
    expect(view.trendPlaceholder).toBe(false);
    expect(view.rpePlaceholder).toBe(false);
    expect(view.rpeDays.find((day) => day.date === '2026-10-05').mean).toBe(0);
  });
  it('总览主接口失败仍提供固定卡片和错误，队均失败不丢失个人数据', async () => {
    const page = createPage('index', { overview: fail, personalOverview: async () => ({ overview: { trainingAnalytics: { summary: { totalDurationMin: 60 } } } }) });
    let view = await page.loadPageData(scope);
    expect(view.metrics).toHaveLength(6);
    expect(view.overviewError).toContain('加载失败');
    page.data.canViewTodos = true;
    page.data.teams = [];
    page._teamsProject = scope.project;
    page.data.selectedAthleteId = 1;
    view = await page.loadPageData(scope);
    expect(view.metrics[0].value).toBe('1');
    expect(view.comparisonError).toContain('加载失败');
  });
});

describe('教练首页晨检概览与未填报口径', () => {
  const overview = {
    date: '2026-10-15',
    athletes: [
      { athleteId: 1, athleteName: '运动员A', team: '一队', hasTraining: true, wellnessReported: true, sleepHours: 7.5, morningPulse: 54, fatigueIndex: 3 },
      { athleteId: 2, athleteName: '运动员B', team: '一队', hasTraining: false, wellnessReported: true, sleepHours: 6.2, morningPulse: 61, fatigueIndex: 6 },
      { athleteId: 3, athleteName: '运动员C', team: '二队', hasTraining: true, wellnessReported: false, sleepHours: null, morningPulse: null, fatigueIndex: null },
      { athleteId: 4, athleteName: '运动员D', team: '二队', hasTraining: false, wellnessReported: true, sleepHours: 0, morningPulse: 0, fatigueIndex: 0 },
    ],
  };

  it('晨检人数与名单同源于晨检标记，训练情况按训练记录单独统计', () => {
    const page = createPage('index');
    const views = page.buildMorningViews(overview, [], 0);
    expect(views.morningView.counts).toEqual({ total: 4, reported: 3, missing: 1 });
    expect(views.morningView.rows.items).toHaveLength(4);
    expect(views.morningView.rows.items[0]).toMatchObject({ sleepText: '7.5h', pulseText: '54', fatigueText: '3' });
    expect(views.morningView.rows.items[2]).toMatchObject({ reported: false, sleepText: '--', pulseText: '--', fatigueText: '--' });
    expect(views.morningView.rows.items[3]).toMatchObject({ sleepText: '0h', pulseText: '0', fatigueText: '0' });
    expect(views.morningTraining).toEqual({ total: 4, trained: 2, noTraining: 2 });
  });

  it('队伍筛选后晨检人数和名单同步更新，保持同一口径', () => {
    const page = createPage('index');
    page.data.teams = [{ id: 1, name: '一队' }];
    const views = page.buildMorningViews(overview, page.data.teams, 1);
    expect(views.morningView.counts).toEqual({ total: 2, reported: 2, missing: 0 });
    expect(views.morningView.rows.items.map((row) => row.athleteId)).toEqual([1, 2]);
    expect(views.morningTraining).toEqual({ total: 2, trained: 1, noTraining: 1 });
  });

  it('仅看未填报筛选后回到第一页，翻页每页最多 5 人', () => {
    const page = createPage('index');
    page.data.teamOverview = overview;
    page.data.todoPagerPages = { team: 2, focus: 1, morning: 1 };
    page.onMorningFilterChange({ currentTarget: { dataset: { filter: 'missing' } } });
    expect(page.data.morningFilter).toBe('missing');
    expect(page.data.todoPagerPages.morning).toBe(0);
    expect(page.data.morningView.rows.items.map((row) => row.athleteId)).toEqual([3]);
    expect(page.data.morningView.listEmpty).toBe(false);
    page.onMorningFilterChange({ currentTarget: { dataset: { filter: 'all' } } });
    page.data.todoPagerPages = { ...page.data.todoPagerPages, morning: 0 };
    const many = { athletes: Array.from({ length: 6 }, (_, index) => ({ athleteId: index + 1, athleteName: `队员${index + 1}`, team: '', hasTraining: false, wellnessReported: false, sleepHours: null, morningPulse: null, fatigueIndex: null })) };
    page.data.teamOverview = many;
    page.onPagerChange({ currentTarget: { dataset: { key: 'morning' } }, detail: { page: 1 } });
    expect(page.data.morningView.rows.items).toHaveLength(1);
    expect(page.data.morningView.rows).toMatchObject({ page: 1, pageCount: 2, total: 6 });
  });

  it('队伍切换与焦点待办沿用晨检口径，训练缺失只写暂无训练记录', async () => {
    const page = createPage('index');
    page.data.canViewTodos = true;
    page.data.teamOverview = overview;
    page.data.teams = [{ id: 1, name: '一队' }, { id: 2, name: '二队' }];
    page.data.teamId = 0;
    page._guard = { next: () => 1, isLatest: () => true };
    page.loadPageData = async () => null;
    await page.onOverviewTeamChange({ detail: { value: 2 } });
    expect(page.data.morningView.counts).toEqual({ total: 2, reported: 1, missing: 1 });
    expect(page.data.morningTraining).toEqual({ total: 2, trained: 1, noTraining: 1 });
    const focus = page.buildFocusRows({
      followedUp: [],
      missing: [{ athleteId: 1, athleteName: '运动员A', team: '一队', project: 'rowing' }],
      attention: [], reviewDue: [], incompleteTime: [],
    }, 0, [], 0);
    expect(focus.items[0].focusLabel).toBe('暂无训练记录');
    expect(focus.items[0].focusReason).toBe('今日暂无有效训练记录');
    const teamView = page.buildTeamView(overview, [], 0);
    expect(teamView.athletes[0].tags.map((tag) => tag.text)).toEqual(['有训练记录', '晨检已填']);
    expect(teamView.athletes[2].tags.map((tag) => tag.text)).toEqual(['有训练记录', '晨检未填']);
  });
});
