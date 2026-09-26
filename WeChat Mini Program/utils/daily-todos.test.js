import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

const formatDataContext = { module: { exports: {} } };
vm.runInNewContext(readFileSync(new URL('../data/format-data.js', import.meta.url), 'utf8'), formatDataContext);
const formatContext = { module: { exports: {} }, require: () => formatDataContext.module.exports };
vm.runInNewContext(readFileSync(new URL('./format.js', import.meta.url), 'utf8'), formatContext);
const context = { module: { exports: {} }, require: () => formatContext.module.exports };
vm.runInNewContext(readFileSync(new URL('./daily-todos.js', import.meta.url), 'utf8'), context);
const { dailyTodoView } = context.module.exports;
const athlete = { athleteId: 1, athleteName: '样例队员', team: '一队', project: 'ROWING' };
const payload = () => ({
  date: '2026-09-23', timezone: 'Asia/Shanghai', generatedAt: '2026-09-23T02:00:00Z',
  windowStart: '2026-09-22T02:00:00Z', highLoadThreshold: 600,
  counts: { total: 1, submitted: 0, missing: 1, attention: 1, incompleteTime: 0 },
  missing: [athlete], incompleteTime: [],
  attention: [{ ...athlete, load24h: 600, highLoad: true, timeIncomplete: false, injury: null }],
});

describe('每日待办响应与文案', () => {
  it('显示负荷值和明确关注原因，不只依靠颜色', () => {
    expect(dailyTodoView(payload()).attention[0].reason).toContain('600 AU');
  });
  it('合并伤病原因并区分24小时内更新与持续关注', () => {
    const data = payload();
    data.attention[0].injury = { athleteId: 1, status: 'observation', injuryName: '肩部不适', bodyPart: '肩部', painScore: 3, recent: true, createdAt: '2026-09-23 01:00:00' };
    expect(dailyTodoView(data).attention[0].reason).toContain('近24小时更新');
    data.attention[0].injury.recent = false;
    expect(dailyTodoView(data).attention[0].reason).toContain('持续伤病关注');
  });
  it('拒绝缺失名单或畸形ID，不能把错误响应显示为全部完成', () => {
    expect(() => dailyTodoView({})).toThrow();
    const data = payload();
    data.missing[0] = { ...athlete, athleteId: '1/../../admin' };
    expect(() => dailyTodoView(data)).toThrow();
  });
});
