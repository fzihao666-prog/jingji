const api = require('../../services/api');
const { loadContext } = require('../../utils/context');
const { createInitialScope, applyScopeChange, saveProjectInOrder, isPageCacheFresh, markPageCacheLoaded } = require('../../utils/page-scope');
const { createRequestGuard, loadWithGuard } = require('../../utils/request-guard');
const { ageAt } = require('../../utils/date');
const { number, maskIdentity, maskPhone, INJURY_LABELS, strengthMetricRows } = require('../../utils/format');

function profileView(athlete, injuryRecords, overview, benchmark, period) {
  const age = ageAt(athlete.birthDate, period.to);
  const photoUrl = api.assetUrl(athlete.photoUrl);
  const cells = [
    ['项目', athlete.project || '未录入'],
    ['队伍', athlete.team || '未分队'],
    ['性别', athlete.gender || '未录入'],
    ['年龄', age == null ? '未录入' : `${age}岁`],
    ['身高', athlete.heightCm == null ? '未测试' : `${number(athlete.heightCm)} cm`],
    ['体重', athlete.weightKg == null ? '未测试' : `${number(athlete.weightKg)} kg`],
    ['体脂率', athlete.bodyFatPct == null ? '未测试' : `${number(athlete.bodyFatPct)}%`],
    ['骨骼肌', athlete.skeletalMuscleKg == null ? '未测试' : `${number(athlete.skeletalMuscleKg)} kg`],
    ['技术等级', athlete.technicalLevel || '未录入'],
    ['运动员位置', athlete.athletePosition || '未录入'],
    ['当前小项', athlete.currentEvent || '未录入'],
    ['训练阶段', athlete.trainingPhase || '未录入'],
    ['健康状态', athlete.healthStatus || '未录入'],
    ['最好成绩', athlete.bestResult || '未录入'],
    ['联系电话', maskPhone(athlete.phone)],
    ['身份信息', maskIdentity(athlete.identityNumber)]
  ].map(([label, value]) => ({ label, value }));
  const primaryLabels = new Set(['项目', '队伍', '性别', '年龄', '身高', '体重', '当前小项', '健康状态']);
  const primaryCells = cells.filter((item) => primaryLabels.has(item.label));
  const moreCells = cells.filter((item) => !primaryLabels.has(item.label));

  const injuries = [...(injuryRecords || [])].sort((a, b) => String(b.createdAt || b.onsetDate).localeCompare(String(a.createdAt || a.onsetDate))).slice(0, 8).map((item) => ({
    id: item.id,
    title: item.injuryName || '伤病与恢复记录',
    meta: `${item.bodyPart || '部位未录入'} · ${item.onsetDate || '日期未录入'}`,
    status: INJURY_LABELS[item.status] || item.status,
    statusClass: item.status === 'healthy' ? '' : item.status === 'observation' ? 'warn' : 'danger',
    pain: `疼痛 ${number(item.painScore, 0)}`,
    restriction: item.restrictions || item.rehabPlan || item.note || '暂无补充说明'
  }));

  const tests = [...((overview && overview.strengthTests) || [])].sort((a, b) => b.testDate.localeCompare(a.testDate));
  const latestTest = tests[0] || null;
  const testMetrics = strengthMetricRows(latestTest).slice(0, 8);
  const benchmarkSummary = benchmark && benchmark.summary ? {
    score: benchmark.summary.score == null ? '—' : number(benchmark.summary.score),
    achieved: benchmark.summary.achieved || 0,
    comparable: benchmark.summary.comparable || 0,
    primaryGap: benchmark.summary.primaryGap || '暂无可比指标',
    source: benchmark.summary.source || '当前项目模型'
  } : null;
  const overviewMeta = overview && overview.meta ? overview.meta : {};
  const trainingSummary = [
    { label: '训练课次', value: number(overviewMeta.sessionCount || 0, 0), unit: '次', note: `${period.from} 至 ${period.to}` },
    { label: '数据覆盖', value: number(overviewMeta.coverage || 0, 0), unit: '%', note: overviewMeta.containsDemoData ? '包含明确标注的演示数据' : '当前范围未标记演示数据' },
    { label: '测试次数', value: number(overviewMeta.testCount || 0, 0), unit: '次', note: '统一测试指标记录' },
    { label: '恢复日报', value: number(overviewMeta.wellnessDays || 0, 0), unit: '天', note: '当前时间范围内记录' }
  ];

  return {
    athleteName: athlete.name,
    athleteMeta: `${athlete.project || '项目未录入'} · ${athlete.team || '未分队'}`,
    athleteSubline: `${athlete.gender || '性别未录入'} · ${age == null ? '年龄未录入' : `${age}岁`} · ${athlete.currentEvent || '小项未录入'}`,
    athleteInitial: athlete.name ? athlete.name.slice(0, 1) : '运',
    photoUrl,
    primaryCells,
    moreCells,
    injuries,
    testMetrics,
    latestTestDate: latestTest ? latestTest.testDate : '',
    benchmarkSummary,
    trainingSummary
  };
}

Page({
  data: {
    loading: true,
    error: '',
    projects: [],
    project: '',
    athletes: [],
    selectedAthleteId: 0,
    showAthlete: true,
    range: 'month',
    from: '',
    to: '',
    athleteName: '',
    athleteMeta: '',
    athleteSubline: '',
    athleteInitial: '运',
    photoUrl: '',
    primaryCells: [],
    moreCells: [],
    showMore: false,
    injuries: [],
    testMetrics: [],
    latestTestDate: '',
    benchmarkSummary: null,
    trainingSummary: [],
    canEditSelf: false
  },

  onShow() { if (!isPageCacheFresh(this)) this.loadPage(); },
  onPullDownRefresh() { this.loadPage().finally(() => wx.stopPullDownRefresh()); },

  loadPage() {
    this._guard = this._guard || createRequestGuard();
    return loadWithGuard(this, this._guard, async (isLatest) => {
      const context = await loadContext();
      if (!isLatest()) return null;
      const scope = createInitialScope(context, {
        range: this.data.range,
        selectedAthleteId: getApp().globalData.selectedAthleteId
      });
      getApp().globalData.selectedAthleteId = scope.selectedAthleteId;
      this.setData({ ...scope, canEditSelf: scope.user.role === 'ATL' });
      const result = await this.loadPageData(scope);
      if (isLatest()) markPageCacheLoaded(this);
      return result;
    }, '运动员档案加载失败。');
  },

  async loadPageData(scope) {
    const athleteId = scope.selectedAthleteId;
    if (!athleteId) return { athleteName: '', primaryCells: [], moreCells: [], showMore: false, injuries: [], testMetrics: [], benchmarkSummary: null, trainingSummary: [] };
    const athlete = scope.athletes.find((item) => Number(item.id) === Number(athleteId));
    if (!athlete) throw new Error('当前项目中未找到该运动员。');
    const [injuryResult, overviewResult, benchmarkResult] = await Promise.all([
      api.injuryRecords(athleteId),
      api.personalOverview(athleteId, scope.from, scope.to, scope.project),
      api.championBenchmark(athleteId).catch(() => ({ benchmark: null }))
    ]);
    return { showMore: false, ...profileView(athlete, injuryResult.records, overviewResult.overview, benchmarkResult.benchmark, scope) };
  },

  onScopeChange(event) {
    const change = applyScopeChange(this, event);
    if (!change) return Promise.resolve();
    if (change.field === 'project') this.setData({ athleteName: '', primaryCells: [], moreCells: [], showMore: false, injuries: [], testMetrics: [], benchmarkSummary: null, trainingSummary: [] });
    return loadWithGuard(this, this._guard, async (isLatest) => {
      if (change.field === 'project') await saveProjectInOrder(this, change.patch.project, api.saveCurrentProject);
      if (!isLatest()) return null;
      return this.loadPageData(this.data);
    }, '运动员档案加载失败。');
  },

  toggleMore() {
    this.setData({ showMore: !this.data.showMore });
  },

  editMyProfile() {
    wx.navigateTo({ url: '/pages/profile-edit/profile-edit' });
  }
});
