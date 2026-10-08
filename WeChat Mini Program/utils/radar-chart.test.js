import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

function loadCjs(url, mocks = {}) {
  const module = { exports: {} };
  vm.runInNewContext(readFileSync(url, 'utf8'), {
    module,
    exports: module.exports,
    require(path) {
      if (Object.prototype.hasOwnProperty.call(mocks, path)) return mocks[path];
      throw new Error(`未预期的依赖：${path}`);
    },
    Math,
    Number,
    Array,
    Object,
  });
  return module.exports;
}

const { radarLayout, radarAxes, radarSeriesPoints, drawRadar } = loadCjs(
  new URL('./radar-chart.js', import.meta.url),
  {}
);

function mockContext() {
  const calls = [];
  const record = (name) => (...args) => calls.push([name, ...args]);
  return {
    calls,
    ctx: {
      clearRect: record('clearRect'),
      beginPath: record('beginPath'),
      moveTo: record('moveTo'),
      lineTo: record('lineTo'),
      closePath: record('closePath'),
      stroke: record('stroke'),
      fill: record('fill'),
      arc: record('arc'),
      setLineDash: record('setLineDash')
    }
  };
}

describe('雷达图几何', () => {
  it('布局按画布尺寸扣除留白，最大值兜底 100', () => {
    const layout = radarLayout({ size: 200, padding: 22 });
    expect(layout.center).toBe(100);
    expect(layout.radius).toBe(78);
    expect(layout.rings).toBe(4);
    expect(layout.max).toBe(100);
    expect(radarLayout({ size: 100, max: 120 }).max).toBe(120);
    expect(radarLayout({ size: 40, padding: 40 }).radius).toBe(1);
  });

  it('顶点从正上方开始顺时针排列', () => {
    const layout = radarLayout({ size: 200, padding: 0 });
    const axes = radarAxes(4, layout);
    expect(axes).toHaveLength(4);
    expect(axes[0].x).toBeCloseTo(100, 5);
    expect(axes[0].y).toBeCloseTo(0, 5);
    expect(axes[1].x).toBeCloseTo(200, 5);
    expect(axes[1].y).toBeCloseTo(100, 5);
    expect(radarAxes(0, layout)).toEqual([]);
  });

  it('数值按最大值映射半径，缺失保留 null，超出上限截断到边', () => {
    const layout = radarLayout({ size: 200, padding: 0, max: 100 });
    const axes = radarAxes(4, layout);
    const points = radarSeriesPoints([100, 50, null, 200], axes, layout);
    expect(points[0]).toMatchObject({ x: 100, y: 0 });
    expect(points[1].x).toBeCloseTo(150, 5);
    expect(points[2]).toBeNull();
    expect(points[3]).not.toBeNull();
    expect(points[3].x).toBeCloseTo(0, 5);
    expect(points[3].y).toBeCloseTo(100, 5);
    expect(radarSeriesPoints(null, axes, layout)).toEqual([null, null, null, null]);
  });
});

describe('雷达图绘制', () => {
  it('绘制网格、轴线与两条多边形，缺失点断开路径', () => {
    const layout = radarLayout({ size: 200, padding: 0, max: 100 });
    const axes = radarAxes(3, layout);
    const { calls, ctx } = mockContext();
    drawRadar(ctx, layout, axes, [
      { points: radarSeriesPoints([100, 100, 100], axes, layout), stroke: '#d79617', dashed: true },
      { points: radarSeriesPoints([80, null, 60], axes, layout), stroke: '#168f88', fill: '#e6f2f1', dot: 3 }
    ]);
    const names = calls.map((entry) => entry[0]);
    expect(names).toContain('clearRect');
    expect(names.filter((name) => name === 'stroke').length).toBeGreaterThanOrEqual(4);
    expect(names.filter((name) => name === 'moveTo').length).toBeGreaterThanOrEqual(2);
    expect(names).toContain('arc');
    expect(names.filter((name) => name === 'setLineDash').length).toBeGreaterThanOrEqual(3);
  });

  it('空序列与空上下文不抛错', () => {
    const layout = radarLayout({ size: 100 });
    expect(() => drawRadar(null, layout, radarAxes(3, layout), [])).not.toThrow();
    const { calls, ctx } = mockContext();
    drawRadar(ctx, layout, radarAxes(3, layout), [{ points: [null, null, null] }]);
    expect(calls.map((entry) => entry[0])).not.toContain('arc');
  });
});
