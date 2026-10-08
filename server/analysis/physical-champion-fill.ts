import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { PHYSICAL_CHAMPION_DIMENSIONS } from '../../shared/physical-champion.ts';
import {
  ADULT_REFERENCE_ASSUMPTION,
  USER_PHYSICAL_SIMULATION_SOURCE,
  adultAt,
  buildPhysicalChampion,
} from './physical-champion-service.ts';

const optionsSchema = z
  .strictObject({
    from: z.iso.date(),
    to: z.iso.date(),
    actorId: z.number().int().positive(),
    batchId: z.string().trim().min(1).max(100),
  })
  .refine(
    (value) =>
      value.from <= value.to && Date.parse(value.to) - Date.parse(value.from) <= 366 * 86400000
  );
type Options = z.infer<typeof optionsSchema>;
type Athlete = {
  id: number;
  project: string;
  gender: string;
  birthDate: string | null;
  event: string;
};

/** 只由用户明确授权的本地维护操作调用，不在服务启动时自动生成测试事实。 */
export function fillPhysicalChampionSimulation(db: DatabaseSync, input: Options) {
  const options = optionsSchema.parse(input);
  const actor = db
    .prepare("SELECT id FROM users WHERE id=? AND role='DMD' AND active=1")
    .get(options.actorId);
  if (!actor) throw new Error('补充操作需要有效管理账号');
  if (db.isTransaction) throw new Error('补充操作需要独立事务');
  const summary = {
    athletesFilled: 0,
    sessionsInserted: 0,
    measurementsInserted: 0,
    skipped: 0,
    batchId: options.batchId,
  };
  const fromMs = Date.parse(options.from);
  const rangeMs = Date.parse(options.to) - fromMs;
  const dates = [
    ...new Set(
      [0, 1, 2, 3].map((step) =>
        new Date(fromMs + Math.round((rangeMs * step) / 3 / 86400000) * 86400000)
          .toISOString()
          .slice(0, 10)
      )
    ),
  ];
  db.exec('BEGIN IMMEDIATE');
  try {
    const athletes = db
      .prepare(
        `SELECT a.id,a.project,a.gender,a.birth_date AS birthDate,COALESCE(ap.current_event,'') AS event
      FROM athletes a LEFT JOIN athlete_profiles ap ON ap.athlete_id=a.id
      WHERE a.active=1 AND a.project IN ('ROWING','CANOE_SPRINT','CANOE_SLALOM')`
      )
      .all() as Athlete[];
    const projects = ['ROWING', 'CANOE_SPRINT', 'CANOE_SLALOM'];
    const models = new Map(
      projects.map((project) => [
        project,
        buildPhysicalChampion(db, {
          project,
          from: options.from,
          to: options.to,
          athleteIds: athletes.map((athlete) => athlete.id),
          canEdit: false,
        }),
      ])
    );
    const definition = db.prepare(
      `INSERT OR IGNORE INTO metric_definitions(code,label,domain,unit,direction,frequency,minimum,maximum) VALUES(?,?,'strength',?,'higher_better','phase',0,?)`
    );
    definition.run('weight_kg', '体重', 'kg', 200);
    for (const dimension of PHYSICAL_CHAMPION_DIMENSIONS)
      definition.run(
        dimension.codes[0],
        dimension.label,
        dimension.measurementUnit,
        dimension.weightRelative
          ? 500
          : dimension.key === 'vo2max'
            ? 100
            : dimension.key === 'wingate_peak'
              ? 30
              : 1000
      );
    const findSession = db.prepare(
      'SELECT id FROM test_sessions WHERE athlete_id=? AND test_date=? AND test_type=?'
    );
    const insertSession = db.prepare(
      `INSERT INTO test_sessions(athlete_id,test_date,test_type,protocol,source,quality,is_demo,created_by) VALUES(?,?,?,?,?,'valid',0,?)`
    );
    const insertMeasurement = db.prepare(
      `INSERT INTO test_measurements(test_session_id,metric_code,value_num,unit,side,quality,source,is_demo,source_ref) VALUES(?,?,?,?,'center','valid',?,0,?)`
    );
    const readWeight =
      db.prepare(`SELECT tm.value_num AS value FROM test_measurements tm JOIN test_sessions ts ON ts.id=tm.test_session_id
      WHERE ts.athlete_id=? AND ts.test_date<=? AND tm.metric_code IN ('weight_kg','weightKg') AND tm.unit='kg' AND tm.value_num BETWEEN 30 AND 200
      AND ts.quality='valid' AND tm.quality='valid' AND ts.is_demo=0 AND tm.is_demo=0 ORDER BY ts.test_date DESC,ts.id DESC LIMIT 1`);
    for (const athlete of athletes) {
      const group = models
        .get(athlete.project)
        ?.groups.find(
          (item) =>
            item.gender === athlete.gender &&
            item.event === 'open' &&
            item.weightClass === 'open' &&
            item.ageGroup === 'adult'
        );
      if (
        !group ||
        (athlete.birthDate?.trim() && !adultAt(athlete.birthDate, options.to)) ||
        /(轻量级|lightweight|\bLW)/i.test(athlete.event)
      ) {
        summary.skipped++;
        continue;
      }
      const current = group.athletes.find((item) => item.athleteId === athlete.id);
      const missing = group.references.filter(
        (reference) => current?.dimensions.find((item) => item.key === reference.key)?.value == null
      );
      if (!missing.length) continue;
      const weightRow = readWeight.get(athlete.id, options.to) as { value: number } | undefined;
      const weight =
        weightRow?.value ??
        Math.round((athlete.gender === '女' ? 60 : 78) + ((athlete.id * 7) % 17));
      const base = 0.74 + ((athlete.id * 13) % 25) / 100;
      let insertedForAthlete = false;
      for (const [index, date] of dates.entries()) {
        if (athlete.birthDate?.trim() && !adultAt(athlete.birthDate, date)) continue;
        // 不向已存在的测试追加或更新数据，保留用户后续修改过的补充记录。
        let testType = '力量素质测试';
        if (findSession.get(athlete.id, date, testType)) testType = '体能冠军模型补充测试';
        if (findSession.get(athlete.id, date, testType)) continue;
        const protocol = [
          ...new Set(missing.map((reference) => reference.protocol)),
          '用户授权模拟补充',
          ...(!athlete.birthDate?.trim() ? [ADULT_REFERENCE_ASSUMPTION] : []),
          `补充批次:${options.batchId}`,
        ].join('；');
        const sessionId = Number(
          insertSession.run(
            athlete.id,
            date,
            testType,
            protocol,
            USER_PHYSICAL_SIMULATION_SOURCE,
            options.actorId
          ).lastInsertRowid
        );
        insertMeasurement.run(
          sessionId,
          'weight_kg',
          weight,
          'kg',
          USER_PHYSICAL_SIMULATION_SOURCE,
          options.batchId
        );
        summary.measurementsInserted++;
        for (const reference of missing) {
          const dimension = PHYSICAL_CHAMPION_DIMENSIONS.find(
            (item) => item.key === reference.key
          )!;
          const dimensionIndex = PHYSICAL_CHAMPION_DIMENSIONS.findIndex(
            (item) => item.key === reference.key
          );
          const ratio =
            base +
            (((athlete.id + dimensionIndex * 5) % 15) - 7) / 100 +
            (index - (dates.length - 1)) * 0.018;
          let value =
            reference.direction === 'lower_better'
              ? reference.value / ratio
              : reference.value * ratio;
          if (dimension.weightRelative) value *= weight;
          value =
            Math.round(
              value * (dimension.unit === '次' || dimension.key === 'front_plank' ? 1 : 10)
            ) / (dimension.unit === '次' || dimension.key === 'front_plank' ? 1 : 10);
          if (!Number.isFinite(value) || value <= 0) throw new Error('补充值校验失败');
          insertMeasurement.run(
            sessionId,
            dimension.codes[0],
            value,
            dimension.measurementUnit,
            USER_PHYSICAL_SIMULATION_SOURCE,
            options.batchId
          );
          summary.measurementsInserted++;
        }
        summary.sessionsInserted++;
        insertedForAthlete = true;
      }
      if (insertedForAthlete) summary.athletesFilled++;
    }
    if (summary.sessionsInserted)
      db.prepare(
        `INSERT INTO audit_logs(user_id,action,entity_type,detail) VALUES(?,'USER_AUTHORIZED_PHYSICAL_SIMULATION','test_session',?)`
      ).run(
        options.actorId,
        JSON.stringify({
          ...summary,
          from: options.from,
          to: options.to,
          source: USER_PHYSICAL_SIMULATION_SOURCE,
          description: '用户明确授权的模拟补充，按正式测试参与统计，原测试未覆盖',
        })
      );
    if (db.prepare('PRAGMA foreign_key_check').all().length)
      throw new Error('数据外键检查失败，补充已回滚');
    db.exec('COMMIT');
    return summary;
  } catch (error) {
    if (db.isTransaction) db.exec('ROLLBACK');
    throw error;
  }
}
