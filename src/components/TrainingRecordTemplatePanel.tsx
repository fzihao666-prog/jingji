import { useEffect, useRef, useState } from 'react';
import { Download, Plus, Save } from 'lucide-react';
import { combineTrainingProjects, TRAINING_RECORD_IDENTITY, TRAINING_RECORD_OPTIONS, TRAINING_SET_COLUMNS, trainingRecordHeaders, type TrainingRecordTemplate } from '../../shared/training-record-template';
import { api } from '../api';
import type { Project } from '../types';
import { TemplateProjectEditor } from './TemplateProjectEditor';
import { TemplatePreviewColumns, TemplatePreviewDialog } from './TemplatePreviewDialog';

function availableColumns(projects: TrainingRecordTemplate[]) {
  return trainingRecordHeaders(combineTrainingProjects(projects)).slice(TRAINING_RECORD_IDENTITY.length);
}

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
  const [names, setNames] = useState<string[]>([]);
  const [published, setPublished] = useState<string[]>([]);
  const [columns, setColumns] = useState<string[]>([]);
  const [publishedColumns, setPublishedColumns] = useState<string[]>([]);
  const [candidate, setCandidate] = useState('');
  const projectForm = useRef<HTMLFieldSetElement>(null);
  const newProjectButton = useRef<HTMLButtonElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    void api.trainingRecordTemplates(project, team, controller.signal).then(data => {
      if (controller.signal.aborted) return;
      setSaved(data.templates);
      setNames(data.names);
      setPublished(data.names);
      const initial = data.columns ?? availableColumns(data.templates.filter(item => data.names.includes(item.name))
        .sort((a, b) => data.names.indexOf(a.name) - data.names.indexOf(b.name)));
      setColumns(initial);
      setPublishedColumns(initial);
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

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError('');
    setStatus('');
    try {
      await action();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '训练项目操作失败。');
    } finally {
      setBusy(false);
    }
  }

  function createProject() {
    void run(async () => {
      const { template: created } = await api.saveTrainingRecordTemplate(project, team, template, '');
      setSaved(current => [...current, created]);
      setTemplate(emptyTemplate);
      await includeProject(created);
      setStatus(`「${created.name}」已添加到 Excel 列。`);
      requestAnimationFrame(() => projectForm.current?.querySelector('input')?.focus());
    });
  }

  const selected = names.flatMap(name => saved.find(item => item.name === name) ?? []);
  const available = availableColumns(selected);
  const [columnCandidate, setColumnCandidate] = useState('');
  const changed = names.length !== published.length || names.some((name, index) => name !== published[index])
    || columns.length !== publishedColumns.length || columns.some((column, index) => column !== publishedColumns[index]);

  async function updateColumns(nextNames: string[], nextColumns: string[]) {
    setNames(nextNames);
    setColumns(nextColumns);
    const config = await api.saveTrainingTeamColumns(project, team, nextNames, nextColumns);
    setPublished(config.names);
    setPublishedColumns(config.columns);
  }

  function includeProject(item: TrainingRecordTemplate) {
    return updateColumns([...names, item.name], [...new Set([...columns, ...availableColumns([item])])]);
  }

  function move(index: number, offset: number) {
    setColumns(current => {
      const next = [...current];
      [next[index], next[index + offset]] = [next[index + offset], next[index]];
      return next;
    });
  }
  const valid = template.name.trim() && (template.standard.length > 0 || template.fields.length > 0) && template.fields.every(field => field.name.trim());

  return <TemplatePreviewDialog title="训练记录模板预览" busy={busy} onClose={onClose}
    preview={<TemplatePreviewColumns headers={trainingRecordHeaders(combineTrainingProjects(selected, columns))}
      fixedColumns={TRAINING_RECORD_IDENTITY.length} busy={busy} onMove={move}
      onRemove={index => void run(async () => {
        await updateColumns(names, columns.filter((_, position) => position !== index));
        setStatus('Excel 列已移除。');
      })} />}>
    <p>{team}{athleteCount !== undefined && ` · 预填 ${athleteCount} 名运动员`}</p>
    {error && <p role="alert">{error}</p>}
    <div role="status">{status}</div>
    <div className="test-template-actions">
      <label className="data-import-template-team">选择已有项目
        <select disabled={busy || editing} value={candidate} onChange={event => setCandidate(event.target.value)}>
          <option value="">选择训练项目</option>
          {saved.filter(item => !names.includes(item.name)).map(item => <option key={item.name}>{item.name}</option>)}
        </select>
      </label>
      <button type="button" className="secondary-button" disabled={busy || editing || !candidate} onClick={() => {
        const item = saved.find(entry => entry.name === candidate);
        if (item) void run(() => includeProject(item));
        setCandidate('');
      }}>加入模板</button>
      <button ref={newProjectButton} type="button" className="secondary-button" disabled={busy || editing || athleteCount === undefined} onClick={() => {
        setTemplate(emptyTemplate);
        setStatus('');
        setEditing(true);
      }}><Plus size={16} aria-hidden />新建训练项目</button>
    </div>
    {editing && <fieldset ref={projectForm} disabled={busy} className="test-template-group-fields">
      <legend>新建训练项目</legend>
      <TemplateProjectEditor name={template.name} fields={template.fields} nameLimit={80} fieldLimit={60} allowText autoFocus
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
      <div className="test-template-actions">
        <button type="button" className="primary-button" disabled={busy || !valid} onClick={createProject}>
          <Save size={16} aria-hidden />添加
        </button>
        <button type="button" className="secondary-button" onClick={() => {
          setEditing(false);
          requestAnimationFrame(() => newProjectButton.current?.focus());
        }}>结束新建</button>
      </div>
    </fieldset>}
    {!!selected.length && <>
      {available.some(column => !columns.includes(column)) && <div className="test-template-actions">
        <label className="data-import-template-team">添加已有字段
          <select value={columnCandidate} disabled={busy} onChange={event => setColumnCandidate(event.target.value)}>
            <option value="">选择字段</option>
            {available.filter(column => !columns.includes(column)).map(column => <option key={column}>{column}</option>)}
          </select>
        </label>
        <button type="button" className="secondary-button" disabled={busy || !available.includes(columnCandidate)} onClick={() => {
          void run(() => updateColumns(names, [...new Set([...columns, columnCandidate])]));
          setColumnCandidate('');
        }}>添加到 Excel</button>
      </div>}
    </>}
    {changed && <p>Excel 列已修改，保存到本队后即可下载并供本队使用。</p>}
    <footer className="test-template-actions">
      <button type="button" className="primary-button" disabled={busy || !changed} onClick={() => void run(async () => {
        const config = await api.saveTrainingTeamColumns(project, team, names, columns);
        setPublished(config.names);
        setPublishedColumns(config.columns);
        setStatus('Excel 列已保存到本队。');
      })}>保存到本队</button>
      <button type="button" className="secondary-button" disabled={busy || changed || !publishedColumns.length} onClick={() => void run(async () => {
        await api.downloadTrainingRecordTemplate(project, team);
        setStatus('训练模板已开始下载。');
      })}><Download size={16} aria-hidden />下载 Excel</button>
      <details><summary>旧版模板</summary>
        <button type="button" className="secondary-button" disabled={busy} onClick={onLegacy}>下载旧三表模板</button>
      </details>
    </footer>
  </TemplatePreviewDialog>;
}
