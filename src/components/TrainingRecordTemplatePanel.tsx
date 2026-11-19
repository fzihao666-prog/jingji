import { useEffect, useId, useRef, useState } from 'react';
import { Download, Plus } from 'lucide-react';
import { TRAINING_RECORD_OPTIONS, TRAINING_SET_COLUMNS, trainingRecordHeaders, type TrainingRecordTemplate } from '../../shared/training-record-template';
import { api } from '../api';
import type { Project } from '../types';
import './TestTemplatePanel.css';

const emptyTemplate: TrainingRecordTemplate = { name: '', standard: [], fields: [] };
const labels: Record<string, string> = {
  时长分钟: '整课时长（分钟）', 距离千米: '整课距离（千米）', RPE: '整课 RPE', 实际重量kg: '每组重量（kg）',
  实际次数: '每组次数', 开始时间: '课次开始时间',
};

export function TrainingRecordTemplatePanel({ project, team, onLegacy, onClose }: {
  project: Project; team: string; onLegacy: () => void; onClose: () => void;
}) {
  const titleId = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const [saved, setSaved] = useState<TrainingRecordTemplate[]>([]);
  const [athleteCount, setAthleteCount] = useState<number>();
  const [template, setTemplate] = useState<TrainingRecordTemplate>(emptyTemplate);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  useEffect(() => heading.current?.focus(), []);
  useEffect(() => {
    const controller = new AbortController();
    void api.trainingRecordTemplates(project, team, controller.signal).then(data => {
      if (controller.signal.aborted) return;
      setSaved(data.templates);
      setAthleteCount(data.athleteCount);
    }).catch(cause => {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : '模板加载失败。');
    });
    return () => controller.abort();
  }, [project, team]);

  function toggle(field: string, checked: boolean) {
    const fields: readonly string[] = TRAINING_SET_COLUMNS.some(key => key === field) ? TRAINING_SET_COLUMNS : [field];
    setTemplate(current => ({
      ...current, standard: checked ? [...new Set([...current.standard, ...fields])] : current.standard.filter(key => !fields.includes(key)),
    }));
  }

  async function download(saveTeam: boolean) {
    setBusy(true);
    setError('');
    setStatus('');
    try {
      const selected = { ...template, name: template.name.trim() };
      await api.downloadTrainingRecordTemplate(project, team, selected, saveTeam);
      if (saveTeam) setSaved(current => [...current.filter(item => item.name !== selected.name), selected]);
      setStatus(saveTeam ? '本队模板已保存，下载已开始。' : '训练模板已开始下载。');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '模板下载失败。');
    } finally {
      setBusy(false);
    }
  }

  const valid = template.name.trim() && (template.standard.length > 0 || template.fields.length > 0) && template.fields.every(field => field.name.trim());

  return <section className="data-import-template-panel test-template-panel" aria-labelledby={titleId}>
    <header className="test-template-actions">
      <h2 ref={heading} tabIndex={-1} id={titleId}>训练记录模板预览</h2>
      <button type="button" className="secondary-button" disabled={busy} onClick={onClose}>关闭预览</button>
    </header>
    <p>{team}{athleteCount !== undefined && ` · 预填 ${athleteCount} 名运动员`}</p>
    {error && <p role="alert">{error}</p>}
    <div role="status">{status}</div>
    <fieldset disabled={busy} className="test-template-group-fields">
      <legend>配置本次训练模板</legend>
      <div className="test-template-actions">
        {!!saved.length && <label className="data-import-template-team">本队常用模板
          <select value="" onChange={event => setTemplate(saved.find(item => item.name === event.target.value) ?? emptyTemplate)}>
            <option value="">选择模板</option>
            {saved.map(item => <option key={item.name} value={item.name}>{item.name}</option>)}
          </select>
        </label>}
        <label className="data-import-template-team">模板名称
          <input maxLength={80} value={template.name} onChange={event => setTemplate({ ...template, name: event.target.value })} />
        </label>
      </div>
      <div className="test-template-actions">
        {TRAINING_RECORD_OPTIONS.filter(field => !TRAINING_SET_COLUMNS.some(key => key === field)).map(field => <label key={field}>
          <input type="checkbox" checked={template.standard.includes(field)} onChange={event => toggle(field, event.target.checked)} />
          {labels[field] ?? field}
        </label>)}
        <label><input type="checkbox" checked={template.standard.includes('实际重量kg')}
          onChange={event => toggle('实际重量kg', event.target.checked)} />力量组次（动作、组序、重量、次数）</label>
      </div>
      {template.fields.map((field, index) => {
        const change = (patch: Partial<typeof field>) => setTemplate(current => ({
          ...current, fields: current.fields.map((entry, position) => position === index ? { ...entry, ...patch } : entry),
        }));
        return <div className="test-template-actions" key={index}>
          <label className="data-import-template-team">字段名称<input maxLength={80} value={field.name} onChange={event => change({ name: event.target.value })} /></label>
          <label className="data-import-template-team">单位（选填）<input maxLength={24} value={field.unit} onChange={event => change({ unit: event.target.value })} /></label>
          <label className="data-import-template-team">格式
            <select value={field.kind} onChange={event => change({ kind: event.target.value === 'text' ? 'text' : 'number' })}>
              <option value="number">数字</option><option value="text">文字</option>
            </select>
          </label>
          <button type="button" className="secondary-button" aria-label={`移除第 ${index + 1} 个自定义字段`}
            onClick={() => setTemplate(current => ({ ...current, fields: current.fields.filter((_, position) => index !== position) }))}>移除</button>
        </div>;
      })}
      <div><button type="button" className="secondary-button" disabled={template.fields.length >= 60}
        onClick={() => setTemplate(current => ({ ...current, fields: [...current.fields, { name: '', unit: '', kind: 'number' }] }))}>
        <Plus size={16} aria-hidden />添加自定义字段</button></div>
    </fieldset>
    <p>Excel 列：{trainingRecordHeaders({ ...template, fields: template.fields.filter(field => field.name.trim()) }).join('、')}</p>
    <div className="test-template-actions">
      <button type="button" className="secondary-button" disabled={busy} onClick={onLegacy}>下载旧三表模板</button>
      <button type="button" className="secondary-button" disabled={busy || !valid} onClick={() => void download(false)}>
        <Download size={16} aria-hidden />仅下载本次模板</button>
      <button type="button" className="primary-button" disabled={busy || !valid} onClick={() => void download(true)}>
        <Download size={16} aria-hidden />保存为本队模板并下载</button>
    </div>
  </section>;
}
