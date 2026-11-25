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

it.each([
  ['default', ['快速选择时间范围', '开始日期', '选择项目大类', '全局队伍筛选']],
  ['scope-first', ['选择项目大类', '全局队伍筛选', '开始日期', '快速选择时间范围']],
] as const)('%s 布局按预期顺序渲染可操作控件', (layout, labels) => {
  const html = renderToStaticMarkup(createElement(DateToolbar, {
    layout,
    presetMode: 'period',
    project: 'ROWING',
    projects: ['ROWING'],
    from: '2026-10-01',
    to: '2026-10-28',
    onRangeChange() {},
    onProjectChange() {},
    onTeamChange() {},
  }));

  const positions = labels.map((label) => html.indexOf(`aria-label="${label}"`));
  expect(positions.every((position, index) =>
    position >= 0 && (index === 0 || position > positions[index - 1])
  )).toBe(true);
});
