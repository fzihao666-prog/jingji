import { useEffect, useMemo, useState } from 'react';
import {
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { api } from '../api';
import type { Athlete, Project, StrengthTest } from '../types';
import { formatNumber } from '../utils';
import {
  STRENGTH_METRICS,
  STRENGTH_METRIC_MAP,
  type StrengthMetricKey,
} from '../../shared/strength-model';
import {
  PHYSICAL_CHAMPION_DIMENSIONS,
  physicalComparison,
  type PhysicalChampionPayload,
  type PhysicalReference,
} from '../../shared/physical-champion';
import { chartDisplay, placeholderTrend } from './chart-placeholder';
import { ChartCard, ContentState } from './PageLayout';
import './PhysicalTestModule.css';

type Props = {
  tests: StrengthTest[];
  project: Project;
  from: string;
  to: string;
  athleteId: number | null;
  athletes: Athlete[];
};

type TrendRow = {
  date: string;
  team: number | null;
  personal: number | null;
  count: number;
};

type Standard = {
  value: number;
  label: string;
  note: string;
  reference: PhysicalReference | null;
};

const UNIT_ALIASES: Array<string[]> = [
  ['s', 'sec', 'second', '秒'],
  ['cm', '厘米'],
  ['kg', '千克'],
  ['w/kg'],
  ['ml/kg/min'],
  ['j/kg'],
  ['mmol/l'],
  ['次', 'rep', 'reps'],
];

function normalizeUnit(unit: string) {
  return unit.trim().toLowerCase().replace(/\s+/g, '');
}

function sameUnit(left: string, right: string) {
  const a = normalizeUnit(left);
  const b = normalizeUnit(right);
  if (a === b) return true;
  return UNIT_ALIASES.some((group) => group.includes(a) && group.includes(b));
}

function normalizeCode(code: string) {
  return code.toLowerCase().replace(/_/g, '');
}

// 冠军模型参考值按项目/性别/小项/体重级/年龄组分组（与体能冠军模型同一口径），
// 且参考值单位与指标单位一致时才可作为标准，避免混用不兼容标准。
function championStandardFor(
  metricKey: StrengthMetricKey,
  unit: string,
  group: PhysicalChampionPayload['groups'][number] | undefined
): PhysicalReference | null {
  if (!group) return null;
  const dimension = PHYSICAL_CHAMPION_DIMENSIONS.find((item) =>
    item.codes.some((code) => normalizeCode(code) === normalizeCode(metricKey))
  );
  if (!dimension || !sameUnit(dimension.unit, unit)) return null;
  return group.references.find((reference) => reference.key === dimension.key) ?? null;
}

// 教练目标沿用现有测试聚合口径：仅统计大于 0 的目标值并取平均。
function coachTarget(tests: StrengthTest[], metricKey: StrengthMetricKey) {
  const targets = tests
    .map((test) => test.targets[metricKey])
    .filter((value): value is number => typeof value === 'number' && value > 0);
  return targets.length ? targets.reduce((sum, value) => sum + value, 0) / targets.length : null;
}

function latestTestsByAthlete(tests: StrengthTest[]) {
  const latest = new Map<number, StrengthTest>();
  [...tests]
    .sort((left, right) => right.testDate.localeCompare(left.testDate))
    .forEach((test) => {
      if (!latest.has(test.athleteId)) latest.set(test.athleteId, test);
    });
  return [...latest.values()];
}

function round(value: number, digits = 1) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export function PhysicalTestModule({ tests, project, from, to, athleteId, athletes }: Props) {
  const metricOptions = useMemo(
    () =>
      STRENGTH_METRICS.filter((metric) => !metric.projects || metric.projects.includes(project)),
    [project]
  );
  const [selectedKey, setSelectedKey] = useState<StrengthMetricKey | ''>('');
  const metricKey = (
    selectedKey && metricOptions.some((item) => item.key === selectedKey)
      ? selectedKey
      : metricOptions[0]?.key
  ) as StrengthMetricKey | undefined;
  const definition = metricKey ? STRENGTH_METRIC_MAP[metricKey] : undefined;
  const [payload, setPayload] = useState<PhysicalChampionPayload | null>(null);

  useEffect(() => {
    let active = true;
    api
      .physicalChampion({ project, from, to })
      .then((result) => {
        if (active) setPayload(result);
      })
      .catch(() => {
        if (active) setPayload(null);
      });
    return () => {
      active = false;
    };
  }, [project, from, to]);

  const group = useMemo(() => {
    if (!payload) return undefined;
    return (
      payload.groups.find((item) => item.athletes.some((entry) => entry.athleteId === athleteId)) ??
      payload.groups[0]
    );
  }, [athleteId, payload]);

  const scopedTests = useMemo(
    () => (athleteId ? tests.filter((test) => test.athleteId === athleteId) : tests),
    [athleteId, tests]
  );

  const trendRows = useMemo<TrendRow[]>(() => {
    if (!metricKey) return [];
    const teamByDate = new Map<string, Map<number, number>>();
    const personalByDate = new Map<string, number>();
    for (const test of tests) {
      const value = test.metrics[metricKey];
      if (typeof value !== 'number') continue;
      const perAthlete = teamByDate.get(test.testDate) ?? new Map<number, number>();
      perAthlete.set(test.athleteId, value);
      teamByDate.set(test.testDate, perAthlete);
      if (test.athleteId === athleteId) personalByDate.set(test.testDate, value);
    }
    return [...teamByDate.keys()].sort().map((date) => {
      const values = [...(teamByDate.get(date)?.values() ?? [])];
      return {
        date,
        team: values.length
          ? round(values.reduce((sum, value) => sum + value, 0) / values.length)
          : null,
        personal: athleteId ? (personalByDate.get(date) ?? null) : null,
        count: values.length,
      };
    });
  }, [athleteId, metricKey, tests]);

  const standard = useMemo<Standard | null>(() => {
    if (!metricKey || !definition) return null;
    const reference = championStandardFor(metricKey, definition.unit, group);
    if (reference) {
      return {
        value: reference.value,
        label: '冠军模型参考',
        note: `${group?.label ?? ''} · ${reference.protocol} · ${reference.direction === 'lower_better' ? '越小越好' : '越大越好'}`,
        reference,
      };
    }
    const target = coachTarget(scopedTests, metricKey);
    if (target !== null) {
      return {
        value: target,
        label: '教练目标',
        note: '按当前范围已有测试目标值平均',
        reference: null,
      };
    }
    return null;
  }, [definition, group, metricKey, scopedTests]);

  const current = useMemo(() => {
    if (!metricKey) return { value: null as number | null, sampleCount: 0 };
    const sources = athleteId ? scopedTests : latestTestsByAthlete(scopedTests);
    const values = sources
      .map((test) => test.metrics[metricKey])
      .filter((value): value is number => typeof value === 'number');
    return {
      value: values.length
        ? round(values.reduce((sum, value) => sum + value, 0) / values.length)
        : null,
      sampleCount: values.length,
    };
  }, [athleteId, metricKey, scopedTests]);

  const comparison = useMemo(() => {
    if (current.value === null || !standard)
      return { difference: null as number | null, achieved: null as number | null };
    if (standard.reference) {
      const result = physicalComparison(current.value, standard.reference);
      return {
        difference: result.difference === null ? null : round(result.difference),
        achieved: result.achievedPercent,
      };
    }
    return {
      difference: round(current.value - standard.value),
      achieved: standard.value > 0 ? round((current.value / standard.value) * 100) : null,
    };
  }, [current.value, standard]);

  const isPlaceholder = trendRows.length === 0;
  const chartSource = chartDisplay(
    trendRows.map((row) => row),
    placeholderTrend.map((value, index) => ({
      date: `示例${index + 1}`,
      team: value,
      personal: null,
      count: 0,
    }))
  );
  const chartData = chartSource.data;
  const unit = definition?.unit ?? '';
  const athleteName = athletes.find((item) => item.id === athleteId)?.name ?? '当前运动员';
  const scopeLabel = athleteId ? `${athleteName}个人与团队对比` : '团队平均';

  return (
    <ChartCard
      title="体能测试"
      description={`${scopeLabel} · ${from} — ${to} · 单指标趋势，不同单位指标不混轴`}
      className="physical-test-module"
    >
      {definition && metricOptions.length ? (
        <div className="physical-test-body">
          <div className="physical-test-chart">
            <div className="physical-test-toolbar">
              <label>
                测试指标
                <select
                  aria-label="体能测试指标"
                  value={metricKey}
                  onChange={(event) => setSelectedKey(event.target.value as StrengthMetricKey)}
                >
                  {metricOptions.map((metric) => (
                    <option key={metric.key} value={metric.key}>
                      {metric.label}（{metric.unit}）
                    </option>
                  ))}
                </select>
              </label>
              {isPlaceholder && <span className="app-chart-example">示例数据</span>}
            </div>
            <div className="physical-test-canvas">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart
                  data={chartData}
                  margin={{ top: 18, right: 18, left: -12, bottom: 0 }}
                >
                  <CartesianGrid stroke="#dce7e9" strokeDasharray="3 5" vertical={false} />
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 10, fill: '#62767d' }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    tick={{ fontSize: 10, fill: '#62767d' }}
                    axisLine={false}
                    tickLine={false}
                    unit={unit}
                  />
                  <Tooltip
                    content={({ active, label }) => {
                      const row = chartData.find((item) => item.date === String(label));
                      if (!active || !row) return null;
                      const mainValue = athleteId ? row.personal : row.team;
                      const difference =
                        standard && mainValue !== null && !isPlaceholder
                          ? round(mainValue - standard.value)
                          : null;
                      return (
                        <div className="training-volume-tooltip">
                          <strong>
                            {isPlaceholder ? '示例数据 · ' : ''}
                            {row.date}
                          </strong>
                          <p>
                            团队平均：
                            {row.team === null ? '缺失' : `${formatNumber(row.team, 1)} ${unit}`}
                          </p>
                          {athleteId && (
                            <p>
                              {athleteName}：
                              {row.personal === null
                                ? '缺失'
                                : `${formatNumber(row.personal, 1)} ${unit}`}
                            </p>
                          )}
                          <p>有效测试人数：{isPlaceholder ? '—' : `${row.count} 人`}</p>
                          <p>
                            参考标准（{standard?.label ?? '暂无适用标准'}）：
                            {standard ? `${formatNumber(standard.value, 1)} ${unit}` : '—'}
                          </p>
                          <p>
                            差值：
                            {difference === null ? '—' : `${formatNumber(difference, 1)} ${unit}`}
                          </p>
                        </div>
                      );
                    }}
                  />
                  {standard && (
                    <ReferenceLine
                      y={standard.value}
                      stroke="#f59e0b"
                      strokeDasharray="4 3"
                      label={{
                        value: `${standard.label} ${formatNumber(standard.value, 1)}${unit}`,
                        position: 'right',
                        fontSize: 10,
                        fill: '#b7791f',
                      }}
                    />
                  )}
                  <Line
                    type="monotone"
                    dataKey="team"
                    name="团队平均"
                    stroke="#0d9488"
                    strokeWidth={2.6}
                    dot={{ r: 3, fill: '#fff', strokeWidth: 2 }}
                    connectNulls={false}
                  />
                  {athleteId && (
                    <Line
                      type="monotone"
                      dataKey="personal"
                      name={athleteName}
                      stroke="#3b82f6"
                      strokeWidth={2.2}
                      strokeDasharray="6 3"
                      dot={{ r: 3, fill: '#fff', strokeWidth: 2 }}
                      connectNulls={false}
                    />
                  )}
                </ComposedChart>
              </ResponsiveContainer>
            </div>
            <p className="physical-test-note">
              {isPlaceholder
                ? '当前周期暂无真实体能测试数据，图形仅为示例效果，不参与任何统计与达标计算。'
                : `团队平均按测试日期汇总当日有效测试记录，不对无测试日期补值；有效测试人数见悬停提示。`}
            </p>
          </div>
          <aside className="physical-test-standard">
            <h3>标准对比</h3>
            <p className="physical-test-standard-source">
              {definition.label}（{unit}）· {standard ? standard.note : '暂无适用标准'}
            </p>
            <dl>
              <div>
                <dt>{athleteId ? `${athleteName}当前值` : '团队当前平均值'}</dt>
                <dd>
                  {current.value === null ? '—' : formatNumber(current.value, 1)}
                  <small>{current.value === null ? '' : unit}</small>
                </dd>
              </div>
              <div>
                <dt>标准参考值（{standard?.label ?? '—'}）</dt>
                <dd>
                  {standard ? formatNumber(standard.value, 1) : '—'}
                  <small>{standard ? unit : ''}</small>
                </dd>
              </div>
              <div>
                <dt>绝对差值</dt>
                <dd>
                  {comparison.difference === null ? '—' : formatNumber(comparison.difference, 1)}
                </dd>
              </div>
              <div>
                <dt>达成度</dt>
                <dd>
                  {comparison.achieved === null ? '—' : `${formatNumber(comparison.achieved, 1)}%`}
                </dd>
              </div>
            </dl>
            <small className="physical-test-standard-foot">
              {current.value === null
                ? '当前范围没有有效测试结果，不展示达标判断。'
                : `基于 ${current.sampleCount} 条最近有效测试；标准优先取与项目、性别、小项和适用人群匹配的冠军模型参考值，单位不一致时回退教练目标，均缺失则不画参考线。`}
            </small>
          </aside>
        </div>
      ) : (
        <ContentState kind="empty" title="当前项目没有可用的体能测试指标" />
      )}
    </ChartCard>
  );
}
