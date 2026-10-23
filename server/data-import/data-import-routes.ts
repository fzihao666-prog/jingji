import { ImportRequestError } from './data-import-revision.ts';
import { readImportMetricDefinitions } from './import-metric-catalog.ts';
import type { ImportMetricDefinition } from '../../shared/import-metric-choice.ts';
import { buildUnifiedDataExport } from './data-import-export.ts';
export { buildUnifiedDataExport, writeUnifiedExportRows } from './data-import-export.ts';
import { UNIFIED_IMPORT_HEADERS, IMPORT_PURPOSE_SHEETS } from '../../shared/data-import-template.ts';
import { templateHeaderKey } from '../../shared/import-template-fields.ts';
import { buildImportWorkbook } from './template-workbook.ts';
import { dataImportScope, assertDataImportBatchAccess } from './data-import-access.ts';
export { dataImportScope } from './data-import-access.ts';
import ExcelJS from 'exceljs';
import { discardDataImport } from './discard-data-import.ts';
import { z } from 'zod';
import { cleanupExpiredImportDrafts, listExpiredImportDrafts } from './expired-import-drafts.ts';
import { IMPORT_DRAFT_RETENTION_DAYS, IMPORT_DRAFT_CLEANUP_LIMIT } from '../../shared/import-draft-cleanup.js';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Express } from 'express';
import { db } from '../core/db.ts';
import {
  analyzeDataImport,
  commitDataImport,
  getDataImportBatch,
  listDataImportBatches,
  updateDataImportAthleteCandidates,
  updateDataImportItems,
} from './data-import.ts';
import { accountPermissions, permissionsAllowAthlete } from '../core/permissions.ts';
import { strengthImportCandidates } from '../strength/strength-training-routes.ts';
import { cleanString } from '../core/utils.ts';
import { dataImportUpload } from '../core/uploads.ts';
import { requireAuth, requireRole } from '../core/auth.ts';
import { PROJECTS, normalizeProject } from '../../shared/projects.ts';
import { INTENSITY_ZONE_SYSTEMS } from '../../shared/training-intensity.ts';
import type { AuthUser } from '../core/shared-server.ts';

/** 停用档案仅向有删除/恢复权限且满足当前地域、项目、队伍范围的管理者提供。 */
function dataImportCandidates(user: AuthUser) {
  const active = strengthImportCandidates(user);
  if (!['REG', 'TD', 'DMD'].includes(user.role)) return active;
  const permissions = accountPermissions(user.id);
  const inactive = db.prepare(`
    SELECT a.id, a.name, a.project, COALESCE(pt.name, a.team, '') AS team, a.gender,
      COALESCE(a.birth_date, '') AS birthDate,
      COALESCE(ao.province, '') AS region, COALESCE(ao.city, '') AS city, COALESCE(ao.county, '') AS county
    FROM athletes a LEFT JOIN project_teams pt ON pt.id = a.team_id
    LEFT JOIN athlete_origins ao ON ao.athlete_id = a.id WHERE a.active = 0
  `).all() as Array<{ id: number; name: string; project: string; team: string; gender: string;
    birthDate: string; region: string; city: string; county: string }>;
  return [...active, ...inactive.filter(athlete => permissionsAllowAthlete(permissions, athlete))
    .map(athlete => ({ ...athlete, active: false }))];
}

export const unifiedTemplateName = '竞迹统一数据导入模板.xlsx';
export const unifiedTemplatePath = () =>
  [
    resolve(process.cwd(), 'public', 'templates', unifiedTemplateName),
    resolve(process.cwd(), 'dist', 'templates', unifiedTemplateName),
  ].find(existsSync);

export const unifiedExportHeaders = UNIFIED_IMPORT_HEADERS;

export type TemplateKind = 'profile' | 'training' | 'test' | 'unified';

const PURPOSE_SHEETS = IMPORT_PURPOSE_SHEETS;

const PURPOSE_TITLES: Record<TemplateKind, string> = {
  profile: '队员资料模板',
  training: '训练记录模板',
  test: '测试成绩模板',
  unified: '统一数据模板',
};

/**
 * 统一模板与分用途模板：复用统一模板的表头与解析规则，并按当前项目和权限预填
 * 系统运动员编号、姓名、所属队伍，教练无需导出历史数据即可填报。统一模板
 * 覆盖全部业务表，其余按用途取表，预填行组织方式与分用途模板保持一致。
 */
export function buildPurposeTemplate(
  kind: TemplateKind,
  project: string,
  athletes: Array<{ id: number; name: string; team: string }>,
  metrics?: readonly ImportMetricDefinition[]
) {
  const sheetNames = kind === 'unified' ? UNIFIED_IMPORT_HEADERS.map(([name]) => name) : PURPOSE_SHEETS[kind];
  const workbook = buildImportWorkbook(sheetNames, { metrics });
  for (const sheetName of sheetNames) {
    const sheet = workbook.getWorksheet(sheetName)!;
    const headers = (sheet.getRow(3).values as ExcelJS.CellValue[]).slice(1).map(value => templateHeaderKey(String(value)));
    athletes.forEach((athlete, index) => {
      sheet.getRow(index + 4).values = headers.map(label => {
        if (label === '系统运动员编号') return athlete.id;
        if (label === '姓名') return athlete.name;
        if (label === '所属队伍') return athlete.team;
        if (label === '运动项目') return project;
        return null;
      });
    });
  }
  return workbook;
}

export function buildImportErrorReport(batch: {
  filename: string;
  items: Array<{
    itemType: string;
    rawAthleteName: string;
    eventDate: string;
    metricLabel: string;
    exerciseName: string;
    sourceSheet: string;
    sourceAddress: string;
    rawValue: string;
    quality: string;
    messages: string[];
  }>;
}) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = '竞迹训练监控系统';
  const sheet = workbook.addWorksheet('错误清单');
  const headers = ['工作表', '单元格', '记录类型', '运动员', '日期', '字段/指标', '原值', '状态', '问题原因'];
  sheet.getRow(1).values = headers;
  sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF172033' } };
  headers.forEach((label, index) => {
    sheet.getColumn(index + 1).width = label === '问题原因' ? 48 : 16;
  });
  const rows = batch.items.filter(
    (item) => item.quality === 'error' || item.quality === 'warning' || item.itemType === 'invalid_row'
  );
  rows.forEach((item, index) => {
    sheet.getRow(index + 2).values = [
      item.sourceSheet,
      item.sourceAddress,
      item.itemType,
      item.rawAthleteName,
      item.eventDate,
      item.exerciseName || item.metricLabel,
      item.rawValue,
      item.quality === 'error' ? '错误' : item.quality === 'warning' ? '警告' : '已跳过',
      item.messages.join('；'),
    ];
  });
  return workbook;
}

function expectedImportRevision(value: unknown): number {
  if (value === undefined) throw new ImportRequestError('请刷新导入页面后重试，缺少草稿修订号。', 428);
  const revision = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value;
  if (typeof revision !== 'number' || !Number.isSafeInteger(revision) || revision < 0)
    throw new ImportRequestError('草稿修订号格式无效。', 400);
  return revision;
}
function authorizeImportBatch(user: AuthUser, batchId: string) {
  return assertDataImportBatchAccess(user, batchId, dataImportCandidates(user));
}

export function registerDataImportRoutes(app: Express) {
  app.get(
    '/api/data-import/template',
    requireAuth,
    requireRole('SCC', 'REG', 'TD', 'DMD'),
    (req, res) => {
      const kind = (cleanString(req.query.kind) || 'unified') as TemplateKind;
      if (!['profile', 'training', 'test', 'unified'].includes(kind))
        return res.status(400).json({ message: '模板类型无效。' });
      try {
        if (kind === 'unified' && !cleanString(req.query.project)) {
          // 本地开发从 public 读取；生产环境可能只保留 dist，因此提供构建产物兜底。
          const templatePath = unifiedTemplatePath();
          if (!templatePath) return res.status(404).json({ message: '统一数据导入模板尚未部署。' });
          res.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
          return res.download(templatePath, unifiedTemplateName);
        }
        const project = normalizeProject(cleanString(req.query.project));
        if (!project) return res.status(400).json({ message: '请选择有效的运动项目。' });
        const scope = dataImportScope(req.authUser!, project);
        if (!scope.allowed)
          return res.status(403).json({ message: '当前账号无权导出该项目模板。' });
        const athletes = strengthImportCandidates(req.authUser!)
          .filter((athlete) => athlete.project === project)
          .map((athlete) => ({ id: athlete.id, name: athlete.name, team: athlete.team }));
        const metrics = kind === 'test' || kind === 'unified' ? readImportMetricDefinitions(project) : undefined;
        const workbook = buildPurposeTemplate(kind, project, athletes, metrics);
        workbook
          .xlsx.writeBuffer()
          .then((buffer) => {
            const filename = `竞迹${project}${PURPOSE_TITLES[kind]}_${new Date().toISOString().slice(0, 10)}.xlsx`;
            res.setHeader(
              'Content-Type',
              'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
            );
            res.setHeader(
              'Content-Disposition',
              `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`
            );
            res.send(Buffer.from(buffer));
          })
          .catch((error) => {
            res
              .status(500)
              .json({ message: error instanceof Error ? error.message : '模板生成失败。' });
          });
      } catch (error) {
        res
          .status(500)
          .json({ message: error instanceof Error ? error.message : '模板生成失败。' });
      }
    }
  );

  app.get(
    '/api/data-import/batches/:id/errors',
    requireAuth,
    requireRole('SCC', 'REG', 'TD', 'DMD'),
    async (req, res) => {
      try {
        authorizeImportBatch(req.authUser!, cleanString(req.params.id));
        const batch = getDataImportBatch(cleanString(req.params.id), req.authUser!.id);
        const workbook = buildImportErrorReport(batch);
        const buffer = await workbook.xlsx.writeBuffer();
        const filename = `竞迹导入问题清单_${batch.filename.replace(/\.(xls|xlsx)$/i, '')}.xlsx`;
        res.setHeader(
          'Content-Type',
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        );
        res.setHeader(
          'Content-Disposition',
          `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`
        );
        res.send(Buffer.from(buffer));
      } catch (error) {
        res
          .status(error instanceof ImportRequestError ? error.status : 400)
          .json({ message: error instanceof Error ? error.message : '问题清单导出失败。' });
      }
    }
  );

  app.get(
    '/api/data-import/export',
    requireAuth,
    requireRole('SCC', 'REG', 'TD', 'DMD'),
    async (req, res) => {
      try {
        const project = normalizeProject(cleanString(req.query.project));
        if (!project) return res.status(400).json({ message: '请选择有效的运动项目。' });
        const scope = dataImportScope(req.authUser!, project);
        if (!scope.allowed)
          return res.status(403).json({ message: '当前账号无权导出该项目数据。' });
        const athleteIds = strengthImportCandidates(req.authUser!)
          .filter((athlete) => athlete.project === project)
          .map((athlete) => athlete.id);
        const workbook = await buildUnifiedDataExport(project, athleteIds);
        const buffer = await workbook.xlsx.writeBuffer();
        const filename = `竞迹${project}统一数据导出_${new Date().toISOString().slice(0, 10)}.xlsx`;
        res.setHeader(
          'Content-Type',
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        );
        res.setHeader(
          'Content-Disposition',
          `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`
        );
        res.send(Buffer.from(buffer));
      } catch (error) {
        res
          .status(500)
          .json({ message: error instanceof Error ? error.message : '统一数据导出失败。' });
      }
    }
  );

  app.post(
    '/api/data-import/analyze',
    requireAuth,
    requireRole('SCC', 'REG', 'TD', 'DMD'),
    dataImportUpload.single('file'),
    (req, res) => {
      try {
        if (!req.file) return res.status(400).json({ message: '请选择要导入的 Excel 文件。' });
        const project = cleanString(req.body?.project);
        if (!PROJECTS.includes(project))
          return res.status(400).json({ message: '请选择有效的运动项目。' });
        const scope = dataImportScope(req.authUser!, project);
        if (!scope.allowed)
          return res.status(403).json({ message: '当前账号在该项目下没有可导入的队伍权限。' });
        if (!scope.allowedTeams.size)
          return res.status(400).json({ message: '该项目当前没有可导入的有效队伍，请先在组织管理中建立或启用授权范围内的队伍。' });
        const athletes = dataImportCandidates(req.authUser!).filter(
          (athlete) => athlete.project === project
        );
        const batch = analyzeDataImport({
          buffer: req.file.buffer,
          filename: req.file.originalname,
          mimetype: req.file.mimetype,
          project,
          defaultDate: cleanString(req.body?.defaultDate),
          defaultArea: scope.defaultArea,
          userId: req.authUser!.id,
          athletes,
          allowedTeams: scope.allowedTeams,
          reparse: cleanString(req.body?.reparse) === '1',
          expectedRevision: cleanString(req.body?.reparse) === '1' ? expectedImportRevision(req.body?.expectedRevision) : undefined,
          authorizeBatch: batchId => { authorizeImportBatch(req.authUser!, batchId); },
        });
        res.json({ batch });
      } catch (error) {
        res
          .status(error instanceof ImportRequestError ? error.status : 400)
          .json({ message: error instanceof Error ? error.message : '数据文件解析失败。' });
      }
    }
  );

  app.get(
    '/api/data-import/batches',
    requireAuth,
    requireRole('SCC', 'REG', 'TD', 'DMD'),
    (req, res) => {
      const project = cleanString(req.query.project);
      if (!PROJECTS.includes(project))
        return res.status(400).json({ message: '请选择有效的运动项目。' });
      if (!dataImportScope(req.authUser!, project).allowed)
        return res.status(403).json({ message: '当前账号无权查看该项目的导入记录。' });
      res.json({ batches: listDataImportBatches(project, req.authUser!.id) });
    }
  );

  const cleanupProject = z.string().trim().min(1).max(50).refine(project => PROJECTS.includes(project));
  const cleanupPreviewSchema = z.object({ project: cleanupProject }).strict();
  const cleanupSchema = z.object({ project: cleanupProject, drafts: z.array(z.object({ id: z.string().trim().min(1).max(100), revision: z.number().int().min(0).safe() }).strict()).min(1).max(IMPORT_DRAFT_CLEANUP_LIMIT) }).strict();
  const checkCleanupProject = (user: AuthUser, project: string) => {
    if (!dataImportScope(user, project).allowed) throw new ImportRequestError('当前账号无权清理该项目草稿。', 403);
  };
  const authorizeCleanupBatch = (user: AuthUser, id: string) => {
    authorizeImportBatch(user, id);
    const permissions = accountPermissions(user.id);
    const pending = db.prepare('SELECT project,team,region,city,county FROM data_import_athlete_candidates WHERE batch_id=? AND matched_athlete_id IS NULL AND created_athlete_id IS NULL').all(id) as Array<{ project: string; team: string; region: string; city: string; county: string }>;
    if (pending.some(person => !person.team || !permissionsAllowAthlete(permissions, { ...person, id: 0 }))) throw new ImportRequestError('该草稿人员范围无法按当前权限确认，已保留。', 403);
  };
  app.get('/api/data-import/draft-cleanup', requireAuth, requireRole('SCC', 'REG', 'TD', 'DMD'), (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const parsed = cleanupPreviewSchema.safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ message: '请选择有效项目。' });
    try {
      checkCleanupProject(req.authUser!, parsed.data.project);
      const drafts = listExpiredImportDrafts({ userId: req.authUser!.id, project: parsed.data.project, authorize: id => { authorizeCleanupBatch(req.authUser!, id); } });
      return res.json({ retentionDays: IMPORT_DRAFT_RETENTION_DAYS, drafts });
    } catch (error) { return res.status(error instanceof ImportRequestError ? error.status : 500).json({ message: error instanceof ImportRequestError ? error.message : '过期草稿预览失败。' }); }
  });
  app.post('/api/data-import/draft-cleanup', requireAuth, requireRole('SCC', 'REG', 'TD', 'DMD'), (req, res) => {
    const parsed = cleanupSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: '清理参数无效，请重新预览后确认。' });
    try {
      const result = cleanupExpiredImportDrafts({ ...parsed.data, userId: req.authUser!.id, authorize: id => { authorizeCleanupBatch(req.authUser!, id); }, authorizeProject: () => checkCleanupProject(req.authUser!, parsed.data.project) });
      return res.json({ ...result, message: `已清理${result.deletedCount}个过期草稿及相关暂存明细，正式数据保持不变。` });
    } catch (error) { return res.status(error instanceof ImportRequestError ? error.status : 500).json({ message: error instanceof ImportRequestError ? error.message : '清理失败，已回滚，未删除草稿。' }); }
  });

  app.get(
    '/api/data-import/batches/:id',
    requireAuth,
    requireRole('SCC', 'REG', 'TD', 'DMD'),
    (req, res) => {
      try {
        authorizeImportBatch(req.authUser!, cleanString(req.params.id));
        res.json({ batch: getDataImportBatch(cleanString(req.params.id), req.authUser!.id) });
      } catch (error) {
        res
          .status(error instanceof ImportRequestError ? error.status : 404)
          .json({ message: error instanceof Error ? error.message : '导入批次不存在。' });
      }
    }
  );

  app.delete(
    '/api/data-import/batches/:id',
    requireAuth,
    requireRole('SCC', 'REG', 'TD', 'DMD'),
    (req, res) => {
      const project = cleanString(req.query.project);
      if (!PROJECTS.includes(project))
        return res.status(400).json({ message: '请选择有效的运动项目。' });
      if (!dataImportScope(req.authUser!, project).allowed)
        return res.status(403).json({ message: '当前账号无权操作该项目的导入记录。' });
      try {
        discardDataImport(cleanString(req.params.id), req.authUser!.id, project);
        res.json({ message: '已放弃提交，并删除该批次及相关暂存数据。' });
      } catch (error) {
        res
          .status(error instanceof ImportRequestError ? error.status : 400)
          .json({ message: error instanceof Error ? error.message : '放弃提交失败。' });
      }
    }
  );

  app.put(
    '/api/data-import/batches/:id/items',
    requireAuth,
    requireRole('SCC', 'REG', 'TD', 'DMD'),
    (req, res) => {
      try {
        if (req.body?.corrections !== undefined && !Array.isArray(req.body.corrections))
          return res.status(400).json({ message: '校对修改格式无效。' });
        const corrections = Array.isArray(req.body?.corrections) ? req.body.corrections : [];
        authorizeImportBatch(req.authUser!, cleanString(req.params.id));
        const batch = updateDataImportItems({
          batchId: cleanString(req.params.id),
          userId: req.authUser!.id,
          athletes: dataImportCandidates(req.authUser!),
          corrections,
          reviewTargetId: req.body?.reviewTargetId,
          expectedRevision: expectedImportRevision(req.body?.expectedRevision),
          authorizeBatch: () => { authorizeImportBatch(req.authUser!, cleanString(req.params.id)); },
        });
        res.json({ batch, partial: req.body?.reviewTargetId !== undefined });
      } catch (error) {
        res
          .status(error instanceof ImportRequestError ? error.status : 400)
          .json({ message: error instanceof Error ? error.message : '导入数据校验失败。' });
      }
    }
  );

  app.put(
    '/api/data-import/batches/:id/athletes',
    requireAuth,
    requireRole('SCC', 'REG', 'TD', 'DMD'),
    (req, res) => {
      try {
        authorizeImportBatch(req.authUser!, cleanString(req.params.id));
        const batch = getDataImportBatch(cleanString(req.params.id), req.authUser!.id);
        const scope = dataImportScope(req.authUser!, batch.project);
        if (!scope.allowed)
          return res.status(403).json({ message: '当前账号无权在该项目创建运动员。' });
        if (req.body?.corrections !== undefined && !Array.isArray(req.body.corrections))
          return res.status(400).json({ message: '人员修改格式无效。' });
        const corrections = Array.isArray(req.body?.corrections) ? req.body.corrections : [];
        const updated = updateDataImportAthleteCandidates({
          expectedRevision: expectedImportRevision(req.body?.expectedRevision),
          authorizeBatch: () => { authorizeImportBatch(req.authUser!, cleanString(req.params.id)); },
          batchId: batch.id,
          userId: req.authUser!.id,
          allowedTeams: scope.allowedTeams,
          athletes: dataImportCandidates(req.authUser!).filter(
            (athlete) => athlete.project === batch.project
          ),
          corrections,
        });
        res.json({ batch: updated });
      } catch (error) {
        res
          .status(error instanceof ImportRequestError ? error.status : 400)
          .json({ message: error instanceof Error ? error.message : '新运动员资料保存失败。' });
      }
    }
  );

  app.post(
    '/api/data-import/batches/:id/commit',
    requireAuth,
    requireRole('SCC', 'REG', 'TD', 'DMD'),
    (req, res) => {
      try {
        const conflictPolicy =
          cleanString(req.body?.conflictPolicy) === 'update' ? 'update' : 'skip';
        authorizeImportBatch(req.authUser!, cleanString(req.params.id));
        const batch = getDataImportBatch(cleanString(req.params.id), req.authUser!.id);
        const scope = dataImportScope(req.authUser!, batch.project);
        if (!scope.allowed)
          return res.status(403).json({ message: '当前账号已无该项目导入权限，请重新核对授权。' });
        const result = commitDataImport({
          expectedRevision: expectedImportRevision(req.body?.expectedRevision),
          authorizeBatch: () => { authorizeImportBatch(req.authUser!, cleanString(req.params.id)); },
          batchId: cleanString(req.params.id),
          userId: req.authUser!.id,
          creatorRole: req.authUser!.role,
          athletes: dataImportCandidates(req.authUser!),
          allowedTeams: scope.allowedTeams,
          conflictPolicy,
        });
        res.json({
          message:
            `新建运动员${result.createdAthletes || 0}人、关联已有${result.linkedAthletes || 0}人；` +
            `新增记录${result.createdRecords || 0}条、更新${result.updatedRecords || 0}条、跳过${result.skipped}条；` +
            `补全空缺字段${result.filledProfileFields || 0}项、覆盖已有字段${result.overwrittenProfileFields || 0}项。`,
          ...result,
        });
      } catch (error) {
        res
          .status(error instanceof ImportRequestError ? error.status : 400)
          .json({ message: error instanceof Error ? error.message : '导入提交失败。' });
      }
    }
  );

  app.get(
    '/api/data-management/metrics',
    requireAuth,
    requireRole('SCC', 'REG', 'TD', 'DMD'),
    (_req, res) => {
      const metrics = db
        .prepare(
          `SELECT code, label, domain, unit, direction, frequency, active FROM metric_definitions ORDER BY active DESC, domain, label`
        )
        .all();
      const aliases = db
        .prepare(
          `SELECT alias, normalized_alias AS normalizedAlias, metric_code AS metricCode, canonical_label AS canonicalLabel, unit, side FROM metric_aliases ORDER BY metric_code, alias`
        )
        .all();
      res.json({ metrics, aliases });
    }
  );

  app.put(
    '/api/data-management/metrics/:code',
    requireAuth,
    requireRole('TD', 'DMD'),
    (req, res) => {
      const code = cleanString(req.params.code);
      const label = cleanString(req.body?.label);
      const unit = cleanString(req.body?.unit);
      const active = req.body?.active === false ? 0 : 1;
      if (!/^[a-z][a-z0-9_]{1,80}$/.test(code) || !label || label.length > 80 || unit.length > 24)
        return res.status(400).json({ message: '指标编码、名称或单位不合法。' });
      const result = db
        .prepare(
          `UPDATE metric_definitions SET label = ?, unit = ?, active = ?, updated_at = CURRENT_TIMESTAMP WHERE code = ?`
        )
        .run(label, unit, active, code);
      if (!result.changes)
        return res.status(404).json({ message: '指标不存在；请先通过正式导入或迁移建立指标。' });
      res.json({ message: '指标字典已更新。' });
    }
  );

  app.put(
    '/api/data-management/metric-aliases',
    requireAuth,
    requireRole('TD', 'DMD'),
    (req, res) => {
      const alias = cleanString(req.body?.alias);
      const metricCode = cleanString(req.body?.metricCode);
      const side = ['left', 'right', 'bilateral', 'center'].includes(cleanString(req.body?.side))
        ? cleanString(req.body?.side)
        : 'center';
      const metric = db
        .prepare(`SELECT label, unit FROM metric_definitions WHERE code = ? AND active = 1`)
        .get(metricCode) as { label: string; unit: string } | undefined;
      if (!alias || alias.length > 80 || !metric)
        return res.status(400).json({ message: '别名或指标编码无效。' });
      db.prepare(
        `INSERT INTO metric_aliases (alias, normalized_alias, metric_code, canonical_label, unit, side) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(alias) DO UPDATE SET normalized_alias = excluded.normalized_alias, metric_code = excluded.metric_code, canonical_label = excluded.canonical_label, unit = excluded.unit, side = excluded.side, updated_at = CURRENT_TIMESTAMP`
      ).run(
        alias,
        alias.normalize('NFKC').replace(/\s+/g, '').toLowerCase(),
        metricCode,
        metric.label,
        metric.unit,
        side
      );
      res.json({ message: '指标别名已保存。' });
    }
  );

  app.get(
    '/api/data-management/standards',
    requireAuth,
    requireRole('SCC', 'REG', 'TD', 'DMD'),
    (_req, res) => {
      res.json({
        athlete: ['athletes', 'athlete_profiles', 'athlete_origins', 'athlete_aliases'],
        training: {
          types: ['专项训练', '体能训练', '恢复训练', '休息'],
          structures: ['水上训练', '陆上训练', '体能训练', '再生恢复'],
          zoneSystems: INTENSITY_ZONE_SYSTEMS.map((system) => system.label),
        },
        testing: ['test_sessions', 'test_measurements', 'metric_definitions', 'metric_aliases'],
        sources: ['manual', 'file_import', 'ai_import', 'legacy_migration'],
        qualities: ['valid', 'partial', 'insufficient', 'outlier', 'estimated'],
        retiredTables: [
          'training_records',
          'athlete_strength_tests',
          'strength_training_sets',
          'strength_import_batches',
        ],
      });
    }
  );
}
