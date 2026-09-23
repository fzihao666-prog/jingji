import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const pageSource = readFileSync(new URL('./profile-edit.js', import.meta.url), 'utf8');
const templateSource = readFileSync(new URL('./profile-edit.wxml', import.meta.url), 'utf8');
const serverSource = readFileSync(new URL('../../../server/index.ts', import.meta.url), 'utf8');

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
    const routeEnd = serverSource.indexOf('app.post(', routeStart);
    expect(serverSource.slice(routeStart, routeEnd)).not.toContain('athleteScopeError(currentUser, payload)');
  });
});
