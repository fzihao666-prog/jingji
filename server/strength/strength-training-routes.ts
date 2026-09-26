import ExcelJS from 'exceljs';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Express } from 'express';
import { db } from '../core/db.ts';
import { recognizeStrengthImport, type RecognizedStrengthRow } from './strength-import-ai.ts';
import {
  inferStrengthBodyPosition,
  inferStrengthCategory,
  isStrengthBodyPosition,
  isStrengthIntensityZone,
  isStrengthTrainingCategory,
  isStrengthTrainingEnvironment,
  type StrengthBodyPosition,
  type StrengthIntensityZone,
  type StrengthTrainingCategory,
  type StrengthTrainingEnvironment,
} from '../../shared/strength-training.ts';
import { accessibleAthleteIds, hasAthleteAccess } from '../core/permissions.ts';
import { cleanString, strengthImportNumber } from '../core/utils.ts';
import { upload } from '../core/uploads.ts';
import { requireAuth, requireRole } from '../core/auth.ts';
import type { AuthUser, StrengthImportRow } from '../core/shared-server.ts';
import type { Project } from '../../shared/projects.ts';

export const strengthImportCache = new Map<
  string,
  {
    ownerId: number;
    filename: string;
    mimetype: string;
    sourceType: 'excel' | 'csv' | 'image' | 'pdf';
    rows: StrengthImportRow[];
    modelUsed: string;
    expiresAt: number;
  }
>();

export function strengthImportCandidates(user: AuthUser) {
  const ids = accessibleAthleteIds(user);
  if (!ids.length)
    return [] as Array<{ id: number; name: string; project: string; team: string; gender: string }>;
  const placeholders = ids.map(() => '?').join(',');
  return db
    .prepare(
      `
    SELECT id, name, project, team, gender
    FROM athletes WHERE id IN (${placeholders}) AND active = 1
    ORDER BY name, id
  `
    )
    .all(...ids) as Array<{
    id: number;
    name: string;
    project: string;
    team: string;
    gender: string;
  }>;
}

export function strengthImportDate(value: unknown) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, '0');
    const day = String(value.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
  const text = cleanString(value)
    .replace(/[.\/年]/g, '-')
    .replace(/月/g, '-')
    .replace(/日/g, '')
    .replace(/-+/g, '-');
  const match = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (!match) return text;
  return `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`;
}

export function strengthImportBoolean(value: unknown, fallback = true) {
  if (typeof value === 'boolean') return value;
  const text = cleanString(value).toLowerCase();
  if (['否', '未完成', 'false', '0', 'no'].includes(text)) return false;
  if (['是', '完成', 'true', '1', 'yes'].includes(text)) return true;
  return fallback;
}

export function strengthCellText(value: ExcelJS.CellValue) {
  if (value instanceof Date) return strengthImportDate(value);
  if (value && typeof value === 'object') {
    if ('result' in value) return cleanString(value.result);
    if ('text' in value) return cleanString(value.text);
    if ('richText' in value && Array.isArray(value.richText))
      return value.richText.map((item) => item.text).join('');
  }
  return cleanString(value);
}

export function normalizedStrengthHeader(value: unknown) {
  return cleanString(value)
    .toLowerCase()
    .replace(/[\s_()（）/\\-]/g, '');
}

export function strengthRecordValue(record: Record<string, unknown>, aliases: string[]) {
  for (const alias of aliases) {
    const value = record[normalizedStrengthHeader(alias)];
    if (value !== undefined && cleanString(value) !== '') return value;
  }
  return '';
}

export function validateStrengthImportRow(
  source: Record<string, unknown>,
  rowNumber: number,
  athletes: Array<{ id: number; name: string; project: string; team: string; gender: string }>
): StrengthImportRow {
  const athleteName = cleanString(
    source.athleteName ?? strengthRecordValue(source, ['运动员', '运动员姓名', '姓名', 'athlete'])
  );
  const team = cleanString(source.team ?? strengthRecordValue(source, ['队伍', '组别', 'team']));
  const requestedAthleteId = Number(source.athleteId || 0);
  let matches = requestedAthleteId
    ? athletes.filter((athlete) => athlete.id === requestedAthleteId)
    : athletes.filter((athlete) => athlete.name === athleteName);
  if (matches.length > 1 && team) matches = matches.filter((athlete) => athlete.team === team);
  const matched = matches.length === 1 ? matches[0] : null;
  const trainingDate = strengthImportDate(
    source.trainingDate ?? strengthRecordValue(source, ['训练日期', '日期', 'date'])
  );
  const sessionLabel =
    cleanString(
      source.sessionLabel ??
        strengthRecordValue(source, ['训练场次', '场次', '训练名称', 'session'])
    ) || '体能训练';
  const exerciseName = cleanString(
    source.exerciseName ??
      strengthRecordValue(source, ['动作', '动作名称', '训练项目', '项目', 'exercise'])
  );
  const categoryValue = cleanString(
    source.trainingCategory ??
      strengthRecordValue(source, ['训练类型', '体能类型', '训练分类', 'category'])
  );
  const bodyPositionValue = cleanString(
    source.bodyPosition ??
      strengthRecordValue(source, ['身体位置', '训练身体位置', '部位', 'bodyposition'])
  );
  const environmentValue = cleanString(
    source.trainingEnvironment ??
      strengthRecordValue(source, ['训练环境', '水陆类型', '训练场地', 'environment'])
  );
  const intensityZoneValue = cleanString(
    source.intensityZone ?? strengthRecordValue(source, ['强度区间', '强度分区', 'intensityzone'])
  ).toUpperCase();
  const trainingCategory = isStrengthTrainingCategory(categoryValue)
    ? categoryValue
    : inferStrengthCategory(exerciseName);
  const bodyPosition = isStrengthBodyPosition(bodyPositionValue)
    ? bodyPositionValue
    : inferStrengthBodyPosition(exerciseName);
  const trainingEnvironment = isStrengthTrainingEnvironment(environmentValue)
    ? environmentValue
    : '陆上';
  const intensityZone = isStrengthIntensityZone(intensityZoneValue) ? intensityZoneValue : 'AN';
  const setIndex = Math.max(
    1,
    Math.round(
      strengthImportNumber(
        source.setIndex ?? strengthRecordValue(source, ['组次', '第几组', '组序号', 'set'])
      ) || 1
    )
  );
  const targetReps = strengthImportNumber(
    source.targetReps ?? strengthRecordValue(source, ['计划次数', '目标次数', 'targetreps'])
  );
  const actualReps = strengthImportNumber(
    source.actualReps ??
      strengthRecordValue(source, ['实际次数', '完成次数', '次数', 'actualreps', 'reps'])
  );
  const plannedWeightKg = strengthImportNumber(
    source.plannedWeightKg ??
      strengthRecordValue(source, ['计划重量kg', '计划重量', '目标重量kg', 'plannedweightkg'])
  );
  const actualWeightKg = strengthImportNumber(
    source.actualWeightKg ??
      strengthRecordValue(source, ['实际重量kg', '实际重量', '重量kg', '重量', 'weightkg'])
  );
  const durationMin =
    strengthImportNumber(
      source.durationMin ??
        strengthRecordValue(source, [
          '训练时间min',
          '训练时长min',
          '训练时间',
          '时长',
          'durationmin',
        ])
    ) || 0;
  const distanceKm =
    strengthImportNumber(
      source.distanceKm ??
        strengthRecordValue(source, ['训练距离km', '训练距离', '距离km', 'distancekm'])
    ) || 0;
  const intensityPercent = strengthImportNumber(
    source.intensityPercent ??
      strengthRecordValue(source, ['强度%', '训练强度%', '强度百分比', 'intensitypercent'])
  );
  const rpe = strengthImportNumber(source.rpe ?? strengthRecordValue(source, ['rpe', '主观疲劳']));
  const completed = strengthImportBoolean(
    source.completed ?? strengthRecordValue(source, ['是否完成', '完成状态', 'completed']),
    true
  );
  const note = cleanString(source.note ?? strengthRecordValue(source, ['备注', '说明', 'note']));
  const confidence = strengthImportNumber(
    source.confidence ?? strengthRecordValue(source, ['置信度', 'confidence'])
  );
  const originalText = cleanString(source.originalText) || JSON.stringify(source).slice(0, 1000);
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trainingDate)) errors.push('训练日期格式应为YYYY-MM-DD');
  if (!athleteName && !requestedAthleteId) errors.push('缺少运动员姓名');
  else if (!matched)
    errors.push(matches.length > 1 ? '同名运动员需要选择队伍' : '未匹配到权限范围内的运动员');
  if (!exerciseName) errors.push('缺少动作名称');
  if (actualReps === null || actualReps < 0 || actualReps > 1000)
    errors.push('实际次数应在0至1000之间');
  if (actualWeightKg === null || actualWeightKg < 0 || actualWeightKg > 1000)
    errors.push('实际重量应在0至1000kg之间');
  if (targetReps !== null && (targetReps < 0 || targetReps > 1000))
    errors.push('计划次数应在0至1000之间');
  if (plannedWeightKg !== null && (plannedWeightKg < 0 || plannedWeightKg > 1000))
    errors.push('计划重量应在0至1000kg之间');
  if (durationMin < 0 || durationMin > 1440) errors.push('训练时间应在0至1440分钟之间');
  if (distanceKm < 0 || distanceKm > 1000) errors.push('训练距离应在0至1000km之间');
  if (intensityPercent !== null && (intensityPercent < 0 || intensityPercent > 100))
    errors.push('训练强度应在0至100%之间');
  if (rpe !== null && (rpe < 0 || rpe > 10)) errors.push('RPE应在0至10之间');
  if (categoryValue && !isStrengthTrainingCategory(categoryValue))
    warnings.push(`训练类型“${categoryValue}”无法识别，已按动作归入${trainingCategory}`);
  if (bodyPositionValue && !isStrengthBodyPosition(bodyPositionValue))
    warnings.push(`身体位置“${bodyPositionValue}”无法识别，已自动归类`);
  if (environmentValue && !isStrengthTrainingEnvironment(environmentValue))
    warnings.push(`训练环境“${environmentValue}”无法识别，已按陆上训练处理`);
  if (intensityZoneValue && !isStrengthIntensityZone(intensityZoneValue))
    warnings.push(`强度区间“${intensityZoneValue}”无法识别，已按AN处理`);
  if (confidence !== null && confidence < 0.7) warnings.push('AI识别置信度较低，请人工核对');
  const duplicate = Boolean(
    matched &&
    /^\d{4}-\d{2}-\d{2}$/.test(trainingDate) &&
    exerciseName &&
    db
      .prepare(
        `
    SELECT srs.id
    FROM strength_result_sets srs
    JOIN training_sessions ts ON ts.id = srs.training_session_id
    WHERE ts.athlete_id = ? AND ts.session_date = ? AND ts.content = ?
      AND srs.exercise_name = ? AND srs.set_index = ?
    LIMIT 1
  `
      )
      .get(matched.id, trainingDate, sessionLabel, exerciseName, setIndex)
  );
  if (duplicate) warnings.push('系统中存在相同场次、动作和组次');
  return {
    rowNumber,
    athleteId: matched?.id || null,
    athleteName,
    matchedAthleteName: matched?.name || '',
    team: matched?.team || team,
    trainingDate,
    sessionLabel,
    trainingCategory,
    bodyPosition,
    trainingEnvironment,
    exerciseName,
    setIndex,
    targetReps,
    actualReps,
    actualWeightKg,
    plannedWeightKg,
    durationMin,
    distanceKm,
    intensityPercent,
    intensityZone,
    rpe,
    completed,
    note,
    confidence,
    originalText,
    duplicate,
    errors,
    warnings,
  };
}

export function parseStrengthCsv(buffer: Buffer) {
  const lines = buffer
    .toString('utf8')
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .filter((line) => line.trim());
  const parseLine = (line: string) => {
    const values: string[] = [];
    let value = '';
    let quoted = false;
    for (let index = 0; index < line.length; index += 1) {
      const character = line[index];
      if (character === '"' && quoted && line[index + 1] === '"') {
        value += '"';
        index += 1;
      } else if (character === '"') quoted = !quoted;
      else if (character === ',' && !quoted) {
        values.push(value);
        value = '';
      } else value += character;
    }
    values.push(value);
    return values;
  };
  const headers = parseLine(lines.shift() || '').map(normalizedStrengthHeader);
  return lines.map((line) =>
    Object.fromEntries(
      parseLine(line).map((value, index) => [headers[index] || `column${index}`, value])
    )
  );
}

export async function parseStrengthImportFile(
  file: Express.Multer.File,
  athletes: ReturnType<typeof strengthImportCandidates>
) {
  const filename = file.originalname.toLowerCase();
  if (filename.endsWith('.xlsx') || file.mimetype.includes('spreadsheet')) {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(file.buffer as unknown as ArrayBuffer);
    const records: Record<string, unknown>[] = [];
    workbook.eachSheet((sheet) => {
      let headers: string[] = [];
      let headerNumber = 0;
      for (let rowNumber = 1; rowNumber <= Math.min(sheet.rowCount, 12); rowNumber += 1) {
        const values = sheet.getRow(rowNumber).values as ExcelJS.CellValue[];
        const candidate = values
          .slice(1)
          .map((value) => normalizedStrengthHeader(strengthCellText(value)));
        if (
          candidate.some((value) => ['运动员', '运动员姓名', '姓名'].includes(value)) &&
          candidate.some((value) => ['动作', '动作名称', '训练项目', '项目'].includes(value))
        ) {
          headers = candidate;
          headerNumber = rowNumber;
          break;
        }
      }
      if (!headerNumber) return;
      for (let rowNumber = headerNumber + 1; rowNumber <= sheet.rowCount; rowNumber += 1) {
        const row = sheet.getRow(rowNumber);
        const record = Object.fromEntries(
          headers.map((header, index) => [
            header || `column${index}`,
            strengthCellText(row.getCell(index + 1).value),
          ])
        );
        if (Object.values(record).some((value) => cleanString(value)))
          records.push({ ...record, originalText: `${sheet.name}!${rowNumber}` });
      }
    });
    if (!records.length) throw new Error('未找到包含“运动员”和“动作”表头的训练结果工作表。');
    return { records, sourceType: 'excel' as const, modelUsed: '结构化Excel解析' };
  }
  if (filename.endsWith('.csv') || file.mimetype.includes('csv')) {
    return {
      records: parseStrengthCsv(file.buffer),
      sourceType: 'csv' as const,
      modelUsed: '结构化CSV解析',
    };
  }
  if (file.mimetype.startsWith('image/') || file.mimetype === 'application/pdf') {
    const recognized = await recognizeStrengthImport({
      buffer: file.buffer,
      filename: file.originalname,
      mimetype: file.mimetype,
      athletes,
    });
    return {
      records: recognized.rows as Array<RecognizedStrengthRow & Record<string, unknown>>,
      sourceType: file.mimetype === 'application/pdf' ? ('pdf' as const) : ('image' as const),
      modelUsed: recognized.modelUsed,
    };
  }
  throw new Error('仅支持XLSX、CSV、JPG、PNG、WEBP或PDF文件。');
}

export function registerStrengthTrainingRoutes(app: Express) {
  app.get('/api/strength-training/results', requireAuth, (req, res) => {
    const athleteId = Number(req.query.athleteId || 0);
    if (!athleteId || !hasAthleteAccess(req.authUser!, athleteId))
      return res.status(403).json({ message: '无权查看该运动员的体能训练结果。' });
    const rows = db
      .prepare(
        `
      SELECT ts.id AS sessionId, ts.session_date AS trainingDate, ts.session_order AS sessionOrder,
        ts.content AS sessionLabel, ts.rpe AS sessionRpe, ts.smvl AS volume, ts.source,
        ts.duration_min AS sessionDurationMin, ts.distance_km AS sessionDistanceKm,
        ts.training_type AS trainingType, ts.structure_type AS structureType,
        ts.intensity_zone AS sessionIntensityZone, ts.srpe,
        srs.id, srs.exercise_name AS exerciseName, srs.set_index AS setIndex,
        srs.target_reps AS targetReps, srs.actual_reps AS actualReps,
        srs.actual_weight_kg AS actualWeightKg, srs.planned_weight_kg AS plannedWeightKg,
        srs.training_category AS trainingCategory, srs.body_position AS bodyPosition,
        srs.training_environment AS trainingEnvironment, srs.duration_min AS durationMin,
        srs.distance_km AS distanceKm, srs.intensity_percent AS intensityPercent,
        srs.intensity_zone AS setIntensityZone, srs.rpe, srs.completed,
        srs.note, srs.data_import_batch_id AS importBatchId, srs.ai_confidence AS confidence,
        dib.source_filename AS sourceFilename, dib.parser_version AS modelUsed,
        COALESCE(dib.committed_at, srs.updated_at) AS importedAt
      FROM training_sessions ts
      JOIN strength_result_sets srs ON srs.training_session_id = ts.id
      LEFT JOIN data_import_batches dib ON dib.id = srs.data_import_batch_id
      WHERE ts.athlete_id = ?
      ORDER BY ts.session_date DESC, ts.session_order DESC, srs.exercise_name, srs.set_index
    `
      )
      .all(athleteId) as Array<Record<string, unknown> & { sessionId: number }>;
    const grouped = new Map<
      number,
      {
        id: number;
        trainingDate: string;
        sessionOrder: number;
        sessionLabel: string;
        rpe: number | null;
        volume: number;
        durationMin: number;
        distanceKm: number;
        trainingType: string;
        structureType: string;
        intensityZone: StrengthIntensityZone;
        srpe: number;
        source: string;
        sourceFilename: string;
        modelUsed: string;
        importedAt: string;
        sets: Array<Record<string, unknown>>;
      }
    >();
    for (const row of rows) {
      const sessionId = Number(row.sessionId);
      if (!grouped.has(sessionId))
        grouped.set(sessionId, {
          id: sessionId,
          trainingDate: cleanString(row.trainingDate),
          sessionOrder: Number(row.sessionOrder),
          sessionLabel: cleanString(row.sessionLabel),
          rpe: row.sessionRpe === null ? null : Number(row.sessionRpe),
          volume: Number(row.volume || 0),
          durationMin: Number(row.sessionDurationMin || 0),
          distanceKm: Number(row.sessionDistanceKm || 0),
          trainingType: cleanString(row.trainingType),
          structureType: cleanString(row.structureType),
          intensityZone: isStrengthIntensityZone(row.sessionIntensityZone)
            ? row.sessionIntensityZone
            : 'AN',
          srpe: Number(row.srpe || 0),
          source: cleanString(row.source),
          sourceFilename: cleanString(row.sourceFilename),
          modelUsed: cleanString(row.modelUsed),
          importedAt: cleanString(row.importedAt),
          sets: [],
        });
      grouped.get(sessionId)!.sets.push({
        id: Number(row.id),
        exerciseName: cleanString(row.exerciseName),
        setIndex: Number(row.setIndex),
        targetReps: row.targetReps === null ? null : Number(row.targetReps),
        actualReps: Number(row.actualReps),
        actualWeightKg: Number(row.actualWeightKg),
        plannedWeightKg: row.plannedWeightKg === null ? null : Number(row.plannedWeightKg),
        trainingCategory: isStrengthTrainingCategory(row.trainingCategory)
          ? row.trainingCategory
          : inferStrengthCategory(cleanString(row.exerciseName)),
        bodyPosition: isStrengthBodyPosition(row.bodyPosition)
          ? row.bodyPosition
          : inferStrengthBodyPosition(cleanString(row.exerciseName)),
        trainingEnvironment: isStrengthTrainingEnvironment(row.trainingEnvironment)
          ? row.trainingEnvironment
          : '陆上',
        durationMin: Number(row.durationMin || 0),
        distanceKm: Number(row.distanceKm || 0),
        intensityPercent: row.intensityPercent === null ? null : Number(row.intensityPercent),
        intensityZone: isStrengthIntensityZone(row.setIntensityZone) ? row.setIntensityZone : 'AN',
        rpe: row.rpe === null ? null : Number(row.rpe),
        completed: Boolean(row.completed),
        note: cleanString(row.note),
        importBatchId: cleanString(row.importBatchId),
        confidence: row.confidence === null ? null : Number(row.confidence),
      });
    }
    res.json({ sessions: [...grouped.values()] });
  });

  app.get(
    '/api/strength-training/import/template',
    requireAuth,
    requireRole('SCC', 'PRJ', 'REG', 'TD', 'DMD'),
    async (_req, res) => {
      const templatePath = resolve(
        process.cwd(),
        'public',
        'templates',
        '竞迹体能训练数据导入模板.xlsx'
      );
      if (!existsSync(templatePath))
        return res.status(404).json({ message: '体能训练导入模板尚未部署。' });
      res.download(templatePath, '竞迹体能训练数据导入模板.xlsx');
    }
  );

  app.post(
    '/api/strength-training/import/preview',
    requireAuth,
    requireRole('SCC', 'PRJ', 'REG', 'TD', 'DMD'),
    upload.single('file'),
    async (req, res, next) => {
      try {
        if (!req.file) return res.status(400).json({ message: '请选择训练结果文件。' });
        const athletes = strengthImportCandidates(req.authUser!);
        if (!athletes.length)
          return res.status(403).json({ message: '当前账号没有可导入的运动员。' });
        const parsed = await parseStrengthImportFile(req.file, athletes);
        const rows = parsed.records
          .slice(0, 1000)
          .map((record, index) => validateStrengthImportRow(record, index + 1, athletes));
        const token = randomUUID();
        strengthImportCache.set(token, {
          ownerId: req.authUser!.id,
          filename: req.file.originalname,
          mimetype: req.file.mimetype,
          sourceType: parsed.sourceType,
          rows,
          modelUsed: parsed.modelUsed,
          expiresAt: Date.now() + 30 * 60 * 1000,
        });
        res.json({
          token,
          filename: req.file.originalname,
          modelUsed: parsed.modelUsed,
          total: rows.length,
          valid: rows.filter((row) => !row.errors.length).length,
          invalid: rows.filter((row) => row.errors.length).length,
          duplicate: rows.filter((row) => row.duplicate).length,
          rows,
        });
      } catch (error) {
        next(error);
      }
    }
  );

  app.post(
    '/api/strength-training/import/commit',
    requireAuth,
    requireRole('SCC', 'PRJ', 'REG', 'TD', 'DMD'),
    (req, res) => {
      const token = cleanString(req.body?.token);
      const cached = strengthImportCache.get(token);
      if (!cached || cached.ownerId !== req.authUser!.id || cached.expiresAt < Date.now()) {
        strengthImportCache.delete(token);
        return res.status(410).json({ message: '导入预览已过期，请重新上传文件。' });
      }
      const policy = ['skip', 'update', 'new'].includes(cleanString(req.body?.conflictPolicy))
        ? (cleanString(req.body.conflictPolicy) as 'skip' | 'update' | 'new')
        : 'skip';
      const athletes = strengthImportCandidates(req.authUser!);
      const sourceRows = Array.isArray(req.body?.rows) ? req.body.rows : cached.rows;
      const rows: StrengthImportRow[] = sourceRows.map(
        (row: Record<string, unknown>, index: number) =>
          validateStrengthImportRow(row, Number(row.rowNumber || index + 1), athletes)
      );
      const invalid = rows.filter((row) => row.errors.length);
      if (invalid.length)
        return res
          .status(400)
          .json({ message: `仍有${invalid.length}行未通过校验，请先修正红色字段。`, rows });

      let imported = 0;
      let updated = 0;
      let skipped = 0;
      const batchId = token;
      const batchProject = db
        .prepare('SELECT project FROM athletes WHERE id = ?')
        .get(rows[0]?.athleteId) as { project: Project } | undefined;
      if (!batchProject) return res.status(400).json({ message: '导入记录缺少有效运动员。' });
      const sessionIds = new Set<number>();
      const sessionMap = new Map<string, number>();
      const source =
        cached.sourceType === 'image' || cached.sourceType === 'pdf' ? 'ai_import' : 'file_import';
      db.exec('BEGIN');
      try {
        db.prepare(
          `
        INSERT INTO data_import_batches
          (id, file_hash, source_filename, source_mimetype, file_size, project, parser_version, status, item_count, created_by, summary_json)
        VALUES (?, ?, ?, ?, 0, ?, ?, 'reviewing', ?, ?, ?)
      `
        ).run(
          batchId,
          `legacy-strength-import:${batchId}`,
          cached.filename,
          cached.mimetype,
          batchProject.project,
          `strength-result-${cached.modelUsed}`,
          rows.length,
          req.authUser!.id,
          JSON.stringify({ sourceType: cached.sourceType, channel: 'strength_training_import' })
        );
        const createImportItem = db.prepare(`
        INSERT INTO data_import_items
          (batch_id, item_type, athlete_id, raw_athlete_name, event_date, session_label, exercise_name, set_index,
           target_reps, actual_reps, actual_weight_kg, intensity_percent, payload_json, source_sheet, source_address,
           raw_value, quality, messages_json, business_key)
        VALUES (?, 'training_set', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '体能训练导入', ?, ?, 'valid', '[]', ?)
      `);
        const completeImportItem = db.prepare(
          `UPDATE data_import_items SET quality = ?, messages_json = ?, committed_entity_type = ?, committed_entity_id = ? WHERE id = ?`
        );

        for (const row of rows) {
          const importItem = createImportItem.run(
            batchId,
            row.athleteId,
            row.athleteName,
            row.trainingDate,
            row.sessionLabel,
            row.exerciseName,
            row.setIndex,
            row.targetReps,
            row.actualReps,
            row.actualWeightKg,
            row.intensityPercent,
            JSON.stringify({
              trainingCategory: row.trainingCategory,
              bodyPosition: row.bodyPosition,
              trainingEnvironment: row.trainingEnvironment,
              durationMin: row.durationMin,
              distanceKm: row.distanceKm,
              intensityZone: row.intensityZone,
              rpe: row.rpe,
              note: row.note,
              confidence: row.confidence,
              originalText: row.originalText,
            }),
            String(row.rowNumber),
            row.originalText,
            `${row.athleteId}|${row.trainingDate}|${row.sessionLabel}|${row.exerciseName}|${row.setIndex}`
          );
          const importItemId = Number(importItem.lastInsertRowid);
          const baseKey = `${row.athleteId}|${row.trainingDate}|${row.sessionLabel}`;
          let sessionId = sessionMap.get(baseKey);
          if (!sessionId) {
            const existing =
              policy === 'new'
                ? undefined
                : (db
                    .prepare(
                      `
            SELECT id FROM training_sessions
            WHERE athlete_id = ? AND session_date = ? AND training_type = '力量训练' AND content = ?
            ORDER BY session_order DESC LIMIT 1
          `
                    )
                    .get(row.athleteId, row.trainingDate, row.sessionLabel) as
                    { id: number } | undefined);
            if (existing) sessionId = existing.id;
            else {
              const orderRow = db
                .prepare(
                  'SELECT COALESCE(MAX(session_order), 0) AS maxOrder FROM training_sessions WHERE athlete_id = ? AND session_date = ?'
                )
                .get(row.athleteId, row.trainingDate) as { maxOrder: number };
              const inserted = db
                .prepare(
                  `
              INSERT INTO training_sessions
                (athlete_id, session_date, session_order, start_time, training_type, structure_type,
                 intensity_zone, content, duration_min, distance_km, duration_reported, distance_reported, rpe, srpe, smvl,
                 source, quality, is_demo, created_by)
              VALUES (?, ?, ?, '', '力量训练', '体能训练', 'AN', ?, 0, 0, 0, 0, NULL, 0, 0, ?, ?, 0, ?)
            `
                )
                .run(
                  row.athleteId,
                  row.trainingDate,
                  Number(orderRow.maxOrder) + 1,
                  row.sessionLabel,
                  source,
                  row.confidence !== null && row.confidence < 0.7 ? 'partial' : 'valid',
                  req.authUser!.id
                );
              sessionId = Number(inserted.lastInsertRowid);
            }
            sessionMap.set(baseKey, sessionId);
          }
          sessionIds.add(sessionId);
          const existingSet = db
            .prepare(
              'SELECT id FROM strength_result_sets WHERE training_session_id = ? AND exercise_name = ? AND set_index = ?'
            )
            .get(sessionId, row.exerciseName, row.setIndex) as { id: number } | undefined;
          if (existingSet && policy === 'skip') {
            completeImportItem.run(
              'skipped',
              JSON.stringify(['与现有力量训练组重复，按跳过策略处理。']),
              'strength_result_set',
              existingSet.id,
              importItemId
            );
            skipped += 1;
            continue;
          }
          if (existingSet) {
            db.prepare(
              `
            UPDATE strength_result_sets SET target_reps = ?, actual_reps = ?, actual_weight_kg = ?, planned_weight_kg = ?,
              training_category = ?, body_position = ?, training_environment = ?, duration_min = ?, distance_km = ?,
              intensity_percent = ?, intensity_zone = ?, rpe = ?, completed = ?,
              note = ?, source = ?, data_import_batch_id = ?, source_row = ?, original_text = ?, ai_confidence = ?,
              created_by = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
          `
            ).run(
              row.targetReps,
              row.actualReps,
              row.actualWeightKg,
              row.plannedWeightKg,
              row.trainingCategory,
              row.bodyPosition,
              row.trainingEnvironment,
              row.durationMin,
              row.distanceKm,
              row.intensityPercent,
              row.intensityZone,
              row.rpe,
              row.completed ? 1 : 0,
              row.note,
              source,
              batchId,
              String(row.rowNumber),
              row.originalText,
              row.confidence,
              req.authUser!.id,
              existingSet.id
            );
            completeImportItem.run(
              'valid',
              '[]',
              'strength_result_set',
              existingSet.id,
              importItemId
            );
            updated += 1;
          } else {
            const insertedSet = db
              .prepare(
                `
            INSERT INTO strength_result_sets
              (training_session_id, exercise_name, set_index, target_reps, actual_reps, actual_weight_kg, planned_weight_kg,
               training_category, body_position, training_environment, duration_min, distance_km, intensity_percent,
               intensity_zone, rpe, completed, note, source, data_import_batch_id, source_row, original_text, ai_confidence, created_by)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `
              )
              .run(
                sessionId,
                row.exerciseName,
                row.setIndex,
                row.targetReps,
                row.actualReps,
                row.actualWeightKg,
                row.plannedWeightKg,
                row.trainingCategory,
                row.bodyPosition,
                row.trainingEnvironment,
                row.durationMin,
                row.distanceKm,
                row.intensityPercent,
                row.intensityZone,
                row.rpe,
                row.completed ? 1 : 0,
                row.note,
                source,
                batchId,
                String(row.rowNumber),
                row.originalText,
                row.confidence,
                req.authUser!.id
              );
            completeImportItem.run(
              'valid',
              '[]',
              'strength_result_set',
              Number(insertedSet.lastInsertRowid),
              importItemId
            );
            imported += 1;
          }
        }

        for (const sessionId of sessionIds) {
          const totals = db
            .prepare(
              `
          SELECT COALESCE(SUM(actual_reps * actual_weight_kg), 0) AS volume,
            AVG(CASE WHEN rpe IS NOT NULL THEN rpe END) AS averageRpe,
            COALESCE(SUM(duration_min), 0) AS durationMin,
            COALESCE(SUM(distance_km), 0) AS distanceKm,
            MAX(CASE WHEN duration_min > 0 THEN 1 ELSE 0 END) AS durationReported,
            MAX(CASE WHEN distance_km > 0 THEN 1 ELSE 0 END) AS distanceReported
          FROM strength_result_sets WHERE training_session_id = ?
        `
            )
            .get(sessionId) as {
            volume: number;
            averageRpe: number | null;
            durationMin: number;
            distanceKm: number;
            durationReported: number;
            distanceReported: number;
          };
          const dominant = db
            .prepare(
              `
          SELECT training_environment AS environment, intensity_zone AS zone
          FROM strength_result_sets WHERE training_session_id = ?
          GROUP BY training_environment, intensity_zone ORDER BY SUM(duration_min) DESC, COUNT(*) DESC LIMIT 1
        `
            )
            .get(sessionId) as { environment: string; zone: string } | undefined;
          const duration = Math.round(Number(totals.durationMin || 0) * 10) / 10;
          const averageRpe =
            totals.averageRpe === null ? null : Math.round(Number(totals.averageRpe) * 10) / 10;
          db.prepare(
            `UPDATE training_sessions SET rpe = ?, smvl = ?, duration_min = ?, distance_km = ?, duration_reported = ?, distance_reported = ?, srpe = ?,
          structure_type = ?, intensity_zone = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`
          ).run(
            averageRpe,
            Math.round(Number(totals.volume || 0) * 10) / 10,
            duration,
            Math.round(Number(totals.distanceKm || 0) * 10) / 10,
            Number(totals.durationReported),
            Number(totals.distanceReported),
            Math.round((averageRpe || 0) * duration * 10) / 10,
            dominant?.environment || '陆上',
            isStrengthIntensityZone(dominant?.zone) ? dominant.zone : 'AN',
            sessionId
          );
        }
        db.prepare(
          `
        UPDATE data_import_batches SET status = 'committed', imported_count = ?, skipped_count = ?, committed_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `
        ).run(imported + updated, skipped, batchId);
        db.prepare(
          'INSERT INTO audit_logs (user_id, action, entity_type, entity_id, detail) VALUES (?, ?, ?, ?, ?)'
        ).run(
          req.authUser!.id,
          'IMPORT_STRENGTH_RESULTS',
          'data_import_batch',
          null,
          JSON.stringify({ batchId, imported, updated, skipped, sourceType: cached.sourceType })
        );
        db.exec('COMMIT');
        strengthImportCache.delete(token);
        res.json({
          message: `已保存${imported + updated}条体能训练结果。`,
          imported,
          updated,
          skipped,
          sessions: sessionIds.size,
        });
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    }
  );
}
