const { request, uploadFile, downloadFile, assetUrl } = require('../utils/request');

function query(params) {
  return Object.keys(params)
    .filter((key) => params[key] !== null && params[key] !== undefined && params[key] !== '')
    .map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(params[key])}`)
    .join('&');
}

// AI 生成比普通业务请求耗时更长，避免先于服务端模型超时而中断。
function requestAiPlan(path, data) {
  return request(path, { method: 'POST', data, timeout: 240000 }).catch((error) => {
    if (error.kind === 'timeout') {
      error.message = 'AI生成等待超时，服务端可能仍在处理。请先刷新计划列表查看草稿，再决定是否重试。';
    }
    throw error;
  });
}

module.exports = {
  assetUrl,
  teamPlans(params = {}) { return request(`/api/team-plans?${query(params)}`); },
  createTeamPlan(data) { return request('/api/team-plans', { method: 'POST', data }); },
  updateTeamPlan(id, data) { return request(`/api/team-plans/${encodeURIComponent(id)}`, { method: 'PUT', data }); },
  transitionTeamPlan(id, data) { return request(`/api/team-plans/${encodeURIComponent(id)}/transition`, { method: 'POST', data }); },
  // AI 生成/修订/撤销训练计划草稿，以及训练项执行确认。
  generateAiTeamPlan(data) { return requestAiPlan('/api/team-plans/ai/generate', data); },
  reviseAiTeamPlan(id, data) { return requestAiPlan(`/api/team-plans/ai/${encodeURIComponent(id)}/revise`, data); },
  undoAiTeamPlan(id) { return request(`/api/team-plans/ai/${encodeURIComponent(id)}/undo`, { method: 'POST' }); },
  teamPlanChecks(id) { return request(`/api/team-plans/${encodeURIComponent(id)}/checks`); },
  updateTeamPlanCheck(id, data) { return request(`/api/team-plans/${encodeURIComponent(id)}/checks`, { method: 'PUT', data }); },
  login(username, password, traceId) {
    return request('/api/auth/login', { method: 'POST', auth: false, traceId, data: { username, password } });
  },
  register(input) {
    return request('/api/auth/register', { method: 'POST', auth: false, data: input });
  },
  me() { return request('/api/me'); },
  changePassword(currentPassword, newPassword) {
    return request('/api/auth/change-password', { method: 'POST', data: { currentPassword, newPassword } });
  },
  logout() {
    return request('/api/auth/logout', { method: 'POST' });
  },
  athletes() { return request('/api/athletes'); },
  athleteCreateOptions() { return request('/api/admin/athletes/create-options'); },
  createAthlete(data) { return request('/api/admin/athletes', { method: 'POST', data }); },
  updateAthlete(id, data) { return request(`/api/admin/athletes/${encodeURIComponent(id)}`, { method: 'PUT', data }); },
  teams() { return request('/api/registration/teams', { auth: false }); },
  updateMyAthleteProfile(data) {
    return request('/api/me/athlete-profile', { method: 'PUT', data });
  },
  updateBodyComposition(athleteId, data) {
    return request(`/api/athletes/${encodeURIComponent(athleteId)}/body-composition`, { method: 'PUT', data });
  },
  uploadAthletePhoto(athleteId, filePath) {
    return uploadFile(`/api/athletes/${encodeURIComponent(athleteId)}/photo`, filePath);
  },
  async downloadAthletePhoto(athleteId) {
    try {
      return await downloadFile(`/api/athletes/${encodeURIComponent(athleteId)}/photo`);
    } catch {
      return '';
    }
  },
  myTrainingSessions() { return request('/api/me/training-sessions'); },
  createMyTrainingSession(data, idempotencyKey) {
    return request('/api/me/training-sessions', { method: 'POST', data,
      ...(idempotencyKey ? { header: { 'Idempotency-Key': idempotencyKey } } : {}) });
  },
  updateMyTrainingSession(id, data) {
    return request(`/api/me/training-sessions/${encodeURIComponent(id)}`, { method: 'PUT', data });
  },
  deleteMyTrainingSession(id) {
    return request(`/api/me/training-sessions/${encodeURIComponent(id)}`, { method: 'DELETE' });
  },
  todayStatus() { return request('/api/me/today-status'); },
  myWellness(date) { return request(`/api/me/wellness?${query({ date })}`); },
  saveWellness(data) {
    return request('/api/me/wellness', { method: 'POST', data });
  },
  athleteTrainingSessions(athleteId) {
    return request(`/api/athletes/${encodeURIComponent(athleteId)}/training-sessions`);
  },
  createAthleteTrainingSession(athleteId, data) {
    return request(`/api/athletes/${encodeURIComponent(athleteId)}/training-sessions`, { method: 'POST', data });
  },
  updateAthleteTrainingSession(athleteId, sessionId, data) {
    return request(`/api/athletes/${encodeURIComponent(athleteId)}/training-sessions/${encodeURIComponent(sessionId)}`, { method: 'PUT', data });
  },
  deleteAthleteTrainingSession(athleteId, sessionId) {
    return request(`/api/athletes/${encodeURIComponent(athleteId)}/training-sessions/${encodeURIComponent(sessionId)}`, { method: 'DELETE' });
  },
  athleteWellness(athleteId, date) {
    return request(`/api/athletes/${encodeURIComponent(athleteId)}/wellness?${query({ date })}`);
  },
  saveAthleteWellness(athleteId, data) {
    return request(`/api/athletes/${encodeURIComponent(athleteId)}/wellness`, { method: 'POST', data });
  },
  currentProject() { return request('/api/preferences/current-project'); },
  dailyTodos(project) {
    return request(`/api/coach/daily-todos?${query({ project })}`);
  },
  teamOverview(project) {
    return request(`/api/coach/team-overview?${query({ project })}`);
  },
  planExecution(project) {
    return request(`/api/coach/plan-execution?${query({ project })}`);
  },
  markTodoFollowups(project, athleteIds) {
    return request('/api/coach/daily-todos/followups', { method: 'PUT', data: { project, athleteIds } });
  },
  unmarkTodoFollowups(project, athleteIds) {
    // DELETE 传参走 query：wx.request 对 DELETE 请求体的行为跨端不可靠。
    return request(`/api/coach/daily-todos/followups?${query({ project, athleteIds: athleteIds.join(',') })}`, { method: 'DELETE' });
  },
  saveCurrentProject(project) {
    return request('/api/preferences/current-project', { method: 'PUT', data: { project } });
  },
  overview(from, to, athleteId, project, teamId) {
    return request(`/api/overview?${query({ from, to, athleteId: athleteId || null, project, teamId: teamId || null })}`);
  },
  overviewTeams(project) {
    return request(`/api/overview/teams?${query({ project })}`);
  },
  specialTrainingOverview(from, to, project, teamId, athleteId) {
    return request(`/api/special-training/overview?${query({ from, to, project, teamId: teamId || null, athleteId: athleteId || null })}`);
  },
  specialChampionModels(project) {
    return request(`/api/special-champion-models?${query({ project })}`);
  },
  strengthTests(athleteId) {
    return request(`/api/strength-tests?${query({ athleteId })}`);
  },
  createStrengthTest(data) {
    return request('/api/strength-tests', { method: 'POST', data });
  },
  createSpecialTest(data) {
    return request('/api/special-tests/manual', { method: 'POST', data });
  },
  trainingPlans(athleteId) {
    return request(`/api/training-plans?${query({ athleteId })}`);
  },
  strengthTrainingResults(athleteId) {
    return request(`/api/strength-training/results?${query({ athleteId })}`);
  },
  injuryRecords(athleteId) {
    return request(`/api/athletes/${encodeURIComponent(athleteId)}/injuries`);
  },
  painTrend(athleteId, days = 30) {
    return request(`/api/athletes/${encodeURIComponent(athleteId)}/injuries/pain-trend?${query({ days })}`);
  },
  createInjuryRecord(athleteId, data) {
    return request(`/api/athletes/${encodeURIComponent(athleteId)}/injuries`, { method: 'POST', data });
  },
  personalOverview(athleteId, from, to, project) {
    return request(`/api/athletes/${encodeURIComponent(athleteId)}/overview?${query({ from, to, project })}`);
  },
  championBenchmark(athleteId) {
    return request(`/api/athletes/${encodeURIComponent(athleteId)}/champion-model`);
  },
  wellnessTrends(athleteId, from, to, project) {
    return request(`/api/athletes/${encodeURIComponent(athleteId)}/wellness-trends?${query({ from, to, project })}`);
  },
  getBodyCompositionHistory(athleteId) {
    return request(`/api/athletes/${encodeURIComponent(athleteId)}/body-composition`);
  },
  profileComparison(athleteId, from, to, project) {
    return request(`/api/athletes/${encodeURIComponent(athleteId)}/profile-comparison?${query({ from, to, project })}`);
  },
  radarModels(athleteId, from, to) {
    return request(`/api/athletes/${encodeURIComponent(athleteId)}/radar-models?${query({ from, to })}`);
  },
  specialTests(from, to, project, athleteId) {
    const params = { project };
    if (from) params.from = from;
    if (to) params.to = to;
    if (athleteId != null) params.athleteId = athleteId;
    return request(`/api/special-tests?${query(params)}`);
  }
};
