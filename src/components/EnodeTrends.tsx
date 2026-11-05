import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { EChart } from './EChart';
import { AppCard } from './PageLayout';
import type { EChartsOption } from 'echarts';
import {
  ENODE_METRICS,
  ENODE_KINDS,
  type EnodeData,
  type EnodeKind,
  type EnodeMetric,
} from '../../shared/enode';
import './Enode.css';
const number = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 3 });
const display = (v: number | null | undefined) => (v == null ? '—' : number.format(v));
const defaultMetric: Record<EnodeKind, EnodeMetric> = {
  measurement: 'meanVelocity',
  wellness: 'wellnessScore',
  sessionRpe: 'sessionRpe',
};

export function EnodeTrends({
  athleteId,
  project,
  from,
  to,
  kind,
  refreshKey = 0,
}: {
  athleteId: number;
  project: string;
  from: string;
  to: string;
  kind: EnodeKind;
  refreshKey?: number;
}) {
  const [metric, setMetric] = useState<EnodeMetric>(defaultMetric[kind]);
  const [exercise, setExercise] = useState('');
  const [side, setSide] = useState<string>();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [day, setDay] = useState('');
  const [reload, setReload] = useState(0);
  const [state, setState] = useState<{ key: string; data?: EnodeData; error?: string }>({
    key: '',
  });
  const query = useMemo(
    () => ({
      athleteId,
      project,
      kind,
      from: day || from,
      to: day || to,
      exercise: exercise || undefined,
      side,
      metric,
      page,
    }),
    [athleteId, project, kind, from, to, day, exercise, side, metric, page]
  );
  const key = JSON.stringify([query, refreshKey, reload]);
  const data = state.key === key ? state.data : undefined;
  const error = state.key === key ? state.error : undefined;
  const loading = state.key !== key;
  useEffect(() => {
    let cancelled = false;
    api
      .enodeData(query)
      .then((data) => {
        if (!cancelled) setState({ key, data });
      })
      .catch((e) => {
        if (!cancelled) setState({ key, error: e instanceof Error ? e.message : '读取失败' });
      });
    return () => {
      cancelled = true;
    };
  }, [key, query]);
  const options = Object.entries(ENODE_METRICS).filter(([, meta]) => meta.kind === kind);
  const meta = ENODE_METRICS[metric];
  const option: EChartsOption = {
    animation: false,
    tooltip: { trigger: 'axis', renderMode: 'richText' },
    legend: { data: ['每日均值', '测量点'] },
    grid: { left: 65, right: 25, top: 55, bottom: 50 },
    xAxis: { type: 'category', data: data?.daily.map((d) => d.date) || [], name: '日期' },
    yAxis: { type: 'value', name: meta.unit || meta.label, scale: true },
    series: [
      {
        type: 'line',
        name: '每日均值',
        data: data?.daily.map((d) => d.mean) || [],
        symbolSize: 7,
        connectNulls: false,
      },
      {
        type: 'scatter',
        name: '测量点',
        data: data?.points.map((p) => [p.date, p.value]) || [],
        symbolSize: 5,
      },
    ],
  };
  const exerciseOptions =
    data?.exercises.filter((item) =>
      item.name.toLocaleLowerCase().includes(search.toLocaleLowerCase())
    ) || [];
  return (
    <AppCard className="enode-trends">
      <h2>Enode · {ENODE_KINDS[kind]}</h2>
      <div className="enode-filters">
        {kind === 'measurement' && (
          <>
            <label>
              <span>搜索动作</span>
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="输入动作名称"
              />
            </label>
            <label>
              <span>动作</span>
              <select
                value={exercise || data?.selectedExercise || ''}
                onChange={(e) => {
                  setExercise(e.target.value);
                  setSide(undefined);
                  setPage(1);
                }}
              >
                {!data?.exercises.length && <option value="">暂无动作</option>}
                {data?.exercises
                  .filter(
                    (item) =>
                      item.name === (exercise || data.selectedExercise) ||
                      exerciseOptions.includes(item)
                  )
                  .map((item) => (
                    <option key={item.name} value={item.name}>
                      {item.name}（{number.format(item.count)}条）
                    </option>
                  ))}
              </select>
            </label>
            <label>
              <span>侧别</span>
              <select
                value={side ?? data?.selectedSide ?? ''}
                onChange={(e) => {
                  setSide(e.target.value);
                  setPage(1);
                }}
              >
                {!data?.sides.length && <option value="">暂无侧别</option>}
                {data?.sides.map((s) => (
                  <option key={s} value={s}>
                    {({ bilateral: '双侧', left: '左侧', right: '右侧' } as Record<string, string>)[
                      s
                    ] ||
                      s ||
                      '未注明'}
                  </option>
                ))}
              </select>
            </label>
          </>
        )}
        <label>
          <span>指标</span>
          <select
            value={metric}
            onChange={(e) => {
              setMetric(e.target.value as EnodeMetric);
              setPage(1);
            }}
          >
            {options.map(([key, m]) => (
              <option key={key} value={key}>
                {m.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p>
        {kind === 'measurement'
          ? '同一动作、同一侧别按日计算有效测量的算术平均值；未记录负重，不据此直接判断力量进步。'
          : kind === 'wellness'
            ? '展示 enode 原始评分；评分方向尚未确认，不与系统恢复量表混合、不判断好坏。'
            : '保留 enode 来源 RPE、时长和负荷；不叠加到系统已有训练负荷。来源训练量的单位未声明。'}
      </p>
      <p>时间按导出文件原始日期展示，时区未声明。缺失测量不补0。</p>
      {loading && <p role="status">正在读取测量…</p>}
      {error && (
        <p role="alert">
          {error}{' '}
          <button
            type="button"
            className="secondary-button"
            onClick={() => setReload((n) => n + 1)}
          >
            重试
          </button>
        </p>
      )}
      {data && (
        <>
          <p role="status">
            {number.format(data.total)}条来源记录，{number.format(data.pointCount)}条有效
            {meta.label}测量，{data.daily.length}个记录日。
            {data.pointCount > data.points.length
              ? `散点抽样展示${data.points.length}条，均值使用全部有效测量。`
              : ''}
          </p>
          <EChart
            option={option}
            label={`${meta.label}每日均值和测量点，${query.from}至${query.to}；完整每日统计见下表。`}
            isPlaceholder={!data.daily.length}
          />
          <details>
            <summary>查看每日统计与明细</summary>
            <div
              className="enode-table-wrap"
              tabIndex={0}
              role="region"
              aria-label="可滚动的测量数据表"
            >
              <table>
                <caption>
                  {meta.label}每日统计（{meta.unit || '原始数值'}）
                </caption>
                <thead>
                  <tr>
                    <th scope="col">日期</th>
                    <th scope="col">均值</th>
                    <th scope="col">最小值</th>
                    <th scope="col">最大值</th>
                    <th scope="col">有效测量数</th>
                  </tr>
                </thead>
                <tbody>
                  {data.daily.map((d) => (
                    <tr key={d.date}>
                      <th scope="row">{d.date}</th>
                      <td>{display(d.mean)}</td>
                      <td>{display(d.min)}</td>
                      <td>{display(d.max)}</td>
                      <td>{number.format(d.count)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
          <details>
            <summary>查看原始记录（共{number.format(data.total)}条）</summary>
            <div className="enode-filters">
              <label>
                <span>仅查看某天</span>
                <input
                  type="date"
                  min={from}
                  max={to}
                  value={day}
                  onChange={(e) => {
                    setDay(e.target.value);
                    setPage(1);
                  }}
                />
              </label>
              {day && (
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => {
                    setDay('');
                    setPage(1);
                  }}
                >
                  返回全部日期
                </button>
              )}
            </div>
            <div
              className="enode-table-wrap"
              tabIndex={0}
              role="region"
              aria-label="可滚动的测量数据表"
            >
              <table>
                <caption>Enode 原始测量 · 未填值以“—”显示</caption>
                <thead>
                  <tr>
                    <th scope="col">原始时间</th>
                    {options.map(([key, m]) => (
                      <th scope="col" key={key}>
                        {m.label}
                        {m.unit ? `（${m.unit}）` : ''}
                      </th>
                    ))}
                    {kind === 'sessionRpe' && (
                      <>
                        <th scope="col">训练起止</th>
                        <th scope="col">动作</th>
                      </>
                    )}
                    <th scope="col">来源</th>
                  </tr>
                </thead>
                <tbody>
                  {data.records.map((r) => (
                    <tr key={r.id}>
                      <th scope="row">{r.recordedAt.replace('T', ' ')}</th>
                      {options.map(([key]) => (
                        <td key={key}>{display(r.values[key as EnodeMetric])}</td>
                      ))}
                      {kind === 'sessionRpe' && (
                        <>
                          <td>
                            {r.context.workoutStart || '—'} 至 {r.context.workoutEnd || '—'}
                          </td>
                          <td>{r.context.exercises || '—'}</td>
                        </>
                      )}
                      <td>
                        {r.filename} · 第{r.sourceRow}行
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="enode-actions">
              <button
                type="button"
                className="secondary-button"
                disabled={page <= 1}
                onClick={() => setPage((n) => n - 1)}
              >
                上一页
              </button>
              <span>
                第{page}页，共{Math.max(1, Math.ceil(data.total / data.pageSize))}页
              </span>
              <button
                type="button"
                className="secondary-button"
                disabled={page * data.pageSize >= data.total}
                onClick={() => setPage((n) => n + 1)}
              >
                下一页
              </button>
            </div>
          </details>
        </>
      )}
    </AppCard>
  );
}
