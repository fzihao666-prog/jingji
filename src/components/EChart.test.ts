import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { EChart } from './EChart';
import { aggregateSpecialTraining } from '../../shared/special-training';
import { contentOption, intensityOption, loadOption, volumeOption } from './special-chart-options';

it('EChart缺少事实时保留图表容器，只说明暂无数据', () => {
  const html = renderToStaticMarkup(
    createElement(EChart, {
      option: { series: [{ type: 'line', data: [36, 52, 44] }] },
      label: '训练趋势',
      isPlaceholder: true,
    })
  );
  expect(html).toContain('app-echart');
  expect(html).toContain('暂无当前周期真实数据');
  expect(html).not.toContain('示例');
});
it('专项options的空状态不生成趋势或比例数据', () => {
  const data = aggregateSpecialTraining([]);
  const timestamp = Date.parse('2026-01-01T00:00:00Z');
  expect(volumeOption(data, '2026-01-01', '2026-01-01', true)).toMatchObject({
    series: [{ data: [[timestamp, null]] }, { data: [[timestamp, null]] }],
  });
  expect(loadOption(data, '2026-01-01', '2026-01-01', true)).toMatchObject({
    series: [{ data: [[timestamp, null]] }],
  });
  expect(intensityOption(data, true)).toMatchObject({ series: [{ data: [] }] });
  expect(contentOption(data, true)).toMatchObject({ series: [{ data: [] }] });
});
it('专项options保留真实零和缺失值，不用示例替换', () => {
  const data: ReturnType<typeof aggregateSpecialTraining> = {
    ...aggregateSpecialTraining([]),
    days: [{ date: '2026-01-01', durationMin: 0, distanceKm: 0, load: 0, sessionCount: 1 }],
    intensity: [{ name: '未知', durationMin: null, percentage: 0 }],
    content: [{ name: '专项', count: 1, percentage: 100 }],
  };
  const timestamp = Date.parse('2026-01-01T00:00:00Z');
  expect(volumeOption(data, '2026-01-01', '2026-01-01')).toMatchObject({
    series: [{ data: [[timestamp, 0]] }, { data: [[timestamp, 0]] }],
  });
  expect(loadOption(data, '2026-01-01', '2026-01-01')).toMatchObject({
    series: [{ data: [[timestamp, 0]] }],
  });
  expect(intensityOption(data)).toMatchObject({
    series: [{ data: [{ name: '未知', value: undefined }] }],
  });
  expect(contentOption(data)).toMatchObject({ series: [{ data: [1] }] });
});

it('空态渲染保留坐标与图例，删除示例值并禁用提示', async () => {
  const { emptyChartOption } = await import('./empty-chart-option');
  const option = { xAxis: { type: 'category' as const, data: ['周一'] }, legend: {}, series: [{ type: 'line' as const, data: [36] }] };
  const result = emptyChartOption(option);
  expect(result.xAxis).toEqual(option.xAxis);
  expect(result.legend).toEqual(option.legend);
  expect(result).toMatchObject({ tooltip: { show: false }, series: [{ data: [], silent: true }] });
  expect(option.series[0].data).toEqual([36]);
  expect(emptyChartOption({ series: [{ type: 'pie', data: [] }] })).toMatchObject({ series: [{ showEmptyCircle: true, data: [] }] });
});
