import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { expect, it, vi } from 'vitest';

function setup(role = 'SCC') {
  const review = { exports: {} };
  vm.runInNewContext(readFileSync(new URL('./review.js', import.meta.url), 'utf8'), { module: review });
  const team = { id: 1, project: 'ROWING', name: '测试队伍' };
  const app = { globalData: { token: 'synthetic', user: { role }, currentProject: 'ROWING', dataVersion: 0 } };
  const importer = {
    canImport: (user) => user.role === 'SCC',
    teams: vi.fn(async () => ({ teams: [team] })),
    template: vi.fn(async () => '/tmp/test.xlsx'),
    excel: vi.fn(), updatePeople: vi.fn(), updateItems: vi.fn(), commitExcel: vi.fn(),
    teamExcel: vi.fn(), enodePreview: vi.fn(), enodeImport: vi.fn()
  };
  const wx = {
    chooseMessageFile: vi.fn(), openDocument: vi.fn(({ success }) => success()),
    pageScrollTo: vi.fn(), switchTab: vi.fn(), showModal: vi.fn(({ success }) => success({ confirm: true }))
  };
  const mocks = {
    '../../services/api': { currentProject: async () => ({ project: 'ROWING', projects: ['ROWING', 'CYCLING_ROAD'] }) },
    '../../services/data-import': importer, '../../utils/project-label': {
      projectOptions: (codes) => codes.map((code) => ({ code, label: code }))
    }, './review': review.exports
  };
  let definition;
  vm.runInNewContext(readFileSync(new URL('./data-import.js', import.meta.url), 'utf8'), {
    Page(value) { definition = value; }, require(path) { return mocks[path]; }, getApp: () => app, wx
  });
  const page = {
    ...definition,
    data: structuredClone(definition.data),
    setData(values, callback) {
      for (const [path, value] of Object.entries(values)) {
        const keys = path.replace(/\[(\d+)\]/g, '.$1').split('.');
        const last = keys.pop();
        keys.reduce((parent, key) => parent[key], this.data)[last] = value;
      }
      callback?.();
    }
  };
  return { page, importer, wx, app };
}

const event = (dataset = {}, value = '') => ({ currentTarget: { dataset }, detail: { value } });
const file = { path: '/tmp/synthetic', name: '合成.xlsx', size: 10 };
const person = { id: 1, status: 'pending', name: '合成队员', normalizedName: '合成队员', team: '测试队伍',
  suggested: [], messages: [], confirmed: false };
const item = { id: 3, itemType: 'test_measurement', quality: 'valid', messages: [], payload: { personKey: '合成队员' } };
const batch = { id: 'draft', revision: 1, filename: file.name, items: [item], athleteCandidates: [person],
  counts: { newCount: 1, overwriteCount: 0 } };

it('运动员进入页面后不请求管理数据，授权教练能下载并打开项目模板', async () => {
  const athlete = setup('ATL');
  await athlete.page.onLoad();
  expect(athlete.importer.teams).not.toHaveBeenCalled();
  const { page, importer, wx } = setup();
  await page.onLoad();
  await page.downloadTemplate(event({ kind: 'team' }));
  expect(importer.template).toHaveBeenCalledWith('team', 'ROWING');
  expect(wx.openDocument).toHaveBeenCalledWith(expect.objectContaining({ fileType: 'xlsx', showMenu: true }));
});

it('Excel 只展示需修正项，最终一次确认使用修正后的最新修订', async () => {
  const { page, importer, wx, app } = setup();
  await page.onLoad();
  wx.chooseMessageFile.mockImplementation(({ success }) => success({ tempFiles: [file] }));
  const wrong = { ...item, quality: 'error', messages: ['日期无效'], payload: {
    ...item.payload, sourceRow: { columns: [['姓名', 0], ['测试日期', 1]], values: ['合成队员', '错误日期'] }
  } };
  importer.excel.mockResolvedValue({ batch: { ...batch, items: [wrong] } });
  await page.uploadExcel();
  expect(page.data.excel).toMatchObject({ newPeople: 1, issues: 1 });
  await page.commitExcel();
  expect(importer.commitExcel).not.toHaveBeenCalled();
  page.editIssue(event({ id: 3 }));
  expect(page.data.editor.index).toBe(1);
  page.changeSourceValue(event({}, '2026-11-08'));
  importer.updateItems.mockResolvedValue({ batch: { ...batch, revision: 2 } });
  await page.saveSource();
  expect(importer.updateItems).toHaveBeenCalledWith(expect.objectContaining({ revision: 1 }), [
    { id: 3, sourceCells: { 测试日期: '2026-11-08' } }
  ]);
  importer.updatePeople.mockResolvedValue({ batch: { ...batch, revision: 3, athleteCandidates: [{ ...person, confirmed: true }] } });
  importer.commitExcel.mockResolvedValue({ message: '导入完成' });
  await page.commitExcel();
  expect(importer.updatePeople).toHaveBeenCalledWith(expect.objectContaining({ revision: 2 }), [{ id: 1, confirmed: true }]);
  expect(importer.commitExcel).toHaveBeenCalledWith(expect.objectContaining({ revision: 3 }));
  expect(page.data.receipts.excel).toBe('导入完成');
  expect(app.globalData.dataVersion).toBe(1);
});

it('队伍新列保存映射前不产生成功回执，重用原文件和队伍', async () => {
  const { page, importer, wx, app } = setup();
  await page.onLoad();
  expect(page.data.teamIndex).toBe(0);
  wx.chooseMessageFile.mockImplementation(({ success }) => success({ tempFiles: [file] }));
  importer.teamExcel.mockResolvedValueOnce({ status: 'mapping_required', columns: [
    { key: 'ride', label: '骑行 · km', unit: 'km' }
  ] }).mockResolvedValueOnce({ status: 'imported', created: 1, updated: 0, unchanged: 0, undatedRows: 1, latestDate: '2026-09-20' });
  await page.uploadTeam();
  expect(page.data.receipts.team).toBe('');
  expect(page.data.mappings[0]).toMatchObject({ fixedUnit: true, category: '骑行' });
  await page.saveMappings();
  expect(importer.teamExcel).toHaveBeenLastCalledWith(file, 'ROWING', 1, { ride: { category: '骑行', unit: 'km' } });
  expect(page.data.receipts.team).toContain('跳过无日期 1 行');
  page.openTeamStats();
  expect(wx.switchTab).toHaveBeenCalledWith(expect.objectContaining({ url: '/pages/special/special' }));
  expect(app.globalData.teamTrainingImportTarget).toEqual({ project: 'ROWING', teamId: 1, date: '2026-09-20' });
});

it('Enode 统一预览两份文件，同名明确选择、新人同批建档', async () => {
  const { page, importer, wx } = setup();
  await page.onLoad();
  const files = [{ ...file, name: '状态' }, { ...file, name: '训练.csv' }];
  wx.chooseMessageFile.mockImplementation(({ success }) => success({ tempFiles: files }));
  const a = { id: 10, name: '同名', team: '一队' };
  const b = { id: 11, name: '同名', team: '二队' };
  importer.enodePreview.mockResolvedValue({ teams: ['测试队伍'], files, people: [
    { key: 'known', name: '已建档', candidates: [{ ...a, id: 12 }] },
    { key: 'same', name: '同名', candidates: [a, b] }, { key: 'new', name: '新人', candidates: [] }
  ] });
  await page.uploadEnode();
  expect(importer.enodePreview).toHaveBeenCalledWith(files, 'ROWING');
  await page.commitEnode();
  expect(importer.enodeImport).not.toHaveBeenCalled();
  page.changeEnodePerson(event({ key: 'same' }, '1'));
  importer.enodeImport.mockResolvedValue({ summary: { linked: 2, created: 1 }, results: [] });
  await page.commitEnode();
  expect(importer.enodeImport).toHaveBeenCalledWith(files, 'ROWING', {
    known: { action: 'link', athleteId: 12 }, same: { action: 'link', athleteId: 11 },
    new: { action: 'create', team: '测试队伍' }
  });
  expect(page.data.receipts.enode).toContain('新建 1 人');
});


it('切换导入类型时保留各自的校对草稿和结果，处理期间不能切换', async () => {
  const { page, importer, wx } = setup();
  await page.onLoad();
  wx.chooseMessageFile.mockImplementation(({ success }) => success({ tempFiles: [file] }));
  importer.excel.mockResolvedValue({ batch });
  await page.uploadExcel();
  expect(page.data.activeImport).toBe('excel');

  page.onImportModeChange(event({ mode: 'team' }));
  importer.teamExcel.mockResolvedValue({ status: 'imported', created: 2, updated: 0, unchanged: 0, undatedRows: 0 });
  const importing = page.uploadTeam();
  page.onImportModeChange(event({ mode: 'enode' }));
  expect(page.data.activeImport).toBe('team');
  await importing;

  page.onImportModeChange(event({ mode: 'excel' }));
  expect(page.data.excel.filename).toBe(file.name);
  expect(page.data.receipts.excel).toBe('');
  importer.updatePeople.mockResolvedValue({ batch: { ...batch, revision: 2, athleteCandidates: [{ ...person, confirmed: true }] } });
  importer.commitExcel.mockResolvedValue({ message: 'Excel 已导入' });
  await page.commitExcel();

  expect(page.data.receipts.excel).toBe('Excel 已导入');
  expect(page.data.receipts.team).toContain('新增 2 项');
  page.onProjectChange(event({}, '1'));
  expect(page.data.receipts).toEqual({ excel: '', team: '', enode: '' });
});
