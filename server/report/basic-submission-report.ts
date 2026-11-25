import type { DatabaseSync } from 'node:sqlite';
import type { BasicSubmissionReport } from '../../shared/submission-report.ts';
import { FMS_TEMPLATE_METRICS } from '../../shared/data-import-template.ts';
import { projectLabel } from '../../shared/projects.ts';
import { inferStrengthContentAnalysisCategory } from '../../shared/strength-training.ts';
import { trainingContentCategory } from '../../shared/training-content-category.ts';
import { beijingDate } from '../core/coach-daily-todos.ts';
import { isValidIsoDate } from '../core/date-utils.ts';
import { readTeamPlans } from '../training-plan/team-plan-service.ts';
import { buildSubmissionReport, type SubmissionReportInput } from './submission-report-build.ts';

const PROFILE_COLUMNS = ['姓名', '性别', '年龄', '身高（cm）', '体重（kg）', '训练年限', '最好成绩', '籍贯', '代表队伍', '学历', '训练项目', '伤病情况'];
const TEST_COLUMNS = ['最大力量', '核心能力', '爆发力', '耐力', 'FMS', 'YBT', '专项测功仪'];
const fmsCodes = new Set<string>(FMS_TEMPLATE_METRICS.map(([, code]) => code));
const maximumStrength = new Set(['squat_kg', 'deadlift_kg', 'hip_thrust_kg', 'bench_press_kg', 'bench_pull_kg', 'clean_kg']);
const strengthCategories = new Set(['力量训练', '力量耐力', '最大力量', '速度力量']);
const present = (value: unknown): value is string | number => typeof value === 'number' ? Number.isFinite(value) : typeof value === 'string' && Boolean(value.trim());
const cell = (value: unknown) => present(value) ? value : '';
const documentedText = (value: unknown) => present(value) && !/^(未设置|未知|待补充|未填写)$/.test(String(value).trim()) ? value : '';

function yearsSince(date: string | null, asOf: string) {
  if (!date || !isValidIsoDate(date) || date > asOf) return '';
  return Number(asOf.slice(0, 4)) - Number(date.slice(0, 4)) - Number(asOf.slice(5) < date.slice(5));
}

type Measurement = { id: number; sessionId: number; athleteId: number; date: string; code: string; label: string; domain: string; value: number; unit: string; protocol: string };
function testGroups(row: Measurement) {
  const groups: string[] = [];
  if (maximumStrength.has(row.code) || (row.domain === 'strength' && /1\s*RM/i.test(row.protocol))) groups.push('最大力量');
  if (row.domain === 'core') groups.push('核心能力');
  if (row.domain === 'explosive' || ['cmj_peak_power_w', 'vertical_jump_cm'].includes(row.code)) groups.push('爆发力');
  if (row.domain === 'endurance' || row.code === 'vo2max_ml_kg_min') groups.push('耐力');
  if (fmsCodes.has(row.code)) groups.push('FMS');
  if (/^ybt(?:_|$)/i.test(row.code) || /\bYBT\b|Y[字形]?平衡|Y[ -]?Balance/i.test(row.label)) groups.push('YBT');
  if (/(^|_)erg(?:ometer)?(_|$)|测功仪/.test(row.code) || /测功仪/.test(row.label)) groups.push('专项测功仪');
  return groups;
}

export function buildBasicSubmissionReport(db: DatabaseSync, input: SubmissionReportInput): BasicSubmissionReport {
  const asOf = beijingDate(new Date());
  const scope = buildSubmissionReport(db, input);
  const sheets: BasicSubmissionReport['sheets'] = [];
  function sheet(name: string, columns: string[]) {
    const rows: (string | number)[][] = [columns];
    sheets.push({ name, rows });
    return rows;
  }
  const summary = sheet('队伍填报汇总', ['项目', '队伍', '体能教练', '在册人数', ...PROFILE_COLUMNS.map(label => `${label}已填人数`),
    ...TEST_COLUMNS.map(label => `${label}已填人数`), 'FMS完整人数', '体能安排课次', '实际训练次数', '记录时长的课次', '实测总时长（分钟）', '力量训练动作数', '核心功能训练课次', '队伍训练统计条数']);
  const profiles = sheet('运动员基本信息', ['项目', '队伍', ...PROFILE_COLUMNS, '待补信息']);
  const checks = sheet('运动员测试检查', ['项目', '队伍', '姓名', ...TEST_COLUMNS, '待补测试']);
  const details = sheet('测试成绩明细', ['项目', '队伍', '姓名', '测试类别', '指标', '日期', '成绩', '单位', '协议']);
  const plans = sheet('力量和体能训练安排', ['项目', '队伍', '日期', '安排内容', '动作或内容项', '计划时长（分钟）']);
  const training = sheet('运动员训练统计', ['项目', '队伍', '姓名', '训练次数', '有时长的课次', '实测时长（分钟）', '训练动作', '核心功能训练次数']);
  const teamStats = sheet('队伍训练统计', ['项目', '队伍', '日期', '训练分项', '数值', '单位']);
  const submitters = sheet('体能教练提交记录', ['项目', '队伍', '体能教练', '可核实的首次提交记录数', '最近首次提交（北京时间）']);
  const instructions = sheet('统计说明', ['检查项目', '统计口径']);
  instructions.push(
    ['统计日期', asOf],
    ['范围', '当前账号授权队伍内的在册运动员；统计截至导出日期的正式记录。'],
    ['代表队伍', '优先使用档案填报的代表单位，未填时显示当前所属队伍。'],
    ['缺项', '空白是未录或无可用记录，真实0保留。伤病没有正式记录时不判定健康。'],
    ['测试', '已填表示该类别至少一项正式成绩。FMS有原始排查结果也算已提交，完整要求最新一场七项最终分齐备。YBT没有识别到正式成绩时显示未录。'],
    ['训练', '实际课次和已发布队伍安排分别统计。时长只统计明确填报的整课时长；核心功能训练沿用内容和组次分类。'],
    ['教练', '汇总按当前队伍责任查看；个人提交数仅统计有系统首次提交凭据的记录，不按队伍归属推断个人提交。'],
  );
  const coachById = new Map(scope.coaches.filter(coach => coach.roles.includes('体能教练')).map(coach => [coach.id, coach.name]));
  const firstByRecord = new Map((db.prepare(`SELECT entity || ':' || entity_id AS reference,user_id AS userId,
    datetime(submitted_at,'+8 hours') AS submittedAt FROM submission_provenance
    WHERE user_id IN (SELECT value FROM json_each(?))`).all(JSON.stringify([...coachById.keys()])) as
    { reference: string; userId: number; submittedAt: string }[]).map(row => [row.reference, row]));
  const coachTotals = new Map<string, { count: number; date: string }>();
  const activeIds = new Set((db.prepare('SELECT id FROM athletes WHERE active=1').all() as { id: number }[]).map(row => row.id));
  for (const [teamIndex, , date, reference, athleteId] of scope.records) {
    const proof = firstByRecord.get(reference);
    if (!proof || (athleteId && !activeIds.has(athleteId)) || date > asOf || !scope.teams[teamIndex].coaches.includes(proof.userId)) continue;
    const key = JSON.stringify([teamIndex, proof.userId]);
    const total = coachTotals.get(key) ?? { count: 0, date: '' };
    total.count++;
    if (proof.submittedAt > total.date) total.date = proof.submittedAt;
    coachTotals.set(key, total);
  }

  for (const [teamIndex, team] of scope.teams.entries()) {
    const registered = db.prepare('SELECT id FROM project_teams WHERE project=? AND name=? AND active=1').get(team.project, team.name);
    if (!registered) continue;
    const title = [projectLabel(team.project), team.name];
    const athletes = db.prepare(`
      SELECT a.id,a.name,a.gender,a.birth_date AS birthDate,p.education,p.native_place AS nativePlace,
        p.training_years AS trainingYears,p.start_sport_date AS startDate,p.best_result AS bestResult,p.event_item AS eventItem,p.representative_unit AS representativeUnit,
        (SELECT height_cm FROM athlete_body_measurements b WHERE b.athlete_id=a.id AND b.measurement_date<=? AND b.height_cm IS NOT NULL
          AND b.is_demo=0 AND b.quality IN ('valid','partial') ORDER BY b.measurement_date DESC,b.id DESC LIMIT 1) AS height,
        (SELECT weight_kg FROM athlete_body_measurements b WHERE b.athlete_id=a.id AND b.measurement_date<=? AND b.weight_kg IS NOT NULL
          AND b.is_demo=0 AND b.quality IN ('valid','partial') ORDER BY b.measurement_date DESC,b.id DESC LIMIT 1) AS weight,
        (SELECT i.injury_name || '（' || CASE i.status WHEN 'healthy' THEN '健康' WHEN 'observation' THEN '观察'
          WHEN 'restricted' THEN '受限' WHEN 'rehab' THEN '康复中' WHEN 'suspended' THEN '暂停训练' ELSE i.status END || '）'
          FROM injury_records i WHERE i.athlete_id=a.id AND i.record_type='formal' AND i.onset_date<=?
          ORDER BY i.onset_date DESC,i.id DESC LIMIT 1) AS injury
      FROM athletes a LEFT JOIN athlete_profiles p ON p.athlete_id=a.id
      WHERE a.active=1 AND a.project=? AND (a.team_id=? OR (a.team_id IS NULL AND a.team=?)) ORDER BY a.name,a.id
    `).all(asOf, asOf, asOf, team.project, registered.id, team.name) as Array<Record<string, string | number | null> & { id: number; name: string; birthDate: string | null; startDate: string | null }>;
    const ids = JSON.stringify(athletes.map(athlete => athlete.id));
    const records = db.prepare(`
      SELECT m.id,t.id AS sessionId,t.athlete_id AS athleteId,t.test_date AS date,m.metric_code AS code,
        d.label,d.domain,m.value_num AS value,m.unit,t.protocol
      FROM test_measurements m JOIN test_sessions t ON t.id=m.test_session_id JOIN metric_definitions d ON d.code=m.metric_code
      WHERE t.athlete_id IN (SELECT value FROM json_each(?)) AND t.project_code=? AND t.project_status='confirmed'
        AND t.test_date<=? AND t.is_demo=0 AND m.is_demo=0 AND t.quality IN ('valid','partial') AND m.quality IN ('valid','partial')
        AND (m.metric_code NOT LIKE 'fms_%' OR m.side='center')
      ORDER BY t.test_date DESC,t.id DESC,m.id DESC
    `).all(ids, team.project, asOf) as Measurement[];
    const byAthlete = new Map<number, Map<string, Measurement[]>>();
    for (const record of records) {
      const categories = testGroups(record);
      if (!categories.length) categories.push('其他测试');
      const groups = byAthlete.get(record.athleteId) ?? new Map<string, Measurement[]>();
      for (const category of categories) {
        const observations = groups.get(category) ?? [];
        observations.push(record);
        groups.set(category, observations);
      }
      byAthlete.set(record.athleteId, groups);
    }
    const fmsLatest = new Map<number, { sessionId: number; date: string }>();
    const screens = db.prepare(`
      SELECT t.id AS sessionId,t.athlete_id AS athleteId,t.test_date AS date
      FROM test_sessions t WHERE t.athlete_id IN (SELECT value FROM json_each(?))
        AND t.project_code=? AND t.project_status='confirmed' AND t.test_type='FMS测试' AND t.test_date<=?
        AND t.is_demo=0 AND t.quality IN ('valid','partial') AND (
          EXISTS(SELECT 1 FROM fms_import_observations r WHERE r.test_session_id=t.id)
          OR EXISTS(SELECT 1 FROM test_measurements m WHERE m.test_session_id=t.id AND m.side='center'
            AND m.is_demo=0 AND m.quality IN ('valid','partial'))
        ) ORDER BY t.test_date DESC,t.id DESC
    `).all(ids, team.project, asOf) as { sessionId: number; athleteId: number; date: string }[];
    for (const screen of screens) if (!fmsLatest.has(screen.athleteId)) fmsLatest.set(screen.athleteId, screen);
    const sessions = db.prepare(`
      SELECT t.id,t.athlete_id AS athleteId,t.duration_min AS duration,t.duration_reported AS reported,t.training_type AS trainingType,
        t.structure_type AS structureType,t.activity_code AS activityCode,t.content,
        (SELECT group_concat(DISTINCT s.exercise_name) FROM strength_result_sets s WHERE s.training_session_id=t.id AND s.completed=1) AS exercises,
        EXISTS(SELECT 1 FROM strength_result_sets s WHERE s.training_session_id=t.id AND s.completed=1 AND s.training_category IN ('核心力量','功能训练')) AS core
      FROM training_sessions t WHERE athlete_id IN (SELECT value FROM json_each(?)) AND project_code=? AND project_status='confirmed'
        AND session_date<=? AND is_demo=0 AND quality IN ('valid','partial')
    `).all(ids, team.project, asOf) as { id: number; athleteId: number; duration: number; reported: number; trainingType: string; structureType: string; activityCode: string; content: string; exercises: string | null; core: number }[];
    const sessionsByAthlete = new Map<number, typeof sessions>();
    for (const session of sessions) {
      const rows = sessionsByAthlete.get(session.athleteId) ?? [];
      rows.push(session);
      sessionsByAthlete.set(session.athleteId, rows);
    }
    const profileCounts = PROFILE_COLUMNS.map(() => 0);
    const testCounts = TEST_COLUMNS.map(() => 0);
    const allActions = new Set<string>();
    let fmsComplete = 0;
    let duration = 0;
    let timed = 0;
    let functional = 0;
    for (const athlete of athletes) {
      const values = [athlete.name, cell(athlete.gender), yearsSince(athlete.birthDate, asOf), cell(athlete.height), cell(athlete.weight),
        cell(athlete.trainingYears) === '' ? yearsSince(athlete.startDate, asOf) : cell(athlete.trainingYears),
        documentedText(athlete.bestResult), documentedText(athlete.nativePlace), documentedText(athlete.representativeUnit) || team.name, documentedText(athlete.education),
        documentedText(athlete.eventItem) || title[0], documentedText(athlete.injury)];
      const missing = PROFILE_COLUMNS.filter((_, index) => {
        if (!present(values[index])) return true;
        profileCounts[index]++;
        return false;
      });
      profiles.push([...title, ...values, missing.join('、')]);
      const groups = byAthlete.get(athlete.id);
      const missingTests: string[] = [];
      const testStatuses = TEST_COLUMNS.map((category, index) => {
        const rows = groups?.get(category);
        const screen = category === 'FMS' ? fmsLatest.get(athlete.id) : undefined;
        if (screen) {
          testCounts[index]++;
          const count = new Set(rows?.filter(row => row.sessionId === screen.sessionId).map(row => row.code)).size;
          if (count === fmsCodes.size) fmsComplete++;
          else missingTests.push('FMS待补');
          return `${screen.date} · ${count}/7项`;
        }
        if (!rows?.length) {
          missingTests.push(category);
          return '未录';
        }
        testCounts[index]++;
        return `${rows[0].date} · ${new Set(rows.map(row => row.code)).size}项`;
      });
      checks.push([...title, athlete.name, ...testStatuses, missingTests.join('、')]);
      for (const [category, rows] of groups ?? []) {
        const latest = new Set<string>();
        for (const row of rows) {
          const key = JSON.stringify([row.code, row.unit, row.protocol]);
          if (latest.has(key)) continue;
          latest.add(key);
          details.push([...title, athlete.name, category, row.label, row.date, row.value, row.unit, row.protocol]);
        }
      }
      const completed = sessionsByAthlete.get(athlete.id) ?? [];
      const actions = new Set(completed.flatMap(row => row.exercises?.split(',').filter(Boolean) ?? []));
      actions.forEach(action => allActions.add(action));
      const withDuration = completed.filter(row => row.reported);
      const total = withDuration.reduce((sum, row) => sum + row.duration, 0);
      const core = completed.filter(row => {
        const category = inferStrengthContentAnalysisCategory({ ...row, sessionLabel: row.content });
        return row.core || category === '核心力量' || category === '功能训练' || trainingContentCategory(row) === '功能';
      }).length;
      timed += withDuration.length;
      duration += total;
      functional += core;
      training.push([...title, athlete.name, completed.length, withDuration.length, withDuration.length ? total : '',
        [...actions].join('、'), core]);
    }
    let scheduled = 0;
    for (const plan of readTeamPlans(db, Number(registered.id))) {
      if (plan.status !== 'published') continue;
      for (const session of plan.data.sessions) {
        if (session.category !== 'physical') continue;
        const items = (session.items ?? []).map(item => item.title).filter(Boolean);
        const category = trainingContentCategory({ activityCode: session.activityCode, content: session.content });
        const strength = inferStrengthContentAnalysisCategory({ sessionLabel: [session.content, ...items].join(' ') });
        if (!strengthCategories.has(category) && category !== '功能' && !strength) continue;
        plans.push([...title, session.date, session.content, items.join('、'), cell(session.durationMin)]);
        scheduled++;
      }
    }
    const stats = db.prepare(`SELECT training_date AS date,category,value,unit FROM team_training_day_values
      WHERE team_id=? AND project_code=? AND training_date<=? ORDER BY training_date DESC,category`)
      .all(registered.id, team.project, asOf) as { date: string; category: string; value: number; unit: string }[];
    for (const row of stats) teamStats.push([...title, row.date, row.category, row.value, row.unit]);
    const coaches = team.coaches.filter(id => coachById.has(id));
    for (const id of coaches) {
      const total = coachTotals.get(JSON.stringify([teamIndex, id]));
      submitters.push([...title, coachById.get(id)!, total?.count ?? 0, total?.date ?? '']);
    }
    summary.push([...title, coaches.map(id => coachById.get(id)).join('、'), athletes.length,
      ...profileCounts, ...testCounts, fmsComplete, scheduled, sessions.length, timed, timed ? duration : '', allActions.size, functional, stats.length]);
  }
  return { asOf, sheets };
}
