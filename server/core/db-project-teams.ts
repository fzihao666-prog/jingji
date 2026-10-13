import type { DatabaseSync } from 'node:sqlite';

// 2026-10-13 当前启用队伍快照，不包含已停用队伍和运动员资料。
const INITIAL_PROJECT_TEAMS: readonly (readonly [string, string])[] = [
  ['ARCHERY', '宁夏训管中心（射箭）'],
  ['ATHLETICS', '宁夏训管中心（中长跑）'],
  ['ATHLETICS', '宁夏训管中心（投掷）'],
  ['BOXING', '海南男子拳击'],
  ['CANOE_SLALOM', '女子激流回旋组'],
  ['CANOE_SLALOM', '广东激流'],
  ['CANOE_SLALOM', '男子激流回旋组'],
  ['CANOE_SLALOM', '贵州激流回旋'],
  ['CANOE_SPRINT', '女子静水组'],
  ['CANOE_SPRINT', '江苏皮划艇'],
  ['CANOE_SPRINT', '男子静水组'],
  ['CANOE_SPRINT', '贵州皮划艇'],
  ['CANOE_SPRINT', '贵州皮艇'],
  ['FENCING', '山东击剑'],
  ['FOOTBALL', '宁夏女足'],
  ['ROWING', '女子单桨组'],
  ['ROWING', '女子双桨组'],
  ['ROWING', '广东赛艇队'],
  ['ROWING', '江苏赛艇'],
  ['ROWING', '男子单桨组'],
  ['ROWING', '男子双桨组'],
  ['ROWING', '贵州赛艇'],
  ['ROWING', '赛艇队'],
  ['WEIGHTLIFTING', '海南举重'],
];

/** 每次启动补齐缺失队伍；已有记录（含停用状态）保持不变。 */
export function initializeProjectTeams(db: DatabaseSync) {
  const insert = db.prepare(`
    INSERT INTO project_teams (project, name) VALUES (?, ?)
    ON CONFLICT(project, name) DO NOTHING
  `);
  db.exec('SAVEPOINT initialize_project_teams');
  try {
    for (const [project, name] of INITIAL_PROJECT_TEAMS) insert.run(project, name);
    db.exec('RELEASE initialize_project_teams');
  } catch (error) {
    db.exec('ROLLBACK TO initialize_project_teams');
    db.exec('RELEASE initialize_project_teams');
    throw error;
  }
}
