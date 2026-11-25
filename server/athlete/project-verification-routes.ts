import type { Express } from 'express';
import { z } from 'zod';
import { db } from '../core/db.ts';
import { requireAuth, requireRole } from '../core/auth.ts';
import { hasAthleteAccess, selectableProjects } from '../core/permissions.ts';
import { isProject } from '../../shared/projects.ts';
const managers = ['SCC', 'REG', 'TD', 'DMD'] as const;
const projectInput = z.strictObject({ project: z.string().refine(isProject) });

export function registerProjectVerificationRoutes(app: Express) {
  app.get(
    '/api/athletes/:id/pending-project-facts',
    requireAuth,
    requireRole(...managers),
    (req, res) => {
      const id = Number(req.params.id);
      if (!hasAthleteAccess(req.authUser!, id))
        return res.status(403).json({ message: '无权查看该运动员的待核实记录。' });
      const training = db
        .prepare(
          "SELECT id,session_date AS date,content FROM training_sessions WHERE athlete_id=? AND project_status='pending_verification' AND is_demo=0 ORDER BY session_date DESC"
        )
        .all(id);
      const tests = db
        .prepare(
          "SELECT id,test_date AS date,test_type AS content FROM test_sessions WHERE athlete_id=? AND project_status='pending_verification' AND is_demo=0 ORDER BY test_date DESC"
        )
        .all(id);
      return res.json({ training, tests });
    }
  );
  for (const [path, table, kind] of [
    ['training-sessions', 'training_sessions', 'training_session'],
    ['test-sessions', 'test_sessions', 'test_session'],
  ] as const) {
    app.post(
      `/api/${path}/:id/verify-project`,
      requireAuth,
      requireRole(...managers),
      (req, res) => {
        const input = projectInput.safeParse(req.body);
        const id = Number(req.params.id);
        const user = req.authUser!;
        if (!input.success || !Number.isSafeInteger(id) || id <= 0)
          return res.status(400).json({ message: '请选择明确的项目和有效记录。' });
        if (!selectableProjects(user).some((project) => project === input.data.project))
          return res.status(403).json({ message: '无权核实该项目。' });
        db.exec('BEGIN IMMEDIATE');
        try {
          const fact = db
            .prepare(
              `SELECT athlete_id AS athleteId,project_code AS project,project_status AS status FROM ${table} WHERE id=? AND is_demo=0`
            )
            .get(id) as { athleteId: number; project: string | null; status: string } | undefined;
          if (!fact || !hasAthleteAccess(user, fact.athleteId)) {
            db.exec('ROLLBACK');
            return res.status(403).json({ message: '记录不存在或无权核实。' });
          }
          if (fact.status === 'confirmed') {
            db.exec('COMMIT');
            return res
              .status(fact.project === input.data.project ? 200 : 409)
              .json({
                message:
                  fact.project === input.data.project
                    ? '项目已核实。'
                    : '已确认记录不能通过核实入口改项目。',
              });
          }
          db.prepare(
            `UPDATE ${table} SET project_code=?,project_status='confirmed',project_source='manual_verification' WHERE id=?`
          ).run(input.data.project, id);
          db.prepare(
            "INSERT INTO audit_logs(user_id,action,entity_type,entity_id,detail) VALUES(?,'VERIFY_FACT_PROJECT',?,?,?)"
          ).run(
            user.id,
            kind,
            id,
            JSON.stringify({
              athleteId: fact.athleteId,
              previousProject: fact.project,
              project: input.data.project,
            })
          );
          db.exec('COMMIT');
          return res.json({ message: '项目归属已确认，符合其他条件的事实将进入专项比较。' });
        } catch (error) {
          if (db.isTransaction) db.exec('ROLLBACK');
          if (error instanceof Error && /UNIQUE constraint/.test(error.message))
            return res.status(409).json({ message: '核实后与已有测试业务键重复，请先核对记录。' });
          throw error;
        }
      }
    );
  }
}
