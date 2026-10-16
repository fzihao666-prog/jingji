import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { api } from '../api';
import type { Athlete, Project, User } from '../types';
import type { CatalogPlan, PlanExecutionRow } from '../../shared/training-plan-catalog';
import { planPeriodStatus } from '../../shared/training-plan-catalog';
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

const AITrainingPlanGenerator = lazy(() =>
  import('../components/AITrainingPlanGenerator').then((module) => ({
    default: module.AITrainingPlanGenerator,
  }))
);

type Props = {
  athletes: Athlete[];
  user: User;
  project: Project | null;
  from: string;
  to: string;
  initialKind?: string;
  onBack?: () => void;
};
const today = () =>
  new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai' }).format(new Date());
export function UnifiedTrainingPlansPage(props: Props) {
  const [plans, setPlans] = useState<CatalogPlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [filters, setFilters] = useState({
    kind: props.initialKind || '',
    project: props.project || '',
    team: '',
    from: props.from,
    to: props.to,
  });
  const [selectedKey, setSelectedKey] = useState('');
  const [draftAthleteId, setDraftAthleteId] = useState('');
  const [execution, setExecution] = useState<{
    project: string;
    rows: PlanExecutionRow[];
    error: string;
  } | null>(null);
  const detailHeading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    setPlans([]);
    api
      .trainingPlanCatalog()
      .then((result) => {
        if (active) setPlans(result.plans);
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
  const shown = filterCatalog(plans, filters).sort(
    (a, b) =>
      Number(planPeriodStatus(b, today()) === '进行中') -
        Number(planPeriodStatus(a, today()) === '进行中') ||
      b.startDate.localeCompare(a.startDate) ||
      a.key.localeCompare(b.key)
  );
  const selected = shown.find((plan) => plan.key === selectedKey);
  useEffect(() => {
    if (selectedKey) detailHeading.current?.focus();
  }, [selectedKey]);
  const executionProject = selected?.project || '';
  useEffect(() => {
    let active = true;
    setExecution(null);
    if (!executionProject || props.user.role === 'ATL') return;
    api
      .planExecution(executionProject)
      .then((result) => {
        if (active) setExecution({ project: executionProject, rows: result.athletes, error: '' });
      })
      .catch((err: unknown) => {
        if (active)
          setExecution({
            project: executionProject,
            rows: [],
            error: err instanceof Error ? err.message : '执行情况读取失败',
          });
      });
    return () => {
      active = false;
    };
  }, [executionProject, props.user.role, retry]);
  const teams = [
    ...new Map(
      plans
        .filter((plan) => plan.teamId && (!filters.project || plan.project === filters.project))
        .map((plan) => [String(plan.teamId), plan])
    ).values(),
  ];
  const changeFilter = (patch: Partial<typeof filters>) => {
    setFilters({ ...filters, ...patch });
    setSelectedKey('');
  };
  const counts = ['进行中', '已完成', '尚未开始'].map(
    (status) => shown.filter((plan) => planPeriodStatus(plan, today()) === status).length
  );
  return (
    <PageContainer className="unified-plans-page">
      <PageHeader
        eyebrow="TRAINING PLANS"
        title="训练计划"
        actions={
          props.onBack ? (
            <button className="secondary-button" onClick={props.onBack}>
              返回来源页面
            </button>
          ) : undefined
        }
      />
      <p>统一查看专项、体能及综合训练安排</p>
      <FilterBar label="训练计划筛选">
        <label>
          项目
          <select
            aria-label="筛选项目"
            value={filters.project}
            onChange={(event) => changeFilter({ project: event.target.value, team: '' })}
          >
            <option value="">全部授权项目</option>
            {[
              ...new Set(
                plans.map((plan) => plan.project).concat(props.project ? [props.project] : [])
              ),
            ].map((project) => (
              <option key={project} value={project}>
                {projectLabel(project)}
              </option>
            ))}
          </select>
        </label>
        <label>
          队伍
          <select
            aria-label="筛选队伍"
            value={filters.team}
            onChange={(event) => changeFilter({ team: event.target.value })}
          >
            <option value="">全部授权队伍（含项目级计划）</option>
            {teams.map((plan) => (
              <option key={plan.teamId} value={String(plan.teamId)}>
                {projectLabel(plan.project)} · {plan.team}
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
      <div className="unified-plan-tabs" role="group" aria-label="计划类型">
        {[['', '全部计划'], ...Object.entries(PLAN_KIND_LABELS)].map(([key, label]) => (
          <button
            key={key}
            aria-pressed={filters.kind === key}
            className="secondary-button"
            onClick={() => changeFilter({ kind: key })}
          >
            {label}
          </button>
        ))}
      </div>
      {props.user.role !== 'ATL' && (
        <AppCard>
          <details>
            <summary>AI 计划草案</summary>
            <p>复用原体能计划生成器；生成结果需人工确认后保存，不写入实际训练记录。</p>
            <label>
              运动员
              <select
                aria-label="计划草案运动员"
                value={draftAthleteId}
                onChange={(event) => setDraftAthleteId(event.target.value)}
              >
                <option value="">请选择授权范围内的运动员</option>
                {props.athletes
                  .filter(
                    (athlete) =>
                      (!filters.project || athlete.project === filters.project) &&
                      (!filters.team || String(athlete.teamId) === filters.team)
                  )
                  .map((athlete) => (
                    <option key={athlete.id} value={athlete.id}>
                      {athlete.name} · {athlete.team}
                    </option>
                  ))}
              </select>
            </label>
            {(() => {
              const athlete = props.athletes.find(
                (item) =>
                  String(item.id) === draftAthleteId &&
                  (!filters.project || item.project === filters.project) &&
                  (!filters.team || String(item.teamId) === filters.team)
              );
              return athlete ? (
                <Suspense fallback={<p role="status">正在打开计划草案工具…</p>}>
                  <AITrainingPlanGenerator
                    key={athlete.id}
                    athlete={athlete}
                    onSaved={() => {
                      setDraftAthleteId('');
                      setRetry((value) => value + 1);
                    }}
                  />
                </Suspense>
              ) : null;
            })()}
          </details>
        </AppCard>
      )}
      <AppCard>
        <h2>计划概览</h2>
        <div className="unified-plan-stats">
          {[
            ['计划总数', shown.length],
            ['进行中', counts[0]],
            ['已完成', counts[1]],
            ['尚未开始', counts[2]],
          ].map(([label, count]) => (
            <div key={label}>
              <span>{label}</span>
              <strong>{loading || error ? '—' : count}</strong>
            </div>
          ))}
        </div>
        <p>
          状态按北京时间及计划周期显示；“已完成”表示周期结束，不代表训练全部完成。草案计入总数。
        </p>
      </AppCard>
      <AppCard>
        <h2>训练计划列表</h2>
        {loading ? (
          <ContentState kind="loading" title="正在读取训练计划…" />
        ) : error ? (
          <>
            <ContentState kind="error" title={error} />
            <button className="secondary-button" onClick={() => setRetry(retry + 1)}>
              重试
            </button>
          </>
        ) : !shown.length ? (
          <ContentState kind="empty" title="暂无训练计划" />
        ) : (
          <div className="table-scroll">
            <table>
              <caption className="sr-only">授权范围内训练计划</caption>
              <thead>
                <tr>
                  {[
                    '计划名称',
                    '类型',
                    '项目 / 队伍',
                    '运动员',
                    '周期',
                    '创建人',
                    '状态',
                    '操作',
                  ].map((name) => (
                    <th scope="col" key={name}>
                      {name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {shown.map((plan) => (
                  <tr key={plan.key} aria-selected={selectedKey === plan.key}>
                    <td>{plan.title || '未命名计划'}</td>
                    <td>{PLAN_KIND_LABELS[plan.kind]}</td>
                    <td>
                      {projectLabel(plan.project)}
                      <small>{plan.team || '项目级 · 未指定队伍'}</small>
                    </td>
                    <td>{plan.athleteName || '未指定人员'}</td>
                    <td>
                      {plan.startDate} 至 {plan.endDate}
                    </td>
                    <td>{plan.createdBy || '未记录'}</td>
                    <td>{planPeriodStatus(plan, today())}</td>
                    <td>
                      <button
                        className="secondary-button"
                        onClick={() => setSelectedKey(plan.key)}
                        aria-label={`查看计划：${plan.title || '未命名计划'}`}
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
      {selected && (
        <AppCard className="unified-plan-detail">
          <h2 id="plan-detail-title" tabIndex={-1} ref={detailHeading}>
            计划详情 · {selected.title || '未命名计划'}
          </h2>
          <dl className="unified-plan-info">
            {[
              ['类型', PLAN_KIND_LABELS[selected.kind]],
              ['项目', projectLabel(selected.project)],
              ['队伍', selected.team || '项目级 · 未指定队伍'],
              ['运动员', selected.athleteName || '未指定人员'],
              ['周期', `${selected.startDate} 至 ${selected.endDate}`],
              ['创建人', selected.createdBy || '未记录'],
              ['状态', planPeriodStatus(selected, today())],
            ].map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
          <UnifiedPlanDetail plan={selected} />
          <h3>训练执行情况</h3>
          <p>复用服务端近 7 天（含今天）的运动员执行汇总；不代表当前选中计划的逐课完成率。</p>
          {selected.source === 'special_training_plans' ? (
            <p>该专项计划未绑定运动员，现有执行接口无法可靠关联，暂不展示执行率。</p>
          ) : props.user.role === 'ATL' ? (
            <p>执行分析仅向具备教练管理权限的账号开放。</p>
          ) : !execution || execution.project !== selected.project ? (
            <p role="status">正在读取执行情况…</p>
          ) : execution.error ? (
            <>
              <p role="alert">{execution.error}</p>
              <button className="secondary-button" onClick={() => setRetry(retry + 1)}>
                重试
              </button>
            </>
          ) : (
            <div className="table-scroll">
              <table>
                <caption className="sr-only">近七天运动员执行汇总</caption>
                <thead>
                  <tr>
                    {[
                      '运动员',
                      '计划 / 实际天数',
                      '执行率',
                      '实际时长（近7天）',
                      '近7天状态',
                      '今日时长 / 公里数',
                      '今日状态',
                      'RPE 反馈',
                    ].map((name) => (
                      <th key={name} scope="col">
                        {name}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {execution.rows
                    .filter((row) => row.athleteId === selected.athleteId)
                    .map((row) => (
                      <tr key={row.athleteId}>
                        <td>{row.athleteName}</td>
                        <td>
                          {row.plannedDays} / {row.actualDays}
                        </td>
                        <td>
                          {row.completionRate === null
                            ? '—'
                            : new Intl.NumberFormat('zh-CN', {
                                style: 'percent',
                                maximumFractionDigits: 0,
                              }).format(row.completionRate)}
                        </td>
                        <td>{row.totalDurationMin} 分钟</td>
                        <td>
                          {row.status === 'complete'
                            ? '已完成'
                            : row.status === 'partial'
                              ? '部分完成'
                              : row.status === 'missed'
                                ? '未完成'
                                : '无计划'}
                        </td>
                        <td>
                          {row.todayDurationMin ?? '—'} 分钟 / {row.todayDistanceKm ?? '—'} km
                        </td>
                        <td>
                          {row.todayStatus === 'recorded'
                            ? '已记录'
                            : row.todayStatus === 'pending'
                              ? '待确认'
                              : '今日无计划'}
                        </td>
                        <td>{row.todayRpeReported ? '已反馈' : '未反馈'}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          )}
        </AppCard>
      )}
    </PageContainer>
  );
}
