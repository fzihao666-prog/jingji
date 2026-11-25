// 登录失败提示映射：消息字典由 scripts/sync-mini-register-data.mjs 从 shared/login-errors.ts 生成，
// 与 Web 端共用同一套业务错误码与提示文案，不根据服务端文本猜测账号状态。
const LOGIN_ERROR_MESSAGES = require('../data/login-errors');

function loginErrorMessage(code) {
  return typeof code === 'string' &&
    Object.prototype.hasOwnProperty.call(LOGIN_ERROR_MESSAGES, code)
    ? LOGIN_ERROR_MESSAGES[code]
    : undefined;
}

function loginFailureMessage(context) {
  const mapped = loginErrorMessage(context && context.code);
  if (mapped) return mapped;
  if (context && context.timedOut) return LOGIN_ERROR_MESSAGES.TIMEOUT;
  if (context && context.networkError) return LOGIN_ERROR_MESSAGES.NETWORK_ERROR;
  const status = context && context.status;
  if (typeof status === 'number' && status >= 500) return LOGIN_ERROR_MESSAGES.SERVER_ERROR;
  if (typeof status === 'number' && status >= 400 && status < 500 && context.serverMessage) {
    return context.serverMessage;
  }
  return LOGIN_ERROR_MESSAGES.LOGIN_FAILED;
}

module.exports = { LOGIN_ERROR_MESSAGES, loginErrorMessage, loginFailureMessage };
