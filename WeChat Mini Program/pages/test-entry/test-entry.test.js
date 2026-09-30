import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

const pageSource = readFileSync(new URL('./test-entry.js', import.meta.url), 'utf8');
const templateSource = readFileSync(new URL('./test-entry.wxml', import.meta.url), 'utf8');

function loadPage({ role, athletes, selectedAthleteId }) {
  const calls = [];
  let definition;
  const api = {
    createStrengthTest(data) { calls.push(`strength:${data.athleteId}`); return Promise.resolve({}); },
    createSpecialTest(data) { calls.push(`special:${data.crewName}`); return Promise.resolve({}); },
  };
  // 复用真实 request-guard，页面错误提示与线上行为一致。
  const guardModule = { exports: {} };
  vm.runInNewContext(readFileSync(new URL('../../utils/request-guard.js', import.meta.url), 'utf8'), {
    module: guardModule,
    exports: guardModule.exports,
    require() { throw new Error('未预期的依赖'); },
    Promise,
    Error,
  });
  // 复用真实 form-draft，草稿暂存行为与线上一致。
  const draftModule = { exports: {} };
  vm.runInNewContext(readFileSync(new URL('../../utils/form-draft.js', import.meta.url), 'utf8'), {
    module: draftModule,
    exports: draftModule.exports,
    require() { throw new Error('未预期的依赖'); },
    Date,
    Number,
    String,
    Boolean,
    Array,
    Object,
    Error,
    JSON,
  });
  vm.runInNewContext(pageSource, {
    Page(value) { definition = value; },
    wx: { showToast() {}, navigateTo() {} },
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
      if (path.includes('utils/request-guard')) return guardModule.exports;
      if (path.includes('utils/form-draft')) return draftModule.exports;
      if (path.includes('utils/project-label')) return { projectLabel: () => '赛艇' };
      if (path.includes('utils/test-entry-form')) {
        return {
          STRENGTH_FIELDS: [{ key: 'squatKg', label: '深蹲', unit: 'kg' }],
          SPECIAL_ATTEMPT_COUNT: 3,
          defaultStrengthForm: () => ({ testDate: '', notes: '', squatKg: '' }),
          strengthPayload: (input) => ({ testDate: input.testDate, notes: input.notes, metrics: input.squatKg ? { squatKg: Number(input.squatKg) } : {} }),
          defaultSpecialForm: () => ({ testDate: '', distanceM: '', crewName: '', memberIds: [], attempts: ['', '', ''], previousBestText: '' }),
          specialPayload: (input) => ({
            project: input.project,
            testDate: input.testDate,
            crewName: input.crewName,
            memberAthleteIds: input.memberIds,
            attemptsText: (input.attempts || []).filter(Boolean),
          }),
        };
      }
      return {};
    },
    getApp: () => ({ globalData: {} }),
    Number,
    String,
    Array,
    Object,
    Error,
    Promise,
  });
  return { page: { ...definition, data: JSON.parse(JSON.stringify(definition.data)), setData(values) { Object.assign(this.data, values); } }, calls };
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

  it('模板提供运动员选择、成员多选与两种模式分区', () => {
    expect(templateSource).toContain('bindchange="onAthleteChange"');
    expect(templateSource).toContain('bindtap="onMemberToggle"');
    expect(templateSource).toContain('mode === \'special\'');
    expect(templateSource).toContain('bindtap="retryLoad"');
  });
});
