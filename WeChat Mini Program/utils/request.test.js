import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

describe('小程序请求地址', () => {
  it('让普通请求和上传请求保持同一 HTTPS 域名', () => {
    const source = readFileSync(new URL('./request.js', import.meta.url), 'utf8');

    expect(source).toContain('function buildRequestUrl(baseUrl, path)');
    expect(source.match(/const url = buildRequestUrl\(getApiBaseUrl\(\), path\);/g)).toHaveLength(3);
    expect(source).toContain('url,');
  });

  it('在开启诊断时记录请求、响应、失败和完成阶段，但不记录令牌或响应正文', () => {
    const source = readFileSync(new URL('./request.js', import.meta.url), 'utf8');

    expect(source).toContain('function traceNetwork(stage, detail)');
    expect(source).toContain('function summarizeUrl(url)');
    expect(source).toContain('function responseMessage(data)');
    expect(source).toContain('function classifyNetworkFailure(error, lifecycle)');
    expect(source).toContain("traceNetwork('请求开始'");
    expect(source).toContain("traceNetwork('请求已派发'");
    expect(source).toContain("traceNetwork('响应头已收到'");
    expect(source).toContain("'响应成功'");
    expect(source).toContain("'响应异常'");
    expect(source).toContain("traceNetwork('请求失败'");
    expect(source).toContain("traceNetwork('请求完成'");
    expect(source).not.toContain('Authorization: headers.Authorization');
    expect(source).not.toContain('console.log(response.data');
    expect(source).not.toContain('console.log(headers.Authorization');
    expect(source).toContain('url: summarizeUrl(url),');
    expect(source).toContain('message: responseMessage(response.data),');
    expect(source).toContain('receivedResponseHeaders: lifecycle.receivedResponseHeaders');
  });
});

function diagnosticClient(envVersion, failRequest = false, brokenDiagnostic = false) {
  const logs = [];
  const module = { exports: {} };
  const wx = {
    getAccountInfoSync: () => ({ miniProgram: { envVersion } }),
    getAppBaseInfo: () => ({ SDKVersion: '3.0.0', version: '8.0.0' }),
    getNetworkType: ({ success }) => {
      if (brokenDiagnostic) throw new Error('诊断接口不可用');
      success({ networkType: 'wifi' });
    },
    getStorageSync: () => 'private-token',
    request(options) {
      if (failRequest) {
        const error = { errMsg: 'request:fail net::ERR_CONNECTION_RESET https://api.example.com/?token=private-token&username=private-account', errCode: -101 };
        options.fail(error);
        options.complete(error);
      } else {
        options.success({ statusCode: 200, header: { 'x-request-id': 'private-header-token', 'content-type': 'private-header-name' }, data: { token: 'private-result-token', user: { name: 'private-name' } } });
        options.complete({ statusCode: 200 });
      }
      return {};
    }
  };
  vm.runInNewContext(readFileSync(new URL('./request.js', import.meta.url), 'utf8'), {
    module, wx, console: { log: (...values) => {
      if (brokenDiagnostic) throw new Error('Console 不可用');
      logs.push(values);
    } },
    require: (path) => path === '../config'
      ? { NETWORK_DEBUG: false, API_ENVIRONMENT: 'production', TOKEN_KEY: 'token', getApiBaseUrl: () => 'https://www.jingjity.xin' }
      : { networkErrorMessage: () => '网络连接被重置' }
  });
  return { client: module.exports, logs };
}

describe('真机网络诊断', () => {
  it('开发版自动记录分阶段请求且不输出账号、密码和令牌值', async () => {
    const { client, logs } = diagnosticClient('develop');
    await client.request('/api/auth/login', { method: 'POST', auth: false, traceId: 'login-test', data: { username: 'private-account', password: 'private-password' } });
    const output = JSON.stringify(logs);
    expect(output).toContain('请求开始');
    expect(output).toContain('响应成功');
    expect(output).toContain('请求完成');
    expect(output).toContain('login-test');
    expect(output).toContain('https://www.jingjity.xin/api/auth/login');
    expect(output).not.toMatch(/private-account|private-password|private-token|private-result-token|private-name|private-header-token|private-header-name/);
  });

  it('体验版连接重置时记录发生在响应头之前，并保留同一追踪编号', async () => {
    const { client, logs } = diagnosticClient('trial', true);
    await expect(client.request('/api/auth/login', { traceId: 'reset-test' })).rejects.toThrow('网络连接被重置');
    const output = JSON.stringify(logs);
    expect(output).toContain('连接被重置');
    expect(output).toContain('收到服务端响应头之前');
    expect(output).toContain('reset-test');
    expect(output).not.toMatch(/private-token|private-account/);
  });

  it('Console 与网络环境探测抛错时仍可正常完成请求', async () => {
    const { client } = diagnosticClient('develop', false, true);
    await expect(client.request('/api/auth/login')).resolves.toMatchObject({ token: 'private-result-token' });
  });

  it('正式版默认不输出诊断日志', async () => {
    const { client, logs } = diagnosticClient('release');
    await client.request('/api/auth/login');
    expect(logs).toEqual([]);
  });
});

function errorClient({ success, fail, route = 'pages/index/index' }) {
  const calls = { reLaunch: [], removedKeys: [] };
  const module = { exports: {} };
  const wx = {
    getAccountInfoSync: () => ({ miniProgram: { envVersion: 'release' } }),
    getAppBaseInfo: () => ({ SDKVersion: '3.0.0', version: '8.0.0' }),
    getNetworkType: ({ success: done }) => done({ networkType: 'wifi' }),
    getStorageSync: () => 'stored-token',
    removeStorageSync: (key) => calls.removedKeys.push(key),
    reLaunch(options) {
      calls.reLaunch.push(options.url);
      if (options.complete) options.complete();
    },
    request(options) {
      if (fail) options.fail(fail);
      else options.success(success);
      options.complete(fail || { statusCode: success.statusCode });
      return {};
    }
  };
  vm.runInNewContext(readFileSync(new URL('./request.js', import.meta.url), 'utf8'), {
    module, wx, console: { log: () => {} },
    getApp: () => ({ clearSession: () => {} }),
    getCurrentPages: () => [{ route }],
    setTimeout: (callback) => callback(),
    require: (path) => path === '../config'
      ? { NETWORK_DEBUG: false, API_ENVIRONMENT: 'production', TOKEN_KEY: 'token', getApiBaseUrl: () => 'https://www.jingjity.xin' }
      : { networkErrorMessage: () => '网络连接失败，请检查网络后重试' }
  });
  return { client: module.exports, calls };
}

function rejected(promise) {
  return promise.then(() => null, (error) => error);
}

describe('登录失败与会话失效的区分', () => {
  it('登录接口返回 401 时不清理会话、不跳转，并携带业务错误码', async () => {
    const { client, calls } = errorClient({
      success: {
        statusCode: 401,
        header: { 'content-type': 'application/json' },
        data: { message: '账号或密码错误，请重新输入', code: 'INVALID_CREDENTIALS' }
      }
    });
    const error = await rejected(client.request('/api/auth/login', { method: 'POST', auth: false, data: { username: 'u', password: 'p' } }));
    expect(error.message).toBe('账号或密码错误，请重新输入');
    expect(error.code).toBe('INVALID_CREDENTIALS');
    expect(error.serverMessage).toBe('账号或密码错误，请重新输入');
    expect(error.statusCode).toBe(401);
    expect(calls.reLaunch).toEqual([]);
    expect(calls.removedKeys).toEqual([]);
  });

  it('已登录请求返回 401 时清理会话并跳转登录页', async () => {
    const { client, calls } = errorClient({
      success: {
        statusCode: 401,
        header: { 'content-type': 'application/json' },
        data: { message: '登录状态已失效，请重新登录。', code: 'SESSION_EXPIRED' }
      }
    });
    const error = await rejected(client.request('/api/me'));
    expect(error.code).toBe('SESSION_EXPIRED');
    expect(calls.removedKeys).toEqual(['token']);
    expect(calls.reLaunch).toEqual(['/pages/login/login']);
  });

  it('已在登录页时只清理会话，不重复 reLaunch', async () => {
    const { client, calls } = errorClient({
      route: 'pages/login/login',
      success: {
        statusCode: 401,
        header: { 'content-type': 'application/json' },
        data: { message: '登录状态已失效，请重新登录。', code: 'SESSION_EXPIRED' }
      }
    });
    await rejected(client.request('/api/me'));
    expect(calls.removedKeys).toEqual(['token']);
    expect(calls.reLaunch).toEqual([]);
  });

  it('网络失败与超时分别标记失败类别', async () => {
    const network = errorClient({ fail: { errMsg: 'request:fail net::ERR_CONNECTION_RESET' } });
    const networkError = await rejected(network.client.request('/api/auth/login', { auth: false }));
    expect(networkError.kind).toBe('network');

    const timeout = errorClient({ fail: { errMsg: 'request:fail timeout' } });
    const timeoutError = await rejected(timeout.client.request('/api/auth/login', { auth: false }));
    expect(timeoutError.kind).toBe('timeout');
  });

  it('服务端 5xx 保留状态码供上层统一提示', async () => {
    const { client } = errorClient({
      success: {
        statusCode: 500,
        header: { 'content-type': 'application/json' },
        data: { message: 'SQLITE_BUSY: database is locked', code: 'SERVER_ERROR' }
      }
    });
    const error = await rejected(client.request('/api/auth/login', { method: 'POST', auth: false, data: {} }));
    expect(error.statusCode).toBe(500);
    expect(error.code).toBe('SERVER_ERROR');
  });
});

describe('注册字段错误透传', () => {
  it('仅透传生日性别的有限字符串错误，不泄漏额外字段', async () => {
    const { client } = errorClient({ success: { statusCode: 400, data: {
      message: '资料不合法', fieldErrors: { birthDate: '请选择有效出生日期', gender: '请选择性别', unknownField: '不应透传' }
    } } });
    const error = await rejected(client.request('/api/auth/register', { method: 'POST', auth: false }));
    expect(error.fieldErrors).toEqual({ birthDate: '请选择有效出生日期', gender: '请选择性别' });
  });
  it('忽略非字符串与过长字段错误', async () => {
    const { client } = errorClient({ success: { statusCode: 400, data: {
      message: '资料不合法', fieldErrors: { birthDate: { message: '错误' }, gender: '错'.repeat(201) }
    } } });
    const error = await rejected(client.request('/api/auth/register', { method: 'POST', auth: false }));
    expect(error.fieldErrors).toEqual({});
  });
});
