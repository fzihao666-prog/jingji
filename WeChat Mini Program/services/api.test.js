import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

function client(request) {
  const module = { exports: {} };
  vm.runInNewContext(readFileSync(new URL('./api.js', import.meta.url), 'utf8'), {
    module, require: () => ({ request }),
  });
  return module.exports;
}

describe('AI 计划请求等待与错误提示', () => {
  it('生成与修订使用独立的长超时，普通请求不受影响', async () => {
    const calls = [];
    const api = client((path, options) => { calls.push({ path, options }); return Promise.resolve({}); });
    await api.generateAiTeamPlan({ teamId: 1 });
    await api.reviseAiTeamPlan(1, { instruction: '减量' });
    await api.teamPlans();
    expect(calls[0].options.timeout).toBe(240000);
    expect(calls[1].options.timeout).toBe(240000);
    expect(calls[2].options?.timeout).toBeUndefined();
  });

  it('超时提示先查看草稿，避免误报断网和重复生成', async () => {
    const error = Object.assign(new Error('网络请求超时'), { kind: 'timeout' });
    const api = client(() => Promise.reject(error));
    await expect(api.generateAiTeamPlan({ teamId: 1 })).rejects.toThrow('请先刷新计划列表');
    expect(error.kind).toBe('timeout');
  });

  it('保留服务端业务错误', async () => {
    const error = new Error('当前环境未配置可用的AI模型。');
    const api = client(() => Promise.reject(error));
    await expect(api.reviseAiTeamPlan(1, {})).rejects.toBe(error);
  });
});
