import { describe, expect, it } from 'vitest';
import { LOGIN_ERROR_MESSAGES, loginErrorMessage, loginFailureMessage } from './login-errors.js';

describe('登录失败提示映射', () => {
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
  });

  it('网络失败与超时分别给出可重试提示', () => {
    expect(loginFailureMessage({ networkError: true })).toBe(LOGIN_ERROR_MESSAGES.NETWORK_ERROR);
    expect(loginFailureMessage({ timedOut: true, networkError: true })).toBe(
      LOGIN_ERROR_MESSAGES.TIMEOUT
    );
  });

  it('5xx 一律提示服务器异常，不展示服务端正文', () => {
    expect(
      loginFailureMessage({ status: 500, serverMessage: 'SQLITE_BUSY: database is locked' })
    ).toBe(LOGIN_ERROR_MESSAGES.SERVER_ERROR);
    expect(loginFailureMessage({ status: 502, serverMessage: 'Bad Gateway' })).toBe(
      LOGIN_ERROR_MESSAGES.SERVER_ERROR
    );
  });

  it('4xx 无错误码时使用服务端业务提示，无提示时兜底为登录失败', () => {
    expect(loginFailureMessage({ status: 429, serverMessage: '登录尝试过多，请稍后再试。' })).toBe(
      '登录尝试过多，请稍后再试。'
    );
    expect(loginFailureMessage({ status: 403 })).toBe(LOGIN_ERROR_MESSAGES.LOGIN_FAILED);
    expect(loginFailureMessage({ status: 200, serverMessage: '服务响应异常，请稍后重试' })).toBe(
      LOGIN_ERROR_MESSAGES.LOGIN_FAILED
    );
  });

  it('错误码优先于网络与状态推断', () => {
    expect(loginFailureMessage({ code: 'ACCOUNT_DISABLED', status: 403, networkError: true })).toBe(
      LOGIN_ERROR_MESSAGES.ACCOUNT_DISABLED
    );
    expect(loginFailureMessage({ code: 'RATE_LIMITED', status: 429 })).toBe(
      LOGIN_ERROR_MESSAGES.RATE_LIMITED
    );
  });
});
