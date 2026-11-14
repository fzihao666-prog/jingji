import type { Express } from 'express';
import { Worker } from 'node:worker_threads';
import type { Response } from 'express';
import { z } from 'zod';
import { isCoachCategory } from '../../shared/coach-categories.ts';
import type { SubmissionReport } from '../../shared/submission-report.ts';
import { PROJECTS } from '../../shared/projects.ts';
import { requireAuth, requireRole } from '../core/auth.ts';
import { db } from '../core/db.ts';
import {
  accountPermissions,
  permissionsAllowProjectTeam,
  selectableProjects,
} from '../core/permissions.ts';
import { buildSubmissionReport, type SubmissionReportInput } from './submission-report-build.ts';

class SubmissionReportBusy extends Error {}

let activeWorkers = 0;
function runSubmissionReport(path: string, input: SubmissionReportInput, response: Response) {
  if (activeWorkers >= 2) throw new SubmissionReportBusy();
  return new Promise<SubmissionReport | Uint8Array>((resolve, reject) => {
    const worker = new Worker(new URL('./submission-report-worker.mjs', import.meta.url), {
      workerData: { path, input },
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

const querySchema = z
  .strictObject({
    project: z.enum(PROJECTS).optional(),
    from: z.iso.date().optional(),
    to: z.iso.date().optional(),
    team: z.string().max(200).optional(),
    roles: z
      .string()
      .max(100)
      .transform((value) => value.split(','))
      .refine((values) => values.every(isCoachCategory))
      .optional(),
    key: z.string().max(400).optional(),
    page: z
      .string()
      .regex(/^\d{1,8}$/)
      .transform(Number)
      .refine((value) => value > 0)
      .optional(),
    format: z.literal('xlsx').optional(),
  })
  .refine(({ from, to }) => !from || !to || from <= to);

export function registerSubmissionReportRoutes(app: Express) {
  app.get(
    '/api/reports/submissions',
    requireAuth,
    requireRole('REG', 'TD', 'DMD'),
    async (req, res) => {
      const parsed = querySchema.safeParse(req.query);
      if (!parsed.success)
        return res.status(400).json({ message: '请检查项目、筛选条件和日期范围。' });
      const user = req.authUser!;
      const { project, format, ...filters } = parsed.data;
      const allowedProjects = selectableProjects(user);
      if (project && !allowedProjects.includes(project)) {
        return res.status(403).json({ message: '当前账号无权查看该项目。' });
      }
      const projects = project ? [project] : allowedProjects;
      const permissions = accountPermissions(user.id);
      if (
        filters.team !== undefined &&
        !projects.some((project) =>
          permissionsAllowProjectTeam(permissions, project, filters.team!)
        )
      ) {
        return res.status(403).json({ message: '当前账号无权查看该队伍。' });
      }
      const input = { project, projects, format, filters, permissions };
      const path = db.location();
      let output;
      try {
        output = path
          ? await runSubmissionReport(path, input, res)
          : await buildSubmissionReport(db, input);
      } catch (error) {
        if (res.destroyed) return;
        if (error instanceof SubmissionReportBusy) {
          return res.status(503).json({ message: '提交统计正在计算，请稍后重试。' });
        }
        throw error;
      }
      if (res.destroyed) return;
      res.setHeader('Cache-Control', 'private, no-store');
      if (!(output instanceof Uint8Array)) return res.json(output);
      res.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.attachment('数据提交检查.xlsx');
      return res.send(Buffer.from(output));
    }
  );
}
