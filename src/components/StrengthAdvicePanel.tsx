import {
  CheckCircle2,
  Download,
  LoaderCircle,
  PencilLine,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  X
} from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { api } from '../api';
import { exportPdfSheets } from '../pdf/exportPdf';
import type {
  Athlete,
  StrengthAdvice,
  StrengthAdviceContent,
  StrengthTest,
  User
} from '../types';
import { formatDate } from '../utils';
import { BrandLogo } from './BrandLogo';

type Props = {
  athlete: Athlete;
  test: StrengthTest;
  user: User;
  comparisonPage: ReactNode;
};

export function StrengthAdvicePanel({ athlete, test, user, comparisonPage }: Props) {
  const [advice, setAdvice] = useState<StrengthAdvice | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [editor, setEditor] = useState<StrengthAdviceContent | null>(null);
  const [pdfOpen, setPdfOpen] = useState(false);
  const pdfRef = useRef<HTMLDivElement>(null);
  const canManage = user.role !== 'ATL';

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const result = await api.strengthAdvice(test.id);
      setAdvice(result.advice);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '训练建议加载失败。');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [test.id]);

  useEffect(() => {
    if (!pdfOpen || !advice || !pdfRef.current) return;
    let cancelled = false;
    const run = async () => {
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      if (cancelled || !pdfRef.current) return;
      try {
        await exportPdfSheets(
          pdfRef.current,
          `${athlete.name}_力量训练建议_${test.testDate}_V${advice.version}`,
          '齐总'
        );
      } catch (pdfError) {
        setError(pdfError instanceof Error ? pdfError.message : '训练建议PDF生成失败。');
      } finally {
        if (!cancelled) {
          setPdfOpen(false);
          setBusy('');
        }
      }
    };
    void run();
    return () => { cancelled = true; };
  }, [pdfOpen, advice, athlete.name, test.testDate]);

  const generate = async () => {
    setBusy('generate');
    setError('');
    setMessage('');
    try {
      const result = await api.generateStrengthAdvice(test.id);
      setAdvice(result.advice);
      setMessage(result.message);
    } catch (generateError) {
      setError(generateError instanceof Error ? generateError.message : '训练建议生成失败。');
    } finally {
      setBusy('');
    }
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!advice || !editor) return;
    setBusy('save');
    setError('');
    try {
      const result = await api.saveStrengthAdvice(test.id, advice.id, editor);
      setAdvice(result.advice);
      setEditor(null);
      setMessage(result.message);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : '训练建议保存失败。');
    } finally {
      setBusy('');
    }
  };

  const approve = async () => {
    if (!advice) return;
    setBusy('approve');
    setError('');
    try {
      const result = await api.approveStrengthAdvice(test.id, advice.id);
      setAdvice(result.advice);
      setMessage(result.message);
    } catch (approveError) {
      setError(approveError instanceof Error ? approveError.message : '训练建议确认失败。');
    } finally {
      setBusy('');
    }
  };

  if (loading) {
    return <section className="strength-advice-shell loading"><LoaderCircle className="spin" /><span>正在读取训练建议…</span></section>;
  }

  return <section className="strength-advice-shell">
    <header className="strength-advice-head">
      <div className="advice-title-lockup">
        <span className="advice-spark"><Sparkles size={20} /></span>
        <div><small>COACH DECISION SUPPORT</small><h2>训练建议方案</h2><p>系统计算数据，AI起草建议，教练确认后生效</p></div>
      </div>
      <div className="strength-advice-actions">
        {advice && <span className={`advice-status ${advice.status}`}>
          {advice.status === 'approved' ? <ShieldCheck size={14} /> : <PencilLine size={14} />}
          {advice.status === 'approved' ? '教练已确认' : '待教练确认'}
        </span>}
        {canManage && <button className="secondary-button" onClick={generate} disabled={Boolean(busy)}>
          {busy === 'generate' ? <LoaderCircle className="spin" size={16} /> : advice ? <RefreshCw size={16} /> : <Sparkles size={16} />}
          {advice ? '重新生成' : '生成训练建议'}
        </button>}
        {advice && canManage && <button className="secondary-button" onClick={() => setEditor(cloneContent(advice.content))} disabled={Boolean(busy)}><PencilLine size={16} />编辑</button>}
        {advice && canManage && advice.status !== 'approved' && <button className="primary-button" onClick={approve} disabled={Boolean(busy)}>
          {busy === 'approve' ? <LoaderCircle className="spin" size={16} /> : <CheckCircle2 size={16} />}确认方案
        </button>}
        {advice && <button className="primary-button" onClick={() => { setBusy('pdf'); setPdfOpen(true); }} disabled={Boolean(busy)}>
          {busy === 'pdf' ? <LoaderCircle className="spin" size={16} /> : <Download size={16} />}导出建议PDF
        </button>}
      </div>
    </header>

    {message && <div className="advice-message">{message}</div>}
    {error && <div className="global-error">{error}</div>}

    {!advice ? <div className="strength-advice-empty">
      <div><Sparkles size={30} /></div>
      <strong>{canManage ? '根据当前对比结果生成四周训练建议' : '教练尚未发布训练建议'}</strong>
      <p>{canManage ? '未配置AI API时会生成规则演示草案，配置后自动切换为AI生成。' : '教练确认方案后，你可以在这里查看和下载。'}</p>
      {canManage && <button className="primary-button" onClick={generate} disabled={Boolean(busy)}><Sparkles size={16} />生成训练建议</button>}
    </div> : <AdviceDocument advice={advice} athlete={athlete} test={test} variant="web" />}

    {editor && advice && <AdviceEditor content={editor} setContent={setEditor} onClose={() => setEditor(null)} onSave={save} busy={busy === 'save'} />}

    {pdfOpen && advice && <div className="pdf-export-stage" ref={pdfRef} aria-hidden="true">
      {comparisonPage}
      <article className="personal-pdf-sheet strength-advice-pdf">
        <AdviceDocument advice={advice} athlete={athlete} test={test} variant="pdf" />
      </article>
    </div>}
  </section>;
}

function AdviceDocument({ advice, athlete, test, variant }: {
  advice: StrengthAdvice;
  athlete: Athlete;
  test: StrengthTest;
  variant: 'web' | 'pdf';
}) {
  return <div className={`strength-advice-document ${variant}`}>
    <div className="advice-proof-strip">
      <span>{advice.source === 'ai' ? 'AI辅助草案' : '规则演示草案'}</span>
      <span>版本 V{advice.version}</span>
      <span>{advice.status === 'approved' ? `确认人 ${advice.reviewedBy}` : '尚未确认，不作为正式处方'}</span>
    </div>
    {variant === 'pdf' && <header className="advice-pdf-header">
      <div><BrandLogo className="print" /><span><strong>竞迹</strong><small>JINGJI PERFORMANCE</small></span></div>
      <div><small>{athlete.project === '激流' ? 'CANOE SLALOM STRENGTH DEVELOPMENT' : athlete.project === '皮划艇' ? 'CANOE / KAYAK STRENGTH DEVELOPMENT' : 'ROWING STRENGTH DEVELOPMENT'}</small><h1>{advice.content.title}</h1></div>
      <b>V{advice.version}</b>
    </header>}
    <section className="advice-athlete-line">
      <div><span>运动员</span><strong>{athlete.name}</strong></div>
      <div><span>项目 / 队伍</span><strong>{athlete.project} / {athlete.team}</strong></div>
      <div><span>测试日期</span><strong>{formatDate(test.testDate)}</strong></div>
      <div><span>方案状态</span><strong>{advice.status === 'approved' ? '教练已确认' : '待教练确认'}</strong></div>
    </section>
    <section className="advice-overview">
      <span>方案摘要</span><p>{advice.content.overview}</p>
    </section>
    <div className="advice-evidence-grid">
      <section><h3><i />保持优势</h3><ul>{advice.content.strengths.map((item) => <li key={item}>{item}</li>)}</ul></section>
      <section className="priority"><h3><i />优先改善</h3><ul>{advice.content.priorities.map((item) => <li key={item}>{item}</li>)}</ul></section>
    </div>
    <section className="advice-four-weeks">
      <header><span>四周训练路径</span><small>具体动作和负荷须结合专项课表调整</small></header>
      <div>{advice.content.weeks.map((week) => <article key={week.week}>
        <b>W{week.week}</b><h3>{week.focus}</h3><strong>{week.load}</strong>
        <ul>{week.prescription.map((item) => <li key={item}>{item}</li>)}</ul>
      </article>)}</div>
    </section>
    <div className="advice-bottom-grid">
      <section><h3>恢复要求</h3><ul>{advice.content.recovery.map((item) => <li key={item}>{item}</li>)}</ul></section>
      <section className="caution"><h3>执行边界</h3><ul>{advice.content.cautions.map((item) => <li key={item}>{item}</li>)}</ul></section>
    </div>
    <footer className="advice-disclaimer">
      <span>生成方式：{advice.model}</span>
      <p>本方案为训练决策辅助材料，不替代负责教练判断、医疗诊断或伤病处置意见。</p>
      <span>水印：齐总</span>
    </footer>
  </div>;
}

function AdviceEditor({ content, setContent, onClose, onSave, busy }: {
  content: StrengthAdviceContent;
  setContent: (content: StrengthAdviceContent) => void;
  onClose: () => void;
  onSave: (event: FormEvent) => void;
  busy: boolean;
}) {
  const setList = (key: 'strengths' | 'priorities' | 'recovery' | 'cautions', value: string) => {
    setContent({ ...content, [key]: value.split('\n').map((item) => item.trim()).filter(Boolean) });
  };
  return <div className="modal-backdrop advice-editor-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="advice-editor-modal" role="dialog" aria-modal="true" aria-labelledby="advice-editor-title">
      <header><div><span>教练审核</span><h2 id="advice-editor-title">编辑训练建议草案</h2></div><button className="icon-button" onClick={onClose} aria-label="关闭"><X size={20} /></button></header>
      <form onSubmit={onSave}>
        <label><span>方案摘要</span><textarea value={content.overview} onChange={(event) => setContent({ ...content, overview: event.target.value })} maxLength={800} /></label>
        <div className="advice-editor-grid">
          <label><span>保持优势（每行一项）</span><textarea value={content.strengths.join('\n')} onChange={(event) => setList('strengths', event.target.value)} /></label>
          <label><span>优先改善（每行一项）</span><textarea value={content.priorities.join('\n')} onChange={(event) => setList('priorities', event.target.value)} /></label>
        </div>
        <div className="advice-week-editor">{content.weeks.map((week, index) => <section key={week.week}>
          <strong>第{week.week}周</strong>
          <input value={week.focus} onChange={(event) => setContent({ ...content, weeks: content.weeks.map((item, itemIndex) => itemIndex === index ? { ...item, focus: event.target.value } : item) })} placeholder="训练重点" />
          <input value={week.load} onChange={(event) => setContent({ ...content, weeks: content.weeks.map((item, itemIndex) => itemIndex === index ? { ...item, load: event.target.value } : item) })} placeholder="负荷安排" />
          <textarea value={week.prescription.join('\n')} onChange={(event) => setContent({ ...content, weeks: content.weeks.map((item, itemIndex) => itemIndex === index ? { ...item, prescription: event.target.value.split('\n').filter(Boolean) } : item) })} placeholder="每行一项训练内容" />
        </section>)}</div>
        <div className="advice-editor-grid">
          <label><span>恢复要求（每行一项）</span><textarea value={content.recovery.join('\n')} onChange={(event) => setList('recovery', event.target.value)} /></label>
          <label><span>执行边界（每行一项）</span><textarea value={content.cautions.join('\n')} onChange={(event) => setList('cautions', event.target.value)} /></label>
        </div>
        <footer><p>保存后方案恢复为“待确认”，确认后运动员才能查看。</p><button type="button" className="secondary-button" onClick={onClose}>取消</button><button className="primary-button" disabled={busy}>{busy ? <LoaderCircle className="spin" size={16} /> : <CheckCircle2 size={16} />}保存草案</button></footer>
      </form>
    </section>
  </div>;
}

function cloneContent(content: StrengthAdviceContent): StrengthAdviceContent {
  return JSON.parse(JSON.stringify(content)) as StrengthAdviceContent;
}
