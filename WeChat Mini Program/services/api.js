const { request, uploadFile, assetUrl } = require('../utils/request');

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
  me() { return request('/api/me'); },
  changePassword(currentPassword, newPassword) {
    return request('/api/auth/change-password', { method: 'POST', data: { currentPassword, newPassword } });
  },
  athletes() { return request('/api/athletes'); },
  teams() { return request('/api/teams', { auth: false }); },
  updateMyAthleteProfile(data) {
    return request('/api/me/athlete-profile', { method: 'PUT', data });
  },
  updateBodyComposition(athleteId, data) {
    return request(`/api/athletes/${encodeURIComponent(athleteId)}/body-composition`, { method: 'PUT', data });
  },
  uploadAthletePhoto(athleteId, filePath) {
    return uploadFile(`/api/athletes/${encodeURIComponent(athleteId)}/photo`, filePath);
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
  currentProject() { return request('/api/preferences/current-project'); },
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
  trainingPlans(athleteId) {
    return request(`/api/training-plans?${query({ athleteId })}`);
  },
  strengthTrainingResults(athleteId) {
    return request(`/api/strength-training/results?${query({ athleteId })}`);
  },
  injuryRecords(athleteId) {
    return request(`/api/athletes/${encodeURIComponent(athleteId)}/injuries`);
  },
  personalOverview(athleteId, from, to, project) {
    return request(`/api/athletes/${encodeURIComponent(athleteId)}/overview?${query({ from, to, project })}`);
  },
  championBenchmark(athleteId) {
    return request(`/api/athletes/${encodeURIComponent(athleteId)}/champion-model`);
  }
};
