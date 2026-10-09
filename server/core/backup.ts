import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { logger } from './logger.ts';

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_RETAIN_DAYS = 7;

/**
 * 执行 SQLite 数据库备份。
 * 使用 sqlite3 .backup 进行在线热备份，不阻塞写入。
 * 备份文件命名：jingji-YYYYMMDD-HHmmss.db
 */
export function backupDatabase(databasePath: string, backupDir: string): Promise<string> {
  if (!existsSync(databasePath)) {
    throw new Error('数据库文件不存在');
  }
  if (!existsSync(backupDir)) {
    mkdirSync(backupDir, { recursive: true });
  }
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const backupPath = join(backupDir, `jingji-${timestamp}.db`);
  return new Promise<string>((resolvePromise, reject) => {
    execFile('sqlite3', [databasePath, `.backup '${backupPath}'`], { timeout: 30_000 }, (error) => {
      if (error) {
        logger.error('sqlite3 在线备份失败，未生成有效备份', { message: error.message });
        try {
          if (existsSync(backupPath)) unlinkSync(backupPath);
        } catch (cleanupError) {
          logger.warn('清理不完整的备份文件失败', {
            message: (cleanupError as Error).message,
          });
        }
        reject(new Error('SQLite 在线备份失败，未生成有效备份。', { cause: error }));
        return;
      }
      resolvePromise(backupPath);
    });
  });
}

/**
 * 清理过期备份，保留最近 N 天。
 */
export function cleanupOldBackups(backupDir: string, retainDays: number): number {
  if (!existsSync(backupDir)) return 0;
  const cutoff = Date.now() - retainDays * DAY_MS;
  let deleted = 0;
  for (const file of readdirSync(backupDir)) {
    if (!file.startsWith('jingji-') || !file.endsWith('.db')) continue;
    const filePath = join(backupDir, file);
    try {
      const stat = statSync(filePath);
      if (stat.mtimeMs < cutoff) {
        unlinkSync(filePath);
        deleted += 1;
      }
    } catch {
      // 忽略单个文件清理失败
    }
  }
  return deleted;
}

/**
 * 执行一次完整的备份 + 清理流程。
 * 返回备份文件路径与清理数量。
 */
export async function runBackup(options: {
  databasePath: string;
  backupDir: string;
  retainDays?: number;
}): Promise<{ backupPath: string; deletedCount: number }> {
  const retainDays = options.retainDays ?? DEFAULT_RETAIN_DAYS;
  logger.info('backup started', { db: options.databasePath, dir: options.backupDir });
  const backupPath = await backupDatabase(options.databasePath, options.backupDir);
  const deletedCount = cleanupOldBackups(options.backupDir, retainDays);
  logger.info('backup completed', { backupPath, deletedCount, retainDays });
  return { backupPath, deletedCount };
}

/**
 * 启动定时备份调度器（每 24 小时执行一次）。
 * 返回停止函数。
 */
export function startBackupScheduler(options: {
  databasePath: string;
  backupDir: string;
  retainDays?: number;
  intervalMs?: number;
}): () => void {
  const intervalMs = options.intervalMs ?? 24 * 60 * 60 * 1000;
  let running = false;

  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await runBackup(options);
    } catch (error) {
      logger.error('scheduled backup failed', { message: (error as Error).message });
    } finally {
      running = false;
    }
  };

  // 首次启动后延迟 5 分钟执行，避免启动高峰
  const initialTimer = setTimeout(tick, 5 * 60 * 1000);
  const interval = setInterval(tick, intervalMs);
  // 阻止定时器阻止进程退出
  initialTimer.unref();
  interval.unref();

  logger.info('backup scheduler started', {
    intervalHours: Math.round(intervalMs / 3600000),
    retainDays: options.retainDays ?? DEFAULT_RETAIN_DAYS,
  });

  return () => {
    clearTimeout(initialTimer);
    clearInterval(interval);
    logger.info('backup scheduler stopped');
  };
}
