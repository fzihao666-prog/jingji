import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

function setup(role = 'OBS') {
  const user = { id: 9, role, displayName: '阅览者' };
  const teams = [
    { id: 1, name: '同名队', project: '赛艇', coaches: [{ id: 11, displayName: '教练甲' }] },
    { id: 2, name: '同名队', project: '皮划艇', coaches: [{ id: 12, displayName: '教练乙' }] }
  ];
  const athletes = [
    { id: 101, name: '甲', teamId: 1, project: '赛艇', headCoaches: '教练甲' },
    { id: 102, name: '乙', teamId: 2, project: '皮划艇', headCoaches: '教练乙' }
  ];
  const api = {
    me: vi.fn(async () => ({ user })), observerTeams: vi.fn(async () => ({ teams })),
    athletes: vi.fn(async () => ({ athletes })),
    overview: vi.fn(async () => ({ overview: { meta: { sessionCount: 0 }, trainingAnalytics: { summary: { totalDurationMin: 0 } } } })),
    teamPlans: vi.fn(async () => ({ plans: [{ id: 21, teamId: 1, status: 'draft', data: { sessions: [] } }, { id: 22, teamId: 2, status: 'published', data: { sessions: [] } }] })),
    athleteTrainingSessions: vi.fn(async () => ({ sessions: [{ id: 31, date: '2026-10-01', duration: 0, distance: null, rpe: 0 }] })),
    strengthTests: vi.fn(async () => ({ tests: [] })), specialTests: vi.fn(async () => ({ events: [] }))
  };
  const app = { globalData: { token: 'token', user }, setProject: vi.fn() };
  const wx = { reLaunch: vi.fn(), navigateTo: vi.fn() };
  const dependencies = {
    '../../services/api': api,
    '../../utils/date': { periodFor: () => ({ from: '2026-10-01', to: '2026-10-31' }) },
    '../../utils/training-empty': { metricValue: value => value == null ? '--' : String(value) },
    '../../utils/format': { strengthMetricRows: () => [] },
    '../../utils/special-test-view': { buildSpecialTestView: payload => ({ events: payload?.events || [] }) },
    '../../utils/project-label': { projectLabel: value => value },
    '../team-plans/model': { effectiveSessions: plan => plan.data.sessions }
  };
  let definition;
  vm.runInNewContext(readFileSync(new URL('./observer.js', import.meta.url), 'utf8'), {
    Page: value => { definition = value; }, require: path => dependencies[path], getApp: () => app, wx
  });
  const page = { ...definition, data: structuredClone(definition.data), setData(values) { Object.assign(this.data, values); } };
  return { page, api, wx, app };
}

describe('特邀观察员小程序阅览', () => {
  it('同名队伍按teamId隔离人员及计划，日期范围传给训练明细接口', async () => {
    const { page, api } = setup();
    await page.load();
    expect(page.data.athletes.map(athlete => athlete.id)).toEqual([101]);
    expect(page.data.plans.map(plan => plan.id)).toEqual([21]);
    expect(api.athleteTrainingSessions).toHaveBeenCalledWith(101, '2026-10-01', '2026-10-31');
    page.setData({ teamIndex: 1 });
    await page.loadTeam();
    expect(page.data.athletes.map(athlete => athlete.id)).toEqual([102]);
    expect(page.data.coaches[0].displayName).toBe('教练乙');
    expect(page.data.plans.map(plan => plan.id)).toEqual([22]);
  });

  it('真实0与缺失分别显示，不生成测量值', async () => {
    const { page } = setup();
    await page.load();
    expect(page.data.overview[0].value).toBe('0');
    expect(page.data.sessions[0].durationText).toBe('0');
    expect(page.data.sessions[0].distanceText).toBe('--');
    expect(page.data.sessions[0].rpeText).toBe('0');
  });

  it('无授权队伍时保留空状态且不请求训练数据', async () => {
    const { page, api } = setup();
    api.observerTeams.mockResolvedValue({ teams: [] });
    await page.load();
    expect(page.data.team).toBeNull();
    expect(page.data.sessions).toEqual([]);
    expect(api.overview).not.toHaveBeenCalled();
    expect(api.athleteTrainingSessions).not.toHaveBeenCalled();
  });

  it('非观察员访问专页会返回既有首页', async () => {
    const { page, api, wx } = setup('SCC');
    await page.load();
    expect(wx.reLaunch).toHaveBeenCalledWith({ url: '/pages/index/index' });
    expect(api.observerTeams).not.toHaveBeenCalled();
  });

  it('旧运动员请求晚返回时不会覆盖新队伍的数据', async () => {
    const { page, api } = setup();
    await page.load();
    let finish;
    api.athleteTrainingSessions.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const oldRequest = page.loadAthlete();
    page.setData({ teamIndex: 1 });
    await page.loadTeam();
    finish({ sessions: [{ id: 999, date: '2026-10-02' }] });
    await oldRequest;
    expect(page.data.athlete.id).toBe(102);
    expect(page.data.sessions.some(row => row.id === 999)).toBe(false);
  });
});
