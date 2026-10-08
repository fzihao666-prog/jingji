import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

const appJson = JSON.parse(readFileSync(new URL('../../app.json', import.meta.url), 'utf8'));
const apiSource = readFileSync(new URL('../../services/api.js', import.meta.url), 'utf8');
const apiFlat = apiSource.replace(/\s+/g, ' ');
const indexTemplate = readFileSync(new URL('../index/index.wxml', import.meta.url), 'utf8');
const indexSource = readFileSync(new URL('../index/index.js', import.meta.url), 'utf8');
const profileTemplate = readFileSync(new URL('../profile/profile.wxml', import.meta.url), 'utf8');
const profileSource = readFileSync(new URL('../profile/profile.js', import.meta.url), 'utf8');
const pageSource = readFileSync(new URL('./injury-report.js', import.meta.url), 'utf8');
const pageTemplate = readFileSync(new URL('./injury-report.wxml', import.meta.url), 'utf8');

function loadCjs(url, mocks) {
  const module = { exports: {} };
  vm.runInNewContext(readFileSync(url, 'utf8'), {
    module,
    exports: module.exports,
    require(path) {
      if (Object.prototype.hasOwnProperty.call(mocks, path)) return mocks[path];
      throw new Error(`未预期的依赖：${path}`);
    },
    Date,
    Number,
    String,
    Boolean,
    Array,
    Object,
    Error,
    RegExp,
    Math,
  });
  return module.exports;
}

const injuryForm = loadCjs(new URL('../../utils/injury-form.js', import.meta.url), {
  './date': { todayBeijing: () => '2026-09-27' },
});
const requestGuard = loadCjs(new URL('../../utils/request-guard.js', import.meta.url), {});
const formDraft = loadCjs(new URL('../../utils/form-draft.js', import.meta.url), {});

function createOverviewPage(data = {}) {
  let definition;
  const dependencies = {
    '../../services/api': {},
    '../../utils/page-scope': {},
    '../../utils/request-guard': requestGuard,
    '../../utils/date': {},
    '../../utils/format': {},
    '../../utils/page-actions': {},
    '../../utils/daily-todos': {},
    '../../utils/pagination': loadCjs(new URL('../../utils/pagination.js', import.meta.url), {}),
    '../../utils/today-status': {},
    '../../utils/wellness-form': {},
  };
  vm.runInNewContext(indexSource, {
    Page(value) { definition = value; },
    require(path) {
      if (Object.prototype.hasOwnProperty.call(dependencies, path)) return dependencies[path];
      throw new Error(`未预期的依赖：${path}`);
    },
  });
  return {
    ...definition,
    data: { ...definition.data, ...data },
    setData(values) { Object.assign(this.data, values); },
  };
}

function createPage({ user, athletes, targetAthleteId }) {
  let definition;
  const createInjuryRecord = vi.fn(async () => ({ record: { id: 1 } }));
  const context = {
    user,
    projectAthletes: athletes,
    athletes,
    project: 'ROWING',
    projects: ['ROWING'],
    selectedAthleteId: targetAthleteId,
  };
  const toasts = [];
  const app = { globalData: { dataVersion: 3, homeNeedsRefresh: false } };
  const pageMocks = {
    '../../services/api': { createInjuryRecord },
    '../../utils/context': { loadContext: async () => context },
    '../../utils/injury-form': injuryForm,
    '../../utils/request-guard': requestGuard,
    '../../utils/form-draft': formDraft,
    '../../utils/project-label': { projectLabel: (project) => project === 'ROWING' ? '赛艇' : project },
  };
  vm.runInNewContext(pageSource, {
    Page(value) {
      definition = value;
    },
    require(path) {
      if (Object.prototype.hasOwnProperty.call(pageMocks, path)) return pageMocks[path];
      throw new Error(`未预期的依赖：${path}`);
    },
    getApp: () => app,
    setTimeout() {
      return 0;
    },
    wx: {
      showToast(options) {
        toasts.push(options.title);
      },
      navigateBack() {},
      reLaunch() {},
    },
    Date,
    Number,
    String,
    Boolean,
    Array,
    Object,
    Error,
    RegExp,
    Math,
  });
  const page = {
    ...definition,
    data: { ...definition.data },
    setData(values) {
      Object.assign(this.data, values);
    },
  };
  page._targetAthleteId = targetAthleteId;
  return { page, createInjuryRecord, toasts, app };
}

const managerUser = { role: 'SCC', athleteId: 0 };
const athletes = [{ id: 7, name: '样例队员', project: 'ROWING', team: '一队' }];

describe('伤病与疼痛上报入口', () => {
  it('已注册路由并由档案页进入', () => {
    expect(appJson.pages).toContain('pages/injury-report/injury-report');
    expect(profileTemplate).toContain('bindtap="reportInjury"');
    expect(profileTemplate).toContain('提交疼痛反馈');
    expect(profileSource).toContain(
      'wx.navigateTo({ url: `/pages/injury-report/injury-report?athleteId=${athleteId}` })'
    );
    expect(apiFlat).toContain('createInjuryRecord(athleteId, data)');
    expect(apiFlat).toContain(
      "return request(`/api/athletes/${encodeURIComponent(athleteId)}/injuries`, { method: 'POST', data });"
    );
  });

  it('首页重点人员合并同人多类待办并隔离队伍和已跟进人员', () => {
    const person = { athleteId: 7, athleteName: '样例队员', team: '一队' };
    const page = createOverviewPage();
    const result = page.buildFocusRows({
      missing: [person, { athleteId: 8, team: '二队' }, { athleteId: 9, team: '一队' }],
      attention: [{ ...person, reason: '恢复不足' }],
      reviewDue: [{ ...person, dueLabel: '今日复查', injuryName: '肩部不适' }],
      incompleteTime: [person],
      followedUp: [9],
    }, 0, [{ id: 1, name: '一队' }], 1);
    expect(result.total).toBe(1);
    expect(result.items).toEqual([expect.objectContaining({
      athleteId: 7,
      focusLabels: ['未填报', '状态关注', '复查提醒', '时间待补'],
      focusReason: '今日暂无有效训练记录；恢复不足；今日复查 · 肩部不适；训练记录缺少有效开训时间',
    })]);
    expect(indexTemplate).toContain('wx:for="{{focusRows}}"');
  });

  it('首页重点人员每页最多五人且末页不补假数据', () => {
    const page = createOverviewPage({
      todos: { missing: [
        { athleteId: 1 }, { athleteId: 2 }, { athleteId: 3 },
        { athleteId: 4 }, { athleteId: 5 }, { athleteId: 6 },
      ] },
    });
    const first = page.buildFocusRows(page.data.todos, 0, [], 0);
    expect(first.items.map((item) => item.athleteId)).toEqual([1, 2, 3, 4, 5]);
    page.onPagerChange({ currentTarget: { dataset: { key: 'focus' } }, detail: { page: 1 } });
    expect(page.data.focusRows.map((item) => item.athleteId)).toEqual([6]);
    expect(page.data.focusPager).toMatchObject({ total: 6, page: 1, pageCount: 2, hasNext: false });
  });

  it('首页队伍名单按姓名搜索且不显示其他队伍的同名人员', () => {
    const page = createOverviewPage({
      teams: [{ id: 1, name: '一队' }],
      teamId: 1,
      teamOverview: { athletes: [
        { athleteId: 7, athleteName: '样例队员', team: '一队' },
        { athleteId: 8, athleteName: '其他队员', team: '一队' },
        { athleteId: 9, athleteName: '样例队员', team: '二队' },
      ] },
      todoPagerPages: { team: 1, focus: 0 },
    });
    page.onTeamKeyword({ detail: { value: '样例' } });
    expect(page.data.teamView.athletes).toEqual([
      { athleteId: 7, athleteName: '样例队员', team: '一队' },
    ]);
    expect(page.data.teamView.teamPager).toMatchObject({ total: 1, page: 0 });
    expect(page.data.todoPagerPages.team).toBe(0);
    page.onTeamKeyword({ detail: { value: '不存在' } });
    expect(page.data.teamView.athletes).toEqual([]);
    expect(indexTemplate).toContain('bindinput="onTeamKeyword"');
  });

  it('表单页与服务端字段一一对应且按角色切换文案', () => {
    expect(pageTemplate).toContain('bindtap="save"');
    expect(pageTemplate).toContain('data-field="onsetDate"');
    expect(pageSource).toContain('MANAGER_ROLES');
    expect(pageSource).toContain("context.user.role === 'ATL'");
    expect(pageSource).toContain('只能提交本人的疼痛反馈');
    expect(pageSource).toContain('buildInjuryPayload(this.payloadInput())');
  });
});

describe('伤病上报页面行为', () => {
  it('教练可以为权限内运动员保存正式记录并刷新缓存', async () => {
    const { page, createInjuryRecord, app } = createPage({
      user: managerUser,
      athletes,
      targetAthleteId: 7,
    });
    await page.loadPage();
    expect(page.data.isSelfFeedback).toBe(false);
    expect(page.data.athleteName).toBe('样例队员');
    page.setData({ injuryName: '右肩肩袖损伤', onsetDate: '2026-09-20' });
    await page.save();
    expect(createInjuryRecord).toHaveBeenCalledTimes(1);
    const [athleteId, payload] = createInjuryRecord.mock.calls[0];
    expect(athleteId).toBe(7);
    expect(payload.status).toBe('observation');
    expect(payload.painScore).toBe(3);
    expect(app.globalData.dataVersion).toBe(4);
    expect(app.globalData.homeNeedsRefresh).toBe(true);
  });

  it('校验失败时不发起请求', async () => {
    const { page, createInjuryRecord, toasts } = createPage({
      user: managerUser,
      athletes,
      targetAthleteId: 7,
    });
    await page.loadPage();
    page.setData({
      injuryName: '   ',
      onsetDate: '2026-09-20',
      bodyPartIndex: 14,
      bodyPartCustom: ' ',
    });
    await page.save();
    expect(createInjuryRecord).not.toHaveBeenCalled();
    expect(toasts).toContain('请填写伤病部位。');
  });

  it('运动员只能打开本人疼痛反馈', async () => {
    const roster = [...athletes, { id: 5, name: '本人', project: 'ROWING', team: '一队' }];
    const { page, createInjuryRecord } = createPage({
      user: { role: 'ATL', athleteId: 5 },
      athletes: roster,
      targetAthleteId: 7,
    });
    await page.loadPage();
    expect(page.data.loading).toBe(false);
    expect(page.data.error).toBe('运动员只能提交本人的疼痛反馈。');
    expect(page.data.isSelfFeedback).toBe(true);
    await page.save();
    expect(createInjuryRecord).not.toHaveBeenCalled();
  });

  it('运动员本人反馈可提交且不携带教练字段', async () => {
    const { page, createInjuryRecord } = createPage({
      user: { role: 'ATL', athleteId: 7 },
      athletes,
      targetAthleteId: 7,
    });
    await page.loadPage();
    expect(page.data.isSelfFeedback).toBe(true);
    page.setData({ injuryName: '划桨时右肩仍有酸痛', onsetDate: '2026-09-26', painIndex: 4 });
    await page.save();
    const payload = createInjuryRecord.mock.calls[0][1];
    expect(payload).not.toHaveProperty('status');
    expect(payload.painScore).toBe(4);
  });

  it('越权运动员编号无法进入表单', async () => {
    const { page, createInjuryRecord } = createPage({
      user: managerUser,
      athletes,
      targetAthleteId: 42,
    });
    await page.loadPage();
    expect(page.data.error).toBe('该运动员不在当前项目权限范围内。');
    await page.save();
    expect(createInjuryRecord).not.toHaveBeenCalled();
  });
});
