/**
 * 结构化日志模块。
 * 输出 JSON 格式日志到 stdout/stderr，便于日志采集系统（如 Loki、ELK）解析。
 * 线上环境输出 JSON，开发环境输出可读格式。
 */
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

type LogLevel = 'debug' | 'info' | 'warn' | 'error';
type LogContext = Record<string, unknown>;

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };
const MIN_LEVEL: LogLevel = (process.env.LOG_LEVEL as LogLevel) || 'info';

function shouldLog(level: LogLevel): boolean {
  return LEVEL_ORDER[level] >= LEVEL_ORDER[MIN_LEVEL];
}

function formatMessage(level: LogLevel, message: string, context?: LogContext): string {
  const timestamp = new Date().toISOString();
  if (IS_PRODUCTION) {
    return JSON.stringify({ timestamp, level, message, ...context });
  }
  // 开发环境：人类可读格式
  const ctx = context && Object.keys(context).length ? ` ${JSON.stringify(context)}` : '';
  const prefix = level.toUpperCase().padEnd(5);
  return `${timestamp} [${prefix}] ${message}${ctx}`;
}

export const logger = {
  debug(message: string, context?: LogContext) {
    if (!shouldLog('debug')) return;
    console.debug(formatMessage('debug', message, context));
  },
  info(message: string, context?: LogContext) {
    if (!shouldLog('info')) return;
    console.log(formatMessage('info', message, context));
  },
  warn(message: string, context?: LogContext) {
    if (!shouldLog('warn')) return;
    console.warn(formatMessage('warn', message, context));
  },
  error(message: string, context?: LogContext) {
    if (!shouldLog('error')) return;
    console.error(formatMessage('error', message, context));
  },
  /** 记录请求日志，统一格式 */
  request(info: {
    method: string;
    path: string;
    status: number;
    durationMs: number;
    userId?: number | null;
    ip?: string;
  }) {
    const level = info.status >= 500 ? 'error' : info.status >= 400 ? 'warn' : 'info';
    this[level as 'info' | 'warn' | 'error']('http', {
      method: info.method,
      path: info.path,
      status: info.status,
      ms: info.durationMs,
      userId: info.userId ?? null,
      ip: info.ip,
    });
  },
};
