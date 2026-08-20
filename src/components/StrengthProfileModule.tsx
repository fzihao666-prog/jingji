import {
  CalendarDays,
  Download,
  Dumbbell,
  History,
  LoaderCircle,
  PencilLine,
  Save,
  X
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent } from 'react';
import {
  STRENGTH_GROUPS,
  STRENGTH_METRICS,
  STRENGTH_METRIC_MAP,
  metricDifference,
  strengthEvaluation,
  type StrengthGroupKey,
  type StrengthMetricKey,
  type StrengthMetricValues
} from '../../shared/strength-model';
import { api } from '../api';
import { exportPdfSheets } from '../pdf/exportPdf';
import type { Athlete, StrengthTest, User } from '../types';
import { formatDate, formatNumber, toIsoDate } from '../utils';
import { BrandLogo } from './BrandLogo';
import { StrengthAdvicePanel } from './StrengthAdvicePanel';
import { SlalomChampionComparison } from './SlalomChampionComparison';

type Props = {
  athlete: Athlete;
  user: User;
};

type StrengthCalloutPlacement = {
  metricKey: StrengthMetricKey;
  side: 'left' | 'right';
  top: number;
  reach: number;
  angle: number;
  posterior?: boolean;
};

const morphologyMetrics: StrengthMetricKey[] = [
  'heightCm',
  'weightKg',
  'armSpanCm',
  'sitReachCm'
];

const strengthCallouts: StrengthCalloutPlacement[] = [
  { metricKey: 'benchPressKg', side: 'left', top: 28, reach: 165, angle: -6 },
  { metricKey: 'rightPlankSec', side: 'left', top: 39, reach: 200, angle: 4 },
  { metricKey: 'highPullKg', side: 'left', top: 51, reach: 205, angle: 14 },
  { metricKey: 'squatKg', side: 'left', top: 61, reach: 205, angle: -8 },
  { metricKey: 'rightSingleLegSquatReps', side: 'left', top: 74, reach: 200, angle: 6 },
  { metricKey: 'verticalJumpCm', side: 'left', top: 87, reach: 190, angle: -4 },
  { metricKey: 'pullUpsReps', side: 'right', top: 15, reach: 155, angle: -16, posterior: true },
  { metricKey: 'benchPullKg', side: 'right', top: 28, reach: 165, angle: 7, posterior: true },
  { metricKey: 'frontPlankSec', side: 'right', top: 38, reach: 205, angle: -5 },
  { metricKey: 'leftPlankSec', side: 'right', top: 46, reach: 205, angle: 6 },
  { metricKey: 'deadliftKg', side: 'right', top: 58, reach: 205, angle: -10, posterior: true },
  { metricKey: 'leftSingleLegSquatReps', side: 'right', top: 74, reach: 200, angle: -5 }
];

type FormValues = Record<StrengthMetricKey, string>;

export function StrengthProfileModule({ athlete, user }: Props) {
  const [tests, setTests] = useState<StrengthTest[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [editorOpen, setEditorOpen] = useState(false);
  const [formMetrics, setFormMetrics] = useState<FormValues>(() => blankForm());
  const [formTargets, setFormTargets] = useState<FormValues>(() => blankForm());
  const [testDate, setTestDate] = useState(toIsoDate(new Date()));
  const [notes, setNotes] = useState('');
  const [saveBusy, setSaveBusy] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [pdfOpen, setPdfOpen] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [pdfError, setPdfError] = useState('');
  const pdfRef = useRef<HTMLDivElement>(null);
  const canEdit = user.role !== 'ATL';

  const loadTests = async (preferredId?: number) => {
    setLoading(true);
    setLoadError('');
    try {
      const result = await api.strengthTests(athlete.id);
      setTests(result.tests);
      setSelectedId(preferredId && result.tests.some((test) => test.id === preferredId)
        ? preferredId
        : result.tests[0]?.id || null);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : '力量测试档案加载失败。');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadTests();
  }, [athlete.id]);

  const selected = useMemo(
    () => tests.find((test) => test.id === selectedId) || tests[0] || null,
    [tests, selectedId]
  );

  useEffect(() => {
    if (!pdfOpen || !selected || !pdfRef.current) return;
    let cancelled = false;
    const run = async () => {
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      if (cancelled || !pdfRef.current) return;
      try {
        await exportPdfSheets(
          pdfRef.current,
          `${athlete.name}_个人档案_${selected.testDate}`,
          '齐总'
        );
      } catch (error) {
        setPdfError(error instanceof Error ? error.message : '力量档案PDF生成失败。');
      } finally {
        if (!cancelled) {
          setPdfOpen(false);
          setPdfBusy(false);
        }
      }
    };
    void run();
    return () => { cancelled = true; };
  }, [pdfOpen, selected, athlete]);

  const openEditor = () => {
    setFormMetrics(formFrom(selected?.metrics));
    setFormTargets(formFrom(selected?.targets));
    setTestDate(selected?.testDate || toIsoDate(new Date()));
    setNotes(selected?.notes || '');
    setSaveError('');
    setEditorOpen(true);
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setSaveBusy(true);
    setSaveError('');
    try {
      const result = await api.saveStrengthTest({
        athleteId: athlete.id,
        testDate,
        metrics: numericValues(formMetrics),
        targets: numericValues(formTargets),
        notes
      });
      setEditorOpen(false);
      await loadTests(result.id);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : '力量测试档案保存失败。');
    } finally {
      setSaveBusy(false);
    }
  };

  const beginExport = () => {
    if (!selected) return;
    setPdfBusy(true);
    setPdfError('');
    setPdfOpen(true);
  };

  return (
    <section className="strength-module">
      <header className="strength-module-heading">
        <div className="strength-module-title">
          <Dumbbell size={22} />
          <span><small>STRENGTH PROFILE</small><strong>个人档案</strong></span>
        </div>
        <div className="strength-module-actions">
          {tests.length > 1 && <label className="strength-history-select"><History size={15} /><select value={selected?.id || ''} onChange={(event) => setSelectedId(Number(event.target.value))}>{tests.map((test) => <option key={test.id} value={test.id}>{test.testDate}</option>)}</select></label>}
          {canEdit && <button className="secondary-button" onClick={openEditor}><PencilLine size={16} />{selected ? '更新测试' : '录入测试'}</button>}
          <button className="primary-button" onClick={beginExport} disabled={!selected || pdfBusy}>
            {pdfBusy ? <LoaderCircle className="spin" size={16} /> : <Download size={16} />}
            {pdfBusy ? '生成中…' : '导出个人档案'}
          </button>
        </div>
      </header>

      {loadError && <div className="global-error">{loadError}</div>}
      {pdfError && <div className="global-error">{pdfError}</div>}
      {loading ? (
        <div className="strength-loading"><LoaderCircle className="spin" /><span>正在读取力量测试…</span></div>
      ) : selected ? (
        <>
          <StrengthPoster athlete={athlete} test={selected} variant="web" />
          {athlete.project === '激流' && <SlalomChampionComparison athlete={athlete} test={selected} />}
          <StrengthAdvicePanel
            athlete={athlete}
            test={selected}
            user={user}
            comparisonPage={<article className="personal-pdf-sheet strength-pdf-sheet"><StrengthPoster athlete={athlete} test={selected} variant="pdf" /></article>}
          />
        </>
      ) : (
        <div className="strength-empty">
          <Dumbbell size={34} />
          <strong>暂无力量测试数据</strong>
            <p>{canEdit ? '录入实测值和教练目标后，系统会生成身体力量分布图与个人评价。' : '教练录入测试后，可在这里查看和下载个人档案。'}</p>
          {canEdit && <button className="primary-button" onClick={openEditor}>录入第一次测试</button>}
        </div>
      )}

      {editorOpen && (
        <div className="modal-backdrop strength-editor-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setEditorOpen(false); }}>
          <section className="strength-editor-modal" role="dialog" aria-modal="true" aria-labelledby="strength-editor-title">
            <header><div><span>力量测试</span><h2 id="strength-editor-title">{athlete.name} · 录入测试结果</h2></div><button className="icon-button" onClick={() => setEditorOpen(false)} aria-label="关闭"><X size={20} /></button></header>
            <form onSubmit={save}>
              <div className="strength-editor-meta">
                <label><span>测试日期</span><div><CalendarDays size={16} /><input type="date" value={testDate} onChange={(event) => setTestDate(event.target.value)} required /></div></label>
                <label><span>测试说明</span><input value={notes} onChange={(event) => setNotes(event.target.value)} maxLength={500} placeholder="例如：赛前专项力量测试" /></label>
              </div>
              <div className="strength-entry-head"><span>测试项目</span><span>实测值</span><span>教练目标</span></div>
              <div className="strength-entry-scroll">
                {(Object.keys(STRENGTH_GROUPS) as StrengthGroupKey[]).map((groupKey) => {
                  const group = STRENGTH_GROUPS[groupKey];
                  const metrics = STRENGTH_METRICS.filter((metric) => metric.group === groupKey && (!metric.projects || metric.projects.includes(athlete.project)));
                  if (!metrics.length) return null;
                  return <section className="strength-entry-group" key={groupKey}>
                    <h3 style={{ '--metric-color': group.color } as CSSProperties}><i />{group.label}</h3>
                    {metrics.map((metric) => <div className="strength-entry-row" key={metric.key}>
                      <label htmlFor={`metric-${metric.key}`}><strong>{metric.label}</strong><small>{metric.unit}</small></label>
                      <div><input id={`metric-${metric.key}`} type="number" step="0.1" min={metric.min} max={metric.max} value={formMetrics[metric.key]} onChange={(event) => setFormMetrics((current) => ({ ...current, [metric.key]: event.target.value }))} placeholder="未测试" /><span>{metric.unit}</span></div>
                      <div className={!metric.targetEnabled ? 'target-disabled' : ''}><input aria-label={`${metric.label}教练目标`} type="number" step="0.1" min={metric.min} max={metric.max} disabled={!metric.targetEnabled} value={formTargets[metric.key]} onChange={(event) => setFormTargets((current) => ({ ...current, [metric.key]: event.target.value }))} placeholder={metric.targetEnabled ? '未设置' : '不评价'} /><span>{metric.targetEnabled ? metric.unit : '—'}</span></div>
                    </div>)}
                  </section>;
                })}
              </div>
              {saveError && <p className="strength-save-error">{saveError}</p>}
              <footer><p>{athlete.project === '激流' ? '基础力量仍可设置教练目标；激流专项指标按男女冠军参考区间单独比较。' : '目标值由教练确认；系统只计算差值，不自动替换为所谓“冠军标准”。'}</p><button type="button" className="secondary-button" onClick={() => setEditorOpen(false)}>取消</button><button className="primary-button" disabled={saveBusy}>{saveBusy ? <><LoaderCircle className="spin" size={16} />保存中…</> : <><Save size={16} />保存测试</>}</button></footer>
            </form>
          </section>
        </div>
      )}

      {pdfOpen && selected && (
        <div className="pdf-export-stage" ref={pdfRef} aria-hidden="true">
          <article className="personal-pdf-sheet strength-pdf-sheet">
            <StrengthPoster athlete={athlete} test={selected} variant="pdf" />
          </article>
        </div>
      )}
    </section>
  );
}

function StrengthPoster({ athlete, test, variant }: { athlete: Athlete; test: StrengthTest; variant: 'web' | 'pdf' }) {
  const evaluation = strengthEvaluation(test.metrics, test.targets);
  return <div className={`strength-poster strength-poster-${variant}`}>
    <header className="strength-poster-header">
      <div className="strength-poster-brand"><BrandLogo className="print" /><span><strong>竞迹</strong><small>JINGJI PERFORMANCE</small></span></div>
      <div><span>{athlete.project === '皮划艇' ? 'CANOE / KAYAK STRENGTH ASSESSMENT' : athlete.project === '激流' ? 'CANOE SLALOM STRENGTH ASSESSMENT' : 'ROWING STRENGTH ASSESSMENT'}</span><h2>个人档案</h2><p>目标值由教练确认 · 测试日期 {formatDate(test.testDate)}</p></div>
      <span className="strength-poster-date">{test.testDate}</span>
    </header>

    <section className="strength-poster-identity">
      <div><span>姓名</span><strong>{athlete.name}</strong></div>
      <div><span>组别</span><strong>{athlete.team}</strong></div>
      <div><span>项目</span><strong>{athlete.project}</strong></div>
      <div><span>测试人</span><strong>{test.updatedBy}</strong></div>
    </section>

    <section className="strength-body-map">
      <div className="strength-morphology-column">
        {morphologyMetrics.map((key) => <MorphologyMetric key={key} metricKey={key} test={test} />)}
      </div>
      <span className="strength-measure-axis height" aria-hidden="true" />
      <span className="strength-measure-axis arm-span" aria-hidden="true" />
      <StrengthBodyFigure />
      {strengthCallouts.map((placement) => <StrengthCallout key={placement.metricKey} placement={placement} test={test} />)}
    </section>

    <section className="strength-poster-legend">
      {(Object.entries(STRENGTH_GROUPS) as Array<[StrengthGroupKey, (typeof STRENGTH_GROUPS)[StrengthGroupKey]]>).filter(([key]) => key !== 'morphology').map(([key, group]) => <span key={key}><i style={{ background: group.color }} />{group.label}</span>)}
      <span className="legend-sides"><b>实线</b>：前侧　<b>虚线</b>：后侧</span>
      <span className="legend-rule"><b>差值</b> =（实测 - 教练目标）÷ 教练目标</span>
    </section>

    <section className="strength-evaluation">
      <span>个人评价</span>
      <p>{evaluation}</p>
      {test.notes && <small>测试备注：{test.notes}</small>}
    </section>
    {variant === 'pdf' && <footer className="strength-pdf-footer"><span>竞迹 · {athlete.project}训练数据中心</span><span>水印：齐总</span><span>个人档案</span></footer>}
  </div>;
}

function MorphologyMetric({ metricKey, test }: { metricKey: StrengthMetricKey; test: StrengthTest }) {
  const metric = STRENGTH_METRIC_MAP[metricKey];
  const value = test.metrics[metricKey];
  return <div><span>{metric.label}</span><strong>{typeof value === 'number' ? formatNumber(value, 1) : '未测试'}<small>{typeof value === 'number' ? metric.unit : ''}</small></strong></div>;
}

function StrengthCallout({ placement, test }: { placement: StrengthCalloutPlacement; test: StrengthTest }) {
  const { metricKey, side, top, reach, angle, posterior } = placement;
  const metric = STRENGTH_METRIC_MAP[metricKey];
  const group = STRENGTH_GROUPS[metric.group];
  const value = test.metrics[metricKey];
  const target = test.targets[metricKey];
  const difference = metricDifference(value, target);
  const status = difference === null ? 'unrated' : difference >= 0 ? 'met' : 'gap';
  const style = {
    '--metric-color': group.color,
    '--callout-top': `${top}%`,
    '--callout-reach': `${reach}px`,
    '--callout-angle': `${angle}deg`
  } as CSSProperties;
  return <div className={`strength-callout ${side} ${status}${posterior ? ' posterior' : ''}`} style={style}>
    <span>{metric.label}</span>
    <strong>
      {typeof value === 'number' ? `${formatNumber(value, 1)}${metric.unit}` : '未测试'}
      <small>（{difference === null ? '目标未设置' : `${difference >= 0 ? '+' : ''}${difference.toFixed(1)}%`}）</small>
    </strong>
    <i />
  </div>;
}

function StrengthBodyFigure() {
  return <div className="strength-body-figure" aria-label="人体力量分布示意图">
    <img src="/assets/strength-anatomy-front.png" alt="正面人体肌肉解剖示意" />
    <span className="body-axis horizontal" />
    <span className="body-axis vertical" />
  </div>;
}

function blankForm() {
  return Object.fromEntries(STRENGTH_METRICS.map((metric) => [metric.key, ''])) as FormValues;
}

function formFrom(values?: StrengthMetricValues) {
  const form = blankForm();
  if (!values) return form;
  for (const metric of STRENGTH_METRICS) {
    const value = values[metric.key];
    if (typeof value === 'number') form[metric.key] = String(value);
  }
  return form;
}

function numericValues(values: FormValues) {
  const result: StrengthMetricValues = {};
  for (const metric of STRENGTH_METRICS) {
    if (values[metric.key] === '') continue;
    const value = Number(values[metric.key]);
    if (Number.isFinite(value)) result[metric.key] = value;
  }
  return result;
}
