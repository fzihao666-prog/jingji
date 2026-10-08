import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

const pageSource = readFileSync(new URL('./test-entry.js', import.meta.url), 'utf8');
const templateSource = readFileSync(new URL('./test-entry.wxml', import.meta.url), 'utf8');

function loadModule(url, mocks = {}) {
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
    JSON,
  });
  return module.exports;
}

// 字典、表单校验与日期工具加载真实文件，预填与保存口径与线上一致。
const formatData = loadModule(new URL('../../data/format-data.js', import.meta.url));
const testEntryForm = loadModule(new URL('../../utils/test-entry-form.js', import.meta.url), {
  '../data/format-data': formatData,
});
const dateUtil = loadModule(new URL('../../utils/date.js', import.meta.url));

function loadPage({ role, athletes, selectedAthleteId, storage = {} }) {
  const calls = [];
  const store = { ...storage };
  let definition;
  const api = {
    createStrengthTest(data) { calls.push(`strength:${data.athleteId}`); return Promise.resolve({}); },
    createSpecialTest(data) { calls.push(`special:${data.crewName}`); return Promise.resolve({}); },
  };
  // 复用真实 request-guard，页面错误提示与线上行为一致。
  const guardModule = loadModule(new URL('../../utils/request-guard.js', import.meta.url));
  // 复用真实 form-draft，草稿暂存行为与线上一致。
  const draftModule = loadModule(new URL('../../utils/form-draft.js', import.meta.url));
  vm.runInNewContext(pageSource, {
    Page(value) { definition = value; },
    wx: {
      showToast() {},
      navigateTo() {},
      getStorageSync(key) {
        if (!Object.prototype.hasOwnProperty.call(store, key)) return '';
        return store[key];
      },
      setStorageSync(key, value) { store[key] = value; },
      removeStorageSync(key) { delete store[key]; },
    },
    require(path) {
      if (path.includes('services/api')) return api;
      if (path.includes('utils/context')) {
        return {
          loadContext: () => Promise.resolve({
            user: { role },
            project: '赛艇',
            projectAthletes: athletes,
            selectedAthleteId,
          }),
        };
      }
      if (path.includes('utils/request-guard')) return guardModule;
      if (path.includes('utils/form-draft')) return draftModule;
      if (path.includes('utils/project-label')) return { projectLabel: () => '赛艇' };
      if (path.includes('utils/test-entry-form')) return testEntryForm;
      if (path.includes('utils/date')) return dateUtil;
      return {};
    },
    getApp: () => ({ globalData: {} }),
    Date,
    Number,
    String,
    Array,
    Object,
    Error,
    Promise,
    JSON,
  });
  return {
    page: { ...definition, data: JSON.parse(JSON.stringify(definition.data)), setData(values) { Object.assign(this.data, values); } },
    calls,
    store,
  };
}

describe('测试成绩现场录入页', () => {
  it('仅管理角色可进入，非管理角色给出明确提示', async () => {
    const { page } = loadPage({ role: 'ATL', athletes: [{ id: 7, name: '测试' }], selectedAthleteId: 7 });
    await page.loadPage();
    expect(page.data.error).toBe('只有教练等管理角色可以现场录入测试成绩。');
  });

  it('默认定位到入口指定的运动员，保存走体能测试接口', async () => {
    const { page, calls } = loadPage({
      role: 'SCC',
      athletes: [{ id: 7, name: '测试' }, { id: 8, name: '测试二' }],
      selectedAthleteId: 8,
    });
    page._mode = 'strength';
    page._targetAthleteId = 7;
    await page.loadPage();
    expect(page.data.athleteId).toBe(7);
    expect(page.data.athleteOptions).toEqual(['测试', '测试二']);
    page.setData({ form: { ...page.data.form, testDate: '2026-09-27', squatKg: '100' } });
    await page.save();
    expect(calls).toContain('strength:7');
  });

  it('专项模式保存组装组合成员后走专项测试接口', async () => {
    const { page, calls } = loadPage({
      role: 'TD',
      athletes: [{ id: 7, name: '测试' }, { id: 8, name: '测试二' }],
      selectedAthleteId: 7,
    });
    page._mode = 'special';
    page._targetAthleteId = 7;
    await page.loadPage();
    page.setData({
      form: { ...page.data.form, testDate: '2026-09-27', distanceM: '2000', crewName: '测试组', attempts: ['0:55.15', '', ''] },
      memberIds: [7, 8],
    });
    await page.save();
    expect(calls).toContain('special:测试组');
  });

  it('专项首次进入预填上次赛事条件，主测自动进成员并默认组合名', async () => {
    const { page } = loadPage({
      role: 'SCC',
      athletes: [{ id: 7, name: '张三' }, { id: 8, name: '李四' }],
      selectedAthleteId: 7,
      storage: {
        'jingji-mini-test-event:赛艇': {
          savedAt: 1,
          data: {
            testDate: '2026-09-27',
            distanceM: '2000',
            boatClass: '八人单桨',
            genderGroup: '男子公开',
            session: '上午',
            windConditions: '顺风',
            location: '千岛湖',
            note: '',
          },
        },
        'jingji-mini-test-distance:赛艇': { savedAt: 1, data: ['2000', '500'] },
      },
    });
    page._mode = 'special';
    page._targetAthleteId = 7;
    await page.loadPage();
    expect(page.data.form).toMatchObject({
      testDate: '2026-09-27',
      distanceM: '2000',
      boatClass: '八人单桨',
      genderGroup: '男子公开',
      session: '上午',
      windConditions: '顺风',
      location: '千岛湖',
      crewName: '张三',
    });
    expect(page.data.memberIds).toEqual([7]);
    expect(page.data.distanceChips).toEqual(['2000', '500']);
  });

  it('专项保存后保留赛事条件，只清成绩并把主测放回成员', async () => {
    const { page, store } = loadPage({
      role: 'SCC',
      athletes: [{ id: 7, name: '张三' }],
      selectedAthleteId: 7,
    });
    page._mode = 'special';
    page._targetAthleteId = 7;
    await page.loadPage();
    page.setData({
      form: {
        ...page.data.form,
        testDate: '2026-09-27',
        distanceM: '2000',
        boatClass: 'K1',
        genderGroup: '女子公开',
        session: '下午',
        windConditions: '侧风',
        location: '千岛湖',
        note: '状态好',
        crewName: '测试组',
        previousBestText: '0:54.90',
        attempts: ['0:55.15', '56.2', ''],
      },
      memberIds: [7],
    });
    await page.save();
    expect(page.data.form).toMatchObject({
      testDate: '2026-09-27',
      distanceM: '2000',
      boatClass: 'K1',
      genderGroup: '女子公开',
      session: '下午',
      windConditions: '侧风',
      location: '千岛湖',
      note: '状态好',
    });
    // 成绩级内容清空，组合名回到主测默认值，成员回到纯自动态。
    expect(page.data.form.attempts).toEqual(['', '', '']);
    expect(page.data.form.previousBestText).toBe('');
    expect(page.data.form.crewName).toBe('张三');
    expect(page.data.memberIds).toEqual([7]);
    // 赛事条件与常用距离按项目记忆，供下次预填。
    expect(store['jingji-mini-test-event:赛艇'].data).toMatchObject({ distanceM: '2000', boatClass: 'K1' });
    expect(store['jingji-mini-test-distance:赛艇'].data).toEqual(['2000']);
  });

  it('切换主测时纯自动成员跟随重置，已手动加人只补进新主测', async () => {
    const { page } = loadPage({
      role: 'SCC',
      athletes: [{ id: 7, name: '张三' }, { id: 8, name: '李四' }, { id: 9, name: '王五' }],
      selectedAthleteId: 7,
    });
    page._mode = 'special';
    page._targetAthleteId = 7;
    await page.loadPage();
    expect(page.data.memberIds).toEqual([7]);
    // 纯自动态：切换后成员与组合名跟随新主测。
    await page.onAthleteChange({ detail: { value: 1 } });
    expect(page.data.memberIds).toEqual([8]);
    expect(page.data.form.crewName).toBe('李四');
    // 手动加人后再切换：保留已有成员，补进新主测；组合名已手改则不覆盖。
    page.setData({ memberIds: [8, 7], form: { ...page.data.form, crewName: '测试组' } });
    await page.onAthleteChange({ detail: { value: 2 } });
    expect(page.data.memberIds).toEqual([8, 7, 9]);
    expect(page.data.form.crewName).toBe('测试组');
  });

  it('模板提供运动员选择、成员多选、距离快捷与更多条件折叠', () => {
    expect(templateSource).toContain('bindchange="onAthleteChange"');
    expect(templateSource).toContain('bindtap="onMemberToggle"');
    expect(templateSource).toContain('mode === \'special\'');
    expect(templateSource).toContain('bindtap="retryLoad"');
    expect(templateSource).toContain('bindtap="onDistanceChip"');
    expect(templateSource).toContain('bindtap="onToggleMoreFields"');
  });
});
