import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import type { Athlete, Project, User } from '../types';
import type { CatalogPlan, PlanExecutionRow } from '../../shared/training-plan-catalog';
import type { TeamPlan } from '../../shared/team-plan';
import { TrainingPlanWorkspace } from '../components/TrainingPlanWorkspace';
import { TrainingPlanWeekView } from '../components/TrainingPlanWeekView';
import { weekStart } from './training-plan-week';
import { projectLabel } from '../../shared/projects';
import { PLAN_KIND_LABELS, filterCatalog } from '../../shared/training-plan-view';
import { UnifiedPlanDetail } from '../components/UnifiedPlanDetail';
import {
  AppCard,
  ContentState,
  FilterBar,
  PageContainer,
  PageHeader,
} from '../components/PageLayout';
import './UnifiedTrainingPlansPage.css';

type Props = {
  athletes: Athlete[];
  user: User;
  project: Project | null;
  from: string;
  to: string;
  initialKind?: string;
  onBack?: () => void;
};
const statusLabels = { draft: '草稿', pending: '待审核', published: '已发布', archived: '已归档' };
const today = () =>
  new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai' }).format(new Date());
export function UnifiedTrainingPlansPage(props: Props) {
  const [plans, setPlans] = useState<TeamPlan[]>([]);
  const [history, setHistory] = useState<CatalogPlan[]>([]);
  const [athletes, setAthletes] = useState<Pick<Athlete, 'id' | 'name' | 'teamId' | 'project'>[]>(
    []
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [filters, setFilters] = useState({
    project: props.project || '',
    team: '',
    from: props.from,
    to: props.to,
    status: '',
  });
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [historyKey, setHistoryKey] = useState('');
  const [workspaceDirty, setWorkspaceDirty] = useState(false);
  const [emptyDate, setEmptyDate] = useState(today());
  const [execution, setExecution] = useState<{ rows: PlanExecutionRow[]; error: string } | null>(
    null
  );
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    Promise.all([api.teamPlans(), api.trainingPlanCatalog()])
      .then(([result, old]) => {
        if (active) {
          setPlans(result.plans);
          setAthletes(result.athletes);
          setHistory(old.plans);
        }
      })
      .catch((err: unknown) => {
        if (active) setError(err instanceof Error ? err.message : '训练计划加载失败');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [retry]);
  const shown = plans
    .filter(
      (plan) =>
        (!filters.project || plan.project === filters.project) &&
        (!filters.team || String(plan.teamId) === filters.team) &&
        (!filters.from || plan.endDate >= filters.from) &&
        (!filters.to || plan.startDate <= filters.to) &&
        (!filters.status || plan.status === filters.status)
    )
    .sort((a, b) => b.startDate.localeCompare(a.startDate) || b.version - a.version);
  const selected = shown.find((plan) => plan.id === selectedId);
  const selectedHistory = history.find((plan) => plan.key === historyKey);
  const project = selected?.project || '';
  useEffect(() => {
    heading.current?.focus();
  }, [selectedId, historyKey]);
  useEffect(() => {
    let active = true;
    setExecution(null);
    if (project && props.user.role !== 'ATL')
      api
        .planExecution(project)
        .then((result) => {
          if (active) setExecution({ rows: result.athletes, error: '' });
        })
        .catch((err: unknown) => {
          if (active)
            setExecution({
              rows: [],
              error: err instanceof Error ? err.message : '执行情况读取失败',
            });
        });
    return () => {
      active = false;
    };
  }, [project, props.user.role, retry]);
  const permitPlanChange = () =>
    !workspaceDirty || window.confirm('当前计划有未保存修改，切换将放弃这些修改。是否继续？');
  const changeFilter = (patch: Partial<typeof filters>) => {
    if (!permitPlanChange()) return;
    setWorkspaceDirty(false);
    setFilters({ ...filters, ...patch });
    setSelectedId(null);
    setHistoryKey('');
  };
  const teams = [
    ...new Map(
      plans
        .filter((plan) => !filters.project || plan.project === filters.project)
        .map((plan) => [plan.teamId, plan])
    ).values(),
  ];
  const scopedAthletes = athletes.filter(
    (athlete) =>
      selected && athlete.teamId === selected.teamId && athlete.project === selected.project
  );
  const oldShown = filterCatalog(history, { ...filters, kind: '' });
  return (
    <PageContainer className="unified-plans-page">
      <PageHeader
        eyebrow="TRAINING PLANS"
        title="训练计划"
        actions={
          props.onBack ? (
            <button
              className="secondary-button"
              onClick={() => {
                if (permitPlanChange()) props.onBack?.();
              }}
            >
              返回来源页面
            </button>
          ) : undefined
        }
      />
      <p>队伍统一安排专项、体能与恢复训练；教练通过周视图编排草稿、调整个人目标并审核发布。</p>
      <FilterBar label="训练计划筛选">
        <label>
          项目
          <select
            value={filters.project}
            onChange={(event) => changeFilter({ project: event.target.value, team: '' })}
          >
            <option value="">全部授权项目</option>
            {[...new Set([...plans, ...history].map((plan) => plan.project))].map((value) => (
              <option key={value} value={value}>
                {projectLabel(value)}
              </option>
            ))}
          </select>
        </label>
        <label>
          队伍
          <select
            value={filters.team}
            onChange={(event) => changeFilter({ team: event.target.value })}
          >
            <option value="">全部授权队伍</option>
            {teams.map((plan) => (
              <option key={plan.teamId} value={plan.teamId}>
                {plan.team}
              </option>
            ))}
          </select>
        </label>
        <label>
          开始日期
          <input
            type="date"
            value={filters.from}
            max={filters.to || undefined}
            onChange={(event) => changeFilter({ from: event.target.value })}
          />
        </label>
        <label>
          结束日期
          <input
            type="date"
            value={filters.to}
            min={filters.from || undefined}
            onChange={(event) => changeFilter({ to: event.target.value })}
          />
        </label>
        <button className="secondary-button" onClick={() => changeFilter({ from: '', to: '' })}>
          全部周期
        </button>
      </FilterBar>
      <div className="unified-plan-tabs" role="group" aria-label="发布状态">
        {[['', '全部计划'], ...Object.entries(statusLabels)].map(([value, label]) => (
          <button
            key={value}
            className="secondary-button"
            aria-pressed={filters.status === value}
            onClick={() => changeFilter({ status: value })}
          >
            {label}
          </button>
        ))}
      </div>
      <AppCard>
        <h2>队伍计划概览</h2>
        <div className="unified-plan-stats">
          {Object.entries(statusLabels).map(([value, label]) => (
            <div key={value}>
              <span>{label}</span>
              <strong>
                {loading || error ? '—' : shown.filter((plan) => plan.status === value).length}
              </strong>
            </div>
          ))}
        </div>
        <p>草稿和待审核计划仅供教练查看，运动员执行以已发布版本为准。</p>
      </AppCard>
      <AppCard>
        <h2>队伍训练计划</h2>
        {loading ? (
          <ContentState kind="loading" title="正在读取训练计划…" />
        ) : error ? (
          <>
            <ContentState kind="error" title={error} />
            <button className="secondary-button" onClick={() => setRetry((value) => value + 1)}>
              重试
            </button>
          </>
        ) : !shown.length ? (
          <ContentState kind="empty" title="暂无队伍训练计划" />
        ) : (
          <div className="table-scroll">
            <table>
              <caption className="sr-only">授权范围内队伍计划及版本</caption>
              <thead>
                <tr>
                  {['计划名称', '项目 / 队伍', '周期', '状态 / 版本', '个人调整', '操作'].map(
                    (label) => (
                      <th scope="col" key={label}>
                        {label}
                      </th>
                    )
                  )}
                </tr>
              </thead>
              <tbody>
                {shown.map((plan) => (
                  <tr key={plan.id}>
                    <td>{plan.title}</td>
                    <td>
                      {projectLabel(plan.project)} · {plan.team}
                    </td>
                    <td>
                      {plan.startDate} 至 {plan.endDate}
                    </td>
                    <td>
                      {statusLabels[plan.status]} · V{plan.version}
                    </td>
                    <td>{new Set(plan.data.overrides.map((item) => item.athleteId)).size} 人</td>
                    <td>
                      <button
                        className="secondary-button"
                        aria-label={`查看计划：${plan.title} V${plan.version}`}
                        onClick={() => {
                          if (selectedId === plan.id || !permitPlanChange()) return;
                          setWorkspaceDirty(false);
                          setSelectedId(plan.id);
                          setHistoryKey('');
                        }}
                      >
                        查看计划
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </AppCard>
      {!selected && !selectedHistory && (
        <AppCard>
          <h2>周安排</h2>
          <p>
            {plans.length
              ? '请选择一份队伍计划查看与编排。'
              : '暂无队伍计划，周视图保留空状态。教练可通过既有小程序入口创建队伍主计划。'}
          </p>
          <TrainingPlanWeekView
            sessions={[]}
            overrides={[]}
            weekStart={weekStart(emptyDate)}
            selectedDate={emptyDate}
            today={today()}
            onSelectDate={setEmptyDate}
            onChangeWeek={setEmptyDate}
            onToday={() => setEmptyDate(today())}
          />
        </AppCard>
      )}
      {selected && (
        <AppCard className="unified-plan-detail">
          <h2 tabIndex={-1} ref={heading}>
            {selected.title} · V{selected.version}
          </h2>
          <p>
            {selected.team} · {statusLabels[selected.status]} · {selected.startDate} 至{' '}
            {selected.endDate}
          </p>
          <p>发布时间：{selected.publishedAt || '尚未发布'}</p>
          <p>
            训练目标：{selected.data.goal || '未设置'} · 训练重点：{selected.data.focus || '未设置'}
          </p>
          <TrainingPlanWorkspace
            key={selected.id}
            plan={selected}
            athletes={athletes}
            user={props.user}
            previousPlan={
              plans
                .filter(
                  (plan) =>
                    plan.rootId === selected.rootId &&
                    plan.version < selected.version &&
                    plan.publishedAt
                )
                .sort((a, b) => b.version - a.version)[0]
            }
            onDirtyChange={setWorkspaceDirty}
            onSaved={(plan) => {
              setPlans((previous) => [...previous.filter((item) => item.id !== plan.id), plan]);
              setSelectedId(plan.id);
              setWorkspaceDirty(false);
              if (plan.status === 'published')
                api
                  .teamPlans()
                  .then((result) => setPlans(result.plans))
                  .catch((err: unknown) =>
                    setError(
                      err instanceof Error ? err.message : '计划已保存，列表刷新失败，请重试。'
                    )
                  );
              setFilters((previous) => ({ ...previous, status: '' }));
            }}
          />
          <h3>执行情况</h3>
          <p role="status" aria-live="polite">
            {execution
              ? execution.error
                ? '执行情况读取失败'
                : `已读取 ${execution.rows.length} 名运动员的执行情况`
              : ''}
          </p>
          <p>复用近 7 天运动员执行汇总，覆盖队伍各适用计划；不代表本版本的逐课完成率。</p>
          {props.user.role === 'ATL' ? (
            <p>执行分析仅向教练开放。</p>
          ) : !execution ? (
            <p role="status">正在读取执行情况…</p>
          ) : execution.error ? (
            <p role="alert">{execution.error}</p>
          ) : (
            <ul>
              {execution.rows
                .filter((row) => scopedAthletes.some((athlete) => athlete.id === row.athleteId))
                .map((row) => (
                  <li key={row.athleteId}>
                    {row.athleteName}：计划 {row.plannedDays} 天 / 实际 {row.actualDays} 天 · 执行率{' '}
                    {row.completionRate === null
                      ? '—'
                      : new Intl.NumberFormat('zh-CN', {
                          style: 'percent',
                          maximumFractionDigits: 0,
                        }).format(row.completionRate)}{' '}
                    · 实际时长 {row.totalDurationMin} 分钟 · 今日 RPE{' '}
                    {row.todayRpeReported ? '已反馈' : '未反馈'}
                  </li>
                ))}
            </ul>
          )}
        </AppCard>
      )}
      <AppCard>
        <h2>历史计划（兼容查看）</h2>
        <p>
          保留原专项与个人计划及其历史内容；新计划统一从队伍主计划创建。历史数据不推算逐课执行率。
        </p>
        {!loading && !error && !oldShown.length && <p>暂无历史计划。</p>}
        <ul>
          {oldShown.map((plan) => (
            <li key={plan.key}>
              {plan.title || '未命名计划'} · {PLAN_KIND_LABELS[plan.kind]} ·{' '}
              {plan.athleteName || plan.team || '项目计划'} · {plan.startDate} 至 {plan.endDate}{' '}
              <button
                className="secondary-button"
                aria-label={`查看历史计划：${plan.title || '未命名计划'}`}
                onClick={() => {
                  if (!permitPlanChange()) return;
                  setWorkspaceDirty(false);
                  setHistoryKey(plan.key);
                  setSelectedId(null);
                }}
              >
                查看历史
              </button>
            </li>
          ))}
        </ul>
      </AppCard>
      {selectedHistory && (
        <AppCard>
          <h2 ref={heading} tabIndex={-1}>
            历史计划 · {selectedHistory.title}
          </h2>
          <UnifiedPlanDetail plan={selectedHistory} />
        </AppCard>
      )}
    </PageContainer>
  );
}
