import {
  CalendarRange,
  CheckCircle2,
  Dumbbell,
  LoaderCircle,
  RotateCcw,
  Scale,
  SlidersHorizontal,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { projectLabel } from '../../shared/projects';
import { StrengthTrainingLoadChart } from '../components/StrengthTrainingLoadChart';
import {
  StrengthAnalysisPanel,
  StrengthAssessmentPanel,
  StrengthOverviewPanel,
  StrengthPlanCategoryTabs,
} from '../components/StrengthTrainingInsights';
import type { StrengthPageKey } from '../components/AppShell';
import { ContentState, FilterBar, PageContainer, PageHeader } from '../components/PageLayout';
import {
  STRENGTH_BODY_POSITIONS,
  STRENGTH_TRAINING_CATEGORIES,
  inferStrengthBodyPosition,
  inferStrengthCategory,
  type StrengthBodyPosition,
  type StrengthTrainingCategory,
} from '../../shared/strength-training';
import type { Athlete, StrengthTest, StrengthTrainingSession, User } from '../types';
import './StrengthTrainingAnalysisPage.css';

type Props = {
  onPlanOpen: () => void;
  section: StrengthPageKey;
  user: User;
  athletes: Athlete[];
  athleteId: number | null;
  from: string;
  to: string;
  onSectionChange: (section: StrengthPageKey) => void;
  onChanged: () => void;
};

function firstRecordedCategory(sessions: StrengthTrainingSession[]) {
  return STRENGTH_TRAINING_CATEGORIES.find((category) =>
    sessions.some((session) =>
      session.sets.some(
        (set) => (set.trainingCategory || inferStrengthCategory(set.exerciseName)) === category
      )
    )
  );
}

function sourceLabel(source: string) {
  return source === 'ai_import' ? 'AI识别' : source === 'file_import' ? '文件导入' : '手动录入';
}

export function StrengthTrainingAnalysisPage(props: Props) {
  // 体能模块固定以当前项目的全部队员为统计口径，不继承全局个人筛选。
  const teamKey = useMemo(
    () =>
      props.athletes
        .map((item) => item.id)
        .sort((left, right) => left - right)
        .join(','),
    [props.athletes]
  );
  const [activeCategory, setActiveCategory] = useState<StrengthTrainingCategory>('基础力量');
  const [categoryFilter, setCategoryFilter] = useState<'全部' | StrengthTrainingCategory>('全部');
  const [bodyPosition, setBodyPosition] = useState<'全部' | StrengthBodyPosition>('全部');
  const [recordDate, setRecordDate] = useState('');
  const [sessions, setSessions] = useState<StrengthTrainingSession[]>([]);
  const [tests, setTests] = useState<StrengthTest[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!props.athletes.length) {
      setSessions([]);
      setTests([]);
      setRecordDate('');
      return;
    }
    setRecordDate('');
    setLoading(true);
    setMessage('');
    Promise.all(
      props.athletes.map(async (teamAthlete) => {
        const [resultResponse, testResponse] = await Promise.all([
          api.strengthTrainingResults(teamAthlete.id),
          api.strengthTests(teamAthlete.id),
        ]);
        return { resultResponse, testResponse };
      })
    )
      .then((responses) => {
        const nextSessions = responses.flatMap((item) => item.resultResponse.sessions);
        setSessions(nextSessions);
        const sessionsInPeriod = nextSessions.filter(
          (session) => session.trainingDate >= props.from && session.trainingDate <= props.to
        );
        setActiveCategory((current) =>
          firstRecordedCategory(sessionsInPeriod) &&
          !sessionsInPeriod.some((session) =>
            session.sets.some(
              (set) => (set.trainingCategory || inferStrengthCategory(set.exerciseName)) === current
            )
          )
            ? firstRecordedCategory(sessionsInPeriod)!
            : current
        );
        setTests(responses.flatMap((item) => item.testResponse.tests));
      })
      .catch((error) => setMessage(error instanceof Error ? error.message : '体能训练读取失败。'))
      .finally(() => setLoading(false));
  }, [teamKey, props.athletes, props.from, props.to]);

  const periodSessions = useMemo(
    () =>
      sessions.filter(
        (session) => session.trainingDate >= props.from && session.trainingDate <= props.to
      ),
    [props.from, props.to, sessions]
  );
  const filteredSessions = useMemo(
    () =>
      periodSessions
        .map((session) => ({
          ...session,
          sets: session.sets.filter((set) => {
            const setCategory = set.trainingCategory || inferStrengthCategory(set.exerciseName);
            const setBodyPosition = set.bodyPosition || inferStrengthBodyPosition(set.exerciseName);
            const categoryMatches =
              props.section === 'strength-plan' ||
              (props.section === 'strength-records'
                ? activeCategory === setCategory
                : categoryFilter === '全部' || categoryFilter === setCategory);
            const bodyMatches =
              props.section === 'strength-overview' ||
              bodyPosition === '全部' ||
              setBodyPosition === bodyPosition;
            return categoryMatches && bodyMatches;
          }),
        }))
        .filter((session) => session.sets.length),
    [activeCategory, bodyPosition, categoryFilter, periodSessions, props.section]
  );
  const recordListSessions = useMemo(() => {
    const sorted = [...filteredSessions].sort(
      (left, right) =>
        right.trainingDate.localeCompare(left.trainingDate) ||
        right.sessionOrder - left.sessionOrder ||
        right.id - left.id
    );
    if (props.section !== 'strength-records') return sorted;
    return recordDate
      ? sorted.filter((session) => session.trainingDate === recordDate)
      : sorted.slice(0, 10);
  }, [filteredSessions, props.section, recordDate]);
  const pageTitle = {
    'strength-overview': '体能分析',
    'strength-plan': '训练安排',
    'strength-records': '训练记录',
    'strength-analysis': '体能分析',
    'strength-assessment': '体能分析',
  }[props.section];
  const showLocalFilters = ['strength-plan', 'strength-records', 'strength-analysis'].includes(
    props.section
  );
  const overviewStats = useMemo(() => {
    const periodSets = periodSessions.flatMap((session) => session.sets);
    const completed = periodSets.filter((item) => item.completed).length;
    const rpeValues = periodSets
      .map((item) => item.rpe)
      .filter((value): value is number => value !== null);
    return {
      sessions: periodSessions.length,
      completion: periodSets.length ? Math.round((completed / periodSets.length) * 100) : 0,
      volume: Math.round(
        periodSets.reduce((sum, item) => sum + item.actualReps * item.actualWeightKg, 0)
      ),
      rpe: rpeValues.length
        ? Math.round((rpeValues.reduce((sum, value) => sum + value, 0) / rpeValues.length) * 10) /
          10
        : null,
      latest: periodSessions[0]?.trainingDate || '暂无',
    };
  }, [periodSessions]);

  if (!props.athletes.length)
    return (
      <PageContainer className="professional-overview strength-workbench">
        <ContentState
          kind="empty"
          className="strength-empty"
          icon={<Dumbbell size={34} />}
          title="当前项目没有可统计的运动员"
          description="添加运动员后，体能训练页面会自动汇总全队数据。"
        />
      </PageContainer>
    );

  return (
    <PageContainer className="professional-overview strength-workbench">
      <PageHeader
        variant="dashboard"
        className="overview-page-heading strength-page-head training-plan-entry-heading"
        eyebrow="STRENGTH TRAINING"
        title={pageTitle}
        actions={
          <button className="dashboard-action-button" onClick={props.onPlanOpen}>
            训练计划
          </button>
        }
      />

      {['strength-overview', 'strength-analysis', 'strength-assessment'].includes(
        props.section
      ) && (
        <nav className="strength-category-tabs" aria-label="体能分析视图">
          {(
            [
              ['strength-overview', '训练总览'],
              ['strength-analysis', '训练分析'],
              ['strength-assessment', '体能评估'],
            ] as Array<[StrengthPageKey, string]>
          ).map(([key, label]) => (
            <button
              key={key}
              className={props.section === key ? 'active' : ''}
              onClick={() => props.onSectionChange(key)}
            >
              {label}
            </button>
          ))}
        </nav>
      )}

      {showLocalFilters && (
        <FilterBar
          className="strength-filter-bar"
          label="体能训练内容筛选"
          actions={
            <button
              className="strength-filter-reset"
              onClick={() => {
                setCategoryFilter('全部');
                setBodyPosition('全部');
              }}
              title="重置训练类型和身体位置"
            >
              <RotateCcw size={15} />
              <span>重置</span>
            </button>
          }
        >
          <div className="strength-filter-intro">
            <i>
              <SlidersHorizontal size={18} />
            </i>
            <div>
              <strong>筛选条件</strong>
              <small>切换后图表与记录同步更新</small>
            </div>
          </div>
          <div className="strength-command-controls">
            {props.section === 'strength-records' && (
              <label className="period-filter">
                <span>
                  <CalendarRange size={13} />
                  统计周期
                </span>
                <strong>
                  {props.from} — {props.to}
                </strong>
              </label>
            )}
            {['strength-overview', 'strength-analysis'].includes(props.section) && (
              <label>
                <span>
                  <Dumbbell size={13} />
                  训练类型
                </span>
                <select
                  aria-label="训练类型"
                  value={categoryFilter}
                  onChange={(event) =>
                    setCategoryFilter(event.target.value as '全部' | StrengthTrainingCategory)
                  }
                >
                  <option>全部</option>
                  {STRENGTH_TRAINING_CATEGORIES.map((category) => (
                    <option key={category}>{category}</option>
                  ))}
                </select>
              </label>
            )}
            {!['strength-overview', 'strength-assessment'].includes(props.section) && (
              <label>
                <span>
                  <Scale size={13} />
                  身体位置
                </span>
                <select
                  aria-label="训练身体位置"
                  value={bodyPosition}
                  onChange={(event) =>
                    setBodyPosition(event.target.value as '全部' | StrengthBodyPosition)
                  }
                >
                  <option>全部</option>
                  {STRENGTH_BODY_POSITIONS.map((position) => (
                    <option key={position}>{position}</option>
                  ))}
                </select>
              </label>
            )}
          </div>
        </FilterBar>
      )}

      <section className="strength-training-context">
        <div className="strength-training-avatar">队</div>
        <div className="strength-training-athlete">
          <span>统计范围</span>
          <strong>全队整体数据</strong>
          <small>
            {projectLabel(props.athletes[0]?.project || '')} · {props.athletes.length} 名运动员
          </small>
        </div>
        <dl>
          <div>
            <dt>统计周期</dt>
            <dd>
              {props.from} — {props.to}
            </dd>
          </div>
          <div>
            <dt>覆盖队员</dt>
            <dd>{props.athletes.length} 人</dd>
          </div>
          <div>
            <dt>训练记录</dt>
            <dd>{sessions.length} 场</dd>
          </div>
          <div>
            <dt>最近结果</dt>
            <dd>{overviewStats.latest}</dd>
          </div>
        </dl>
      </section>

      {['strength-plan', 'strength-records'].includes(props.section) && (
        <StrengthPlanCategoryTabs value={activeCategory} onChange={setActiveCategory} />
      )}
      {message && (
        <div
          className={`strength-inline-message ${message.includes('失败') || message.includes('无权') ? 'error' : 'success'}`}
        >
          {message}
        </div>
      )}

      {loading ? (
        <ContentState
          kind="loading"
          className="strength-empty"
          icon={<LoaderCircle className="spin" size={30} />}
          title="正在读取体能训练"
        />
      ) : props.section === 'strength-overview' ? (
        <StrengthOverviewPanel sessions={filteredSessions} />
      ) : props.section === 'strength-analysis' ? (
        <StrengthAnalysisPanel sessions={filteredSessions} />
      ) : props.section === 'strength-assessment' ? (
        <StrengthAssessmentPanel tests={tests} />
      ) : (
        <section className="strength-results-panel">
          <header>
            <div>
              <span>COMPLETED TRAINING</span>
              <h2>已保存的训练结果</h2>
              <p>默认展示最近 10 条，更早记录可通过日历按日期查看。</p>
            </div>
          </header>
          {filteredSessions.length ? (
            <>
              <StrengthTrainingLoadChart sessions={filteredSessions} />
              <div className="strength-record-browser">
                <div>
                  <strong>{recordDate ? `${recordDate} 的训练记录` : '最近 10 条训练记录'}</strong>
                  <span>
                    {recordDate
                      ? `当天共 ${recordListSessions.length} 条`
                      : `当前筛选共 ${filteredSessions.length} 条，明细展示 ${recordListSessions.length} 条`}
                  </span>
                </div>
                <label>
                  <span>
                    <CalendarRange size={14} />
                    按日期查看
                  </span>
                  <input
                    type="date"
                    aria-label="按日期查看训练记录"
                    value={recordDate}
                    onChange={(event) => setRecordDate(event.target.value)}
                  />
                </label>
                {recordDate && (
                  <button type="button" onClick={() => setRecordDate('')}>
                    <RotateCcw size={14} />
                    返回最近 10 条
                  </button>
                )}
              </div>
              {recordListSessions.length ? (
                <div className="strength-session-list">
                  {recordListSessions.map((session) => (
                    <article className="strength-session-card" key={session.id}>
                      <header>
                        <div>
                          <time>{session.trainingDate}</time>
                          <strong>{session.sessionLabel}</strong>
                          <span>第{session.sessionOrder}场</span>
                        </div>
                        <div>
                          <span>{sourceLabel(session.source)}</span>
                          {session.sourceFilename && (
                            <small title={session.sourceFilename}>{session.sourceFilename}</small>
                          )}
                          <strong>{Math.round(session.volume).toLocaleString()} kg·reps</strong>
                        </div>
                      </header>
                      <div className="strength-result-table">
                        <div className="result-head">
                          <span>动作</span>
                          <span>计划</span>
                          <span>实际</span>
                          <span>强度</span>
                          <span>时间</span>
                          <span>RPE</span>
                          <span>完成</span>
                        </div>
                        {session.sets.map((set) => (
                          <div className="result-row" key={set.id}>
                            <strong>{set.exerciseName}</strong>
                            <span>
                              {set.targetReps ?? '—'}次 · {set.plannedWeightKg ?? '—'}kg
                            </span>
                            <span>
                              {set.actualReps}次 · {set.actualWeightKg}kg
                            </span>
                            <span>{set.intensityPercent ?? '—'}%</span>
                            <span>{set.durationMin || '—'} min</span>
                            <span>{set.rpe ?? '—'}</span>
                            <span className={set.completed ? 'done' : 'missed'}>
                              {set.completed ? <CheckCircle2 size={15} /> : <X size={15} />}
                              {set.completed ? '完成' : '未完成'}
                            </span>
                          </div>
                        ))}
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <div className="strength-empty compact">
                  <CalendarRange size={28} />
                  <strong>该日期没有训练记录</strong>
                  <span>请选择日历中的其他日期，或返回最近 10 条。</span>
                </div>
              )}
            </>
          ) : (
            <div className="strength-empty results">
              <Scale size={28} />
              <strong>当前分类还没有训练结果</strong>
              <span>当前周期暂未同步训练结果。</span>
            </div>
          )}
        </section>
      )}
    </PageContainer>
  );
}
