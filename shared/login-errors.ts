// 登录失败的业务错误码与页面提示映射。
// 服务端按码返回稳定业务错误码，Web 与小程序按码取提示，避免多处维护不一致文案；
// 提示文案只由本映射决定，不根据服务端文本猜测账号状态。
export const LOGIN_ERROR_MESSAGES = {
  MISSING_CREDENTIALS: '请输入账号和密码',
  INVALID_CREDENTIALS: '账号或密码错误，请重新输入',
  ACCOUNT_PENDING: '账号正在审核中，请等待管理员审核',
  ACCOUNT_REJECTED: '账号审核未通过，请联系管理员',
  ACCOUNT_DISABLED: '账号已停用，请联系管理员',
  RATE_LIMITED: '登录尝试过多，请稍后重试',
  NETWORK_ERROR: '网络连接失败，请检查网络后重试',
  TIMEOUT: '登录超时，请稍后重试',
  SERVER_ERROR: '服务器暂时不可用，请稍后重试',
  LOGIN_FAILED: '登录失败，请稍后重试',
} as const;

export type LoginErrorCode = keyof typeof LOGIN_ERROR_MESSAGES;

export interface LoginFailureContext {
  /** 服务端返回的业务错误码；未知或缺失时不猜测账号状态 */
  code?: unknown;
  /** HTTP 状态码；网络层失败时缺失 */
  status?: number;
  /** 服务端 4xx 业务提示原文；5xx 正文可能含内部错误，一律不展示 */
  serverMessage?: string;
  timedOut?: boolean;
  networkError?: boolean;
}

export function loginErrorMessage(code: unknown): string | undefined {
  if (typeof code !== 'string') return undefined;
  return Object.prototype.hasOwnProperty.call(LOGIN_ERROR_MESSAGES, code)
    ? LOGIN_ERROR_MESSAGES[code as LoginErrorCode]
    : undefined;
}

export function loginFailureMessage(context: LoginFailureContext): string {
  const mapped = loginErrorMessage(context.code);
  if (mapped) return mapped;
  if (context.timedOut) return LOGIN_ERROR_MESSAGES.TIMEOUT;
  if (context.networkError) return LOGIN_ERROR_MESSAGES.NETWORK_ERROR;
  const status = context.status;
  if (typeof status === 'number' && status >= 500) return LOGIN_ERROR_MESSAGES.SERVER_ERROR;
  if (typeof status === 'number' && status >= 400 && status < 500 && context.serverMessage) {
    return context.serverMessage;
  }
  return LOGIN_ERROR_MESSAGES.LOGIN_FAILED;
}
