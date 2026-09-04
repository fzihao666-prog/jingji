import {
  Bot,
  CalendarRange,
  CheckCircle2,
  Download,
  Dumbbell,
  FilePlus2,
  History,
  Import,
  LoaderCircle,
  MoreHorizontal,
  Plus,
  RotateCcw,
  Save,
  Scale,
  SlidersHorizontal,
  Trash2,
  UserRound,
  X
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { AITrainingPlanGenerator } from '../components/AITrainingPlanGenerator';
import { StrengthResultImportDialog } from '../components/StrengthResultImportDialog';
import { StrengthTrainingLoadChart } from '../components/StrengthTrainingLoadChart';
import {
  StrengthAnalysisPanel,
  StrengthAssessmentPanel,
  StrengthOverviewPanel,
  StrengthPlanCategoryTabs
} from '../components/StrengthTrainingInsights';
import type { StrengthPageKey } from '../components/AppShell';
import {
  STRENGTH_BODY_POSITIONS,
  STRENGTH_TRAINING_CATEGORIES,
  inferStrengthBodyPosition,
  inferStrengthCategory,
  type StrengthBodyPosition,
  type StrengthTrainingCategory
} from '../../shared/strength-training';
import type {
  Athlete,
  StrengthTest,
  StrengthTrainingSession,
  TrainingPlan,
  TrainingPlanData,
  TrainingPlanExercise,
  TrainingPlanWeekEntry,
  User
} from '../types';
import { addDays, toIsoDate } from '../utils';
import './TrainingPlanPage.css';

type Props = {
  section: StrengthPageKey;
  user: User;
  athletes: Athlete[];
  athleteId: number | null;
  initialPlanId?: number | null;
  onAthleteChange: (athleteId: number | null) => void;
  onChanged: () => void;
};

type StrengthOverviewPeriod = 'day' | 'week' | 'month';

const defaultWeekKeys = ['1', '2', '3', '4'];
let itemSequence = 0;

function itemId() {
  itemSequence += 1;
  return `strength-${Date.now().toString(36)}-${itemSequence.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function emptyWeek(): TrainingPlanWeekEntry {
  return { sets: '', reps: '', percentage: null, actualCompleted: '', arrangement: '' };
}

function emptyLine(weekKeys = defaultWeekKeys) {
  return { id: itemId(), weeks: Object.fromEntries(weekKeys.map((key) => [key, emptyWeek()])) };
}

function emptyExercise(name = '', weekKeys = defaultWeekKeys, category: StrengthTrainingCategory = '基础力量'): TrainingPlanExercise {
  return { id: itemId(), name, maxWeight: null, unitNote: '', category, bodyPosition: inferStrengthBodyPosition(name), targetIntensity: null, estimatedMinutes: null, lines: [emptyLine(weekKeys)] };
}

function emptyPlan(): TrainingPlanData {
  const startDate = toIsoDate(new Date());
  return {
    startDate,
    endDate: addDays(startDate, 27),
    title: '四周体能训练',
    scheduleLabel: '周二 / 周五',
    bodyWeight: null,
    age: null,
    weekKeys: defaultWeekKeys,
    weekLabels: Object.fromEntries(defaultWeekKeys.map((key) => [key, `第 ${key} 周`])),
    exercises: [emptyExercise('卧拉'), emptyExercise('卧推'), emptyExercise('深蹲')]
  };
}

function planWeekKeys(data: TrainingPlanData) {
  const explicit = (data.weekKeys || []).map(String).filter(Boolean);
  if (explicit.length) return [...new Set(explicit)];
  const firstLine = data.exercises.flatMap((exercise) => exercise.lines).find(Boolean);
  const stored = firstLine ? Object.keys(firstLine.weeks || {}) : [];
  return stored.length ? stored : defaultWeekKeys;
}

function nullableNumber(value: string) {
  if (!value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function prescriptionNumber(value: string | number | null | undefined) {
  const values = String(value ?? '').match(/\d+(?:\.\d+)?/g)?.map(Number).filter(Number.isFinite) || [];
  if (!values.length) return 0;
  return values.reduce((sum, item) => sum + item, 0) / values.length;
}

function targetWeight(maxWeight: number | null, percentage: number | null) {
  if (maxWeight === null || percentage === null) return null;
  return Math.round(maxWeight * percentage) / 100;
}

function plannedWeightString(maxWeight: number | null, percentage: number | null) {
  const weight = targetWeight(maxWeight, percentage);
  return weight === null ? '—' : `${weight.toFixed(1)} kg`;
}

function sourceLabel(source: string) {
  return source === 'ai_import' ? 'AI识别' : source === 'file_import' ? '文件导入' : '手动录入';
}

export function TrainingPlanPage(props: Props) {
  const selectedId = props.user.role === 'ATL' ? props.user.athleteId : props.athleteId || props.athletes[0]?.id || null;
  const athlete = useMemo(() => props.athletes.find((item) => item.id === selectedId) || null, [props.athletes, selectedId]);
  const canEdit = props.user.role !== 'ATL';
  const [activeCategory, setActiveCategory] = useState<StrengthTrainingCategory>('基础力量');
  const [categoryFilter, setCategoryFilter] = useState<'全部' | StrengthTrainingCategory>('全部');
  const [bodyPosition, setBodyPosition] = useState<'全部' | StrengthBodyPosition>('全部');
  const [overviewPeriod, setOverviewPeriod] = useState<StrengthOverviewPeriod>('month');
  const [recordDate, setRecordDate] = useState('');
  const [plans, setPlans] = useState<TrainingPlan[]>([]);
  const [planId, setPlanId] = useState<number | null>(null);
  const [data, setData] = useState<TrainingPlanData>(emptyPlan);
  const weekKeys = useMemo(() => planWeekKeys(data), [data]);
  const [activeWeek, setActiveWeek] = useState('1');
  const [sessions, setSessions] = useState<StrengthTrainingSession[]>([]);
  const [tests, setTests] = useState<StrengthTest[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');
  const [aiOpen, setAiOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const isAIPlan = Boolean(data.sourceType);

  useEffect(() => {
    if (!selectedId && props.user.role !== 'ATL' && props.athletes[0]) props.onAthleteChange(props.athletes[0].id);
  }, [props.athletes, props.user.role, selectedId]);

  useEffect(() => {
    if (!athlete) {
      setPlans([]); setPlanId(null); setData(emptyPlan()); setSessions([]); setTests([]); setRecordDate('');
      return;
    }
    setRecordDate('');
    setLoading(true);
    setMessage('');
    Promise.all([api.trainingPlans(athlete.id), api.strengthTrainingResults(athlete.id), api.strengthTests(athlete.id)])
      .then(([planResponse, resultResponse, testResponse]) => {
        setPlans(planResponse.plans);
        const selected = planResponse.plans.find((plan) => plan.id === props.initialPlanId) || planResponse.plans[0];
        setPlanId(selected?.id || null);
        setData(selected?.data || emptyPlan());
        setActiveWeek(planWeekKeys(selected?.data || emptyPlan())[0] || '1');
        setSessions(resultResponse.sessions);
        setTests(testResponse.tests);
      })
      .catch((error) => setMessage(error instanceof Error ? error.message : '体能训练读取失败。'))
      .finally(() => setLoading(false));
  }, [athlete?.id, props.initialPlanId]);

  const refresh = async (selectedPlanId?: number) => {
    if (!athlete) return;
    const [planResponse, resultResponse, testResponse] = await Promise.all([api.trainingPlans(athlete.id), api.strengthTrainingResults(athlete.id), api.strengthTests(athlete.id)]);
    setPlans(planResponse.plans);
    setSessions(resultResponse.sessions);
    setTests(testResponse.tests);
    const selected = planResponse.plans.find((item) => item.id === selectedPlanId) || planResponse.plans.find((item) => item.id === planId) || planResponse.plans[0];
    setPlanId(selected?.id || null);
    setData(selected?.data || emptyPlan());
  };

  const selectPlan = (id: number) => {
    const plan = plans.find((item) => item.id === id);
    if (!plan) return;
    setPlanId(plan.id);
    setData(plan.data);
    setActiveWeek(planWeekKeys(plan.data)[0] || '1');
    setMessage('');
  };

  const updateField = <K extends keyof TrainingPlanData>(key: K, value: TrainingPlanData[K]) => setData((current) => ({ ...current, [key]: value }));
  const updateExercise = (exerciseId: string, patch: Partial<TrainingPlanExercise>) => setData((current) => ({
    ...current,
    exercises: current.exercises.map((exercise) => exercise.id === exerciseId ? { ...exercise, ...patch } : exercise)
  }));
  const updateWeekForKey = (exerciseId: string, lineId: string, weekKey: string, patch: Partial<TrainingPlanWeekEntry>) => setData((current) => ({
    ...current,
    exercises: current.exercises.map((exercise) => exercise.id !== exerciseId ? exercise : {
      ...exercise,
      lines: exercise.lines.map((line) => line.id !== lineId ? line : {
        ...line,
        weeks: { ...line.weeks, [weekKey]: { ...(line.weeks[weekKey] || emptyWeek()), ...patch } }
      })
    })
  }));

  const addLine = (exerciseId: string) => setData((current) => ({
    ...current,
    exercises: current.exercises.map((exercise) => exercise.id === exerciseId && exercise.lines.length < 12
      ? { ...exercise, lines: [...exercise.lines, emptyLine(planWeekKeys(current))] }
      : exercise)
  }));
  const removeLine = (exerciseId: string, lineId: string) => setData((current) => ({
    ...current,
    exercises: current.exercises.map((exercise) => exercise.id !== exerciseId || exercise.lines.length === 1
      ? exercise
      : { ...exercise, lines: exercise.lines.filter((line) => line.id !== lineId) })
  }));
  const removeExercise = (exerciseId: string) => setData((current) => ({
    ...current,
    exercises: current.exercises.length === 1 ? current.exercises : current.exercises.filter((exercise) => exercise.id !== exerciseId)
  }));

  const save = async () => {
    if (!athlete) return;
    setBusy('save'); setMessage('');
    try {
      const result = await api.saveTrainingPlan(athlete.id, data, planId);
      await refresh(result.id);
      setMessage(result.message);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '保存失败。');
    } finally { setBusy(''); }
  };

  const deletePlan = async () => {
    if (!athlete || !planId) return;
    if (!window.confirm(`确认删除${athlete.name}当前选择的体能训练？删除后无法恢复。`)) return;
    setBusy('delete'); setMessage('');
    try { const result = await api.deleteTrainingPlan(planId); await refresh(); setMessage(result.message); }
    catch (error) { setMessage(error instanceof Error ? error.message : '删除失败。'); }
    finally { setBusy(''); setMoreOpen(false); }
  };

  const download = async () => {
    if (!athlete || !planId) return;
    setBusy('download'); setMessage('');
    try { await api.downloadTrainingPlan(planId, `${athlete.name}_${data.startDate}_体能训练.xlsx`); }
    catch (error) { setMessage(error instanceof Error ? error.message : '导出失败。'); }
    finally { setBusy(''); setMoreOpen(false); }
  };

  const allSets = useMemo(() => sessions.flatMap((session) => session.sets.map((set) => ({ ...set, session }))), [sessions]);
  const latestTrainingDate = useMemo(() => sessions.reduce((latest, session) => session.trainingDate > latest ? session.trainingDate : latest, ''), [sessions]);
  const overviewPeriodRange = useMemo(() => {
    if (!latestTrainingDate) return { from: '', to: '', label: '暂无结果' };
    const days = overviewPeriod === 'day' ? 0 : overviewPeriod === 'week' ? 6 : 29;
    const from = addDays(latestTrainingDate, -days);
    return { from, to: latestTrainingDate, label: overviewPeriod === 'day' ? latestTrainingDate : `${from} — ${latestTrainingDate}` };
  }, [latestTrainingDate, overviewPeriod]);
  const periodSessions = useMemo(() => {
    if (props.section !== 'strength-overview' || !overviewPeriodRange.from) return sessions;
    return sessions.filter((session) => session.trainingDate >= overviewPeriodRange.from && session.trainingDate <= overviewPeriodRange.to);
  }, [overviewPeriodRange.from, overviewPeriodRange.to, props.section, sessions]);
  const filteredSessions = useMemo(() => periodSessions.map((session) => ({
    ...session,
    sets: session.sets.filter((set) => {
      const setCategory = set.trainingCategory || inferStrengthCategory(set.exerciseName);
      const setBodyPosition = set.bodyPosition || inferStrengthBodyPosition(set.exerciseName);
      const categoryMatches = props.section === 'strength-plan'
        || (props.section === 'strength-records' ? activeCategory === setCategory : categoryFilter === '全部' || categoryFilter === setCategory);
      const bodyMatches = props.section === 'strength-overview' || bodyPosition === '全部' || setBodyPosition === bodyPosition;
      return categoryMatches && bodyMatches;
    })
  })).filter((session) => session.sets.length), [activeCategory, bodyPosition, categoryFilter, periodSessions, props.section]);
  const recordListSessions = useMemo(() => {
    const sorted = [...filteredSessions].sort((left, right) =>
      right.trainingDate.localeCompare(left.trainingDate)
      || right.sessionOrder - left.sessionOrder
      || right.id - left.id
    );
    if (props.section !== 'strength-records') return sorted;
    return recordDate ? sorted.filter((session) => session.trainingDate === recordDate) : sorted.slice(0, 10);
  }, [filteredSessions, props.section, recordDate]);
  const pageMeta = {
    'strength-overview': ['体能总览', '快速判断运动员最近练得怎么样，优先查看训练负荷与完成情况。'],
    'strength-plan': ['训练安排', '制定并管理五类体能训练处方，明确动作、负荷、强度与时间。'],
    'strength-records': ['训练记录', '核对每次体能训练的实际完成情况，并导入教练记录。'],
    'strength-analysis': ['训练分析', '分析训练量、强度结构、水陆比例与训练课构成。'],
    'strength-assessment': ['体能评估', '通过周期测试判断运动员能力是否进步。']
  }[props.section];
  const overviewStats = useMemo(() => {
    const completed = allSets.filter((item) => item.completed).length;
    const rpeValues = allSets.map((item) => item.rpe).filter((value): value is number => value !== null);
    return {
      sessions: sessions.length,
      completion: allSets.length ? Math.round(completed / allSets.length * 100) : 0,
      volume: Math.round(allSets.reduce((sum, item) => sum + item.actualReps * item.actualWeightKg, 0)),
      rpe: rpeValues.length ? Math.round(rpeValues.reduce((sum, value) => sum + value, 0) / rpeValues.length * 10) / 10 : null,
      latest: sessions[0]?.trainingDate || '暂无'
    };
  }, [allSets, sessions]);

  const comparisons = useMemo(() => data.exercises.filter((exercise) => exercise.name.trim()).map((exercise) => {
    const plannedSets = weekKeys.reduce((sum, weekKey) => sum + exercise.lines.reduce((lineSum, line) => lineSum + prescriptionNumber(line.weeks[weekKey]?.sets), 0), 0);
    const actual = allSets.filter((item) => item.exerciseName.trim() === exercise.name.trim() && item.session.trainingDate >= data.startDate && item.session.trainingDate <= data.endDate);
    const latest = actual[0];
    const estimatedMax = actual.reduce((max, item) => Math.max(max, item.actualWeightKg * (1 + item.actualReps / 30)), 0);
    const active = exercise.lines[0]?.weeks[activeWeek] || emptyWeek();
    const weight = targetWeight(exercise.maxWeight, active.percentage);
    return {
      id: exercise.id,
      name: exercise.name,
      target: `${active.sets || '—'} × ${active.reps || '—'}${weight === null ? '' : ` · ${weight.toFixed(1)}kg`}`,
      actual: latest ? `${latest.actualReps}次 · ${latest.actualWeightKg}kg` : '尚未导入',
      completion: plannedSets ? Math.min(100, Math.round(actual.filter((item) => item.completed).length / plannedSets * 100)) : 0,
      rpe: latest?.rpe ?? null,
      estimatedMax: estimatedMax ? Math.round(estimatedMax * 10) / 10 : null,
      maxWeight: exercise.maxWeight
    };
  }), [activeWeek, allSets, data.endDate, data.exercises, data.startDate, weekKeys]);

  if (!athlete) return <div className="page-content professional-overview strength-workbench"><section className="strength-empty"><Dumbbell size={34} /><strong>暂无可查看的运动员</strong></section></div>;

  return (
    <div className="page-content professional-overview strength-workbench">
      <header className="page-heading overview-page-heading strength-page-head">
        <div className="strength-title"><span>STRENGTH TRAINING</span><h1>{pageMeta[0]}</h1><p>{pageMeta[1]}</p></div>
        <div className="strength-command-actions">
          {canEdit && ['strength-overview', 'strength-plan'].includes(props.section) && <button className="strength-button ai" onClick={() => setAiOpen(true)}><Bot size={17} />AI生成计划</button>}
          {canEdit && ['strength-overview', 'strength-records', 'strength-analysis'].includes(props.section) && <button className="strength-button import" onClick={() => setImportOpen(true)}><Import size={17} />导入训练结果</button>}
          {canEdit && props.section === 'strength-plan' && <button className="strength-button save" disabled={busy === 'save'} onClick={save}>{busy === 'save' ? <LoaderCircle className="spin" size={17} /> : <Save size={17} />}保存方案</button>}
          {props.section === 'strength-plan' && <div className="strength-more"><button className="strength-icon-button" aria-label="更多操作" onClick={() => setMoreOpen((open) => !open)}><MoreHorizontal size={20} /></button>{moreOpen && <div className="strength-more-menu">
            {canEdit && <button onClick={() => { setPlanId(null); setData(emptyPlan()); setActiveWeek('1'); setMoreOpen(false); }}><FilePlus2 size={15} />新建计划</button>}
            <button disabled={!planId || busy === 'download'} onClick={download}><Download size={15} />导出计划</button>
            {canEdit && planId && <button className="danger" disabled={busy === 'delete'} onClick={deletePlan}><Trash2 size={15} />删除计划</button>}
          </div>}</div>}
        </div>
      </header>

      <section className="strength-filter-bar" aria-label="体能训练筛选条件">
        <div className="strength-filter-intro"><i><SlidersHorizontal size={18} /></i><div><strong>筛选条件</strong><small>切换后图表与记录同步更新</small></div></div>
        <div className="strength-command-controls">
          {props.user.role !== 'ATL' && <label><span><UserRound size={13} />运动员</span><select aria-label="体能训练运动员" value={selectedId || ''} onChange={(event) => props.onAthleteChange(Number(event.target.value))}>{props.athletes.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.team}</option>)}</select></label>}
          {props.section === 'strength-overview' && <div className="strength-period-options"><span><CalendarRange size={13} />训练周期</span><div>{([['day', '日'], ['week', '周'], ['month', '月']] as const).map(([key, label]) => <button key={key} type="button" className={overviewPeriod === key ? 'active' : ''} aria-pressed={overviewPeriod === key} onClick={() => setOverviewPeriod(key)}>{label}</button>)}</div></div>}
          {['strength-plan', 'strength-records'].includes(props.section) && <label className="period-filter"><span><CalendarRange size={13} />训练周期</span><select aria-label="训练周期" disabled={!plans.length} value={planId || ''} onChange={(event) => selectPlan(Number(event.target.value))}>{plans.length ? plans.map((plan) => <option key={plan.id} value={plan.id}>{plan.data.startDate}—{plan.data.endDate} · {plan.data.title}</option>) : <option value="">暂无训练周期</option>}</select></label>}
          {['strength-overview', 'strength-analysis'].includes(props.section) && <label><span><Dumbbell size={13} />训练类型</span><select aria-label="训练类型" value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value as '全部' | StrengthTrainingCategory)}><option>全部</option>{STRENGTH_TRAINING_CATEGORIES.map((category) => <option key={category}>{category}</option>)}</select></label>}
          {!['strength-overview', 'strength-assessment'].includes(props.section) && <label><span><Scale size={13} />身体位置</span><select aria-label="训练身体位置" value={bodyPosition} onChange={(event) => setBodyPosition(event.target.value as '全部' | StrengthBodyPosition)}><option>全部</option>{STRENGTH_BODY_POSITIONS.map((position) => <option key={position}>{position}</option>)}</select></label>}
        </div>
        {props.section !== 'strength-assessment' && <button className="strength-filter-reset" onClick={() => { setCategoryFilter('全部'); setBodyPosition('全部'); }} title="重置训练类型和身体位置"><RotateCcw size={15} /><span>重置</span></button>}
      </section>

      <section className="strength-training-context">
        <div className="strength-training-avatar">{athlete.name.slice(0, 1)}</div>
        <div className="strength-training-athlete"><span>当前运动员</span><strong>{athlete.name}</strong><small>{athlete.project} · {athlete.team}</small></div>
        <dl><div><dt>当前周期</dt><dd>{props.section === 'strength-overview' ? overviewPeriodRange.label : `${data.startDate} — ${data.endDate}`}</dd></div><div><dt>性别</dt><dd>{athlete.gender || '未填写'}</dd></div><div><dt>位置/号位</dt><dd>{athlete.athletePosition || '未填写'}</dd></div><div><dt>训练项目（小项）</dt><dd>{athlete.currentEvent || athlete.project}</dd></div><div><dt>训练安排</dt><dd>{props.section === 'strength-overview' ? ({ day: '日', week: '周', month: '月' }[overviewPeriod]) : data.scheduleLabel || '未设置'}</dd></div><div><dt>最近结果</dt><dd>{overviewStats.latest}</dd></div></dl>
      </section>

      {['strength-plan', 'strength-records'].includes(props.section) && <StrengthPlanCategoryTabs value={activeCategory} onChange={setActiveCategory} />}
      {message && <div className={`strength-inline-message ${message.includes('失败') || message.includes('无权') ? 'error' : 'success'}`}>{message}</div>}

      {loading ? <section className="strength-empty"><LoaderCircle className="spin" size={30} /><strong>正在读取体能训练</strong></section> : props.section === 'strength-overview' ? <StrengthOverviewPanel sessions={filteredSessions} /> : props.section === 'strength-analysis' ? <StrengthAnalysisPanel sessions={filteredSessions} /> : props.section === 'strength-assessment' ? <StrengthAssessmentPanel tests={tests} /> : props.section === 'strength-plan' ? <>
        <section className="strength-plan-meta"><label><span>开始日期</span><input type="date" disabled={!canEdit} value={data.startDate} onChange={(event) => { const startDate = event.target.value; setData((current) => ({ ...current, startDate, endDate: startDate ? addDays(startDate, 27) : '' })); }} /></label><label><span>结束日期</span><input type="date" disabled={!canEdit} min={data.startDate} value={data.endDate} onChange={(event) => updateField('endDate', event.target.value)} /></label><label className="wide"><span>训练名称</span><input disabled={!canEdit} value={data.title} onChange={(event) => updateField('title', event.target.value)} /></label><label className="wide"><span>训练日安排</span><input disabled={!canEdit} value={data.scheduleLabel} onChange={(event) => updateField('scheduleLabel', event.target.value)} /></label><label><span>体重 kg</span><input type="number" step="0.1" disabled={!canEdit} value={data.bodyWeight ?? ''} onChange={(event) => updateField('bodyWeight', nullableNumber(event.target.value))} /></label><label><span>年龄</span><input type="number" disabled={!canEdit} value={data.age ?? ''} onChange={(event) => updateField('age', nullableNumber(event.target.value))} /></label></section>
        <section className="plan-matrix-shell">
          {isAIPlan && <div className="matrix-ai-origin"><strong>{data.sourceType === 'ai_import' ? '历史文件训练' : 'AI 生成训练'}</strong><span>已写入统一训练矩阵，可继续修改并保存</span></div>}
          <div className="plan-matrix-title">
            <div><Dumbbell size={18} /><strong>{data.scheduleLabel || '训练安排'}</strong></div>
            <span>{weekKeys.length} 个训练阶段 · 重量由MAX和百分比计算；填写完成次数后训练结果自动更新</span>
          </div>
          <div className="plan-matrix-scroll">
            <table className="plan-matrix" style={{ minWidth: `${235 + weekKeys.length * 500 + (canEdit ? 44 : 0)}px` }}>
              <thead>
                <tr>
                  <th rowSpan={2} className="max-head">MAX</th>
                  <th rowSpan={2} className="exercise-head">项目</th>
                  {weekKeys.map((weekKey, index) => <th key={weekKey} colSpan={7} className={`week-band week-${index % 4 + 1}`}>{data.weekLabels?.[weekKey] || `WEEK ${index + 1}`}</th>)}
                  {canEdit && <th rowSpan={2} className="tools-head">操作</th>}
                </tr>
                <tr>
                  {weekKeys.flatMap((weekKey, weekIndex) => ['安排', '组', '×', '次', '%', '重量', '完成次数'].map((label, index) => (
                    <th key={`${weekKey}-${label}`} className={`week-sub week-${weekIndex % 4 + 1} ${index === 0 ? 'arrangement-head' : ''} ${index === 6 ? 'actual-head' : ''}`}>{label}</th>
                  )))}
                </tr>
              </thead>
              <tbody>
                {data.exercises.filter((exercise) => (exercise.category || inferStrengthCategory(exercise.name)) === activeCategory).map((exercise) => exercise.lines.map((line, lineIndex) => (
                  <tr key={line.id}>
                    {lineIndex === 0 && <>
                      <td rowSpan={exercise.lines.length} className="max-cell">
                        <input aria-label={`${exercise.name || '项目'} MAX重量`} type="number" step="0.1" disabled={!canEdit} value={exercise.maxWeight ?? ''} onChange={(event) => updateExercise(exercise.id, { maxWeight: nullableNumber(event.target.value) })} />
                        <small>kg</small>
                      </td>
                      <td rowSpan={exercise.lines.length} className="exercise-cell">
                        <textarea aria-label="项目名称" disabled={!canEdit} value={exercise.name} placeholder="输入项目名称" onChange={(event) => updateExercise(exercise.id, { name: event.target.value })} />
                        <select aria-label={`${exercise.name || '项目'}身体位置`} disabled={!canEdit} value={exercise.bodyPosition || inferStrengthBodyPosition(exercise.name)} onChange={(event) => updateExercise(exercise.id, { bodyPosition: event.target.value as StrengthBodyPosition })}>{STRENGTH_BODY_POSITIONS.map((position) => <option key={position}>{position}</option>)}</select>
                        <div className="exercise-meta-row"><label><span>目标强度%</span><input type="number" min="0" max="100" disabled={!canEdit} value={exercise.targetIntensity ?? ''} onChange={(event) => updateExercise(exercise.id, { targetIntensity: nullableNumber(event.target.value) })} /></label><label><span>预计min</span><input type="number" min="0" disabled={!canEdit} value={exercise.estimatedMinutes ?? ''} onChange={(event) => updateExercise(exercise.id, { estimatedMinutes: nullableNumber(event.target.value) })} /></label></div>
                        {canEdit && <div className="exercise-tools"><button onClick={() => addLine(exercise.id)}><Plus size={12} />加行</button><button onClick={() => removeExercise(exercise.id)}><Trash2 size={12} />删除</button></div>}
                      </td>
                    </>}
                    {weekKeys.flatMap((weekKey, weekIndex) => {
                      const week = line.weeks[weekKey] || emptyWeek();
                      const weekClass = `week-${weekIndex % 4 + 1}`;
                      return [
                        <td key={`${weekKey}-arrangement`} className={`week-body ${weekClass} arrangement-cell`}><textarea aria-label={`第${weekKey}周安排`} disabled={!canEdit} placeholder="训练日或其他安排" value={week.arrangement || ''} onChange={(event) => updateWeekForKey(exercise.id, line.id, weekKey, { arrangement: event.target.value })} /></td>,
                        <td key={`${weekKey}-sets`} className={`week-body ${weekClass}`}><input aria-label={`第${weekKey}周组数`} disabled={!canEdit} value={week.sets} onChange={(event) => updateWeekForKey(exercise.id, line.id, weekKey, { sets: event.target.value })} /></td>,
                        <td key={`${weekKey}-times`} className={`week-body ${weekClass} times-cell`}>×</td>,
                        <td key={`${weekKey}-reps`} className={`week-body ${weekClass}`}><input aria-label={`第${weekKey}周次数`} disabled={!canEdit} value={week.reps} onChange={(event) => updateWeekForKey(exercise.id, line.id, weekKey, { reps: event.target.value })} /></td>,
                        <td key={`${weekKey}-percent`} className={`week-body ${weekClass} percent-cell`}><input aria-label={`第${weekKey}周百分比`} type="number" min="0" max="100" step="0.1" disabled={!canEdit} value={week.percentage ?? ''} onChange={(event) => updateWeekForKey(exercise.id, line.id, weekKey, { percentage: nullableNumber(event.target.value) })} /><span>%</span></td>,
                        <td key={`${weekKey}-weight`} className={`week-body ${weekClass} weight-cell`}>{plannedWeightString(exercise.maxWeight, week.percentage)}</td>,
                        <td key={`${weekKey}-actual`} className={`week-body ${weekClass} actual-cell`}><input aria-label={`第${weekKey}周实际完成次数`} inputMode="decimal" disabled={!canEdit} placeholder="填写次数" value={week.actualCompleted} onChange={(event) => updateWeekForKey(exercise.id, line.id, weekKey, { actualCompleted: event.target.value })} /></td>
                      ];
                    })}
                    {canEdit && <td className="line-tools"><button aria-label="删除处方行" onClick={() => removeLine(exercise.id, line.id)}><Trash2 size={14} /></button></td>}
                  </tr>
                )))}
              </tbody>
            </table>
          </div>
          {canEdit && data.exercises.length < (isAIPlan ? 40 : 20) && <button className="plan-add-exercise" onClick={() => setData((current) => ({ ...current, exercises: [...current.exercises, emptyExercise('', planWeekKeys(current), activeCategory)] }))}><Plus size={16} />添加{activeCategory}项目</button>}
        </section>
      </> : <section className="strength-results-panel">
        <header><div><span>COMPLETED TRAINING</span><h2>已保存的训练结果</h2><p>默认展示最近 10 条，更早记录可通过日历按日期查看。</p></div></header>
        {filteredSessions.length ? <><StrengthTrainingLoadChart sessions={filteredSessions} /><div className="strength-record-browser"><div><strong>{recordDate ? `${recordDate} 的训练记录` : '最近 10 条训练记录'}</strong><span>{recordDate ? `当天共 ${recordListSessions.length} 条` : `当前筛选共 ${filteredSessions.length} 条，明细展示 ${recordListSessions.length} 条`}</span></div><label><span><CalendarRange size={14} />按日期查看</span><input type="date" aria-label="按日期查看训练记录" value={recordDate} onChange={(event) => setRecordDate(event.target.value)} /></label>{recordDate && <button type="button" onClick={() => setRecordDate('')}><RotateCcw size={14} />返回最近 10 条</button>}</div>{recordListSessions.length ? <div className="strength-session-list">{recordListSessions.map((session) => <article className="strength-session-card" key={session.id}><header><div><time>{session.trainingDate}</time><strong>{session.sessionLabel}</strong><span>第{session.sessionOrder}场</span></div><div><span>{sourceLabel(session.source)}</span>{session.sourceFilename && <small title={session.sourceFilename}>{session.sourceFilename}</small>}<strong>{Math.round(session.volume).toLocaleString()} kg·reps</strong></div></header><div className="strength-result-table"><div className="result-head"><span>动作</span><span>计划</span><span>实际</span><span>强度</span><span>时间</span><span>RPE</span><span>完成</span></div>{session.sets.map((set) => <div className="result-row" key={set.id}><strong>{set.exerciseName}</strong><span>{set.targetReps ?? '—'}次 · {set.plannedWeightKg ?? '—'}kg</span><span>{set.actualReps}次 · {set.actualWeightKg}kg</span><span>{set.intensityPercent ?? '—'}%</span><span>{set.durationMin || '—'} min</span><span>{set.rpe ?? '—'}</span><span className={set.completed ? 'done' : 'missed'}>{set.completed ? <CheckCircle2 size={15} /> : <X size={15} />}{set.completed ? '完成' : '未完成'}</span></div>)}</div></article>)}</div> : <div className="strength-empty compact"><CalendarRange size={28} /><strong>该日期没有训练记录</strong><span>请选择日历中的其他日期，或返回最近 10 条。</span></div>}</> : <div className="strength-empty results"><Scale size={28} /><strong>当前分类还没有训练结果</strong><span>{canEdit ? '使用页面顶部“导入训练结果”，完成后将在这里生成训练分析。' : '教练导入训练结果后，数据会按训练场次显示在这里。'}</span></div>}
      </section>}

      {aiOpen && <div className="strength-dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setAiOpen(false); }}><section className="strength-ai-drawer" role="dialog" aria-modal="true" aria-label="AI生成体能训练"><header><div><span>PLAN DRAFT</span><h2>AI生成计划草稿</h2></div><button className="strength-icon-button" onClick={() => setAiOpen(false)} aria-label="关闭AI生成"><X size={19} /></button></header><div className="strength-ai-scroll"><AITrainingPlanGenerator athlete={athlete} onSaved={async (savedPlanId) => { await refresh(savedPlanId); props.onChanged(); setAiOpen(false); setMessage('AI计划草稿已确认并保存。'); }} /></div></section></div>}
      {importOpen && <StrengthResultImportDialog athletes={props.athletes} onClose={() => setImportOpen(false)} onCommitted={async () => { await refresh(); props.onChanged(); setMessage('训练结果已保存并更新体能分析。'); }} />}
    </div>
  );
}
