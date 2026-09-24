import { describe, expect, it } from 'vitest';
import guardModule from './request-guard.js';

const { createRequestGuard, loadWithGuard } = guardModule;

describe('request guard', () => {
  it('只允许最后发出的请求更新页面', async () => {
    const guard = createRequestGuard();
    const first = guard.next();
    const second = guard.next();
    expect(guard.isLatest(second)).toBe(true);
    expect(guard.isLatest(first)).toBe(false);
  });

  it('过期请求的成功、失败和结束均不改变页面', async () => {
    const data = {};
    const page = { setData(patch) { Object.assign(data, patch); } };
    const guard = createRequestGuard();
    let finishFirst;
    const first = loadWithGuard(page, guard, () => new Promise((resolve) => { finishFirst = resolve; }), '失败');
    const second = loadWithGuard(page, guard, async () => ({ value: '新数据' }), '失败');
    await second;
    finishFirst({ value: '旧数据' });
    await first;
    expect(data).toEqual({ loading: false, error: '', value: '新数据' });
  });

  it('项目 A、B、C 连续切换后只展示 C，晚返回的失败也被忽略', async () => {
    const data = {};
    const page = { setData(patch) { Object.assign(data, patch); } };
    const guard = createRequestGuard();
    let finishA;
    let failB;
    const a = loadWithGuard(page, guard, () => new Promise((resolve) => { finishA = resolve; }), '加载失败');
    const b = loadWithGuard(page, guard, () => new Promise((resolve, reject) => { failB = reject; }), '加载失败');
    const c = loadWithGuard(page, guard, async () => ({ project: 'C' }), '加载失败');
    await c;
    failB(new Error('B 失败'));
    finishA({ project: 'A' });
    await Promise.all([a, b]);
    expect(data).toEqual({ loading: false, error: '', project: 'C' });
  });
});
