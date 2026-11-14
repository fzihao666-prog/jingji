import type { Express } from 'express';
import ExcelJS from 'exceljs';
import { z } from 'zod';
import { isCoachCategory } from '../../shared/coach-categories.ts';
import { PROJECTS } from '../../shared/projects.ts';
import { requireAuth, requireRole } from '../core/auth.ts';
import { db } from '../core/db.ts';
import {
  accountPermissions,
  permissionsAllowProjectTeam,
  selectableProjects,
} from '../core/permissions.ts';
import {
  collectSubmissionFacts,
  readSubmissionEvidence,
  summarizeSubmissions,
} from './submission-report.ts';

const querySchema = z
  .strictObject({
    project: z.enum(PROJECTS),
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
      if (!selectableProjects(user).includes(project)) {
        return res.status(403).json({ message: '当前账号无权查看该项目。' });
      }
      const permissions = accountPermissions(user.id);
      const canSeeTeam = (team: string) => permissionsAllowProjectTeam(permissions, project, team);
      const athletes = (
        db
          .prepare(
            `
      SELECT a.id,a.name,COALESCE(t.name,a.team,'') AS team FROM athletes a
      LEFT JOIN project_teams t ON t.id=a.team_id AND t.project=a.project WHERE a.project=?
    `
          )
          .all(project) as Array<{ id: number; name: string; team: string }>
      ).filter(({ team }) => canSeeTeam(team));
      if (filters.team !== undefined && !canSeeTeam(filters.team)) {
        return res.status(403).json({ message: '当前账号无权查看该队伍。' });
      }
      const teamNames = [
        ...new Set([
          ...athletes.map(({ team }) => team),
          ...(
            db.prepare('SELECT name FROM project_teams WHERE project=?').all(project) as Array<{
              name: string;
            }>
          )
            .map(({ name }) => name)
            .filter(canSeeTeam),
        ]),
      ].sort();
      const accounts = db
        .prepare('SELECT id,display_name AS name,role,active FROM users')
        .all() as Array<{
        id: number;
        name: string;
        role: string;
        active: number;
      }>;
      const categories = db
        .prepare('SELECT user_id AS id,category FROM coach_profiles ORDER BY user_id,category')
        .all() as Array<{
        id: number;
        category: string;
      }>;
      const rolesByUser = new Map<number, string[]>();
      for (const { id, category } of categories) {
        const roles = rolesByUser.get(id) ?? [];
        roles.push(category);
        rolesByUser.set(id, roles);
      }
      const people = accounts
        .filter(({ role }) => role === 'SCC')
        .map(({ id, name, active }) => {
          const scope = accountPermissions(id);
          return {
            id,
            name,
            roles: rolesByUser.get(id) ?? [],
            teams: active
              ? teamNames.filter((team) => permissionsAllowProjectTeam(scope, project, team))
              : [],
          };
        });
      const report = summarizeSubmissions({
        facts: collectSubmissionFacts(db, project, athletes, teamNames, canSeeTeam('*')),
        athletes,
        people,
        operators: new Map(accounts.map((account) => [account.id, account])),
        evidence: readSubmissionEvidence(db, project),
        filters,
        exporting: format === 'xlsx',
      });
      res.setHeader('Cache-Control', 'private, no-store');
      if (format !== 'xlsx') return res.json({ ...report, teams: teamNames });
      const workbook = new ExcelJS.Workbook();
      const summary = workbook.addWorksheet('汇总', { views: [{ state: 'frozen', ySplit: 1 }] });
      const types = Object.keys(report.types).sort();
      summary.addRow([
        '队伍',
        '岗位',
        '人员或汇总',
        '本人导入',
        '管理员代导入',
        '来源待确认',
        '总导入',
        ...types,
      ]);
      summary.addRow([
        filters.team === undefined ? '全部授权队伍' : filters.team || '未分队',
        '所有岗位',
        '系统总数（去重）',
        null,
        null,
        null,
        report.total,
        ...types.map((type) => report.types[type]),
      ]);
      for (const row of report.rows) {
        summary.addRow([
          row.team || '未分队',
          row.role,
          row.group ? '岗位汇总' : row.name,
          row.direct,
          row.group || row.delegated ? row.delegated : null,
          row.unknown,
          row.total,
          ...types.map((type) => row.types[type] ?? 0),
        ]);
      }
      const detail = workbook.addWorksheet('明细', { views: [{ state: 'frozen', ySplit: 1 }] });
      detail.addRow([
        '记录编号',
        '队伍',
        '岗位',
        '归属人员',
        '数据类型',
        '运动员',
        '业务日期',
        '提交日期',
        '操作账号',
        '归属依据',
      ]);
      for (const row of report.details) {
        detail.addRow([
          row.id,
          row.team || '未分队',
          row.role,
          row.name,
          row.type,
          row.athlete,
          row.businessDate,
          row.submittedDate,
          row.operator,
          row.basis,
        ]);
      }
      for (const sheet of [summary, detail]) {
        sheet.getRow(1).font = { bold: true };
        sheet.columns.forEach((column) => {
          column.width = 22;
        });
      }
      const buffer = await workbook.xlsx.writeBuffer();
      res.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.attachment('数据提交检查.xlsx');
      return res.send(Buffer.from(buffer));
    }
  );
}
