import {
  CalendarDays, ClipboardList, Copy, Download, History,
  LoaderCircle, PencilLine, Plus, Save, ShieldCheck, X
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent } from 'react';
import {
  STRENGTH_GROUPS, STRENGTH_METRICS, STRENGTH_METRIC_MAP,
  type StrengthGroupKey, type StrengthMetricKey, type StrengthMetricValues
} from '../../shared/strength-model';
import { api } from '../api';
import { exportPdfSheets } from '../pdf/exportPdf';
import type { Athlete, StrengthTest, User } from '../types';
import { formatDate, formatNumber, toIsoDate } from '../utils';
import { BrandLogo } from './BrandLogo';
import { SlalomChampionComparison } from './SlalomChampionComparison';

type Props = { athlete: Athlete; user: User };
type FormValues = Record<StrengthMetricKey, string>;
type EditorMode = 'new' | 'edit';
type ArchiveDraft = { testDate: string; metrics: StrengthMetricValues; targets: StrengthMetricValues; notes: string };
type ArchiveFactor = { key: string; label: string; metricKeys: StrengthMetricKey[]; lowerIsBetter?: StrengthMetricKey[] };

const archiveFactors: ArchiveFactor[] = [
  { key: 'composition', label: '身体成分', metricKeys: ['bodyFatPct'], lowerIsBetter: ['bodyFatPct'] },
  { key: 'explosive', label: '爆发能力', metricKeys: ['verticalJumpCm'] },
  { key: 'upper', label: '上肢力量', metricKeys: ['benchPressKg', 'benchPullKg'] },
  { key: 'pull', label: '拉力耐力', metricKeys: ['pullUpsReps'] },
  { key: 'maximum', label: '最大力量', metricKeys: ['squatKg', 'deadliftKg'] },
  { key: 'core', label: '核心稳定', metricKeys: ['frontPlankSec', 'leftPlankSec', 'rightPlankSec'] },
  { key: 'endurance', label: '下肢耐力', metricKeys: ['leftSingleLegSquatReps', 'rightSingleLegSquatReps'] },
  { key: 'flexibility', label: '柔韧能力', metricKeys: ['sitReachCm'] }
];

export function StrengthProfileModule({ athlete, user }: Props) {
  const [tests, setTests] = useState<StrengthTest[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorMode, setEditorMode] = useState<EditorMode>('new');
  const [formMetrics, setFormMetrics] = useState<FormValues>(() => blankForm());
  const [formTargets, setFormTargets] = useState<FormValues>(() => blankForm());
  const [testDate, setTestDate] = useState(toIsoDate(new Date()));
  const [notes, setNotes] = useState('');
  const [saveBusy, setSaveBusy] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [pdfOpen, setPdfOpen] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [pdfError, setPdfError] = useState('');
  const [dataNotice, setDataNotice] = useState('');
  const [draftNotice, setDraftNotice] = useState('');
  const pdfRef = useRef<HTMLDivElement>(null);
  const canEdit = (['SCC', 'PRJ', 'REG', 'TD', 'DMD'] as User['role'][]).includes(user.role);

  const loadTests = async (preferredId?: number) => {
    setLoading(true);
    setLoadError('');
    try {
      const result = await api.strengthTests(athlete.id);
      setTests(result.tests);
      setSelectedId(preferredId && result.tests.some((test) => test.id === preferredId) ? preferredId : result.tests[0]?.id || null);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : '运动员表现数据加载失败。');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setDataNotice('');
    void loadTests();
  }, [athlete.id]);

  const selected = useMemo(() => tests.find((test) => test.id === selectedId) || tests[0] || null, [tests, selectedId]);
  const previous = useMemo(() => {
    if (!selected) return null;
    const selectedIndex = tests.findIndex((test) => test.id === selected.id);
    return selectedIndex >= 0 ? tests[selectedIndex + 1] || null : null;
  }, [selected, tests]);

  useEffect(() => {
    if (!pdfOpen || !selected || !pdfRef.current) return;
    let cancelled = false;
    const run = async () => {
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      if (cancelled || !pdfRef.current) return;
      try {
        await exportPdfSheets(pdfRef.current, `${athlete.name}_运动员表现_${selected.testDate}`, '齐总');
      } catch (error) {
        setPdfError(error instanceof Error ? error.message : '运动员表现PDF生成失败。');
      } finally {
        if (!cancelled) { setPdfOpen(false); setPdfBusy(false); }
      }
    };
    void run();
    return () => { cancelled = true; };
  }, [pdfOpen, selected, athlete]);

  const openEditor = (mode: EditorMode) => {
    setEditorMode(mode);
    const draft = mode === 'new' ? readArchiveDraft(athlete.id) : null;
    const source = mode === 'edit' ? selected : draft;
    setFormMetrics(formFrom(source?.metrics));
    setFormTargets(formFrom(source?.targets));
    setTestDate(source?.testDate || toIsoDate(new Date()));
    setNotes(source?.notes || '');
    setSaveError('');
    setDraftNotice(draft ? '已恢复上次未提交的本机草稿。' : '');
    setEditorOpen(true);
  };

  const persistDraft = () => {
    const draft: ArchiveDraft = { testDate, metrics: numericValues(formMetrics), targets: numericValues(formTargets), notes };
    localStorage.setItem(archiveDraftKey(athlete.id), JSON.stringify(draft));
    setDraftNotice('草稿已保存在本机，仅当前浏览器可见。');
  };

  const closeEditor = () => {
    if (saveBusy) return;
    if (editorMode === 'new' && (Object.values(formMetrics).some(Boolean) || Object.values(formTargets).some(Boolean) || notes.trim())) {
      persistDraft();
      setDataNotice('未提交的测试数据已保存为本机草稿。');
    }
    setEditorOpen(false);
  };

  const copyPreviousTargets = () => {
    if (!selected) return;
    setFormTargets(formFrom(selected.targets));
    setDraftNotice(`已沿用${selected.testDate}的目标值，实测值未复制。`);
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (editorMode === 'new' && tests.some((test) => test.testDate === testDate)
      && !window.confirm(`${testDate}已有测试记录，继续保存会更新该日期的数据。是否继续？`)) return;
    setSaveBusy(true);
    setSaveError('');
    try {
      const result = await api.saveStrengthTest({ athleteId: athlete.id, testDate, metrics: numericValues(formMetrics), targets: numericValues(formTargets), notes });
      localStorage.removeItem(archiveDraftKey(athlete.id));
      setEditorOpen(false);
      setDataNotice(editorMode === 'new' ? '测试数据已保存，档案和雷达图已更新。' : '本次测试数据已更新。');
      await loadTests(result.id);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : '运动员表现数据保存失败。');
    } finally {
      setSaveBusy(false);
    }
  };

  const previewMetrics = useMemo(() => numericValues(formMetrics), [formMetrics]);
  const previewTargets = useMemo(() => numericValues(formTargets), [formTargets]);
  const previewBaseline = editorMode === 'new' ? selected : previous;
  const previewStandards = useMemo(() => ({ ...previewBaseline?.targets, ...previewTargets }), [previewBaseline, previewTargets]);
  const previewBeforeScores = useMemo(() => archiveFactors.map((factor) => factorScore(factor, previewBaseline, previewStandards)), [previewBaseline, previewStandards]);
  const previewAfterScores = useMemo(() => archiveFactors.map((factor) => factorScoreValues(factor, previewMetrics, previewStandards)), [previewMetrics, previewStandards]);
  const previewTotal = totalScore(previewAfterScores);
  const previewMetricCount = Object.keys(previewMetrics).length;
  const availableMetricCount = importableMetrics(athlete.project).length;

  return (
    <section className="strength-module archive-profile-module">
      <header className="strength-module-heading">
        <div className="strength-module-title"><ClipboardList size={22} /><span><small>ATHLETE PERFORMANCE</small><strong>运动员表现档案</strong></span></div>
        <div className="strength-module-actions">
          {tests.length > 1 && <label className="strength-history-select"><History size={15} /><select aria-label="档案测试日期" value={selected?.id || ''} onChange={(event) => setSelectedId(Number(event.target.value))}>{tests.map((test) => <option key={test.id} value={test.id}>{test.testDate}</option>)}</select></label>}
          {canEdit && <button className="secondary-button archive-new-test-button" onClick={() => openEditor('new')}><Plus size={16} />录入新测试</button>}
          {canEdit && selected && <button className="secondary-button" onClick={() => openEditor('edit')}><PencilLine size={16} />编辑本次数据</button>}
          <button className="primary-button" onClick={() => { if (selected) { setPdfBusy(true); setPdfError(''); setPdfOpen(true); } }} disabled={!selected || pdfBusy}>{pdfBusy ? <LoaderCircle className="spin" size={16} /> : <Download size={16} />}{pdfBusy ? '生成中…' : '导出运动员表现'}</button>
        </div>
      </header>

      {loadError && <div className="global-error">{loadError}</div>}
      {pdfError && <div className="global-error">{pdfError}</div>}
      {dataNotice && <div className="archive-import-notice"><Save size={16} />{dataNotice}</div>}
      {loading ? <div className="strength-loading"><LoaderCircle className="spin" /><span>正在读取运动员表现…</span></div> : selected ? <>
        <div className="archive-sheet-scroll"><ArchiveSheet athlete={athlete} test={selected} previous={previous} variant="web" /></div>
        {athlete.project === '激流' && <SlalomChampionComparison athlete={athlete} test={selected} />}
      </> : <div className="strength-empty"><ClipboardList size={34} /><strong>暂无运动员表现数据</strong><p>{canEdit ? '录入第一次测试后，系统会生成评分表与雷达图。' : '教练录入测试后，你可以在这里查看和导出运动员表现。'}</p>{canEdit && <div className="archive-empty-actions"><button className="primary-button" onClick={() => openEditor('new')}><Plus size={16} />录入第一次测试</button></div>}</div>}

      {editorOpen && <div className="modal-backdrop strength-editor-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeEditor(); }}>
        <section className="strength-editor-modal archive-entry-modal" role="dialog" aria-modal="true" aria-labelledby="strength-editor-title">
          <header><div><span>{editorMode === 'new' ? 'NEW FITNESS TEST' : 'EDIT FITNESS TEST'}</span><h2 id="strength-editor-title">{athlete.name} · {editorMode === 'new' ? '录入新测试' : '编辑本次数据'}</h2></div><button className="icon-button" onClick={closeEditor} aria-label="关闭"><X size={20} /></button></header>
          <form onSubmit={save}>
            <div className="archive-entry-meta">
              <div className="archive-entry-athlete"><span>当前运动员</span><strong>{athlete.name}</strong><small>{athlete.project} · {athlete.team}</small></div>
              <label><span>测试日期</span><div><CalendarDays size={16} /><input type="date" value={testDate} disabled={editorMode === 'edit'} onChange={(event) => setTestDate(event.target.value)} required /></div></label>
              <label className="archive-entry-note"><span>测试说明</span><input value={notes} onChange={(event) => setNotes(event.target.value)} maxLength={500} placeholder="例如：阶段体能后测" /></label>
              <button type="button" className="secondary-button copy-target-button" disabled={!selected || !Object.keys(selected.targets).length} onClick={copyPreviousTargets}><Copy size={15} />沿用上次目标</button>
            </div>
            <div className="archive-entry-layout">
              <section className="archive-entry-fields">
                <div className="strength-entry-head"><span>测试项目</span><span>实测值</span><span>满分标准／教练目标</span></div>
                <div className="strength-entry-scroll">{(Object.keys(STRENGTH_GROUPS) as StrengthGroupKey[]).map((groupKey) => {
                  const group = STRENGTH_GROUPS[groupKey];
                  const metrics = STRENGTH_METRICS.filter((metric) => metric.group === groupKey && (!metric.projects || metric.projects.includes(athlete.project)));
                  if (!metrics.length) return null;
                  return <section className="strength-entry-group" key={groupKey}><h3 style={{ '--metric-color': group.color } as CSSProperties}><i />{groupKey === 'morphology' ? '基本信息' : group.label}</h3>{metrics.map((metric) => <div className="strength-entry-row" key={metric.key}>
                    <label htmlFor={`metric-${metric.key}`}><strong>{metric.label}</strong><small>{metric.unit}</small></label>
                    <div><input id={`metric-${metric.key}`} type="number" step="0.1" min={metric.min} max={metric.max} value={formMetrics[metric.key]} onChange={(event) => { setFormMetrics((current) => ({ ...current, [metric.key]: event.target.value })); setDraftNotice(''); }} placeholder="未测试" /><span>{metric.unit}</span></div>
                    <div className={!metric.targetEnabled ? 'target-disabled' : ''}><input aria-label={`${metric.label}教练目标`} type="number" step="0.1" min={metric.min} max={metric.max} disabled={!metric.targetEnabled} value={formTargets[metric.key]} onChange={(event) => { setFormTargets((current) => ({ ...current, [metric.key]: event.target.value })); setDraftNotice(''); }} placeholder={metric.targetEnabled ? '未设置' : '不评价'} /><span>{metric.targetEnabled ? metric.unit : '—'}</span></div>
                  </div>)}</section>;
                })}</div>
              </section>
              <aside className="archive-live-preview">
                <header><span>REAL-TIME PROFILE</span><strong>档案实时预览</strong></header>
                <div className="archive-preview-scope"><span>{editorMode === 'new' ? '新增测试' : '当前测试'}</span><strong>{testDate}</strong><small>{previewBaseline ? `对比基线 ${previewBaseline.testDate}` : '暂无历史基线'}</small></div>
                <div className="archive-preview-stats"><div><span>已填写</span><strong>{previewMetricCount}<small>/{availableMetricCount}项</small></strong></div><div><span>当前总分</span><strong>{previewTotal ?? '—'}<small>/80分</small></strong></div><div><span>目标值</span><strong>{Object.keys(previewStandards).length}<small>项</small></strong></div></div>
                <ArchiveRadar factors={archiveFactors} before={previewBeforeScores} after={previewAfterScores} />
                <p className="archive-preview-rule"><ShieldCheck size={15} />空白项目保持“未测试”，不会记为0分；雷达图随输入实时更新。</p>
              </aside>
            </div>
            {draftNotice && <p className="archive-draft-notice">{draftNotice}</p>}
            {saveError && <p className="strength-save-error">{saveError}</p>}
            <footer><p>姓名、项目、队伍和教练在这里保持只读；运动员账号没有录入权限。</p><button type="button" className="secondary-button" onClick={closeEditor}>{editorMode === 'new' ? '稍后继续' : '取消'}</button>{editorMode === 'new' && <button type="button" className="secondary-button" onClick={persistDraft}><Save size={16} />保存草稿</button>}<button className="primary-button" disabled={saveBusy}>{saveBusy ? <><LoaderCircle className="spin" size={16} />保存中…</> : <><Save size={16} />保存测试数据</>}</button></footer>
          </form>
        </section>
      </div>}

      {pdfOpen && selected && <div className="pdf-export-stage" ref={pdfRef} aria-hidden="true"><article className="personal-pdf-sheet strength-pdf-sheet"><ArchiveSheet athlete={athlete} test={selected} previous={previous} variant="pdf" /></article></div>}
    </section>
  );
}

function ArchiveSheet({ athlete, test, previous, variant }: { athlete: Athlete; test: StrengthTest; previous: StrengthTest | null; variant: 'web' | 'pdf' }) {
  const standards = { ...previous?.targets, ...test.targets };
  const beforeScores = archiveFactors.map((factor) => factorScore(factor, previous, standards));
  const afterScores = archiveFactors.map((factor) => factorScore(factor, test, standards));
  const beforeTotal = totalScore(beforeScores);
  const afterTotal = totalScore(afterScores);
  const year = test.testDate.slice(0, 4);
  return <div className={`strength-poster strength-poster-${variant} archive-sheet archive-sheet-${variant}`}>
    <header className="archive-sheet-header">
      <div className="archive-institute"><strong>冠蒂本</strong><span>训练数据中心</span></div>
      <h2><span>{year}年{athlete.project}体能训练营</span>运动员表现信息表</h2>
      <div className="archive-brand"><BrandLogo variant="full" className="print" /><small>测试日期：{formatDate(test.testDate)}</small><small>地点：冠蒂本训练中心</small></div>
    </header>
    <h3 className="archive-section-title">基本信息</h3>
    <section className="archive-basic-grid">
      <ArchiveBasic label="姓名" english="Name" value={athlete.name} />
      <ArchiveBasic label="出生年月" english="Birthday" value={athlete.birthDate ? formatDate(athlete.birthDate) : '未录入'} />
      <ArchiveBasic label="性别" english="Gender" value={athlete.gender || '未录入'} />
      <ArchiveBasic label="分项" english="Group" value={`${athlete.project} · ${athlete.team}`} />
      <ArchiveBasic label="位置/号位" english="Position" value={athlete.athletePosition || '未录入'} />
      <ArchiveBasic label="身高" english="Height" value={metricBasicValue(test, 'heightCm', athlete.heightCm)} />
      <ArchiveBasic label="体重" english="Weight" value={metricBasicValue(test, 'weightKg', athlete.weightKg)} />
      <ArchiveBasic label="体脂率" english="Body fat ratio" value={metricBasicValue(test, 'bodyFatPct', athlete.bodyFatPct)} />
      <ArchiveBasic label="训练年限" english="Training years" value={metricBasicValue(test, 'trainingYears')} />
    </section>
    <h3 className="archive-section-title">多要素雷达图</h3>
    <div className="archive-score-summary"><span>前测总分：<strong>{beforeTotal === null ? '—' : `${beforeTotal}分`}</strong></span><span>后测总分：<strong>{afterTotal === null ? '—' : `${afterTotal}分`}</strong></span>{beforeTotal !== null && afterTotal !== null && <span className={afterTotal >= beforeTotal ? 'improved' : 'declined'}>{afterTotal >= beforeTotal ? '▲' : '▼'} {Math.abs(afterTotal - beforeTotal)}分</span>}</div>
    <section className="archive-assessment-top">
      <ArchiveScoreTable factors={archiveFactors.slice(0, 4)} scoreOffset={0} before={previous} after={test} standards={standards} beforeScores={beforeScores} afterScores={afterScores} />
      <ArchiveRadar factors={archiveFactors} before={beforeScores} after={afterScores} />
    </section>
    <section className="archive-assessment-bottom">
      <ArchiveScoreTable factors={archiveFactors.slice(4)} scoreOffset={4} before={previous} after={test} standards={standards} beforeScores={beforeScores} afterScores={afterScores} detail />
    </section>
    <footer className="archive-sheet-note"><span>评分说明：单项按实测值与满分标准／教练目标折算，满分10分；未测试不记0分。</span><span>数据更新：{test.updatedBy}</span></footer>
  </div>;
}

function ArchiveBasic({ label, english, value }: { label: string; english: string; value: string }) {
  return <div><span><strong>{label}</strong><small>{english}</small></span><b>{value}</b></div>;
}

function ArchiveScoreTable({ factors, scoreOffset, before, after, standards, beforeScores, afterScores, detail = false }: {
  factors: ArchiveFactor[];
  scoreOffset: number;
  before: StrengthTest | null;
  after: StrengthTest;
  standards: StrengthMetricValues;
  beforeScores: Array<number | null>;
  afterScores: Array<number | null>;
  detail?: boolean;
}) {
  return <div className={`archive-score-table-wrap ${detail ? 'detail' : 'primary'}`}><table className="archive-score-table">
    <thead><tr><th rowSpan={2}>体能要素</th><th rowSpan={2}>检测指标</th><th colSpan={2}>实测值 Result</th><th rowSpan={2}>满分标准<br />Target</th><th colSpan={2}>评分 Score</th></tr><tr><th>前测</th><th>后测</th><th>前测</th><th>后测</th></tr></thead>
    <tbody>{factors.map((factor, localIndex) => {
      const scoreIndex = scoreOffset + localIndex;
      const beforeScore = beforeScores[scoreIndex];
      const afterScore = afterScores[scoreIndex];
      return <tr key={factor.key}><th>{factor.label}<small>{factor.key.toUpperCase()}</small></th><td>{factor.metricKeys.map((key) => <span key={key}>{STRENGTH_METRIC_MAP[key].label}</span>)}</td><td>{factorValues(factor, before?.metrics)}</td><td>{factorValues(factor, after.metrics)}</td><td>{factorValues(factor, standards)}</td><td className={scoreClass(beforeScore)}>{beforeScore ?? '—'}</td><td className={scoreClass(afterScore)}>{afterScore ?? '—'}</td></tr>;
    })}</tbody>
  </table></div>;
}

function ArchiveRadar({ factors, before, after }: { factors: ArchiveFactor[]; before: Array<number | null>; after: Array<number | null> }) {
  const centerX = 170, centerY = 148, radius = 92;
  const polygon = (values: Array<number | null>) => values.map((value, index) => radarPoint(index, value ?? 0, factors.length, centerX, centerY, radius)).join(' ');
  return <figure className="archive-radar"><svg viewBox="0 0 340 310" role="img" aria-label="前测与后测多要素雷达图">
    {[2, 4, 6, 8, 10].map((level) => <polygon key={level} className={level === 10 ? 'radar-ring outer' : 'radar-ring'} points={polygon(factors.map(() => level))} />)}
    {factors.map((factor, index) => { const [x, y] = radarPoint(index, 10, factors.length, centerX, centerY, radius); const [labelX, labelY] = radarPoint(index, 12.7, factors.length, centerX, centerY, radius); return <g key={factor.key}><line className="radar-axis" x1={centerX} y1={centerY} x2={x} y2={y} /><text x={labelX} y={labelY} textAnchor={labelX < centerX - 8 ? 'end' : labelX > centerX + 8 ? 'start' : 'middle'} dominantBaseline="middle">{factor.label}</text></g>; })}
    <polygon className="radar-before" points={polygon(before)} /><polygon className="radar-after" points={polygon(after)} />
    {after.map((value, index) => { const [x, y] = radarPoint(index, value ?? 0, factors.length, centerX, centerY, radius); return <circle key={factors[index].key} cx={x} cy={y} r="2.7" />; })}
  </svg><figcaption><span><i className="full" />满分标准</span><span><i className="before" />前测</span><span><i className="after" />后测</span></figcaption></figure>;
}

function radarPoint(index: number, value: number, total: number, centerX: number, centerY: number, radius: number): [number, number] {
  const angle = Math.PI * 2 * index / total - Math.PI / 2;
  const scaled = radius * Math.max(0, Math.min(10, value)) / 10;
  return [centerX + Math.cos(angle) * scaled, centerY + Math.sin(angle) * scaled];
}

function factorValues(factor: ArchiveFactor, values?: StrengthMetricValues) {
  return <>{factor.metricKeys.map((key) => { const metric = STRENGTH_METRIC_MAP[key]; const value = values?.[key]; return <span key={key}>{typeof value === 'number' ? `${formatNumber(value, 1)}${metric.unit}` : '—'}</span>; })}</>;
}

function factorScore(factor: ArchiveFactor, test: StrengthTest | null, standards: StrengthMetricValues) {
  return test ? factorScoreValues(factor, test.metrics, standards) : null;
}

function factorScoreValues(factor: ArchiveFactor, metrics: StrengthMetricValues, standards: StrengthMetricValues) {
  const scores = factor.metricKeys.flatMap((key) => {
    const value = metrics[key];
    const target = standards[key];
    if (typeof value !== 'number' || typeof target !== 'number' || value <= 0 || target <= 0) return [];
    const lower = factor.lowerIsBetter?.includes(key);
    return [Math.max(0, Math.min(10, Math.round((lower ? target / value : value / target) * 10)))];
  });
  return scores.length ? Math.round(scores.reduce((sum, value) => sum + value, 0) / scores.length) : null;
}

function totalScore(scores: Array<number | null>) { const available = scores.filter((score): score is number => score !== null); return available.length ? available.reduce((sum, score) => sum + score, 0) : null; }
function scoreClass(score: number | null) { return score === null ? 'archive-score-empty' : score >= 8 ? 'archive-score-green' : score >= 5 ? 'archive-score-yellow' : 'archive-score-red'; }
function metricBasicValue(test: StrengthTest, key: StrengthMetricKey, fallback?: number | null) { const metric = STRENGTH_METRIC_MAP[key]; const value = test.metrics[key] ?? fallback; return typeof value === 'number' ? `${formatNumber(value, 1)}${metric.unit}` : '未测试'; }
function blankForm() { return Object.fromEntries(STRENGTH_METRICS.map((metric) => [metric.key, ''])) as FormValues; }
function formFrom(values?: StrengthMetricValues) { const form = blankForm(); if (!values) return form; for (const metric of STRENGTH_METRICS) { const value = values[metric.key]; if (typeof value === 'number') form[metric.key] = String(value); } return form; }
function numericValues(values: FormValues) { const result: StrengthMetricValues = {}; for (const metric of STRENGTH_METRICS) { if (values[metric.key] === '') continue; const value = Number(values[metric.key]); if (Number.isFinite(value)) result[metric.key] = value; } return result; }
function importableMetrics(project: string) { return STRENGTH_METRICS.filter((metric) => !metric.projects || metric.projects.includes(project)); }

function archiveDraftKey(athleteId: number) { return `jingji-personal-archive-draft-${athleteId}`; }

function readArchiveDraft(athleteId: number): ArchiveDraft | null {
  try {
    const raw = localStorage.getItem(archiveDraftKey(athleteId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ArchiveDraft>;
    return {
      testDate: /^\d{4}-\d{2}-\d{2}$/.test(parsed.testDate || '') ? parsed.testDate! : toIsoDate(new Date()),
      metrics: parsed.metrics && typeof parsed.metrics === 'object' ? parsed.metrics : {},
      targets: parsed.targets && typeof parsed.targets === 'object' ? parsed.targets : {},
      notes: typeof parsed.notes === 'string' ? parsed.notes : ''
    };
  } catch {
    localStorage.removeItem(archiveDraftKey(athleteId));
    return null;
  }
}
