import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

function setup() {
  let definition;
  const utilsModule = { exports: {} };
  vm.runInNewContext(readFileSync(new URL('../../utils/training-report.js', import.meta.url), 'utf8'), { module: utilsModule });
  const report = { range: { kind: 'week', from: '2026-10-05', to: '2026-10-11' }, daily: [], categories: [], tests: [], wellness: [],
    totals: { sessions: 1, duration: 60, distance: null, srpe: null, durationCount: 1, distanceCount: 0, srpeCount: 0 }, previous: {} };
  const preview = { data: report, fingerprint: 'a'.repeat(64) };
  const api = { reportPreview: vi.fn(async () => preview),
    reportCommentary: vi.fn(async () => ({ highlights: ['表现'], concerns: [], suggestions: [] })),
    saveReport: vi.fn(async () => ({ createdAt: '2026-10-19T00:00:00Z' })),
    reportHistory: vi.fn(async () => []), reportDetail: vi.fn(async () => ({ data: report, createdAt: 'saved', commentary: { highlights: ['历史点评'], concerns: [], suggestions: [] } })) };
  const mocks = { '../../services/api': api, '../../utils/context': { loadContext: async () => ({ projectAthletes: [{ id: 1, name: '合成', project: 'ROWING' }] }) },
    '../../utils/date': { todayBeijing: () => '2026-10-05' }, '../../utils/project-label': { projectLabel: () => '赛艇' }, '../../utils/training-report': utilsModule.exports };
  const wx = { showModal: vi.fn(({ success }) => success({ confirm: true })), showToast() {} };
  vm.runInNewContext(readFileSync(new URL('./training-report.js', import.meta.url), 'utf8'), {
    Page(value) { definition = value; }, require(path) { if (!(path in mocks)) throw new Error(path); return mocks[path]; },
    wx,
  });
  const page = { ...definition, data: structuredClone(definition.data), _alive: true,
    setData(values) { for (const [path, value] of Object.entries(values)) {
      if (path.includes('.')) { const [root, key] = path.split('.'); this.data[root][key] = value; }
      else this.data[path] = value;
    } } };
  return { page, api, preview, wx };
}
describe('小程序训练报告页面流程', () => {
  it('校验档案范围，预览、点评、保存和历史共用 API', async () => {
    const { page, api } = setup();
    page.onLoad({ athleteId: '1' }); await vi.waitFor(() => expect(page.data.busy).toBe(false));
    expect(page.data.athleteId).toBe(1);
    page.preview(); await vi.waitFor(() => expect(page.data.report).not.toBeNull());
    expect(page.data.view.kpis[1].value).toBe('60');
    page.generate();
    await vi.waitFor(() => expect(page.data.commentary.highlights).toBe('表现'));
    page.save(); await vi.waitFor(() => expect(page.data.saved).not.toBe(''));
    expect(api.saveReport).toHaveBeenCalledTimes(1);
    page.save(); expect(api.saveReport).toHaveBeenCalledTimes(1);
    page.openHistory({ currentTarget: { dataset: { id: 'history' } } });
    await vi.waitFor(() => expect(page.data.commentary.highlights).toBe('历史点评'));
    expect(page._preview).toBeNull();
  });
  it('没有同意不请求 AI，AI 失败仍保留图表', async () => {
    const { page, api, preview, wx } = setup();
    page.data.athleteId = 1; page._preview = preview; page.data.report = preview.data;
    wx.showModal.mockImplementationOnce(({ success }) => success({ confirm: false }));
    page.generate(); await vi.waitFor(() => expect(page.data.busy).toBe(false));
    expect(api.reportCommentary).not.toHaveBeenCalled();
    api.reportCommentary.mockRejectedValueOnce(new Error('模型暂不可用'));
    page.generate(); await vi.waitFor(() => expect(page.data.error).toBe('模型暂不可用'));
    expect(page.data.report).toEqual(preview.data);
  });
  it('无记录时提示原因，确认期间防重复，离开页面后不发送', async () => {
    const { page, api, preview, wx } = setup();
    page._preview = preview;
    preview.data.totals.sessions = 0;
    page.generate();
    await vi.waitFor(() => expect(page.data.error).toContain('暂无有效训练记录'));
    expect(wx.showModal).not.toHaveBeenCalled();
    preview.data.totals.sessions = 1;
    let confirm;
    wx.showModal.mockImplementationOnce(({ success }) => { confirm = success; });
    page.generate(); page.generate();
    expect(wx.showModal).toHaveBeenCalledTimes(1);
    page.onUnload(); confirm({ confirm: true });
    await Promise.resolve(); await Promise.resolve();
    expect(api.reportCommentary).not.toHaveBeenCalled();
  });
  it('日期变更清除旧报告，拒绝越界运动员和过长范围', async () => {
    const { page, api, preview } = setup();
    page.onLoad({ athleteId: '2' }); await vi.waitFor(() => expect(page.data.error).toContain('访问权限'));
    expect(page.data.athleteId).toBe(0);
    page._preview = preview; page.data.report = preview.data;
    page.changeRange({ kind: 'custom', from: '2026-01-01', to: '2026-10-01' });
    expect(page.data.report).toBeNull(); expect(page._preview).toBeNull();
    page.data.athleteId = 1; page.preview();
    await vi.waitFor(() => expect(page.data.error).toContain('90 天'));
    expect(api.reportPreview).not.toHaveBeenCalled();
  });
  it('页面离开后迟到响应不能写回', async () => {
    const { page, api, preview } = setup();
    let resolve;
    api.reportPreview.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    page.data.athleteId = 1; page.preview(); page.onUnload(); resolve(preview);
    await Promise.resolve(); await Promise.resolve();
    expect(page.data.report).toBeNull();
  });
});
