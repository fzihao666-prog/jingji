import type { DatabaseSync } from 'node:sqlite';
import type { BasicSubmissionReport } from '../../shared/submission-report.ts';
import { projectLabel, type Project } from '../../shared/projects.ts';
import { beijingDate } from '../core/coach-daily-todos.ts';
import { isValidIsoDate } from '../core/date-utils.ts';

export type BasicReportTeam = { id: number; project: Project; name: string };

const PROFILE_COLUMNS = ['性别', '年龄', '身高（cm）', '体重（kg）', '训练年限', '最好成绩', '籍贯', '代表队伍', '学历', '训练项目', '伤病情况'];
const present = (value: unknown): value is string | number => typeof value === 'number' ? Number.isFinite(value) : typeof value === 'string' && Boolean(value.trim());
const cell = (value: unknown) => present(value) ? value : '';
const documentedText = (value: unknown) => present(value) && !/^(未设置|未知|待补充|未填写)$/.test(String(value).trim()) ? value : '';

function yearsSince(date: string | null, asOf: string) {
  if (!date || !isValidIsoDate(date) || date > asOf) return '';
  return Number(asOf.slice(0, 4)) - Number(date.slice(0, 4)) - Number(asOf.slice(5) < date.slice(5));
}

type RecordCount = { athleteId: number; count: number; latest: string };
type TrainingCount = RecordCount & { days: number };

function indexByAthlete<T extends RecordCount>(records: T[]) {
  return new Map(records.map(row => [row.athleteId, row]));
}

export function buildBasicSubmissionReport(db: DatabaseSync, team: BasicReportTeam): BasicSubmissionReport {
  const asOf = beijingDate(new Date());
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
  `).all(asOf, asOf, asOf, team.project, team.id, team.name) as Array<Record<string, string | number | null> & { id: number; name: string; birthDate: string | null; startDate: string | null }>;
  const ids = JSON.stringify(athletes.map(athlete => athlete.id));
  const tests = db.prepare(`
    WITH recorded AS (
      SELECT t.athlete_id AS athleteId, t.id AS sessionId, t.test_date AS date,
        (t.test_type='FMS测试' OR coalesce(m.source_ref, '') LIKE '功能筛查!%'
          OR m.metric_code GLOB 'fms_*' OR lower(m.metric_code) GLOB 'ybt_*'
          OR lower(m.metric_code)='ybt' OR upper(d.label) LIKE '%YBT%'
          OR d.label LIKE '%Y字平衡%' OR d.label LIKE '%Y形平衡%') AS screening
      FROM test_sessions t
      JOIN test_measurements m ON m.test_session_id=t.id
      JOIN metric_definitions d ON d.code=m.metric_code
      WHERE t.athlete_id IN (SELECT value FROM json_each(?)) AND t.project_code=?
        AND t.project_status='confirmed' AND t.test_date<=?
        AND t.is_demo=0 AND m.is_demo=0 AND t.quality IN ('valid','partial')
        AND m.quality IN ('valid','partial') AND m.value_num IS NOT NULL
      UNION ALL
      SELECT t.athlete_id, t.id, t.test_date, 1
      FROM test_sessions t
      WHERE t.athlete_id IN (SELECT value FROM json_each(?)) AND t.project_code=?
        AND t.project_status='confirmed' AND t.test_date<=?
        AND t.is_demo=0 AND t.quality IN ('valid','partial')
        AND EXISTS (SELECT 1 FROM fms_import_observations r WHERE r.test_session_id=t.id)
    )
    SELECT athleteId, screening, count(DISTINCT sessionId) AS count, max(date) AS latest
    FROM recorded GROUP BY athleteId, screening
  `).all(ids, team.project, asOf, ids, team.project, asOf) as (RecordCount & { screening: number })[];
  const physical = indexByAthlete(tests.filter(row => row.screening === 0));
  const screening = indexByAthlete(tests.filter(row => row.screening === 1));
  const training = indexByAthlete(db.prepare(`
    SELECT athlete_id AS athleteId, count(*) AS count,
      count(DISTINCT session_date) AS days, max(session_date) AS latest
    FROM training_sessions
    WHERE athlete_id IN (SELECT value FROM json_each(?)) AND project_code=?
      AND project_status='confirmed' AND session_date<=?
      AND is_demo=0 AND quality IN ('valid','partial')
    GROUP BY athlete_id
  `).all(ids, team.project, asOf) as TrainingCount[]);

  const sheets: BasicSubmissionReport['sheets'] = [];
  function sheet(name: string, columns: string[]) {
    const rows: (string | number)[][] = [columns];
    sheets.push({ name, rows });
    return rows;
  }
  const summary = sheet('队伍汇总', ['项目', '队伍', '在册人数', '统计截至']);
  summary.push([projectLabel(team.project), team.name, athletes.length, asOf]);
  const totals = sheet('填报汇总', ['填报类别', '已填写人数', '部分填写人数', '未填写人数']);
  const identity = ['运动员编号', '姓名', '填写情况'];
  const profiles = sheet('运动员档案', [...identity, '待补字段', ...PROFILE_COLUMNS]);
  const physicalRows = sheet('体能与专项测试', [...identity, '测试场次', '最近测试日期']);
  const screeningRows = sheet('功能筛查', [...identity, '筛查场次', '最近筛查日期']);
  const trainingRows = sheet('每日训练', [...identity, '训练课次', '有记录天数', '最近训练日期']);
  let completeProfiles = 0;
  let partialProfiles = 0;
  for (const athlete of athletes) {
    const values = [documentedText(athlete.gender), yearsSince(athlete.birthDate, asOf), cell(athlete.height), cell(athlete.weight),
      cell(athlete.trainingYears) === '' ? yearsSince(athlete.startDate, asOf) : cell(athlete.trainingYears),
      documentedText(athlete.bestResult), documentedText(athlete.nativePlace), documentedText(athlete.representativeUnit), documentedText(athlete.education),
      documentedText(athlete.eventItem), documentedText(athlete.injury)];
    const missing = PROFILE_COLUMNS.filter((_, index) => values[index] === '');
    const status = missing.length === 0 ? '已填写' : missing.length === values.length ? '未填写' : '部分填写';
    if (status === '已填写') completeProfiles++;
    if (status === '部分填写') partialProfiles++;
    const person = [athlete.id, athlete.name];
    profiles.push([...person, status, missing.join('、'), ...values]);
    const test = physical.get(athlete.id);
    const screen = screening.get(athlete.id);
    const daily = training.get(athlete.id);
    physicalRows.push([...person, test ? '已填写' : '未填写', test?.count ?? 0, test?.latest ?? '']);
    screeningRows.push([...person, screen ? '已填写' : '未填写', screen?.count ?? 0, screen?.latest ?? '']);
    trainingRows.push([...person, daily ? '已填写' : '未填写', daily?.count ?? 0, daily?.days ?? 0, daily?.latest ?? '']);
  }
  totals.push(
    ['运动员档案', completeProfiles, partialProfiles, athletes.length - completeProfiles - partialProfiles],
    ['体能与专项测试', physical.size, 0, athletes.length - physical.size],
    ['功能筛查', screening.size, 0, athletes.length - screening.size],
    ['每日训练', training.size, 0, athletes.length - training.size],
  );
  const notes = sheet('统计说明', ['检查项目', '统计口径']);
  notes.push(
    ['范围', '当前队伍在册运动员及截至导出日的正式记录。'],
    ['运动员档案', '按表内字段检查。实际填报值及可由正式记录计算的年龄、训练年限计入已填。'],
    ['体能与专项测试', '至少有一场包含有效或部分有效成绩的体能或专项测试即计为已填写。'],
    ['功能筛查', '至少有一场包含 FMS、YBT 等功能筛查成绩或 FMS 原始观察的记录即计为已填写。'],
    ['每日训练', '至少有一条有效或部分有效的实际训练课次即计为已填写。多课次按实际课次与去重日期分别统计。'],
  );
  return { asOf, team: team.name, sheets };
}
