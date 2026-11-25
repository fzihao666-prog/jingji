import { init } from 'echarts';
import { describe, expect, it } from 'vitest';
import { emptyChartOption } from './empty-chart-option';

describe('空图表实际渲染', () => {
  it.each(['line', 'bar', 'radar', 'pie'] as const)('%s 保留可渲染结构且不泄露占位成绩', (type) => {
    const chart = init(null, undefined, { renderer: 'svg', ssr: true, width: 480, height: 300 });
    try {
      chart.setOption(emptyChartOption({
        animation: false,
        ...(type === 'radar' ? { radar: { indicator: [{ name: '力量', max: 100 }, { name: '耐力', max: 100 }, { name: '速度', max: 100 }] } }
          : type === 'pie' ? {} : { xAxis: { type: 'category', data: ['周一', '周二'] }, yAxis: { type: 'value' } }),
        series: [{ type, name: '训练', data: [] }],
      }));
      const svg = chart.renderToSVGString();
      expect(svg).toContain('<svg');
      expect(svg).toMatch(/<(path|polyline)/);
      expect(chart.getOption()).toMatchObject({ tooltip: [{ show: false }], series: [{ data: [] }] });
    } finally { chart.dispose(); }
  });
});
