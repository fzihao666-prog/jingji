import { useEffect, useRef, useState } from 'react';
import { Download, Plus } from 'lucide-react';
import { TRAINING_RECORD_OPTIONS, TRAINING_SET_COLUMNS, trainingRecordHeaders, type TrainingRecordTemplate } from '../../shared/training-record-template';
import { api } from '../api';
import type { Project } from '../types';
import { TemplateProjectEditor } from './TemplateProjectEditor';
import { TemplatePreviewColumns, TemplatePreviewDialog } from './TemplatePreviewDialog';

const emptyTemplate: TrainingRecordTemplate = { name: '', standard: [], fields: [] };
const labels: Record<string, string> = {
  时长分钟: '整课时长（分钟）', 距离千米: '整课距离（千米）', RPE: '整课 RPE', 实际重量kg: '每组重量（kg）',
  实际次数: '每组次数', 开始时间: '课次开始时间',
};

export function TrainingRecordTemplatePanel({ project, team, onLegacy, onClose }: {
  project: Project; team: string; onLegacy: () => void; onClose: () => void;
}) {
  const [saved, setSaved] = useState<TrainingRecordTemplate[]>([]);
  const [athleteCount, setAthleteCount] = useState<number>();
  const [template, setTemplate] = useState<TrainingRecordTemplate>(emptyTemplate);
  const [editing, setEditing] = useState(false);
  const [sourceName, setSourceName] = useState('');
  const newProjectButton = useRef<HTMLButtonElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
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

  async function submit(action: 'save' | 'download') {
    setBusy(true);
    setError('');
    setStatus('');
    try {
      const selected = { ...template, name: template.name.trim() };
      if (action === 'save') {
        const { template: savedTemplate } = await api.saveTrainingRecordTemplate(project, team, selected, sourceName);
        setSaved(current => [...current.filter(item => item.name !== sourceName && item.name !== savedTemplate.name), savedTemplate]);
        setSourceName(savedTemplate.name);
        setTemplate(savedTemplate);
        setStatus(`「${savedTemplate.name}」已保存到本队，可随时下载。`);
      } else {
        await api.downloadTrainingRecordTemplate(project, team, selected, false);
        setStatus('训练模板已开始下载。');
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '训练项目操作失败。');
    } finally {
      setBusy(false);
    }
  }

  const valid = template.name.trim() && (template.standard.length > 0 || template.fields.length > 0) && template.fields.every(field => field.name.trim());

  return <TemplatePreviewDialog title="训练记录模板预览" busy={busy} onClose={onClose}
    preview={editing && <TemplatePreviewColumns headers={trainingRecordHeaders({ ...template, fields: template.fields.filter(field => field.name.trim()) })} />}>
    <p>{team}{athleteCount !== undefined && ` · 预填 ${athleteCount} 名运动员`}</p>
    {error && <p role="alert">{error}</p>}
    <div role="status">{status}</div>
    <div className="test-template-actions">
      {!!saved.length && <label className="data-import-template-team">本队训练项目
        <select disabled={busy} value={sourceName} onChange={event => {
          const selected = saved.find(item => item.name === event.target.value);
          setSourceName(selected?.name ?? '');
          setEditing(Boolean(selected));
          setTemplate(selected ?? emptyTemplate);
          setStatus('');
        }}>
          <option value="">选择已有项目</option>
          {saved.map(item => <option key={item.name} value={item.name}>{item.name}</option>)}
        </select>
      </label>}
      <button ref={newProjectButton} type="button" className="primary-button" disabled={busy} onClick={() => {
        setSourceName('');
        setTemplate(emptyTemplate);
        setStatus('');
        setEditing(true);
      }}><Plus size={16} aria-hidden />新建训练项目</button>
    </div>
    {editing && <fieldset disabled={busy} className="test-template-group-fields">
      <legend>{sourceName ? '编辑训练项目' : '新建训练项目'}</legend>
      <TemplateProjectEditor name={template.name} fields={template.fields} nameLimit={80} fieldLimit={60} allowText autoFocus={!sourceName}
        onName={name => setTemplate(current => ({ ...current, name }))}
        onFields={fields => setTemplate(current => ({ ...current, fields }))}>
        <details>
          <summary>常用训练字段（选填{template.standard.length ? `，已选 ${template.standard.length} 项` : ''}）</summary>
          <div className="test-template-actions template-field-options">
            {TRAINING_RECORD_OPTIONS.filter(field => !TRAINING_SET_COLUMNS.some(key => key === field)).map(field => <label key={field}>
              <input type="checkbox" checked={template.standard.includes(field)} onChange={event => toggle(field, event.target.checked)} />
              {labels[field] ?? field}
            </label>)}
            <label><input type="checkbox" checked={template.standard.includes('实际重量kg')}
              onChange={event => toggle('实际重量kg', event.target.checked)} />力量组次（动作、组序、重量、次数）</label>
          </div>
        </details>
      </TemplateProjectEditor>
      {!valid && <p>填写项目名称，并至少添加一个完整的字段或选择一个常用训练字段，即可保存。</p>}
    </fieldset>}
    <footer className="test-template-actions">
      <details><summary>旧版模板</summary>
        <button type="button" className="secondary-button" disabled={busy} onClick={onLegacy}>下载旧三表模板</button>
      </details>
      {editing && <>
        <button type="button" className="secondary-button" disabled={busy} onClick={() => {
          setEditing(false);
          setSourceName('');
          setStatus('');
          newProjectButton.current?.focus();
        }}>取消编辑</button>
        <button type="button" className="secondary-button" disabled={busy || !valid} onClick={() => void submit('download')}>
          <Download size={16} aria-hidden />下载 Excel</button>
        <button type="button" className="primary-button" disabled={busy || !valid} onClick={() => void submit('save')}>
          保存到本队</button>
      </>}
    </footer>
  </TemplatePreviewDialog>;
}
