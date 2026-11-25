import type { DatabaseSync } from 'node:sqlite';

type Fact = {
  id: number;
  entity: string;
  athleteId: number;
  type: string;
  businessDate: string | null;
  team?: string;
};

type Athlete = { id: number; team: string };

// 每条正式记录只读取一次，个人记录统一使用运动员当前的队伍。
const factSources = [
  `SELECT id,'training_session',athlete_id,
    CASE WHEN training_type='专项训练' THEN '专项训练' ELSE '训练课次' END,
    session_date,project_code FROM training_sessions WHERE is_demo=0`,
  `SELECT s.id,'strength_result_set',t.athlete_id,'力量训练组次',t.session_date,t.project_code
    FROM strength_result_sets s JOIN training_sessions t ON t.id=s.training_session_id WHERE t.is_demo=0`,
  `SELECT id,'daily_wellness',athlete_id,'日常监测',wellness_date,NULL FROM daily_wellness WHERE is_demo=0`,
  `SELECT m.id,'test_measurement',t.athlete_id,t.test_type,t.test_date,t.project_code FROM test_measurements m
    JOIN test_sessions t ON t.id=m.test_session_id WHERE m.is_demo=0 AND t.is_demo=0`,
  `SELECT id,'athlete_body_measurement',athlete_id,'身体测量',measurement_date,NULL
    FROM athlete_body_measurements WHERE is_demo=0`,
  `SELECT id,'competitive_state_assessment',athlete_id,'竞技评估',assessment_date,NULL
    FROM competitive_state_assessments WHERE is_demo=0`,
  `SELECT id,'injury_record',athlete_id,'康复伤病',onset_date,NULL FROM injury_records WHERE record_type='formal'`,
  `SELECT id,'athlete',id,'运动员档案',NULL,project FROM athletes`,
  `SELECT id,'enode_record',athlete_id,'Enode采集',substr(recorded_at,1,10),project_code FROM enode_records`,
];

export function* collectSubmissionFacts(
  db: DatabaseSync,
  project: string,
  athletes: Athlete[],
  teams: string[],
  canSeeUnassigned: boolean
): Generator<Fact> {
  const ids = JSON.stringify(athletes.map(({ id }) => id));
  yield* db
    .prepare(
      `
    WITH facts(id,entity,athleteId,type,businessDate,project) AS (${factSources.join(' UNION ALL ')})
    SELECT id,entity,athleteId,type,businessDate FROM facts
    WHERE (project IS NULL OR project='' OR project=?) AND athleteId IN (SELECT value FROM json_each(?))
  `
    )
    .iterate(project, ids) as Iterable<Fact>;

  yield* db
    .prepare(
      `
    SELECT d.team_id AS id,'team_training_day_value:' || json_array(d.project_code,d.training_date,d.category,d.unit) AS entity,
      0 AS athleteId,'队伍训练统计' AS type,d.training_date AS businessDate,t.name AS team
    FROM team_training_day_values d JOIN project_teams t ON t.id=d.team_id AND t.project=d.project_code
    WHERE d.project_code=? AND t.name IN (SELECT value FROM json_each(?))
  `
    )
    .iterate(project, JSON.stringify(teams)) as Iterable<Fact>;

  const athleteTeams = new Map(athletes.map(({ id, team }) => [id, team]));
  const special = db
    .prepare(
      `
    SELECT r.id,'special_test_result' AS entity,e.test_date AS businessDate,
      CASE WHEN json_valid(r.member_athlete_ids) THEN r.member_athlete_ids ELSE '[]' END AS memberIds
    FROM special_test_results r JOIN special_test_events e ON e.id=r.event_id WHERE e.project=?
  `
    )
    .iterate(project) as Iterable<
    Pick<Fact, 'id' | 'entity' | 'businessDate'> & { memberIds: string }
  >;
  for (const { memberIds, ...fact } of special) {
    const parsed: unknown = JSON.parse(memberIds);
    const members = Array.isArray(parsed) ? parsed.map(Number) : [];
    const memberTeams = new Set(members.map((id) => athleteTeams.get(id)));
    if (memberTeams.has(undefined) && !canSeeUnassigned) continue;
    const team = memberTeams.size === 1 ? ([...memberTeams][0] ?? '') : '';
    if (!team && !canSeeUnassigned) continue;
    yield { ...fact, athleteId: 0, team, type: '专项测试成绩' };
  }
}
