const api = require('../services/api');

async function loadContext(options = {}) {
  const app = getApp();
  const initialProject = app.globalData.currentProject;
  const initialPendingProject = app.globalData.pendingProject;
  const initialAthleteId = app.globalData.selectedAthleteId;
  if (!app.globalData.token) {
    wx.reLaunch({ url: '/pages/login/login' });
    throw new Error('未登录');
  }

  let user = app.globalData.user;
  if (!user || options.refreshUser) {
    const result = await api.me();
    user = result.user;
    app.globalData.user = user;
    wx.setStorageSync('jingji-mini-user', user);
  }

  const [projectResult, athleteResult] = await Promise.all([
    api.currentProject(),
    api.athletes()
  ]);
  const projects = projectResult.projects || [];
  const storedProject = app.globalData.currentProject;
  const project = projects.includes(app.globalData.pendingProject)
    ? app.globalData.pendingProject
    : storedProject !== initialProject && projects.includes(storedProject)
    ? storedProject
    : projects.includes(initialPendingProject)
    ? initialPendingProject
    : projects.includes(projectResult.project)
    ? projectResult.project
    : projects.includes(storedProject)
      ? storedProject
      : projects[0] || storedProject || '赛艇';
  const athletes = athleteResult.athletes || [];
  const projectAthletes = athletes.filter((item) => !item.project || item.project === project);

  const preferredAthleteId = app.globalData.selectedAthleteId !== initialAthleteId
    ? app.globalData.selectedAthleteId : initialAthleteId;
  let selectedAthleteId = user.role === 'ATL'
    ? user.athleteId || 0
    : preferredAthleteId || user.athleteId || 0;
  if (selectedAthleteId && !projectAthletes.some((item) => Number(item.id) === Number(selectedAthleteId))) {
    selectedAthleteId = projectAthletes.some((item) => Number(item.id) === Number(user.athleteId))
      ? user.athleteId : 0;
  }

  app.globalData.currentProject = project;
  app.globalData.projects = projects;
  app.globalData.athletes = athletes;
  app.globalData.selectedAthleteId = selectedAthleteId;
  app.setProject(project);

  return { user, project, projects, athletes, projectAthletes, selectedAthleteId };
}

function projectAthletes(athletes, project) {
  return (athletes || []).filter((item) => !item.project || item.project === project);
}

module.exports = { loadContext, projectAthletes };
