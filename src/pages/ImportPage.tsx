import {
  AlertTriangle,
  BookOpenCheck,
  BrainCircuit,
  Check,
  CheckCircle2,
  ChevronRight,
  FileCheck2,
  FileSpreadsheet,
  FileText,
  Layers3,
  LoaderCircle,
  RotateCcw,
  ScanLine,
  ShieldCheck,
  Sparkles,
  TableProperties,
  UploadCloud,
  Users,
  XCircle
} from 'lucide-react';
import { useRef, useState } from 'react';
import { api } from '../api';
import type {
  ImportInspection,
  ImportJobStatus,
  ImportPreview,
  ImportRow,
  Project
} from '../types';

const acceptedFiles = '.xlsx,.docx,.pdf,.txt,.md,.csv,.jpg,.jpeg,.png,.webp';

function validateEditableRow(row: ImportRow, athleteNames?: Set<string>): ImportRow {
  const errors: string[] = [];
  if (!row.athleteName.trim()) errors.push('缺少运动员姓名');
  else if (athleteNames && !athleteNames.has(row.athleteName)) errors.push('运动员不在当前可导入名单中');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(row.date)) errors.push('日期格式无效，应为YYYY-MM-DD');
  if ((!Number.isFinite(row.durationMin) || row.durationMin <= 0) && !row.trainingType.includes('休息')) errors.push('缺少训练时长');
  if (row.durationMin < 0) errors.push('训练时长不能为负数');
  if (row.distanceKm < 0) errors.push('训练距离不能为负数');
  if (row.rpe !== null && (row.rpe < 0 || row.rpe > 10)) errors.push('RPE应在0—10之间');
  return { ...row, errors };
}

function refreshPreviewStats(preview: ImportPreview, rows: ImportRow[]): ImportPreview {
  return {
    ...preview,
    rows,
    total: rows.length,
    valid: rows.filter((row) => row.errors.length === 0).length,
    invalid: rows.filter((row) => row.errors.length > 0).length,
    warningCount: rows.reduce((sum, row) => sum + row.warnings.length, 0)
  };
}

const documentTypeOptions = [
  { value: 'auto', title: 'AI自动判断', note: '推荐：先区分体能训练与完成记录' },
  { value: 'training_plan', title: '体能训练', note: '保存到体能训练矩阵，可分配多人' },
  { value: 'training_record', title: '完成记录', note: '保存到训练日历与个人档案' }
] as const;

type PlanSaveReceipt = {
  title: string;
  startDate: string;
  endDate: string;
  created: number;
  replaced: number;
  skipped: number;
  results: Array<{
    athleteId: number;
    athleteName: string;
    status: 'created' | 'replaced' | 'skipped';
    planId: number;
  }>;
};

type ImportPageProps = {
  onImported: () => void;
  onOpenTrainingPlan: (athleteId: number, planId: number) => void;
  onOpenRecords: () => void;
  project: Project;
};

export function ImportPage({ onImported, onOpenTrainingPlan, onOpenRecords, project }: ImportPageProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [inspection, setInspection] = useState<ImportInspection | null>(null);
  const [selectedSections, setSelectedSections] = useState<string[]>([]);
  const [targetType, setTargetType] = useState<'auto' | 'training_plan' | 'training_record'>('auto');
  const [jobProgress, setJobProgress] = useState<ImportJobStatus | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [planTargetIds, setPlanTargetIds] = useState<number[]>([]);
  const [replaceExisting, setReplaceExisting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [planSaveReceipt, setPlanSaveReceipt] = useState<PlanSaveReceipt | null>(null);
  const activeStep = success ? 4 : preview ? 3 : inspection || busy ? 2 : 1;

  const chooseFile = async (file?: File) => {
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      setError('单个文件不能超过10MB，请压缩或拆分后重试。');
      return;
    }
    setSelectedFile(file);
    setBusy(true);
    setError('');
    setSuccess('');
    setPreview(null);
    setInspection(null);
    setJobProgress(null);
    setPlanTargetIds([]);
    setPlanSaveReceipt(null);
    try {
      const result = await api.inspectImport(file, project);
      setInspection(result);
      setSelectedSections(result.sections.map((section) => section.name));
    } catch (requestError) {
      setSelectedFile(null);
      setError(requestError instanceof Error ? requestError.message : '文件读取失败。');
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const startRecognition = async () => {
    if (!inspection || !selectedSections.length) {
      setError('请至少选择一个工作表或内容分区。');
      return;
    }
    setBusy(true);
    setError('');
    setJobProgress({
      status: 'queued',
      phase: '正在创建完整识别任务',
      completedChunks: 0,
      totalChunks: inspection.sections
        .filter((section) => selectedSections.includes(section.name))
        .reduce((sum, section) => sum + section.chunkCount, 0),
      currentLabel: ''
    });
    try {
      const result = await api.recognizeInspectedImport(
        inspection.fileId,
        selectedSections,
        targetType,
        setJobProgress
      );
      setPreview(result);
      setPlanTargetIds([]);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'AI识别失败。');
    } finally {
      setBusy(false);
    }
  };

  const updateRow = (index: number, patch: Partial<ImportRow>) => {
    setPreview((current) => {
      if (!current) return current;
      const athleteNames = new Set(current.athletes?.map((athlete) => athlete.name) || []);
      const rows = current.rows.map((row, rowIndex) => rowIndex === index ? validateEditableRow({ ...row, ...patch }, athleteNames) : row);
      return refreshPreviewStats(current, rows);
    });
  };

  const chooseAthlete = (index: number, name: string) => {
    const athlete = preview?.athletes?.find((item) => item.name === name);
    updateRow(index, { athleteName: name, athleteId: athlete?.id || null, team: athlete?.team || '' });
  };

  const reset = () => {
    setPreview(null);
    setInspection(null);
    setSelectedSections([]);
    setSelectedFile(null);
    setJobProgress(null);
    setPlanTargetIds([]);
    setReplaceExisting(false);
    setTargetType('auto');
    setSuccess('');
    setError('');
    setPlanSaveReceipt(null);
  };

  const commitRecords = async () => {
    if (!preview?.importId) return;
    setBusy(true);
    setError('');
    try {
      const result = await api.commitImport(preview.importId, preview.rows);
      setPlanSaveReceipt(null);
      setSuccess(`已写入${result.imported}条训练完成记录${result.skipped ? `，跳过${result.skipped}条仍有错误的记录` : ''}。`);
      setPreview(null);
      setInspection(null);
      setSelectedFile(null);
      onImported();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : '导入失败。');
    } finally {
      setBusy(false);
    }
  };

  const commitPlan = async () => {
    if (!preview?.plan || !preview.aiMetadata) return;
    if (!planTargetIds.length) {
      setError('请至少选择一名训练对象；系统不会根据组别自动猜人。');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const result = await api.saveAITrainingPlan({
        athleteIds: planTargetIds,
        plan: preview.plan,
        aiMetadata: preview.aiMetadata,
        replaceExisting
      });
      setPlanSaveReceipt({
        title: preview.plan.title,
        startDate: preview.plan.startDate,
        endDate: preview.plan.endDate,
        created: result.created,
        replaced: result.replaced,
        skipped: result.skipped,
        results: result.results
      });
      setSuccess(`体能训练已保存：新建${result.created}人，替换${result.replaced}人${result.skipped ? `，跳过已有训练${result.skipped}人` : ''}。`);
      setPreview(null);
      setInspection(null);
      setSelectedFile(null);
      onImported();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : '体能训练保存失败。');
    } finally {
      setBusy(false);
    }
  };

  const updatePlan = (patch: Partial<NonNullable<ImportPreview['plan']>>) => {
    setPreview((current) => current?.plan ? { ...current, plan: { ...current.plan, ...patch } } : current);
  };

  const togglePlanAthlete = (athleteId: number) => {
    setPlanTargetIds((current) => current.includes(athleteId)
      ? current.filter((id) => id !== athleteId)
      : [...current, athleteId]);
  };

  const toggleSection = (sectionName: string) => {
    setSelectedSections((current) => current.includes(sectionName)
      ? current.filter((name) => name !== sectionName)
      : [...current, sectionName]);
  };

  const selectedChunkCount = inspection?.sections
    .filter((section) => selectedSections.includes(section.name))
    .reduce((sum, section) => sum + section.chunkCount, 0) || 0;
  const progressPercent = jobProgress?.totalChunks
    ? Math.round((jobProgress.completedChunks / jobProgress.totalChunks) * 100)
    : 0;
  const planWeeks = preview?.plan?.weeklyPlans || [];
  const planItemCount = planWeeks.reduce(
    (weekTotal, week) => weekTotal + week.days.reduce((dayTotal, day) => dayTotal + day.items.length, 0),
    0
  );
  const planEmptyDays = planWeeks.flatMap((week) => week.days
    .filter((day) => day.items.length === 0)
    .map((day) => day.date || day.dayLabel || `${week.label}未标日期`));
  const planReady = Boolean(
    preview?.plan?.title.trim()
    && /^\d{4}-\d{2}-\d{2}$/.test(preview.plan.startDate)
    && /^\d{4}-\d{2}-\d{2}$/.test(preview.plan.endDate)
    && planTargetIds.length
  );

  return (
    <div className="page-content import-page ai-data-import-page">
      <header className="ai-data-hero">
        <div>
          <span className="ai-data-eyebrow"><Sparkles size={15} /> AI 数据入口</span>
          <h1>导入训练文件</h1>
          <p>先读取文件结构，再选择工作表和保存位置。AI 识别结果经过人工确认后才会写入系统。</p>
          <div className="ai-data-hero-promises">
            <span><ShieldCheck size={13} />确认前不入库</span>
            <span><Layers3 size={13} />整本工作簿分批读取</span>
            <span><Users size={13} />体能训练可分配多人</span>
          </div>
        </div>
        <aside>
          <BrainCircuit size={31} />
          <span>当前识别引擎</span>
          <strong>千问 API</strong>
          <small>{project}项目 · 分批识别 · 文件≤10MB</small>
        </aside>
      </header>

      <section className="ai-data-track" aria-label="AI数据导入进度">
        {[
          ['选择原文件', 'Excel / 文档 / 图片'],
          ['分批AI识别', '工作表逐批处理'],
          ['人工校正', '确认类型、人员与日期'],
          ['分类写入', '体能训练或完成记录']
        ].map(([title, note], index) => {
          const step = index + 1;
          return (
            <div className={step < activeStep ? 'done' : step === activeStep ? 'active' : ''} key={title}>
              <b>{step < activeStep ? <CheckCircle2 size={16} /> : step}</b>
              <span><strong>{title}</strong><small>{note}</small></span>
            </div>
          );
        })}
      </section>

      {!inspection && !preview && !success && (
        <section
          className={`ai-data-drop ${dragging ? 'dragging' : ''} ${busy ? 'recognizing' : ''}`}
          onDragEnter={(event) => { event.preventDefault(); if (!busy) setDragging(true); }}
          onDragOver={(event) => event.preventDefault()}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            if (!busy) chooseFile(event.dataTransfer.files[0]);
          }}
        >
          <div className="ai-data-drop-core">
            <div className="ai-data-scan-stage">
              <FileText size={42} />
              <span className="scan-line"><ScanLine size={20} /></span>
              <i>AI</i>
            </div>
            <span className="ai-data-drop-kicker">FILE INTAKE</span>
            <h2>{busy ? '正在读取文件结构' : '拖入文件，或从电脑选择'}</h2>
            <p>{busy
              ? `${selectedFile?.name || '文件'} · 正在枚举全部工作表和内容批次，尚未调用AI`
              : '支持原始 Excel、文档和图片，无需整理成固定模板。'}</p>
            {busy ? (
              <div className="ai-data-progress"><span /><strong><LoaderCircle className="spin" size={15} /> 正在建立完整工作表目录</strong></div>
            ) : (
              <button className="primary-button ai-data-choose" type="button" onClick={() => inputRef.current?.click()}>
                <UploadCloud size={18} />选择训练文件
              </button>
            )}
            <input ref={inputRef} hidden type="file" accept={acceptedFiles} onChange={(event) => chooseFile(event.target.files?.[0])} />
          </div>
          <aside className="ai-intake-checklist">
            <header>
              <span>PRE-FLIGHT</span>
              <h2>导入前预检</h2>
              <p>每一步都有明确的确认点，不会上传后直接写库。</p>
            </header>
            <ol>
              <li><i><FileCheck2 size={16} /></i><span><strong>读取文件结构</strong><small>这一步只解析文件，不调用 AI</small></span></li>
              <li><i><Layers3 size={16} /></i><span><strong>选择识别范围</strong><small>Excel 会列出全部工作表，可按周次勾选</small></span></li>
              <li><i><BookOpenCheck size={16} /></i><span><strong>确认保存位置</strong><small>体能训练进训练矩阵，完成记录进个人档案</small></span></li>
            </ol>
            <div className="ai-data-file-types">
              <span>XLSX</span><span>DOCX</span><span>PDF</span><span>TXT / CSV</span><span>JPG / PNG</span>
            </div>
            <small className="ai-data-scope-note"><ShieldCheck size={14} /> 单个文件不超过10MB；确认前不写入数据库</small>
          </aside>
        </section>
      )}

      {inspection && !preview && !success && (
        <section className="ai-batch-selector">
          <header>
            <div className="ai-batch-file"><FileSpreadsheet /><span><small>文件结构已读取</small><strong>{inspection.fileName}</strong></span></div>
            <div className="ai-batch-count"><strong>{inspection.sections.length}</strong><span>内容分区</span><i /><strong>{selectedChunkCount}</strong><span>AI批次</span></div>
          </header>

          {!busy ? (
            <>
              <div className="ai-import-type-choice">
                <div><BrainCircuit /><span><strong>先确定保存位置</strong><small>自动判断不会把团队周训练写进个人完成记录</small></span></div>
                <section>
                  {documentTypeOptions.map((option) => (
                    <button
                      type="button"
                      className={targetType === option.value ? 'active' : ''}
                      onClick={() => setTargetType(option.value)}
                      key={option.value}
                    >
                      <i>{targetType === option.value && <Check size={13} />}</i>
                      <span><strong>{option.title}</strong><small>{option.note}</small></span>
                    </button>
                  ))}
                </section>
              </div>

              <div className="ai-section-heading">
                <div><Layers3 /><span><strong>选择要识别的工作表</strong><small>每个工作表会按内容长度继续拆批，确保后半部分不丢失</small></span></div>
                <span>
                  <button type="button" onClick={() => setSelectedSections(inspection.sections.map((section) => section.name))}>全选</button>
                  <button type="button" onClick={() => setSelectedSections([])}>清空</button>
                </span>
              </div>
              <div className="ai-section-grid">
                {inspection.sections.map((section, index) => {
                  const checked = selectedSections.includes(section.name);
                  return (
                    <button type="button" className={checked ? 'selected' : ''} onClick={() => toggleSection(section.name)} key={section.name}>
                      <i>{checked ? <Check size={13} /> : index + 1}</i>
                      <span><strong>{section.name}</strong><small>{section.chunkCount}批 · {Math.ceil(section.characterCount / 1000)}k字符</small></span>
                    </button>
                  );
                })}
              </div>
              {selectedChunkCount > 12 && (
                <div className="ai-batch-cost-note" role="status">
                  <AlertTriangle size={16} />
                  <span>
                    当前将分成约<strong>{selectedChunkCount}</strong>个 AI 批次，完整识别会花更长时间并按批次产生调用费用；
                    如果只需要部分周次，可以先取消无关工作表。
                  </span>
                </div>
              )}
              <footer>
                <div><ShieldCheck /><span>已选<strong>{selectedSections.length}</strong>个分区、<strong>{selectedChunkCount}</strong>个批次；识别完成后仍需人工确认。</span></div>
                <span>
                  <button className="secondary-button" onClick={reset}>重新选择文件</button>
                  <button className="primary-button" disabled={!selectedSections.length} onClick={startRecognition}><Sparkles size={16} />开始完整识别</button>
                </span>
              </footer>
            </>
          ) : (
            <div className="ai-batch-running">
              <div className="ai-batch-orbit"><BrainCircuit /><span>{progressPercent}%</span></div>
              <small>FULL WORKBOOK RECOGNITION</small>
              <h2>{jobProgress?.phase || '正在启动AI识别'}</h2>
              <p>{jobProgress?.currentLabel || '先判断文件类型，再逐批读取你选择的内容。请保持页面打开。'}</p>
              <div className="ai-batch-meter"><span style={{ width: `${progressPercent}%` }} /></div>
              <strong>{jobProgress?.completedChunks || 0} / {jobProgress?.totalChunks || selectedChunkCount} 批次</strong>
            </div>
          )}
        </section>
      )}

      {error && <div className="message-banner error"><XCircle />{error}</div>}

      {success && (
        <section className="ai-data-success">
          <div><CheckCircle2 /></div>
          <span>IMPORT COMPLETE</span>
          <h2>{planSaveReceipt ? '体能训练已写入' : '完成记录已写入'}</h2>
          <p>{success}</p>
          {planSaveReceipt && (
            <div className="ai-import-receipt">
              <header>
                <span><small>训练名称</small><strong>{planSaveReceipt.title}</strong></span>
                <span><small>训练周期</small><strong>{planSaveReceipt.startDate} — {planSaveReceipt.endDate}</strong></span>
              </header>
              <section>
                {planSaveReceipt.results.map((result) => (
                  <button type="button" onClick={() => onOpenTrainingPlan(result.athleteId, result.planId)} key={`${result.athleteId}-${result.planId}`}>
                    <i><Check size={13} /></i>
                    <span>
                      <strong>{result.athleteName}</strong>
                      <small>{result.status === 'created' ? '已新建训练' : result.status === 'replaced' ? '已覆盖原训练' : '已有训练，已跳过'}</small>
                    </span>
                    <ChevronRight size={15} />
                  </button>
                ))}
              </section>
            </div>
          )}
          <div className="ai-success-actions">
            <button className="primary-button" onClick={() => planSaveReceipt
              ? onOpenTrainingPlan(planSaveReceipt.results[0].athleteId, planSaveReceipt.results[0].planId)
              : onOpenRecords()
            }>
              {planSaveReceipt ? <BookOpenCheck size={17} /> : <TableProperties size={17} />}
              {planSaveReceipt ? '查看体能训练' : '查看训练日历'}
            </button>
            <button className="secondary-button" onClick={reset}><RotateCcw size={17} />继续导入</button>
          </div>
        </section>
      )}

      {preview && (
        <section className="ai-data-preview">
          <div className="ai-field-map" aria-label="AI字段映射流程">
            <div><FileCheck2 /><span><small>完整工作簿</small><strong>{preview.fileName}</strong></span></div>
            <ChevronRight />
            <div className="model"><BrainCircuit /><span><small>分批AI识别</small><strong>{preview.processedChunks || 1}批 · {preview.modelUsed || '当前模型'}</strong></span></div>
            <ChevronRight />
            <div className="fields">{preview.documentType === 'training_plan' ? <BookOpenCheck /> : <TableProperties />}<span><small>分类写入</small><strong>{preview.documentType === 'training_plan' ? '体能训练矩阵 · 支持多人' : '逐人逐日完成记录'}</strong></span></div>
          </div>

          <div className="ai-data-preview-head">
            <div>
              <span className="file-badge"><FileSpreadsheet size={17} />{preview.sourceFile?.extractionMethod || 'AI识别'} · 置信度 {Math.round((preview.confidence ?? 0) * 100)}%</span>
              <h2>{preview.documentType === 'training_plan' ? '识别为体能训练' : '逐条核对完成记录'}</h2>
              <p>{preview.summary || 'AI已完成分批识别与合并。保存前请确认人员、日期和训练内容。'}</p>
              {preview.classification?.reason && <small className="ai-classification-reason">分类依据：{preview.classification.reason}</small>}
            </div>
            <div className="preview-stats">
              <span><strong>{preview.documentType === 'training_plan' ? planWeeks.length : preview.total}</strong>{preview.documentType === 'training_plan' ? '训练阶段' : '识别记录'}</span>
              <span className="valid"><strong>{preview.documentType === 'training_plan' ? planItemCount : preview.valid}</strong>{preview.documentType === 'training_plan' ? '训练条目' : '可入库'}</span>
              <span className="invalid"><strong>{preview.failedChunks || preview.invalid}</strong>{preview.documentType === 'training_plan' ? '失败批次' : '待修正'}</span>
              <span className="warning"><strong>{preview.warningCount}</strong>提醒</span>
            </div>
          </div>

          {Boolean(preview.warnings?.length || preview.unmappedContent?.length || planEmptyDays.length) && (
            <div className="ai-data-warning-box">
              <AlertTriangle size={18} />
              <div>
                <strong>原文件中仍有需要人工确认的内容</strong>
                <p>{[
                  ...(preview.warnings || []),
                  ...(preview.unmappedContent || []),
                  ...(planEmptyDays.length ? [`以下日期只有日期或汇总信息，暂未形成训练条目：${planEmptyDays.join('、')}`] : [])
                ].join('；')}</p>
              </div>
            </div>
          )}

          {preview.documentType === 'training_plan' && preview.plan ? (
            <>
              <div className="ai-plan-review-grid">
                <section className="ai-plan-document">
                  <div className="ai-plan-section-title"><BookOpenCheck /><span><strong>体能训练信息</strong><small>系统将保存到体能训练矩阵，不进入训练日历</small></span></div>
                  <label><span>训练名称</span><input value={preview.plan.title} onChange={(event) => updatePlan({ title: event.target.value })} /></label>
                  <div className="ai-plan-date-pair">
                    <label><span>开始日期</span><input type="date" value={preview.plan.startDate} onChange={(event) => updatePlan({ startDate: event.target.value })} /></label>
                    <label><span>结束日期</span><input type="date" value={preview.plan.endDate} onChange={(event) => updatePlan({ endDate: event.target.value })} /></label>
                  </div>
                  <div className="ai-plan-ledger">
                    {planWeeks.map((week, index) => {
                      const itemCount = week.days.reduce((sum, day) => sum + day.items.length, 0);
                      const emptyDayCount = week.days.filter((day) => day.items.length === 0).length;
                      return (
                        <div key={week.id}>
                          <i>{index + 1}</i>
                          <span><strong>{week.label || `阶段 ${index + 1}`}</strong><small>{week.days.length}天 · {itemCount}项{emptyDayCount ? ` · ${emptyDayCount}天无明细` : ''}{week.focus ? ` · ${week.focus}` : ''}</small></span>
                        </div>
                      );
                    })}
                  </div>
                </section>

                <section className="ai-plan-assignment">
                  <div className="ai-plan-section-title"><Users /><span><strong>选择训练对象</strong><small>原文件没有姓名时必须手动选择，可同时选择多人</small></span><b>{planTargetIds.length}人</b></div>
                  <div className="ai-plan-athlete-grid">
                    {preview.athletes?.map((athlete) => {
                      const checked = planTargetIds.includes(athlete.id);
                      return (
                        <button type="button" className={checked ? 'selected' : ''} onClick={() => togglePlanAthlete(athlete.id)} key={athlete.id}>
                          <i>{checked && <Check size={13} />}</i>
                          <span><strong>{athlete.name}</strong><small>{athlete.team}</small></span>
                        </button>
                      );
                    })}
                  </div>
                  <label className="ai-replace-option">
                    <input type="checkbox" checked={replaceExisting} onChange={(event) => setReplaceExisting(event.target.checked)} />
                    <span><strong>覆盖同一开始日期的已有训练</strong><small>默认不覆盖；不勾选时已有训练会被跳过</small></span>
                  </label>
                </section>
              </div>

              <footer className="ai-data-preview-actions">
                <div><ShieldCheck size={17} /><span>体能训练会复制给你选择的每名运动员；AI不会自行根据组别分配人员。</span></div>
                <span>
                  <button className="secondary-button" disabled={busy} onClick={reset}>重新选择</button>
                  <button className="primary-button" disabled={busy || !planReady} onClick={commitPlan}>
                    {busy ? <><LoaderCircle className="spin" size={16} />正在保存…</> : `保存到体能训练 · ${planTargetIds.length}人`}
                  </button>
                </span>
              </footer>
            </>
          ) : (
            <>
              <div className="table-scroll ai-data-table-wrap">
                <table className="data-table ai-data-review-table">
                  <thead>
                    <tr><th>状态</th><th>原文定位</th><th>运动员</th><th>日期</th><th>训练类型</th><th>时长 min</th><th>距离 km</th><th>RPE</th><th>强度</th><th>训练内容</th><th>校验信息</th></tr>
                  </thead>
                  <tbody>
                    {preview.rows.map((row, index) => (
                      <tr key={`${row.rowNumber}-${index}`} className={row.errors.length ? 'row-invalid' : ''}>
                        <td className="ai-row-state">
                          {row.errors.length ? <XCircle className="row-error-icon" /> : row.warnings.length ? <AlertTriangle className="row-warning-icon" /> : <CheckCircle2 className="row-valid-icon" />}
                          <small>{Math.round((row.confidence ?? 0) * 100)}%</small>
                        </td>
                        <td><span className="ai-source-row" title={row.sourceText}>{row.sourceText || `识别记录 ${row.rowNumber}`}</span></td>
                        <td>
                          <select aria-label={`第${index + 1}条运动员`} value={row.athleteName} onChange={(event) => chooseAthlete(index, event.target.value)}>
                            <option value="">请选择</option>
                            {preview.athletes?.map((athlete) => <option value={athlete.name} key={athlete.id}>{athlete.name} · {athlete.team}</option>)}
                            {!preview.athletes?.some((athlete) => athlete.name === row.athleteName) && row.athleteName && <option value={row.athleteName}>{row.athleteName}（未匹配）</option>}
                          </select>
                        </td>
                        <td><input aria-label={`第${index + 1}条日期`} type="date" value={row.date} onChange={(event) => updateRow(index, { date: event.target.value })} /></td>
                        <td><input aria-label={`第${index + 1}条训练类型`} value={row.trainingType} onChange={(event) => updateRow(index, { trainingType: event.target.value })} /></td>
                        <td><input aria-label={`第${index + 1}条时长`} type="number" min="0" value={row.durationMin} onChange={(event) => updateRow(index, { durationMin: Number(event.target.value) })} /></td>
                        <td><input aria-label={`第${index + 1}条距离`} type="number" min="0" step="0.1" value={row.distanceKm} onChange={(event) => updateRow(index, { distanceKm: Number(event.target.value) })} /></td>
                        <td><input aria-label={`第${index + 1}条RPE`} type="number" min="0" max="10" step="0.5" value={row.rpe ?? ''} onChange={(event) => updateRow(index, { rpe: event.target.value === '' ? null : Number(event.target.value) })} /></td>
                        <td><input aria-label={`第${index + 1}条强度`} value={row.intensityZone} onChange={(event) => updateRow(index, { intensityZone: event.target.value })} /></td>
                        <td><textarea aria-label={`第${index + 1}条训练内容`} value={row.content} onChange={(event) => updateRow(index, { content: event.target.value })} /></td>
                        <td><span className="issue-copy">{[...row.errors, ...row.warnings].join('；') || '校验通过'}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <footer className="ai-data-preview-actions">
                <div><ShieldCheck size={17} /><span>原文没有姓名的行必须人工选择；确认后按“运动员 + 日期”写入完成记录。</span></div>
                <span>
                  <button className="secondary-button" disabled={busy} onClick={reset}>重新选择</button>
                  <button className="primary-button" disabled={busy || preview.valid === 0 || !preview.importId} onClick={commitRecords}>
                    {busy ? <><LoaderCircle className="spin" size={16} />正在写入…</> : `确认入库 ${preview.valid} 条`}
                  </button>
                </span>
              </footer>
            </>
          )}
        </section>
      )}
    </div>
  );
}
