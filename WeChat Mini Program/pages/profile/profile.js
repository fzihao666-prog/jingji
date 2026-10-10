const api = require('../../services/api');
const { applyScopeChange, saveProjectInOrder, isPageCacheFresh, loadPage: runPageLoad } = require('../../utils/page-scope');
const { loadWithGuard } = require('../../utils/request-guard');
const { ageAt, todayBeijing } = require('../../utils/date');
const { number, maskIdentity, maskPhone, INJURY_LABELS, strengthMetricRows } = require('../../utils/format');
const { reviewDueLabel } = require('../../utils/daily-todos');
const { projectLabel } = require('../../utils/project-label');
const { radarGroupView, wellnessTrendsView } = require('../../utils/profile-views');
const radarChart = require('../../utils/radar-chart');
const { bodyCompositionSummary } = require('../../utils/body-composition-groups');
const { trainingComparisonSummary } = require('../../utils/training-comparison-groups');

const { metricValue, completeStrengthMetrics, sectionRequest, displayMissing } = require('../../utils/training-empty');

const MANAGER_ROLES = ['SCC', 'REG', 'TD', 'DMD'];

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
      latestPain: metricValue(part.latestPainScore, 0),
      bars: part.series.map((point) => ({
        date: point.date,
        pain: metricValue(point.painScore, 0),
        height: Math.max(0, Math.round((point.painScore / 10) * 100)),
        sourceLabel: PAIN_SOURCE_LABELS[point.recordType] || point.recordType,
      })),
    })),
  };
}

function profileView(athlete, injuryRecords, overview, benchmark, period) {
  const age = ageAt(athlete.birthDate, period.to);
  const cells = [
    ['项目', athlete.project ? projectLabel(athlete.project) : '--'],
    ['队伍', athlete.team || '--'],
    ['性别', athlete.gender || '--'],
    ['年龄', age == null ? '--' : `${age}岁`],
    ['身高', athlete.heightCm == null ? '--' : `${number(athlete.heightCm)} cm`],
    ['体重', athlete.weightKg == null ? '--' : `${number(athlete.weightKg)} kg`],
    ['体脂率', athlete.bodyFatPct == null ? '--' : `${number(athlete.bodyFatPct)}%`],
    ['骨骼肌', athlete.skeletalMuscleKg == null ? '--' : `${number(athlete.skeletalMuscleKg)} kg`],
    ['技术等级', athlete.technicalLevel || '--'],
    ['运动员位置', athlete.athletePosition || '--'],
    ['当前小项', athlete.currentEvent || '--'],
    ['训练阶段', athlete.trainingPhase || '--'],
    ['健康状态', athlete.healthStatus || '--'],
    ['最好成绩', athlete.bestResult || '--'],
    ['联系电话', athlete.phone ? maskPhone(athlete.phone) : '--'],
    ['身份信息', athlete.identityNumber ? maskIdentity(athlete.identityNumber) : '--']
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
      pain: `疼痛 ${metricValue(item.painScore, 0)}`,
      restriction: item.restrictions || item.rehabPlan || item.note || '暂无补充说明'
    };
  });

  const tests = [...((overview && overview.strengthTests) || [])].sort((a, b) => b.testDate.localeCompare(a.testDate));
  const latestTest = tests[0] || null;
  const testMetrics = completeStrengthMetrics(strengthMetricRows(latestTest)).slice(0, 8);
  const benchmarkSummary = benchmark && benchmark.summary ? {
    score: metricValue(benchmark.summary.score),
    achieved: metricValue(benchmark.summary.achieved, 0),
    comparable: metricValue(benchmark.summary.comparable, 0),
    primaryGap: benchmark.summary.primaryGap || '暂无可比指标',
    source: benchmark.summary.source || '当前项目模型'
  } : null;
  const overviewMeta = overview && overview.meta ? overview.meta : {};
  const trainingSummary = [
    { label: '训练课次', value: metricValue(overviewMeta.sessionCount, 0), unit: '次', note: `${period.from} 至 ${period.to}` },
    { label: '数据覆盖', value: metricValue(overviewMeta.coverage, 0), unit: '%', note: overviewMeta.containsDemoData ? '包含明确标注的演示数据' : '当前范围未标记演示数据' },
    { label: '测试次数', value: metricValue(overviewMeta.testCount, 0), unit: '次', note: '统一测试指标记录' },
    { label: '恢复日报', value: metricValue(overviewMeta.wellnessDays, 0), unit: '天', note: '当前时间范围内记录' }
  ];

  return {
    athleteName: athlete.name || '档案资料待补充',
    athleteMeta: `${projectLabel(athlete.project)} · ${athlete.team || '--'}`,
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

// 固定保留服务端已实现的四项恢复趋势，不生成实测点或队均。
function completeWellnessView(trends) {
  const sanitized = (trends || []).map((trend) => ({ ...trend, points: (trend.points || []).map((point) => ({ ...point, hasPersonalValue: Boolean(point.hasPersonalValue && typeof point.personalValue === 'number' && Number.isFinite(point.personalValue)) })) }));
  const view = wellnessTrendsView(sanitized);
  const definitions = [
    { key: 'rpe', label: 'RPE', unit: '' }, { key: 'sleepHours', label: '睡眠时长', unit: '小时' },
    { key: 'morningPulse', label: '晨脉', unit: 'bpm' }, { key: 'weightKg', label: '体重', unit: 'kg' }
  ];
  const byKey = new Map(view.metrics.map((metric) => [metric.key, metric]));
  return displayMissing({ metrics: definitions.map((definition) => byKey.get(definition.key) || {
    ...definition, latestText: '--', diffText: '--', latestDate: '', points: [], note: '暂无恢复数据'
  }).map((metric) => ({ ...metric, hasData: metric.points.some((point) => !point.missing || point.teamPct != null) })) });
}

function profileRadars(models) {
  return displayMissing([
    radarGroupView(models && models.special, { title: '专项测试雷达', canvasId: 'radarSpecial' }),
    radarGroupView(models && models.physical, { title: '体能测试雷达', canvasId: 'radarPhysical' })
  ]).map((group) => ({ ...group, emptyMessage: group.dimensions.some((dim) => dim.referenceText !== '--') ? (group.dimensions.some((dim) => dim.valueText !== '--') ? '有效维度不足 3 个，暂不绘制雷达多边形' : '待采集') : '待参考' }));
}

function emptyProfileView(athlete = {}, period = { from: '', to: '' }) {
  return {
    ...displayMissing(profileView(athlete, [], null, null, period)),
    athleteName: athlete.name || '暂无可查看运动员', photoUrl: '', showMore: false,
    painTrend: null, wellnessTrend: completeWellnessView([]), bodyCompositionHistory: [],
    bodyCompositionSummary: displayMissing(bodyCompositionSummary([])), showBodyMore: false,
    profileComparison: null, comparisonView: displayMissing(trainingComparisonSummary(null)), radarGroups: profileRadars(null),
    injuryError: '', overviewError: '', benchmarkError: '', painError: '', wellnessError: '', bodyError: '', comparisonError: '', radarError: '', photoError: '', moduleError: ''
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
    ...emptyProfileView(),
    canEditSelf: false, canReportRole: false, canCoachFill: false
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
          ...emptyProfileView(scope.athletes.find((item) => Number(item.id) === Number(scope.selectedAthleteId)), scope),
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

  async loadPageData(scope, isLatest = () => true) {
    const athleteId = scope.selectedAthleteId;
    if (!athleteId) return emptyProfileView();
    const athlete = scope.athletes.find((item) => Number(item.id) === Number(athleteId));
    if (!athlete) throw new Error('当前项目中未找到该运动员。');
    const [injury, overview, benchmark, pain, wellness, body, comparison, radar, photo] = await Promise.all([
      sectionRequest(() => api.injuryRecords(athleteId), '伤病记录加载失败'),
      sectionRequest(() => api.personalOverview(athleteId, scope.from, scope.to, scope.project), '训练概览加载失败'),
      sectionRequest(() => api.championBenchmark(athleteId), '冠军模型加载失败'),
      sectionRequest(() => api.painTrend(athleteId, 30), '疼痛趋势加载失败'),
      sectionRequest(() => api.wellnessTrends(athleteId, scope.from, scope.to, scope.project), '恢复趋势加载失败'),
      sectionRequest(() => api.getBodyCompositionHistory(athleteId), '身体成分加载失败'),
      sectionRequest(() => api.profileComparison(athleteId, scope.from, scope.to, scope.project), '训练对比加载失败'),
      sectionRequest(() => api.radarModels(athleteId, scope.from, scope.to), '雷达模型加载失败'),
      athlete.photoUrl ? sectionRequest(() => api.downloadAthletePhoto(athleteId), '照片加载失败') : Promise.resolve({ value: '', error: '' })
    ]);
    if (!isLatest()) return null;
    const labels = { weightKg: '体重', bodyFatPct: '体脂率', skeletalMuscleKg: '骨骼肌', muscleMassKg: '肌肉量', totalBodyWaterKg: '体水分', visceralFatLevel: '内脏脂肪等级', basalMetabolismKcal: '基础代谢' };
    const units = { weightKg: 'kg', bodyFatPct: '%', skeletalMuscleKg: 'kg', muscleMassKg: 'kg', totalBodyWaterKg: 'kg', visceralFatLevel: '', basalMetabolismKcal: 'kcal' };
    const bodyCompositionHistory = ((body.value || {}).history || []).slice(0, 6).map((record) => ({
      measurementDate: record.measurementDate,
      items: Object.entries(record).filter(([key, value]) => labels[key] && value != null).map(([key, value]) => ({ key, label: labels[key], value, unit: units[key] || '' }))
    }));
    const profileComparison = (comparison.value || {}).comparison || null;
    const errors = { injuryError: injury.error, overviewError: overview.error, benchmarkError: benchmark.error, painError: pain.error, wellnessError: wellness.error, bodyError: body.error, comparisonError: comparison.error, radarError: radar.error, photoError: photo.error };
    return {
      ...emptyProfileView(athlete, scope),
      ...displayMissing(profileView(athlete, (injury.value || {}).records, (overview.value || {}).overview, (benchmark.value || {}).benchmark, scope)),
      photoUrl: photo.value || '', painTrend: painTrendView(pain.value), wellnessTrend: completeWellnessView((wellness.value || {}).trends),
      bodyCompositionHistory, bodyCompositionSummary: displayMissing(bodyCompositionSummary(bodyCompositionHistory)), profileComparison,
      comparisonView: displayMissing(trainingComparisonSummary(profileComparison)), radarGroups: profileRadars(radar.value),
      ...errors, moduleError: Object.values(errors).find(Boolean) || ''
    };
  },

  onScopeChange(event) {
    const change = applyScopeChange(this, event);
    if (!change) return Promise.resolve();
    this.setData(emptyProfileView(this.data.athletes.find((item) => Number(item.id) === Number(this.data.selectedAthleteId)), this.data));
    return loadWithGuard(this, this._guard, async (isLatest) => {
      if (change.field === 'project') await saveProjectInOrder(this, change.patch.project, api.saveCurrentProject);
      if (!isLatest()) return null;
      return this.loadPageData(this.data, isLatest);
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

  toggleBodyMore() {
    this.setData({ showBodyMore: !this.data.showBodyMore });
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
