import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import {
  PHYSICAL_CHAMPION_DIMENSIONS,
  physicalChampionPayloadSchema,
} from '../../shared/physical-champion.js';
import { adultAt, buildPhysicalChampion, protocolMatches } from './physical-champion-service.js';

const databases: DatabaseSync[] = [];
afterEach(() => {
  databases.splice(0).forEach((db) => db.close());
});
function setup() {
  const db = new DatabaseSync(':memory:');
  databases.push(db);
  db.exec(`
    CREATE TABLE radar_reference_sources (id INTEGER PRIMARY KEY, name TEXT, active INTEGER);
    CREATE TABLE radar_reference_values (id INTEGER PRIMARY KEY, source_id INTEGER, revision INTEGER NOT NULL DEFAULT 0, project TEXT, radar_kind TEXT, metric_key TEXT, unit TEXT, value_num REAL, protocol TEXT, direction TEXT, source_type TEXT, gender TEXT, event_group TEXT, weight_class TEXT, age_group TEXT, active INTEGER, updated_at TEXT);
    CREATE TABLE athletes (id INTEGER PRIMARY KEY, name TEXT, gender TEXT, birth_date TEXT, project TEXT, active INTEGER);
    CREATE TABLE athlete_profiles (athlete_id INTEGER PRIMARY KEY, current_event TEXT);
    CREATE TABLE test_sessions (id INTEGER PRIMARY KEY, athlete_id INTEGER, test_date TEXT, protocol TEXT, quality TEXT, is_demo INTEGER, source TEXT);
    CREATE TABLE test_measurements (id INTEGER PRIMARY KEY, test_session_id INTEGER, metric_code TEXT, value_num REAL, unit TEXT, quality TEXT, is_demo INTEGER, source TEXT);
    INSERT INTO radar_reference_sources VALUES (1, '测试估算参考', 1);
    INSERT INTO athletes VALUES (1, '测试甲', '男', '2000-01-01', 'ROWING', 1), (2, '测试乙', '女', '2000-01-01', 'ROWING', 1), (3, '测试丙', '男', '2000-01-01', 'CANOE_SPRINT', 1), (4, '未成年测试', '男', '2015-01-01', 'ROWING', 1), (5, '年龄未知测试', '男', NULL, 'ROWING', 1), (6, '无数据测试', '男', '2000-01-01', 'ROWING', 1);
  `);
  const insertReference = db.prepare(
    `INSERT INTO radar_reference_values (source_id,project,radar_kind,metric_key,unit,value_num,protocol,direction,source_type,gender,event_group,weight_class,age_group,active,updated_at) VALUES (1,?,'physical',?,?,?,?,?,'estimated',?,'open','open','adult',1,'2026-01-01')`
  );
  PHYSICAL_CHAMPION_DIMENSIONS.forEach((dimension) => {
    insertReference.run(
      'ROWING',
      dimension.key,
      dimension.unit,
      50,
      dimension.protocol,
      dimension.direction,
      '男'
    );
    insertReference.run(
      'ROWING',
      dimension.key,
      dimension.unit,
      40,
      dimension.protocol,
      dimension.direction,
      '女'
    );
    insertReference.run(
      'CANOE_SPRINT',
      dimension.key,
      dimension.unit,
      30,
      dimension.protocol,
      dimension.direction,
      '男'
    );
  });
  const scope = {
    project: 'ROWING',
    from: '2026-01-01',
    to: '2026-01-31',
    athleteIds: [1, 2, 3, 4, 5, 6],
    canEdit: false,
  };
  function measure(
    athleteId: number,
    code: string,
    value: number,
    unit: string,
    protocol: string,
    date = '2026-01-15',
    source = 'manual'
  ) {
    const sessionId = Number(
      db
        .prepare(
          "INSERT INTO test_sessions (athlete_id,test_date,protocol,quality,is_demo,source) VALUES (?,?,?,'valid',0,?)"
        )
        .run(athleteId, date, protocol, source).lastInsertRowid
    );
    db.prepare(
      "INSERT INTO test_measurements (test_session_id,metric_code,value_num,unit,quality,is_demo,source) VALUES (?,?,?,?,'valid',0,?)"
    ).run(sessionId, code, value, unit, source);
    return sessionId;
  }
  return { db, scope, measure, build: () => buildPhysicalChampion(db, scope) };
}

describe('冠军参考匹配辅助规则', () => {
  it('生日当天成年，年龄未知和未成年不能套用成人标准', () => {
    expect(adultAt('2008-01-15', '2026-01-15')).toBe(true);
    expect(adultAt('2008-01-16', '2026-01-15')).toBe(false);
    expect(adultAt(null, '2026-01-15')).toBe(false);
  });
  it('组合协议只接受完整测试协议匹配', () => {
    expect(protocolMatches('深蹲1RM；CMJ双手叉腰', '深蹲1RM')).toBe(true);
    expect(protocolMatches('深蹲1RM估算', '深蹲1RM')).toBe(false);
    expect(protocolMatches('', '')).toBe(false);
  });
});

describe('体能冠军分析', () => {
  it('参考单位不符时排除该维度，不混用不同单位标准', () => {
    const { db, measure, build } = setup();
    db.exec(
      "UPDATE radar_reference_values SET unit='m' WHERE metric_key='vertical_jump' AND gender='男'"
    );
    measure(1, 'vertical_jump_cm', 60, 'cm', 'CMJ双手叉腰');
    const group = build().groups.find((item) => item.gender === '男')!;
    expect(group.references).toHaveLength(7);
    expect(group.references.some((reference) => reference.key === 'vertical_jump')).toBe(false);
    expect(group.team.some((dimension) => dimension.key === 'vertical_jump')).toBe(false);
  });

  it('项目、性别与授权范围隔离，未知年龄与未成年排除', () => {
    const { db, scope } = setup();
    const payload = buildPhysicalChampion(db, { ...scope, athleteIds: [1, 3, 4, 5] });
    expect(
      payload.groups
        .find((group) => group.gender === '男')
        ?.athletes.map((athlete) => athlete.athleteId)
    ).toEqual([1]);
    expect(payload.groups.find((group) => group.gender === '女')?.athletes).toEqual([]);
    expect(payload.excludedCount).toBe(2);
    expect(payload.groups.find((group) => group.gender === '男')?.references[0].value).toBe(50);
    const canoe = buildPhysicalChampion(db, { ...scope, project: 'CANOE_SPRINT' });
    expect(canoe.groups[0].athletes.map((athlete) => athlete.athleteId)).toEqual([3]);
    expect(canoe.groups[0].references[0].value).toBe(30);
  });
  it('响应包含前端可校验的完整指标标签', () => {
    const { build } = setup();
    expect(physicalChampionPayloadSchema.safeParse(build()).success).toBe(true);
  });
  it('零成绩进入团队平均，缺测保留空值且达成度不封顶', () => {
    const { measure, build } = setup();
    measure(1, 'vertical_jump_cm', 0, 'cm', 'CMJ双手叉腰');
    measure(2, 'vertical_jump_cm', 60, 'cm', 'CMJ双手叉腰');
    const payload = build();
    const male = payload.groups.find((group) => group.gender === '男')!;
    expect(male.team.find((dimension) => dimension.key === 'vertical_jump')).toMatchObject({
      value: 0,
      sampleCount: 1,
      achievedPercent: 0,
    });
    expect(
      male.athletes.find((athlete) => athlete.athleteId === 6)?.dimensions[0].value
    ).toBeNull();
    expect(
      payload.groups
        .find((group) => group.gender === '女')
        ?.team.find((dimension) => dimension.key === 'vertical_jump')?.achievedPercent
    ).toBe(150);
  });
  it('排除协议、单位不符以及演示、估算、异常记录', () => {
    const { db, measure, build } = setup();
    measure(1, 'vertical_jump_cm', 55, 'cm', '错误协议');
    measure(1, 'vertical_jump_cm', 55, 'm', 'CMJ双手叉腰');
    measure(1, 'vertical_jump_cm', 55, 'cm', 'CMJ双手叉腰', '2026-01-16', 'estimated');
    const demo = measure(1, 'vertical_jump_cm', 55, 'cm', 'CMJ双手叉腰');
    db.prepare('UPDATE test_sessions SET is_demo=1 WHERE id=?').run(demo);
    const outlier = measure(1, 'vertical_jump_cm', 55, 'cm', 'CMJ双手叉腰');
    db.prepare("UPDATE test_measurements SET quality='outlier' WHERE test_session_id=?").run(
      outlier
    );
    expect(
      build()
        .groups.find((group) => group.gender === '男')
        ?.team.find((dimension) => dimension.key === 'vertical_jump')
    ).toMatchObject({ value: null, sampleCount: 0 });
  });
  it('相对力量只使用同课次有效体重', () => {
    const { db, measure, build } = setup();
    measure(1, 'weight_kg', 80, 'kg', '体重');
    const squat = measure(1, 'squat_kg', 160, 'kg', '深蹲1RM');
    expect(
      build()
        .groups.find((group) => group.gender === '男')
        ?.team.find((dimension) => dimension.key === 'relative_squat')?.value
    ).toBeNull();
    db.prepare(
      "INSERT INTO test_measurements (test_session_id,metric_code,value_num,unit,quality,is_demo,source) VALUES (?,'weight_kg',100,'kg','valid',0,'manual')"
    ).run(squat);
    expect(
      build()
        .groups.find((group) => group.gender === '男')
        ?.team.find((dimension) => dimension.key === 'relative_squat')?.value
    ).toBe(1.6);
  });
  it('趋势仅使用周期内数据，日期升序并保留个人真实变化', () => {
    const { db, measure, build } = setup();
    PHYSICAL_CHAMPION_DIMENSIONS.filter((dimension) => dimension.key !== 'vertical_jump').forEach(
      (dimension) => {
        const session = measure(
          1,
          dimension.codes[0],
          50,
          dimension.measurementUnit,
          dimension.protocol,
          '2026-01-10'
        );
        if (dimension.weightRelative)
          db.prepare(
            "INSERT INTO test_measurements (test_session_id,metric_code,value_num,unit,quality,is_demo,source) VALUES (?,'weight_kg',1,'kg','valid',0,'manual')"
          ).run(session);
      }
    );
    measure(1, 'vertical_jump_cm', 100, 'cm', 'CMJ双手叉腰', '2025-12-31');
    measure(1, 'vertical_jump_cm', 60, 'cm', 'CMJ双手叉腰', '2026-01-20');
    measure(1, 'vertical_jump_cm', 40, 'cm', 'CMJ双手叉腰', '2026-01-10');
    const trend = build()
      .groups.find((group) => group.gender === '男')!
      .trend.filter((point) => point.athleteId === 1);
    expect(trend.map((point) => point.date)).toEqual(['2026-01-10', '2026-01-20']);
    expect(trend.map((point) => point.score)).toEqual([97.5, 102.5]);
  });
  it('完整覆盖者优先进入排名，稀疏高分不能领先完整样本', () => {
    const { db, scope, measure } = setup();
    db.exec("UPDATE athletes SET gender='男' WHERE id=2");
    PHYSICAL_CHAMPION_DIMENSIONS.forEach((dimension) => {
      const session = measure(
        1,
        dimension.codes[0],
        50,
        dimension.measurementUnit,
        dimension.protocol
      );
      if (dimension.weightRelative)
        db.prepare(
          "INSERT INTO test_measurements (test_session_id,metric_code,value_num,unit,quality,is_demo,source) VALUES (?,'weight_kg',1,'kg','valid',0,'manual')"
        ).run(session);
    });
    measure(2, 'vertical_jump_cm', 500, 'cm', 'CMJ双手叉腰');
    const athletes = buildPhysicalChampion(db, scope).groups.find(
      (group) => group.gender === '男'
    )!.athletes;
    expect(athletes[0]).toMatchObject({ athleteId: 1, coverage: 8, score: 100 });
    expect(athletes[1]).toMatchObject({ athleteId: 2, coverage: 1, score: null });
  });
});

describe('轻量级适用范围', () => {
  it('不对明确标注轻量级的运动员套用开放体重参考', () => {
    const { db, build } = setup();
    db.prepare(
      "INSERT INTO athlete_profiles (athlete_id, current_event) VALUES (1, '男子轻量级双人双桨')"
    ).run();
    expect(
      build()
        .groups.find((group) => group.gender === '男')
        ?.athletes.some((athlete) => athlete.athleteId === 1)
    ).toBe(false);
  });
});

describe('历史项目别名', () => {
  it('规范项目只复用对应别名的参考，不混用其他项目', () => {
    const { db, scope } = setup();
    db.exec("UPDATE radar_reference_values SET project='CANOE' WHERE project='CANOE_SPRINT'");
    const payload = buildPhysicalChampion(db, { ...scope, project: 'CANOE_SPRINT' });
    expect(payload.groups).toHaveLength(1);
    expect(payload.groups[0].references).toHaveLength(8);
    expect(payload.groups[0].references[0].value).toBe(30);
    expect(payload.groups[0].athletes.map((athlete) => athlete.athleteId)).toEqual([3]);
  });
});

describe('用户授权补充记录的成人参考假定', () => {
  it('仅允许年龄未知且明确附成人参考假定的用户补充记录参与比较', () => {
    const { db, measure, build } = setup();
    measure(
      5,
      'vertical_jump_cm',
      45,
      'cm',
      'CMJ双手叉腰；成人参考假定（用户模拟补充）',
      '2026-01-15',
      'user_requested_simulation'
    );
    const athlete = build()
      .groups.find((group) => group.gender === '男')
      ?.athletes.find((item) => item.athleteId === 5);
    expect(athlete?.coverage).toBe(1);
    expect(athlete?.dimensions.find((item) => item.key === 'vertical_jump')?.value).toBe(45);
    expect(db.prepare('SELECT birth_date FROM athletes WHERE id=5').get()).toEqual({
      birth_date: null,
    });
  });
  it('补充标记不能将已知未成年运动员套入成人参考', () => {
    const { measure, build } = setup();
    measure(
      4,
      'vertical_jump_cm',
      45,
      'cm',
      'CMJ双手叉腰；成人参考假定（用户模拟补充）',
      '2026-01-15',
      'user_requested_simulation'
    );
    expect(
      build()
        .groups.flatMap((group) => group.athletes)
        .some((item) => item.athleteId === 4)
    ).toBe(false);
  });
});
