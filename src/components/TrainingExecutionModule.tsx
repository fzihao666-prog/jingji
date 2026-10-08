import { useMemo } from 'react';
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { Athlete, TrainingPlan } from '../types';
import { formatNumber, startOfWeek } from '../utils';
import { AppCard, ChartCard, ContentState } from './PageLayout';
import {
  derivePlannedSessions,
  matchTrainingRows,
  type ScopedStrengthSession,
  type TrainingExecutionRow,
  type TrainingExecutionStatus,
} from './training-plan-schedule';
import './TrainingExecutionModule.css';

type Props = {
  plans: TrainingPlan[];
  sessions: ScopedStrengthSession[];
  from: string;
  to: string;
  athleteId: number | null;
  athletes: Athlete[];
};

type ChartRow = {
  date: string;
  planned: number | null;
  actual: number | null;
  plannedCount: number;
  actualCount: number;
};

const STATUS_META: Record<TrainingExecutionStatus, { label: string; tone: string }> = {
  完成: { label: '完成', tone: 'done' },
  部分完成: { label: '部分完成', tone: 'partial' },
  未完成: { label: '未完成', tone: 'missed' },
  未进行: { label: '未进行', tone: 'pending' },
  计划外: { label: '计划外', tone: 'extra' },
};

function round(value: number, digits = 1) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function rowActualVolume(row: TrainingExecutionRow) {
  const sets = row.session?.sets.filter((set) => set.exerciseName.trim()) ?? [];
  if (!sets.length) return '—';
  const completed = sets.filter((set) => set.completed).length;
  const reps = sets.reduce((sum, set) => sum + set.actualReps, 0);
  return `${completed}/${sets.length}组 · ${formatNumber(reps)}次`;
}

function rowContentLabel(row: TrainingExecutionRow) {
  const parts: string[] = [];
  if (row.session?.sessionLabel) parts.push(row.session.sessionLabel);
  const names =
    row.session?.sets.map((set) => set.exerciseName.trim()).filter(Boolean) ?? row.plannedNames;
  const unique = [...new Set(names)].slice(0, 3);
  if (unique.length) parts.push(unique.join('、'));
  return parts.join(' · ') || '—';
}

function bucketByWeek(rows: ChartRow[]): ChartRow[] {
  const map = new Map<string, ChartRow>();
  for (const row of rows) {
    const key = startOfWeek(row.date);
    const current = map.get(key) ?? {
      date: `${key.slice(5)} 起`,
      planned: 0,
      actual: 0,
      plannedCount: 0,
      actualCount: 0,
    };
    if (row.planned !== null) current.planned = (current.planned ?? 0) + row.planned;
    if (row.actual !== null) current.actual = (current.actual ?? 0) + row.actual;
    current.plannedCount += row.plannedCount;
    current.actualCount += row.actualCount;
    map.set(key, current);
  }
  return [...map.values()].map((row) => ({
    ...row,
    planned: row.plannedCount ? row.planned : null,
    actual: row.actualCount ? row.actual : null,
  }));
}

export function TrainingExecutionModule({ plans, sessions, from, to, athleteId, athletes }: Props) {
  const rows = useMemo(() => {
    const scopedPlans = athleteId ? plans.filter((plan) => plan.athleteId === athleteId) : plans;
    const scopedSessions = athleteId
      ? sessions.filter((session) => session.athleteId === athleteId)
      : sessions;
    return matchTrainingRows(derivePlannedSessions(scopedPlans, from, to), scopedSessions);
  }, [athleteId, from, plans, sessions, to]);

  const stats = useMemo(() => {
    const plannedRows = rows.filter((row) => row.planId !== null);
    const sessionRows = rows.filter((row) => row.session);
    const minutes = plannedRows
      .map((row) => row.plannedMinutes)
      .filter((value): value is number => value !== null);
    const plannedMinutes =
      plannedRows.length && minutes.length ? minutes.reduce((sum, value) => sum + value, 0) : null;
    const actualMinutes = sessionRows.reduce(
      (sum, row) => sum + (row.session?.durationMin ?? 0),
      0
    );
    const doneCount = rows.filter((row) => row.status === '完成').length;
    return {
      plannedSessions: plannedRows.length || null,
      actualSessions: sessionRows.length,
      doneCount,
      plannedMinutes,
      actualMinutes,
      sessionRate: plannedRows.length ? round((doneCount / plannedRows.length) * 100) : null,
      durationRate: plannedMinutes ? round((actualMinutes / plannedMinutes) * 100) : null,
    };
  }, [rows]);

  const chartRows = useMemo(() => {
    const map = new Map<string, ChartRow>();
    for (const row of rows) {
      const current = map.get(row.date) ?? {
        date: row.date,
        planned: null,
        actual: null,
        plannedCount: 0,
        actualCount: 0,
      };
      if (row.planId !== null) {
        current.plannedCount += 1;
        if (row.plannedMinutes !== null)
          current.planned = (current.planned ?? 0) + row.plannedMinutes;
      }
      if (row.session) {
        current.actualCount += 1;
        current.actual = (current.actual ?? 0) + row.session.durationMin;
      }
      map.set(row.date, current);
    }
    const sorted = [...map.values()].sort((left, right) => left.date.localeCompare(right.date));
    return sorted.length > 45 ? bucketByWeek(sorted) : sorted;
  }, [rows]);

  const statusCounts = useMemo(() => {
    const counts = Object.fromEntries(
      Object.keys(STATUS_META).map((status) => [status, 0])
    ) as Record<TrainingExecutionStatus, number>;
    for (const row of rows) counts[row.status] += 1;
    return counts;
  }, [rows]);

  const athleteNameOf = (id: number) =>
    athletes.find((item) => item.id === id)?.name ?? `运动员${id}`;
  const hasPlanned = rows.some((row) => row.planId !== null);
  const hasData = rows.length > 0;

  return (
    <ChartCard
      title="体能训练"
      description={`${athleteId ? `${athleteNameOf(athleteId)}个人计划执行` : '团队计划执行情况'} · ${from} — ${to}`}
      className="training-execution-module"
    >
      <section className="training-dashboard-metrics execution-summary" aria-label="训练执行摘要">
        {(
          [
            [
              '计划训练课次',
              stats.plannedSessions ?? '—',
              '场',
              hasPlanned ? '按计划训练日推导' : '暂无可用计划',
            ],
            ['实际完成课次', stats.doneCount, '场', `实际记录 ${stats.actualSessions} 场`],
            [
              '计划训练时长',
              stats.plannedMinutes === null ? '—' : formatNumber(stats.plannedMinutes),
              stats.plannedMinutes === null ? '' : 'min',
              hasPlanned ? '按计划动作预计时长合计' : '暂无可用计划',
            ],
            ['实际训练时长', formatNumber(stats.actualMinutes), 'min', '按已记录训练时长汇总'],
            [
              '课次完成率',
              stats.sessionRate === null ? '—' : `${formatNumber(stats.sessionRate, 1)}%`,
              '',
              stats.sessionRate === null
                ? '缺少计划课次，不计算完成率'
                : `完成 ${stats.doneCount} / 计划 ${stats.plannedSessions}`,
            ],
            [
              '时长执行率',
              stats.durationRate === null ? '—' : `${formatNumber(stats.durationRate, 1)}%`,
              '',
              stats.durationRate === null
                ? '缺少计划时长，不计算执行率'
                : '实际/计划，超额完成保留真实值',
            ],
          ] as Array<[string, string | number, string, string]>
        ).map(([label, value, unit, note]) => (
          <AppCard key={label} variant="compact" className="training-dashboard-metric">
            <span>{label}</span>
            <strong>
              {value}
              <small>{unit}</small>
            </strong>
            <em>{note}</em>
          </AppCard>
        ))}
      </section>

      {!hasPlanned && hasData && (
        <p className="execution-banner" role="status">
          当前周期暂无可用训练计划，仅展示实际训练记录；未自动生成计划，也不计算完成率与执行率。
        </p>
      )}

      {hasData ? (
        <div className="execution-body">
          <div className="execution-chart">
            <div className="physical-chart-canvas">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart
                  data={chartRows}
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
                    unit=" min"
                  />
                  <Tooltip
                    content={({ active, label }) => {
                      const row = chartRows.find((item) => item.date === String(label));
                      if (!active || !row) return null;
                      const difference =
                        row.planned !== null && row.actual !== null
                          ? round(row.actual - row.planned)
                          : null;
                      return (
                        <div className="training-volume-tooltip">
                          <strong>{row.date}</strong>
                          <p>
                            计划时长：
                            {row.planned === null ? '未记录' : `${formatNumber(row.planned)} min`}
                          </p>
                          <p>
                            实际时长：
                            {row.actual === null ? '未记录' : `${formatNumber(row.actual)} min`}
                          </p>
                          <p>
                            差异：
                            {difference === null
                              ? '—'
                              : `${difference >= 0 ? '+' : ''}${formatNumber(difference)} min`}
                          </p>
                          <p>
                            课次：计划 {row.plannedCount} 场 · 实际 {row.actualCount} 场
                          </p>
                        </div>
                      );
                    }}
                  />
                  <Bar
                    dataKey="planned"
                    name="计划时长"
                    fill="#f0c987"
                    radius={[4, 4, 0, 0]}
                    maxBarSize={26}
                  />
                  <Bar
                    dataKey="actual"
                    name="实际时长"
                    fill="#70b9b2"
                    radius={[4, 4, 0, 0]}
                    maxBarSize={26}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
            <p className="execution-note">
              计划与实际按日期分组对比；计划时长取计划动作预计时长之和，实际时长取已记录训练时长，缺失不记为
              0。
            </p>
          </div>
          <aside className="execution-status-panel">
            <h3>计划执行情况</h3>
            <dl>
              {(Object.keys(STATUS_META) as TrainingExecutionStatus[]).map((status) => (
                <div key={status}>
                  <dt>
                    <span
                      className={`execution-status execution-status-${STATUS_META[status].tone}`}
                    >
                      {STATUS_META[status].label}
                    </span>
                  </dt>
                  <dd>{statusCounts[status]} 场</dd>
                </div>
              ))}
            </dl>
            <small>
              关联口径：实际课次须与计划训练日一致且训练动作名称有交集才计入完成，仅日期相同不认定；计划训练日来自
              AI 计划训练安排或计划文本中的「周X」，无法推导时不计算完成率。
            </small>
          </aside>
        </div>
      ) : (
        <ContentState
          kind="empty"
          title="当前周期暂无训练计划与训练记录"
          description="录入训练计划或训练记录后，这里会展示计划与实际执行对比。"
        />
      )}

      {hasData && (
        <details className="execution-detail" open>
          <summary>训练完成明细</summary>
          <div
            className="execution-table-scroll"
            role="region"
            aria-label="训练完成明细数据，可横向滚动"
            tabIndex={0}
          >
            <table>
              <caption>
                计划量取计划动作的组次处方，实际量取已记录训练组次；「—」表示缺少对应记录，不代表
                0。
              </caption>
              <thead>
                <tr>
                  <th scope="col">日期</th>
                  {!athleteId && <th scope="col">运动员</th>}
                  <th scope="col">训练内容</th>
                  <th scope="col">计划量</th>
                  <th scope="col">实际量</th>
                  <th scope="col">完成状态</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.key}>
                    <th scope="row">{row.date}</th>
                    {!athleteId && <td>{athleteNameOf(row.athleteId)}</td>}
                    <td>{rowContentLabel(row)}</td>
                    <td>
                      {row.plannedSets === null && row.plannedReps === null
                        ? '—'
                        : `${row.plannedSets ?? '—'}组${row.plannedReps === null ? '' : ` · ${formatNumber(row.plannedReps)}次`}`}
                    </td>
                    <td>{rowActualVolume(row)}</td>
                    <td>
                      <span
                        className={`execution-status execution-status-${STATUS_META[row.status].tone}`}
                      >
                        {STATUS_META[row.status].label}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </ChartCard>
  );
}
