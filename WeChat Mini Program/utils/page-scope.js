const { periodFor } = require('./date');
const { projectAthletes } = require('./context');

const RANGES = ['day', 'week', 'month'];

function resolveProject(project, projects, fallback) {
  const available = projects || [];
  return available.includes(project) ? project : available.includes(fallback) ? fallback : available[0] || '';
}

function resolveAthlete(user, athletes, preferredId) {
  const available = athletes || [];
  const owns = Number(user && user.athleteId) || 0;
  const valid = (id) => available.some((item) => Number(item.id) === Number(id));
  if (user && user.role === 'ATL') return valid(owns) ? owns : 0;
  const preferred = Number(preferredId) || 0;
  if (valid(preferred)) return preferred;
  if (valid(owns)) return owns;
  return available.length ? Number(available[0].id) || 0 : 0;
}

function resolveDateRange(range) {
  const selected = RANGES.includes(range) ? range : 'month';
  return { range: selected, ...periodFor(selected) };
}

function createInitialScope(context, options = {}) {
  const project = resolveProject(context.project, context.projects);
  const athletes = projectAthletes(context.athletes, project);
  return {
    user: context.user,
    projects: context.projects || [],
    project,
    athletes,
    selectedAthleteId: resolveAthlete(context.user, athletes, options.selectedAthleteId || context.selectedAthleteId),
    showAthlete: options.showAthlete === false ? false : context.user.role !== 'ATL',
    ...resolveDateRange(options.range)
  };
}

function changeScope(scope, allAthletes, field, value) {
  if (field === 'project') {
    const project = resolveProject(value, scope.projects, scope.project);
    const athletes = projectAthletes(allAthletes, project);
    return { project, athletes, selectedAthleteId: resolveAthlete(scope.user, athletes, scope.selectedAthleteId), ...resolveDateRange(scope.range) };
  }
  if (field === 'athleteId') {
    return { selectedAthleteId: resolveAthlete(scope.user, scope.athletes, value) };
  }
  if (field === 'rangeType') return resolveDateRange(value);
  return {};
}

function scopeField(event) {
  return { projectchange: 'project', athletechange: 'athleteId', rangechange: 'rangeType' }[event.type];
}

function applyScopeChange(page, event) {
  const field = scopeField(event);
  if (!field) return null;
  const app = getApp();
  const patch = changeScope(page.data, app.globalData.athletes, field, event.detail.value);
  if (field === 'project' && patch.project === page.data.project) return null;
  if (field === 'project') {
    app.globalData.pendingProject = patch.project;
    app.setProject(patch.project);
  }
  if (patch.selectedAthleteId !== undefined) app.globalData.selectedAthleteId = patch.selectedAthleteId;
  page.setData(patch);
  return { field, patch };
}

function saveProjectInOrder(page, project, save) {
  const previous = page._projectSave || Promise.resolve();
  const pending = previous.catch(() => {}).then(() => save(project));
  page._projectSave = pending;
  pending.then(
    () => { if (getApp().globalData.pendingProject === project) getApp().globalData.pendingProject = ''; },
    () => { if (getApp().globalData.pendingProject === project) getApp().globalData.pendingProject = ''; }
  );
  return pending;
}

module.exports = { createInitialScope, resolveProject, resolveAthlete, resolveDateRange, changeScope, scopeField, applyScopeChange, saveProjectInOrder };
