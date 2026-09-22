const api = require('../services/api');

async function loadContext(options = {}) {
  const app = getApp();
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
  const project = projects.includes(projectResult.project)
    ? projectResult.project
    : projects.includes(storedProject)
      ? storedProject
      : projects[0] || storedProject || '赛艇';
  const athletes = athleteResult.athletes || [];
  const projectAthletes = athletes.filter((item) => !item.project || item.project === project);

  let selectedAthleteId = user.athleteId || app.globalData.selectedAthleteId || 0;
  if (selectedAthleteId && !projectAthletes.some((item) => Number(item.id) === Number(selectedAthleteId))) {
    selectedAthleteId = user.athleteId || 0;
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
