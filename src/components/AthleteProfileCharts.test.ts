import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { AthleteProfileOverview, BirthplaceMapOverview } from './AthleteProfileCharts';

it.each([false, true])('缺少生源数据时地图提示不占用独立布局列（个人视图：%s）', individual => {
  const html = renderToStaticMarkup(createElement(BirthplaceMapOverview, { profiles: [], individual }));
  expect(html).toContain('class="birthplace-map-stage"><p');
  expect(html).toContain('暂无真实生源数据');
  expect(html).not.toContain('示例图形');
  expect(html).toContain('<aside class="birthplace-detail"');
  expect(html).toContain('中国省级代表和输送单位分布图');
});

it('个人没有档案时仍显示年龄、身高、体重三个字段', () => {
  const html = renderToStaticMarkup(createElement(AthleteProfileOverview, {
    profiles: [],
    individual: true,
    asOf: '2026-01-03',
  }));
  expect(html).toContain('暂无档案画像数据');
  for (const label of ['年龄', '身高', '体重']) expect(html).toContain(`>${label}<`);
});

it('空队伍保留全部身体画像图表及空数据提示', () => {
  const html = renderToStaticMarkup(createElement(AthleteProfileOverview, {
    profiles: [],
    individual: false,
    asOf: '2026-01-03',
  }));
  for (const title of ['身高—体重分布', '年龄结构', '竞技水平', '身体成分', '训练年限']) {
    expect(html).toContain(`>${title}<`);
  }
  expect(html).toContain('暂无完整身高体重记录');
  expect(html).toContain('暂无年龄记录');
  expect(html).toContain('暂无真实技术等级');
  expect(html).not.toContain('recharts-scatter-symbol');
});
