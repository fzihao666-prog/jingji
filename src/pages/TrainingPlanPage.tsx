import {
  Camera,
  CheckCircle2,
  Download,
  Dumbbell,
  FileSpreadsheet,
  FilePlus2,
  LoaderCircle,
  Plus,
  Save,
  Trash2,
  Upload,
  Users,
  X
} from 'lucide-react';
import { useEffect, useMemo, useState, type ChangeEvent } from 'react';
import {
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ResponsiveContainer
} from 'recharts';
import { api } from '../api';
import { AITrainingPlanGenerator } from '../components/AITrainingPlanGenerator';
import type {
  Athlete,
  BatchTrainingPlanPreview,
  TrainingPlan,
  TrainingPlanData,
  TrainingPlanExercise,
  TrainingPlanWeekEntry,
  User
} from '../types';
import { addDays, toIsoDate } from '../utils';

type Props = {
  user: User;
  athletes: Athlete[];
  athleteId: number | null;
  onAthleteChange: (athleteId: number | null) => void;
  onChanged: () => void;
};

const weekKeys = ['1', '2', '3', '4'] as const;

function emptyWeek(): TrainingPlanWeekEntry {
  return { sets: '', reps: '', percentage: null, actualCompleted: '' };
}

let planItemIdSequence = 0;

function createPlanItemId() {
  planItemIdSequence += 1;
  return `plan-${Date.now().toString(36)}-${planItemIdSequence.toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function emptyLine() {
  return {
    id: createPlanItemId(),
    weeks: { '1': emptyWeek(), '2': emptyWeek(), '3': emptyWeek(), '4': emptyWeek() }
  };
}

function emptyExercise(name = ''): TrainingPlanExercise {
  return { id: createPlanItemId(), name, maxWeight: null, unitNote: '', lines: [emptyLine()] };
}

function emptyPlan(): TrainingPlanData {
  const startDate = toIsoDate(new Date());
  return {
    startDate,
    endDate: addDays(startDate, 30),
    title: '四周体能训练计划',
    scheduleLabel: '周二 / 周五',
    bodyWeight: null,
    age: null,
    exercises: [emptyExercise('卧拉'), emptyExercise('卧推'), emptyExercise('深蹲')]
  };
}

function numericValue(value: string) {
  return value === '' ? null : Number(value);
}

function plannedWeight(maxWeight: number | null, percentage: number | null) {
  if (maxWeight === null || percentage === null) return '—';
  return `${(Math.round(maxWeight * percentage) / 100).toFixed(1)} kg`;
}

function prescriptionNumber(value: string) {
  const values = value.match(/\d+(?:\.\d+)?/g)?.map(Number).filter(Number.isFinite) || [];
  if (!values.length) return 0;
  return values.reduce((sum, item) => sum + item, 0) / values.length;
}

function completedRepetitions(value: string) {
  if (!/^\s*\d+(?:\.\d+)?(?:\s*[—–-]\s*\d+(?:\.\d+)?)?\s*$/.test(value)) return 0;
  return prescriptionNumber(value);
}

function actualAverageWeight(exercise: TrainingPlanExercise) {
  if (exercise.maxWeight === null || exercise.maxWeight <= 0 || !exercise.name.trim()) return null;
  let weightedLoad = 0;
  let completedCount = 0;
  for (const line of exercise.lines) {
    for (const weekKey of weekKeys) {
      const week = line.weeks[weekKey];
      const sets = prescriptionNumber(week.sets);
      const repetitions = completedRepetitions(week.actualCompleted);
      if (sets <= 0 || repetitions <= 0 || week.percentage === null) continue;
      const count = sets * repetitions;
      weightedLoad += exercise.maxWeight * week.percentage / 100 * count;
      completedCount += count;
    }
  }
  if (!completedCount) return null;
  return Math.round(weightedLoad / completedCount * 10) / 10;
}

function weightToMaxRatio(weight: number | null, maxWeight: number | null) {
  if (weight === null || maxWeight === null || maxWeight <= 0) return 0;
  return Math.min(100, Math.round(weight / maxWeight * 1000) / 10);
}

type TrainingRadarDatum = {
  slot: number;
  label: string;
  project: string;
  maxWeight: number;
  actualAverageWeight: number;
  actualRatio: number;
};

function trainingRadarData(exercises: TrainingPlanExercise[]) {
  const slots = exercises.slice(0, 8).map((exercise, index) => {
    const project = exercise?.name.trim().replace(/\s*\n\s*/g, ' / ') || '';
    const maxWeight = project ? exercise?.maxWeight || 0 : 0;
    const actualAverage = project && exercise ? actualAverageWeight(exercise) : null;
    const actualRatio = weightToMaxRatio(actualAverage, maxWeight || null);
    return {
      slot: index,
      project,
      maxWeight,
      actualAverageWeight: actualAverage || 0,
      actualRatio
    };
  }).filter((item) => item.project).sort((left, right) => {
    const difference = right.actualRatio - left.actualRatio;
    return difference || left.slot - right.slot;
  });
  return slots.map((item) => ({
    ...item,
    label: item.project
      ? `${item.project}|实际 ${item.actualAverageWeight ? item.actualAverageWeight.toFixed(1) : '—'} kg / MAX ${item.maxWeight || '—'} kg · ${item.actualRatio.toFixed(1)}%`
      : ''
  })) satisfies TrainingRadarDatum[];
}

type RadarShapeProps = {
  points?: Array<{ x: number; y: number; cx?: number; cy?: number }>;
  cx?: number;
  cy?: number;
};

function RadarVolumeShape({ points = [], cx = 0, cy = 0, color, fill, width }: RadarShapeProps & {
  color: string;
  fill: string;
  width: number;
}) {
  if (!points.length) return null;
  const centerX = points.find((point) => point.cx !== undefined)?.cx ?? cx;
  const centerY = points.find((point) => point.cy !== undefined)?.cy ?? cy;
  const polygon = points.map((point) => `${point.x},${point.y}`).join(' ');
  return (
    <g>
      {points.map((point, index) => (
        <line key={index} x1={centerX} y1={centerY} x2={point.x} y2={point.y} stroke={color} strokeWidth={width} strokeLinecap="round" opacity=".34" />
      ))}
      <polygon points={polygon} fill={fill} stroke={color} strokeWidth="2.4" />
      {points.map((point, index) => <circle key={`point-${index}`} cx={point.x} cy={point.y} r="3.2" fill={color} />)}
    </g>
  );
}

function RadarAxisTick({ x = 0, y = 0, payload }: {
  x?: string | number;
  y?: string | number;
  payload?: { value?: string | number };
}) {
  const [project = '', values = ''] = String(payload?.value || '').split('|');
  if (!project) return null;
  const numericX = Number(x) || 0;
  const numericY = Number(y) || 0;
  const anchor = numericX < 200 ? 'end' : numericX > 280 ? 'start' : 'middle';
  return (
    <g transform={`translate(${numericX},${numericY})`}>
      <text textAnchor={anchor} fill="#123845" fontSize="12" fontWeight="800">{project.slice(0, 16)}</text>
      <text y="16" textAnchor={anchor} fill="#5f7880" fontSize="9.5">{values}</text>
    </g>
  );
}

function TrainingVolumeRadar({ exercises }: { exercises: TrainingPlanExercise[] }) {
  const radarData = useMemo(() => trainingRadarData(exercises), [exercises]);
  const activeCount = radarData.filter((item) => item.project).length;
  return (
    <section className="training-volume-radar">
      <header>
        <div><span>ACTUAL INTENSITY</span><strong>实际平均重量 / MAX</strong></div>
        <small>{activeCount}/8 项</small>
      </header>
      <div
        className="radar-stage"
        data-slot-count={radarData.length}
        data-project-array={JSON.stringify(radarData.map((item) => item.project))}
        data-ratio-array={JSON.stringify(radarData.map((item) => item.actualRatio))}
      >
        <ResponsiveContainer width="100%" height="100%">
          <RadarChart data={radarData} cx="50%" cy="50%" outerRadius="72%">
            <PolarGrid gridType="polygon" stroke="#b9cdd1" radialLines />
            <PolarAngleAxis dataKey="label" tick={(props) => <RadarAxisTick {...props} />} />
            <PolarRadiusAxis angle={90} domain={[0, 100]} tickCount={5} tick={false} axisLine={false} />
            <Radar
              name="实际平均重量"
              dataKey="actualRatio"
              shape={(props) => <RadarVolumeShape {...props} color="#078e87" fill="rgba(7,142,135,.20)" width={6} />}
              isAnimationActive={false}
            />
          </RadarChart>
        </ResponsiveContainer>
        <img className="radar-body-figure" src="/assets/strength-anatomy-front.png" alt="人体肌肉解剖示意" />
      </div>
      <footer>
        <span><i className="actual" />实际均重</span>
        <small>外圈顶点 = 该项目 MAX（100%）</small>
      </footer>
    </section>
  );
}

export function TrainingPlanPage(props: Props) {
  const selectedId = props.user.role === 'ATL'
    ? props.user.athleteId
    : props.athleteId || props.athletes[0]?.id || null;
  const athlete = useMemo(
    () => props.athletes.find((item) => item.id === selectedId) || null,
    [props.athletes, selectedId]
  );
  const canEdit = props.user.role !== 'ATL';
  const canUploadPhoto = Boolean(athlete && (canEdit || props.user.athleteId === athlete.id));
  const [plans, setPlans] = useState<TrainingPlan[]>([]);
  const [planId, setPlanId] = useState<number | null>(null);
  const [data, setData] = useState<TrainingPlanData>(emptyPlan);
  const [photoUrl, setPhotoUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');
  const [batchOpen, setBatchOpen] = useState(false);
  const [batchAthleteIds, setBatchAthleteIds] = useState<number[]>([]);
  const [batchPreview, setBatchPreview] = useState<BatchTrainingPlanPreview | null>(null);
  const [batchBusy, setBatchBusy] = useState('');
  const [batchError, setBatchError] = useState('');
  const [replaceExisting, setReplaceExisting] = useState(false);
  const [athleteSearch, setAthleteSearch] = useState('');

  const visibleBatchAthletes = useMemo(() => {
    const query = athleteSearch.trim().toLowerCase();
    if (!query) return props.athletes;
    return props.athletes.filter((item) => `${item.name} ${item.team} ${item.project} ${item.region}`.toLowerCase().includes(query));
  }, [athleteSearch, props.athletes]);

  useEffect(() => {
    if (!selectedId && props.user.role !== 'ATL' && props.athletes[0]) {
      props.onAthleteChange(props.athletes[0].id);
    }
  }, [props, selectedId]);

  useEffect(() => {
    if (!athlete) {
      setPlans([]);
      setPlanId(null);
      setData(emptyPlan());
      setPhotoUrl('');
      return;
    }
    setLoading(true);
    setMessage('');
    setPhotoUrl(athlete.photoUrl || '');
    api.trainingPlans(athlete.id)
      .then(({ plans: nextPlans }) => {
        setPlans(nextPlans);
        const latest = nextPlans[0];
        setPlanId(latest?.id || null);
        setData(latest?.data || emptyPlan());
        if (latest?.photoUrl) setPhotoUrl(latest.photoUrl);
      })
      .catch((error) => setMessage(error instanceof Error ? error.message : '训练计划读取失败。'))
      .finally(() => setLoading(false));
  }, [athlete?.id]);

  const refresh = async () => {
    if (!athlete) return;
    const response = await api.trainingPlans(athlete.id);
    setPlans(response.plans);
    const latest = response.plans[0];
    setPlanId(latest?.id || null);
    setData(latest?.data || emptyPlan());
    if (latest?.photoUrl) setPhotoUrl(latest.photoUrl);
  };

  const selectPlan = (id: number) => {
    const plan = plans.find((item) => item.id === id);
    if (!plan) return;
    setPlanId(plan.id);
    setData(plan.data);
    setMessage('');
  };

  const updateField = <K extends keyof TrainingPlanData>(key: K, value: TrainingPlanData[K]) => {
    setData((current) => ({ ...current, [key]: value }));
  };

  const updateExercise = (exerciseId: string, patch: Partial<TrainingPlanExercise>) => {
    setData((current) => ({
      ...current,
      exercises: current.exercises.map((exercise) => exercise.id === exerciseId ? { ...exercise, ...patch } : exercise)
    }));
  };

  const updateWeek = (
    exerciseId: string,
    lineId: string,
    weekKey: typeof weekKeys[number],
    patch: Partial<TrainingPlanWeekEntry>
  ) => {
    setData((current) => ({
      ...current,
      exercises: current.exercises.map((exercise) => exercise.id !== exerciseId ? exercise : {
        ...exercise,
        lines: exercise.lines.map((line) => line.id !== lineId ? line : {
          ...line,
          weeks: { ...line.weeks, [weekKey]: { ...line.weeks[weekKey], ...patch } }
        })
      })
    }));
  };

  const addLine = (exerciseId: string) => {
    setData((current) => ({
      ...current,
      exercises: current.exercises.map((exercise) => exercise.id === exerciseId && exercise.lines.length < 8
        ? { ...exercise, lines: [...exercise.lines, emptyLine()] }
        : exercise)
    }));
  };

  const removeLine = (exerciseId: string, lineId: string) => {
    setData((current) => ({
      ...current,
      exercises: current.exercises.map((exercise) => exercise.id !== exerciseId ? exercise : {
        ...exercise,
        lines: exercise.lines.length === 1 ? exercise.lines : exercise.lines.filter((line) => line.id !== lineId)
      })
    }));
  };

  const removeExercise = (exerciseId: string) => {
    setData((current) => ({
      ...current,
      exercises: current.exercises.length === 1
        ? current.exercises
        : current.exercises.filter((exercise) => exercise.id !== exerciseId)
    }));
  };

  const save = async () => {
    if (!athlete) return;
    setBusy('save');
    setMessage('');
    try {
      const result = await api.saveTrainingPlan(athlete.id, data, planId);
      const response = await api.trainingPlans(athlete.id);
      setPlans(response.plans);
      const saved = response.plans.find((item) => item.id === result.id);
      setPlanId(result.id);
      if (saved) setData(saved.data);
      setMessage(result.message);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '保存失败。');
    } finally {
      setBusy('');
    }
  };

  const uploadPhoto = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!athlete || !file) return;
    setBusy('photo');
    setMessage('');
    try {
      const result = await api.uploadAthletePhoto(athlete.id, file);
      setPhotoUrl(result.photoUrl);
      setPlans((current) => current.map((plan) => ({ ...plan, photoUrl: result.photoUrl })));
      setMessage(result.message);
      props.onChanged();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '证件照上传失败。');
    } finally {
      setBusy('');
      event.target.value = '';
    }
  };

  const deletePlan = async () => {
    if (!athlete || !planId) return;
    const currentPlan = plans.find((item) => item.id === planId);
    const period = currentPlan ? `${currentPlan.data.startDate} 至 ${currentPlan.data.endDate}` : '当前历史计划';
    if (!window.confirm(`确认删除${athlete.name}在${period}的训练计划？删除后无法恢复。`)) return;
    setBusy('delete');
    setMessage('');
    try {
      const result = await api.deleteTrainingPlan(planId);
      const response = await api.trainingPlans(athlete.id);
      setPlans(response.plans);
      const latest = response.plans[0];
      setPlanId(latest?.id || null);
      setData(latest?.data || emptyPlan());
      setMessage(result.message);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '删除失败。');
    } finally {
      setBusy('');
    }
  };

  const download = async () => {
    if (!athlete || !planId) return;
    setBusy('download');
    setMessage('');
    try {
      await api.downloadTrainingPlan(planId, `${athlete.name}_${data.startDate}_至_${data.endDate}_四周体能计划.xlsx`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '导出失败。');
    } finally {
      setBusy('');
    }
  };

  const openBatchImport = () => {
    setBatchAthleteIds(selectedId ? [selectedId] : []);
    setBatchPreview(null);
    setBatchError('');
    setReplaceExisting(false);
    setAthleteSearch('');
    setBatchOpen(true);
  };

  const toggleBatchAthlete = (athleteId: number) => {
    setBatchPreview(null);
    setBatchAthleteIds((current) => current.includes(athleteId)
      ? current.filter((id) => id !== athleteId)
      : [...current, athleteId]);
  };

  const previewBatchFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!batchAthleteIds.length) {
      setBatchError('请先选择需要生成计划的运动员。');
      event.target.value = '';
      return;
    }
    setBatchBusy('preview');
    setBatchError('');
    setBatchPreview(null);
    try {
      setBatchPreview(await api.previewBatchTrainingPlan(file, batchAthleteIds));
    } catch (error) {
      setBatchError(error instanceof Error ? error.message : '计划Excel读取失败。');
    } finally {
      setBatchBusy('');
      event.target.value = '';
    }
  };

  const commitBatchImport = async () => {
    if (!batchPreview) return;
    setBatchBusy('commit');
    setBatchError('');
    try {
      const result = await api.commitBatchTrainingPlan(batchPreview.importId, replaceExisting);
      const targetAthleteId = result.firstAthleteId;
      setBatchOpen(false);
      setMessage(result.message);
      if (targetAthleteId && targetAthleteId !== selectedId) {
        props.onAthleteChange(targetAthleteId);
      } else if (athlete) {
        const response = await api.trainingPlans(athlete.id);
        setPlans(response.plans);
        const latest = response.plans[0];
        setPlanId(latest?.id || null);
        setData(latest?.data || emptyPlan());
      }
      props.onChanged();
    } catch (error) {
      setBatchError(error instanceof Error ? error.message : '批量生成失败。');
    } finally {
      setBatchBusy('');
    }
  };

  return (
    <div className="page-content training-plan-page">
      <header className="page-heading training-plan-heading">
        <div>
          <span className="plan-kicker">STRENGTH PRESCRIPTION</span>
          <h1>训练计划</h1>
          <p>填写实际完成次数后，系统自动计算实际均重与MAX占比</p>
        </div>
        <div className="plan-heading-actions">
          {props.user.role !== 'ATL' && (
            <label className="plan-athlete-select">
              <span>运动员</span>
              <select value={selectedId || ''} onChange={(event) => props.onAthleteChange(Number(event.target.value))}>
                {props.athletes.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.team}</option>)}
              </select>
            </label>
          )}
          {!!plans.length && (
            <label className="plan-history-select">
              <span>历史计划</span>
              <select value={planId || ''} onChange={(event) => selectPlan(Number(event.target.value))}>
                {plans.map((plan) => <option key={plan.id} value={plan.id}>{plan.data.startDate}—{plan.data.endDate} · {plan.data.title}</option>)}
              </select>
            </label>
          )}
          {canEdit && planId && (
            <button className="secondary-button danger-button" disabled={busy === 'delete'} onClick={deletePlan}>
              {busy === 'delete' ? <LoaderCircle className="spin" size={17} /> : <Trash2 size={17} />}删除历史
            </button>
          )}
          {canEdit && (
            <button className="secondary-button batch-plan-button" onClick={openBatchImport}>
              <Users size={17} />多人导入
            </button>
          )}
          {canEdit && (
            <button className="secondary-button" onClick={() => { setPlanId(null); setData(emptyPlan()); setMessage(''); }}>
              <FilePlus2 size={17} />新建
            </button>
          )}
          <button className="secondary-button" disabled={!planId || busy === 'download'} onClick={download}>
            {busy === 'download' ? <LoaderCircle className="spin" size={17} /> : <Download size={17} />}导出模板
          </button>
          {canEdit && (
            <button className="primary-button" disabled={busy === 'save'} onClick={save}>
              {busy === 'save' ? <LoaderCircle className="spin" size={17} /> : <Save size={17} />}保存计划
            </button>
          )}
        </div>
      </header>

      {batchOpen && (
        <div className="batch-plan-overlay" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget && !batchBusy) setBatchOpen(false);
        }}>
          <section className="batch-plan-dialog" role="dialog" aria-modal="true" aria-labelledby="batch-plan-title">
            <header>
              <div className="batch-plan-mark"><FileSpreadsheet size={23} /></div>
              <div>
                <span>TEAM PLAN ASSIGNMENT</span>
                <h2 id="batch-plan-title">Excel批量生成个人计划</h2>
                <p>统一导入处方，生成后每名运动员仍可单独调整。</p>
              </div>
              <button type="button" aria-label="关闭" onClick={() => setBatchOpen(false)} disabled={Boolean(batchBusy)}><X size={19} /></button>
            </header>

            <div className="batch-plan-steps">
              <div className={batchAthleteIds.length ? 'done' : 'active'}><b>1</b><span>选择人员<small>{batchAthleteIds.length}人</small></span></div>
              <i />
              <div className={batchPreview ? 'done' : batchAthleteIds.length ? 'active' : ''}><b>2</b><span>上传校验<small>.xlsx模板</small></span></div>
              <i />
              <div className={batchPreview ? 'active' : ''}><b>3</b><span>生成计划<small>可逐人修改</small></span></div>
            </div>

            <div className="batch-plan-body">
              <aside className="batch-athlete-panel">
                <div className="batch-panel-title">
                  <div><strong>分配对象</strong><small>仅显示你有权管理的运动员</small></div>
                  <button type="button" onClick={() => { setBatchAthleteIds(batchAthleteIds.length === props.athletes.length ? [] : props.athletes.map((item) => item.id)); setBatchPreview(null); }}>
                    {batchAthleteIds.length === props.athletes.length ? '取消全选' : '全选'}
                  </button>
                </div>
                <input className="batch-athlete-search" placeholder="搜索姓名、队伍或项目" value={athleteSearch} onChange={(event) => setAthleteSearch(event.target.value)} />
                <div className="batch-athlete-list">
                  {visibleBatchAthletes.map((item) => {
                    const checked = batchAthleteIds.includes(item.id);
                    return (
                      <button type="button" key={item.id} className={checked ? 'selected' : ''} onClick={() => toggleBatchAthlete(item.id)}>
                        <span className="batch-check">{checked && <CheckCircle2 size={15} />}</span>
                        <span><strong>{item.name}</strong><small>{item.project} · {item.team}</small></span>
                      </button>
                    );
                  })}
                </div>
              </aside>

              <main className="batch-upload-panel">
                {!batchPreview ? (
                  <>
                    <div className="batch-template-strip">
                      <div><strong>先下载标准模板</strong><small>只填动作、组数、次数和强度；同一项目可填写多行。</small></div>
                      <button type="button" onClick={() => api.downloadTrainingPlanBatchTemplate().catch((error) => setBatchError(error instanceof Error ? error.message : '模板下载失败。'))}><Download size={15} />下载模板</button>
                    </div>
                    <label className={`batch-drop-zone ${batchBusy === 'preview' ? 'loading' : ''}`}>
                      {batchBusy === 'preview' ? <LoaderCircle className="spin" size={31} /> : <Upload size={31} />}
                      <strong>{batchBusy === 'preview' ? '正在读取并校验计划' : '选择填写完成的Excel'}</strong>
                      <span>将为已选择的 {batchAthleteIds.length} 名运动员生成独立计划</span>
                      <input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" disabled={batchBusy === 'preview'} onChange={previewBatchFile} />
                    </label>
                  </>
                ) : (
                  <div className="batch-preview-card">
                    <div className="batch-preview-head">
                      <CheckCircle2 size={22} />
                      <div><strong>模板校验通过</strong><small>{batchPreview.fileName}</small></div>
                      <button type="button" onClick={() => { setBatchPreview(null); setReplaceExisting(false); }}>重新上传</button>
                    </div>
                    <div className="batch-preview-metrics">
                      <div><span>周期</span><strong>{batchPreview.data.startDate}<small>至</small>{batchPreview.data.endDate}</strong></div>
                      <div><span>计划内容</span><strong>{batchPreview.exerciseCount} 项<small>·</small>{batchPreview.lineCount} 行处方</strong></div>
                      <div><span>生成对象</span><strong>{batchPreview.athletes.length} 人<small>·</small>{batchPreview.conflictCount} 份冲突</strong></div>
                    </div>
                    <div className="batch-preview-roster">
                      {batchPreview.athletes.map((item) => (
                        <span key={item.id} className={item.hasConflict ? 'conflict' : ''}>
                          <b>{item.name}</b><small>{item.reusedMaxCount}项MAX沿用{item.hasConflict ? ' · 已有同期计划' : ''}</small>
                        </span>
                      ))}
                    </div>
                    {batchPreview.conflictCount > 0 && (
                      <label className="batch-replace-option">
                        <input type="checkbox" checked={replaceExisting} onChange={(event) => setReplaceExisting(event.target.checked)} />
                        <span><strong>覆盖同期已有计划</strong><small>不勾选时，已有相同开始日期的运动员会被跳过。</small></span>
                      </label>
                    )}
                  </div>
                )}
                {batchError && <div className="batch-plan-error">{batchError}</div>}
              </main>
            </div>

            <footer>
              <p>导入后进入任一运动员个人页，即可单独修改MAX、组数、次数、强度及实际完成次数。</p>
              <button type="button" className="secondary-button" onClick={() => setBatchOpen(false)} disabled={Boolean(batchBusy)}>取消</button>
              <button type="button" className="primary-button" disabled={!batchPreview || batchBusy === 'commit'} onClick={commitBatchImport}>
                {batchBusy === 'commit' ? <LoaderCircle className="spin" size={17} /> : <Users size={17} />}
                生成{batchPreview ? batchPreview.athletes.length : batchAthleteIds.length}份个人计划
              </button>
            </footer>
          </section>
        </div>
      )}

      {!athlete ? (
        <section className="plan-empty"><Dumbbell size={34} /><strong>暂无可查看的运动员</strong></section>
      ) : loading ? (
        <section className="plan-empty"><LoaderCircle className="spin" size={30} /><strong>正在读取训练计划</strong></section>
      ) : (
        <>
          <section className="plan-overview-grid">
            <div className="plan-overview-left">
              <div className="plan-photo-panel">
                <div className="plan-photo-frame">
                  {photoUrl ? <img src={photoUrl} alt={`${athlete.name}证件照`} /> : <span>{athlete.name.slice(0, 1)}</span>}
                </div>
                <div>
                  <strong>{athlete.name}</strong>
                  <small>{athlete.project} · {athlete.team}</small>
                  {canUploadPhoto && (
                    <label className="photo-upload-button">
                      {busy === 'photo' ? <LoaderCircle className="spin" size={15} /> : <Camera size={15} />}
                      {photoUrl ? '更换证件照' : '上传证件照'}
                      <input type="file" accept=".jpg,.jpeg,.png,image/jpeg,image/png" onChange={uploadPhoto} />
                    </label>
                  )}
                </div>
              </div>

              <div className="plan-meta-form">
                <label><span>开始日期</span><input type="date" disabled={!canEdit} value={data.startDate} onChange={(event) => {
                  const startDate = event.target.value;
                  setData((current) => ({ ...current, startDate, endDate: startDate ? addDays(startDate, 30) : '' }));
                }} /></label>
                <label><span>结束日期</span><input type="date" disabled={!canEdit} min={data.startDate} value={data.endDate} onChange={(event) => updateField('endDate', event.target.value)} /></label>
                <label className="plan-meta-title"><span>计划名称</span><input disabled={!canEdit} value={data.title} onChange={(event) => updateField('title', event.target.value)} /></label>
                <label className="plan-meta-schedule"><span>训练日安排</span><input disabled={!canEdit} value={data.scheduleLabel} onChange={(event) => updateField('scheduleLabel', event.target.value)} /></label>
                <label><span>体重 kg</span><input type="number" step="0.1" disabled={!canEdit} value={data.bodyWeight ?? ''} onChange={(event) => updateField('bodyWeight', numericValue(event.target.value))} /></label>
                <label><span>年龄</span><input type="number" disabled={!canEdit} value={data.age ?? ''} onChange={(event) => updateField('age', numericValue(event.target.value))} /></label>
              </div>
            </div>
            <TrainingVolumeRadar exercises={data.exercises} />
          </section>

          {message && <div className={message.includes('已') ? 'plan-message success' : 'plan-message'}>{message}</div>}

          <section className="plan-matrix-shell">
            <>
              <div className="plan-matrix-title">
                <div><Dumbbell size={18} /><strong>{data.scheduleLabel || '训练安排'}</strong></div>
                <span>重量由MAX和百分比计算；填写完成次数后雷达图自动更新</span>
              </div>
              <div className="plan-matrix-scroll">
                <table className="plan-matrix">
                  <thead>
                    <tr>
                      <th rowSpan={2} className="max-head">MAX</th>
                      <th rowSpan={2} className="exercise-head">项目</th>
                      {weekKeys.map((weekKey, index) => <th key={weekKey} colSpan={6} className={`week-band week-${index + 1}`}>WEEK {weekKey}</th>)}
                      {canEdit && <th rowSpan={2} className="tools-head">操作</th>}
                    </tr>
                    <tr>
                      {weekKeys.flatMap((weekKey, weekIndex) => ['组', '×', '次', '%', '重量', '完成次数'].map((label, index) => (
                        <th key={`${weekKey}-${label}`} className={`week-sub week-${weekIndex + 1} ${index === 5 ? 'actual-head' : ''}`}>{label}</th>
                      )))}
                    </tr>
                  </thead>
                  <tbody>
                    {data.exercises.map((exercise) => exercise.lines.map((line, lineIndex) => (
                      <tr key={line.id}>
                        {lineIndex === 0 && (
                          <>
                            <td rowSpan={exercise.lines.length} className="max-cell">
                              <input aria-label={`${exercise.name || '项目'} MAX重量`} type="number" step="0.1" disabled={!canEdit} value={exercise.maxWeight ?? ''} onChange={(event) => updateExercise(exercise.id, { maxWeight: numericValue(event.target.value) })} />
                              <small>kg</small>
                            </td>
                            <td rowSpan={exercise.lines.length} className="exercise-cell">
                              <textarea aria-label="项目名称" disabled={!canEdit} value={exercise.name} onChange={(event) => updateExercise(exercise.id, { name: event.target.value })} />
                              {canEdit && (
                                <div className="exercise-tools">
                                  <button type="button" onClick={() => addLine(exercise.id)}><Plus size={13} />加行</button>
                                  <button type="button" onClick={() => removeExercise(exercise.id)}><Trash2 size={13} />删除</button>
                                </div>
                              )}
                            </td>
                          </>
                        )}
                        {weekKeys.flatMap((weekKey, weekIndex) => {
                          const week = line.weeks[weekKey];
                          return [
                            <td key={`${weekKey}-sets`} className={`week-body week-${weekIndex + 1}`}><input aria-label={`第${weekKey}周组数`} disabled={!canEdit} value={week.sets} onChange={(event) => updateWeek(exercise.id, line.id, weekKey, { sets: event.target.value })} /></td>,
                            <td key={`${weekKey}-times`} className={`week-body week-${weekIndex + 1} times-cell`}>×</td>,
                            <td key={`${weekKey}-reps`} className={`week-body week-${weekIndex + 1}`}><input aria-label={`第${weekKey}周次数`} disabled={!canEdit} value={week.reps} onChange={(event) => updateWeek(exercise.id, line.id, weekKey, { reps: event.target.value })} /></td>,
                            <td key={`${weekKey}-percent`} className={`week-body week-${weekIndex + 1} percent-cell`}><input aria-label={`第${weekKey}周百分比`} type="number" min="0" max="100" step="0.1" disabled={!canEdit} value={week.percentage ?? ''} onChange={(event) => updateWeek(exercise.id, line.id, weekKey, { percentage: numericValue(event.target.value) })} /><span>%</span></td>,
                            <td key={`${weekKey}-weight`} className={`week-body week-${weekIndex + 1} weight-cell`}>{plannedWeight(exercise.maxWeight, week.percentage)}</td>,
                            <td key={`${weekKey}-actual`} className={`week-body week-${weekIndex + 1} actual-cell`}><input aria-label={`第${weekKey}周实际完成次数`} inputMode="decimal" disabled={!canEdit} placeholder="填写次数" value={week.actualCompleted} onChange={(event) => updateWeek(exercise.id, line.id, weekKey, { actualCompleted: event.target.value })} /></td>
                          ];
                        })}
                        {canEdit && <td className="line-tools"><button type="button" aria-label="删除处方行" onClick={() => removeLine(exercise.id, line.id)}><Trash2 size={14} /></button></td>}
                      </tr>
                    )))}
                  </tbody>
                </table>
              </div>
              {canEdit && data.exercises.length < 8 && (
                <button className="plan-add-exercise" type="button" onClick={() => setData((current) => ({ ...current, exercises: [...current.exercises, emptyExercise()] }))}>
                  <Plus size={16} />添加训练项目（最多8项）
                </button>
              )}
            </>
          </section>
          {canEdit && athlete && (
            <section className="ai-mode-container">
              <AITrainingPlanGenerator
                user={props.user}
                athlete={athlete}
                onSaved={() => {
                  refresh();
                  props.onChanged();
                }}
              />
            </section>
          )}
        </>
      )}
    </div>
  );
}
