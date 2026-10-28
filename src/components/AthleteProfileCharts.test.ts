import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { BirthplaceMapOverview } from './AthleteProfileCharts';

it.each([false, true])('缺少生源数据时地图提示不占用独立布局列（个人视图：%s）', individual => {
  const html = renderToStaticMarkup(createElement(BirthplaceMapOverview, { profiles: [], individual }));
  expect(html).toContain('class="birthplace-map-stage"><p');
  expect(html).toContain('暂无真实生源数据');
  expect(html).not.toContain('示例图形');
  expect(html).toContain('<aside class="birthplace-detail"');
  expect(html).toContain('中国省级代表和输送单位分布图');
});
