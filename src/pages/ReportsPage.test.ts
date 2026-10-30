import { describe, expect, it } from 'vitest';
import { previousWeekDate } from './ReportsPage';
describe('周报默认周期', () => {
  it('按北京时间跨日、跨年选择上一完整自然周', () => {
    expect(previousWeekDate(new Date('2026-10-25T15:59:00Z'))).toBe('2026-10-12');
    expect(previousWeekDate(new Date('2026-10-25T16:00:00Z'))).toBe('2026-10-19');
    expect(previousWeekDate(new Date('2026-01-01T00:00:00Z'))).toBe('2025-12-22');
  });
});

describe('综合周总结入口', () => {
  it('范围选择不再要求报告类型且保留选填补充', async () => {
    const { renderToStaticMarkup } = await import('react-dom/server');
    const { createElement } = await import('react');
    const { ReportsPage } = await import('./ReportsPage');
    const html = renderToStaticMarkup(createElement(ReportsPage, { project: 'ROWING', teamId: 1 }));
    expect(html).not.toContain('报告类型');
    expect(html).not.toContain('体能训练周总结</option>');
    expect(html).toContain('补充信息（选填）');
    expect(html).toContain('一键生成周总结');
  });
});

it('综合预览完整呈现五段可编辑文案，恢复与下周均可修改', async () => {
  const { renderToStaticMarkup } = await import('react-dom/server');
  const { createElement } = await import('react');
  const { TeamWeeklyReportPreview } = await import('../components/TeamWeeklyReportPreview');
  const { CombinedEditable } = await import('../components/TeamWeeklyReportPreview.stories');
  const html = renderToStaticMarkup(createElement(TeamWeeklyReportPreview, CombinedEditable.args));
  expect(html.match(/<textarea/g)).toHaveLength(5);
  expect(html).toContain('aria-label="恢复分析文案"');
  expect(html).toContain('aria-label="下周安排文案"');
  expect(html).toContain('aria-label="3.1 本周重点训练内容 · 专项训练文案"');
  expect(html).toContain('aria-label="3.1 本周重点训练内容 · 体能训练文案"');
});
