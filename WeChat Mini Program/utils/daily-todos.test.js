import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

const formatDataContext = { module: { exports: {} } };
vm.runInNewContext(readFileSync(new URL('../data/format-data.js', import.meta.url), 'utf8'), formatDataContext);
const formatContext = { module: { exports: {} }, require: () => formatDataContext.module.exports };
vm.runInNewContext(readFileSync(new URL('./format.js', import.meta.url), 'utf8'), formatContext);
const paginationContext = { module: { exports: {} } };
vm.runInNewContext(readFileSync(new URL('./pagination.js', import.meta.url), 'utf8'), paginationContext);
const context = {
  module: { exports: {} },
  require: (path) => (path === './pagination' ? paginationContext.module.exports : formatContext.module.exports),
};
vm.runInNewContext(readFileSync(new URL('./daily-todos.js', import.meta.url), 'utf8'), context);
const { dailyTodoView, filterDailyTodos, reviewDueLabel, paginateMissing, MISSING_PAGE_SIZE } = context.module.exports;
const athlete = { athleteId: 1, athleteName: '样例队员', team: '一队', project: 'ROWING' };
const payload = () => ({
  date: '2026-09-23', timezone: 'Asia/Shanghai', generatedAt: '2026-09-23T02:00:00Z',
  windowStart: '2026-09-22T02:00:00Z', highLoadThreshold: 600,
  counts: { total: 1, submitted: 0, missing: 1, attention: 1, incompleteTime: 0, reviewDue: 0 },
  missing: [athlete], incompleteTime: [],
  attention: [{ ...athlete, load24h: 600, highLoad: true, timeIncomplete: false, injury: null, restRequested: false }],
  reviewDue: [],
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
  it('拒绝缺少复查提醒分组的响应，两端须同步上线', () => {
    const data = payload();
    delete data.reviewDue;
    expect(() => dailyTodoView(data)).toThrow();
    const badCount = payload();
    badCount.counts.reviewDue = 2;
    expect(() => dailyTodoView(badCount)).toThrow();
  });
});

describe('自评需要休息', () => {
  it('restRequested 拼入关注原因且排在伤病之后、时间缺失之前', () => {
    const data = payload();
    const item = data.attention[0];
    item.highLoad = false;
    item.restRequested = true;
    item.timeIncomplete = true;
    item.injury = { athleteId: 1, status: 'observation', injuryName: '肩部不适', bodyPart: '肩部', painScore: 3, recent: false, createdAt: '2026-09-22 01:00:00' };
    const reason = dailyTodoView(data).attention[0].reason;
    expect(reason).toContain('自评需要休息');
    expect(reason.indexOf('伤病')).toBeLessThan(reason.indexOf('自评需要休息'));
    expect(reason.indexOf('自评需要休息')).toBeLessThan(reason.indexOf('开训时间'));
  });
  it('缺少 restRequested 字段视为畸形响应', () => {
    const data = payload();
    delete data.attention[0].restRequested;
    expect(() => dailyTodoView(data)).toThrow();
  });
});

describe('复查提醒分组', () => {
  const reviewItem = (overrides = {}) => ({
    athleteId: 1, athleteName: '样例队员', team: '一队', project: 'ROWING',
    reviewDate: '2026-09-24', dueIn: 1, injuryName: '肩部旧伤', bodyPart: '肩部',
    status: 'rehab', painScore: 3, ...overrides,
  });
  it('生成逾期、当天与剩余天数文案', () => {
    expect(reviewDueLabel(-3)).toBe('复查已逾期 3 天');
    expect(reviewDueLabel(0)).toBe('今天复查');
    expect(reviewDueLabel(2)).toBe('2 天后复查');
    expect(reviewDueLabel('x')).toBe('');
  });
  it('校验复查分组条目形状并生成 dueLabel', () => {
    const data = payload();
    data.counts.reviewDue = 1;
    data.reviewDue = [reviewItem()];
    expect(dailyTodoView(data).reviewDue[0].dueLabel).toBe('1 天后复查');
    const badStatus = payload();
    badStatus.counts.reviewDue = 1;
    badStatus.reviewDue = [reviewItem({ status: 'unknown' })];
    expect(() => dailyTodoView(badStatus)).toThrow();
  });
});

const roster = () => {
  const first = { athleteId: 1, athleteName: '张三', team: '一队', project: 'ROWING' };
  const second = { athleteId: 2, athleteName: '李四', team: '二队', project: 'ROWING' };
  const third = { athleteId: 3, athleteName: '王五', team: '二队', project: 'ROWING' };
  return dailyTodoView({
    date: '2026-09-23',
    timezone: 'Asia/Shanghai',
    generatedAt: '2026-09-23T02:00:00Z',
    windowStart: '2026-09-22T02:00:00Z',
    highLoadThreshold: 600,
    counts: { total: 3, submitted: 0, missing: 3, attention: 1, incompleteTime: 1, reviewDue: 1 },
    missing: [first, second, third],
    attention: [{ ...second, load24h: 700, highLoad: true, timeIncomplete: true, injury: null, restRequested: false }],
    incompleteTime: [second],
    reviewDue: [{ ...third, reviewDate: '2026-09-23', dueIn: 0, injuryName: '膝部旧伤', bodyPart: '膝部', status: 'rehab', painScore: 2 }],
  });
};

describe('待办分组筛选与姓名搜索', () => {
  it('默认展示全部分组并给出各组人数', () => {
    const view = filterDailyTodos(roster(), 'all', '');
    expect(view.show).toEqual({ missing: true, attention: true, review: true, incompleteTime: true });
    expect(view.counts).toEqual({ missing: 3, attention: 1, review: 1, incompleteTime: 1 });
    expect(view.groups.map((group) => group.count)).toEqual([6, 3, 1, 1, 1]);
    expect(view.groups.every((group) => (group.key === 'all' ? group.active : !group.active))).toBe(
      true
    );
  });

  it('切换分组时隐藏其他分组但不清零其人数', () => {
    const view = filterDailyTodos(roster(), 'attention', '');
    expect(view.show).toEqual({ missing: false, attention: true, review: false, incompleteTime: false });
    expect(view.missing).toEqual([]);
    expect(view.counts.missing).toBe(3);
    expect(view.groups.find((group) => group.key === 'attention').active).toBe(true);
    expect(view.groups.find((group) => group.key === 'review').count).toBe(1);
  });

  it('姓名或队伍搜索作用于所有分组', () => {
    const byName = filterDailyTodos(roster(), 'all', '李四');
    expect(byName.counts).toEqual({ missing: 1, attention: 1, review: 0, incompleteTime: 1 });
    const byTeam = filterDailyTodos(roster(), 'all', '一队');
    expect(byTeam.counts).toEqual({ missing: 1, attention: 0, review: 0, incompleteTime: 0 });
    const noMatch = filterDailyTodos(roster(), 'missing', '不存在的人');
    expect(noMatch.missing).toEqual([]);
    expect(noMatch.counts.missing).toBe(0);
    expect(noMatch.keyword).toBe('不存在的人');
  });

  it('未知分组回退到全部，缺少待办时不产生视图', () => {
    expect(filterDailyTodos(roster(), 'other', '').filter).toBe('all');
    expect(filterDailyTodos(null, 'all', '')).toBeNull();
  });
});

describe('未填报名单分页', () => {
  // paginateMissing 必须作用于"完整筛选后的名单"（页面在 filterDailyTodos 之后调用），
  // 因此夹具返回未分页的完整视图，每个断言独立分页。
  const fullView = (count) => {
    const missing = Array.from({ length: count }, (_, i) => ({
      athleteId: i + 1, athleteName: `队员${i + 1}`, team: '一队', project: 'ROWING',
    }));
    return filterDailyTodos(dailyTodoView({
      date: '2026-09-23', timezone: 'Asia/Shanghai', generatedAt: '2026-09-23T02:00:00Z',
      windowStart: '2026-09-22T02:00:00Z', highLoadThreshold: 600,
      counts: { total: count, submitted: 0, missing: count, attention: 0, incompleteTime: 0, reviewDue: 0 },
      missing, attention: [], incompleteTime: [], reviewDue: [],
    }), 'all', '');
  };

  it(`每页最多 ${MISSING_PAGE_SIZE} 人，页码信息完整`, () => {
    const view = paginateMissing(fullView(12), 0);
    expect(view.missing).toHaveLength(5);
    expect(view.missingPage).toEqual({ page: 0, pageCount: 3, total: 12, pageSize: 5, hasPrev: false, hasNext: true });
    expect(view.missing[0].athleteName).toBe('队员1');
    expect(view.counts.missing).toBe(12);
  });


  it('翻页切片正确，最后一页返回剩余人数', () => {
    const last = paginateMissing(fullView(12), 2);
    expect(last.missing).toHaveLength(2);
    expect(last.missing[0].athleteName).toBe('队员11');
    expect(last.missingPage).toMatchObject({ page: 2, hasPrev: true, hasNext: false });
  });

  it('页码越界收敛到最后一页，非法页码回到第一页', () => {
    expect(paginateMissing(fullView(6), 9).missingPage.page).toBe(1);
    expect(paginateMissing(fullView(6), -1).missingPage.page).toBe(0);
    expect(paginateMissing(fullView(6), 'x').missingPage.page).toBe(0);
  });

  it('空名单与单页名单不产生翻页控件', () => {
    const view = paginateMissing(fullView(0), 0);
    expect(view.missing).toEqual([]);
    expect(view.missingPage).toMatchObject({ page: 0, pageCount: 1, total: 0, hasPrev: false, hasNext: false });
    expect(paginateMissing(fullView(5), 0).missingPage.pageCount).toBe(1);
  });
});

describe('今日已跟进标记', () => {
  it('已跟进运动员从分组隐藏并收敛到 followedUpList，计数随之重算', () => {
    const todos = roster();
    todos.followedUp = [3];
    const view = filterDailyTodos(todos, 'all', '');
    expect(view.counts).toEqual({ missing: 2, attention: 1, review: 0, incompleteTime: 1 });
    expect(view.followedUpList).toHaveLength(1);
    // 王五同时属于未填报与复查提醒分组，去重后保留首个分组标签。
    expect(view.followedUpList[0]).toMatchObject({ athleteId: 3, groupLabel: '未填报' });
    expect(view.groups.find((group) => group.key === 'all').count).toBe(4);
    const reviewOnly = filterDailyTodos(todos, 'review', '');
    expect(reviewOnly.review).toEqual([]);
    expect(reviewOnly.followedUpList).toHaveLength(1);
  });

  it('已跟进对象同样参与关键词搜索', () => {
    const todos = roster();
    todos.followedUp = [1, 3];
    const view = filterDailyTodos(todos, 'all', '王五');
    expect(view.followedUpList.map((item) => item.athleteId)).toEqual([3]);
    expect(view.counts.review).toBe(0);
  });

  it('缺省 followedUp 时所有对象留在原分组', () => {
    const view = filterDailyTodos(roster(), 'all', '');
    expect(view.followedUpList).toEqual([]);
    expect(view.counts).toEqual({ missing: 3, attention: 1, review: 1, incompleteTime: 1 });
  });

  it('followedUp 必须是安全正整数数组', () => {
    const data = payload();
    data.followedUp = ['1'];
    expect(() => dailyTodoView(data)).toThrow();
    const negative = payload();
    negative.followedUp = [-1];
    expect(() => dailyTodoView(negative)).toThrow();
  });
});
