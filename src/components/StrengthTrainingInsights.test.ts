import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { StrengthAnalysisPanel } from './StrengthTrainingInsights';

it('通用力量分析空状态不展示水上强度与水陆负荷，不生成模拟占比', () => {
  const html = renderToStaticMarkup(createElement(StrengthAnalysisPanel, { sessions: [] }));
  expect(html).toContain('训练环境记录占比');
  expect(html).toContain('暂无训练环境记录');
  expect(html).toContain('暂无强度区间数据');
  expect(html).not.toContain('U3 / U2');
  expect(html).not.toContain('水陆训练负荷');
});
