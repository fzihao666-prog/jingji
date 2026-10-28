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
  expect(charts.data).toContainEqual(data.map((row) => expect.objectContaining(row)));
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

it.each(['ROWING','VOLLEYBALL','CYCLING_ROAD'])('%s占比图例不显示其他项目类别',project=>{
 const html=renderToStaticMarkup(createElement(TrainingContentChart,{records:[],project}));
 if(project==='VOLLEYBALL'){expect(html).not.toContain('水上');expect(html).not.toContain('测功仪');expect(html).toContain('排球技术');}
 if(project==='CYCLING_ROAD'){expect(html).not.toContain('排球技术');expect(html).not.toContain('水上');}
 if(project==='ROWING'){expect(html).toContain('骑行');expect(html).not.toContain('排球技术');}
});

it('FMS缺测保留雷达结构和空提示，不伪造零分', () => {
  const html = renderToStaticMarkup(createElement(FmsPersonalChart, { measurements: [] }));
  expect(html).toContain('暂无FMS测试数据');
  expect(html).toContain('fms-radar-center');
  expect(charts.data.at(-1)).toHaveLength(7);
  expect(charts.data.at(-1)).toEqual(expect.arrayContaining([expect.objectContaining({ score: null })]));
  expect(html).not.toContain('training-analytics-empty');
  expect(html).toContain('已完成 0/7 项筛查');
});
it('FMS真实零分仍显示评分与雷达，不误判为空状态', () => {
  const measurement: import('../types').OverviewMeasurement = {
    code: 'fms_deep_squat',
    label: '深蹲',
    domain: 'fms',
    value: 0,
    target: 2,
    previous: null,
    changePct: null,
    unit: '分',
    quality: 'valid',
    source: 'manual',
    sampleCount: 1,
    isDemo: false,
  };
  const html = renderToStaticMarkup(
    createElement(FmsPersonalChart, { measurements: [measurement] })
  );
  expect(html).not.toContain('暂无FMS测试数据');
  expect(html).toContain('fms-radar-center');
  expect(html).toContain('已完成 1/7 项筛查');
});

it('强度空态保留七类图例，缺失显示横线，真实零正常显示', () => {
  const empty = renderToStaticMarkup(createElement(TrainingIntensityChart, { data: [] }));
  for (const zone of ['U3', 'U2', 'U1', 'AT', 'TPT', 'AN', 'ATP']) expect(empty).toContain(`<b>${zone}</b>`);
  expect(empty).toContain('—');
  const zero = renderToStaticMarkup(createElement(TrainingIntensityChart, { data: [{ zone: 'U3', durationMin: 0, sessionCount: 1, percentage: 0 }] }));
  expect(zero).toContain('0 分');
  expect(zero).toContain('0%');
});
