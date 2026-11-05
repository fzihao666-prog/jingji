import { createHash, randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import * as XLSX from '@e965/xlsx';
import {
  ENODE_METRICS,
  type EnodeKind,
  type EnodeMetric,
  type EnodeValues,
  type EnodeImportResult,
  type EnodeQuery,
  type EnodeData,
  type EnodeRecord,
} from '../../shared/enode.ts';
import { normalizeImportPersonName } from '../../shared/data-import-person.ts';

/** 仅新增来源事实表，不修改、复制或删除现有训练/恢复事实。 */
export function initializeEnodeDatabase(db: DatabaseSync) {
  db.exec(`CREATE TABLE IF NOT EXISTS enode_import_files (
    id TEXT PRIMARY KEY, project_code TEXT NOT NULL, filename TEXT NOT NULL,
    file_hash TEXT NOT NULL, kind TEXT NOT NULL, created_by INTEGER NOT NULL REFERENCES users(id),
    inserted_count INTEGER NOT NULL DEFAULT 0, skipped_count INTEGER NOT NULL DEFAULT 0,
    failed_count INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS enode_records (
    id INTEGER PRIMARY KEY, athlete_id INTEGER NOT NULL REFERENCES athletes(id),
    project_code TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('measurement','wellness','sessionRpe')),
    recorded_at TEXT NOT NULL, exercise_name TEXT NOT NULL DEFAULT '', side TEXT NOT NULL DEFAULT '',
    values_json TEXT NOT NULL, context_json TEXT NOT NULL, raw_json TEXT NOT NULL,
    fingerprint TEXT NOT NULL, occurrence INTEGER NOT NULL, file_id TEXT NOT NULL REFERENCES enode_import_files(id),
    source_row INTEGER NOT NULL,
    UNIQUE(athlete_id,project_code,kind,fingerprint,occurrence)
  );
  CREATE INDEX IF NOT EXISTS idx_enode_scope ON enode_records(athlete_id,project_code,kind,recorded_at);
  CREATE INDEX IF NOT EXISTS idx_enode_exercise ON enode_records(athlete_id,project_code,kind,exercise_name,side,recorded_at);`);
}
const hash = (text: string | Buffer) => createHash('sha256').update(text).digest('hex');
const metricColumns: Record<EnodeKind, Record<string, EnodeMetric>> = {
  measurement: {
    'Distance [m]': 'distance',
    'Mean velocity [m/s]': 'meanVelocity',
    'Peak velocity [m/s]': 'peakVelocity',
    'Mean power [W]': 'meanPower',
    'Peak power [W]': 'peakPower',
    'Jump height [m]': 'jumpHeight',
    'RSI [RSI]': 'rsi',
    'Propulsive distance [m]': 'propulsiveDistance',
  },
  wellness: {
    stress: 'stress',
    mood: 'mood',
    sleep: 'sleep',
    soreness: 'soreness',
    fatigue: 'fatigue',
    wellnessScore: 'wellnessScore',
  },
  sessionRpe: {
    sessionRpe: 'sessionRpe',
    trainingLoad: 'trainingLoad',
    durationMin: 'durationMin',
    sessionCount: 'sessionCount',
    volume: 'volume',
  },
};
function validDate(date: string) {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(date) &&
    Number.isFinite(Date.parse(date)) &&
    new Date(date).toISOString().slice(0, 10) === date
  );
}
export function parseEnodeFile(buffer: Buffer) {
  // 原始导出是 UTF-8 CSV（可能没有扩展名）；不允许二进制工作簿借用此入口。
  const text = new TextDecoder('utf-8', { fatal: true }).decode(buffer).replace(/^\uFEFF/, '');
  if (text.includes('\0')) throw Error('请上传 enode 原始 CSV 文件。');
  const book = XLSX.read(text, { type: 'string', raw: true });
  const table = XLSX.utils.sheet_to_json<string[]>(book.Sheets[book.SheetNames[0]], {
    header: 1,
    defval: '',
    blankrows: true,
  });
  const headers = (table[0] || []).map((v) => String(v).trim());
  if (new Set(headers).size !== headers.length) throw Error('文件表头重复，请重新导出。');
  const kind: EnodeKind = headers.includes('Exercise')
    ? 'measurement'
    : headers.includes('wellnessScore')
      ? 'wellness'
      : headers.includes('sessionRpe')
        ? 'sessionRpe'
        : (() => {
            throw Error('无法识别 enode 文件类型，请上传原始导出文件。');
          })();
  const dateKey = kind === 'measurement' ? 'Date [yyyy-MM-dd]' : '日期 [yyyy-MM-dd]';
  const timeKey = kind === 'measurement' ? 'Time' : '时间';
  const nameKey = kind === 'measurement' ? 'Athlete' : '运动员';
  const required = [dateKey, timeKey, nameKey, ...Object.keys(metricColumns[kind])];
  if (kind === 'measurement') required.push('Exercise', 'Side');
  if (required.some((key) => !headers.includes(key)))
    throw Error('文件缺少必要表头，请使用 enode 原始导出文件。');
  if (table.length > 100001) throw Error('单个文件超过十万行，请按较短日期范围导出。');
  const rows = table.slice(1).flatMap((cells, index) => {
    if (!cells.some((v) => String(v).trim())) return [];
    const raw = Object.fromEntries(headers.map((key, i) => [key, String(cells[i] ?? '').trim()]));
    const values: EnodeValues = {};
    let error = '';
    if (cells.length > headers.length) error = '字段数量超过表头，请检查 CSV 格式。';
    if (
      !validDate(raw[dateKey]) ||
      !/^([01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?$/.test(raw[timeKey])
    )
      error = '日期或时间无效。';
    if (!raw[nameKey] || raw[nameKey].length > 100) error = '运动员姓名为空或过长。';
    const exercise = kind === 'measurement' ? raw.Exercise.normalize('NFKC').trim() : '';
    if (kind === 'measurement' && (!exercise || exercise.length > 300))
      error = '动作名称为空或过长。';
    for (const [column, key] of Object.entries(metricColumns[kind])) {
      const value = raw[column];
      values[key] = value === '' ? null : Number(value);
      if (
        value !== '' &&
        (!/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(value) || !Number.isFinite(values[key]))
      )
        error = `${column} 必须为有效数值，未测量请留空。`;
    }
    if (values.sessionRpe != null && (values.sessionRpe < 0 || values.sessionRpe > 10))
      error = '课次 RPE 应为0—10。';
    if (values.durationMin != null && values.durationMin < 0) error = '训练时长不能为负数。';
    if (
      values.sessionCount != null &&
      (!Number.isInteger(values.sessionCount) || values.sessionCount < 0)
    )
      error = '课次数必须为整数。';
    // 设备可能导出无数值的动作事件；保留来源行，但不参与均值及有效测量数。
    if (kind !== 'measurement' && !Object.values(values).some((value) => value !== null))
      error = '本行没有测量值。';
    if (kind === 'measurement' && raw.Side.length > 100) error = '侧别字段过长。';
    const context =
      kind === 'sessionRpe'
        ? {
            workoutStart: raw.workoutStart || '',
            workoutEnd: raw.workoutEnd || '',
            exercises: raw.exercises || '',
          }
        : {};
    return [
      {
        sourceRow: index + 2,
        name: raw[nameKey],
        recordedAt: `${raw[dateKey]}T${raw[timeKey]}`,
        exercise,
        side: kind === 'measurement' ? raw.Side : '',
        values,
        context,
        raw,
        error,
      },
    ];
  });
  return { kind, rows };
}

export function importEnodeFile(
  db: DatabaseSync,
  options: {
    buffer: Buffer;
    filename: string;
    project: string;
    userId: number;
    candidates: { id: number; name: string }[];
    matches?: Record<string, number>;
  }
): EnodeImportResult {
  const { buffer, filename, project, userId, candidates, matches = {} } = options;
  const parsed = parseEnodeFile(buffer);
  const result: EnodeImportResult = {
    filename,
    kind: parsed.kind,
    inserted: 0,
    skipped: 0,
    failed: 0,
    issues: [],
    unresolvedNames: [],
  };
  const fileId = randomUUID();
  const people = new Map<string, number[]>();
  for (const person of candidates) {
    const key = normalizeImportPersonName(person.name);
    people.set(key, [...(people.get(key) || []), person.id]);
  }
  const occurrences = new Map<string, number>();
  const insert =
    db.prepare(`INSERT INTO enode_records(athlete_id,project_code,kind,recorded_at,exercise_name,side,values_json,context_json,raw_json,fingerprint,occurrence,file_id,source_row)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(athlete_id,project_code,kind,fingerprint,occurrence) DO NOTHING`);
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare(
      'INSERT INTO enode_import_files(id,project_code,filename,file_hash,kind,created_by) VALUES(?,?,?,?,?,?)'
    ).run(fileId, project, filename, hash(buffer), parsed.kind, userId);
    for (const row of parsed.rows) {
      const normalized = normalizeImportPersonName(row.name);
      const ids = people.get(normalized) || [];
      const mapped = matches[row.name];
      const athleteId =
        mapped !== undefined
          ? candidates.find((p) => p.id === mapped)?.id
          : ids.length === 1
            ? ids[0]
            : undefined;
      const fingerprint = hash(
        JSON.stringify([row.recordedAt, row.exercise, row.side, row.values, row.context])
      );
      const occurrenceKey = `${athleteId || normalized}:${fingerprint}`;
      const occurrence = (occurrences.get(occurrenceKey) || 0) + 1;
      occurrences.set(occurrenceKey, occurrence);
      const error =
        row.error || (!athleteId ? '无法唯一匹配运动员，请选择当前项目内的对应人员后重试。' : '');
      if (error) {
        result.failed++;
        if (result.issues.length < 100) result.issues.push({ row: row.sourceRow, message: error });
        if (!athleteId && !result.unresolvedNames.includes(row.name))
          result.unresolvedNames.push(row.name);
        continue;
      }
      const inserted = insert.run(
        athleteId!,
        project,
        parsed.kind,
        row.recordedAt,
        row.exercise,
        row.side,
        JSON.stringify(row.values),
        JSON.stringify(row.context),
        JSON.stringify(row.raw),
        fingerprint,
        occurrence,
        fileId,
        row.sourceRow
      ).changes;
      if (inserted) result.inserted++;
      else result.skipped++;
    }
    db.prepare(
      'UPDATE enode_import_files SET inserted_count=?,skipped_count=?,failed_count=? WHERE id=?'
    ).run(result.inserted, result.skipped, result.failed, fileId);
    db.prepare(
      "INSERT INTO audit_logs(user_id,action,entity_type,detail) VALUES(?,'IMPORT_ENODE','enode_import_files',?)"
    ).run(
      userId,
      JSON.stringify({
        fileId,
        kind: parsed.kind,
        inserted: result.inserted,
        skipped: result.skipped,
        failed: result.failed,
      })
    );
    db.exec('COMMIT');
  } catch (error) {
    if (db.isTransaction) db.exec('ROLLBACK');
    throw error;
  }
  return result;
}

/** 读数不写回既有训练负荷，不把设备分数强制换算为项目量表。 */
export function readEnodeData(db: DatabaseSync, query: EnodeQuery): EnodeData {
  const { athleteId, project, kind, from, to, exercise, side, page, metric } = query;
  if (!Object.hasOwn(ENODE_METRICS, metric) || ENODE_METRICS[metric].kind !== kind)
    throw Error('指标与文件类型不匹配。');
  const scope = 'athlete_id=? AND project_code=? AND kind=? AND recorded_at>=? AND recorded_at<?';
  const args = [athleteId, project, kind, `${from}T`, `${to}U`];
  const exercises = db
    .prepare(
      `SELECT exercise_name AS name,COUNT(*) AS count,MAX(recorded_at) AS latest FROM enode_records WHERE ${scope} AND exercise_name<>'' GROUP BY exercise_name ORDER BY latest DESC,exercise_name`
    )
    .all(...args) as EnodeData['exercises'];
  let where = scope;
  const selectedExercise = kind === 'measurement' ? exercise || exercises[0]?.name || '' : '';
  if (selectedExercise) {
    where += ' AND exercise_name=?';
    args.push(selectedExercise);
  }
  const sides = (
    db
      .prepare(`SELECT DISTINCT side FROM enode_records WHERE ${where} ORDER BY side`)
      .all(...args) as { side: string }[]
  ).map((r) => r.side);
  const selectedSide = side ?? (sides.includes('bilateral') ? 'bilateral' : sides[0] || '');
  if (kind === 'measurement') {
    where += ' AND side=?';
    args.push(selectedSide);
  }
  const { total } = db
    .prepare(`SELECT COUNT(*) AS total FROM enode_records WHERE ${where}`)
    .get(...args) as { total: number };
  const value = `json_extract(values_json, '$.${metric}')`;
  const daily = db
    .prepare(
      `SELECT substr(recorded_at,1,10) AS date,AVG(${value}) AS mean,MIN(${value}) AS min,MAX(${value}) AS max,COUNT(${value}) AS count FROM enode_records WHERE ${where} AND ${value} IS NOT NULL GROUP BY date ORDER BY date`
    )
    .all(...args) as EnodeData['daily'];
  const pointCount = daily.reduce((sum, day) => sum + day.count, 0);
  // 图上最多1000个等距抽样点；每日均值和明细始终使用完整数据。
  const points = db
    .prepare(
      `WITH ordered AS (SELECT substr(recorded_at,1,10) AS date,${value} AS value,ROW_NUMBER() OVER(ORDER BY recorded_at,id) AS n FROM enode_records WHERE ${where} AND ${value} IS NOT NULL)
    SELECT date,value FROM ordered WHERE (n-1)%?=0 ORDER BY n LIMIT 1000`
    )
    .all(...args, Math.max(1, Math.ceil(pointCount / 1000))) as EnodeData['points'];
  const records = (
    db
      .prepare(
        `SELECT r.id,r.recorded_at AS recordedAt,r.exercise_name AS exercise,r.side,r.values_json AS json,r.context_json AS contextJson,r.source_row AS sourceRow,f.filename FROM enode_records r JOIN enode_import_files f ON f.id=r.file_id WHERE ${where.replaceAll(/\b(athlete_id|project_code|kind|recorded_at|exercise_name|side)\b/g, 'r.$1')} ORDER BY r.recorded_at DESC,r.id DESC LIMIT 50 OFFSET ?`
      )
      .all(...args, (page - 1) * 50) as (Omit<EnodeRecord, 'values' | 'context'> & {
      json: string;
      contextJson: string;
    })[]
  ).map(({ json, contextJson, ...row }) => ({
    ...row,
    values: JSON.parse(json) as EnodeValues,
    context: JSON.parse(contextJson) as Record<string, string>,
  }));
  return {
    selectedExercise,
    selectedSide,
    exercises,
    sides,
    daily,
    points,
    pointCount,
    records,
    total,
    page,
    pageSize: 50,
  };
}
