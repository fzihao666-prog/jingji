import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

const teams = [{ id: 10, project: 'ROWING', name: 'A队' }, { id: 11, project: 'ROWING', name: 'B队' }, { id: 20, project: 'CANOE', name: 'C队' }];
function createPage(overrides = {}, options = {}) {
  let definition;
  const app = { globalData: { dataVersion: 1 }, setProject: vi.fn() };
  const wx = { enableAlertBeforeUnload: vi.fn(), disableAlertBeforeUnload: vi.fn(), navigateBack: vi.fn(), switchTab: vi.fn(), showToast: vi.fn() };
  const api = {
    me: vi.fn(async () => ({ user: { role: 'SCC' } })),
    athleteCreateOptions: vi.fn(async () => ({ teams, areas: [] })),
    createAthlete: vi.fn(async () => ({ id: 100, accountId: null })), ...overrides,
  };
  const payloadModule = { exports: {} };
  vm.runInNewContext(readFileSync(new URL('../../utils/profile-payload.js', import.meta.url), 'utf8'), { module: payloadModule });
  vm.runInNewContext(readFileSync(new URL('./athlete-create.js', import.meta.url), 'utf8'), {
    Page: (value) => { definition = value; }, wx, getApp: () => app,
    require: (path) => path.includes('services/api') ? api : path.includes('profile-payload') ? payloadModule.exports
      : path.includes('project-label') ? { projectOptions: (codes) => codes.map((code) => ({ code, label: code })) } : { todayBeijing: () => '2026-10-19' },
  });
  const page = { ...definition, data: JSON.parse(JSON.stringify(definition.data)),
    setData(patch) { Object.assign(this.data, patch); },
    _preferred: options,
  };
  return { page, api, app, wx };
}
const input = (page, field, value) => page.input({ currentTarget: { dataset: { field } }, detail: { value } });

describe('独立添加运动员页面', () => {
  it('只使用权限接口返回的项目和队伍，忽略越权预选参数', async () => {
    const { page } = createPage({}, { project: 'UNKNOWN', teamId: 999 });
    await page.loadPage();
    expect(page.data.project).toBe('ROWING');
    expect(page.data.teamId).toBe(0);
    expect(page.data.teamItems.map((team) => team.id)).toEqual([0, 10, 11]);
    page.projectChange({ detail: { value: 1 } });
    expect(page.data.teamItems.map((team) => team.id)).toEqual([0, 20]);
    expect(page.data.teamId).toBe(20);
  });
  it('当前项目和队伍在权限内时预选，切换项目清除旧队伍', async () => {
    const { page } = createPage({}, { project: 'ROWING', teamId: 11 });
    await page.loadPage();
    expect(page.data.teamId).toBe(11);
    page.projectChange({ detail: { value: 1 } });
    page.projectChange({ detail: { value: 0 } });
    expect(page.data.teamId).toBe(0);
  });
  it('无创建角色不请求创建范围，也不能保存', async () => {
    const { page, api } = createPage({ me: async () => ({ user: { role: 'ATL' } }) });
    await page.loadPage(); await page.save();
    expect(page.data.allowed).toBe(false);
    expect(api.athleteCreateOptions).not.toHaveBeenCalled();
    expect(api.createAthlete).not.toHaveBeenCalled();
    expect(page.data.error).toContain('无权');
  });
  it('无队伍与加载失败均提供明确状态', async () => {
    for (const request of [async () => ({ teams: [] }), async () => { throw new Error('网络不可用'); }]) {
      const { page } = createPage({ athleteCreateOptions: request });
      await page.loadPage();
      expect(page.data.loading).toBe(false); expect(page.data.allowed).toBe(false);
      expect(page.data.error.length).toBeGreaterThan(0);
    }
  });
  it('姓名和队伍缺失在对应字段提示，性别日期不额外强制', async () => {
    const { page, api } = createPage();
    await page.loadPage(); await page.save();
    expect(page.data.fieldErrors.name).toBeTruthy(); expect(page.data.fieldErrors.team).toBeTruthy();
    expect(api.createAthlete).not.toHaveBeenCalled();
    input(page, 'name', '新建队员');
    page.teamChange({ detail: { value: 1 } });
    await page.save();
    expect(api.createAthlete).toHaveBeenCalledWith(expect.objectContaining({ gender: '', birthDate: '', createAccount: false }));
  });
  it('创建成功刷新并选中新档案，不生成凭据，禁止重复提交', async () => {
    let finish;
    const { page, api, app, wx } = createPage({ createAthlete: vi.fn(() => new Promise((resolve) => { finish = resolve; })) }, { project: 'ROWING', teamId: 10 });
    await page.loadPage(); input(page, 'name', ' 新建队员 '); input(page, 'notes', '说明');
    expect(wx.enableAlertBeforeUnload).toHaveBeenCalled();
    const saving = page.save(); await page.save();
    expect(page.data.saving).toBe(true); expect(api.createAthlete).toHaveBeenCalledTimes(1);
    finish({ id: 100 }); await saving;
    expect(api.createAthlete.mock.calls[0][0]).toEqual({ name: '新建队员', notes: '说明', project: 'ROWING', team: 'A队', gender: '', birthDate: '', createAccount: false });
    expect(app.globalData).toMatchObject({ selectedAthleteId: 100, pendingProject: 'ROWING', dataVersion: 2 });
    expect(app.setProject).toHaveBeenCalledWith('ROWING');
    expect(wx.disableAlertBeforeUnload).toHaveBeenCalled(); expect(wx.navigateBack).toHaveBeenCalled();
    await page.save(); expect(api.createAthlete).toHaveBeenCalledTimes(1);
  });
  it('失败保留表单与退出提醒，可再次提交', async () => {
    const { page, api, wx } = createPage({ createAthlete: vi.fn(async () => { throw new Error('该队伍中已存在同名运动员'); }) }, { project: 'ROWING', teamId: 10 });
    await page.loadPage(); input(page, 'name', '新建队员'); input(page, 'notes', '说明');
    await page.save();
    expect(page.data).toMatchObject({ name: '新建队员', notes: '说明', saving: false, saved: false });
    expect(page.data.error).toContain('同名'); expect(wx.disableAlertBeforeUnload).not.toHaveBeenCalled();
    await page.save(); expect(api.createAthlete).toHaveBeenCalledTimes(2);
  });
  it('区域管理者选择授权行政归属，保存进入原有行政查询范围', async () => {
    const { page, api } = createPage({ me: async () => ({ user: { role: 'REG' } }),
      athleteCreateOptions: async () => ({ teams, areas: [{ areaLevel: 'province', province: '四川', city: '', county: '' }] }) }, { project: 'ROWING', teamId: 10 });
    await page.loadPage(); input(page, 'name', '新建队员'); await page.save();
    expect(page.data.fieldErrors.area).toBeTruthy();
    page.areaChange({ detail: { value: 1 } }); await page.save();
    expect(api.createAthlete).toHaveBeenCalledWith(expect.objectContaining({ region: '四川', city: '', county: '' }));
  });
  it('日期格式验证和页面注册，表单不包含证件及账号字段', async () => {
    const { page, api } = createPage({}, { project: 'ROWING', teamId: 10 });
    await page.loadPage(); input(page, 'name', '新建队员'); page.birthDateChange({ detail: { value: '2026-02-30' } }); await page.save();
    expect(page.data.fieldErrors.birthDate).toBeTruthy(); expect(api.createAthlete).not.toHaveBeenCalled();
    const template = readFileSync(new URL('./athlete-create.wxml', import.meta.url), 'utf8');
    expect(template).not.toMatch(/身份证|identityCard|password|username/);
    expect(template).toContain('mode="date"');
    expect(JSON.parse(readFileSync(new URL('../../app.json', import.meta.url), 'utf8')).pages).toContain('pages/athlete-create/athlete-create');
  });
});
