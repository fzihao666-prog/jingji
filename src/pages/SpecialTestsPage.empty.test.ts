import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
vi.mock('../components/SpecialPerformancePanel', () => ({ SpecialPerformancePanel: () => null }));
import { SpecialTestsPage } from './SpecialTestsPage';

it('专项记录全空时仍保留训练量、时间和构成分析模块', () => {
  const html = renderToStaticMarkup(createElement(SpecialTestsPage, {
    records: [], project: 'ROWING', from: '2026-10-01', to: '2026-10-31',
    loading: false, section: 'special-volume', onSectionChange() {}, onPlanOpen() {},
  }));
  expect(html).toContain('专项训练量趋势');
  expect(html).toContain('专项训练时间趋势');
  expect(html).toContain('训练量类别构成');
  expect(html).not.toContain('当前日期范围内暂无训练记录');
  expect(html).not.toContain('示例数据');
});
