import type { DatabaseSync } from 'node:sqlite';
import { isCoachCategory } from '../../shared/coach-categories.ts';
import {
  UNASSIGNED_SUBMISSION_ROLE,
  type SubmissionDetail,
  type SubmissionReport,
  type SubmissionSummary,
} from '../../shared/submission-report.ts';

type Fact = {
  id: number;
  entity: string;
  athleteId: number;
  type: string;
  role: string;
  businessDate: string | null;
  actor: number | null;
  submittedAt: string | null;
  project: string | null;
  team?: string;
  evidenceKey?: string;
};

type Person = { id: number; name: string; roles: string[]; teams: string[] };
type Athlete = { id: number; name: string; team: string };
type Evidence = { actor: number; at: string };

const fitness = '体能教练';
const rehab = '康复治疗师';
const unknown = UNASSIGNED_SUBMISSION_ROLE;

// 以正式业务记录为主表，导入明细和日志只提供归属证据。
const factSources = [
  `SELECT id,'training_session',athlete_id,
    CASE WHEN training_type='专项训练' THEN '专项训练' ELSE '训练课次' END,
    CASE WHEN training_type='专项训练' THEN '' ELSE '${fitness}' END,
    session_date,created_by,NULL,project_code FROM training_sessions WHERE is_demo=0`,
  `SELECT s.id,'strength_result_set',t.athlete_id,'力量训练组次','${fitness}',
    t.session_date,s.created_by,NULL,t.project_code FROM strength_result_sets s
    JOIN training_sessions t ON t.id=s.training_session_id WHERE t.is_demo=0`,
  `SELECT id,'daily_wellness',athlete_id,'日常监测','',wellness_date,NULL,NULL,NULL
    FROM daily_wellness WHERE is_demo=0`,
  `SELECT m.id,'test_measurement',t.athlete_id,t.test_type,
    CASE WHEN t.test_type IN ('体能测试','FMS测试','力量素质测试') OR substr(m.metric_code,1,4)='fms_'
      THEN '${fitness}' ELSE '' END,
    t.test_date,CASE WHEN m.source='file_import' THEN NULL ELSE t.created_by END,m.created_at,t.project_code FROM test_measurements m
    JOIN test_sessions t ON t.id=m.test_session_id WHERE m.is_demo=0 AND t.is_demo=0`,
  `SELECT id,'athlete_body_measurement',athlete_id,'身体测量','${fitness}',measurement_date,NULL,created_at,NULL
    FROM athlete_body_measurements WHERE is_demo=0`,
  `SELECT id,'competitive_state_assessment',athlete_id,'竞技评估','',assessment_date,NULL,created_at,NULL
    FROM competitive_state_assessments WHERE is_demo=0`,
  `SELECT id,'injury_record',athlete_id,'康复伤病','${rehab}',onset_date,created_by,created_at,NULL
    FROM injury_records WHERE record_type='formal'`,
  `SELECT id,'athlete',id,'运动员档案','',NULL,NULL,NULL,project FROM athletes`,
  `SELECT r.id,'enode_record',r.athlete_id,'Enode采集','${fitness}',substr(r.recorded_at,1,10),
    f.created_by,f.created_at,r.project_code FROM enode_records r JOIN enode_import_files f ON f.id=r.file_id`,
];

export function collectSubmissionFacts(
  db: DatabaseSync,
  project: string,
  athletes: Athlete[],
  teams: string[],
  allTeams: boolean
) {
  const ids = JSON.stringify(athletes.map(({ id }) => id));
  const facts = db
    .prepare(
      `
    WITH facts(id,entity,athleteId,type,role,businessDate,actor,submittedAt,project) AS (
      ${factSources.join(' UNION ALL ')}
    )
    SELECT * FROM facts WHERE (project IS NULL OR project='' OR project=?)
      AND athleteId IN (SELECT value FROM json_each(?))
  `
    )
    .all(project, ids) as Fact[];
  const teamFacts = db
    .prepare(
      `
    SELECT d.team_id AS id,'team_training_day_value:' || json_array(d.project_code,d.training_date,d.category,d.unit) AS entity,
      0 AS athleteId,'队伍训练统计' AS type,
      '' AS role,d.training_date AS businessDate,NULL AS actor,NULL AS submittedAt,
      d.project_code AS project,t.name AS team
    FROM team_training_day_values d JOIN project_teams t ON t.id=d.team_id AND t.project=d.project_code
    WHERE d.project_code=? AND t.name IN (SELECT value FROM json_each(?))
  `
    )
    .all(project, JSON.stringify(teams)) as Fact[];
  const special = db
    .prepare(
      `
    SELECT r.id,'special_test_result' AS entity,e.test_date AS businessDate,r.created_at AS submittedAt,
      NULL AS actor,e.id AS eventId,r.crew_name AS crew,CASE WHEN json_valid(r.member_athlete_ids) THEN r.member_athlete_ids ELSE '[]' END AS memberIds
    FROM special_test_results r JOIN special_test_events e ON e.id=r.event_id WHERE e.project=?
  `
    )
    .all(project) as Array<
    Pick<Fact, 'id' | 'entity' | 'businessDate' | 'submittedAt' | 'actor'> & {
      memberIds: string;
      eventId: number;
      crew: string;
    }
  >;
  const athleteMap = new Map(athletes.map((athlete) => [athlete.id, athlete]));
  for (const { memberIds, eventId, crew, ...fact } of special) {
    const parsed: unknown = JSON.parse(memberIds);
    const members = Array.isArray(parsed) ? parsed.map(Number) : [];
    if (!allTeams && (!members.length || !members.every((id) => athleteMap.has(id)))) continue;
    const memberTeams = new Set(members.map((id) => athleteMap.get(id)?.team));
    facts.push({
      ...fact,
      athleteId: members.length === 1 ? Number(members[0]) : 0,
      team: memberTeams.size === 1 ? ([...memberTeams][0] ?? '') : '',
      evidenceKey: `special_test_result:${crew}:${eventId}`,
      type: '专项测试成绩',
      role: '',
      project,
    });
  }
  return [...facts, ...teamFacts].sort(
    (a, b) =>
      (b.businessDate ?? '').localeCompare(a.businessDate ?? '') ||
      a.entity.localeCompare(b.entity) ||
      b.id - a.id
  );
}

export function readSubmissionEvidence(db: DatabaseSync, project: string) {
  const evidence = new Map<string, Evidence & { original?: boolean }>();
  const originals = db
    .prepare(
      `SELECT entity,entity_id AS id,user_id AS actor,submitted_at AS at
    FROM submission_provenance`
    )
    .all() as Array<Evidence & { entity: string; id: number }>;
  for (const row of originals) evidence.set(`${row.entity}:${row.id}`, { ...row, original: true });
  const rows = db
    .prepare(
      `
    SELECT i.committed_entity_type AS entity,i.committed_entity_id AS id,
      b.created_by AS actor,b.committed_at AS at
    FROM data_import_items i JOIN data_import_batches b ON b.id=i.batch_id
    WHERE b.project=? AND b.status='committed' AND b.committed_at IS NOT NULL
      AND i.committed_entity_id IS NOT NULL
      AND json_valid(i.conflict_json)
      AND CASE WHEN json_valid(i.conflict_json) THEN json_extract(i.conflict_json,'$.exists')=0 ELSE 0 END
    ORDER BY b.committed_at,b.rowid,i.id
  `
    )
    .all(project) as Array<Evidence & { entity: string; id: number }>;
  for (const row of rows) {
    const key = `${row.entity}:${row.id}`;
    if (!evidence.has(key)) evidence.set(key, row);
  }
  const audit = db
    .prepare(
      `
    SELECT entity_type AS entity,entity_id AS id,user_id AS actor,created_at AS at,
      CASE WHEN action='CREATE_COACH_WELLNESS' AND json_valid(detail)
        THEN json_extract(detail,'$.date') END AS businessDate,
      CASE WHEN action='CREATE_SPECIAL_TEST_RESULT' AND json_valid(detail)
        THEN json_extract(detail,'$.crewName') END AS crew
    FROM audit_logs WHERE action IN ('CREATE_COACH_TRAINING_SESSION','CREATE_COACH_WELLNESS','CREATE_SPECIAL_TEST_RESULT')
    ORDER BY created_at,id
  `
    )
    .all() as Array<
    Evidence & { entity: string; id: number; businessDate: string | null; crew: string | null }
  >;
  for (const row of audit) {
    const key = row.businessDate
      ? `daily_wellness:${row.id}:${row.businessDate}`
      : row.crew
        ? `special_test_result:${row.crew}:${row.id}`
        : `${row.entity}:${row.id}`;
    const prior = evidence.get(key);
    if (!prior || (!prior.original && row.at < prior.at)) evidence.set(key, row);
  }
  return evidence;
}

type Filters = {
  team?: string;
  roles?: string[];
  from?: string;
  to?: string;
  key?: string;
  page?: number;
};

const groupKey = (team: string, role: string) => JSON.stringify([team, role]);
const personKey = (team: string, role: string, id: number) => JSON.stringify([team, role, id]);
const increment = (counts: Record<string, number>, type: string) => {
  counts[type] = (counts[type] ?? 0) + 1;
};
const days = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Asia/Shanghai',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

function submissionDate(value: string | null) {
  if (!value) return '';
  const date = new Date(value.replace(' ', 'T') + (value.length === 19 ? 'Z' : ''));
  return Number.isNaN(date.valueOf()) ? '' : days.format(date);
}

export function summarizeSubmissions(input: {
  facts: Fact[];
  athletes: Athlete[];
  people: Person[];
  operators: Map<number, { name: string; role: string }>;
  evidence: Map<string, Evidence & { original?: boolean }>;
  filters: Filters;
  exporting?: boolean;
}): SubmissionReport {
  const { facts, athletes, people, operators, evidence, filters, exporting } = input;
  const athleteMap = new Map(athletes.map((athlete) => [athlete.id, athlete]));
  const personMap = new Map(people.map((person) => [person.id, person]));
  const teams = [...new Set(athletes.map(({ team }) => team))].sort();
  const rows = new Map<string, SubmissionSummary>();
  const types: Record<string, number> = Object.create(null);
  const details: SubmissionDetail[] = [];
  let total = 0;
  let detailTotal = 0;
  const addRow = (team: string, role: string, person?: Person) => {
    const key = person ? personKey(team, role, person.id) : groupKey(team, role);
    if (!rows.has(key))
      rows.set(key, {
        key,
        team,
        role,
        name: person?.name ?? role,
        group: !person,
        direct: 0,
        delegated: 0,
        unknown: 0,
        total: 0,
        types: Object.create(null),
      });
    return rows.get(key)!;
  };
  for (const person of people) {
    for (const team of person.teams) {
      if (filters.team && filters.team !== team) continue;
      for (const role of person.roles) {
        addRow(team, role);
        addRow(team, role, person);
      }
    }
  }
  for (const fact of facts) {
    const athlete =
      athleteMap.get(fact.athleteId) ??
      (fact.team !== undefined ? { team: fact.team, name: '' } : undefined);
    if (!athlete || (filters.team && filters.team !== athlete.team)) continue;
    const id = `${fact.entity}:${fact.id}`;
    const source =
      evidence.get(fact.evidenceKey ?? id) ??
      (fact.entity === 'daily_wellness'
        ? evidence.get(`daily_wellness:${fact.athleteId}:${fact.businessDate}`)
        : undefined);
    const original =
      source &&
      (source.original ||
        !fact.submittedAt ||
        source.at.slice(0, 19) <= fact.submittedAt.slice(0, 19))
        ? source
        : undefined;
    const actor = original?.actor ?? fact.actor;
    const date = submissionDate(original?.at ?? fact.submittedAt);
    if (
      (filters.from || filters.to) &&
      (!date || (filters.from && date < filters.from) || (filters.to && date > filters.to))
    )
      continue;
    total++;
    increment(types, fact.type);
    const person = actor === null ? undefined : personMap.get(actor);
    const operator = actor === null ? undefined : operators.get(actor);
    const role = person
      ? person.roles.includes(fact.role)
        ? fact.role
        : (person.roles[0] ?? unknown)
      : fact.role || unknown;
    const group = addRow(athlete.team, role);
    const personal = person ? addRow(athlete.team, role, person) : undefined;
    const field = personal
      ? 'direct'
      : operator && ['REG', 'TD', 'DMD'].includes(operator.role)
        ? 'delegated'
        : 'unknown';
    for (const row of personal ? [group, personal] : [group]) {
      row[field]++;
      row.total++;
      increment(row.types, fact.type);
    }
    const key = personal?.key ?? group.key;
    if (filters.roles?.length && !filters.roles.includes(role)) continue;
    if (!exporting && (!filters.key || (filters.key !== key && filters.key !== group.key)))
      continue;
    const index = detailTotal++;
    const offset = ((filters.page ?? 1) - 1) * 50;
    if (!exporting && (index < offset || index >= offset + 50)) continue;
    details.push({
      id,
      key,
      groupKey: group.key,
      team: athlete.team,
      role,
      name: personal?.name ?? '',
      type: fact.type,
      athlete: athlete.name,
      businessDate: fact.businessDate ?? '',
      submittedDate: date,
      operator: operator?.name ?? '',
      basis: personal
        ? '提交账号'
        : field === 'delegated' && isCoachCategory(role)
          ? '管理员代导入，个人来源未记录'
          : '归属待确认',
    });
  }
  const visible = [...rows.values()].filter(
    (row) => !filters.roles?.length || filters.roles.includes(row.role)
  );
  visible.sort(
    (a, b) =>
      a.team.localeCompare(b.team, 'zh-CN') ||
      a.role.localeCompare(b.role, 'zh-CN') ||
      Number(b.group) - Number(a.group) ||
      a.name.localeCompare(b.name, 'zh-CN')
  );
  return { rows: visible, total, types, details, detailTotal, teams };
}
