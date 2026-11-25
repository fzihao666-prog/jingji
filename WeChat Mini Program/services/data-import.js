const { request, downloadFile } = require('../utils/request');
const { importMultipart } = require('../utils/import-multipart');

const IMPORT_ROLES = ['SCC', 'REG', 'TD', 'DMD'];
const BATCH_PATH = '/api/data-import/batches';
const TIMEOUT = 120000;

function canImport(user) {
  return !!user && IMPORT_ROLES.includes(user.role);
}

async function upload(path, files, fields, fileField = 'file') {
  const multipart = await importMultipart(fields, files, fileField);
  return request(path, { ...multipart, method: 'POST', timeout: TIMEOUT });
}

function updateBatch(batch, suffix, method, data) {
  return request(`${BATCH_PATH}/${encodeURIComponent(batch.id)}/${suffix}`, {
    method, timeout: TIMEOUT, data: { ...data, expectedRevision: batch.revision }
  });
}

function template(kind, project, team) {
  const teamQuery = team ? `&team=${encodeURIComponent(team)}` : '';
  return downloadFile(`/api/data-import/template?kind=${encodeURIComponent(kind)}&project=${encodeURIComponent(project)}${teamQuery}`);
}

module.exports = {
  canImport,
  template,
  teams: () => request('/api/admin/teams'),
  excel: (file, project, team) => upload('/api/data-import/analyze', [file], { project, team }),
  refreshPeople: (batch) => updateBatch(batch, 'athletes', 'PUT', { autoMatch: true }),
  updatePeople: (batch, corrections) => updateBatch(batch, 'athletes', 'PUT', { corrections }),
  updateItems: (batch, corrections) => updateBatch(batch, 'items', 'PUT', { corrections }),
  commitExcel: (batch) => updateBatch(batch, 'commit', 'POST', { conflictPolicy: 'update' }),
  teamExcel: (file, project, teamId, mappings) =>
    upload('/api/team-training-stats/import', [file], { project, teamId, mappings: JSON.stringify(mappings) }),
  enodePreview: (files, project) => upload('/api/enode/preview', files, { project }, 'files'),
  enodeImport: (files, project, decisions) =>
    upload('/api/enode/import', files, { project, decisions: JSON.stringify(decisions) }, 'files')
};
