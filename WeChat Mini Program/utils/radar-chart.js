// 档案雷达图：几何计算为纯函数（单测覆盖），绘制层只依赖传入的 canvas 2d 上下文。
// 缺失维度不以 0 代替：多边形在缺失处断开，由调用方在明细中标注。

const TAU = Math.PI * 2;

function radarLayout(options) {
  const settings = options || {};
  const size = Math.max(1, Number(settings.size) || 0);
  const padding = settings.padding == null ? 22 : Math.max(0, Number(settings.padding) || 0);
  return {
    size,
    center: size / 2,
    radius: Math.max(1, size / 2 - padding),
    rings: Math.max(2, Number(settings.rings) || 4),
    max: Number(settings.max) > 0 ? Number(settings.max) : 100,
  };
}

// 顶点从正上方开始顺时针排列；count 不足 1 时返回空数组。
function radarAxes(count, layout) {
  const total = Math.max(0, Math.floor(Number(count) || 0));
  const step = TAU / Math.max(1, total);
  const axes = [];
  for (let index = 0; index < total; index += 1) {
    const angle = -Math.PI / 2 + step * index;
    axes.push({
      angle,
      x: layout.center + Math.cos(angle) * layout.radius,
      y: layout.center + Math.sin(angle) * layout.radius,
    });
  }
  return axes;
}

// 把数值序列映射为多边形顶点；null 缺失维度返回 null 占位，超过 max 的真实值按上限截断到顶点。
function radarSeriesPoints(values, axes, layout) {
  return axes.map((axis, index) => {
    const value = values == null ? null : values[index];
    if (value == null || !Number.isFinite(Number(value))) return null;
    const ratio = Math.min(1, Math.max(0, Number(value) / layout.max));
    return {
      x: layout.center + Math.cos(axis.angle) * layout.radius * ratio,
      y: layout.center + Math.sin(axis.angle) * layout.radius * ratio,
    };
  });
}

function ringPoints(layout, axes, ratio) {
  return axes.map((axis) => ({
    x: layout.center + Math.cos(axis.angle) * layout.radius * ratio,
    y: layout.center + Math.sin(axis.angle) * layout.radius * ratio,
  }));
}

function tracePolygon(ctx, points, close) {
  let started = false;
  points.forEach((point) => {
    if (!point) {
      started = false;
      return;
    }
    if (!started) {
      ctx.moveTo(point.x, point.y);
      started = true;
    } else {
      ctx.lineTo(point.x, point.y);
    }
  });
  if (close && started) ctx.closePath();
}

/**
 * 绘制雷达图：网格圈 + 轴线 + 参考多边形（虚线） + 个人多边形（描边加浅填充）。
 * ctx 为 canvas 2d 上下文；series: [{ points, stroke, fill, dashed, lineWidth, dot }]
 */
function drawRadar(ctx, layout, axes, series) {
  if (!ctx || !axes.length) return;
  const list = Array.isArray(series) ? series : [];
  ctx.clearRect(0, 0, layout.size, layout.size);
  ctx.setLineDash([]);
  ctx.lineWidth = 1;
  ctx.strokeStyle = '#d8e6e8';
  for (let ring = 1; ring <= layout.rings; ring += 1) {
    ctx.beginPath();
    tracePolygon(ctx, ringPoints(layout, axes, ring / layout.rings), true);
    ctx.stroke();
  }
  ctx.beginPath();
  axes.forEach((axis) => {
    ctx.moveTo(layout.center, layout.center);
    ctx.lineTo(axis.x, axis.y);
  });
  ctx.stroke();
  list.forEach((item) => {
    const points = item && Array.isArray(item.points) ? item.points : [];
    if (!points.some(Boolean)) return;
    ctx.setLineDash(item.dashed ? [5, 4] : []);
    ctx.lineWidth = item.lineWidth || 2;
    ctx.strokeStyle = item.stroke || '#168f88';
    ctx.beginPath();
    tracePolygon(ctx, points, true);
    ctx.stroke();
    if (item.fill) {
      ctx.setLineDash([]);
      ctx.fillStyle = item.fill;
      ctx.beginPath();
      tracePolygon(ctx, points, true);
      ctx.fill();
    }
    if (item.dot) {
      ctx.setLineDash([]);
      ctx.fillStyle = item.stroke || '#168f88';
      points.forEach((point) => {
        if (!point) return;
        ctx.beginPath();
        ctx.arc(point.x, point.y, item.dot, 0, TAU);
        ctx.fill();
      });
    }
  });
  ctx.setLineDash([]);
}

module.exports = { radarLayout, radarAxes, radarSeriesPoints, ringPoints, drawRadar };
