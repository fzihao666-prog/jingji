import { buildUnifiedDataExport } from './data-import-export.ts';
export { buildUnifiedDataExport, writeUnifiedExportRows } from './data-import-export.ts';
import { UNIFIED_IMPORT_HEADERS, IMPORT_PURPOSE_SHEETS } from '../../shared/data-import-template.ts';
import { buildImportWorkbook } from './template-workbook.ts';
import { dataImportScope } from './data-import-access.ts';
export { dataImportScope } from './data-import-access.ts';
import ExcelJS from 'exceljs';
import { discardDataImport } from './discard-data-import.ts';
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
import { accessibleAthleteIds, accountPermissions, hasAthleteAccess, permissionsAllowAthlete } from '../core/permissions.ts';
import { strengthImportCandidates } from '../strength/strength-training-routes.ts';
import { cleanString } from '../core/utils.ts';
import { dataImportUpload } from '../core/uploads.ts';
import { requireAuth, requireRole } from '../core/auth.ts';
import { PROJECTS, normalizeProject } from '../../shared/projects.ts';
import { INTENSITY_ZONE_SYSTEMS } from '../../shared/training-intensity.ts';
import type { AuthUser, Project } from '../core/shared-server.ts';

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
 * 分用途模板：复用统一模板的表头与解析规则，并按当前项目和权限预填
 * 系统运动员编号、姓名、所属队伍，教练无需导出历史数据即可填报。
 */
export function buildPurposeTemplate(
  kind: Exclude<TemplateKind, 'unified'>,
  project: string,
  athletes: Array<{ id: number; name: string; team: string }>
) {
  const workbook = buildImportWorkbook(PURPOSE_SHEETS[kind]);
  for (const sheetName of PURPOSE_SHEETS[kind]) {
    const headers = unifiedExportHeaders.find(([name]) => name === sheetName)![1];
    const sheet = workbook.getWorksheet(sheetName)!;
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
        if (kind === 'unified') {
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
        buildPurposeTemplate(kind, project, athletes)
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
          .status(400)
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
        });
        res.json({ batch });
      } catch (error) {
        res
          .status(400)
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

  app.get(
    '/api/data-import/batches/:id',
    requireAuth,
    requireRole('SCC', 'REG', 'TD', 'DMD'),
    (req, res) => {
      try {
        res.json({ batch: getDataImportBatch(cleanString(req.params.id), req.authUser!.id) });
      } catch (error) {
        res
          .status(404)
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
          .status(400)
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
        const batch = updateDataImportItems({
          batchId: cleanString(req.params.id),
          userId: req.authUser!.id,
          athletes: dataImportCandidates(req.authUser!),
          corrections,
        });
        res.json({ batch });
      } catch (error) {
        res
          .status(400)
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
        const batch = getDataImportBatch(cleanString(req.params.id), req.authUser!.id);
        const scope = dataImportScope(req.authUser!, batch.project);
        if (!scope.allowed)
          return res.status(403).json({ message: '当前账号无权在该项目创建运动员。' });
        if (req.body?.corrections !== undefined && !Array.isArray(req.body.corrections))
          return res.status(400).json({ message: '人员修改格式无效。' });
        const corrections = Array.isArray(req.body?.corrections) ? req.body.corrections : [];
        const updated = updateDataImportAthleteCandidates({
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
          .status(400)
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
        const result = commitDataImport({
          batchId: cleanString(req.params.id),
          userId: req.authUser!.id,
          creatorRole: req.authUser!.role,
          athletes: dataImportCandidates(req.authUser!),
          allowedTeams: dataImportScope(
            req.authUser!,
            getDataImportBatch(cleanString(req.params.id), req.authUser!.id).project
          ).allowedTeams,
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
          .status(400)
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
