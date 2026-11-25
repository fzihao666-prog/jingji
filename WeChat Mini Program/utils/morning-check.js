const { number } = require('./format');
const { paginateList, PAGE_SIZE } = require('./pagination');

// 恢复日报概览筛选：优先展示需处理的未填报待办。
const MORNING_FILTERS = ['all', 'missing'];

// 缺失与合法 0 分开：只有有限数值才展示，其余一律 --，不用历史数据兜底。
function metricText(value, suffix = '') {
  return typeof value === 'number' && Number.isFinite(value) ? `${number(value, 1)}${suffix}` : '--';
}

// 恢复日报人数与名单同源于 readTeamOverview 当日 daily_wellness 填报标记，与训练记录彻底分开；
// 队伍筛选后的运动员行由页面传入，人数与名单保持同一口径。
function morningCheckView(rows, filter, page) {
  const athletes = Array.isArray(rows) ? rows : [];
  const total = athletes.length;
  const reported = athletes.filter((row) => row && row.wellnessReported).length;
  const missing = total - reported;
  const selected = MORNING_FILTERS.includes(filter) ? filter : 'all';
  const list = selected === 'missing' ? athletes.filter((row) => row && !row.wellnessReported) : athletes;
  const items = list.map((row) => ({
    athleteId: row.athleteId,
    athleteName: row.athleteName,
    team: row.team || '未分队',
    reported: Boolean(row.wellnessReported),
    // 已填报但单项缺失显示 --；未填报整行不展示历史数值。
    sleepText: row.wellnessReported ? metricText(row.sleepHours, 'h') : '--',
    pulseText: row.wellnessReported ? metricText(row.morningPulse) : '--',
    fatigueText: row.wellnessReported ? metricText(row.fatigueIndex) : '--',
  }));
  return {
    counts: { total, reported, missing },
    cards: [
      { key: 'total', label: '应填报', value: total, tone: '' },
      { key: 'reported', label: '已填报', value: reported, tone: 'tone-ok' },
      { key: 'missing', label: '未填报', value: missing, tone: missing > 0 ? 'tone-warn' : 'tone-ok' },
    ],
    filter: selected,
    filters: [
      { key: 'all', label: '全部', count: total, active: selected === 'all' },
      { key: 'missing', label: '未填报', count: missing, active: selected === 'missing' },
    ],
    rows: paginateList(items, Number.isInteger(page) && page >= 0 ? page : 0, PAGE_SIZE),
    isEmpty: total === 0,
    listEmpty: items.length === 0,
  };
}

// 今日训练情况：只统计 training_sessions 有无，不表述为“未完成训练”。
function trainingSituationView(rows) {
  const athletes = Array.isArray(rows) ? rows : [];
  const trained = athletes.filter((row) => row && row.hasTraining).length;
  return {
    total: athletes.length,
    trained,
    noTraining: athletes.length - trained,
  };
}

module.exports = { MORNING_FILTERS, metricText, morningCheckView, trainingSituationView };
