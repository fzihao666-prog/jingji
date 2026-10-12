import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import { PROVINCES, PROVINCE_CITIES } from '../../../shared/regions.js';
import { PROJECT_DEFINITIONS as SHARED_PROJECTS } from '../../../shared/projects.js';

// 小程序 register-data.js 是 CJS；根 package.json 为 ESM，在测试中按 CJS 求值加载。
const registerDataUrl = new URL('../../data/register-data.js', import.meta.url);
const registerDataModule = { exports: {} };
new Function('module', 'exports', readFileSync(registerDataUrl, 'utf8'))(
  registerDataModule,
  registerDataModule.exports
);
const registerData = registerDataModule.exports;

const registerSource = readFileSync(new URL('./register.js', import.meta.url), 'utf8');
const registerTemplate = readFileSync(new URL('./register.wxml', import.meta.url), 'utf8');
const loginSource = readFileSync(new URL('../login/login.js', import.meta.url), 'utf8');
const loginTemplate = readFileSync(new URL('../login/login.wxml', import.meta.url), 'utf8');
const apiSource = readFileSync(new URL('../../services/api.js', import.meta.url), 'utf8');

describe('小程序注册静态数据', () => {
  it('项目字典与 shared/projects 完全一致', () => {
    const shared = SHARED_PROJECTS.map((item) => ({ code: item.code, label: item.nameZh }));
    expect(registerData.projects).toEqual(shared);
    expect(registerData.projects).toHaveLength(50);
  });

  it('省份与城市字典与 shared/regions 完全一致', () => {
    expect(registerData.provinces).toEqual([...PROVINCES]);
    expect(registerData.provinceCities).toEqual(PROVINCE_CITIES);
  });
});

describe('注册页流程', () => {
  it('复用网页端注册接口且标记为无需登录', () => {
    expect(apiSource).toContain("register(input) {");
    expect(apiSource).toContain("return request('/api/auth/register', { method: 'POST', auth: false, data: input });");
  });

  it('已注册路由并在登录页提供入口', () => {
    const appJson = JSON.parse(readFileSync(new URL('../../app.json', import.meta.url), 'utf8'));
    expect(appJson.pages).toContain('pages/register/register');
    expect(loginTemplate).toContain('bindtap="goRegister"');
    expect(loginSource).toContain("wx.navigateTo({ url: '/pages/register/register' })");
  });

  it('提交前校验密码一致与必填项', () => {
    expect(registerSource).toContain("if (password !== confirmPassword) return '两次输入的密码不一致。';");
    expect(registerSource).toContain("if (!/^1[3-9]\\d{9}$/.test(phone)) return '手机号须为11位大陆手机号。';");
    expect(registerSource).toContain("if (!project) return '请选择运动项目。';");
    expect(registerSource).toContain("if (!team) return '请选择所属队伍。';");
    expect(registerSource).toContain("if (!['ATL', 'SCC'].includes(role)) return '请选择注册身份。';");
    expect(registerSource).toContain("payload.nativePlace = `${nativePlaceProvince}/${nativePlaceCity}`");
    expect(registerSource).toContain('phone,');
    expect(registerSource).toContain("result.status === 'approved'");
  });

  it('注册页提供运动员/教练身份单选且按身份切换字段', () => {
    expect(registerSource).toContain("role: 'ATL'");
    expect(registerSource).toContain("roleCodes: ['ATL', 'SCC']");
    expect(registerSource).toContain('onRoleChange');
    expect(registerTemplate).toContain('bindchange="onRoleChange"');
    expect(registerTemplate).toContain('注册身份');
    expect(registerTemplate).toContain('wx:if="{{role === \'ATL\'}}"');
    expect(registerTemplate).not.toContain('role: \'ATL\'');
  });

  it('队伍选项支持加载失败重试并按项目过滤', () => {
    expect(registerSource).toContain('async loadTeams()');
    expect(registerSource).toContain('retryTeams()');
    expect(registerSource).toContain('teamsLoading');
    expect(registerSource).toContain('teamsError');
    expect(registerSource).toContain("item.project === project");
    expect(registerTemplate).toContain('bindtap="retryTeams"');
    expect(registerTemplate).toContain('wx:elif="{{project && teamOptions.length}}"');
    expect(registerTemplate).not.toContain('disabled="{{!project || !teamOptions.length}}"');
  });

  it('生日和性别使用独立原生选择器并展示字段错误', () => {
    expect(registerSource).not.toContain('identityNumber');
    expect(registerTemplate).not.toContain('身份证');
    expect(registerTemplate).toContain('mode="date"');
    expect(registerTemplate).toContain('end="{{today}}"');
    expect(registerTemplate).toContain('bindchange="onGenderChange"');
    expect(registerTemplate).toContain('{{fieldErrors.birthDate}}');
    expect(registerTemplate).toContain('{{fieldErrors.gender}}');
  });

  it('防重复提交并在成功后只回填账号、不回填密码', () => {
    expect(registerSource).toContain('if (this.data.submitting || this.data.success) return;');
    expect(registerSource).toContain("wx.setStorageSync('jingji-mini-pending-account', username)");
    expect(registerSource).toContain("wx.setStorageSync('jingji-mini-register-status', result.status || 'pending')");
    expect(registerSource).not.toContain("setStorageSync('jingji-mini-pending-account', password)");
    expect(loginSource).toContain("wx.getStorageSync('jingji-mini-pending-account')");
    expect(loginSource).toContain('wx.removeStorageSync(\'jingji-mini-pending-account\')');
    expect(loginSource).toContain("wx.getStorageSync('jingji-mini-register-status')");
    expect(loginSource).toContain("status === 'approved'");
    expect(loginSource).toContain('password:');
    expect(loginSource).not.toContain('jingji-mini-pending-account\', password');
    expect(registerTemplate).toContain('wx:if="{{success}}"');
    expect(registerTemplate).toContain('bindtap="submit"');
  });

  it('页面使用 custom 导航并沿用登录页字段结构', () => {
    const registerJson = JSON.parse(
      readFileSync(new URL('./register.json', import.meta.url), 'utf8')
    );
    expect(registerJson.navigationStyle).toBe('custom');

    expect(registerTemplate).toContain('bindchange="onProjectChange"');
    expect(registerTemplate).toContain('bindchange="onTeamChange"');
    expect(registerTemplate).toContain('bindchange="onProvinceChange"');
    expect(registerTemplate).toContain('bindchange="onCityChange"');
  });
});

function createPage(api = {}) {
  function load(url) {
    const module = { exports: {} };
    vm.runInNewContext(readFileSync(url, 'utf8'), {
      module, require: (path) => load(new URL(`${path}.js`, url))
    });
    return module.exports;
  }
  let definition;
  const showToast = vi.fn();
  const url = new URL('./register.js', import.meta.url);
  vm.runInNewContext(registerSource, {
    Page: (value) => { definition = value; },
    require: (path) => path === '../../services/api' ? api : load(new URL(`${path}.js`, url)),
    wx: { setStorageSync: vi.fn(), showToast }, setTimeout: vi.fn()
  });
  return { ...definition, showToast, data: { ...JSON.parse(JSON.stringify(definition.data)),
    displayName: '测试用户', username: 'test_user', password: 'test12345', confirmPassword: 'test12345',
    phone: '13800000000', project: 'rowing', team: '测试队',
    nativePlaceProvince: '北京市', nativePlaceCity: '北京市', birthDate: '2000-02-29', gender: '女'
  }, setData(value, callback) { Object.assign(this.data, value); callback?.(); } };
}

describe('注册资料提交与纠错', () => {
  it.each(['ATL', 'SCC'])('%s 提交独立生日性别且不含身份证', async (role) => {
    const register = vi.fn().mockResolvedValue({ status: 'pending' });
    const page = createPage({ register });
    page.data.role = role;
    await page.submit();
    expect(register).toHaveBeenCalledWith(expect.objectContaining({ role, birthDate: '2000-02-29', gender: '女' }));
    expect(register.mock.calls[0][0]).not.toHaveProperty('identityNumber');
  });
  it.each(['', '2026-02-30', '9999-01-01'])('拒绝无效生日 %s 并就近提供错误', async (birthDate) => {
    const register = vi.fn();
    const page = createPage({ register });
    page.data.birthDate = birthDate;
    await page.submit();
    expect(register).not.toHaveBeenCalled();
    expect(page.data.fieldErrors.birthDate).toBeTruthy();
  });
  it('性别未选时拒绝提交', async () => {
    const register = vi.fn();
    const page = createPage({ register });
    page.data.gender = '';
    await page.submit();
    expect(register).not.toHaveBeenCalled();
    expect(page.data.fieldErrors.gender).toBeTruthy();
  });
  it('服务端字段错误回显且修改对应字段后清除', async () => {
    const register = vi.fn().mockRejectedValue(Object.assign(new Error('资料不合法'), {
      fieldErrors: { birthDate: '生日不合法', gender: '请选择性别' }
    }));
    const page = createPage({ register });
    await page.submit();
    expect(page.data.fieldErrors).toEqual({ birthDate: '生日不合法', gender: '请选择性别' });
    expect(page.data.errorTarget).toBe('birth-date-field');
    page.onBirthDateChange({ detail: { value: '2001-01-01' } });
    expect(page.data.fieldErrors.birthDate).toBeUndefined();
    expect(page.data.fieldErrors.gender).toBe('请选择性别');
    page.onGenderChange({ detail: { value: '0' } });
    expect(page.data.gender).toBe('男');
    expect(page.data.fieldErrors.gender).toBeUndefined();
  });
});

describe('注册错误可感知性', () => {
  it('失败时滚到首个生日错误，重复提交仍可重新定位', async () => {
    const page = createPage({ register: vi.fn() });
    page.data.birthDate = '';
    await page.submit();
    expect(page.data.errorTarget).toBe('birth-date-field');
    expect(page.showToast).toHaveBeenCalledWith(expect.objectContaining({ title: '请选择有效出生日期', icon: 'none' }));
    page.data.errorTarget = 'other';
    await page.submit();
    expect(page.data.errorTarget).toBe('birth-date-field');
  });
  it('性别错误有独立滚动目标，picker名称包含错误说明', async () => {
    const page = createPage({ register: vi.fn() });
    page.data.gender = '';
    await page.submit();
    expect(page.data.errorTarget).toBe('gender-field');
    expect(registerTemplate).toContain('scroll-into-view="{{errorTarget}}"');
    expect(registerTemplate).toContain("fieldErrors.birthDate || ''");
    expect(registerTemplate).toContain("fieldErrors.gender || ''");
  });
});
