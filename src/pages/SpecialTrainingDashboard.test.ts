import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import type { Project } from '../types';
vi.mock('../components/SpecialChampionModel', () => ({
  SpecialChampionModel: ({ project }: { project: string }) => createElement('section', { 'data-champion-project': project }, '冠军模型：世界最好成绩与男女陆上模型'),
}));
vi.mock('../components/EChart', () => ({ EChart: () => null }));
import { SpecialTrainingDashboard } from './SpecialTrainingDashboard';
function render(project: Project) {
  return renderToStaticMarkup(createElement(SpecialTrainingDashboard, { project, from: '2026-10-01', to: '2026-10-31', onPlanOpen() {} }));
}
it('赛艇专项首页在训练数据未加载时也挂载原冠军模型', () => {
  const html = render('ROWING');
  expect(html).toContain('data-champion-project="ROWING"');
  expect(html).not.toContain('专业参考标准需审核');
});
it.each(['CYCLING_ROAD', 'VOLLEYBALL'] as const)('%s不装配水上专项冠军模型', project => {
  expect(render(project)).not.toContain('data-champion-project');
});

it('全局队伍筛选由应用维护，专项首页不再显示局部队伍选择', () => {
  const html = renderToStaticMarkup(createElement(SpecialTrainingDashboard, {
    project: 'ROWING', teamId: 12, from: '2026-10-01', to: '2026-10-31', onPlanOpen() {},
  }));
  expect(html).not.toContain('专项训练队伍筛选');
  expect(html).toContain('正在同步专项训练数据');
});
