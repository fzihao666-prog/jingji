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
    expect(html).toContain('生成并下载 Word');
    expect(html).not.toContain('历史报告');
    expect(html).not.toContain('周总结预览');
    expect(html).not.toContain('保存并下载');
  });
});
