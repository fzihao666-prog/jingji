import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
vi.mock('../components/SpecialPerformancePanel', () => ({ SpecialPerformancePanel: () => null }));
import { SpecialTestsPage } from './SpecialTestsPage';
import { StrengthTrainingAnalysisPage } from './StrengthTrainingAnalysisPage';

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

it.each(['ROWING', 'VOLLEYBALL'] as const)('%s 专项子页将训练计划和全局筛选放在同一组', (project) => {
  const html = renderToStaticMarkup(createElement(SpecialTestsPage, {
    records: [], project, from: '2026-10-01', to: '2026-10-31',
    loading: false, section: 'special-volume', onSectionChange() {}, onPlanOpen() {},
    filters: createElement('div', null, '全局训练筛选'),
  }));
  expect(html).toMatch(/app-page-header-filter-row[\s\S]*全局训练筛选[\s\S]*app-page-header-filter-actions[\s\S]*训练计划<\/button>/);
});

it('体能分析没有运动员时仍显示全局筛选和训练计划', () => {
  const html = renderToStaticMarkup(createElement(StrengthTrainingAnalysisPage, {
    athletes: [],
    athleteId: null,
    from: '2026-10-01',
    to: '2026-10-31',
    section: 'strength-analysis',
    user: { id: 1, username: 'coach', displayName: '测试教练', role: 'SCC', athleteId: null },
    onPlanOpen() {},
    onSectionChange() {},
    onChanged() {},
    filters: createElement('div', null, '全局训练筛选'),
  }));
  expect(html).toMatch(/app-page-header-filter-row[\s\S]*全局训练筛选[\s\S]*训练计划<\/button>/);
  expect(html).toContain('当前项目没有可统计的运动员');
});
