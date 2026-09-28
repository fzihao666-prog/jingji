const { projects } = require('../data/register-data');

const labelsByCode = Object.fromEntries(projects.map(({ code, label }) => [code, label]));

function projectLabel(project) {
  return labelsByCode[project] || project || '未设置';
}

function projectOptions(projects) {
  return (projects || []).map((code) => ({ code, label: projectLabel(code) }));
}

module.exports = { projectLabel, projectOptions };
