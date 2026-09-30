const { request, uploadFile, downloadFile, assetUrl } = require('../utils/request');

function query(params) {
  return Object.keys(params)
    .filter((key) => params[key] !== null && params[key] !== undefined && params[key] !== '')
    .map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(params[key])}`)
    .join('&');
}

module.exports = {
  assetUrl,
  login(username, password) {
    return request('/api/auth/login', { method: 'POST', auth: false, data: { username, password } });
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
  createMyTrainingSession(data) {
    return request('/api/me/training-sessions', { method: 'POST', data });
  },
  updateMyTrainingSession(id, data) {
    return request(`/api/me/training-sessions/${encodeURIComponent(id)}`, { method: 'PUT', data });
  },
  deleteMyTrainingSession(id) {
    return request(`/api/me/training-sessions/${encodeURIComponent(id)}`, { method: 'DELETE' });
  },
  todayStatus() { return request('/api/me/today-status'); },
  todaySessions() { return request('/api/me/today-sessions'); },
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
  loadManagement(project) {
    return request(`/api/coach/load-management?${query({ project })}`);
  },
  wellnessBaseline(project) {
    return request(`/api/coach/wellness-baseline?${query({ project })}`);
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
  specialTrainingOverview(from, to, project, teamId) {
    return request(`/api/special-training/overview?${query({ from, to, project, teamId: teamId || null })}`);
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
