import { parentPort, workerData } from 'node:worker_threads';
import { DatabaseSync } from 'node:sqlite';
import { tsImport } from 'tsx/esm/api';

const { buildSubmissionReport } = await tsImport('./submission-report-build.ts', import.meta.url);
const db = new DatabaseSync(workerData.path, { readOnly: true });
try {
  db.exec('PRAGMA busy_timeout=3000; BEGIN');
  const result = workerData.team
    ? (await tsImport('./basic-submission-report.ts', import.meta.url)).buildBasicSubmissionReport(db, workerData.team)
    : buildSubmissionReport(db, workerData.input);
  parentPort.postMessage(result);
} finally {
  db.close();
}
