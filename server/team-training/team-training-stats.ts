import type { DatabaseSync } from 'node:sqlite';
import type {
  TeamTrainingColumnMapping,
  TeamTrainingImportResult,
  TeamTrainingMeasure,
  TeamTrainingStatistics,
  TeamTrainingWeek,
} from '../../shared/team-training-stats.ts';
import {
  defaultTeamTrainingMapping,
  TeamTrainingInputError,
  type TeamTrainingWorkbook,
} from './team-training-workbook.ts';

type Scope = { project: string; teamId: number };
type RecordValue = TeamTrainingMeasure & { date: string };

/** 新表仅承载队级来源，与个人训练事实分别统计。 */
export function initializeTeamTrainingStatistics(db: DatabaseSync) {
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
      PRIMARY KEY(team_id,project_code,source_key)
    );
  `);
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
            `SELECT source_key AS key,category,unit
      FROM team_training_column_mappings WHERE team_id=? AND project_code=?`
          )
          .all(teamId, project) as (TeamTrainingColumnMapping & { key: string })[]
      ).map(({ key, ...mapping }) => [key, mapping])
    );
    const resolved = new Map<string, TeamTrainingColumnMapping>();
    const additions = new Map<string, TeamTrainingColumnMapping>();
    const unknown: Array<{ key: string; label: string; unit: string }> = [];
    for (const [key, column] of columns) {
      const mapping = defaultTeamTrainingMapping(project, column) ?? saved.get(key);
      if (mapping) {
        resolved.set(key, mapping);
        continue;
      }
      const supplied = Object.hasOwn(mappings, key) ? mappings[key] : undefined;
      if (!supplied) {
        unknown.push({ key, label: column.label, unit: column.unit });
        continue;
      }
      if (column.unit && column.unit !== supplied.unit) {
        throw new TeamTrainingInputError(`“${column.label}”已注明单位，请按原单位保存。`);
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
      if (prior && prior.entry.value !== entry.value) {
        throw new TeamTrainingInputError(
          `${workbook.sheetName}!${entry.address} 与 ${prior.entry.address} 的同日同分项数值冲突，请在 Excel 中保留正确值。`
        );
      }
      if (!prior) records.set(key, { entry, mapping });
    }

    const insertMapping = db.prepare(`INSERT INTO team_training_column_mappings
      (team_id,project_code,source_key,category,unit) VALUES(?,?,?,?,?)`);
    for (const [key, mapping] of additions)
      insertMapping.run(teamId, project, key, mapping.category, mapping.unit);

    const read = db.prepare(`SELECT value FROM team_training_day_values
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
    };
    for (const { entry, mapping } of records.values()) {
      const identity = [teamId, project, entry.date, mapping.category, mapping.unit] as const;
      const previous = read.get(...identity);
      if (previous?.value === entry.value) {
        result.unchanged++;
        continue;
      }
      save.run(
        ...identity,
        entry.value,
        mapping.waterGroup ?? null,
        mapping.lessonGroup ?? null,
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
const emptyWeek = (start: string): TeamTrainingWeek => ({
  start,
  minutes: null,
  water: null,
  slalomProxy: null,
  maxStrength: null,
  endurance: null,
  explosive: null,
  functionalCore: null,
});

export function readTeamTrainingStatistics(
  db: DatabaseSync,
  scope: Scope,
  selectedDate: string
): TeamTrainingStatistics {
  const weekStart = monday(selectedDate);
  const weekEnd = addDays(weekStart, 6);
  const weekYear = Number(addDays(weekStart, 3).slice(0, 4));
  const yearStart = monday(`${weekYear}-01-04`);
  const nextYearStart = monday(`${weekYear + 1}-01-04`);
  const rows = db
    .prepare(
      `SELECT training_date AS date,category,unit,value,
    water_group AS waterGroup,lesson_group AS lessonGroup FROM team_training_day_values
    WHERE team_id=? AND project_code=? AND training_date>=? AND training_date<? ORDER BY training_date, category`
    )
    .all(scope.teamId, scope.project, yearStart, nextYearStart) as RecordValue[];
  const days = Array.from({ length: 7 }, (_, index) => ({
    date: addDays(weekStart, index),
    minutes: null as number | null,
    distance: null as number | null,
  }));
  const daily = new Map(days.map((day) => [day.date, day]));
  const categories = new Map<string, TeamTrainingMeasure>();
  const otherMeasures: RecordValue[] = [];
  const weeks = new Map<string, TeamTrainingWeek>();
  for (let date = yearStart; date < nextYearStart; date = addDays(date, 7))
    weeks.set(date, emptyWeek(date));
  const slalomCategories = new Set(['无氧能力', '无氧功率', '测功仪']);
  for (const { date, ...measure } of rows) {
    const day = daily.get(date);
    if (day && measure.unit !== 'min' && measure.unit !== 'km') {
      otherMeasures.push({ date, ...measure });
    } else if (day) {
      if (measure.unit === 'min') day.minutes = (day.minutes ?? 0) + measure.value;
      if (measure.unit === 'km') day.distance = (day.distance ?? 0) + measure.value;
      const key = JSON.stringify([
        measure.category,
        measure.unit,
        measure.waterGroup,
        measure.lessonGroup,
      ]);
      const category = categories.get(key);
      if (category) category.value += measure.value;
      else categories.set(key, { ...measure });
    }
    const week = weeks.get(monday(date));
    if (!week || measure.unit !== 'min') continue;
    week.minutes = (week.minutes ?? 0) + measure.value;
    if (measure.waterGroup === 'water') week.water = (week.water ?? 0) + measure.value;
    // 激流训练采用原表 AF 列三项口径，仅作为报表派生值。
    if (measure.waterGroup === 'water' && slalomCategories.has(measure.category))
      week.slalomProxy = (week.slalomProxy ?? 0) + measure.value;
    if (measure.category === '大力量') week.maxStrength = (week.maxStrength ?? 0) + measure.value;
    if (measure.category === '耐力') week.endurance = (week.endurance ?? 0) + measure.value;
    if (measure.category === '爆发力') week.explosive = (week.explosive ?? 0) + measure.value;
    if (['功能训练', '核心力量'].includes(measure.category))
      week.functionalCore = (week.functionalCore ?? 0) + measure.value;
  }
  return {
    weekStart,
    weekEnd,
    weekYear,
    daily: days,
    categories: [...categories.values()],
    otherMeasures,
    weekly: [...weeks.values()],
  };
}
