import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowRight,
  Check,
  CheckCircle2,
  FileSearch,
  FileText,
  LoaderCircle,
  Plus,
  RotateCcw,
  Save,
  Search,
  Trash2,
  Upload,
  Users
} from 'lucide-react';
import { api } from '../api';
import type {
  AIImportedTrainingPlan,
  AITrainingPlanImportMetadata,
  Athlete,
  FlexibleTrainingItem
} from '../types';

type Props = {
  athlete: Athlete;
  athletes: Athlete[];
  onSaved: (planId?: number) => void | Promise<void>;
};

const ACCEPTED_FILES = '.xlsx,.pdf,.docx,.txt,.md,.csv,.jpg,.jpeg,.png,.webp';

function emptyItem(): FlexibleTrainingItem {
  return {
    id: crypto.randomUUID(),
    name: '',
    category: null,
    sets: null,
    reps: null,
    load: null,
    percentage: null,
    duration: null,
    distance: null,
    intensity: null,
    pace: null,
    notes: null,
    rawText: '',
    confidence: 1
  };
}

export function AITrainingPlanImporter({ athlete, athletes, onSaved }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [plan, setPlan] = useState<AIImportedTrainingPlan | null>(null);
  const [metadata, setMetadata] = useState<AITrainingPlanImportMetadata | null>(null);
  const [busy, setBusy] = useState<'recognize' | 'save' | ''>('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [targetIds, setTargetIds] = useState<number[]>([athlete.id]);
  const [rosterQuery, setRosterQuery] = useState('');
  const [replaceExisting, setReplaceExisting] = useState(false);

  useEffect(() => {
    setTargetIds([athlete.id]);
    setSuccess('');
  }, [athlete.id]);

  const visibleAthletes = useMemo(() => {
    const query = rosterQuery.trim().toLowerCase();
    if (!query) return athletes;
    return athletes.filter((item) => `${item.name} ${item.team} ${item.project} ${item.region}`.toLowerCase().includes(query));
  }, [athletes, rosterQuery]);

  const targetNames = useMemo(() => athletes.filter((item) => targetIds.includes(item.id)).map((item) => item.name), [athletes, targetIds]);

  const pickFile = (selected: File | undefined) => {
    if (!selected) return;
    if (selected.size > 10 * 1024 * 1024) {
      setError('文件不能超过 10MB');
      return;
    }
    setFile(selected);
    setPlan(null);
    setMetadata(null);
    setError('');
    setSuccess('');
  };

  const recognize = async () => {
    if (!targetIds.length) {
      setError('请至少选择一名导入对象');
      return;
    }
    if (!file) {
      setError('请先选择训练计划文件');
      return;
    }
    setBusy('recognize');
    setError('');
    try {
      const result = await api.previewAITrainingPlanImport(file, targetIds[0]);
      setPlan(result.plan);
      setMetadata(result.aiMetadata);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'AI 识别失败，请重试');
    } finally {
      setBusy('');
    }
  };

  const reset = () => {
    setFile(null);
    setPlan(null);
    setMetadata(null);
    setError('');
    setSuccess('');
    setReplaceExisting(false);
    if (inputRef.current) inputRef.current.value = '';
  };

  const updatePlan = <Key extends keyof AIImportedTrainingPlan>(
    key: Key,
    value: AIImportedTrainingPlan[Key]
  ) => setPlan((current) => current ? { ...current, [key]: value } : current);

  const updateItem = (
    weekIndex: number,
    dayIndex: number,
    itemIndex: number,
    patch: Partial<FlexibleTrainingItem>
  ) => {
    setPlan((current) => {
      if (!current) return current;
      const weeklyPlans = current.weeklyPlans.map((week, currentWeekIndex) => {
        if (currentWeekIndex !== weekIndex) return week;
        return {
          ...week,
          days: week.days.map((day, currentDayIndex) => {
            if (currentDayIndex !== dayIndex) return day;
            return {
              ...day,
              items: day.items.map((item, currentItemIndex) => (
                currentItemIndex === itemIndex ? { ...item, ...patch } : item
              ))
            };
          })
        };
      });
      return { ...current, weeklyPlans };
    });
  };

  const updateWeek = (weekIndex: number, patch: Partial<AIImportedTrainingPlan['weeklyPlans'][number]>) => {
    setPlan((current) => current ? {
      ...current,
      weeklyPlans: current.weeklyPlans.map((week, currentIndex) => currentIndex === weekIndex ? { ...week, ...patch } : week)
    } : current);
  };

  const updateDay = (
    weekIndex: number,
    dayIndex: number,
    patch: Partial<AIImportedTrainingPlan['weeklyPlans'][number]['days'][number]>
  ) => {
    setPlan((current) => current ? {
      ...current,
      weeklyPlans: current.weeklyPlans.map((week, currentWeekIndex) => currentWeekIndex !== weekIndex ? week : ({
        ...week,
        days: week.days.map((day, currentDayIndex) => currentDayIndex === dayIndex ? { ...day, ...patch } : day)
      }))
    } : current);
  };

  const removeItem = (weekIndex: number, dayIndex: number, itemIndex: number) => {
    setPlan((current) => {
      if (!current) return current;
      return {
        ...current,
        weeklyPlans: current.weeklyPlans.map((week, currentWeekIndex) => currentWeekIndex !== weekIndex ? week : ({
          ...week,
          days: week.days.map((day, currentDayIndex) => currentDayIndex !== dayIndex ? day : ({
            ...day,
            items: day.items.filter((_item, currentItemIndex) => currentItemIndex !== itemIndex)
          }))
        }))
      };
    });
  };

  const addItem = (weekIndex: number, dayIndex: number) => {
    setPlan((current) => {
      if (!current) return current;
      return {
        ...current,
        weeklyPlans: current.weeklyPlans.map((week, currentWeekIndex) => currentWeekIndex !== weekIndex ? week : ({
          ...week,
          days: week.days.map((day, currentDayIndex) => currentDayIndex !== dayIndex ? day : ({
            ...day,
            items: [...day.items, emptyItem()]
          }))
        }))
      };
    });
  };

  const save = async () => {
    if (!plan || !metadata) return;
    if (!targetIds.length) {
      setError('请至少选择一名导入对象');
      return;
    }
    if (!plan.title.trim()) {
      setError('请确认计划名称');
      return;
    }
    if (!plan.startDate || !plan.endDate) {
      setError('AI 不会猜测缺失日期，请人工确认开始和结束日期');
      return;
    }
    const itemCount = plan.weeklyPlans.reduce(
      (total, week) => total + week.days.reduce((dayTotal, day) => dayTotal + day.items.filter((item) => item.name.trim()).length, 0),
      0
    );
    if (!itemCount) {
      setError('至少保留一条有名称的训练内容');
      return;
    }

    setBusy('save');
    setError('');
    setSuccess('');
    try {
      const result = await api.saveAITrainingPlan({
        athleteIds: targetIds,
        plan,
        aiMetadata: metadata,
        replaceExisting
      });
      setSuccess(result.message);
      const currentAthleteResult = result.results.find((item) => item.athleteId === athlete.id);
      await onSaved(currentAthleteResult?.planId);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : '导入失败，请重试');
    } finally {
      setBusy('');
    }
  };

  const confidence = plan ? Math.round(plan.confidence * 100) : 0;

  const toggleTarget = (athleteId: number) => {
    setSuccess('');
    setError('');
    setTargetIds((current) => current.includes(athleteId)
      ? current.filter((id) => id !== athleteId)
      : current.length >= 100 ? current : [...current, athleteId]
    );
  };

  return (
    <div className="ai-importer">
      <header className="importer-header">
        <div className="ai-badge"><FileSearch size={23} /><span>AI 识别导入</span></div>
        <h2>{targetIds.length > 1 ? `把已有计划分配给 ${targetIds.length} 名运动员` : `把已有计划录入给 ${targetNames[0] || athlete.name}`}</h2>
        <p>训练日按文件实际内容识别并可修改；同一份确认后的计划可以一次导入多人。</p>
      </header>

      <div className="import-source-chain" aria-label="导入流程">
        <div className={file ? 'done' : 'active'}><FileText size={18} /><span>原文件<small>{file?.name || '选择文件'}</small></span></div>
        <ArrowRight size={17} />
        <div className={busy === 'recognize' ? 'active' : plan ? 'done' : ''}><FileSearch size={18} /><span>AI识别<small>{busy === 'recognize' ? '读取中' : '忠实提取'}</small></span></div>
        <ArrowRight size={17} />
        <div className={plan ? 'active' : ''}><Check size={18} /><span>人工确认<small>可修改</small></span></div>
        <ArrowRight size={17} />
        <div><Save size={18} /><span>正式导入<small>写入 {targetIds.length || 0} 份计划</small></span></div>
      </div>

      <section className="import-roster-panel">
        <header>
          <div><Users size={19} /><span><strong>导入对象</strong><small>已选择 {targetIds.length} 人，最多100人</small></span></div>
          <div className="import-roster-actions">
            <button type="button" onClick={() => { setTargetIds(athletes.slice(0, 100).map((item) => item.id)); setSuccess(''); setError(''); }}>全选</button>
            <button type="button" onClick={() => { setTargetIds([]); setSuccess(''); }}>清空</button>
          </div>
        </header>
        <label className="import-roster-search"><Search size={15} /><input value={rosterQuery} onChange={(event) => setRosterQuery(event.target.value)} placeholder="搜索姓名、项目或队伍" /></label>
        <div className="import-roster-list">
          {visibleAthletes.map((item) => {
            const selected = targetIds.includes(item.id);
            return (
              <button type="button" key={item.id} className={selected ? 'selected' : ''} onClick={() => toggleTarget(item.id)} aria-pressed={selected}>
                <span className="roster-check">{selected && <Check size={13} />}</span>
                <span><strong>{item.name}</strong><small>{item.project} · {item.team}</small></span>
              </button>
            );
          })}
          {!visibleAthletes.length && <p>没有匹配的运动员</p>}
        </div>
        <footer><strong>{targetIds.length ? targetNames.slice(0, 6).join('、') : '尚未选择运动员'}</strong>{targetNames.length > 6 && <span>等 {targetNames.length} 人</span>}</footer>
      </section>

      {!plan && (
        <section className="import-file-panel">
          <input
            ref={inputRef}
            type="file"
            accept={ACCEPTED_FILES}
            hidden
            onChange={(event) => pickFile(event.target.files?.[0])}
          />
          <button
            type="button"
            className={`import-drop-zone ${file ? 'has-file' : ''}`}
            onClick={() => inputRef.current?.click()}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => { event.preventDefault(); pickFile(event.dataTransfer.files?.[0]); }}
          >
            {file ? <CheckCircle2 size={36} /> : <Upload size={36} />}
            <strong>{file ? file.name : '点击选择或拖入训练计划'}</strong>
            <span>{file ? `${(file.size / 1024).toFixed(1)} KB · 点击可更换` : 'Excel、DOCX、文本型PDF、图片、TXT/CSV · 最大10MB'}</span>
          </button>
          <div className="import-truth-note">
            <AlertCircle size={17} />
            <span>扫描版 PDF 请导出为清晰图片后上传；旧版 .xls/.doc 请先另存为 .xlsx/.docx。</span>
          </div>
          <div className="import-actions">
            <button type="button" className="btn-secondary" onClick={reset}><RotateCcw size={16} />重置</button>
            <button type="button" className="btn-primary" disabled={!file || busy === 'recognize'} onClick={recognize}>
              {busy === 'recognize' ? <><LoaderCircle className="spin" size={17} />正在识别文件</> : <><FileSearch size={17} />开始 AI 识别</>}
            </button>
          </div>
        </section>
      )}

      {plan && metadata && (
        <section className="import-preview">
          <div className="import-preview-heading">
            <div><span>识别完成</span><h3>校正后再导入</h3><p>{metadata.sourceFile.filename} · {metadata.modelUsed}</p></div>
            <div className={`confidence-chip ${confidence < 70 ? 'low' : ''}`}><small>整体置信度</small><strong>{confidence}%</strong></div>
          </div>

          {(plan.warnings.length > 0 || plan.unmappedContent.length > 0) && (
            <div className="import-warnings">
              <AlertCircle size={18} />
              <div>
                <strong>需要人工留意</strong>
                {[...plan.warnings, ...plan.unmappedContent].map((warning, index) => <p key={`${warning}-${index}`}>{warning}</p>)}
              </div>
            </div>
          )}

          <div className="import-meta-grid">
            <label className="wide"><span>计划名称 *</span><input value={plan.title} onChange={(event) => updatePlan('title', event.target.value)} placeholder="请确认计划名称" /></label>
            <label><span>开始日期 *</span><input type="date" value={plan.startDate} onChange={(event) => updatePlan('startDate', event.target.value)} /></label>
            <label><span>结束日期 *</span><input type="date" value={plan.endDate} onChange={(event) => updatePlan('endDate', event.target.value)} /></label>
            <label className="wide"><span>训练日 / 安排（可修改）</span><input value={plan.scheduleLabel} onChange={(event) => updatePlan('scheduleLabel', event.target.value)} placeholder="例如：周一、周三、周六；原文件未写可留空" /></label>
            <label className="full"><span>客观摘要</span><textarea rows={2} value={plan.summary} onChange={(event) => updatePlan('summary', event.target.value)} /></label>
          </div>

          <div className="import-dynamic-plan">
            {plan.weeklyPlans.map((week, weekIndex) => (
              <article className="import-week" key={week.id}>
                <header>
                  <label><span>阶段/周次</span><input value={week.label || (week.weekNumber ? `第 ${week.weekNumber} 周` : '')} onChange={(event) => updateWeek(weekIndex, { label: event.target.value, weekNumber: null })} placeholder={`计划阶段 ${weekIndex + 1}`} /></label>
                  <label><span>阶段重点</span><input value={week.focus} onChange={(event) => updateWeek(weekIndex, { focus: event.target.value })} placeholder="原文件未标注" /></label>
                </header>
                {week.days.map((day, dayIndex) => (
                  <div className="import-day" key={day.id}>
                    <div className="import-day-title"><div><input aria-label={`训练单元${dayIndex + 1}名称`} value={day.dayLabel} onChange={(event) => updateDay(weekIndex, dayIndex, { dayLabel: event.target.value })} placeholder={day.date || `训练单元 ${dayIndex + 1}`} /><input aria-label={`训练单元${dayIndex + 1}重点`} value={day.focus} onChange={(event) => updateDay(weekIndex, dayIndex, { focus: event.target.value })} placeholder="训练重点（可留空）" /></div><button type="button" onClick={() => addItem(weekIndex, dayIndex)}><Plus size={14} />添加条目</button></div>
                    <div className="import-items">
                      {day.items.map((item, itemIndex) => (
                        <div className="import-item" key={item.id}>
                          <div className="import-item-top">
                            <label className="item-name"><span>训练项目</span><input value={item.name} onChange={(event) => updateItem(weekIndex, dayIndex, itemIndex, { name: event.target.value })} /></label>
                            <span className={`item-confidence ${item.confidence < 0.7 ? 'low' : ''}`}>{Math.round(item.confidence * 100)}%</span>
                            <button type="button" aria-label="删除该条" onClick={() => removeItem(weekIndex, dayIndex, itemIndex)}><Trash2 size={15} /></button>
                          </div>
                          <div className="import-item-fields">
                            <label><span>组数</span><input value={item.sets || ''} onChange={(event) => updateItem(weekIndex, dayIndex, itemIndex, { sets: event.target.value || null })} /></label>
                            <label><span>次数</span><input value={item.reps || ''} onChange={(event) => updateItem(weekIndex, dayIndex, itemIndex, { reps: event.target.value || null })} /></label>
                            <label><span>重量/负荷</span><input value={item.load || ''} onChange={(event) => updateItem(weekIndex, dayIndex, itemIndex, { load: event.target.value || null })} /></label>
                            <label><span>强度%</span><input type="number" min="0" max="100" value={item.percentage ?? ''} onChange={(event) => updateItem(weekIndex, dayIndex, itemIndex, { percentage: event.target.value ? Number(event.target.value) : null })} /></label>
                            <label><span>时长</span><input value={item.duration || ''} onChange={(event) => updateItem(weekIndex, dayIndex, itemIndex, { duration: event.target.value || null })} /></label>
                            <label><span>距离</span><input value={item.distance || ''} onChange={(event) => updateItem(weekIndex, dayIndex, itemIndex, { distance: event.target.value || null })} /></label>
                            <label><span>配速/节奏</span><input value={item.pace || ''} onChange={(event) => updateItem(weekIndex, dayIndex, itemIndex, { pace: event.target.value || null })} /></label>
                            <label><span>备注</span><input value={item.notes || ''} onChange={(event) => updateItem(weekIndex, dayIndex, itemIndex, { notes: event.target.value || null })} /></label>
                            <label><span>训练分类</span><input value={item.category || ''} onChange={(event) => updateItem(weekIndex, dayIndex, itemIndex, { category: event.target.value || null })} /></label>
                            <label><span>强度区间</span><input value={item.intensity || ''} onChange={(event) => updateItem(weekIndex, dayIndex, itemIndex, { intensity: event.target.value || null })} /></label>
                          </div>
                          {item.rawText && <p className="import-raw-text">原文：{item.rawText}</p>}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </article>
            ))}
          </div>

          <label className="import-replace-option">
            <input type="checkbox" checked={replaceExisting} onChange={(event) => { setReplaceExisting(event.target.checked); setSuccess(''); }} />
            <span><strong>覆盖同一开始日期的已有计划</strong><small>默认不覆盖；存在冲突的运动员会被跳过，并在导入结果中说明。</small></span>
          </label>

          <div className="import-actions sticky">
            <button type="button" className="btn-secondary" disabled={Boolean(busy)} onClick={reset}><RotateCcw size={16} />换一个文件</button>
            <button type="button" className="btn-primary" disabled={busy === 'save'} onClick={save}>
              {busy === 'save' ? <><LoaderCircle className="spin" size={17} />正在导入 {targetIds.length} 份</> : <><Save size={17} />确认并导入 {targetIds.length} 份计划</>}
            </button>
          </div>
        </section>
      )}

      {error && <div className="error-alert importer-error"><AlertCircle size={18} /><span>{error}</span></div>}
      {success && <div className="import-success"><CheckCircle2 size={18} /><span>{success}</span></div>}
    </div>
  );
}
