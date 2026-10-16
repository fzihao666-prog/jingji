import type { DatabaseSync } from 'node:sqlite';
import { logger } from '../core/logger.ts';
import { beijingDate } from '../core/coach-daily-todos.ts';
import { generateTeamPlanDraft, parseAiMetadata } from './team-plan-ai.ts';
import { readTeamPlans } from './team-plan-service.ts';
import type { TeamPlanAiMetadata } from './team-plan-ai.ts';

const DAY_MS = 24 * 60 * 60 * 1000;

export type AiPlanSchedulerOptions = {
  db: DatabaseSync;
  // 每日生成时刻（北京时区小时数），默认 18 点生成次日草稿。
  generateHour?: number;
  intervalMs?: number;
};

// 生成时间可后台配置：AI_PLAN_GENERATE_HOUR（0-23），默认 18。
export function configuredGenerateHour() {
  const value = Number(process.env.AI_PLAN_GENERATE_HOUR);
  return Number.isInteger(value) && value >= 0 && value <= 23 ? value : 18;
}

// 计算距离下一次生成时刻的毫秒数（北京时区近似：以本机时区换算到目标小时）。
export function msUntilNextGenerate(now: Date, generateHour: number) {
  const target = new Date(now);
  target.setHours(generateHour, 0, 0, 0);
  if (target.getTime() <= now.getTime()) target.setTime(target.getTime() + DAY_MS);
  return target.getTime() - now.getTime();
}

// 为所有有在训运动员的队伍生成下一训练日草稿。
// 相同队伍同日期只复用/更新已有草稿；单个队伍失败不影响其他队伍，也不影响已发布计划。
export async function generateDailyDrafts(db: DatabaseSync, targetDate: string) {
  const teams = db
    .prepare(
      `SELECT DISTINCT t.id AS teamId,t.name
      FROM project_teams t JOIN athletes a ON a.team_id=t.id
      WHERE t.active=1 AND a.active=1`
    )
    .all() as Array<{ teamId: number; name: string }>;
  const results: Array<{ teamId: number; teamName: string; ok: boolean; message: string }> = [];
  for (const team of teams) {
    try {
      const existing = readTeamPlans(db).find(
        (plan) =>
          plan.teamId === team.teamId &&
          plan.status === 'draft' &&
          plan.startDate === targetDate &&
          plan.endDate === targetDate
      );
      // 已存在教练手工修改的草稿时不覆盖：仅当草稿为 AI 生成或不存在草稿时才生成。
      const metaRow = existing
        ? (db.prepare('SELECT ai_metadata AS meta FROM training_plans WHERE id=?').get(existing.id) as {
            meta: string | null;
          } | undefined)
        : undefined;
      const metadata = parseAiMetadata(metaRow?.meta || null);
      if (existing && !metadata) {
        results.push({
          teamId: team.teamId,
          teamName: team.name,
          ok: true,
          message: '已有教练草稿，跳过自动生成',
        });
        continue;
      }
      const result = await generateTeamPlanDraft({
        db,
        teamId: team.teamId,
        date: targetDate,
        userId: 0,
        existingDraft: existing
          ? {
              id: existing.id,
              data: existing.data,
              metadata: metadata as TeamPlanAiMetadata | null,
            }
          : undefined,
      });
      const now = new Date().toISOString();
      const payload = JSON.stringify(result.data);
      const metaPayload = JSON.stringify(result.metadata);
      if (existing) {
        db.prepare(
          `UPDATE training_plans SET plan_data=?,ai_metadata=?,updated_at=CURRENT_TIMESTAMP,revision=revision+1
          WHERE id=? AND status='draft'`
        ).run(payload, metaPayload, existing.id);
      } else {
        const anchor = db
          .prepare('SELECT id FROM athletes WHERE team_id=? AND active=1 ORDER BY id LIMIT 1')
          .get(team.teamId) as { id: number } | undefined;
        if (!anchor) continue;
        const inserted = db
          .prepare(
            `INSERT INTO training_plans (athlete_id,plan_date,start_date,end_date,title,plan_data,ai_metadata,created_by,updated_by,model,team_id)
            VALUES (?,?,?,?,?,?,?,0,0,'team',?)`
          )
          .run(
            anchor.id,
            `ai-${targetDate}-${team.teamId}-${now}`,
            targetDate,
            targetDate,
            `${targetDate} ${team.name} AI训练计划`,
            payload,
            metaPayload,
            team.teamId
          );
        db.prepare('UPDATE training_plans SET root_id=? WHERE id=?').run(
          Number(inserted.lastInsertRowid),
          Number(inserted.lastInsertRowid)
        );
      }
      results.push({ teamId: team.teamId, teamName: team.name, ok: true, message: '已生成草稿' });
    } catch (error) {
      const message = error instanceof Error ? error.message : '未知错误';
      logger.warn('AI生成队伍训练计划草稿失败', { teamId: team.teamId, message });
      results.push({ teamId: team.teamId, teamName: team.name, ok: false, message });
    }
  }
  return results;
}

// 启动每日自动生成调度：默认每日 18:00 为下一训练日生成草稿。
export function startAiPlanScheduler(options: AiPlanSchedulerOptions) {
  const generateHour = options.generateHour ?? configuredGenerateHour();
  let stopped = false;
  let running = false;
  let timer: NodeJS.Timeout | null = null;

  async function run() {
    if (stopped || running) return;
    running = true;
    try {
      // 为“下一训练日”生成：默认取明天。
      const targetDate = beijingDate(new Date(Date.now() + DAY_MS));
      const results = await generateDailyDrafts(options.db, targetDate);
      const failed = results.filter((item) => !item.ok);
      logger.info('AI每日训练计划草稿生成完成', {
        targetDate,
        total: results.length,
        failed: failed.length,
      });
    } catch (error) {
      logger.error('AI每日训练计划草稿生成异常', {
        message: (error as Error).message,
      });
    } finally {
      running = false;
    }
  }

  function schedule() {
    if (stopped) return;
    const delay = msUntilNextGenerate(new Date(), generateHour);
    timer = setTimeout(() => {
      void run().finally(schedule);
    }, delay);
    timer.unref?.();
  }
  schedule();

  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
}
