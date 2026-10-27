import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, expect, it, vi } from 'vitest';
import type { OverviewPayload } from '../types';
const charts = vi.hoisted(() => ({ data: [] as unknown[][] }));
vi.mock('recharts', () => {
  const component = ({ children, data }: { children?: ReactNode; data?: unknown[] }) => {
    if (data) charts.data.push(data);
    return createElement('svg', null, children);
  };
  return Object.fromEntries(
    [
      'Area',
      'AreaChart',
      'Bar',
      'BarChart',
      'CartesianGrid',
      'Cell',
      'ComposedChart',
      'Legend',
      'Line',
      'Pie',
      'PieChart',
      'ReferenceLine',
      'ResponsiveContainer',
      'Tooltip',
      'XAxis',
      'YAxis',
      'RadarChart',
      'Radar',
      'PolarGrid',
      'PolarAngleAxis',
      'PolarRadiusAxis',
    ].map((key) => [key, component])
  );
});
import {
  FmsPersonalChart,
  FmsTeamChart,
  TrainingContentChart,
  TrainingIntensityChart,
  TrainingLoadEnergyChart,
  TrainingVolumeChart,
  TrainingVolumeDashboard,
} from './TrainingAnalysisCharts';
import { TrendChart, TypeDonut } from '../pages/SpecialTestsPage';
beforeEach(() => {
  charts.data = [];
});
const summary: OverviewPayload['trainingAnalytics']['summary'] = {
  totalDurationMin: null,
  testDurationMin: null,
  recoveryDurationMin: null,
  specialDurationMin: null,
  specialDistanceKm: null,
  specialLoad: null,
  specialSessionCount: 0,
  physicalDurationMin: null,
  physicalLoad: null,
  physicalSessionCount: 0,
  rpeAverage: null,
  rpeHighest: null,
  rpeLowest: null,
};
it('空训练图表保留模块与空状态，不生成趋势、FMS、热图或占比测量', () => {
  const html = renderToStaticMarkup(
    createElement(
      'div',
      null,
      createElement(TrainingVolumeChart, {
        data: {
          days: [],
          totalDurationMin: null,
          totalDistanceKm: null,
          averageDurationMin: null,
          averageDistanceKm: null,
          durationDayCount: 0,
          distanceDayCount: 0,
        },
        from: '2026-01-01',
        to: '2026-01-03',
      }),
      createElement(TrainingVolumeDashboard, {
        data: { summary, days: [] },
        physiology: { metrics: [] },
        from: '2026-01-01',
        to: '2026-01-03',
      }),
      createElement(TrainingContentChart, { records: [] }),
      createElement(TrainingIntensityChart, { data: [] }),
      createElement(FmsTeamChart, { measurements: [] }),
      createElement(FmsPersonalChart, { measurements: [] }),
      createElement(TrainingLoadEnergyChart, {
        data: {
          specialLoad: 0,
          physicalLoad: 0,
          recoveryLoad: 0,
          totalLoad: 0,
          specialPercentage: 0,
          physicalPercentage: 0,
          recoveryPercentage: 0,
        },
      })
    )
  );
  expect(html).toContain('暂无');
  expect(html).not.toContain('示例');
  expect(html).not.toContain('sample-');
  expect(html).not.toContain('指标一');
  expect(html).not.toMatch(/height:(50|30|20)%/);
  for (const rows of charts.data)
    for (const row of rows) {
      if (typeof row !== 'object' || row === null) continue;
      // 圆环底色只有几何尺寸，不是测量序列。
      if (Object.keys(row).length === 1) continue;
      for (const [key, value] of Object.entries(row)) {
        if (
          [
            'durationMin',
            'distanceKm',
            'specialLoad',
            'physicalLoad',
            'averageRpe',
            'score',
          ].includes(key)
        )
          expect(value).toBeNull();
        if (key === 'name' && 'value' in row) expect((row as { value: unknown }).value).toBe(0);
      }
    }
});
it('强度图保留传入体系分组，不丢失非固定区间', () => {
  const data = [
    { zone: 'FTP · Z2', durationMin: 30, sessionCount: 1, percentage: 50 },
    { zone: 'HR · Z2', durationMin: 30, sessionCount: 1, percentage: 50 },
  ];
  const html = renderToStaticMarkup(createElement(TrainingIntensityChart, { data }));
  expect(html).toContain('FTP · Z2');
  expect(html).toContain('HR · Z2');
  expect(charts.data).toContainEqual(data);
});
it('专项趋势与占比无记录不造数，真实零仍保留', () => {
  const html = renderToStaticMarkup(
    createElement(
      'div',
      null,
      createElement(TrendChart, { data: [], metric: 'power' }),
      createElement(TypeDonut, { sessions: [] })
    )
  );
  expect(html).toContain('暂无');
  expect(html).not.toContain('示例');
  expect(charts.data.every((rows) => rows.length === 0)).toBe(true);
  charts.data = [];
  renderToStaticMarkup(
    createElement(TrendChart, {
      data: [
        {
          date: '01/01',
          isoDate: '2026-01-01',
          duration: 0,
          distance: 0,
          load: 0,
          rate: null,
          heart: null,
          power: 0,
          chronic: 0,
          rateCount: 0,
          heartCount: 0,
          powerCount: 1,
        },
      ],
      metric: 'power',
    })
  );
  expect(charts.data.flat()).toContainEqual(expect.objectContaining({ power: 0, date: '01/01' }));
});
