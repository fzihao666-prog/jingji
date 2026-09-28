import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

const appJson = JSON.parse(readFileSync(new URL('../../app.json', import.meta.url), 'utf8'));
const apiSource = readFileSync(new URL('../../services/api.js', import.meta.url), 'utf8');
const apiFlat = apiSource.replace(/\s+/g, ' ');
const indexTemplate = readFileSync(new URL('../index/index.wxml', import.meta.url), 'utf8');
const indexSource = readFileSync(new URL('../index/index.js', import.meta.url), 'utf8');
const pageSource = readFileSync(new URL('./wellness-entry.js', import.meta.url), 'utf8');
const pageTemplate = readFileSync(new URL('./wellness-entry.wxml', import.meta.url), 'utf8');

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

const dateModule = loadCjs(new URL('../../utils/date.js', import.meta.url), {});
const requestGuard = loadCjs(new URL('../../utils/request-guard.js', import.meta.url), {});
const wellnessForm = loadCjs(new URL('../../utils/wellness-form.js', import.meta.url), {
  './date': {
    todayBeijing: () => '2026-09-27',
    toDateString: dateModule.toDateString,
  },
});

function createPage({ user, record = null }) {
  let definition;
  const saveWellness = vi.fn(async () => ({ date: '2026-09-27', record }));
  const myWellness = vi.fn(async () => ({ date: '2026-09-27', record }));
  const toasts = [];
  const app = { globalData: { dataVersion: 3, homeNeedsRefresh: false } };
  const pageMocks = {
    '../../services/api': { myWellness, saveWellness },
    '../../utils/context': { loadContext: async () => ({ user }) },
    '../../utils/wellness-form': wellnessForm,
    '../../utils/request-guard': requestGuard,
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
    wx: {
      showToast(options) {
        toasts.push(options.title);
      },
      stopPullDownRefresh() {},
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
    data: JSON.parse(JSON.stringify(definition.data)),
    setData(values) {
      Object.entries(values).forEach(([path, value]) => {
        const keys = path.split('.');
        let target = this.data;
        for (let i = 0; i < keys.length - 1; i += 1) {
          target[keys[i]] = target[keys[i]] || {};
          target = target[keys[i]];
        }
        target[keys[keys.length - 1]] = value;
      });
    },
  };
  return { page, myWellness, saveWellness, toasts, app };
}

const record = {
  date: '2026-09-27',
  sleepHours: 7,
  sleepQuality: 8,
  morningPulse: 58,
  weightKg: 61.5,
  fatigueIndex: 4,
  sorenessIndex: 3,
  moodIndex: 7,
  status: 'normal',
  source: 'athlete_self_report',
};

describe('恢复日报入口接线', () => {
  it('已注册路由，首页提供今日状态与恢复日报入口', () => {
    expect(appJson.pages).toContain('pages/wellness-entry/wellness-entry');
    expect(indexTemplate).toContain('bindtap="openWellnessEntry"');
    expect(indexTemplate).toContain('bindtap="openTrainingEntry"');
    expect(indexTemplate).toContain('今日状态');
    expect(indexTemplate).toContain('todayView.submittedLabel');
    expect(indexTemplate).toContain('wellnessView.filledLabel');
    expect(indexSource).toContain('todayStatusSummary(todayStatusView(status))');
    expect(indexSource).toContain('wellnessRecordView(wellness && wellness.record)');
    expect(indexSource).toContain("wx.navigateTo({ url: '/pages/wellness-entry/wellness-entry' })");
  });

  it('api 提供今日状态与恢复日报读写方法', () => {
    expect(apiFlat).toContain("todayStatus() { return request('/api/me/today-status'); }");
    expect(apiFlat).toContain("myWellness(date) { return request(`/api/me/wellness?${query({ date })}`); }");
    expect(apiFlat).toContain("return request('/api/me/wellness', { method: 'POST', data });");
  });

  it('填写页字段与服务端字段一一对应', () => {
    expect(pageTemplate).toContain('bindtap="save"');
    expect(pageTemplate).toContain('data-field="{{item.key}}"');
    expect(pageTemplate).toContain('bindchange="onDateChange"');
    expect(pageTemplate).toContain('bindchange="onStatusChange"');
    expect(pageTemplate).toContain('start="{{min}}"');
    expect(pageTemplate).toContain('end="{{max}}"');
    expect(pageSource).toContain("context.user.role !== 'ATL'");
  });

  it('疲劳和酸痛提供快捷选择按钮', () => {
    expect(pageTemplate).toContain('bindtap="onQuickSelect"');
    expect(pageTemplate).toContain('quickSelect[item.key]');
    expect(pageSource).toContain('onQuickSelect(event)');
    expect(pageSource).toContain('QUICK_SELECT');
  });
});

describe('恢复日报填写页行为', () => {
  it('运动员载入时读取当天已有记录并回填表单', async () => {
    const { page, myWellness } = createPage({ user: { role: 'ATL', athleteId: 7 }, record });
    await page.loadPage();
    expect(page.data.loading).toBe(false);
    expect(myWellness).toHaveBeenCalledWith('2026-09-27');
    expect(page.data.recordView.filled).toBe(true);
    expect(page.data.form.sleepHours).toBe('7');
    expect(page.data.form.statusIndex).toBe(0);
    expect(page.data.min).toBe('2026-09-21');
    expect(page.data.max).toBe('2026-09-27');
  });

  it('保存后写入正式数据并刷新首页缓存', async () => {
    const { page, saveWellness, toasts, app } = createPage({
      user: { role: 'ATL', athleteId: 7 },
      record,
    });
    await page.loadPage();
    page.setData({ form: { ...page.data.form, sleepHours: '6.5', morningPulse: '61', fatigueIndex: '5' } });
    await page.save();
    expect(saveWellness).toHaveBeenCalledTimes(1);
    const payload = saveWellness.mock.calls[0][0];
    expect(payload).toMatchObject({
      date: '2026-09-27',
      sleepHours: 6.5,
      morningPulse: 61,
      fatigueIndex: 5,
      status: 'normal',
    });
    expect(app.globalData.dataVersion).toBe(4);
    expect(app.globalData.homeNeedsRefresh).toBe(true);
    expect(toasts).toContain('恢复日报已保存');
    expect(page.data.saving).toBe(false);
  });

  it('空提交与越界数值不发起请求', async () => {
    const { page, saveWellness, toasts } = createPage({ user: { role: 'ATL', athleteId: 7 } });
    await page.loadPage();
    await page.save();
    expect(saveWellness).not.toHaveBeenCalled();
    expect(toasts).toContain('至少填写一项恢复数据。');

    page.setData({ form: { ...page.data.form, sleepHours: '30' } });
    await page.save();
    expect(saveWellness).not.toHaveBeenCalled();
    expect(toasts).toContain('睡眠时长应为0至24小时。');
    expect(page.data.error).toBe('');
  });

  it('切换日期会按新日期重新读取当天记录', async () => {
    const { page, myWellness } = createPage({ user: { role: 'ATL', athleteId: 7 }, record });
    await page.loadPage();
    myWellness.mockClear();
    await page.onDateChange({ detail: { value: '2026-09-25' } });
    expect(myWellness).toHaveBeenCalledWith('2026-09-25');
    expect(page.data.form.date).toBe('2026-09-25');
    expect(page.data.form.sleepHours).toBe('');
  });

  it('非运动员角色无法填写恢复日报', async () => {
    const { page, saveWellness } = createPage({ user: { role: 'SCC', athleteId: 0 } });
    await page.loadPage();
    expect(page.data.loading).toBe(false);
    expect(page.data.error).toBe('只有运动员本人可以填写恢复日报。');
    await page.save();
    expect(saveWellness).not.toHaveBeenCalled();
  });

  it('保存失败时保留表单并展示服务端错误', async () => {
    const { page, saveWellness } = createPage({ user: { role: 'ATL', athleteId: 7 } });
    await page.loadPage();
    saveWellness.mockRejectedValueOnce(new Error('恢复日报只能填写最近7天（含今天）的数据。'));
    page.setData({ form: { ...page.data.form, sleepHours: '7' } });
    await page.save();
    expect(page.data.error).toBe('恢复日报只能填写最近7天（含今天）的数据。');
    expect(page.data.form.sleepHours).toBe('7');
    expect(page.data.saving).toBe(false);
  });

  it('快捷选择按钮直接写入对应数值', async () => {
    const { page } = createPage({ user: { role: 'ATL', athleteId: 7 } });
    await page.loadPage();
    page.onQuickSelect({ currentTarget: { dataset: { field: 'fatigueIndex', value: 8 } } });
    expect(page.data.form.fatigueIndex).toBe('8');
    page.onQuickSelect({ currentTarget: { dataset: { field: 'sorenessIndex', value: 4 } } });
    expect(page.data.form.sorenessIndex).toBe('4');
  });
});
