// 专项测试成绩展示视图：把接口返回的事件/成绩组装成 WXML 可直接渲染的字符串行，
// 并按“少列多展开”裁剪：默认只预览最近若干场、每场最好 3 条成绩，其余按需展开。
const { raceTime, raceDelta } = require('./format');

// 场次与成绩的默认预览条数；完整数据始终保留在 moreResults / events 中供展开。
const EVENT_PREVIEW_COUNT = 3;
const RESULT_PREVIEW_COUNT = 3;

function eventTitle(ev) {
  const parts = [
    ev.distanceM ? `${ev.distanceM} 米` : '',
    ev.boatClass || '',
    ev.genderGroup || '',
    ev.session || ''
  ].filter(Boolean);
  return parts.join(' · ') || '专项测试';
}

function resultRow(ev, result, index) {
  const deltaMs = result.deltaPreviousMs;
  return {
    key: `${ev.id}-${index}`,
    rank: result.rank || index + 1,
    crewName: result.crewName || '单人',
    memberText: Array.isArray(result.memberNames) ? result.memberNames.filter(Boolean).join(' · ') : '',
    attemptsText: Array.isArray(result.attemptsMs) && result.attemptsMs.length
      ? result.attemptsMs.map(raceTime).filter(Boolean).join(' / ') || '无成绩'
      : '无成绩',
    bestText: result.bestMs != null ? raceTime(result.bestMs) : '',
    deltaText: deltaMs == null ? '' : raceDelta(deltaMs),
    deltaTone: deltaMs == null || Number(deltaMs) === 0
      ? 'flat'
      : Number(deltaMs) < 0 ? 'faster' : 'slower'
  };
}

// 单场测试视图：results 为最好成绩前 3 条，moreResults 为其余成绩，展开后合并展示。
function buildTestEventView(ev) {
  const rows = (ev.results || []).map((result, index) => resultRow(ev, result, index));
  const moreCount = Math.max(0, rows.length - RESULT_PREVIEW_COUNT);
  return {
    id: ev.id,
    title: eventTitle(ev),
    testDate: ev.testDate || '',
    meta: [ev.windConditions, ev.location].filter(Boolean).join(' · '),
    resultCount: rows.length,
    results: rows.slice(0, RESULT_PREVIEW_COUNT),
    moreResults: rows.slice(RESULT_PREVIEW_COUNT),
    moreCount,
    expandLabel: moreCount > 0 ? `展开其余 ${moreCount} 条成绩` : '查看每轮成绩',
    expanded: false
  };
}

function buildSpecialTestView(result) {
  const events = ((result && result.events) || []).map(buildTestEventView);
  return {
    events,
    eventCount: events.length,
    resultCount: events.reduce((sum, ev) => sum + ev.resultCount, 0)
  };
}

module.exports = {
  EVENT_PREVIEW_COUNT,
  RESULT_PREVIEW_COUNT,
  buildTestEventView,
  buildSpecialTestView
};
