const { INJURY_LABELS, number } = require('./format');

function dailyTodoView(value) {
  const fail = () => { throw new Error('每日待办数据格式异常，请刷新重试。'); };
  const isObject = (item) => item !== null && typeof item === 'object' && !Array.isArray(item);
  const isText = (item) => typeof item === 'string' && item.length <= 200;
  const isCount = (item) => Number.isInteger(item) && item >= 0;
  const isAthlete = (item) => isObject(item) && Number.isSafeInteger(item.athleteId)
    && item.athleteId > 0 && isText(item.athleteName) && isText(item.team) && isText(item.project);
  // 原生小程序不打包 Node 模块，在网络边界显式校验响应后才生成可导航的名单。
  if (!isObject(value) || !/^\d{4}-\d{2}-\d{2}$/.test(value.date)
    || value.timezone !== 'Asia/Shanghai' || !Number.isFinite(Date.parse(value.generatedAt))
    || !Number.isFinite(Date.parse(value.windowStart)) || value.highLoadThreshold !== 600
    || !isObject(value.counts)) fail();
  for (const key of ['total', 'submitted', 'missing', 'attention', 'incompleteTime']) {
    if (!isCount(value.counts[key])) fail();
  }
  for (const key of ['missing', 'attention', 'incompleteTime']) {
    if (!Array.isArray(value[key]) || !value[key].every(isAthlete)
      || value[key].length !== value.counts[key]) fail();
  }
  if (value.counts.submitted + value.counts.missing !== value.counts.total) fail();
  const attention = value.attention.map((item) => {
    if (!Number.isFinite(item.load24h) || item.load24h < 0
      || typeof item.highLoad !== 'boolean' || typeof item.timeIncomplete !== 'boolean') fail();
    const reasons = [];
    if (item.highLoad) reasons.push(`高负荷 ${number(item.load24h, 0)} AU`);
    if (item.injury !== null) {
      const injury = item.injury;
      if (!isObject(injury) || !Object.prototype.hasOwnProperty.call(INJURY_LABELS, injury.status)
        || !isText(injury.bodyPart) || !isText(injury.injuryName)
        || !Number.isFinite(injury.painScore) || injury.painScore < 0 || injury.painScore > 10
        || typeof injury.recent !== 'boolean') fail();
      reasons.push(`${INJURY_LABELS[injury.status]} · ${injury.bodyPart} · 疼痛 ${injury.painScore}`);
      reasons.push(injury.recent ? '伤病近24小时更新' : '持续伤病关注');
    }
    if (item.timeIncomplete) reasons.push('部分训练缺少开训时间');
    return { ...item, reason: reasons.join('；') };
  });
  return { ...value, attention };
}

const TODO_FILTERS = ['all', 'missing', 'attention', 'incomplete'];

function matchesTodoKeyword(item, keyword) {
  const needle = String(keyword || '')
    .trim()
    .toLowerCase();
  if (!needle) return true;
  return [item.athleteName, item.team].some((value) =>
    String(value || '')
      .toLowerCase()
      .includes(needle)
  );
}

// 分组筛选与姓名搜索是纯视图逻辑：计数基于筛选后的名单，服务端返回的原始待办保持不变。
function filterDailyTodos(todos, filter, keyword) {
  if (!todos) return null;
  const selected = TODO_FILTERS.includes(filter) ? filter : 'all';
  const show = {
    missing: selected === 'all' || selected === 'missing',
    attention: selected === 'all' || selected === 'attention',
    incompleteTime: selected === 'all' || selected === 'incomplete',
  };
  const pick = (list) => (list || []).filter((item) => matchesTodoKeyword(item, keyword));
  const matched = {
    missing: pick(todos.missing),
    attention: pick(todos.attention),
    incompleteTime: pick(todos.incompleteTime),
  };
  // 计数始终基于筛选后的完整名单，切换分组时其他分组的人数不会被清零。
  const counts = {
    missing: matched.missing.length,
    attention: matched.attention.length,
    incompleteTime: matched.incompleteTime.length,
  };
  return {
    filter: selected,
    keyword: String(keyword || '').trim(),
    show,
    missing: show.missing ? matched.missing : [],
    attention: show.attention ? matched.attention : [],
    incompleteTime: show.incompleteTime ? matched.incompleteTime : [],
    counts,
    groups: [
      {
        key: 'all',
        label: '全部',
        count: counts.missing + counts.attention + counts.incompleteTime,
        active: selected === 'all',
      },
      { key: 'missing', label: '未填报', count: counts.missing, active: selected === 'missing' },
      {
        key: 'attention',
        label: '负荷与伤病',
        count: counts.attention,
        active: selected === 'attention',
      },
      {
        key: 'incomplete',
        label: '时间待补',
        count: counts.incompleteTime,
        active: selected === 'incomplete',
      },
    ],
  };
}

module.exports = { dailyTodoView, filterDailyTodos, TODO_FILTERS };
