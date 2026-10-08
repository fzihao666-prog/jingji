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
