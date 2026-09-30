const { INJURY_LABELS, number } = require('./format');
const { buildPagerState } = require('./pagination');

const TODO_FILTERS = ['all', 'missing', 'attention', 'review', 'incomplete'];
const GROUP_LABELS = {
  missing: '未填报',
  attention: '负荷与伤病',
  review: '复查提醒',
  incompleteTime: '时间待补',
};
// 未填报名单每页最多展示人数，超出部分通过翻页查看。
const MISSING_PAGE_SIZE = 5;

// 未填报名单分页是纯视图逻辑：输入完整筛选后的名单，输出当页切片与页码信息；
// 页码越界时收敛到最后一页，避免筛选/跟进后名单变短导致空白页。
// 注意：todoMissingPage 在页面内是 0 基，buildPagerState 是 1 基，此处做一次换算。
function paginateMissing(todoView, page) {
  if (!todoView) return null;
  const total = todoView.missing.length;
  const pageCount = Math.max(1, Math.ceil(total / MISSING_PAGE_SIZE));
  const state = buildPagerState(Number.isInteger(page) && page >= 0 ? page + 1 : 1, pageCount);
  const safePage = state.page - 1;
  return {
    ...todoView,
    missing: todoView.missing.slice(safePage * MISSING_PAGE_SIZE, (safePage + 1) * MISSING_PAGE_SIZE),
    missingPage: {
      page: safePage,
      pageCount: state.pageCount,
      total,
      pageSize: MISSING_PAGE_SIZE,
      hasPrev: state.hasPrev,
      hasNext: state.hasNext,
    },
  };
}

function reviewDueLabel(dueIn) {
  if (!Number.isInteger(dueIn)) return '';
  if (dueIn < 0) return `复查已逾期 ${-dueIn} 天`;
  if (dueIn === 0) return '今天复查';
  return `${dueIn} 天后复查`;
}

function dailyTodoView(value) {
  const fail = () => { throw new Error('每日待办数据格式异常，请刷新重试。'); };
  const isObject = (item) => item !== null && typeof item === 'object' && !Array.isArray(item);
  const isText = (item) => typeof item === 'string' && item.length <= 200;
  const isCount = (item) => Number.isInteger(item) && item >= 0;
  const isAthlete = (item) => isObject(item) && Number.isSafeInteger(item.athleteId)
    && item.athleteId > 0 && isText(item.athleteName) && isText(item.team) && isText(item.project);
  const isDate = (item) => typeof item === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(item);
  // 原生小程序不打包 Node 模块，在网络边界显式校验响应后才生成可导航的名单。
  if (!isObject(value) || !isDate(value.date)
    || value.timezone !== 'Asia/Shanghai' || !Number.isFinite(Date.parse(value.generatedAt))
    || !Number.isFinite(Date.parse(value.windowStart)) || value.highLoadThreshold !== 600
    || !isObject(value.counts)) fail();
  for (const key of ['total', 'submitted', 'missing', 'attention', 'incompleteTime', 'reviewDue']) {
    if (!isCount(value.counts[key])) fail();
  }
  for (const key of ['missing', 'attention', 'incompleteTime']) {
    if (!Array.isArray(value[key]) || !value[key].every(isAthlete)
      || value[key].length !== value.counts[key]) fail();
  }
  // 复查提醒分组：服务端已按北京日期计算 dueIn，客户端只做展示文案。
  const isReviewItem = (item) => isAthlete(item) && isDate(item.reviewDate)
    && Number.isInteger(item.dueIn) && isText(item.injuryName) && isText(item.bodyPart)
    && Object.prototype.hasOwnProperty.call(INJURY_LABELS, item.status)
    && Number.isFinite(item.painScore) && item.painScore >= 0 && item.painScore <= 10;
  if (!Array.isArray(value.reviewDue) || !value.reviewDue.every(isReviewItem)
    || value.reviewDue.length !== value.counts.reviewDue) fail();
  // 已跟进标记：旧版服务端可能不下发，缺省视为空；存在时必须是安全整数数组。
  let followedUpIds = [];
  if (value.followedUp !== undefined) {
    if (!Array.isArray(value.followedUp)
      || !value.followedUp.every((id) => Number.isSafeInteger(id) && id > 0)) fail();
    followedUpIds = value.followedUp;
  }
  if (value.counts.submitted + value.counts.missing !== value.counts.total) fail();
  const attention = value.attention.map((item) => {
    if (!Number.isFinite(item.load24h) || item.load24h < 0
      || typeof item.highLoad !== 'boolean' || typeof item.timeIncomplete !== 'boolean'
      || typeof item.restRequested !== 'boolean') fail();
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
    if (item.restRequested) reasons.push('自评需要休息');
    if (item.timeIncomplete) reasons.push('部分训练缺少开训时间');
    return { ...item, reason: reasons.join('；') };
  });
  const reviewDue = value.reviewDue.map((item) => ({ ...item, dueLabel: reviewDueLabel(item.dueIn) }));
  return { ...value, attention, reviewDue, followedUp: followedUpIds };
}

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
// 当前用户"已跟进"的运动员从各分组隐藏并收敛到 followedUpList，撤销后回到原分组。
function filterDailyTodos(todos, filter, keyword) {
  if (!todos) return null;
  const selected = TODO_FILTERS.includes(filter) ? filter : 'all';
  const show = {
    missing: selected === 'all' || selected === 'missing',
    attention: selected === 'all' || selected === 'attention',
    review: selected === 'all' || selected === 'review',
    incompleteTime: selected === 'all' || selected === 'incomplete',
  };
  const followedSet = new Set(todos.followedUp || []);
  const partition = (list) => {
    const active = [];
    const followed = [];
    for (const item of list || []) {
      const target = followedSet.has(item.athleteId) ? followed : active;
      if (matchesTodoKeyword(item, keyword)) target.push(item);
    }
    return { active, followed };
  };
  const parts = {
    missing: partition(todos.missing),
    attention: partition(todos.attention),
    review: partition(todos.reviewDue),
    incompleteTime: partition(todos.incompleteTime),
  };
  const matched = {
    missing: parts.missing.active,
    attention: parts.attention.active,
    review: parts.review.active,
    incompleteTime: parts.incompleteTime.active,
  };
  // 同一运动员可能同时在多个分组（如未填报且临近复查），已跟进列表按人去重，保留首个分组标签。
  const followedUpList = [];
  const seenFollowed = new Set();
  for (const key of ['missing', 'attention', 'review', 'incompleteTime']) {
    for (const item of parts[key].followed) {
      if (seenFollowed.has(item.athleteId)) continue;
      seenFollowed.add(item.athleteId);
      followedUpList.push({ ...item, groupLabel: GROUP_LABELS[key] });
    }
  }
  // 计数始终基于筛选后的完整名单（已扣除当前用户已跟进对象），切换分组时其他分组的人数不会被清零。
  const counts = {
    missing: matched.missing.length,
    attention: matched.attention.length,
    review: matched.review.length,
    incompleteTime: matched.incompleteTime.length,
  };
  return {
    filter: selected,
    keyword: String(keyword || '').trim(),
    show,
    missing: show.missing ? matched.missing : [],
    attention: show.attention ? matched.attention : [],
    review: show.review ? matched.review : [],
    incompleteTime: show.incompleteTime ? matched.incompleteTime : [],
    followedUpList,
    counts,
    groups: [
      {
        key: 'all',
        label: '全部',
        count: counts.missing + counts.attention + counts.review + counts.incompleteTime,
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
        key: 'review',
        label: '复查提醒',
        count: counts.review,
        active: selected === 'review',
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

module.exports = { dailyTodoView, filterDailyTodos, TODO_FILTERS, reviewDueLabel, GROUP_LABELS, MISSING_PAGE_SIZE, paginateMissing };
