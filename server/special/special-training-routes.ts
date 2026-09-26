import ExcelJS from 'exceljs';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Express } from 'express';
import { z } from 'zod';
import { db } from '../core/db.ts';
import { accessibleAthleteIds, hasAthleteAccess } from '../core/permissions.ts';
import {
  cleanString,
  isValidIsoDate,
  numberOrNull,
  numberOrZero,
  parseDate,
  pick,
} from '../core/utils.ts';
import { upload } from '../core/uploads.ts';
import { requireAuth, requireRole } from '../core/auth.ts';
import { buildSpecialTrainingPayload } from '../analysis/overview-service.ts';
import { excelCellText } from '../training-plan/training-plan-service.ts';
import { PROJECTS, projectLabel } from '../../shared/projects.ts';
import type { AuthUser, Project, SpecialTestImportRow } from '../core/shared-server.ts';

export const specialTestImportCache = new Map<
  string,
  { ownerId: number; rows: SpecialTestImportRow[]; expiresAt: number }
>();

export function parseRaceTime(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date) {
    return (
      ((value.getUTCHours() * 60 + value.getUTCMinutes()) * 60 + value.getUTCSeconds()) * 1000 +
      value.getUTCMilliseconds()
    );
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value <= 0) return null;
    return Math.round(value < 1 ? value * 86400000 : value * 1000);
  }
  const raw = cleanString(value).replace(/[’′]/g, ':').replace(/[”″]/g, '').replace(/，/g, '.');
  if (!raw) return null;
  const parts = raw.split(':').map((part) => Number(part));
  if (parts.some((part) => !Number.isFinite(part) || part < 0) || parts.length > 3) return null;
  let seconds = 0;
  if (parts.length === 3) seconds = parts[0] * 3600 + parts[1] * 60 + parts[2];
  else if (parts.length === 2) seconds = parts[0] * 60 + parts[1];
  else seconds = parts[0];
  return seconds > 0 ? Math.round(seconds * 1000) : null;
}

export function findSpecialTestSheet(workbook: ExcelJS.Workbook) {
  for (const sheet of workbook.worksheets) {
    for (let rowNumber = 1; rowNumber <= Math.min(sheet.rowCount, 15); rowNumber += 1) {
      const headings: string[] = [];
      sheet
        .getRow(rowNumber)
        .eachCell({ includeEmpty: true }, (cell) =>
          headings.push(excelCellText(cell).replace(/\s+/g, ''))
        );
      const hasCrew =
        headings.includes('运动员/组合') ||
        headings.includes('运动员姓名') ||
        headings.includes('组合名称');
      const hasDate = headings.includes('训练日期') || headings.includes('测试日期');
      const hasDistance = headings.includes('训练距离(m)') || headings.includes('测试距离(m)');
      if (hasDate && hasDistance && hasCrew) return { sheet, headerRowNumber: rowNumber };
    }
  }
  return null;
}

export async function parseSpecialTestWorkbook(
  buffer: Buffer,
  user: AuthUser,
  expectedProject: string
): Promise<SpecialTestImportRow[]> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
  const found = findSpecialTestSheet(workbook);
  if (!found) throw new Error('未找到专项训练表头，请使用最新模板中的“专项训练成绩”工作表');
  const { sheet, headerRowNumber } = found;
  const headers: string[] = [];
  sheet.getRow(headerRowNumber).eachCell({ includeEmpty: true }, (cell, columnNumber) => {
    headers[columnNumber] = excelCellText(cell).trim();
  });
  const athletes = db
    .prepare('SELECT id, name, project FROM athletes WHERE active = 1')
    .all() as Array<{ id: number; name: string; project: string }>;
  const athleteByName = new Map(
    athletes.map((athlete) => [athlete.name.replace(/\s+/g, ''), athlete])
  );
  const allowed = new Set(accessibleAthleteIds(user));
  const rows: SpecialTestImportRow[] = [];

  sheet.eachRow({ includeEmpty: false }, (excelRow, rowNumber) => {
    if (rowNumber <= headerRowNumber) return;
    const item: Record<string, unknown> = {};
    let hasValue = false;
    headers.forEach((header, columnNumber) => {
      if (!header || !columnNumber) return;
      const cell = excelRow.getCell(columnNumber);
      let value: unknown = cell.value;
      if (value && typeof value === 'object' && 'formula' in value)
        value = 'result' in value ? ((value as { result?: unknown }).result ?? '') : '';
      if (value !== null && value !== undefined && value !== '') hasValue = true;
      item[header] = value ?? '';
    });
    if (!hasValue) return;
    const errors: string[] = [];
    const warnings: string[] = [];
    const testDate = parseDate(pick(item, ['训练日期', '测试日期', '日期']));
    const project = cleanString(
      pick(item, ['项目', '运动项目'])
    ) as SpecialTestImportRow['project'];
    const distanceM = Math.round(
      numberOrZero(
        pick(item, [
          '训练距离(m)',
          '训练距离（m）',
          '训练距离',
          '测试距离(m)',
          '测试距离（m）',
          '测试距离',
          '距离(m)',
        ])
      )
    );
    const boatClass = cleanString(pick(item, ['艇型', '项目'])) || '未分组';
    const genderGroup = cleanString(pick(item, ['性别组别', '组别'])) || '未分组';
    const rawCrewName = cleanString(pick(item, ['运动员/组合', '组合名称', '运动员姓名', '姓名']));
    const rawMemberNames = cleanString(pick(item, ['运动员姓名', '成员姓名', '成员']));
    const memberNames = (rawMemberNames || rawCrewName)
      .split(/[、,，+＋/]/)
      .map((name) => name.trim())
      .filter(Boolean);
    const members = memberNames
      .map((name) => athleteByName.get(name.replace(/\s+/g, '')))
      .filter(Boolean) as Array<{ id: number; name: string; project: string }>;
    const attemptsMs = [
      '第1轮',
      '第一轮',
      '一',
      '第2轮',
      '第二轮',
      '二',
      '第3轮',
      '第三轮',
      '三',
    ].reduce<number[]>((times, alias, index) => {
      if (index % 3 !== 0) return times;
      const aliases =
        index === 0
          ? ['第1轮', '第一轮', '一']
          : index === 3
            ? ['第2轮', '第二轮', '二']
            : ['第3轮', '第三轮', '三'];
      const parsed = parseRaceTime(pick(item, aliases));
      if (parsed !== null) times.push(parsed);
      return times;
    }, []);
    const previousBestMs = parseRaceTime(pick(item, ['历史最好', '个人最好', '此前最好']));
    if (!testDate) errors.push('训练日期格式无效，应为YYYY-MM-DD');
    if (!PROJECTS.includes(project)) errors.push('项目必须填写“赛艇”“皮划艇”或“激流”');
    else if (project !== expectedProject)
      errors.push(`当前为${expectedProject}空间，不能导入${project}数据`);
    if (distanceM <= 0 || distanceM > 100000) errors.push('训练距离应为1—100000米');
    if (!rawCrewName) errors.push('缺少运动员/组合');
    if (!memberNames.length) errors.push('缺少运动员姓名');
    for (const name of memberNames) {
      const athlete = athleteByName.get(name.replace(/\s+/g, ''));
      if (!athlete) errors.push(`运动员“${name}”不在系统名单中`);
      else if (!allowed.has(athlete.id)) errors.push(`当前账户无权导入运动员“${name}”`);
      else if (athlete.project !== project)
        errors.push(`运动员“${name}”属于${athlete.project}，与本行项目不一致`);
    }
    if (!attemptsMs.length) errors.push('至少填写一轮有效成绩，如0:55.15');
    if (attemptsMs.length < 2) warnings.push('仅有一轮成绩，稳定性分析将不完整');
    const averageMs = attemptsMs.length
      ? Math.round(attemptsMs.reduce((sum, value) => sum + value, 0) / attemptsMs.length)
      : 0;
    const bestMs = attemptsMs.length ? Math.min(...attemptsMs) : 0;
    rows.push({
      rowNumber,
      testDate,
      project,
      distanceM,
      boatClass,
      genderGroup,
      crewName: rawCrewName,
      memberAthleteIds: members.map((member) => member.id),
      memberNames,
      session: cleanString(pick(item, ['上午/下午', '时段', '训练时段', '测试时段'])),
      windConditions: cleanString(pick(item, ['风向风速', '风况', '风向'])),
      location: cleanString(pick(item, ['训练地点', '测试地点', '地点'])),
      note: cleanString(pick(item, ['备注', '训练备注', '测试备注'])),
      previousBestMs,
      attemptsMs,
      averageMs,
      bestMs,
      errors: [...new Set(errors)],
      warnings: [...new Set(warnings)],
    });
  });
  return rows;
}

export function readSpecialTestEvents(user: AuthUser, project: string, from: string, to: string) {
  const allowed = new Set(accessibleAthleteIds(user));
  const events = db
    .prepare(
      `
    SELECT id, project, test_date AS testDate, distance_m AS distanceM, boat_class AS boatClass,
      gender_group AS genderGroup, session, wind_conditions AS windConditions, location, note
    FROM special_test_events WHERE project IN (?, ?) AND test_date BETWEEN ? AND ? ORDER BY test_date DESC, distance_m ASC
  `
    )
    .all(project, projectLabel(project), from, to) as Array<{
    id: number;
    project: Project;
    testDate: string;
    distanceM: number;
    boatClass: string;
    genderGroup: string;
    session: string;
    windConditions: string;
    location: string;
    note: string;
  }>;

  const selectResults = db.prepare(`
    SELECT id, crew_name AS crewName, member_athlete_ids AS memberAthleteIds,
      member_names AS memberNames, previous_best_ms AS previousBestMs,
      attempts_ms AS attemptsMs, average_ms AS averageMs, best_ms AS bestMs
    FROM special_test_results WHERE event_id = ? ORDER BY best_ms ASC, average_ms ASC
  `);
  const output = events
    .map((event) => {
      const all = (
        selectResults.all(event.id) as Array<{
          id: number;
          crewName: string;
          memberAthleteIds: string;
          memberNames: string;
          previousBestMs: number | null;
          attemptsMs: string;
          averageMs: number;
          bestMs: number;
        }>
      ).map((row, index) => ({
        ...row,
        rank: index + 1,
        memberAthleteIds: JSON.parse(row.memberAthleteIds || '[]') as number[],
        memberNames: JSON.parse(row.memberNames || '[]') as string[],
        attemptsMs: JSON.parse(row.attemptsMs || '[]') as number[],
      }));
      const visible = all
        .filter((row) => row.memberAthleteIds.length > 0)
        .filter((row) =>
          user.role === 'ATL'
            ? row.memberAthleteIds.some((id) => allowed.has(id))
            : row.memberAthleteIds.every((id) => allowed.has(id))
        );
      const leaderMs = all[0]?.bestMs || 0;
      return {
        ...event,
        project,
        dataSource: 'legacy_special_test',
        dataQuality: 'unverified' as const,
        results: visible.map((row) => ({
          ...row,
          crewName: user.role === 'ATL' ? user.displayName : row.crewName,
          memberNames: user.role === 'ATL' ? [user.displayName] : row.memberNames,
          memberAthleteIds:
            user.role === 'ATL' && user.athleteId ? [user.athleteId] : row.memberAthleteIds,
          deltaPreviousMs: row.previousBestMs === null ? null : row.bestMs - row.previousBestMs,
          gapLeaderMs: leaderMs ? row.bestMs - leaderMs : 0,
        })),
      };
    })
    .filter((event) => event.results.length > 0);
  return output;
}

export function registerSpecialTrainingRoutes(app: Express) {
  app.post(
    '/api/special-training/sessions',
    requireAuth,
    requireRole('SCC', 'PRJ', 'REG', 'TD', 'DMD'),
    (req, res) => {
      const user = req.authUser!;
      const rows = Array.isArray(req.body?.sessions) ? req.body.sessions.slice(0, 1000) : [];
      if (!rows.length) return res.status(400).json({ message: '请提供需要保存的训练数据。' });
      const insert = db.prepare(`
      INSERT INTO training_sessions
        (athlete_id, session_date, session_order, start_time, training_type, structure_type,
         intensity_zone, content, duration_min, distance_km, rpe, srpe, smvl,
         average_heart_rate, max_heart_rate, average_power_w, stroke_rate_spm,
         source, quality, is_demo, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, 'valid', 0, ?)
    `);
      const nextOrder = db.prepare(
        'SELECT COALESCE(MAX(session_order), 0) + 1 AS value FROM training_sessions WHERE athlete_id = ? AND session_date = ?'
      );
      let imported = 0;
      try {
        db.exec('BEGIN');
        for (const row of rows) {
          const athleteId = Number(row?.athleteId || 0);
          const athlete = db
            .prepare('SELECT id, project FROM athletes WHERE id = ? AND active = 1')
            .get(athleteId) as { id: number; project: string } | undefined;
          if (!athlete || !hasAthleteAccess(user, athleteId))
            throw new Error('存在无权录入或不存在的运动员。');
          const date = cleanString(row?.date);
          if (!isValidIsoDate(date)) throw new Error('训练日期无效，请使用正确的年月日。');
          if (cleanString(row?.project) && cleanString(row.project) !== athlete.project)
            throw new Error('训练项目与运动员档案不一致。');
          const duration = numberOrNull(row?.duration);
          const distance = numberOrNull(row?.distance);
          const rpe = numberOrNull(row?.rpe);
          const heartRate = numberOrNull(row?.heartRate);
          const maxHeartRate = numberOrNull(row?.maxHeartRate);
          const power = numberOrNull(row?.power);
          const strokeRate = numberOrNull(row?.strokeRate);
          if (duration === null || duration <= 0 || duration > 1440)
            throw new Error('训练时长须在 1—1440 分钟之间。');
          if (distance === null || distance < 0 || distance > 500)
            throw new Error('训练距离须在 0—500 公里之间。');
          if (rpe === null || rpe < 1 || rpe > 10) throw new Error('RPE 须在 1—10 之间。');
          if (heartRate === null || heartRate < 30 || heartRate > 240)
            throw new Error('平均心率须在 30—240 bpm 之间。');
          if (
            maxHeartRate === null ||
            maxHeartRate < 30 ||
            maxHeartRate > 240 ||
            maxHeartRate < heartRate
          )
            throw new Error('最大心率须在 30—240 bpm 之间，且不能低于平均心率。');
          if (power === null || power < 0 || power > 3000)
            throw new Error('平均功率须在 0—3000 W 之间。');
          if (strokeRate === null || strokeRate < 1 || strokeRate > 250)
            throw new Error('桨频或划频须在 1—250 次/分之间。');
          const order = (nextOrder.get(athleteId, date) as { value: number }).value;
          const trainingType = cleanString(row?.type) || '专项训练';
          const content = cleanString(row?.content);
          if (!content || content.length > 100)
            throw new Error('训练内容须填写且不能超过 100 个字符。');
          const defaultStructure =
            trainingType === '专项力量'
              ? '最大力量'
              : trainingType === '恢复训练'
                ? '再生恢复'
                : '专项训练';
          insert.run(
            athleteId,
            date,
            order,
            cleanString(row?.startTime),
            trainingType,
            cleanString(row?.structureType) || defaultStructure,
            cleanString(row?.intensityZone) || 'U2',
            content,
            duration,
            distance,
            rpe,
            Math.round(duration * rpe),
            heartRate,
            maxHeartRate,
            power,
            strokeRate,
            cleanString(row?.source) === 'import' ? 'table_import' : 'manual',
            user.id
          );
          imported += 1;
        }
        db.exec('COMMIT');
        res.status(201).json({ message: `已保存 ${imported} 条专项训练数据。`, imported });
      } catch (error) {
        try {
          db.exec('ROLLBACK');
        } catch {}
        res
          .status(400)
          .json({ message: error instanceof Error ? error.message : '专项训练数据保存失败。' });
      }
    }
  );

  app.get('/api/special-training/overview', requireAuth, (req, res) => {
    const user = req.authUser!;
    const query = z
      .object({
        project: z.string().trim().min(1).max(16),
        from: z.string().trim().min(1).max(10),
        to: z.string().trim().min(1).max(10),
        teamId: z.coerce.number().int().nonnegative().optional(),
        athleteId: z.coerce.number().int().positive().optional(),
      })
      .strict()
      .safeParse(req.query);
    if (!query.success) return res.status(400).json({ message: '专项训练筛选参数无效。' });
    const { project, athleteId = null } = query.data;
    const from = parseDate(query.data.from);
    const to = parseDate(query.data.to);
    const teamId = query.data.teamId || 0;
    if (!PROJECTS.includes(project) || !from || !to || from > to)
      return res.status(400).json({ message: '请选择有效项目和日期范围。' });
    const accessible = accessibleAthleteIds(user);
    let scoped = accessible.length
      ? (db
          .prepare(
            `SELECT a.id, a.team_id AS teamId FROM athletes a WHERE a.id IN (${accessible.map(() => '?').join(',')}) AND a.project = ? AND a.active = 1`
          )
          .all(...accessible, project) as Array<{ id: number; teamId: number | null }>)
      : [];
    if (teamId) {
      if (!scoped.some((row) => row.teamId === teamId))
        return res.status(403).json({ message: '无权查看该队伍或该队伍不属于当前项目。' });
      scoped = scoped.filter((row) => row.teamId === teamId);
    }
    if (athleteId !== null && !scoped.some((row) => row.id === athleteId)) {
      const athlete = db
        .prepare('SELECT project FROM athletes WHERE id = ? AND active = 1')
        .get(athleteId) as { project: string } | undefined;
      if (athlete && athlete.project !== project)
        return res.status(400).json({ message: '所选运动员不属于当前项目。' });
      return res.status(403).json({ message: '无权查看该运动员专项训练。' });
    }
    const rosterAthleteIds = scoped.map((row) => row.id);
    const selectedScope = athleteId === null ? null : scoped.find((row) => row.id === athleteId);
    const teamAthleteIds =
      selectedScope && !teamId
        ? scoped.filter((row) => row.teamId === selectedScope.teamId).map((row) => row.id)
        : rosterAthleteIds;
    res.json(
      buildSpecialTrainingPayload({
        athleteIds: athleteId === null ? teamAthleteIds : [athleteId],
        teamAthleteIds,
        rosterAthleteIds,
        athleteId,
        project,
        from,
        to,
        individual: user.role === 'ATL',
      })
    );
  });

  app.get('/api/special-tests', requireAuth, (req, res) => {
    const user = req.authUser!;
    const project = cleanString(req.query.project);
    if (!PROJECTS.includes(project))
      return res.status(400).json({ message: '请选择赛艇、皮划艇或激流项目。' });
    const from = parseDate(req.query.from) || '1900-01-01';
    const to = parseDate(req.query.to) || '2999-12-31';
    const athleteId = req.query.athleteId === undefined ? null : Number(req.query.athleteId);
    if (
      athleteId !== null &&
      (!Number.isInteger(athleteId) || athleteId <= 0 || !hasAthleteAccess(user, athleteId))
    )
      return res.status(403).json({ message: '无权查看该运动员专项测试。' });
    const athlete =
      athleteId === null
        ? null
        : (db.prepare('SELECT project FROM athletes WHERE id = ? AND active = 1').get(athleteId) as
            { project: string } | undefined);
    if (athleteId !== null && (!athlete || athlete.project !== project))
      return res.status(400).json({ message: '所选运动员不属于当前项目。' });
    const events = readSpecialTestEvents(user, project, from, to);
    res.json({
      events:
        athleteId === null
          ? events
          : events
              .map((event) => ({
                ...event,
                results: event.results.filter((result) =>
                  result.memberAthleteIds.includes(athleteId)
                ),
              }))
              .filter((event) => event.results.length),
    });
  });

  app.post(
    '/api/special-tests/import/preview',
    requireAuth,
    requireRole('SCC', 'PRJ', 'REG', 'TD', 'DMD'),
    upload.single('file'),
    async (req, res) => {
      if (!req.file) return res.status(400).json({ message: '请选择Excel文件。' });
      if (!req.file.originalname.toLowerCase().endsWith('.xlsx'))
        return res.status(400).json({ message: '当前版本仅支持.xlsx文件。' });
      const project = cleanString(req.body?.project);
      if (!PROJECTS.includes(project))
        return res.status(400).json({ message: '请选择赛艇、皮划艇或激流项目。' });
      try {
        const rows = await parseSpecialTestWorkbook(req.file.buffer, req.authUser!, project);
        if (!rows.length)
          return res.status(400).json({ message: 'Excel中没有可读取的专项训练成绩。' });
        const importId = randomUUID();
        specialTestImportCache.set(importId, {
          ownerId: req.authUser!.id,
          rows,
          expiresAt: Date.now() + 30 * 60 * 1000,
        });
        res.json({
          importId,
          fileName: req.file.originalname,
          total: rows.length,
          valid: rows.filter((row) => row.errors.length === 0).length,
          invalid: rows.filter((row) => row.errors.length > 0).length,
          warningCount: rows.reduce((sum, row) => sum + row.warnings.length, 0),
          rows: rows.map(({ memberAthleteIds: _ids, ...row }) => row),
        });
      } catch (error) {
        res.status(400).json({
          message: `无法读取专项训练Excel：${error instanceof Error ? error.message : '文件格式错误'}`,
        });
      }
    }
  );

  app.post(
    '/api/special-tests/import/commit',
    requireAuth,
    requireRole('SCC', 'PRJ', 'REG', 'TD', 'DMD'),
    (req, res) => {
      const importId = cleanString(req.body?.importId);
      const cached = specialTestImportCache.get(importId);
      if (!cached || cached.expiresAt < Date.now() || cached.ownerId !== req.authUser!.id) {
        return res.status(400).json({ message: '导入预览已失效，请重新上传Excel。' });
      }
      const rows = cached.rows.filter((row) => row.errors.length === 0);
      const grouped = new Map<string, SpecialTestImportRow[]>();
      for (const row of rows) {
        const key = [
          row.project,
          row.testDate,
          row.distanceM,
          row.boatClass,
          row.genderGroup,
          row.session,
        ].join('|');
        grouped.set(key, [...(grouped.get(key) || []), row]);
      }
      const upsertEvent = db.prepare(`
      INSERT INTO special_test_events
        (project, test_date, distance_m, boat_class, gender_group, session, wind_conditions, location, note, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(project, test_date, distance_m, boat_class, gender_group, session) DO UPDATE SET
        wind_conditions = excluded.wind_conditions, location = excluded.location, note = excluded.note
      RETURNING id
    `);
      const insertResult = db.prepare(`
      INSERT INTO special_test_results
        (event_id, crew_name, member_athlete_ids, member_names, previous_best_ms, attempts_ms, average_ms, best_ms)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
      db.exec('BEGIN');
      try {
        for (const eventRows of grouped.values()) {
          const first = eventRows[0];
          const saved = upsertEvent.get(
            projectLabel(first.project),
            first.testDate,
            first.distanceM,
            first.boatClass,
            first.genderGroup,
            first.session,
            first.windConditions,
            first.location,
            first.note,
            req.authUser!.id
          ) as { id: number };
          db.prepare('DELETE FROM special_test_results WHERE event_id = ?').run(saved.id);
          for (const row of eventRows) {
            insertResult.run(
              saved.id,
              row.crewName,
              JSON.stringify(row.memberAthleteIds),
              JSON.stringify(row.memberNames),
              row.previousBestMs,
              JSON.stringify(row.attemptsMs),
              row.averageMs,
              row.bestMs
            );
          }
        }
        db.prepare(
          "INSERT INTO audit_logs (user_id, action, entity_type, detail) VALUES (?, 'IMPORT_SPECIAL_TEST', 'special_test_event', ?)"
        ).run(req.authUser!.id, JSON.stringify({ events: grouped.size, results: rows.length }));
        db.exec('COMMIT');
        specialTestImportCache.delete(importId);
        res.json({
          imported: rows.length,
          events: grouped.size,
          skipped: cached.rows.length - rows.length,
        });
      } catch (error) {
        db.exec('ROLLBACK');
        res.status(500).json({
          message: `写入专项训练数据失败：${error instanceof Error ? error.message : '未知错误'}`,
        });
      }
    }
  );

  app.get(
    '/api/special-tests/import/template',
    requireAuth,
    requireRole('SCC', 'PRJ', 'REG', 'TD', 'DMD'),
    async (_req, res, next) => {
      const templateName = '竞迹专项训练导入模板.xlsx';
      const templatePath = resolve(process.cwd(), 'public', 'templates', templateName);
      if (!existsSync(templatePath))
        return res.status(500).json({ message: '标准模板尚未部署，请联系管理员。' });
      try {
        const template = readFileSync(templatePath);
        const downloadName = '竞迹专项训练导入模板.xlsx';
        res.setHeader(
          'Content-Disposition',
          `attachment; filename="special-training-import-template.xlsx"; filename*=UTF-8''${encodeURIComponent(downloadName)}`
        );
        res
          .type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
          .send(template);
      } catch (error) {
        next(error);
      }
    }
  );
}
