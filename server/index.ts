import express, { type NextFunction, type Request, type Response } from 'express';
import multer from 'multer';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { db } from './core/db.ts';
import { dailyTodoQuery, readDailyTodos } from './core/coach-daily-todos.ts';
import { requireAuth, requireRole } from './core/auth.ts';
import { accessibleAthleteIds, selectableProjects } from './core/permissions.ts';
import { registerAnalysisRoutes } from './analysis/analysis-routes.ts';
import { registerAccessRoutes } from './access/access-routes.ts';
import { registerSpecialTrainingRoutes } from './special/special-training-routes.ts';
import { registerDataImportRoutes } from './data-import/data-import-routes.ts';
import { registerStrengthTrainingRoutes } from './strength/strength-training-routes.ts';
import { registerAthleteRoutes } from './athlete/athlete-routes.ts';
import { registerSelfTrainingRoutes } from './athlete/self-training-routes.ts';
import { registerTrainingPlanRoutes } from './training-plan/training-plan-routes.ts';
import { registerAuthRoutes } from './access/auth-routes.ts';
import { registerStrengthTestRoutes } from './strength/strength-test-routes.ts';
import { athletePhotoRoot } from './core/uploads.ts';

try {
  process.loadEnvFile(resolve(process.cwd(), '.env'));
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
}

const app = express();
// 生产环境仅允许本机 Nginx 作为受信任的转发代理，防止公网客户端伪造 X-Forwarded-For。
app.set('trust proxy', 'loopback');
app.disable('x-powered-by');
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; font-src 'self' data:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'"
  );
  next();
});
app.use(express.json({ limit: '2mb' }));
app.use(
  '/uploads/athlete-photos',
  express.static(athletePhotoRoot, {
    fallthrough: false,
    immutable: true,
    maxAge: '30d',
  })
);

const port = Number(process.env.PORT || 8787);
const host = process.env.HOST || '127.0.0.1';

registerAuthRoutes(app);
registerAthleteRoutes(app);
registerSelfTrainingRoutes(app);
registerTrainingPlanRoutes(app);
registerStrengthTrainingRoutes(app);
registerDataImportRoutes(app);
registerSpecialTrainingRoutes(app);
registerAccessRoutes(app);
registerAnalysisRoutes(app);
registerStrengthTestRoutes(app);

app.get('/api/coach/daily-todos', requireAuth, requireRole('SCC', 'PRJ', 'REG', 'TD', 'DMD'), (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const now = new Date();
  const parsed = dailyTodoQuery(now).safeParse(req.query);
  if (!parsed.success)
    return res.status(400).json({
      message: '请选择有效项目；待办日期仅支持北京时间当天，且不能附加范围参数。',
    });
  const user = req.authUser!;
  if (!selectableProjects(user).includes(parsed.data.project))
    return res.status(403).json({ message: '无权查看该项目的每日待办。' });
  const todos = readDailyTodos(db, {
    athleteIds: accessibleAthleteIds(user),
    project: parsed.data.project,
    now,
  });
  res.json({ todos });
});

const distPath = resolve(process.cwd(), 'dist');
if (existsSync(distPath)) {
  app.use(express.static(distPath));
  app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(resolve(distPath, 'index.html')));
}

app.use((error: Error, _req: Request, res: Response, _next: NextFunction) => {
  const status = Number((error as Error & { status?: number }).status || 0);
  if (error instanceof multer.MulterError || error.message.startsWith('证件照仅支持')) {
    return res.status(400).json({ message: error.message });
  }
  if (status === 404) return res.status(404).json({ message: '文件不存在。' });
  res.status(500).json({ message: error.message || '服务器发生错误。' });
});

const server = app.listen(port, host, () => {
  console.log(`Training Monitor API running at http://${host}:${port}`);
});

let shuttingDown = false;
function shutdown(signal: NodeJS.Signals) {
  if (shuttingDown) return;
  shuttingDown = true;
  server.close(() => {
    try {
      db.close();
    } catch {}
    process.exit(0);
  });
  setTimeout(() => {
    try {
      db.close();
    } catch {}
    process.exit(0);
  }, 5000).unref();
  console.log(`收到 ${signal}，正在关闭服务。`);
}

process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));
