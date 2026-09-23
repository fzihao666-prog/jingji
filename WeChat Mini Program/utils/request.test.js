import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('小程序请求地址', () => {
  it('让普通请求和上传请求保持同一 HTTPS 域名', () => {
    const source = readFileSync(new URL('./request.js', import.meta.url), 'utf8');

    expect(source).toContain('function buildRequestUrl(baseUrl, path)');
    expect(source.match(/const url = buildRequestUrl\(getApiBaseUrl\(\), path\);/g)).toHaveLength(2);
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
