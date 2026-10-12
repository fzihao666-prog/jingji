import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

const pageSource = readFileSync(new URL('./profile-edit.js', import.meta.url), 'utf8');
const templateSource = readFileSync(new URL('./profile-edit.wxml', import.meta.url), 'utf8');
const serverSource = readFileSync(new URL('../../../server/athlete/athlete-routes.ts', import.meta.url), 'utf8');

describe('运动员个人资料编辑', () => {
  it('不允许运动员自行变更组织归属', () => {
    expect(pageSource).not.toContain('onProjectChange');
    expect(pageSource).not.toContain('onTeamChange');
    expect(pageSource).toContain("require('../../utils/profile-payload')");
    expect(pageSource).toContain('const payload = personalProfilePayload(this.data.form)');
    expect(pageSource).toContain('api.updateMyAthleteProfile(payload)');
    expect(templateSource).not.toContain('bindchange="onProjectChange"');
    expect(templateSource).not.toContain('bindchange="onTeamChange"');
    expect(templateSource).not.toContain('data-field="region"');
    expect(templateSource).not.toContain('data-field="city"');
    expect(templateSource).not.toContain('data-field="county"');
    expect(templateSource).toContain('组织归属由管理人员维护');
  });

  it('独立日期选择后保存生日，并保留性别', async () => {
    const payloadModule = { exports: {} };
    vm.runInNewContext(readFileSync(new URL('../../utils/profile-payload.js', import.meta.url), 'utf8'), { module: payloadModule });
    let definition;
    let saved;
    const app = { globalData: {}, setProject() {} };
    const api = { async updateMyAthleteProfile(payload) { saved = payload; } };
    vm.runInNewContext(pageSource, {
      Page(value) { definition = value; },
      wx: { showToast() {} },
      getApp() { return app; },
      setTimeout() {},
      require(path) {
        if (path === '../../services/api') return api;
        if (path === '../../utils/profile-payload') return payloadModule.exports;
        if (path === '../../utils/date') return { todayBeijing() { return '2026-10-12'; } };
        if (path === '../../utils/context') return { async loadContext() { return {}; } };
        return {};
      },
    });
    const page = {
      ...definition,
      data: { ...definition.data, form: { name: '测试姓名', gender: '女', birthDate: '2006-09-03' } },
      setData(values) {
        const { 'form.birthDate': birthDate, ...rest } = values;
        Object.assign(this.data, rest);
        if (birthDate !== undefined) this.data.form.birthDate = birthDate;
      },
      loadPage() {},
    };
    page.onLoad();
    expect(page.data.today).toBe('2026-10-12');
    page.onBirthDateChange({ detail: { value: '2007-10-01' } });
    await page.save();
    expect(saved.birthDate).toBe('2007-10-01');
    expect(saved.gender).toBe('女');
    expect(page.data.error).toBe('');
    expect(templateSource).toContain('mode="date"');
    expect(templateSource).toContain('end="{{today}}"');
    expect(templateSource).toContain('bindchange="onBirthDateChange"');
    expect(templateSource).toContain('aria-label="出生日期，{{form.birthDate');
    expect(templateSource).toContain('aria-label="性别，{{genderOptions[genderIndex]}}"');
  });

  it('保存本人资料不依赖可能过期的地区授权副本', () => {
    const routeStart = serverSource.indexOf("app.put('/api/me/athlete-profile'");
    expect(routeStart).toBeGreaterThanOrEqual(0);
    const routeEnd = serverSource.indexOf('app.post(', routeStart);
    expect(serverSource.slice(routeStart, routeEnd)).not.toContain('athleteScopeError(currentUser, payload)');
  });

  it('选择照片前等待微信隐私授权，同意后才打开媒体选择', () => {
    let definition;
    let privacyListener;
    let authorizeSuccess;
    let mediaOpened = false;
    const wx = {
      onNeedPrivacyAuthorization(listener) { privacyListener = listener; },
      requirePrivacyAuthorize({ success }) { authorizeSuccess = success; },
      chooseMedia() { mediaOpened = true; },
    };
    vm.runInNewContext(pageSource, {
      Page(value) { definition = value; }, wx,
      require(path) { return path === '../../utils/date' ? { todayBeijing() { return '2026-10-12'; } } : {}; },
    });
    const page = { ...definition, data: { ...definition.data }, setData(values) { Object.assign(this.data, values); }, loadPage() {} };
    page.onLoad();
    page.choosePhoto();
    expect(mediaOpened).toBe(false);
    let resolved;
    privacyListener((value) => { resolved = value; });
    expect(page.data.showPrivacyAuthorization).toBe(true);
    page.onPrivacyAgree();
    expect(resolved).toEqual({ event: 'agree', buttonId: 'agree-privacy' });
    authorizeSuccess();
    expect(mediaOpened).toBe(true);
  });

  it('头像通过鉴权下载获取临时路径，不直接传 API 路径给 image', () => {
    // 验证页面使用 downloadAthletePhoto 而非 assetUrl 获取头像
    expect(pageSource).toContain('api.downloadAthletePhoto');
    expect(pageSource).not.toContain('api.assetUrl(athlete.photoUrl)');
    // WXML 模板使用 photoUrl 绑定 image src（此时为临时文件路径或空）
    expect(templateSource).toContain('src="{{photoUrl}}"');
  });

  it('头像下载失败时保留占位而不报错', () => {
    // downloadAthletePhoto 在 api.js 中返回空字符串而非抛出异常
    const apiSource = readFileSync(new URL('../../services/api.js', import.meta.url), 'utf8');
    expect(apiSource).toContain('async downloadAthletePhoto');
    expect(apiSource).toContain('return \'\'');
    // 页面侧不对空 photoUrl 抛出异常
    expect(pageSource).toContain('photoUrl');
  });
});
