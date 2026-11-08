const api = require('../../services/api');
const importer = require('../../services/data-import');
const { projectOptions } = require('../../utils/project-label');
const { PAGE_SIZE, reviewPeople, reviewIssues, issuePreview, sourceFields } = require('./review');

const MiB = 1024 * 1024;
const templates = [
  { id: 'profile', label: '队员资料' }, { id: 'training', label: '训练记录' },
  { id: 'test', label: '测试成绩' }, { id: 'unified', label: '统一数据' },
  { id: 'team', label: '队伍训练统计' }
];

const blankReview = {
  excel: null, people: [], peopleMore: false, issues: [], issuesMore: false, editor: null,
  mappings: [], enode: null, enodeTeam: '', enodePeople: [], enodeMore: false,
  receipt: '', enodeResults: []
};

function chooseFiles(enode) {
  return new Promise((resolve, reject) => wx.chooseMessageFile({
    count: enode ? 12 : 1,
    type: 'file',
    ...(enode ? {} : { extension: ['xls', 'xlsx'] }),
    success({ tempFiles }) {
      const files = (tempFiles || []).map(({ name, size, path }) => ({ name, size, path }));
      if (files.length > (enode ? 12 : 1) || files.some(({ name, path, size }) =>
        !name || !path || !Number.isSafeInteger(size) || size <= 0 || size > (enode ? 12 : 80) * MiB
      )) return reject(new Error(enode ? '每次最多选择 12 份有效文件，单份不超过 12MB。' : '请选择不超过 80MB 的有效 Excel 文件。'));
      if (!enode && files.some(({ name }) => !/\.(xls|xlsx)$/i.test(name)))
        return reject(new Error('请选择 XLS 或 XLSX 文件。'));
      resolve(files);
    },
    fail(error) {
      if (/cancel/i.test(error.errMsg || '')) resolve([]);
      else reject(new Error('无法打开微信文件选择器，请重试。'));
    }
  }));
}

function ask(title, content) {
  return new Promise((resolve) => wx.showModal({
    title, content, success: ({ confirm }) => resolve(confirm), fail: () => resolve(false)
  }));
}

Page({
  data: {
    ...blankReview, templates, allowed: false, project: '', projects: [], projectIndex: 0,
    teams: [], teamIndex: -1, busy: '', error: ''
  },

  onLoad() {
    const { token, user } = getApp().globalData;
    if (!token) {
      wx.reLaunch({ url: '/pages/login/login' });
      return;
    }
    if (!importer.canImport(user)) return;
    this.setData({ allowed: true });
    return this.loadScope();
  },

  async run(busy, action) {
    if (this._busy || this._closed) return;
    this._busy = true;
    this.setData({ busy, error: '' });
    try {
      await action();
    } catch (error) {
      this.showError(error.message || '操作失败，请重试。');
    } finally {
      this._busy = false;
      if (!this._closed) this.setData({ busy: '' });
    }
  },

  showError(error) {
    if (!this._closed) this.setData({ error }, () => {
      if (!this._closed) wx.pageScrollTo({ selector: '#import-error', duration: 0 });
    });
  },

  onUnload() { this._closed = true; },

  loadScope() {
    return this.run('读取项目和队伍', async () => {
      const [scope, { teams }] = await Promise.all([api.currentProject(), importer.teams()]);
      if (this._closed) return;
      const projects = projectOptions(scope.projects);
      const current = getApp().globalData.currentProject;
      const project = scope.projects.includes(current) ? current : scope.project;
      if (!projects.length) throw new Error('当前账号没有可导入的项目。');
      this._teams = teams;
      this.setData({ projects });
      this.setProject(Math.max(0, projects.findIndex(({ code }) => code === project)));
    });
  },

  setProject(index) {
    const project = this.data.projects[index].code;
    const teams = this._teams.filter((team) => team.project === project);
    this._batch = this._teamFile = this._enodeFiles = this._enodePreview = null;
    this._enodeChoices = new Map();
    this.setData({
      ...blankReview, project, projectIndex: index, teams, teamIndex: teams.length === 1 ? 0 : -1, error: ''
    });
  },

  onProjectChange(event) {
    if (!this.data.busy) this.setProject(Number(event.detail.value));
  },

  onTeamChange(event) {
    if (this.data.busy) return;
    this._teamFile = null;
    this.setData({ teamIndex: Number(event.detail.value), mappings: [], error: '', receipt: '', enodeResults: [] });
  },

  downloadTemplate(event) {
    const { kind } = event.currentTarget.dataset;
    return this.run('下载模板', async () => {
      const path = await importer.template(kind, this.data.project);
      if (this._closed) return;
      await new Promise((resolve, reject) => wx.openDocument({
        filePath: path, fileType: 'xlsx', showMenu: true, success: resolve,
        fail: () => reject(new Error('模板已下载，微信暂时无法打开，请重试。'))
      }));
    });
  },

  uploadExcel() {
    return this.run('解析 Excel', async () => {
      const [file] = await chooseFiles(false);
      if (!file || this._closed) return;
      const { batch } = await importer.excel(file, this.data.project);
      if (this._closed) return;
      this.setData({ receipt: '', enodeResults: [] });
      this.renderExcel(batch, true);
    });
  },

  renderExcel(batch, reset = false) {
    if (this._closed) return;
    this._batch = batch;
    this._people = reviewPeople(batch);
    this._issues = reviewIssues(batch);
    if (reset) this._peoplePage = this._issuesPage = 0;
    this._peoplePage = Math.min(this._peoplePage, Math.max(0, Math.ceil(this._people.length / PAGE_SIZE) - 1));
    this._issuesPage = Math.min(this._issuesPage, Math.max(0, Math.ceil(this._issues.length / PAGE_SIZE) - 1));
    const { newCount, overwriteCount } = batch.counts;
    this.setData({
      excel: {
        filename: batch.filename, newCount, overwriteCount, issues: this._issues.length,
        newPeople: this._people.filter((person) => person.isNew).length,
        needsPeople: this._people.filter((person) => person.needsTeam || person.needsMatch).length
      },
      editor: null
    });
    this.renderExcelPage();
  },

  renderExcelPage() {
    const people = this._people.filter((person) => person.needsTeam || person.needsMatch || person.isNew).sort((a, b) =>
      Number(b.needsTeam || b.needsMatch) - Number(a.needsTeam || a.needsMatch) || Number(b.isNew) - Number(a.isNew)
    );
    this.setData({
      people: people.slice(this._peoplePage * PAGE_SIZE, (this._peoplePage + 1) * PAGE_SIZE),
      peopleMore: (this._peoplePage + 1) * PAGE_SIZE < people.length, peopleBack: this._peoplePage > 0,
      issues: this._issues.slice(this._issuesPage * PAGE_SIZE, (this._issuesPage + 1) * PAGE_SIZE).map(issuePreview),
      issuesMore: (this._issuesPage + 1) * PAGE_SIZE < this._issues.length, issuesBack: this._issuesPage > 0
    });
  },

  pageReview(event) {
    if (this.data.busy) return;
    const { list, step } = event.currentTarget.dataset;
    if (list === 'people') this._peoplePage += Number(step);
    else this._issuesPage += Number(step);
    this.setData({ editor: null });
    this.renderExcelPage();
  },

  changeExcelPerson(event) {
    const { id, kind } = event.currentTarget.dataset;
    const index = Number(event.detail.value);
    const person = this._people.find((entry) => entry.id === Number(id));
    const patch = kind === 'team'
      ? { team: this.data.teams[index].name, matchedAthleteId: null, confirmed: false }
      : { matchedAthleteId: person.candidates[index].id, confirmed: true };
    return this.run('保存人员', async () => {
      const { batch } = await importer.updatePeople(this._batch, [{ id: person.id, ...patch }]);
      this.renderExcel(batch);
    });
  },

  editIssue(event) {
    const id = Number(event.currentTarget.dataset.id);
    const item = this._issues.find((entry) => entry.id === id);
    if (!item) return;
    const fields = sourceFields(item);
    const sessions = (item.payload.sessionChoices || []).filter((entry) => Number.isSafeInteger(entry.sessionOrder));
    const dateError = item.messages.some((message) => message.includes('日期') && /无效|缺失/.test(message));
    const dateIndex = fields.findIndex(({ date }) => date);
    const index = dateError && dateIndex >= 0 ? dateIndex : 0;
    this.setData({ editor: { id, fields, index, value: fields[index]?.value || '', sessions } });
  },

  changeSourceField(event) {
    const index = Number(event.detail.value);
    this.setData({ 'editor.index': index, 'editor.value': this.data.editor.fields[index].value });
  },

  changeSourceValue(event) { this.setData({ 'editor.value': event.detail.value }); },

  saveSource() {
    const { id, fields, index, value } = this.data.editor;
    return this.saveItems([{ id, sourceCells: { [fields[index].name]: value } }]);
  },

  chooseSession(event) {
    const { id, sessions } = this.data.editor;
    return this.saveItems([{ id, payload: { sessionOrder: sessions[Number(event.detail.value)].sessionOrder } }]);
  },

  skipIssue(event) {
    const id = Number(event.currentTarget.dataset.id);
    return this.run('更新校对结果', async () => {
      if (!await ask('跳过记录', '本次导入将跳过这条记录。') || this._closed) return;
      const { batch } = await importer.updateItems(this._batch, [{ id, resolution: 'skip' }]);
      this.renderExcel(batch);
    });
  },

  saveItems(corrections) {
    return this.run('重新校验', async () => {
      const { batch } = await importer.updateItems(this._batch, corrections);
      this.renderExcel(batch);
    });
  },

  commitExcel() {
    if (!this._batch || this.data.excel.issues || this.data.excel.needsPeople) return;
    return this.run('保存 Excel', async () => {
      const pending = this._people.filter((person) => person.needsConfirmation)
        .map(({ id }) => ({ id, confirmed: true }));
      if (pending.length) {
        const { batch } = await importer.updatePeople(this._batch, pending);
        this.renderExcel(batch);
        if (this.data.excel.issues || this.data.excel.needsPeople) return;
      }
      if (this._closed) return;
      const result = await importer.commitExcel(this._batch);
      this._batch = null;
      this.finish(result.message || 'Excel 导入完成。', { excel: null, people: [], issues: [], editor: null });
    });
  },

  uploadTeam() {
    const team = this.data.teams[this.data.teamIndex];
    if (!team) return;
    return this.run('解析队伍 Excel', async () => {
      const [file] = await chooseFiles(false);
      if (!file || this._closed) return;
      this._teamFile = file;
      this.setData({ mappings: [], receipt: '', enodeResults: [] });
      await this.submitTeam(team.id, {});
    });
  },

  changeMapping(event) {
    const { index, field } = event.currentTarget.dataset;
    this.setData({ [`mappings[${index}].${field}`]: event.detail.value });
  },

  saveMappings() {
    const { teams, teamIndex, mappings } = this.data;
    const choices = Object.fromEntries(mappings.map((entry) => [
      entry.key, { category: entry.category.trim(), unit: entry.unit.trim() }
    ]));
    if (Object.values(choices).some(({ category, unit }) => !category || !unit)) {
      this.showError('请填写分项名称和单位。');
      return;
    }
    if (!this._teamFile || !teams[teamIndex]) return;
    return this.run('保存队伍训练', () => this.submitTeam(teams[teamIndex].id, choices));
  },

  async submitTeam(teamId, mappings) {
    const result = await importer.teamExcel(this._teamFile, this.data.project, teamId, mappings);
    if (this._closed) return;
    if (result.status === 'mapping_required') {
      this.setData({ mappings: result.columns.map(({ key, label, unit }) => ({
        key, label, unit, fixedUnit: !!unit, category: unit ? label.slice(0, -unit.length - 3) : label
      })) });
      return;
    }
    this._teamFile = null;
    this.finish(`新增 ${result.created} 项，更新 ${result.updated} 项，相同 ${result.unchanged} 项，跳过无日期 ${result.undatedRows} 行。`, { mappings: [] });
  },

  uploadEnode() {
    return this.run('解析 Enode 文件', async () => {
      const files = await chooseFiles(true);
      if (!files.length || this._closed) return;
      const preview = await importer.enodePreview(files, this.data.project);
      if (this._closed) return;
      this._enodeFiles = files;
      this._enodePreview = preview;
      this._enodeChoices = new Map();
      this._enodePage = 0;
      this.setData({ enodeTeam: preview.teams.length === 1 ? preview.teams[0] : '', receipt: '', enodeResults: [] });
      this.renderEnode();
    });
  },

  renderEnode() {
    const { people, teams, files } = this._enodePreview;
    const peopleSorted = [...people].sort((a, b) =>
      Number(b.candidates.length !== 1) - Number(a.candidates.length !== 1)
    );
    const pending = people.filter((person) => person.candidates.length > 1
      ? !this._enodeChoices.has(person.key)
      : !person.candidates.length && !this.data.enodeTeam).length;
    this.setData({
      enode: { teams, count: people.length, pending, errors: files.filter(({ error }) => error) },
      enodePeople: peopleSorted.slice(this._enodePage * PAGE_SIZE, (this._enodePage + 1) * PAGE_SIZE).map((person) => {
        const options = person.candidates.map(({ id, name, team }) => ({ id, label: `${name} · ${team} · 编号 ${id}` }));
        return { ...person, options, selectedLabel: options.find(({ id }) => id === this._enodeChoices.get(person.key))?.label || '' };
      }),
      enodeBack: this._enodePage > 0, enodeMore: (this._enodePage + 1) * PAGE_SIZE < people.length,
      enodeHasNew: people.some((person) => !person.candidates.length)
    });
  },

  changeEnodeTeam(event) {
    this.setData({ enodeTeam: this._enodePreview.teams[Number(event.detail.value)] });
    this.renderEnode();
  },

  changeEnodePerson(event) {
    const { key } = event.currentTarget.dataset;
    const person = this._enodePreview.people.find((entry) => entry.key === key);
    this._enodeChoices.set(key, person.candidates[Number(event.detail.value)].id);
    this.renderEnode();
  },

  pageEnode(event) {
    this._enodePage += Number(event.currentTarget.dataset.step);
    this.renderEnode();
  },

  commitEnode() {
    if (!this._enodePreview || this.data.enode.pending || !this.data.enode.count) return;
    return this.run('保存 Enode 数据', async () => {
      const decisions = Object.fromEntries(this._enodePreview.people.map((person) => [
        person.key, person.candidates.length
          ? { action: 'link', athleteId: this._enodeChoices.get(person.key) || person.candidates[0].id }
          : { action: 'create', team: this.data.enodeTeam }
      ]));
      const { summary, results } = await importer.enodeImport(this._enodeFiles, this.data.project, decisions);
      this._enodePreview = this._enodeFiles = null;
      this.finish(`已关联 ${summary.linked} 人，新建 ${summary.created} 人。`, {
        enode: null, enodePeople: [], enodeResults: results.map(({ filename, inserted, skipped, failed, issues }, index) => ({
          index, filename, inserted, skipped, failed, issues: issues.slice(0, 3)
        }))
      });
    });
  },

  finish(receipt, data) {
    const app = getApp();
    app.globalData.dataVersion = (app.globalData.dataVersion || 0) + 1;
    if (!this._closed) this.setData({ receipt, ...data }, () => {
      if (!this._closed) wx.pageScrollTo({ selector: '#import-receipt', duration: 0 });
    });
  }
});
