const api = require('../../services/api');
const { applyScopeChange, saveProjectInOrder, isPageCacheFresh, loadPage: runPageLoad } = require('../../utils/page-scope');
const { loadWithGuard } = require('../../utils/request-guard');
const { ageAt, todayBeijing } = require('../../utils/date');
const { number, maskIdentity, maskPhone, INJURY_LABELS, strengthMetricRows } = require('../../utils/format');
const { reviewDueLabel } = require('../../utils/daily-todos');
const { projectLabel } = require('../../utils/project-label');
const { bodyCompositionTrendView, trainingComparisonView, radarGroupView, wellnessTrendsView } = require('../../utils/profile-views');
const radarChart = require('../../utils/radar-chart');
const { bodyCompositionGroups } = require('../../utils/body-composition-groups');
const { trainingComparisonGroups } = require('../../utils/training-comparison-groups');

const MANAGER_ROLES = ['SCC', 'PRJ', 'REG', 'TD', 'DMD'];

// 复查倒计时按北京日期差本地计算，文案复用待办工具的同一套规则。
function reviewCountdown(reviewDate, status, today) {
  if (status === 'healthy' || !/^\d{4}-\d{2}-\d{2}$/.test(reviewDate || '')) return '';
  const diff = Math.round(
    (Date.parse(`${reviewDate}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400000
  );
  return reviewDueLabel(diff);
}

const PAIN_SOURCE_LABELS = { formal: '伤病记录', feedback: '疼痛反馈' };

// 疼痛趋势只读视图：柱高为评分占比，点击柱体查看单日明细；不输出趋势结论。
function painTrendView(trend) {
  if (!trend || !Array.isArray(trend.parts) || !trend.parts.length) return null;
  return {
    days: trend.days,
    parts: trend.parts.map((part) => ({
      bodyPart: part.bodyPart,
      statusLabel: INJURY_LABELS[part.latestStatus] || part.latestStatus,
      statusClass: part.latestStatus === 'healthy' ? '' : part.latestStatus === 'observation' ? 'warn' : 'danger',
      latestPain: number(part.latestPainScore, 0),
      bars: part.series.map((point) => ({
        date: point.date,
        pain: point.painScore,
        height: Math.max(8, Math.round((point.painScore / 10) * 100)),
        sourceLabel: PAIN_SOURCE_LABELS[point.recordType] || point.recordType,
      })),
    })),
  };
}

function profileView(athlete, injuryRecords, overview, benchmark, period) {
  const age = ageAt(athlete.birthDate, period.to);
  const cells = [
    ['项目', projectLabel(athlete.project)],
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

  const today = todayBeijing();
  const injuries = [...(injuryRecords || [])].sort((a, b) => String(b.createdAt || b.onsetDate).localeCompare(String(a.createdAt || a.onsetDate))).slice(0, 8).map((item) => {
    const reviewLabel = reviewCountdown(item.reviewDate, item.status, today);
    return {
      id: item.id,
      title: item.injuryName || '伤病与恢复记录',
      meta: `${item.bodyPart || '部位未录入'} · ${item.onsetDate || '日期未录入'}${reviewLabel ? ' · ' + reviewLabel : ''}`,
      status: INJURY_LABELS[item.status] || item.status,
      statusClass: item.status === 'healthy' ? '' : item.status === 'observation' ? 'warn' : 'danger',
      pain: `疼痛 ${number(item.painScore, 0)}`,
      restriction: item.restrictions || item.rehabPlan || item.note || '暂无补充说明'
    };
  });

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
    athleteMeta: `${projectLabel(athlete.project)} · ${athlete.team || '未分队'}`,
    athleteSubline: `${athlete.gender || '性别未录入'} · ${age == null ? '年龄未录入' : `${age}岁`} · ${athlete.currentEvent || '小项未录入'}`,
    athleteInitial: athlete.name ? athlete.name.slice(0, 1) : '运',
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
    canEditSelf: false,
    canReportRole: false,
    canCoachFill: false,
    painTrend: null,
    wellnessTrend: { metrics: [] },
    bodyCompositionHistory: [],
    bodyCompositionTrend: { dates: [], metrics: [] },
    bodyCompositionGroups: [],
    profileComparison: null,
    comparisonView: { items: [] },
    trainingComparisonGroups: [],
    radarGroups: []
  },

  onShow() { if (!isPageCacheFresh(this)) this.loadPage(); },
  onPullDownRefresh() { this.loadPage().finally(() => wx.stopPullDownRefresh()); },

  loadPage() {
    return runPageLoad(this, {
      error: '运动员档案加载失败。',
      scope: {
        range: this.data.range,
        selectedAthleteId: getApp().globalData.selectedAthleteId
      },
      prepare: (page, scope) => {
        getApp().globalData.selectedAthleteId = scope.selectedAthleteId;
        page.setData({
          ...scope,
          canEditSelf: scope.user.role === 'ATL',
          canReportRole: scope.user.role === 'ATL' || MANAGER_ROLES.includes(scope.user.role),
          canCoachFill: MANAGER_ROLES.includes(scope.user.role)
        });
      }
    }).then((result) => {
      this.scheduleRadarDraw();
      return result;
    });
  },

  async loadPageData(scope) {
    const athleteId = scope.selectedAthleteId;
    if (!athleteId) return { athleteName: '', primaryCells: [], moreCells: [], showMore: false, injuries: [], testMetrics: [], benchmarkSummary: null, trainingSummary: [], painTrend: null, wellnessTrend: { metrics: [] }, bodyCompositionHistory: [], bodyCompositionTrend: { dates: [], metrics: [] }, profileComparison: null, comparisonView: { items: [] }, trainingComparisonGroups: [], radarGroups: [] };
    const athlete = scope.athletes.find((item) => Number(item.id) === Number(athleteId));
    if (!athlete) throw new Error('当前项目中未找到该运动员。');
    const [injuryResult, overviewResult, benchmarkResult] = await Promise.all([
      api.injuryRecords(athleteId),
      api.personalOverview(athleteId, scope.from, scope.to, scope.project),
      api.championBenchmark(athleteId).catch(() => ({ benchmark: null }))
    ]);
    let painTrend;
    try {
      painTrend = painTrendView(await api.painTrend(athleteId, 30));
    } catch {
      painTrend = null;
    }
    let wellnessTrend;
    try {
      const wr = await api.wellnessTrends(athleteId, scope.from, scope.to, scope.project);
      wellnessTrend = wellnessTrendsView(wr.trends || []);
    } catch {
      wellnessTrend = wellnessTrendsView([]);
    }
    let bodyCompositionHistory;
    try {
      const bc = await api.getBodyCompositionHistory(athleteId);
      const records = bc.history || [];
      const labelMap = {
        weightKg: '体重', bodyFatPct: '体脂率', skeletalMuscleKg: '骨骼肌',
        muscleMassKg: '肌肉量', totalBodyWaterKg: '体水分', visceralFatLevel: '内脏脂肪等级',
        basalMetabolismKcal: '基础代谢'
      };
      const unitMap = {
        weightKg: 'kg', bodyFatPct: '%', skeletalMuscleKg: 'kg',
        muscleMassKg: 'kg', totalBodyWaterKg: 'kg', visceralFatLevel: '', basalMetabolismKcal: 'kcal'
      };
      bodyCompositionHistory = records.slice(0, 6).map((r, i) => {
        const prev = records[i + 1] || null;
        return {
          measurementDate: r.measurementDate,
          items: Object.entries(r)
            .filter(([k]) => labelMap[k] && r[k] != null)
            .map(([k, v]) => ({
              key: k, label: labelMap[k], value: v, unit: unitMap[k] || '',
              delta: prev && prev[k] != null ? Number((v - prev[k]).toFixed(1)) : null
            }))
        };
      });
    } catch {
      bodyCompositionHistory = [];
    }
    let profileComparison;
    try {
      const pc = await api.profileComparison(athleteId, scope.from, scope.to, scope.project);
      profileComparison = pc.comparison || null;
    } catch {
      profileComparison = null;
    }
    let radarGroups = [];
    try {
      const rm = await api.radarModels(athleteId, scope.from, scope.to);
      if (rm) {
        radarGroups = [
          radarGroupView(rm.special, { title: '专项测试雷达', canvasId: 'radarSpecial' }),
          radarGroupView(rm.physical, { title: '体能测试雷达', canvasId: 'radarPhysical' })
        ].filter((group) => group.dimensions.length);
      }
    } catch {
      radarGroups = [];
    }
    let photoUrl = '';
    if (athlete.photoUrl) {
      photoUrl = await api.downloadAthletePhoto(athleteId);
    }
    const bodyCompositionTrend = bodyCompositionTrendView(bodyCompositionHistory);
    const comparisonView = trainingComparisonView(profileComparison);
    return { showMore: false, photoUrl, painTrend, ...profileView(athlete, injuryResult.records, overviewResult.overview, benchmarkResult.benchmark, scope), wellnessTrend, bodyCompositionHistory, bodyCompositionTrend, bodyCompositionGroups: bodyCompositionGroups(bodyCompositionTrend.metrics), profileComparison, comparisonView, trainingComparisonGroups: trainingComparisonGroups(comparisonView.items), radarGroups };
  },

  onScopeChange(event) {
    const change = applyScopeChange(this, event);
    if (!change) return Promise.resolve();
    if (change.field === 'project') this.setData({ athleteName: '', primaryCells: [], moreCells: [], showMore: false, injuries: [], testMetrics: [], benchmarkSummary: null, trainingSummary: [], painTrend: null });
    return loadWithGuard(this, this._guard, async (isLatest) => {
      if (change.field === 'project') await saveProjectInOrder(this, change.patch.project, api.saveCurrentProject);
      if (!isLatest()) return null;
      return this.loadPageData(this.data);
    }, '运动员档案加载失败。').then((result) => {
      this.scheduleRadarDraw();
      return result;
    });
  },

  toggleMore() {
    this.setData({ showMore: !this.data.showMore });
  },

  editMyProfile() {
    wx.navigateTo({ url: '/pages/profile-edit/profile-edit' });
  },

  reportInjury() {
    const athleteId = Number(this.data.selectedAthleteId) || 0;
    if (!athleteId) return;
    wx.navigateTo({ url: `/pages/injury-report/injury-report?athleteId=${athleteId}` });
  },

  // 疼痛趋势柱体点击：展示单日评分与来源，不做趋势解读。
  showPainDetail(event) {
    const partIndex = Number(event.currentTarget.dataset.partIndex) || 0;
    const barIndex = Number(event.currentTarget.dataset.barIndex) || 0;
    const part = ((this.data.painTrend && this.data.painTrend.parts) || [])[partIndex];
    const bar = part && part.bars[barIndex];
    if (!part || !bar) return;
    wx.showModal({
      title: `${part.bodyPart} · ${bar.date}`,
      content: `疼痛评分：${bar.pain} 分\n数据来源：${bar.sourceLabel}`,
      showCancel: false,
      confirmText: '知道了'
    });
  },

  toggleTrainingComparisonGroup(event) {
    const key = event.currentTarget.dataset.groupKey;
    this.setData({
      trainingComparisonGroups: this.data.trainingComparisonGroups.map((group) => ({
        ...group,
        expanded: group.key === key && !group.expanded
      }))
    });
  },

  toggleBodyCompositionGroup(event) {
    const key = event.currentTarget.dataset.groupKey;
    this.setData({
      bodyCompositionGroups: this.data.bodyCompositionGroups.map((group) => ({
        ...group,
        expanded: group.key === key && !group.expanded
      }))
    });
  },

  // 身体成分趋势柱体点击：展示该日期该指标的实测值与环比，不输出趋势结论。
  showBodyCompositionDetail(event) {
    const metricIndex = Number(event.currentTarget.dataset.metricIndex) || 0;
    const pointIndex = Number(event.currentTarget.dataset.pointIndex) || 0;
    const metric = ((this.data.bodyCompositionTrend && this.data.bodyCompositionTrend.metrics) || [])[metricIndex];
    const point = metric && metric.points[pointIndex];
    if (!metric || !point) return;
    if (point.missing) {
      wx.showModal({
        title: `${metric.label} · ${point.date}`,
        content: '该日期未测此项指标。',
        showCancel: false,
        confirmText: '知道了'
      });
      return;
    }
    const deltaText =
      point.delta == null
        ? '与上一次无可比记录'
        : `较上一次 ${point.delta > 0 ? '+' : ''}${point.delta}${metric.unit}`;
    wx.showModal({
      title: `${metric.label} · ${point.date}`,
      content: `实测值：${point.value}${metric.unit}\n${deltaText}`,
      showCancel: false,
      confirmText: '知道了'
    });
  },

  // 恢复趋势柱体点击：展示当日个人实测与队均，不做趋势解读。
  showWellnessDetail(event) {
    const metricIndex = Number(event.currentTarget.dataset.metricIndex) || 0;
    const pointIndex = Number(event.currentTarget.dataset.pointIndex) || 0;
    const metric = ((this.data.wellnessTrend && this.data.wellnessTrend.metrics) || [])[metricIndex];
    const point = metric && metric.points[pointIndex];
    if (!metric || !point) return;
    const personalLine = point.missing ? '个人实测：未测' : `个人实测：${point.valueText}${metric.unit}`;
    const teamLine = point.teamText
      ? `当日队均：${point.teamText}${metric.unit}${point.teamSampleCount != null ? `（${point.teamSampleCount} 人）` : ''}`
      : '当日队均样本不足';
    wx.showModal({
      title: `${metric.label} · ${point.date}`,
      content: `${personalLine}\n${teamLine}`,
      showCancel: false,
      confirmText: '知道了'
    });
  },

  // 雷达 canvas：数据渲染完成后下一帧绘制；画布不存在或维度不足时静默跳过，明细列表兜底。
  scheduleRadarDraw() {
    wx.nextTick(() => this.drawRadars());
  },

  drawRadars() {
    (this.data.radarGroups || []).forEach((group) => {
      if (group.hasChart) this.drawRadarCanvas(group);
    });
  },

  drawRadarCanvas(group) {
    const query = wx.createSelectorQuery().in(this);
    query
      .select(`#${group.canvasId}`)
      .fields({ node: true, size: true })
      .exec((result) => {
        const target = result && result[0];
        if (!target || !target.node || !target.width || !target.height) return;
        const canvas = target.node;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        const dpr = wx.getSystemInfoSync().pixelRatio || 1;
        canvas.width = target.width * dpr;
        canvas.height = target.height * dpr;
        ctx.scale(dpr, dpr);
        const size = Math.min(target.width, target.height);
        ctx.translate((target.width - size) / 2, (target.height - size) / 2);
        const layout = radarChart.radarLayout({ size, padding: 26, max: group.maxValue, rings: 4 });
        const axes = radarChart.radarAxes(group.dimensions.length, layout);
        radarChart.drawRadar(ctx, layout, axes, [
          {
            points: radarChart.radarSeriesPoints(group.referenceValues, axes, layout),
            stroke: '#d79617',
            dashed: true,
            lineWidth: 2
          },
          {
            points: radarChart.radarSeriesPoints(group.personalValues, axes, layout),
            stroke: '#168f88',
            fill: 'rgba(22, 143, 136, 0.16)',
            lineWidth: 3,
            dot: 3
          }
        ]);
      });
  },

  fillTraining() {
    const athleteId = Number(this.data.selectedAthleteId) || 0;
    if (!athleteId) return;
    wx.navigateTo({ url: `/pages/training-entry/training-entry?athleteId=${athleteId}` });
  },

  fillWellness() {
    const athleteId = Number(this.data.selectedAthleteId) || 0;
    if (!athleteId) return;
    wx.navigateTo({ url: `/pages/wellness-entry/wellness-entry?athleteId=${athleteId}` });
  }
});
