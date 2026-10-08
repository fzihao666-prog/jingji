import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const template = readFileSync(new URL('../../components/pager-nav/index.wxml', import.meta.url), 'utf8');
const overview = readFileSync(new URL('./index.wxml', import.meta.url), 'utf8');
const overviewStyle = readFileSync(new URL('./index.wxss', import.meta.url), 'utf8');

describe('待办分页无障碍状态', () => {
  it('翻页控件在翻页后播报当前页，不依赖非标准 aria-role', () => {
    // 翻页 UI 已统一抽到 components/pager-nav，所有人员列表共用同一份标记。
    expect(template).toMatch(/class="pager-nav-indicator"[^>]*aria-live="polite"[^>]*aria-atomic="true"/);
    expect(template).not.toContain('aria-role=');
  });

  it('页面不保留内联翻页标记，统一走 pager-nav 组件', () => {
    expect(overview).not.toContain('todo-pager');
    expect(overview).toContain('pager-nav');
  });
});

describe('训练总览移动端布局', () => {
  it('按核心数据、负荷趋势、结构、RPE、状态监测、运动员列表排序', () => {
    const headings = ['周期核心数据', '训练负荷趋势', '训练结构', 'RPE 状态趋势', '状态监测', '队伍运动员'];
    const positions = headings.map((heading) => overview.indexOf(heading));
    expect(positions.every((position) => position >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((left, right) => left - right));
  });

  it('主趋势图不依赖横向滚动或固定超宽画布，人员翻页保留最多五人分页组件', () => {
    expect(overview).not.toContain('trend-scroll');
    expect(overview).not.toContain('scroll-x');
    expect(overviewStyle).not.toMatch(/\.trend-chart\s*\{[^}]*min-width\s*:/);
    expect(overviewStyle).toContain('width: 100%');
    expect(overview).toContain('data-key="focus"');
    expect(overview).toContain('data-key="team"');
  });

  it('无真实数据时明确显示空状态，不把示例值渲染进训练总览', () => {
    expect(overview).toContain('最近14天暂无真实专项或体能负荷记录');
    expect(overview).toContain('当前周期暂无真实 RPE 记录');
    expect(overview).not.toContain('示例数据');
  });
});
