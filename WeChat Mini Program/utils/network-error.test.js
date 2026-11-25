import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('./network-error.js', import.meta.url), 'utf8');
const context = { module: { exports: {} } };
vm.runInNewContext(source, context);
const { networkErrorMessage } = context.module.exports;

describe('真机网络失败提示', () => {
  it('连接重置指向 HTTPS 接入检查，不误报密码错误', () => {
    expect(networkErrorMessage({ errMsg: 'request:fail net::ERR_CONNECTION_RESET' })).toContain('HTTPS');
    expect(networkErrorMessage({ errMsg: 'request:fail net::ERR_CONNECTION_RESET' })).toContain('连接被重置');
  });
  it('区分微信域名校验、证书和超时问题', () => {
    expect(networkErrorMessage({ errMsg: 'request:fail url not in domain list' })).toContain('合法域名');
    expect(networkErrorMessage({ errMsg: 'request:fail SSL handshake failed' })).toContain('证书');
    expect(networkErrorMessage({ errMsg: 'request:fail timeout' })).toContain('超时');
  });
  it('不把原始错误中的私有内容暴露给用户', () => {
    expect(networkErrorMessage({ errMsg: 'unexpected https://example.invalid/?token=test-secret' })).not.toContain('test-secret');
  });
});
