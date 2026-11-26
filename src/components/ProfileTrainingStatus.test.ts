import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, expect, it, vi } from 'vitest';
import type { EChartsOption } from 'echarts';
import * as echarts from 'echarts/core';
import { LineChart } from 'echarts/charts';
import { GridComponent, LegendComponent, TooltipComponent } from 'echarts/components';
import { SVGRenderer } from 'echarts/renderers';
import type { TrainingStatusTrendPoint } from '../types';

const captured = vi.hoisted(() => ({
  options: [] as EChartsOption[],
  placeholders: [] as boolean[],
}));
vi.mock('./EChart', () => ({
  EChart: ({
    option,
    isPlaceholder = false,
  }: {
    option: EChartsOption;
    isPlaceholder?: boolean;
  }) => {
    captured.options.push(option);
    captured.placeholders.push(isPlaceholder);
    return null;
  },
}));

import { ProfileTrainingStatus } from './ProfileTrainingStatus';

echarts.use([LineChart, GridComponent, LegendComponent, TooltipComponent, SVGRenderer]);

type Series = {
  id: string;
  connectNulls: boolean;
  lineStyle: { type?: string };
  data: Array<[number, number | null]>;
};

const time = (date: string) => Date.parse(`${date}T00:00:00Z`);
const point = (date: string, personalValue: number | null, teamMean: number | null = null) => ({
  date,
  personalValue,
  teamMean,
  teamSampleCount: teamMean === null ? null : 2,
});

function renderCard(points: TrainingStatusTrendPoint[]) {
  renderToStaticMarkup(
    createElement(ProfileTrainingStatus, {
      loading: false,
      trainingStatus: {
        scope: {
          athleteId: 1,
          teamId: 1,
          project: 'ROWING',
          from: '2026-10-29',
          to: '2026-11-25',
          athleteCount: 2,
        },
        cards: [
          {
            kind: 'physical',
            title: '体能训练',
            metrics: [],
            trend: { label: '体能训练时长', unit: 'h', points },
          },
        ],
      },
    })
  );
  return {
    option: captured.options.at(-1)!,
    isPlaceholder: captured.placeholders.at(-1)!,
  };
}

const seriesOf = (option: EChartsOption) => option.series as unknown as Series[];

beforeEach(() => {
  captured.options.length = 0;
  captured.placeholders.length = 0;
});

it('不连续日期按真实顺序连接，中间缺失日不生成数据点', () => {
  const { option } = renderCard([
    point('2026-11-05', 4.1, null),
    point('2026-10-29', 2.8, 3.4),
    point('2026-11-02', null, 3.9),
    point('2026-11-15', 5.2, 4.6),
  ]);
  const [personal, team] = seriesOf(option);
  expect(personal.connectNulls).toBe(true);
  expect(personal.lineStyle.type).toBeUndefined();
  expect(personal.data).toEqual([
    [time('2026-10-29'), 2.8],
    [time('2026-11-02'), null],
    [time('2026-11-05'), 4.1],
    [time('2026-11-15'), 5.2],
  ]);
  expect(team).toMatchObject({ connectNulls: true, lineStyle: { type: 'dashed' } });
  expect(team.data).toEqual([
    [time('2026-10-29'), 3.4],
    [time('2026-11-02'), 3.9],
    [time('2026-11-05'), null],
    [time('2026-11-15'), 4.6],
  ]);
  expect(personal.data).toHaveLength(4);
  expect(team.data).toHaveLength(4);
});

it('只有单个有效点时保留实心圆点，不伪造折线或中间日期', () => {
  const { option, isPlaceholder } = renderCard([point('2026-11-02', 4.1, null)]);
  const personal = seriesOf(option)[0];
  expect(personal.connectNulls).toBe(true);
  expect(personal.data).toEqual([[time('2026-11-02'), 4.1]]);
  expect(isPlaceholder).toBe(false);
});

it('完全没有有效数据时继续显示无数据占位状态', () => {
  const { option, isPlaceholder } = renderCard([
    point('2026-10-29', null, null),
    point('2026-11-02', null, null),
  ]);
  expect(seriesOf(option).every((series) => series.data.every(([, value]) => value === null))).toBe(
    true
  );
  expect(isPlaceholder).toBe(true);
});

it('相隔多天的两个真实点经 SSR 渲染为连续实线', () => {
  const { option } = renderCard([point('2026-10-29', 2.8, null), point('2026-11-02', 4.1, null)]);
  const personal = seriesOf(option).filter((series) => series.id === 'physical-personal');
  const chart = echarts.init(null as never, null as never, {
    renderer: 'svg',
    ssr: true,
    width: 900,
    height: 300,
  });
  chart.setOption({ ...option, legend: { show: false }, series: personal } as EChartsOption);
  const svg = chart.renderToSVGString();
  chart.dispose();
  expect(svg).not.toContain('NaN');
  expect(svg).toMatch(/<path(?=[^>]*stroke="#176f7f")(?=[^>]*d="[^"]*L)[^>]*>/);
  expect(svg).not.toContain('stroke-dasharray');
});
