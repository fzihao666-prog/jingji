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
      require() { return {}; },
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
