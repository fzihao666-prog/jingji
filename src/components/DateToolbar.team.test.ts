import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { DateToolbar } from './DateToolbar';
it('公共队伍筛选位于项目后，保留全部队伍和日期', () => {
  const html = renderToStaticMarkup(createElement(DateToolbar, {
    project: 'ROWING', projects: ['ROWING'], from: '2026-10-01', to: '2026-10-28',
    onRangeChange() {}, onProjectChange() {}, onTeamChange() {}, teams: [], teamId: null,
  }));
  expect(html).toContain('全部队伍');
  expect(html.indexOf('全局队伍筛选')).toBeGreaterThan(html.indexOf('选择项目大类'));
  expect(html).toContain('2026-10-01');
  expect(html).toContain('2026-10-28');
});
