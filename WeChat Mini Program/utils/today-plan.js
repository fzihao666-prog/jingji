const { number } = require('./format');
const { paginateList, PAGE_SIZE } = require('./pagination');

// 今日训练计划与执行反馈视图：只做展示转换，计划提取与执行率均由服务端计算。

function metricText(value, suffix = '') {
  return typeof value === 'number' && Number.isFinite(value) ? `${number(value, 1)}${suffix}` : '--';
}

function nameList(value) {
  const list = Array.isArray(value) ? value : [];
  return list.filter((item) => typeof item === 'string' && item.trim()).join('、');
}

// 今日训练计划：教练端（队伍汇总）与运动员端（本人课表）共用同一形状，无数据显示 --。
function todayPlanView(plan) {
  const source = plan || {};
  const focusList = Array.isArray(source.focus) ? source.focus : source.focus ? [source.focus] : [];
  const items = (Array.isArray(source.items) ? source.items : [])
    .filter((item) => item && typeof item.name === 'string' && item.name)
    .map((item) => {
      const detail = typeof item.detail === 'string' ? item.detail : '';
      return { key: `${item.name}|${detail}`, name: item.name, detail };
    });
  return {
    hasPlan: Boolean(source.hasPlan !== undefined ? source.hasPlan : plan),
    title: typeof source.title === 'string' && source.title ? source.title : '',
    focusText: nameList(focusList) || '--',
    specialText: nameList(source.specialItems) || '--',
    physicalText: nameList(source.physicalItems) || '--',
    durationText: metricText(source.plannedDurationMin, ' 分钟'),
    distanceText: metricText(source.plannedDistanceKm, ' km'),
    items
  };
}

const EXEC_STATUS_LABELS = { pending: '待确认', recorded: '已记录', 'no-plan': '无今日计划' };

// 今日执行情况：人数与名单随队伍筛选同口径；未报量不计 0；执行率只展示服务端近7天结果。
function todayExecutionView(rows, options = {}) {
  const list = (Array.isArray(rows) ? rows : []).filter((row) => row && typeof row === 'object');
  const planned = list.filter((row) => row.hasPlanToday).length;
  const recorded = list.filter((row) => row.todayStatus === 'recorded').length;
  const confirmed = list.filter((row) => row.hasPlanToday && row.todayStatus === 'recorded').length;
  const pendingRows = list.filter((row) => row.todayStatus === 'pending');
  const rpeReported = list.filter((row) => row.todayRpeReported).length;
  const durations = list.map((row) => row.todayDurationMin).filter((value) => typeof value === 'number' && Number.isFinite(value));
  const distances = list.map((row) => row.todayDistanceKm).filter((value) => typeof value === 'number' && Number.isFinite(value));
  const actualDuration = durations.length ? Math.round(durations.reduce((sum, value) => sum + value, 0) * 10) / 10 : null;
  const actualDistance = distances.length ? Math.round(distances.reduce((sum, value) => sum + value, 0) * 10) / 10 : null;
  const avgCompletion = options.avgCompletion;
  const rateText = typeof avgCompletion === 'number' && Number.isFinite(avgCompletion)
    ? `${number(avgCompletion * 100, 0)}%`
    : '--';
  const items = pendingRows.map((row) => ({
    athleteId: row.athleteId,
    athleteName: row.athleteName,
    team: row.team || '未分队',
    statusLabel: EXEC_STATUS_LABELS.pending,
    focusText: typeof row.todayFocus === 'string' && row.todayFocus ? row.todayFocus : '--',
  }));
  return {
    tiles: [
      { key: 'planned', label: '计划人数', value: `${planned}`, unit: '人' },
      { key: 'recorded', label: '已记录训练', value: `${recorded}`, unit: '人' },
      { key: 'confirmed', label: '已确认完成', value: `${confirmed}`, unit: '人', note: '以训练记录为依据' },
      { key: 'pending', label: '待确认', value: `${pendingRows.length}`, unit: '人' },
      { key: 'duration', label: '实际训练时长', value: metricText(actualDuration, ''), unit: '分钟' },
      { key: 'distance', label: '实际训练公里', value: metricText(actualDistance, ''), unit: 'km' },
      { key: 'rpe', label: 'RPE 填报', value: `${rpeReported}`, unit: '人' },
      { key: 'rate', label: '计划执行率', value: rateText, unit: '', note: '近7天 · 服务端口径' },
    ],
    listTitle: '待确认人员',
    rows: paginateList(items, Number.isInteger(options.page) && options.page >= 0 ? options.page : 0, PAGE_SIZE),
    listEmpty: items.length === 0,
  };
}

// 运动员本人今日训练卡片：今日安排 + 本人实际记录；RPE 填报入口由页面指向训练记录表单。
function todayTrainingCardView(plan, sessions) {
  const rows = (Array.isArray(sessions) ? sessions : [])
    .filter((item) => item && typeof item === 'object')
    .map((item) => ({
      id: item.id,
      content: typeof item.content === 'string' && item.content ? item.content : '--',
      trainingType: typeof item.trainingType === 'string' ? item.trainingType : '',
      startTime: typeof item.startTime === 'string' ? item.startTime : '',
      durationText: metricText(item.durationMin, ' 分钟'),
      distanceText: metricText(item.distanceKm, ' km'),
      rpeText: typeof item.rpe === 'number' && Number.isFinite(item.rpe) ? number(item.rpe, 1) : '--',
    }));
  return {
    plan: todayPlanView(plan),
    sessions: rows,
    hasSessions: rows.length > 0,
  };
}

module.exports = { todayPlanView, todayExecutionView, todayTrainingCardView, EXEC_STATUS_LABELS };
