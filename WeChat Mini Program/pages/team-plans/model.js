const fields = ['date', 'category', 'period', 'content', 'durationMin', 'distanceKm', 'intensity', 'sets', 'reps', 'load', 'notes'];
function emptySession() {
  return { id: `lesson-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`, date: '', category: 'special', period: '上午', content: '', durationMin: null, distanceKm: null, intensity: '', sets: null, reps: null, load: null, notes: '' };
}
function differences(base, edited) {
  const changes = {};
  fields.filter((key) => key !== 'date' && key !== 'category').forEach((key) => { if (edited[key] !== base[key]) changes[key] = edited[key]; });
  return changes;
}
function effectiveSessions(plan, athleteId) {
  return (plan.data.sessions || []).map((session) => {
    const override = (plan.data.overrides || []).find((row) => Number(row.athleteId) === Number(athleteId) && row.sessionId === session.id);
    return { ...session, ...(override ? override.changes : {}), reason: override ? override.reason : '', adjustmentCount: (plan.data.overrides || []).filter((row) => row.sessionId === session.id).length };
  });
}
function revisionSummary(baseline, plan) {
  if (!baseline) return '首个版本';
  const rows = [];
  const names = { title: '名称', startDate: '开始日期', endDate: '结束日期', goal: '目标', focus: '重点', date: '日期', category: '类别', period: '时段', content: '内容', durationMin: '时长', distanceKm: '距离', intensity: '强度', sets: '组数', reps: '次数', load: '负重', notes: '备注' };
  ['title', 'startDate', 'endDate'].forEach((key) => { if (baseline[key] !== plan[key]) rows.push(`${names[key]}: ${baseline[key]} → ${plan[key]}`); });
  ['goal', 'focus'].forEach((key) => { if (baseline.data[key] !== plan.data[key]) rows.push(`${names[key]}: ${baseline.data[key]} → ${plan.data[key]}`); });
  plan.data.sessions.forEach((session) => {
    const old = baseline.data.sessions.find((row) => row.id === session.id);
    if (!old) { rows.push(`新增：${session.date} ${session.content}`); return; }
    fields.forEach((key) => { if (old[key] !== session[key]) rows.push(`${session.date} ${session.content} ${names[key]}: ${old[key] == null ? '未设置' : old[key]} → ${session[key] == null ? '未设置' : session[key]}`); });
  });
  baseline.data.sessions.filter((old) => !plan.data.sessions.some((row) => row.id === old.id)).forEach((old) => rows.push(`移除：${old.date} ${old.content}`));
  if (JSON.stringify(baseline.data.overrides) !== JSON.stringify(plan.data.overrides)) rows.push('个人调整已变化，请核对调整清单与运动员最终预览');
  return rows.length ? rows.join('；') : '与前版相同';
}
function executionView(result, plan, athletes) {
  const ids = new Set(athletes.filter((athlete) => Number(athlete.teamId) === Number(plan.teamId)).map((athlete) => Number(athlete.id)));
  const statuses = { pending: '待确认', complete: '已完成', partial: '部分完成', recorded: '已记录，目标待确认', 'no-plan': '无适用计划', missed: '未完成' };
  const rateText = (value) => value === null || value === undefined ? '待确认' : `${Math.round(value * 100)}%`;
  const rows = (result.athletes || []).filter((row) => ids.has(Number(row.athleteId)));
  return {
    executionStart: result.windowStart, executionEnd: result.date,
    teamExecution: rows.map((row) => ({ athleteId: row.athleteId, athleteName: row.athleteName, statusLabel: statuses[row.status] || '待确认', rateText: rateText(row.completionRate), pendingSessions: row.pendingSessions || 0 })),
    lessonExecution: rows.flatMap((row) => (row.lessonExecution || []).filter((lesson) => Number(lesson.planId) === Number(plan.id)).map((lesson) => ({ key: `${row.athleteId}-${lesson.sessionId}`, athleteName: row.athleteName, date: lesson.date, content: lesson.target ? lesson.target.content : '', status: lesson.status, statusLabel: statuses[lesson.status] || '待确认', rateText: rateText(lesson.completionRate) })))
  };
}
module.exports = { fields, emptySession, differences, effectiveSessions, revisionSummary, executionView };
