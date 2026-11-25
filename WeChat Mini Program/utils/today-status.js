const { number } = require('./format');

// 日期必须同时满足格式与真实日历，正则不足以拒绝 2026-09-99 这类值。
function isIsoDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

// GET /api/me/today-status 的网络边界校验：口径与教练每日待办一致，形状不合法直接拒绝。
function todayStatusView(value) {
  const fail = () => {
    throw new Error('今日状态数据格式异常，请刷新重试。');
  };
  const isObject = (item) => item !== null && typeof item === 'object' && !Array.isArray(item);
  const isSource = (item) => item === null || (typeof item === 'string' && item.length <= 100);
  const isText = (item, max) => typeof item === 'string' && item.length <= max;
  const isNullableNumber = (item) => item === null || (typeof item === 'number' && Number.isFinite(item) && item >= 0);
  // 今日安排：字段缺失视为无计划，存在时逐项校验，数值 0 有效。
  const isPlanItem = (item) => isObject(item) && isText(item.name, 80) && isText(item.detail, 500);
  const isPlan = (item) =>
    item === null ||
    (isObject(item) &&
      isText(item.title, 100) &&
      isText(item.focus, 200) &&
      Array.isArray(item.specialItems) &&
      item.specialItems.every((name) => isText(name, 80)) &&
      Array.isArray(item.physicalItems) &&
      item.physicalItems.every((name) => isText(name, 80)) &&
      isNullableNumber(item.plannedDurationMin) &&
      isNullableNumber(item.plannedDistanceKm) &&
      Array.isArray(item.items) &&
      item.items.every(isPlanItem));
  const isSessionRow = (item) =>
    isObject(item) &&
    Number.isInteger(item.id) &&
    item.id >= 0 &&
    isText(item.content, 200) &&
    isText(item.trainingType, 40) &&
    isText(item.startTime, 10) &&
    isNullableNumber(item.durationMin) &&
    isNullableNumber(item.distanceKm) &&
    (item.rpe === null || (typeof item.rpe === 'number' && Number.isFinite(item.rpe) && item.rpe >= 0 && item.rpe <= 10));
  if (
    !isObject(value) ||
    !isIsoDate(value.date) ||
    value.timezone !== 'Asia/Shanghai' ||
    !Number.isFinite(Date.parse(value.generatedAt)) ||
    typeof value.submitted !== 'boolean' ||
    typeof value.timeIncomplete !== 'boolean' ||
    !Number.isFinite(value.load24h) ||
    value.load24h < 0 ||
    !isSource(value.source) ||
    (value.plan !== undefined && !isPlan(value.plan)) ||
    (value.sessions !== undefined && (!Array.isArray(value.sessions) || !value.sessions.every(isSessionRow)))
  ) {
    fail();
  }
  return {
    date: value.date,
    submitted: value.submitted,
    timeIncomplete: value.timeIncomplete,
    load24h: value.load24h,
    source: value.source,
    plan: value.plan === undefined ? null : value.plan,
    sessions: value.sessions === undefined ? [] : value.sessions
  };
}

// 首页今日状态卡的展示文案：状态、说明与24小时负荷均来自服务端计算结果，不在客户端重算。
function todayStatusSummary(view) {
  const note = view.submitted
    ? view.timeIncomplete
      ? '今日已有训练记录，开训时间待补充。'
      : '今日训练已记录，计入24小时负荷。'
    : '今日还没有有效训练记录。';
  return {
    ...view,
    // “未填报”保留给恢复日报；训练记录只说已记录/暂无记录。
    submittedLabel: view.submitted ? '已记录' : '暂无记录',
    note,
    timeNote: view.timeIncomplete ? '缺少开训时间的记录暂不计入24小时负荷。' : '',
    loadText: number(view.load24h, 0),
    sourceText: view.source ? `来源 ${view.source}` : ''
  };
}

module.exports = { todayStatusView, todayStatusSummary };
