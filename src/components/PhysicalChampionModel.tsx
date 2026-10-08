import { lazy, Suspense, useEffect, useId, useState, type FormEvent } from 'react';
import { ArrowRight } from 'lucide-react';
import {
  Legend,
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ResponsiveContainer,
  Tooltip,
} from 'recharts';
import type { EChartsOption } from 'echarts';
import { api } from '../api';
import type { Athlete, Project } from '../types';
import { projectLabel } from '../../shared/projects';
import type { PhysicalChampionPayload, PhysicalReference } from '../../shared/physical-champion';
import { ChartCard, ContentState } from './PageLayout';
import './PhysicalChampionModel.css';

const EChart = lazy(() => import('./EChart').then((module) => ({ default: module.EChart })));

type Props = {
  project: Project;
  from: string;
  to: string;
  athletes: Athlete[];
  athleteId: number | null;
  onPlanOpen: () => void;
};
const numberFormat = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 3 });
const format = (value: number | null | undefined) =>
  value == null ? '—' : numberFormat.format(value);

function ReferenceEditor({
  reference,
  onSaved,
}: {
  reference: PhysicalReference;
  onSaved: () => void;
}) {
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);
  const id = useId();
  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    const form = new FormData(event.currentTarget);
    const sourceType = String(form.get('sourceType'));
    if (
      sourceType !== 'measured' &&
      sourceType !== 'public_reference' &&
      sourceType !== 'estimated'
    )
      return;
    setSaving(true);
    setMessage('');
    try {
      const response = await api.updatePhysicalReference(reference.id, {
        value: Number(form.get('value')),
        protocol: String(form.get('protocol')).trim(),
        sourceType,
        sourceNote: String(form.get('sourceNote')).trim(),
        expectedValue: reference.value,
        expectedRevision: reference.revision,
      });
      setMessage(response.message);
      onSaved();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '保存失败，请重试。');
    } finally {
      setSaving(false);
    }
  }
  return (
    <details>
      <summary>修改参考值</summary>
      <form onSubmit={handleSubmit} className="physical-champion-editor">
        <label htmlFor={`${id}-value`}>参考值（{reference.unit}）</label>
        <input
          id={`${id}-value`}
          name="value"
          type="number"
          min="0.000001"
          max="10000"
          step="any"
          required
          defaultValue={reference.value}
        />
        <label htmlFor={`${id}-protocol`}>测试协议</label>
        <input
          id={`${id}-protocol`}
          name="protocol"
          required
          maxLength={200}
          defaultValue={reference.protocol}
        />
        <label htmlFor={`${id}-source`}>来源类型</label>
        <select id={`${id}-source`} name="sourceType" defaultValue={reference.sourceType}>
          <option value="measured">实测</option>
          <option value="public_reference">公开参考</option>
          <option value="estimated">估算</option>
        </select>
        <label htmlFor={`${id}-note`}>来源说明</label>
        <textarea
          id={`${id}-note`}
          name="sourceNote"
          required
          maxLength={500}
          defaultValue={reference.sourceNote}
        />
        <button type="submit" className="dashboard-action-button" aria-disabled={saving}>
          {saving ? '保存中…' : '保存参考值'}
        </button>
        <p role="status">{message}</p>
      </form>
    </details>
  );
}

export function PhysicalChampionModel({
  project,
  from,
  to,
  athletes,
  athleteId,
  onPlanOpen,
}: Props) {
  const [payload, setPayload] = useState<PhysicalChampionPayload | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [groupId, setGroupId] = useState('');
  const [revision, setRevision] = useState(0);
  const selectorId = useId();
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    api
      .physicalChampion({ project, from, to })
      .then((result) => {
        if (active) setPayload(result);
      })
      .catch((failure: unknown) => {
        if (active) setError(failure instanceof Error ? failure.message : '冠军模型加载失败。');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [project, from, to, revision]);
  const showLoading =
    loading &&
    (!payload || payload.project !== project || payload.from !== from || payload.to !== to);
  const selectedAthlete = athletes.find((item) => item.id === athleteId);
  const athleteGroup = athleteId
    ? payload?.groups.find((item) =>
        item.athletes.some((athlete) => athlete.athleteId === athleteId)
      )
    : undefined;
  const group =
    athleteGroup ?? payload?.groups.find((item) => item.id === groupId) ?? payload?.groups[0];
  const personal = group?.athletes.find((item) => item.athleteId === athleteId);
  const rows =
    group?.references.map((reference) => ({
      reference,
      team: group.team.find((item) => item.key === reference.key),
      personal: personal?.dimensions.find((item) => item.key === reference.key),
    })) ?? [];
  const radar = rows.map((row) => ({
    label: row.reference.label,
    champion: 100,
    team: row.team?.achievedPercent ?? null,
    personal: row.personal?.achievedPercent ?? null,
  }));
  const trend = (group?.trend.filter((item) => item.athleteId === (athleteId || null)) ?? []).sort(
    (a, b) => a.date.localeCompare(b.date)
  );
  const scopeName = athleteId ? (selectedAthlete?.name ?? '当前运动员') : '团队平均';
  const validTrend = trend.filter((item) => item.score != null);
  const firstTrend = validTrend[0];
  const latestTrend = validTrend.at(-1);
  const trendChange =
    validTrend.length > 1 && firstTrend?.score != null && latestTrend?.score != null
      ? Math.round((latestTrend.score - firstTrend.score) * 10) / 10
      : null;
  const toTime = (date: string) => Date.parse(`${date}T00:00:00Z`);
  const trendOption: EChartsOption = {
    animation: false,
    grid: {
      left: 12,
      right: 20,
      top: 48,
      bottom: 16,
      outerBoundsMode: 'same',
      outerBoundsContain: 'axisLabel',
    },
    legend: { top: 0, left: 'center', selectedMode: false },
    tooltip: {
      trigger: 'axis',
      renderMode: 'richText',
      confine: true,
      formatter: (parameters) => {
        const points = Array.isArray(parameters) ? parameters : [parameters];
        const point = points.find((item) => item.seriesId === 'achievement');
        const value = point?.value;
        if (!Array.isArray(value) || typeof value[0] !== 'number') return '';
        const record = trend.find((item) => toTime(item.date) === value[0]);
        return record
          ? `${record.date}\n${scopeName}：${format(record.score)}%\n有效样本：${record.sampleCount} 人\n有效维度：${record.coverage} 项`
          : '';
      },
    },
    xAxis: {
      type: 'time',
      min: toTime(from),
      max: toTime(to) + (from === to ? 86400000 : 0),
      splitNumber: 5,
      axisLabel: {
        hideOverlap: true,
        formatter: (value: number) => new Date(value).toISOString().slice(5, 10).replace('-', '/'),
      },
      axisTick: { show: false },
    },
    yAxis: {
      type: 'value',
      min: 0,
      max: (extent) => Math.ceil(Math.max(110, extent.max + 5) / 10) * 10,
      axisLabel: { formatter: '{value}%' },
      splitLine: { lineStyle: { type: 'dashed' } },
    },
    series: [
      {
        id: 'achievement',
        name: scopeName,
        type: 'line',
        data: trend.map((item) => [toTime(item.date), item.score]),
        connectNulls: false,
        smooth: false,
        showSymbol: validTrend.length <= 12,
        symbol: 'circle',
        symbolSize: 7,
        lineStyle: { width: 3 },
        areaStyle: { opacity: 0.08 },
      },
      {
        id: 'reference',
        name: '冠军参考 100%',
        type: 'line',
        data: [
          [toTime(from), 100],
          [toTime(to) + (from === to ? 86400000 : 0), 100],
        ],
        showSymbol: false,
        silent: true,
        tooltip: { show: false },
        lineStyle: { type: 'dashed', width: 2 },
      },
    ],
  };
  const comparableRows = rows.flatMap((row) => {
    const current = athleteId ? row.personal : row.team;
    return current?.achievedPercent == null ? [] : [{ ...row, current }];
  });
  const reachedCount = comparableRows.filter((row) => row.current.achievedPercent! >= 100).length;
  const priorityRow = [...comparableRows].sort(
    (a, b) => a.current.achievedPercent! - b.current.achievedPercent!
  )[0];
  return (
    <ChartCard
      title="体能冠军模型"
      description={`${projectLabel(project)} · ${from} — ${to}`}
      className="physical-champion"
      actions={
        <button type="button" className="dashboard-action-button" onClick={onPlanOpen}>
          查看训练计划 <ArrowRight size={15} aria-hidden="true" />
        </button>
      }
    >
      <div aria-live="polite">
        {showLoading && <ContentState kind="loading" title="正在加载冠军参考模型" />}
        {error && (
          <ContentState
            kind="error"
            title="冠军模型加载失败"
            description={error}
            action={
              <button type="button" onClick={() => setRevision((value) => value + 1)}>
                重试
              </button>
            }
          />
        )}
      </div>
      {!showLoading && !error && !group && (
        <ContentState kind="empty" title="当前项目暂无适用参考模型" />
      )}
      {!showLoading && !error && group && (
        <>
          <div className="physical-champion-toolbar">
            <div>
              <label htmlFor={selectorId}>参考分组</label>
              <select
                id={selectorId}
                value={group.id}
                disabled={Boolean(athleteGroup)}
                onChange={(event) => setGroupId(event.target.value)}
              >
                {payload?.groups.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label}
                  </option>
                ))}
              </select>
            </div>
            <p>
              {scopeName} · {group.referenceLevel}
            </p>
          </div>
          <p className="physical-champion-note">
            {group.gender} · 小项：{group.event === 'open' ? '通用体能' : group.event} · 体重级别：
            {group.weightClass === 'open' ? '开放组（非轻量级专项标准）' : group.weightClass} ·
            年龄组：
            {group.ageGroup === 'adult' ? '成人' : group.ageGroup}
            。按测试协议和单位匹配；缺测保留为空。
            {payload?.excludedCount
              ? ` ${format(payload.excludedCount)} 名运动员因年龄未知、未成年或分组不适用未参与比较。`
              : ''}
          </p>
          {athleteId && !personal && (
            <p className="physical-champion-empty" role="status">
              当前运动员在此参考组没有可比较测试成绩，请核对参考组与测试协议。
            </p>
          )}
          <dl className="physical-champion-summary" aria-label="当前对比摘要">
            <div>
              <dt>分析对象</dt>
              <dd>{scopeName}</dd>
              <dd className="physical-champion-summary-note">
                <small>仅比较同分组有效测试</small>
              </dd>
            </div>
            <div>
              <dt>可比较维度</dt>
              <dd>
                {comparableRows.length} / {rows.length}
              </dd>
              <dd className="physical-champion-summary-note">
                <small>缺测不计为零</small>
              </dd>
            </div>
            <div>
              <dt>已达冠军参考</dt>
              <dd>{reachedCount} 项</dd>
              <dd className="physical-champion-summary-note">
                <small>达成度 ≥ 100%</small>
              </dd>
            </div>
            <div>
              <dt>
                {priorityRow && priorityRow.current.achievedPercent! >= 100
                  ? '相对提升空间'
                  : '优先提升维度'}
              </dt>
              <dd>{priorityRow?.reference.label ?? '待采集'}</dd>
              <dd className="physical-champion-summary-note">
                <small>
                  {priorityRow
                    ? `当前达成度 ${format(priorityRow.current.achievedPercent)}%`
                    : '暂无同协议有效测试'}
                </small>
              </dd>
            </div>
          </dl>
          <div className="physical-champion-section-heading">
            <h3>冠军核心指标</h3>
            <span>参考值 · 当前表现</span>
          </div>
          <section aria-label="冠军核心指标" className="physical-champion-reference">
            {rows.map(({ reference, team, personal: personalResult }) => (
              <article key={reference.id}>
                <h3>{reference.label}</h3>
                <strong>
                  {format(reference.value)} <span>{reference.unit}</span>
                </strong>
                <div className="physical-champion-card-current">
                  <span>{scopeName}</span>
                  <b>
                    {format((athleteId ? personalResult : team)?.achievedPercent)}
                    {(athleteId ? personalResult : team)?.achievedPercent != null && '%'}
                  </b>
                </div>
                {payload?.canEdit && (
                  <ReferenceEditor
                    reference={reference}
                    onSaved={() => setRevision((value) => value + 1)}
                  />
                )}
              </article>
            ))}
          </section>
          <section className="physical-champion-section">
            <h3>冠军体能雷达图</h3>
            <p className="physical-champion-note">
              冠军参考为 100%；团队仅包含当前分组的有效测试。超过 100%
              的成绩保留真实达成度，详细数值见下表。
            </p>
            <div className="physical-champion-chart" aria-hidden="true">
              <ResponsiveContainer width="100%" height="100%">
                <RadarChart accessibilityLayer={false} data={radar} outerRadius="70%">
                  <PolarGrid />
                  <PolarAngleAxis dataKey="label" />
                  <PolarRadiusAxis domain={[0, 'auto']} />
                  <Tooltip />
                  <Legend />
                  <Radar
                    name="冠军模型"
                    dataKey="champion"
                    stroke="var(--amber)"
                    fill="var(--amber)"
                    fillOpacity={0.08}
                    strokeDasharray="5 3"
                    isAnimationActive={false}
                  />
                  <Radar
                    name="团队平均"
                    dataKey="team"
                    stroke="var(--river)"
                    fill="var(--river)"
                    fillOpacity={0.12}
                    isAnimationActive={false}
                  />
                  {athleteId && (
                    <Radar
                      name={scopeName}
                      dataKey="personal"
                      stroke="var(--signal)"
                      fill="var(--signal)"
                      fillOpacity={0.1}
                      isAnimationActive={false}
                    />
                  )}
                </RadarChart>
              </ResponsiveContainer>
            </div>
          </section>
          <section className="physical-champion-section">
            <h3>冠军差距分析</h3>
            <div
              className="physical-champion-table-wrap"
              role="region"
              aria-label="冠军差距分析数据，可横向滚动"
              tabIndex={0}
            >
              <table className="physical-champion-table">
                <caption>
                  差值为当前值减冠军值；达成度已按比较方向计算。— 表示缺少同协议有效测试。
                </caption>
                <thead>
                  <tr>
                    <th scope="col">维度 / 单位</th>
                    <th scope="col">冠军值</th>
                    <th scope="col">团队值</th>
                    <th scope="col">团队达成度</th>
                    <th scope="col">{scopeName}当前值</th>
                    <th scope="col">差值</th>
                    <th scope="col">达成度</th>
                    <th scope="col">有效样本</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => {
                    const current = athleteId ? row.personal : row.team;
                    return (
                      <tr key={row.reference.key}>
                        <th scope="row">
                          {row.reference.label} / {row.reference.unit}
                        </th>
                        <td>{format(row.reference.value)}</td>
                        <td>{format(row.team?.value)}</td>
                        <td>
                          {format(row.team?.achievedPercent)}
                          {row.team?.achievedPercent != null && '%'}
                        </td>
                        <td>{format(current?.value)}</td>
                        <td>{format(current?.difference)}</td>
                        <td>
                          {format(current?.achievedPercent)}
                          {current?.achievedPercent != null && '%'}
                        </td>
                        <td>{format(row.team?.sampleCount)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
          <section className="physical-champion-section">
            <h3>冠军达成度趋势</h3>
            <p className="physical-champion-note">
              展示本周期内 {scopeName} 的综合达成度；仅完整维度参与，按截至当日最近有效测试计算。
            </p>
            {validTrend.length > 0 ? (
              <>
                <dl className="physical-champion-trend-summary">
                  <div>
                    <dt>最新达成度</dt>
                    <dd>
                      {format(latestTrend?.score)}
                      <small>%</small>
                    </dd>
                    <dd className="physical-champion-trend-note">{latestTrend?.date}</dd>
                  </div>
                  <div>
                    <dt>较周期首个有效节点</dt>
                    <dd>
                      {trendChange == null
                        ? '—'
                        : `${trendChange > 0 ? '+' : ''}${format(trendChange)}`}
                      <small> 个百分点</small>
                    </dd>
                    <dd className="physical-champion-trend-note">
                      {trendChange == null
                        ? '至少需要两个有效日期'
                        : `${firstTrend?.date} 至 ${latestTrend?.date}`}
                    </dd>
                  </div>
                  <div>
                    <dt>最新有效样本</dt>
                    <dd>
                      {format(latestTrend?.sampleCount)}
                      <small> 人</small>
                    </dd>
                    <dd className="physical-champion-trend-note">仅纳入完整维度测试</dd>
                  </div>
                </dl>
                <div className="physical-champion-trend-chart">
                  <Suspense fallback={<ContentState kind="loading" title="正在加载趋势图" />}>
                    <EChart
                      option={trendOption}
                      label={`${scopeName}冠军达成度趋势，最新${format(latestTrend?.score)}%，冠军参考100%。具体数值见趋势数据表。`}
                    />
                  </Suspense>
                </div>
                <details>
                  <summary>查看趋势数据</summary>
                  <div
                    className="physical-champion-table-wrap"
                    role="region"
                    aria-label="冠军达成趋势数据，可横向滚动"
                    tabIndex={0}
                  >
                    <table className="physical-champion-table">
                      <thead>
                        <tr>
                          <th scope="col">日期</th>
                          <th scope="col">达成度</th>
                          <th scope="col">样本数</th>
                          <th scope="col">有效维度</th>
                        </tr>
                      </thead>
                      <tbody>
                        {trend.map((item) => (
                          <tr key={item.date}>
                            <th scope="row">{item.date}</th>
                            <td>
                              {format(item.score)}
                              {item.score != null && '%'}
                            </td>
                            <td>{item.sampleCount}</td>
                            <td>{item.coverage}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </details>
              </>
            ) : (
              <p className="physical-champion-empty">当前周期暂无可比较趋势数据。</p>
            )}
          </section>
        </>
      )}
    </ChartCard>
  );
}
