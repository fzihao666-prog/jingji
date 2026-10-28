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
    CREATE TABLE radar_reference_values (id INTEGER PRIMARY KEY, source_id INTEGER, revision INTEGER NOT NULL DEFAULT 0, project TEXT, radar_kind TEXT, metric_key TEXT, unit TEXT, value_num REAL, protocol TEXT, protocol_version TEXT DEFAULT '', test_context TEXT DEFAULT '', side TEXT DEFAULT 'center', direction TEXT, source_type TEXT, review_status TEXT DEFAULT 'reviewed', source_nature TEXT DEFAULT 'official_research', version INTEGER DEFAULT 1, effective_from TEXT DEFAULT '2020-01-01', effective_to TEXT, position TEXT DEFAULT 'open', reference_level TEXT DEFAULT 'open', reference_label TEXT DEFAULT '', dimension_version TEXT DEFAULT 'v1', measurement_codes TEXT DEFAULT '[]', measurement_unit TEXT DEFAULT '', weight_relative INTEGER DEFAULT 0, gender TEXT, event_group TEXT, weight_class TEXT, age_group TEXT, active INTEGER, updated_at TEXT);
    CREATE TABLE athletes (id INTEGER PRIMARY KEY, name TEXT, gender TEXT, birth_date TEXT, project TEXT, active INTEGER);
    CREATE TABLE athlete_profiles (athlete_id INTEGER PRIMARY KEY, current_event TEXT, position TEXT, technical_level TEXT);
    CREATE TABLE test_sessions (project_code TEXT DEFAULT 'ROWING', project_status TEXT DEFAULT 'confirmed', id INTEGER PRIMARY KEY, athlete_id INTEGER, test_date TEXT, protocol TEXT, protocol_version TEXT DEFAULT '', context_key TEXT DEFAULT '', quality TEXT, is_demo INTEGER, source TEXT);
    CREATE TABLE test_measurements (id INTEGER PRIMARY KEY, test_session_id INTEGER, metric_code TEXT, value_num REAL, unit TEXT, side TEXT DEFAULT 'center', quality TEXT, is_demo INTEGER, source TEXT);
    INSERT INTO radar_reference_sources VALUES (1, '测试估算参考', 1);
    INSERT INTO athletes VALUES (1, '测试甲', '男', '2000-01-01', 'ROWING', 1), (2, '测试乙', '女', '2000-01-01', 'ROWING', 1), (3, '测试丙', '男', '2000-01-01', 'CANOE_SPRINT', 1), (4, '未成年测试', '男', '2015-01-01', 'ROWING', 1), (5, '年龄未知测试', '男', NULL, 'ROWING', 1), (6, '无数据测试', '男', '2000-01-01', 'ROWING', 1);
  `);
  const insertReference = db.prepare(
    `INSERT INTO radar_reference_values (source_id,project,radar_kind,metric_key,unit,value_num,protocol,direction,source_type,gender,event_group,weight_class,age_group,active,updated_at) VALUES (1,?,'physical',?,?,?,?,?,'public_reference',?,'open','open','adult',1,'2026-01-01')`
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
  for (const dimension of PHYSICAL_CHAMPION_DIMENSIONS)
    db.prepare(
      'UPDATE radar_reference_values SET measurement_codes=?, measurement_unit=?,weight_relative=? WHERE metric_key=?'
    ).run(
      JSON.stringify(dimension.codes),
      dimension.measurementUnit,
      Number(dimension.weightRelative),
      dimension.key
    );
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
    expect(protocolMatches(null, 'CMJ双手叉腰')).toBe(false);
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
    expect(
      group.team.find((dimension) => dimension.key === 'vertical_jump')?.achievedPercent
    ).toBeNull();
    expect(
      group.modelDimensions?.find((dimension) => dimension.key === 'vertical_jump')?.value
    ).toBeNull();
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
        ?.athletes.find((item) => item.athleteId === 2)
        ?.dimensions.find((dimension) => dimension.key === 'vertical_jump')?.achievedPercent
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
  it('完整维度恢复展示趋势，按同条件实测计算达成度', () => {
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
    expect(trend.map((point) => point.score)).toEqual([97.5, 102.5]);
    expect(trend.every((point) => point.coverage === 8)).toBe(true);
  });
  it('完整维度提供达成度，稀疏样本不补零或生成排名', () => {
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
    expect(athletes[0]).toMatchObject({ athleteId: 1, coverage: 8, scoringEligible: true });
    expect(athletes[0].score).not.toBeNull();
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
    expect(payload.groups).toHaveLength(2);
    expect(payload.groups[0].references).toHaveLength(8);
    expect(payload.groups[0].references[0].value).toBe(30);
    expect(payload.groups[0].athletes.map((athlete) => athlete.athleteId)).toEqual([3]);
  });
});

describe('用户授权补充记录的成人参考假定', () => {
  it('年龄未知即使存在模拟成人假定也不参与比较', () => {
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
    expect(athlete).toBeUndefined();
    expect(build().measurements.some((row) => row.athleteId === 5)).toBe(false);
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

describe('参考审核与事实归属', () => {
  it('估算与草稿提供展示对标，保留真实零与来源', () => {
    const { db, measure, build } = setup();
    measure(1, 'vertical_jump_cm', 0, 'cm', 'CMJ双手叉腰');
    db.exec("UPDATE radar_reference_values SET review_status='draft'");
    expect(
      build().groups[0].athletes[0].dimensions.find((item) => item.key === 'vertical_jump')
    ).toMatchObject({ achievedPercent: 0, scoringEligible: false });
    expect(build().measurements[0].value).toBe(0);
    expect(
      buildPhysicalChampion(db, {
        project: 'ROWING',
        from: '2026-01-01',
        to: '2026-01-31',
        athleteIds: [1],
        canEdit: true,
      }).managementReferences[0].reviewStatus
    ).toBe('draft');
    db.exec(
      "UPDATE radar_reference_values SET review_status='reviewed',source_type='estimated',source_nature='estimated'"
    );
    expect(
      build().groups[0].athletes[0].dimensions.find((item) => item.key === 'vertical_jump')
    ).toMatchObject({ achievedPercent: 0, scoringEligible: false });
  });
  it('错误归属与待核实事实不得被引用', () => {
    const { db, measure, build } = setup();
    const wrong = measure(1, 'vertical_jump_cm', 60, 'cm', 'CMJ双手叉腰');
    db.prepare("UPDATE test_sessions SET project_code='VOLLEYBALL' WHERE id=?").run(wrong);
    expect(build().measurements).toEqual([]);
    db.prepare(
      "UPDATE test_sessions SET project_code='ROWING',project_status='pending_verification' WHERE id=?"
    ).run(wrong);
    expect(build().measurements).toEqual([]);
  });
  it('同优先级冲突暂停评分，事实和版本引用保持可解释', () => {
    const { db, measure, build } = setup();
    measure(1, 'vertical_jump_cm', 60, 'cm', 'CMJ双手叉腰');
    db.exec(
      "INSERT INTO radar_reference_values SELECT id+1000,source_id,revision,project,radar_kind,metric_key,unit,value_num,protocol,protocol_version,test_context,side,direction,source_type,review_status,source_nature,version,effective_from,effective_to,position,reference_level,reference_label,dimension_version,measurement_codes,measurement_unit,weight_relative,gender,event_group,weight_class,age_group,active,updated_at FROM radar_reference_values WHERE metric_key='vertical_jump' AND gender='男'"
    );
    const dimension = build().groups[0].athletes[0].dimensions.find(
      (item) => item.key === 'vertical_jump'
    )!;
    expect(dimension.value).toBe(60);
    expect(dimension.achievedPercent).toBeNull();
    expect(dimension.pendingReason).toContain('冲突');
  });
  it.each(['CYCLING_ROAD', 'CYCLING_TRACK', 'VOLLEYBALL'])(
    '%s共用体能框架但不复制水上参考数值',
    (project) => {
      const { db, scope } = setup();
      db.prepare('UPDATE athletes SET project=? WHERE id=1').run(project);
      const result = buildPhysicalChampion(db, { ...scope, project });
      expect(result.groups).toHaveLength(2);
      expect(
        result.groups.every(
          (group) =>
            group.references.length === 0 &&
            group.modelDimensions?.length === 8 &&
            group.modelDimensions.every((item) => item.value === null)
        )
      ).toBe(true);
      expect(result.pendingReason).toContain('暂无');
    }
  );
});

function duplicateReference(db: DatabaseSync, changes: Record<string, string | number | null>) {
  const original = db
    .prepare(
      "SELECT * FROM radar_reference_values WHERE project='ROWING' AND gender='男' AND metric_key='vertical_jump' LIMIT 1"
    )
    .get() as Record<string, string | number | null>;
  const { id: _id, ...row } = original;
  Object.assign(row, changes);
  return Number(
    db
      .prepare(
        `INSERT INTO radar_reference_values(${Object.keys(row).join(',')}) VALUES(${Object.keys(row)
          .map(() => '?')
          .join(',')})`
      )
      .run(...Object.values(row)).lastInsertRowid
  );
}
describe('明确条件、日期版本及独立项目维度', () => {
  it('精确条件优先于明确开放条件，完整实测缺项仍不生成综合分', () => {
    const { db, measure, build } = setup();
    const open = duplicateReference(db, { gender: 'open', age_group: 'open', value_num: 30 });
    measure(1, 'vertical_jump_cm', 60, 'cm', 'CMJ双手叉腰');
    const athlete = build().groups.find((group) => group.gender === '男')!.athletes[0];
    const dimension = athlete.dimensions.find((item) => item.key === 'vertical_jump')!;
    expect(dimension.achievedPercent).toBe(120);
    expect(dimension.referenceId).not.toBe(open);
    expect(dimension.appliedReference?.value).toBe(50);
    expect(athlete.score).toBeNull();
  });
  it('未知级别或位置不猜测，缺生日给出明确原因', () => {
    const { db, build } = setup();
    db.exec("UPDATE radar_reference_values SET reference_level='elite'");
    expect(build().groups.flatMap((group) => group.athletes)).toEqual([]);
    expect(build().athletePendingReasons.find((item) => item.athleteId === 1)?.reason).toContain(
      '级别'
    );
    expect(build().athletePendingReasons.find((item) => item.athleteId === 5)?.reason).toContain(
      '出生日期缺失'
    );
    db.exec("UPDATE radar_reference_values SET reference_level='open',position='主攻'");
    expect(build().athletePendingReasons[0].reason).toContain('位置');
    db.exec("INSERT INTO athlete_profiles(athlete_id,position) VALUES(1,'主攻')");
    expect(build().groups[0].athletes[0].athleteId).toBe(1);
  });
  it('评价引用事实发生日有效版本，返回事实、版本与计算依据', () => {
    const { db, measure, build } = setup();
    db.exec(
      "UPDATE radar_reference_values SET effective_to='2026-01-20' WHERE metric_key='vertical_jump' AND gender='男'"
    );
    duplicateReference(db, {
      value_num: 100,
      version: 2,
      effective_from: '2026-01-21',
      effective_to: null,
    });
    const session = measure(1, 'vertical_jump_cm', 60, 'cm', 'CMJ双手叉腰', '2026-01-15');
    const result = build().groups[0].athletes[0].dimensions.find(
      (item) => item.key === 'vertical_jump'
    )!;
    expect(result).toMatchObject({
      value: 60,
      achievedPercent: 120,
      referenceVersion: 1,
      calculationVersion: 'physical-display-v3',
    });
    expect(result.appliedReference?.value).toBe(50);
    expect(result.factMeasurementId).toBeGreaterThan(0);
    expect(build().measurements.find((row) => row.sessionId === session)?.measurementId).toBe(
      result.factMeasurementId
    );
  });
  it('同一个公共纵跳代码按项目分别评价，新项目只显示自己的维度', () => {
    const { db, measure, scope } = setup();
    db.exec("UPDATE athletes SET project='VOLLEYBALL' WHERE id=2");
    duplicateReference(db, {
      project: 'VOLLEYBALL',
      gender: '女',
      metric_key: 'volleyball_jump',
      value_num: 40,
      reference_label: '队内纵跳参考',
      source_nature: 'team',
    });
    measure(1, 'vertical_jump_cm', 60, 'cm', 'CMJ双手叉腰');
    const volleyball = measure(2, 'vertical_jump_cm', 60, 'cm', 'CMJ双手叉腰');
    db.prepare("UPDATE test_sessions SET project_code='VOLLEYBALL' WHERE id=?").run(volleyball);
    const rowing = buildPhysicalChampion(db, scope);
    const volley = buildPhysicalChampion(db, { ...scope, project: 'VOLLEYBALL' });
    expect(
      rowing.groups[0].athletes[0].dimensions.find((item) => item.key === 'vertical_jump')
        ?.achievedPercent
    ).toBe(120);
    expect(volley.groups[0].references.map((ref) => ref.key)).toEqual(['volleyball_jump']);
    expect(volley.groups[0].athletes[0].dimensions[0].achievedPercent).toBe(150);
    expect(volley.groups[0].athletes[0].score).toBe(150);
    expect(volley.groups[0].referenceLevel).toBe('队内纵跳参考');
  });
});

describe('协议版本、测试条件与侧别严格匹配', () => {
  it.each([
    ['protocol_version', 'v1', 'v2'],
    ['context_key', 'indoor', 'outdoor'],
    ['side', 'left', 'right'],
  ])('%s不同不套用同名协议参考', (field, expected, actual) => {
    const { db, measure, build } = setup();
    const referenceField = field === 'context_key' ? 'test_context' : field;
    db.prepare(
      `UPDATE radar_reference_values SET ${referenceField}=? WHERE metric_key='vertical_jump'`
    ).run(expected);
    const session = measure(1, 'vertical_jump_cm', 60, 'cm', 'CMJ双手叉腰');
    const table = field === 'side' ? 'test_measurements' : 'test_sessions';
    const idField = field === 'side' ? 'test_session_id' : 'id';
    db.prepare(`UPDATE ${table} SET ${field}=? WHERE ${idField}=?`).run(actual, session);
    const dimension = () =>
      build().groups[0].athletes[0].dimensions.find((item) => item.key === 'vertical_jump')!;
    expect(dimension().achievedPercent).toBeNull();
    db.prepare(`UPDATE ${table} SET ${field}=? WHERE ${idField}=?`).run(expected, session);
    expect(dimension().achievedPercent).toBe(120);
  });
  it('缺协议或版本不推断为已配置版本，空默认条件也不匹配具名条件', () => {
    const { db, measure, build } = setup();
    db.exec(
      "UPDATE radar_reference_values SET protocol_version='v1' WHERE metric_key='vertical_jump'"
    );
    measure(1, 'vertical_jump_cm', 60, 'cm', 'CMJ双手叉腰');
    expect(
      build().groups[0].athletes[0].dimensions.find((item) => item.key === 'vertical_jump')
        ?.achievedPercent
    ).toBeNull();
    db.exec('UPDATE test_sessions SET protocol_version=NULL');
    expect(
      build().groups[0].athletes[0].dimensions.find((item) => item.key === 'vertical_jump')
        ?.achievedPercent
    ).toBeNull();
    expect(physicalChampionPayloadSchema.safeParse(build()).success).toBe(true);
    db.exec("UPDATE test_sessions SET protocol='',protocol_version='v1'");
    expect(
      build().groups[0].athletes[0].dimensions.find((item) => item.key === 'vertical_jump')
        ?.achievedPercent
    ).toBeNull();
    db.exec(
      "UPDATE test_sessions SET protocol='CMJ双手叉腰',protocol_version='',context_key='indoor'; UPDATE radar_reference_values SET protocol_version=''"
    );
    expect(
      build().groups[0].athletes[0].dimensions.find((item) => item.key === 'vertical_jump')
        ?.achievedPercent
    ).toBeNull();
  });
});

it('同指标不同上下文参考共存时逐事实选择对应标准，不误判冲突', () => {
  const { db, measure, build } = setup();
  db.exec(
    "UPDATE radar_reference_values SET protocol_version='v1',test_context='indoor',side='left' WHERE metric_key='vertical_jump'"
  );
  const outdoor = duplicateReference(db, { test_context: 'outdoor', value_num: 100 });
  const session = measure(1, 'vertical_jump_cm', 60, 'cm', 'CMJ双手叉腰');
  db.prepare("UPDATE test_sessions SET protocol_version='v1',context_key='outdoor' WHERE id=?").run(
    session
  );
  db.prepare("UPDATE test_measurements SET side='left' WHERE test_session_id=?").run(session);
  const dimension = build().groups[0].athletes[0].dimensions.find(
    (item) => item.key === 'vertical_jump'
  )!;
  expect(dimension).toMatchObject({
    achievedPercent: 60,
    referenceId: outdoor,
    pendingReason: null,
  });
  expect(dimension.appliedReference).toMatchObject({
    protocolVersion: 'v1',
    testContext: 'outdoor',
    side: 'left',
  });
});

it.each(['synthetic_30d_current_v1', 'simulation_legacy'])(
  '历史模拟来源%s即使is_demo=0也不得作为实测评价',
  (source) => {
    const { measure, build } = setup();
    measure(1, 'vertical_jump_cm', 99, 'cm', 'CMJ双手叉腰', '2026-01-16', source);
    expect(build().measurements).toEqual([]);
    expect(
      build().groups[0].athletes[0].dimensions.find((item) => item.key === 'vertical_jump')
        ?.achievedPercent
    ).toBeNull();
  }
);

it('估算参考恢复完整维度展示性达成度、团队雷达与趋势，停用仍隔离', () => {
  const { db, measure, build } = setup();
  db.exec(
    "UPDATE radar_reference_values SET source_type='estimated',source_nature='estimated',review_status='draft'"
  );
  for (const dimension of PHYSICAL_CHAMPION_DIMENSIONS) {
    const session = measure(
      1,
      dimension.codes[0],
      50,
      dimension.measurementUnit,
      dimension.protocol
    );
    if (dimension.weightRelative)
      db.prepare(
        "INSERT INTO test_measurements(test_session_id,metric_code,value_num,unit,quality,is_demo,source) VALUES(?,'weight_kg',1,'kg','valid',0,'manual')"
      ).run(session);
  }
  const group = build().groups.find((item) => item.gender === '男')!;
  expect(group.athletes[0]).toMatchObject({ coverage: 8, scoringEligible: false });
  expect(group.athletes[0].score).not.toBeNull();
  expect(group.team.some((item) => item.achievedPercent !== null)).toBe(true);
  expect(group.trend.find((item) => item.athleteId === 1)).toMatchObject({
    scoringEligible: false,
  });
  db.exec("UPDATE radar_reference_values SET review_status='disabled'");
  expect(
    build().groups.every(
      (group) =>
        !group.references.length && group.modelDimensions?.every((item) => item.value === null)
    )
  ).toBe(true);
});
