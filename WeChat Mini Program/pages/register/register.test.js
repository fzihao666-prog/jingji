import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
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

  it('提交前校验密码一致、身份证格式与必填项', () => {
    expect(registerSource).toContain("if (password !== confirmPassword) return '两次输入的密码不一致。';");
    expect(registerSource).toContain("/^\\d{17}[\\dX]$/.test(identityNumber)");
    expect(registerSource).toContain("if (!/^1[3-9]\\d{9}$/.test(phone)) return '手机号须为11位大陆手机号。';");
    expect(registerSource).toContain("if (!project) return '请选择运动项目。';");
    expect(registerSource).toContain("if (!team) return '请选择所属队伍。';");
    expect(registerSource).toContain("if (!['ATL', 'SCC'].includes(role)) return '请选择注册身份。';");
    expect(registerSource).toContain("payload.identityNumber = identityNumber;");
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

  it('身份证号自动推导性别与出生日期', () => {
    expect(registerSource).toContain('birthDateFromIdentityNumber');
    expect(registerTemplate).toContain('value="{{birthDate}}"');
    expect(registerTemplate).toContain('value="{{phone}}"');
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
    expect(registerTemplate).toContain('bindinput="onIdentityInput"');
    expect(registerTemplate).toContain('bindchange="onProjectChange"');
    expect(registerTemplate).toContain('bindchange="onTeamChange"');
    expect(registerTemplate).toContain('bindchange="onProvinceChange"');
    expect(registerTemplate).toContain('bindchange="onCityChange"');
  });
});
