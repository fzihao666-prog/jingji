import express, { type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import multer from 'multer';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { db } from './core/db.ts';
import { dailyTodoQuery, readDailyTodos, readTeamOverview } from './core/coach-daily-todos.ts';
import { readLoadManagement } from './core/load-management.ts';
import { readWellnessBaseline } from './core/wellness-baseline.ts';
import { readPlanExecution } from './core/plan-execution.ts';
import { PROJECTS } from '../shared/projects.ts';
import { requireAuth, requireRole } from './core/auth.ts';
import { accessibleAthleteIds, selectableProjects } from './core/permissions.ts';
import { registerAnalysisRoutes } from './analysis/analysis-routes.ts';
import { registerAccessRoutes } from './access/access-routes.ts';
import { registerSpecialTrainingRoutes } from './special/special-training-routes.ts';
import { registerDataImportRoutes } from './data-import/data-import-routes.ts';
import { registerStrengthTrainingRoutes } from './strength/strength-training-routes.ts';
import { registerAthleteRoutes } from './athlete/athlete-routes.ts';
import { registerSelfTrainingRoutes } from './athlete/self-training-routes.ts';
import { registerSelfDailyRoutes } from './athlete/self-daily-routes.ts';
import { registerTrainingPlanRoutes } from './training-plan/training-plan-routes.ts';
import { registerAuthRoutes } from './access/auth-routes.ts';
import { registerStrengthTestRoutes } from './strength/strength-test-routes.ts';
import { logger } from './core/logger.ts';
import { startBackupScheduler } from './core/backup.ts';

// 全局异常捕获：防止未处理的 Promise 拒绝或异常导致进程静默崩溃。
process.on('uncaughtException', (err) => {
  logger.error('uncaughtException', { message: err.message, stack: err.stack });
  // 不退出进程：记录日志后继续运行，避免单次异常导致服务完全不可用。
});
process.on('unhandledRejection', (reason) => {
  const err = reason instanceof Error ? reason : new Error(String(reason));
  logger.error('unhandledRejection', { message: err.message, stack: err.stack });
});

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

// 请求日志中间件：记录每个请求的方法、路径、状态码、耗时与用户 ID。
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    logger.request({
      method: req.method,
      path: req.path,
      status: res.statusCode,
      durationMs: Date.now() - start,
      userId: req.authUser?.id ?? null,
      ip: req.ip,
    });
  });
  next();
});

// 健康检查端点：供 Nginx、负载均衡与外部监控探测服务存活状态。
app.get('/health', (_req, res) => {
  try {
    db.prepare('SELECT 1').get();
    res.json({
      status: 'ok',
      uptime: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error('health-check failed', { message: (error as Error).message });
    res.status(503).json({ status: 'degraded', timestamp: new Date().toISOString() });
  }
});

const port = Number(process.env.PORT || 8787);
const host = process.env.HOST || '127.0.0.1';

registerAuthRoutes(app);
registerAthleteRoutes(app);
registerSelfTrainingRoutes(app);
registerSelfDailyRoutes(app);
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

const teamOverviewQuery = (now: Date) =>
  z.strictObject({
    project: z
      .string()
      .trim()
      .min(1)
      .max(40)
      .refine((value) => PROJECTS.includes(value)),
  });

app.get('/api/coach/team-overview', requireAuth, requireRole('SCC', 'PRJ', 'REG', 'TD', 'DMD'), (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const now = new Date();
  const parsed = teamOverviewQuery(now).safeParse(req.query);
  if (!parsed.success)
    return res.status(400).json({ message: '请选择有效项目。' });
  const user = req.authUser!;
  if (!selectableProjects(user).includes(parsed.data.project))
    return res.status(403).json({ message: '无权查看该项目的队伍总览。' });
  const overview = readTeamOverview(db, {
    athleteIds: accessibleAthleteIds(user),
    project: parsed.data.project,
    now,
  });
  res.json(overview);
});

// 训练负荷管理（ACWR）
app.get('/api/coach/load-management', requireAuth, requireRole('SCC', 'PRJ', 'REG', 'TD', 'DMD'), (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const now = new Date();
  const parsed = teamOverviewQuery(now).safeParse(req.query);
  if (!parsed.success)
    return res.status(400).json({ message: '请选择有效项目。' });
  const user = req.authUser!;
  if (!selectableProjects(user).includes(parsed.data.project))
    return res.status(403).json({ message: '无权查看该项目的负荷管理数据。' });
  const result = readLoadManagement(db, {
    athleteIds: accessibleAthleteIds(user),
    project: parsed.data.project,
    now,
  });
  res.json(result);
});

// 恢复状态基线偏离预警
app.get('/api/coach/wellness-baseline', requireAuth, requireRole('SCC', 'PRJ', 'REG', 'TD', 'DMD'), (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const now = new Date();
  const parsed = teamOverviewQuery(now).safeParse(req.query);
  if (!parsed.success)
    return res.status(400).json({ message: '请选择有效项目。' });
  const user = req.authUser!;
  if (!selectableProjects(user).includes(parsed.data.project))
    return res.status(403).json({ message: '无权查看该项目的基线预警数据。' });
  const result = readWellnessBaseline(db, {
    athleteIds: accessibleAthleteIds(user),
    project: parsed.data.project,
    now,
  });
  res.json(result);
});

// 训练计划执行率
app.get('/api/coach/plan-execution', requireAuth, requireRole('SCC', 'PRJ', 'REG', 'TD', 'DMD'), (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const now = new Date();
  const parsed = teamOverviewQuery(now).safeParse(req.query);
  if (!parsed.success)
    return res.status(400).json({ message: '请选择有效项目。' });
  const user = req.authUser!;
  if (!selectableProjects(user).includes(parsed.data.project))
    return res.status(403).json({ message: '无权查看该项目的计划执行数据。' });
  const result = readPlanExecution(db, {
    athleteIds: accessibleAthleteIds(user),
    project: parsed.data.project,
    now,
  });
  res.json(result);
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
  logger.info('server started', { host, port, env: process.env.NODE_ENV || 'development' });
  // 启动数据库定时备份（每 24 小时一次，保留 30 天）
  const databasePath = resolve(process.cwd(), 'data', 'jingji.db');
  const backupDir = resolve(process.cwd(), 'data', 'backups');
  startBackupScheduler({ databasePath, backupDir, retainDays: 30 });
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
  logger.info('server shutting down', { signal });
}

process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));
