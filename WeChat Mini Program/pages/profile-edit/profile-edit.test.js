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
      data: { ...definition.data, loaded: true, form: { name: '测试姓名', gender: '女', birthDate: '2006-09-03' } },
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

function managedEditor(role = 'SCC', overrides = {}) {
  let definition;
  const athlete = { id: 101, name: '原队员', project: 'ROWING', team: 'A队', gender: '女', birthDate: '2006-01-02',
    region: '四川', city: '成都市', county: '武侯区', phone: '13800000000', notes: '原备注', currentEvent: '单人双桨',
    ethnicity: '汉族', healthStatus: '健康', athleteStatus: '在训' };
  const calls = [];
  const api = { athleteCreateOptions: async () => ({ teams: [
    { id: 10, project: 'ROWING', name: 'A队' }, { id: 11, project: 'ROWING', name: 'B队' },
    { id: 20, project: 'CANOE', name: 'C队' },
  ] }), updateAthlete: async (id, payload) => { calls.push({ id, payload }); },
    updateMyAthleteProfile: async (payload) => { calls.push({ self: true, payload }); },
    ...overrides,
  };
  const wxCalls = [];
  const app = { globalData: { user: { displayName: '教练姓名' }, dataVersion: 1 }, setProject(project) { this.globalData.currentProject = project; } };
  const payloadModule = { exports: {} };
  vm.runInNewContext(readFileSync(new URL('../../utils/profile-payload.js', import.meta.url), 'utf8'), { module: payloadModule });
  vm.runInNewContext(pageSource, {
    Page: (value) => { definition = value; }, getApp: () => app,
    setTimeout: (callback) => callback(),
    wx: { enableAlertBeforeUnload: () => wxCalls.push('dirty'), disableAlertBeforeUnload: () => wxCalls.push('clean'),
      showToast: () => {}, navigateBack: () => wxCalls.push('back') },
    require(path) {
      if (path.includes('register-data')) return { provinces: ['四川', '浙江'] };
      if (path.includes('services/api')) return api;
      if (path.includes('profile-payload')) return payloadModule.exports;
      if (path.includes('context')) return { loadContext: async () => ({ user: { role, athleteId: role === 'ATL' ? 101 : null }, athletes: [athlete], selectedAthleteId: 101 }) };
      if (path.includes('date')) return { todayBeijing: () => '2026-10-19' };
      if (path.includes('project-label')) return { projectLabel: (code) => code, projectOptions: (codes) => codes.map((code) => ({ code, label: code })) };
      return {};
    },
  });
  const page = { ...definition, _requestedId: 101, data: JSON.parse(JSON.stringify(definition.data)),
    setData(patch) { for (const [key, value] of Object.entries(patch)) {
      const [root, field] = key.split('.');
      if (field) this.data[root][field] = value; else this.data[key] = value;
    } },
  };
  return { page, calls, app, wxCalls, athlete };
}

describe('教练及上级编辑运动员闭环', () => {
  it.each(['SCC', 'REG', 'TD', 'DMD'])('%s 回填目标档案，保存保留未修改字段及当前登录者身份', async (role) => {
    const { page, calls, app, wxCalls } = managedEditor(role);
    await page.loadPage();
    expect(page.data.loaded).toBe(true); expect(page.data.editingManaged).toBe(true);
    page.onFieldInput({ currentTarget: { dataset: { field: 'name' } }, detail: { value: '修改姓名' } });
    await page.save();
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ id: 101, payload: { name: '修改姓名', phone: '13800000000', notes: '原备注', currentEvent: '单人双桨',
      project: 'ROWING', team: 'A队', region: '四川', city: '成都市', county: '武侯区' } });
    expect(app.globalData.user.displayName).toBe('教练姓名');
    expect(app.globalData).toMatchObject({ selectedAthleteId: 101, dataVersion: 2, currentProject: 'ROWING' });
    expect(wxCalls).toEqual(['dirty', 'clean', 'back']);
    await page.save(); expect(calls).toHaveLength(1);
  });
  it('本人仍走本人接口，组织字段无法经输入事件修改', async () => {
    const { page, calls } = managedEditor('ATL');
    await page.loadPage();
    page.onManagedProjectChange({ detail: { value: 1 } });
    page.onFieldInput({ currentTarget: { dataset: { field: 'team' } }, detail: { value: 'B队' } });
    expect(page.data.form.team).toBe('A队');
    await page.save();
    expect(calls[0].self).toBe(true);
    expect(calls[0].payload).not.toHaveProperty('team');
    expect(calls[0].payload).not.toHaveProperty('region');
  });
  it('管理者只能从权限内队伍选择，切换项目后必须明确选择新队伍', async () => {
    const { page, calls, app } = managedEditor();
    await page.loadPage();
    page.onManagedProjectChange({ detail: { value: 1 } });
    expect(page.data.form.team).toBe('');
    await page.save(); expect(calls).toHaveLength(0); expect(page.data.error).toContain('有权管理');
    page.onManagedTeamChange({ detail: { value: 1 } }); await page.save();
    expect(calls[0].payload).toMatchObject({ project: 'CANOE', team: 'C队' });
    expect(app.globalData.pendingProject).toBe('CANOE');
  });
  it.each(['SCC', 'ATL'])('%s 不能编辑 URL 中的越权 ID', async (role) => {
    const { page, calls } = managedEditor(role);
    page._requestedId = 999;
    await page.loadPage(); await page.save();
    expect(page.data.loaded).toBe(false); expect(page.data.error).toBeTruthy(); expect(calls).toHaveLength(0);
  });
  it('服务端拒绝保存时保留修改，不清理退出提醒', async () => {
    const { page, wxCalls } = managedEditor('SCC', { updateAthlete: async () => { throw new Error('无权维护该队伍'); } });
    await page.loadPage();
    page.onFieldInput({ currentTarget: { dataset: { field: 'notes' } }, detail: { value: '保留草稿' } });
    await page.save();
    expect(page.data.form.notes).toBe('保留草稿'); expect(page.data.error).toContain('无权');
    expect(page.data.saving).toBe(false); expect(page.data.saved).toBe(false);
    expect(wxCalls).toEqual(['dirty']);
  });
});


describe('资料与附件分步保存恢复', () => {
  it('附件失败明确提示已保存的部分，重试不重复写入已成功的测量', async () => {
    let measurements = 0;
    let uploads = 0;
    const { page, app } = managedEditor('SCC', {
      updateBodyComposition: async () => { measurements += 1; },
      uploadAthletePhoto: async () => { if (++uploads === 1) throw new Error('上传失败'); },
    });
    await page.loadPage();
    page.data.bodyTouched = true; page.data.photoFile = '/synthetic-photo.jpg';
    await page.save();
    expect(page.data.error).toContain('基本资料已保存');
    expect(page.data.bodyTouched).toBe(false); expect(page.data.photoFile).toBe('/synthetic-photo.jpg');
    expect(app.globalData.dataVersion).toBe(2);
    await page.save();
    expect(measurements).toBe(1); expect(uploads).toBe(2); expect(page.data.saved).toBe(true);
  });
});


describe('管理者维护档案行政归属', () => {
  it('区域管理者仅可选择自身授权内的地区，本人不能调整', async () => {
    const { page } = managedEditor('REG');
    await page.loadPage();
    page._areas = [{ areaLevel: 'province', province: '四川' }];
    page.onManagedAreaChange({ detail: { value: ['浙江', '杭州市', '西湖区'] } });
    expect(page.data.form.region).toBe('四川'); expect(page.data.error).toContain('权限');
    page.onManagedAreaChange({ detail: { value: ['四川省', '绵阳市', '涪城区'] } });
    expect(page.data.form).toMatchObject({ region: '四川', city: '绵阳市', county: '涪城区' });
    const { page: self } = managedEditor('ATL'); await self.loadPage();
    self.onManagedAreaChange({ detail: { value: ['浙江', '杭州市', '西湖区'] } });
    expect(self.data.form.region).toBe('四川');
  });
});
