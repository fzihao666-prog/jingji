import type { Express } from 'express';
import ExcelJS from 'exceljs';
import { z } from 'zod';
import { isCoachCategory } from '../../shared/coach-categories.ts';
import type { SubmissionReport, SubmissionSummary } from '../../shared/submission-report.ts';
import { projectLabel, PROJECTS } from '../../shared/projects.ts';
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
      const report: SubmissionReport = {
        rows: [],
        total: 0,
        types: Object.create(null),
        details: [],
        detailTotal: 0,
        teams: [],
      };
      const rows = new Map<string, SubmissionSummary>();
      const mergeCounts = (target: Record<string, number>, source: Record<string, number>) => {
        for (const [type, value] of Object.entries(source))
          target[type] = (target[type] ?? 0) + value;
      };
      for (const project of projects) {
        const canSeeTeam = (team: string) =>
          permissionsAllowProjectTeam(permissions, project, team);
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
        const part = summarizeSubmissions({
          project,
          facts: collectSubmissionFacts(db, project, athletes, teamNames, canSeeTeam('*')),
          athletes,
          people,
          operators: new Map(accounts.map((account) => [account.id, account])),
          evidence: readSubmissionEvidence(db, project),
          filters: { ...filters, key: format ? undefined : filters.key },
          exporting: format === 'xlsx' || Boolean(filters.key),
        });

        report.total += part.total;
        report.detailTotal += part.detailTotal;
        for (const detail of part.details) report.details.push(detail);
        report.teams.push(...teamNames);
        mergeCounts(report.types, part.types);
        for (const row of part.rows) {
          const previous = rows.get(row.key);
          if (!previous) {
            rows.set(row.key, { ...row, projects: [projectLabel(project)] });
            continue;
          }
          previous.projects?.push(projectLabel(project));
          previous.team = [
            ...new Set([...previous.team.split('、'), ...row.team.split('、')]),
          ].join('、');
          previous.role = [
            ...new Set([...previous.role.split('、'), ...row.role.split('、')]),
          ].join('、');
          previous.direct += row.direct;
          previous.delegated += row.delegated;
          previous.unknown += row.unknown;
          previous.total += row.total;
          if ((row.lastSubmitted ?? '') > (previous.lastSubmitted ?? ''))
            previous.lastSubmitted = row.lastSubmitted;
          mergeCounts(previous.types, row.types);
        }
      }
      report.teams = [...new Set(report.teams)].sort((a, b) => a.localeCompare(b, 'zh-CN'));
      report.rows = [...rows.values()].sort(
        (a, b) =>
          Number(a.group) - Number(b.group) ||
          b.total - a.total ||
          a.name.localeCompare(b.name, 'zh-CN')
      );
      if (!format && filters.key) {
        const offset = ((filters.page ?? 1) - 1) * 50;
        report.details = report.details.slice(offset, offset + 50);
      }
      res.setHeader('Cache-Control', 'private, no-store');
      if (format !== 'xlsx') return res.json(report);
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
        '项目',
        '最近提交',
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
        project ? projectLabel(project) : '全部授权项目',
        null,
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
          row.projects?.join('、'),
          row.lastSubmitted ?? '',
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
        '项目',
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
          row.project ? projectLabel(row.project) : '',
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
