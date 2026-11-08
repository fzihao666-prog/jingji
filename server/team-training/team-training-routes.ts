import type { Express } from 'express';
import { z } from 'zod';
import { isProject, projectCapability } from '../../shared/projects.ts';
import { requireAuth, requireRole } from '../core/auth.ts';
import { db } from '../core/db.ts';
import type { AuthUser } from '../core/shared-server.ts';
import { dataImportUpload } from '../core/uploads.ts';
import { dataImportScope } from '../data-import/data-import-access.ts';
import { normalizeImportFilename } from '../data-import/import-filename.ts';
import { importTeamTrainingStatistics, readTeamTrainingStatistics } from './team-training-stats.ts';
import {
  defaultTeamTrainingMapping,
  isTeamTrainingDate,
  normalizeTeamTrainingUnit,
  readTeamTrainingWorkbook,
  TeamTrainingInputError,
} from './team-training-workbook.ts';

const targetSchema = z.object({
  project: z.string().refine(isProject),
  teamId: z.coerce.number().int().positive(),
});
const mappingSchema = z
  .record(
    z.string().max(300),
    z
      .object({
        category: z.string().trim().min(1).max(80),
        unit: z.string().trim().min(1).max(20).transform(normalizeTeamTrainingUnit),
      })
      .strict()
  )
  .refine((mappings) => Object.keys(mappings).length <= 128);

class TeamTrainingAccessError extends Error {}
function assertTeamAccess(user: AuthUser, target: z.infer<typeof targetSchema>) {
  const team = db
    .prepare('SELECT name FROM project_teams WHERE id=? AND project=? AND active=1')
    .get(target.teamId, target.project) as { name: string } | undefined;
  const scope = dataImportScope(user, target.project);
  if (!team || !scope.allowed || !scope.allowedTeams.has(team.name))
    throw new TeamTrainingAccessError('当前账号无权访问该项目队伍的训练统计。');
}

export function registerTeamTrainingStatisticsRoutes(app: Express) {
  const managers = requireRole('SCC', 'REG', 'TD', 'DMD');

  app.post(
    '/api/team-training-stats/import',
    requireAuth,
    managers,
    dataImportUpload.single('file'),
    (req, res) => {
      const target = targetSchema.safeParse(req.body);
      if (!target.success || !req.file)
        return res.status(400).json({ message: '请选择有效队伍和 Excel 文件。' });
      let mappings: unknown;
      try {
        mappings = JSON.parse(req.body?.mappings || '{}');
      } catch {
        return res.status(400).json({ message: '列映射格式无效。' });
      }
      const parsed = mappingSchema.safeParse(mappings);
      if (!parsed.success) return res.status(400).json({ message: '请填写有效的分项名称和单位。' });
      const user = req.authUser!;
      const authorize = () => assertTeamAccess(user, target.data);
      try {
        authorize();
        const workbook = readTeamTrainingWorkbook(req.file.buffer);
        if (
          !projectCapability(target.data.project) &&
          workbook.entries.some(
            (entry) => defaultTeamTrainingMapping('ROWING', entry.column)?.waterGroup === 'water'
          )
        )
          throw new TeamTrainingInputError(
            '文件含水上训练模板数据，请切换到对应的水上项目和队伍后导入。'
          );
        return res.json(
          importTeamTrainingStatistics(db, {
            ...target.data,
            workbook,
            authorize,
            userId: user.id,
            filename: normalizeImportFilename(req.file.originalname),
            mappings: parsed.data,
          })
        );
      } catch (error) {
        if (error instanceof TeamTrainingAccessError)
          return res.status(403).json({ message: error.message });
        if (error instanceof TeamTrainingInputError)
          return res.status(400).json({ message: error.message });
        return res.status(500).json({ message: '队伍训练数据保存失败，请重试。' });
      }
    }
  );

  app.get('/api/team-training-stats', requireAuth, managers, (req, res) => {
    const parsed = targetSchema
      .extend({ date: z.string().refine(isTeamTrainingDate).optional() })
      .safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ message: '请选择有效队伍和日期。' });
    const target = parsed.data;
    try {
      assertTeamAccess(req.authUser!, target);
      const latest = db
        .prepare(
          `SELECT MAX(training_date) AS date FROM team_training_day_values
        WHERE team_id=? AND project_code=?`
        )
        .get(target.teamId, target.project);
      const date =
        target.date ??
        String(
          latest?.date ??
            new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai' }).format(new Date())
        );
      return res.json(readTeamTrainingStatistics(db, target, date));
    } catch (error) {
      if (error instanceof TeamTrainingAccessError)
        return res.status(403).json({ message: error.message });
      return res.status(500).json({ message: '队伍训练统计读取失败，请重试。' });
    }
  });
}
