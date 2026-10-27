import { lazy, Suspense, useEffect, useId, useState, type FormEvent } from 'react';
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
import {
  physicalReferenceDraftSchema,
  type PhysicalChampionPayload,
  type PhysicalReference,
} from '../../shared/physical-champion';
import { ChartCard, ContentState } from './PageLayout';
import './PhysicalChampionModel.css';

const EChart = lazy(() => import('./EChart').then((module) => ({ default: module.EChart })));

type Props = {
  project: Project;
  from: string;
  to: string;
  athletes: Athlete[];
  athleteId: number | null;
};
const numberFormat = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 3 });
const format = (value: number | null | undefined) =>
  value == null ? '—' : numberFormat.format(value);

const sourceNatureLabel = {
  official_research: '研究或官方资料',
  expert: '专家经验',
  team: '队内统计',
  estimated: '估算',
  unverified: '待核实',
} as const;
const reviewStatusLabel = { draft: '草稿', reviewed: '已生效', disabled: '停用' } as const;

function ReferenceEditor({
  reference,
  project,
  onSaved,
}: {
  reference?: PhysicalReference;
  project: string;
  onSaved: () => void;
}) {
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);
  const id = useId();
  async function review(status: 'reviewed' | 'disabled') {
    if (!reference || saving) return;
    setSaving(true);
    try {
      setMessage(
        (
          await api.reviewPhysicalReference(reference.id, {
            expectedRevision: reference.revision,
            status,
          })
        ).message
      );
      onSaved();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '停用失败。');
    } finally {
      setSaving(false);
    }
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    const form = new FormData(event.currentTarget);
    const value = (name: string) => String(form.get(name) || '').trim();
    const draft = {
      project,
      key: value('key'),
      referenceLabel: value('referenceLabel'),
      value: Number(value('value')),
      unit: value('unit'),
      protocol: value('protocol'),
      protocolVersion: value('protocolVersion'),
      testContext: value('testContext'),
      side: value('side'),
      direction: value('direction'),
      sourceType: value('sourceType'),
      sourceNature: value('sourceNature'),
      sourceNote: value('sourceNote'),
      gender: value('gender'),
      event: value('event'),
      weightClass: 'open',
      ageGroup: value('ageGroup'),
      position: value('position'),
      referenceLevel: value('referenceLevel'),
      effectiveFrom: value('effectiveFrom'),
      effectiveTo: value('effectiveTo') || null,
      dimensionVersion: value('dimensionVersion'),
      measurementCodes: value('measurementCodes')
        .split(',')
        .map((code) => code.trim())
        .filter(Boolean),
      measurementUnit: value('measurementUnit'),
      weightRelative: form.has('weightRelative'),
    };
    // 与服务端共用配置契约，来源和日期在两端验证。
    const parsed = physicalReferenceDraftSchema.safeParse(draft);
    if (!parsed.success) {
      setMessage('请补全适用范围、维度、来源及有效日期；专家或队内来源需在名称中明确标注。');
      return;
    }
    setSaving(true);
    setMessage('');
    try {
      const result = reference
        ? await api.updatePhysicalReference(reference.id, {
            expectedRevision: reference.revision,
            draft: parsed.data,
          })
        : await api.createPhysicalReference(parsed.data);
      setMessage(result.message);
      onSaved();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '保存失败。');
    } finally {
      setSaving(false);
    }
  }
  const fields = [
    ['key', '指标标识', reference?.key || ''],
    ['referenceLabel', '参考名称', reference?.referenceLabel || ''],
    ['value', '参考值', String(reference?.value || '')],
    ['unit', '比较单位', reference?.unit || ''],
    ['protocol', '完整测试协议', reference?.protocol || ''],
    ['protocolVersion', '协议版本（空仅匹配默认版本）', reference?.protocolVersion || ''],
    ['testContext', '测试条件（空仅匹配默认条件）', reference?.testContext || ''],
    ['sourceNote', '来源材料与说明', reference?.sourceNote || ''],
    ['event', '分项（开放填open）', reference?.event || 'open'],
    ['position', '位置（开放填open）', reference?.position || 'open'],
    ['referenceLevel', '级别（开放填open）', reference?.referenceLevel || 'open'],
    [
      'dimensionVersion',
      '维度版本',
      reference?.dimensionVersion === 'legacy-unreviewed' ? '' : reference?.dimensionVersion || '',
    ],
    ['measurementCodes', '测量指标代码（逗号分隔）', reference?.measurementCodes.join(',') || ''],
    ['measurementUnit', '实测单位', reference?.measurementUnit || ''],
    ['effectiveFrom', '生效日期', reference?.effectiveFrom || ''],
    ['effectiveTo', '结束日期（可空）', reference?.effectiveTo || ''],
  ];
  const selects = [
    [
      'side',
      '测量侧别',
      reference?.side || 'center',
      [
        ['center', '中心'],
        ['bilateral', '双侧'],
        ['left', '左侧'],
        ['right', '右侧'],
      ],
    ],
    [
      'direction',
      '比较方向',
      reference?.direction || 'higher_better',
      [
        ['higher_better', '越大越好'],
        ['lower_better', '越小越好'],
      ],
    ],
    [
      'sourceType',
      '原始来源类型',
      reference?.sourceType || 'public_reference',
      [
        ['public_reference', '公开参考'],
        ['measured', '实测资料'],
        ['estimated', '估算'],
      ],
    ],
    [
      'sourceNature',
      '来源性质',
      reference?.sourceNature === 'unverified' ? '' : reference?.sourceNature || '',
      [
        ['', '请选择'],
        ['official_research', '研究或官方资料'],
        ['expert', '专家经验'],
        ['team', '队内统计'],
        ['estimated', '估算'],
      ],
    ],
    [
      'gender',
      '性别',
      reference?.gender || 'open',
      [
        ['open', '开放'],
        ['男', '男'],
        ['女', '女'],
      ],
    ],
    [
      'ageGroup',
      '年龄组',
      reference?.ageGroup || 'adult',
      [
        ['adult', '成人（需生日）'],
        ['open', '开放'],
      ],
    ],
  ] as const;
  return (
    <details>
      <summary>
        {reference
          ? `版本 ${reference.version} · ${reviewStatusLabel[reference.reviewStatus]} · ${reference.referenceLabel || reference.key}`
          : '创建冠军参考'}
      </summary>
      {reference && (
        <p>
          来源：{reference.sourceNote}；性质：{sourceNatureLabel[reference.sourceNature]}；有效期：
          {reference.effectiveFrom || '未配置'} — {reference.effectiveTo || '长期'}
          。修改创建新版本，保留历史。
        </p>
      )}
      <form onSubmit={submit} className="physical-champion-editor">
        {fields.map(([name, label, initial]) => (
          <label key={name} htmlFor={`${id}-${name}`}>
            {label}
            <input
              id={`${id}-${name}`}
              name={name}
              defaultValue={initial}
              required={!['effectiveTo', 'protocolVersion', 'testContext'].includes(name)}
              maxLength={name === 'sourceNote' ? 500 : 200}
              type={name.startsWith('effective') ? 'date' : name === 'value' ? 'number' : 'text'}
              step={name === 'value' ? 'any' : undefined}
              min={name === 'value' ? '0.000001' : undefined}
            />
          </label>
        ))}
        {selects.map(([name, label, initial, options]) => (
          <label key={name} htmlFor={`${id}-${name}`}>
            {label}
            <select id={`${id}-${name}`} name={name} defaultValue={initial} required>
              {options.map(([value, label]) => (
                <option value={value} key={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        ))}
        <label htmlFor={`${id}-relative`}>
          <input
            id={`${id}-relative`}
            name="weightRelative"
            type="checkbox"
            defaultChecked={reference?.weightRelative}
          />
          使用同课次体重换算相对值
        </label>
        <button type="submit" className="dashboard-action-button" disabled={saving}>
          {saving ? '保存中…' : '保存并生效'}
        </button>
        {reference && (
          <>
            <button
              type="button"
              disabled={saving || reference.reviewStatus === 'disabled'}
              onClick={() => review('disabled')}
            >
              停用此版本
            </button>
          </>
        )}
        <p role="status">{message}</p>
      </form>
    </details>
  );
}

export function PhysicalChampionModel({ project, from, to, athletes, athleteId }: Props) {
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
        if (active) setError(failure instanceof Error ? failure.message : '冠军参考加载失败。');
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
    legend: { top: 0, left: 'center', type: 'scroll', selectedMode: false },
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
  return (
    <ChartCard
      title="体能冠军参考模型"
      description={`${projectLabel(project)} · ${from} — ${to}`}
      className="physical-champion"
    >
      <div aria-live="polite">
        {showLoading && <ContentState kind="loading" title="正在加载冠军参考模型" />}
        {error && (
          <ContentState
            kind="error"
            title="冠军参考加载失败"
            description={error}
            action={
              <button type="button" onClick={() => setRevision((value) => value + 1)}>
                重试
              </button>
            }
          />
        )}
      </div>
      {!showLoading && !error && payload && (
        <>
          <p role="status">{payload.pendingReason}</p>
          {payload.athletePendingReasons
            .filter((item) => !athleteId || item.athleteId === athleteId)
            .map((item) => (
              <p key={item.athleteId}>
                {athletes.find((athlete) => athlete.id === item.athleteId)?.name || item.athleteId}
                ：{item.reason}
              </p>
            ))}
          {payload.canEdit && (
            <section aria-label="冠军参考管理">
              <h3>参考版本管理</h3>
              <ReferenceEditor
                project={project}
                onSaved={() => setRevision((value) => value + 1)}
              />
              {payload.managementReferences.map((reference) => (
                <ReferenceEditor
                  key={`${reference.id}-${reference.revision}`}
                  reference={reference}
                  project={project}
                  onSaved={() => setRevision((value) => value + 1)}
                />
              ))}
            </section>
          )}
          <details>
            <summary>实测记录与同协议历史（{payload.measurements.length} 条）</summary>
            <table>
              <caption>
                仅含当前项目已确认有效实测；无标准时仍保留记录，按协议查看同指标的日期变化。
              </caption>
              <thead>
                <tr>
                  <th scope="col">运动员</th>
                  <th scope="col">日期</th>
                  <th scope="col">协议 / 版本 / 条件 / 侧别</th>
                  <th scope="col">指标</th>
                  <th scope="col">实测</th>
                </tr>
              </thead>
              <tbody>
                {payload.measurements
                  .filter((row) => !athleteId || row.athleteId === athleteId)
                  .map((row) => (
                    <tr key={row.measurementId}>
                      <td>
                        {athletes.find((athlete) => athlete.id === row.athleteId)?.name ||
                          row.athleteId}
                      </td>
                      <td>{row.date}</td>
                      <td>
                        {row.protocol || '协议未知'} /{' '}
                        {row.protocolVersion === null
                          ? '版本未知'
                          : row.protocolVersion || '默认版本'}{' '}
                        / {row.testContext || '默认条件'} / {row.side}
                      </td>
                      <td>{row.code}</td>
                      <td>
                        {format(row.value)} {row.unit}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
            {!payload.measurements.length && <p>当前周期暂无已确认实测记录。</p>}
          </details>
        </>
      )}
      {!showLoading && !error && !group && (
        <ContentState kind="empty" title="待参考" description="当前项目尚未配置适用参考模型" />
      )}
      {!showLoading && !error && group && (
        <>
          <div className="physical-champion-toolbar">
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
          {athleteId && !personal && (
            <p className="physical-champion-empty" role="status">
              待采集：当前运动员在此参考组没有可比较测试成绩，请核对参考组与测试协议。
            </p>
          )}
          <div className="physical-champion-section-heading">
            <h3>冠军参考指标</h3>
            <span>参考值 · 当前表现；估算参考，不参与正式评分</span>
          </div>
          <section aria-label="冠军参考指标" className="physical-champion-reference">
            {rows.map(({ reference, team, personal: personalResult }) => (
              <article key={reference.id}>
                <h3>
                  {reference.label}
                  {reference.sourceType === 'estimated' && <small>估算</small>}
                </h3>
                <p>
                  版本 {reference.version} · {sourceNatureLabel[reference.sourceNature]} ·{' '}
                  {reference.sourceNote} · {reference.effectiveFrom} 至{' '}
                  {reference.effectiveTo || '长期'}
                </p>
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
              </article>
            ))}
          </section>
          <section className="physical-champion-section">
            <h3>冠军参考雷达图</h3>
            <p className="physical-champion-note">
              冠军参考为 100%（估算仅用于展示）；团队仅包含当前分组的有效测试。超过 100%
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
                    name="冠军参考"
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
            <p>
              {personal?.score != null
                ? `${personal.scoringEligible ? '完整维度达成度' : '展示性达成度'}：${format(personal.score)}%`
                : '完整维度待采集'}
            </p>
            <h3>参考差距分析</h3>
            <div
              className="physical-champion-table-wrap"
              role="region"
              aria-label="参考差距分析数据，可横向滚动"
              tabIndex={0}
            >
              <table className="physical-champion-table">
                <caption>
                  差值为当前值减参考值；达成度已按比较方向计算。— 表示待采集（缺少同协议有效测试）。
                </caption>
                <thead>
                  <tr>
                    <th scope="col">维度 / 单位</th>
                    <th scope="col">参考值</th>
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
                        <td>
                          {format(current?.appliedReference?.value ?? row.reference.value)}
                          <small>
                            版本 {current?.appliedReference?.version ?? row.reference.version} ·{' '}
                            {current?.appliedReference?.sourceNote ?? row.reference.sourceNote}
                          </small>
                        </td>
                        <td>{format(row.team?.value)}</td>
                        <td>
                          {format(row.team?.achievedPercent)}
                          {row.team?.achievedPercent != null && '%'}
                        </td>
                        <td>{format(current?.value)}</td>
                        <td>
                          {format(current?.difference)}
                          {current?.pendingReason && <small>{current.pendingReason}</small>}
                        </td>
                        <td>
                          {format(current?.achievedPercent)}
                          {current?.achievedPercent != null && '%'}
                          {current?.achievedPercent != null && !current.scoringEligible && (
                            <small>估算或展示参考，不参与正式评分</small>
                          )}
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
            <h3>展示性达成度趋势</h3>
            <p>展示性达成度趋势（含估算参考，不构成正式评分）</p>
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
                      label={`${scopeName}参考达成度趋势，最新${format(latestTrend?.score)}%，冠军参考100%。具体数值见趋势数据表。`}
                    />
                  </Suspense>
                </div>
                <details>
                  <summary>查看趋势数据</summary>
                  <div
                    className="physical-champion-table-wrap"
                    role="region"
                    aria-label="参考达成趋势数据，可横向滚动"
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
              <p className="physical-champion-empty">待采集：当前周期暂无可比较趋势数据。</p>
            )}
          </section>
        </>
      )}
    </ChartCard>
  );
}
