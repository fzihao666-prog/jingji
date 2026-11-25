import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import {
  LOGIN_ERROR_MESSAGES as SHARED_MESSAGES,
  loginErrorMessage as sharedLoginErrorMessage,
  loginFailureMessage as sharedLoginFailureMessage,
} from '../../shared/login-errors.js';

function loadCjs(url, mocks, globals = {}) {
  const module = { exports: {} };
  vm.runInNewContext(readFileSync(url, 'utf8'), {
    module,
    exports: module.exports,
    require(path) {
      if (Object.prototype.hasOwnProperty.call(mocks, path)) return mocks[path];
      throw new Error(`未预期的依赖：${path}`);
    },
    ...globals,
  });
  return module.exports;
}

const loginErrorsData = loadCjs(new URL('../data/login-errors.js', import.meta.url), {});
const { LOGIN_ERROR_MESSAGES, loginErrorMessage, loginFailureMessage } = loadCjs(
  new URL('./login-errors.js', import.meta.url),
  { '../data/login-errors': loginErrorsData }
);

describe('登录失败提示映射', () => {
  it('提示字典与 shared/login-errors 完全一致', () => {
    expect(LOGIN_ERROR_MESSAGES).toEqual(SHARED_MESSAGES);
  });

  it('按业务错误码返回固定提示', () => {
    expect(loginErrorMessage('INVALID_CREDENTIALS')).toBe('账号或密码错误，请重新输入');
    expect(loginErrorMessage('ACCOUNT_PENDING')).toBe('账号正在审核中，请等待管理员审核');
    expect(loginErrorMessage('ACCOUNT_REJECTED')).toBe('账号审核未通过，请联系管理员');
    expect(loginErrorMessage('ACCOUNT_DISABLED')).toBe('账号已停用，请联系管理员');
    expect(loginErrorMessage('MISSING_CREDENTIALS')).toBe('请输入账号和密码');
  });

  it('未知或非字符串错误码不猜测账号状态', () => {
    expect(loginErrorMessage('SOMETHING_ELSE')).toBeUndefined();
    expect(loginErrorMessage(undefined)).toBeUndefined();
    expect(loginErrorMessage(401)).toBeUndefined();
    expect(sharedLoginErrorMessage('SOMETHING_ELSE')).toBeUndefined();
  });

  it('与 shared/login-errors 对同一失败上下文给出相同提示', () => {
    const cases = [
      {},
      { code: 'ACCOUNT_DISABLED', status: 403, networkError: true },
      { code: 'RATE_LIMITED', status: 429 },
      { code: 'UNKNOWN_CODE', status: 401, serverMessage: '服务端自定义提示' },
      { timedOut: true, networkError: true },
      { networkError: true },
      { status: 500, serverMessage: 'SQLITE_BUSY: database is locked' },
      { status: 502, serverMessage: 'Bad Gateway' },
      { status: 429, serverMessage: '登录尝试过多，请稍后再试。' },
      { status: 403 },
      { status: 200, serverMessage: '服务响应异常，请稍后重试' },
    ];
    for (const context of cases) {
      expect(loginFailureMessage(context)).toBe(sharedLoginFailureMessage(context));
    }
  });

  it('登录接口异常与网络失败分别给出可操作提示', () => {
    expect(loginFailureMessage({})).toBe('登录失败，请稍后重试');
    expect(loginFailureMessage({ networkError: true })).toBe('网络连接失败，请检查网络后重试');
    expect(loginFailureMessage({ timedOut: true })).toBe('登录超时，请稍后重试');
    expect(loginFailureMessage({ status: 503 })).toBe('服务器暂时不可用，请稍后重试');
  });
});
