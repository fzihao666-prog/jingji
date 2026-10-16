import type { DatabaseSync } from 'node:sqlite';

// 队伍训练项执行确认：教练确认“队伍已组织实施该训练项目”，与运动员个人实际完成严格区分。
// 仅记录已执行/已取消两种确认结果；无行即待执行。个人未完成由实际训练记录判定，不在此表保存。
export type TeamPlanCheckStatus = 'executed' | 'cancelled';

export type TeamPlanCheck = {
  planId: number;
  sessionId: string;
  itemId: string;
  status: TeamPlanCheckStatus | 'pending';
  reason: string;
  checkedBy: number | null;
  checkedAt: string | null;
  updatedBy: number | null;
  updatedAt: string | null;
  revision: number;
};

export function initializeTeamPlanChecks(db: DatabaseSync) {
  db.exec(`CREATE TABLE IF NOT EXISTS team_plan_item_checks (
    plan_id INTEGER NOT NULL REFERENCES training_plans(id) ON DELETE CASCADE,
    session_id TEXT NOT NULL,
    item_id TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL CHECK(status IN ('pending','executed','cancelled')),
    reason TEXT NOT NULL DEFAULT '',
    checked_by INTEGER,
    checked_at TEXT,
    updated_by INTEGER,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    revision INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (plan_id, session_id, item_id)
  ); CREATE INDEX IF NOT EXISTS team_plan_item_checks_plan ON team_plan_item_checks(plan_id);`);
}

type CheckRow = {
  planId: number;
  sessionId: string;
  itemId: string;
  status: TeamPlanCheck['status'];
  reason: string;
  checkedBy: number | null;
  checkedAt: string | null;
  updatedBy: number | null;
  updatedAt: string | null;
  revision: number;
};

export function readTeamPlanChecks(db: DatabaseSync, planId: number): TeamPlanCheck[] {
  return db
    .prepare(
      `SELECT plan_id AS planId,session_id AS sessionId,item_id AS itemId,status,reason,
      checked_by AS checkedBy,checked_at AS checkedAt,updated_by AS updatedBy,updated_at AS updatedAt,revision
      FROM team_plan_item_checks WHERE plan_id=?`
    )
    .all(planId) as CheckRow[];
}

export class TeamPlanCheckError extends Error {}

// 保存一次确认：status 传 null 表示撤销确认恢复待执行。
// revision 为乐观锁：非空且与当前不符时拒绝，避免并发覆盖。
export function writeTeamPlanCheck(
  db: DatabaseSync,
  input: {
    planId: number;
    sessionId: string;
    itemId?: string;
    status: TeamPlanCheckStatus | null;
    reason?: string;
    revision?: number;
    userId: number;
  }
): TeamPlanCheck {
  const itemId = input.itemId || '';
  const reason = (input.reason || '').trim();
  if (input.status === 'cancelled' && !reason)
    throw new TeamPlanCheckError('取消训练安排必须填写简要原因');
  if (input.status !== 'cancelled' && reason.length > 500)
    throw new TeamPlanCheckError('原因说明过长');
  const current = db
    .prepare(
      `SELECT plan_id AS planId,session_id AS sessionId,item_id AS itemId,status,reason,
      checked_by AS checkedBy,checked_at AS checkedAt,updated_by AS updatedBy,updated_at AS updatedAt,revision
      FROM team_plan_item_checks WHERE plan_id=? AND session_id=? AND item_id=?`
    )
    .get(input.planId, input.sessionId, itemId) as CheckRow | undefined;
  if (input.revision !== undefined && (current?.revision || 0) !== input.revision)
    throw new TeamPlanCheckError('确认状态已变化，请刷新后重试');
  const now = new Date().toISOString();
  if (input.status === null) {
    // 撤销确认：状态回到待执行并保留行，乐观锁版本号连续递增。
    db.prepare(
      `INSERT INTO team_plan_item_checks (plan_id,session_id,item_id,status,reason,checked_by,checked_at,updated_by,updated_at,revision)
      VALUES (?,?,?,?,?,NULL,NULL,?,?,?)
      ON CONFLICT(plan_id,session_id,item_id) DO UPDATE SET
        status='pending',reason='',checked_by=NULL,checked_at=NULL,
        updated_by=excluded.updated_by,updated_at=excluded.updated_at,
        revision=team_plan_item_checks.revision+1`
    ).run(
      input.planId,
      input.sessionId,
      itemId,
      'pending',
      '',
      input.userId,
      now,
      (current?.revision || 0) + 1
    );
    return db
      .prepare(
        `SELECT plan_id AS planId,session_id AS sessionId,item_id AS itemId,status,reason,
        checked_by AS checkedBy,checked_at AS checkedAt,updated_by AS updatedBy,updated_at AS updatedAt,revision
        FROM team_plan_item_checks WHERE plan_id=? AND session_id=? AND item_id=?`
      )
      .get(input.planId, input.sessionId, itemId) as CheckRow;
  }
  db.prepare(
    `INSERT INTO team_plan_item_checks (plan_id,session_id,item_id,status,reason,checked_by,checked_at,updated_by,updated_at,revision)
    VALUES (?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(plan_id,session_id,item_id) DO UPDATE SET
      status=excluded.status,reason=excluded.reason,
      checked_by=excluded.checked_by,checked_at=excluded.checked_at,
      updated_by=excluded.updated_by,updated_at=excluded.updated_at,
      revision=team_plan_item_checks.revision+1`
  ).run(
    input.planId,
    input.sessionId,
    itemId,
    input.status,
    input.status === 'cancelled' ? reason : '',
    input.userId,
    now,
    input.userId,
    now,
    (current?.revision || 0) + 1
  );
  return db
    .prepare(
      `SELECT plan_id AS planId,session_id AS sessionId,item_id AS itemId,status,reason,
      checked_by AS checkedBy,checked_at AS checkedAt,updated_by AS updatedBy,updated_at AS updatedAt,revision
      FROM team_plan_item_checks WHERE plan_id=? AND session_id=? AND item_id=?`
    )
    .get(input.planId, input.sessionId, itemId) as CheckRow;
}
