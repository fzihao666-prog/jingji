import type { DatabaseSync } from 'node:sqlite';
import type {
  TeamTrainingColumnMapping,
  TeamTrainingImportResult,
  TeamTrainingMeasure,
  TeamTrainingStatistics,
  TeamTrainingBucket,
  TeamTrainingPeriod,
  TeamTrainingUnknownColumn,
  TeamTrainingBoard,
  TeamTrainingBoardDetail,
  TeamTrainingBoardPoint,
} from '../../shared/team-training-stats.ts';
import {
  defaultTeamTrainingMapping,
  TeamTrainingInputError,
  type TeamTrainingWorkbook,
} from './team-training-workbook.ts';

import { projectCapability } from '../../shared/projects.ts';
import { inferTeamTrainingGroups } from './team-training-classification.ts';

type Scope = { project: string; teamId: number };
type RecordValue = TeamTrainingMeasure & { date: string };

/** 新表仅承载队级来源，与个人训练事实分别统计。 */
export function initializeTeamTrainingStatistics(db: DatabaseSync) {
  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec(`
    CREATE TABLE IF NOT EXISTS team_training_day_values (
      team_id INTEGER NOT NULL REFERENCES project_teams(id),
      project_code TEXT NOT NULL,
      training_date TEXT NOT NULL,
      category TEXT NOT NULL,
      unit TEXT NOT NULL,
      value REAL NOT NULL CHECK(value >= 0),
      water_group TEXT CHECK(water_group IN ('water','land')),
      lesson_group TEXT CHECK(lesson_group IN ('main','auxiliary')),
      source_file TEXT NOT NULL,
      source_sheet TEXT NOT NULL,
      source_cell TEXT NOT NULL,
      source_header TEXT NOT NULL,
      updated_by INTEGER NOT NULL REFERENCES users(id),
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY(team_id,project_code,training_date,category,unit)
    );
    CREATE TABLE IF NOT EXISTS team_training_column_mappings (
      team_id INTEGER NOT NULL REFERENCES project_teams(id),
      project_code TEXT NOT NULL,
      source_key TEXT NOT NULL,
      category TEXT NOT NULL,
      unit TEXT NOT NULL,
      water_group TEXT CHECK(water_group IN ('water','land')),
      lesson_group TEXT CHECK(lesson_group IN ('main','auxiliary')),
      PRIMARY KEY(team_id,project_code,source_key)
    );
  `);
    const columns = new Set(
      db
        .prepare('PRAGMA table_info(team_training_column_mappings)')
        .all()
        .map(({ name }) => name)
    );
    if (!columns.has('water_group'))
      db.exec(
        "ALTER TABLE team_training_column_mappings ADD COLUMN water_group TEXT CHECK(water_group IN ('water','land'))"
      );
    if (!columns.has('lesson_group'))
      db.exec(
        "ALTER TABLE team_training_column_mappings ADD COLUMN lesson_group TEXT CHECK(lesson_group IN ('main','auxiliary'))"
      );
    db.exec('COMMIT');
  } catch (error) {
    if (db.isTransaction) db.exec('ROLLBACK');
    throw error;
  }
}

export function importTeamTrainingStatistics(
  db: DatabaseSync,
  input: Scope & {
    workbook: TeamTrainingWorkbook;
    filename: string;
    userId: number;
    mappings: Record<string, TeamTrainingColumnMapping>;
    authorize: () => void;
  }
): TeamTrainingImportResult {
  const { teamId, project, workbook, filename, userId, mappings, authorize } = input;
  const columns = new Map(workbook.entries.map((entry) => [entry.column.key, entry.column]));
  db.exec('BEGIN IMMEDIATE');
  try {
    authorize();
    const saved = new Map(
      (
        db
          .prepare(
            `SELECT source_key AS key,category,unit,water_group AS waterGroup,lesson_group AS lessonGroup
      FROM team_training_column_mappings WHERE team_id=? AND project_code=?`
          )
          .all(teamId, project) as (TeamTrainingColumnMapping & { key: string })[]
      ).map(({ key, ...mapping }) => [key, mapping])
    );
    const resolved = new Map<string, TeamTrainingColumnMapping>();
    const additions = new Map<string, TeamTrainingColumnMapping>();
    const unknown: TeamTrainingUnknownColumn[] = [];
    for (const [key, column] of columns) {
      const mapping = defaultTeamTrainingMapping(project, column) ?? saved.get(key);
      if (mapping) {
        resolved.set(key, mapping);
        continue;
      }
      const supplied = Object.hasOwn(mappings, key) ? mappings[key] : undefined;
      if (!supplied) {
        unknown.push({ key, label: column.label, category: column.category, unit: column.unit });
        continue;
      }
      if (column.unit && column.unit !== supplied.unit) {
        throw new TeamTrainingInputError(`“${column.label}”已注明单位，请按原单位保存。`);
      }
      if (supplied.waterGroup && !projectCapability(project)) {
        throw new TeamTrainingInputError('当前项目不使用水陆分组。');
      }
      resolved.set(key, supplied);
      additions.set(key, supplied);
    }
    if (unknown.length) {
      db.exec('ROLLBACK');
      return { status: 'mapping_required', columns: unknown };
    }

    // 同日重复来源不能以列顺序覆盖不同值。
    const records = new Map<
      string,
      {
        entry: TeamTrainingWorkbook['entries'][number];
        mapping: TeamTrainingColumnMapping;
      }
    >();
    for (const entry of workbook.entries) {
      const mapping = resolved.get(entry.column.key)!;
      const key = JSON.stringify([entry.date, mapping.category, mapping.unit]);
      const prior = records.get(key);
      if (
        prior &&
        (prior.entry.value !== entry.value ||
          (prior.mapping.waterGroup &&
            mapping.waterGroup &&
            prior.mapping.waterGroup !== mapping.waterGroup) ||
          (prior.mapping.lessonGroup &&
            mapping.lessonGroup &&
            prior.mapping.lessonGroup !== mapping.lessonGroup))
      ) {
        throw new TeamTrainingInputError(
          `${workbook.sheetName}!${entry.address} 与 ${prior.entry.address} 的同日同分项数值或分组冲突，请核对来源。`
        );
      }
      if (!prior) records.set(key, { entry, mapping });
      else
        prior.mapping = {
          ...prior.mapping,
          waterGroup: prior.mapping.waterGroup ?? mapping.waterGroup,
          lessonGroup: prior.mapping.lessonGroup ?? mapping.lessonGroup,
        };
    }

    const insertMapping = db.prepare(`INSERT INTO team_training_column_mappings
      (team_id,project_code,source_key,category,unit,water_group,lesson_group) VALUES(?,?,?,?,?,?,?)`);
    for (const [key, mapping] of additions)
      insertMapping.run(
        teamId,
        project,
        key,
        mapping.category,
        mapping.unit,
        mapping.waterGroup ?? null,
        mapping.lessonGroup ?? null
      );

    const read = db.prepare(`SELECT value, water_group, lesson_group FROM team_training_day_values
      WHERE team_id=? AND project_code=? AND training_date=? AND category=? AND unit=?`);
    const save = db.prepare(`INSERT INTO team_training_day_values
      (team_id,project_code,training_date,category,unit,value,water_group,lesson_group,source_file,source_sheet,source_cell,source_header,updated_by)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(team_id,project_code,training_date,category,unit) DO UPDATE SET
        value=excluded.value, water_group=excluded.water_group, lesson_group=excluded.lesson_group,
        source_file=excluded.source_file, source_sheet=excluded.source_sheet, source_cell=excluded.source_cell,
        source_header=excluded.source_header, updated_by=excluded.updated_by, updated_at=CURRENT_TIMESTAMP`);
    const result = {
      status: 'imported' as const,
      created: 0,
      updated: 0,
      unchanged: 0,
      undatedRows: workbook.undatedRows,
      latestDate: null as string | null,
    };
    for (const { entry, mapping } of records.values()) {
      if (!result.latestDate || entry.date > result.latestDate) result.latestDate = entry.date;
      const identity = [teamId, project, entry.date, mapping.category, mapping.unit] as const;
      const previous = read.get(...identity) as
        { value: number; water_group: string | null; lesson_group: string | null } | undefined;
      if (
        previous?.value === entry.value &&
        (!mapping.waterGroup || previous.water_group === mapping.waterGroup) &&
        (!mapping.lessonGroup || previous.lesson_group === mapping.lessonGroup)
      ) {
        result.unchanged++;
        continue;
      }
      save.run(
        ...identity,
        entry.value,
        mapping.waterGroup ?? previous?.water_group ?? null,
        mapping.lessonGroup ?? previous?.lesson_group ?? null,
        filename,
        workbook.sheetName,
        entry.address,
        entry.column.label,
        userId
      );
      if (previous) result.updated++;
      else result.created++;
    }
    db.prepare(
      `INSERT INTO audit_logs(user_id,action,entity_type,entity_id,detail)
      VALUES(?,'IMPORT_TEAM_TRAINING_STATS','team',?,?)`
    ).run(userId, teamId, JSON.stringify({ project, ...result, newMappings: additions.size }));
    db.exec('COMMIT');
    return result;
  } catch (error) {
    if (db.isTransaction) db.exec('ROLLBACK');
    throw error;
  }
}

const addDays = (date: string, days: number) => {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
};
const monday = (date: string) =>
  addDays(date, -((new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7));
const emptyBucket = (start: string): TeamTrainingBucket => ({
  start,
  distance: null,
  minutes: null,
  water: null,
  slalomProxy: null,
  maxStrength: null,
  endurance: null,
  explosive: null,
  functionalCore: null,
});

const nextMonth = (date: string) => {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCMonth(value.getUTCMonth() + 1);
  return value.toISOString().slice(0, 10);
};

const slalomCategories = new Set(['无氧能力', '无氧功率', '测功仪']);

function readPeriod(
  db: DatabaseSync,
  scope: Scope,
  selectedDate: string,
  period: TeamTrainingPeriod
) {
  const monthStart = `${selectedDate.slice(0, 7)}-01`;
  const yearStart = `${selectedDate.slice(0, 4)}-01-01`;
  const start =
    period === 'week' ? monday(selectedDate) : period === 'month' ? monthStart : yearStart;
  const next =
    period === 'week'
      ? addDays(start, 7)
      : period === 'month'
        ? nextMonth(start)
        : `${String(Number(start.slice(0, 4)) + 1).padStart(4, '0')}-01-01`;
  const rows = db
    .prepare(
      `SELECT training_date AS date,category,unit,value,
    water_group AS waterGroup,lesson_group AS lessonGroup FROM team_training_day_values
    WHERE team_id=? AND project_code=? AND training_date>=? AND training_date<? ORDER BY training_date, category, unit`
    )
    .all(scope.teamId, scope.project, start, next) as RecordValue[];
  const dates: string[] = [];
  const advance = period === 'year' ? nextMonth : (date: string) => addDays(date, 1);
  for (let date = start; date < next; date = advance(date)) dates.push(date);
  return { start, end: addDays(next, -1), anchorDate: selectedDate, dates, rows };
}

/** 保留已发布客户端使用的旧响应，新看板使用 view=board。 */
export function readTeamTrainingStatistics(
  db: DatabaseSync,
  scope: Scope,
  selectedDate: string,
  period: TeamTrainingPeriod
): TeamTrainingStatistics {
  const { start, end, anchorDate, rows, dates } = readPeriod(db, scope, selectedDate, period);
  const buckets = new Map<string, TeamTrainingBucket>();
  for (const date of dates) buckets.set(date, emptyBucket(date));
  const categories = new Map<string, TeamTrainingMeasure>();
  const otherMeasures: RecordValue[] = [];
  for (const { date, ...measure } of rows) {
    if (measure.unit !== 'min' && measure.unit !== 'km') {
      otherMeasures.push({ date, ...measure });
      continue;
    }
    const key = JSON.stringify([
      measure.category,
      measure.unit,
      measure.waterGroup,
      measure.lessonGroup,
    ]);
    const category = categories.get(key);
    if (category) category.value += measure.value;
    else categories.set(key, { ...measure });

    const bucket = buckets.get(period === 'year' ? `${date.slice(0, 7)}-01` : date)!;
    if (measure.unit === 'km') {
      bucket.distance = (bucket.distance ?? 0) + measure.value;
      continue;
    }
    bucket.minutes = (bucket.minutes ?? 0) + measure.value;
    if (measure.waterGroup === 'water') bucket.water = (bucket.water ?? 0) + measure.value;
    // 激流训练采用原表 AF 列三项口径，仅作为报表派生值。
    if (measure.waterGroup === 'water' && slalomCategories.has(measure.category))
      bucket.slalomProxy = (bucket.slalomProxy ?? 0) + measure.value;
    if (measure.category === '大力量')
      bucket.maxStrength = (bucket.maxStrength ?? 0) + measure.value;
    if (measure.category === '耐力') bucket.endurance = (bucket.endurance ?? 0) + measure.value;
    if (measure.category === '爆发力') bucket.explosive = (bucket.explosive ?? 0) + measure.value;
    if (['功能训练', '核心力量'].includes(measure.category))
      bucket.functionalCore = (bucket.functionalCore ?? 0) + measure.value;
  }
  return {
    start,
    end,
    anchorDate,
    buckets: [...buckets.values()],
    categories: [...categories.values()],
    otherMeasures,
  };
}

export function readTeamTrainingBoard(
  db: DatabaseSync,
  scope: Scope,
  selectedDate: string,
  period: TeamTrainingPeriod
): TeamTrainingBoard {
  const { start, end, anchorDate, dates, rows } = readPeriod(db, scope, selectedDate, period);
  const waterProject = Boolean(projectCapability(scope.project));
  const buckets = new Map<string, TeamTrainingBoardPoint>(
    dates.map((date) => [date, { start: date, minutes: null, distance: null }])
  );
  const totals: TeamTrainingBoard['totals'] = { minutes: null, distance: null };
  const details = new Map<string, TeamTrainingBoardDetail>();
  const lesson = new Map<string, number>();
  const water = new Map<string, number>();
  const analysis = new Map<string, Map<string, number>>();
  const inferredGroups = new Map<string, ReturnType<typeof inferTeamTrainingGroups>>();
  const add = (map: Map<string, number>, key: string, value: number) =>
    map.set(key, (map.get(key) ?? 0) + value);

  for (const row of rows) {
    const { category, unit, date, value } = row;
    const key = JSON.stringify([category, unit]);
    const inferred =
      inferredGroups.get(category) ?? inferTeamTrainingGroups(scope.project, category);
    inferredGroups.set(category, inferred);
    const waterGroup = waterProject ? (row.waterGroup ?? inferred.waterGroup ?? null) : null;
    const detail = details.get(key) ?? { category, unit, total: null, values: {}, waterGroup };
    // 同一分项在周期内的分组不一致时，明细单列为未分类。
    if (detail.waterGroup !== waterGroup) detail.waterGroup = null;
    details.set(key, detail);
    const metric = unit === 'min' ? 'minutes' : unit === 'km' ? 'distance' : null;
    const slot = period === 'year' && metric ? `${date.slice(0, 7)}-01` : date;
    if (!metric) {
      detail.values[date] = value;
      continue;
    }
    detail.values[slot] = (detail.values[slot] ?? 0) + value;
    detail.total = (detail.total ?? 0) + value;
    const bucket = buckets.get(slot)!;
    bucket[metric] = (bucket[metric] ?? 0) + value;
    totals[metric] = (totals[metric] ?? 0) + value;
    if (unit !== 'min') continue;

    const lessonGroup = row.lessonGroup ?? inferred.lessonGroup;
    add(
      lesson,
      lessonGroup === 'main' ? '主课' : lessonGroup === 'auxiliary' ? '辅课' : '未分类',
      value
    );
    const environment = waterGroup === 'water' ? '水上' : waterGroup === 'land' ? '陆上' : '未分类';
    if (waterProject) add(water, environment, value);
    const group = waterProject ? environment : '全部';
    if (!analysis.has(group)) analysis.set(group, new Map());
    add(analysis.get(group)!, category, value);
  }
  const ratio = (map: Map<string, number>, order: string[]) =>
    order.flatMap((name) => {
      const value = map.get(name);
      return value === undefined
        ? []
        : [{ name, value, percentage: totals.minutes ? (value / totals.minutes) * 100 : null }];
    });
  const timeGroup = (group: string, title: string) => {
    const values = [...(analysis.get(group) ?? [])];
    const total = values.length ? values.reduce((sum, [, value]) => sum + value, 0) : null;
    return {
      title,
      total,
      points: values
        .map(([name, value]) => ({ name, value, percentage: total ? (value / total) * 100 : null }))
        .sort((a, b) => b.value - a.value),
    };
  };
  return {
    start,
    end,
    anchorDate,
    waterProject,
    totals,
    buckets: [...buckets.values()],
    lessonRatio: ratio(lesson, ['主课', '辅课', '未分类']),
    waterRatio: ratio(water, ['水上', '陆上', '未分类']),
    timeAnalysis: waterProject
      ? [timeGroup('水上', '水上训练时间分析'), timeGroup('陆上', '陆上训练时间分析')]
      : [timeGroup('全部', '训练分项时间分析')],
    details: [...details.values()],
  };
}
