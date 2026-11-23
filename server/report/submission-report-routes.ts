import type { Express } from 'express';
import { Worker } from 'node:worker_threads';
import type { Response } from 'express';
import type { BasicSubmissionReport, SubmissionReport } from '../../shared/submission-report.ts';
import { requireAuth, requireRole } from '../core/auth.ts';
import { db } from '../core/db.ts';
import { accountPermissions, selectableProjects } from '../core/permissions.ts';
import { buildBasicSubmissionReport } from './basic-submission-report.ts';
import { buildSubmissionReport, type SubmissionReportInput } from './submission-report-build.ts';

class SubmissionReportBusy extends Error {}

let activeWorkers = 0;
function runSubmissionReport(path: string, input: SubmissionReportInput, response: Response, basic: boolean) {
  if (activeWorkers >= 2) throw new SubmissionReportBusy();
  return new Promise<SubmissionReport | BasicSubmissionReport>((resolve, reject) => {
    const worker = new Worker(new URL('./submission-report-worker.mjs', import.meta.url), {
      workerData: { path, input, basic },
      execArgv: [],
    });
    activeWorkers++;
    const close = () => {
      void worker.terminate();
    };
    const timer = setTimeout(() => {
      reject(new SubmissionReportBusy());
      close();
    }, 30_000);
    response.once('close', close);
    worker.once('message', resolve);
    worker.once('error', reject);
    worker.once('exit', () => {
      activeWorkers--;
      clearTimeout(timer);
      response.off('close', close);
      reject(new Error('提交统计工作线程提前退出。'));
    });
  });
}

export function registerSubmissionReportRoutes(app: Express) {
  app.get(
    ['/api/reports/submissions', '/api/reports/submissions/basic'],
    requireAuth,
    requireRole('REG', 'TD', 'DMD'),
    async (req, res) => {
      const user = req.authUser!;
      const basic = req.path.endsWith('/basic');
      const input = {
        projects: selectableProjects(user),
        permissions: accountPermissions(user.id),
      };
      const path = db.location();
      let output;
      try {
        output = path
          ? await runSubmissionReport(path, input, res, basic)
          : basic ? buildBasicSubmissionReport(db, input) : buildSubmissionReport(db, input);
      } catch (error) {
        if (res.destroyed) return;
        if (error instanceof SubmissionReportBusy) {
          return res.status(503).json({ message: '提交统计正在计算，请稍后重试。' });
        }
        throw error;
      }
      if (res.destroyed) return;
      res.setHeader('Cache-Control', 'private, no-store');
      return res.json(output);
    }
  );
}
