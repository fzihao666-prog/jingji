import { useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, Download, Plus, Save } from 'lucide-react';
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
      includeProject(created);
      setEditing(false);
      setStatus(`「${created.name}」已创建并加入模板。`);
      newProjectButton.current?.focus();
    });
  }

  const selected = names.flatMap(name => saved.find(item => item.name === name) ?? []);
  const available = availableColumns(selected);
  const [columnCandidate, setColumnCandidate] = useState('');
  const changed = names.length !== published.length || names.some((name, index) => name !== published[index])
    || columns.length !== publishedColumns.length || columns.some((column, index) => column !== publishedColumns[index]);

  function includeProject(item: TrainingRecordTemplate) {
    setNames(current => [...current, item.name]);
    const extra = availableColumns([item]);
    setColumns(current => [...new Set([...current, ...extra])]);
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
    preview={<TemplatePreviewColumns headers={trainingRecordHeaders(combineTrainingProjects(selected, columns))} />}>
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
        if (item) includeProject(item);
        setCandidate('');
      }}>加入模板</button>
      <button ref={newProjectButton} type="button" className="secondary-button" disabled={busy || editing || athleteCount === undefined} onClick={() => {
        setTemplate(emptyTemplate);
        setStatus('');
        setEditing(true);
      }}><Plus size={16} aria-hidden />新建训练项目</button>
    </div>
    {editing && <fieldset disabled={busy} className="test-template-group-fields">
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
          <Save size={16} aria-hidden />保存并加入模板
        </button>
        <button type="button" className="secondary-button" onClick={() => {
          setEditing(false);
          requestAnimationFrame(() => newProjectButton.current?.focus());
        }}>取消</button>
      </div>
    </fieldset>}
    {!!selected.length && <>
      <p>已加入的训练项目</p>
      <ul className="test-template-columns">
        {selected.map(item => <li key={item.name}>
          <strong>{item.name}</strong>
          <button type="button" className="secondary-button" disabled={busy} onClick={() => {
            const remaining = selected.filter(entry => entry.name !== item.name);
            setNames(remaining.map(entry => entry.name));
            setColumns(current => current.filter(column => availableColumns(remaining).includes(column)));
            setColumnCandidate('');
          }}>从模板移除</button>
        </li>)}
      </ul>
      <p>Excel 可填写列</p>
      <ol className="test-template-columns">
        {columns.map((column, index) => <li key={column}>
          <strong>{column}</strong>
          <div className="test-template-actions">
            <button type="button" className="secondary-button" aria-label={`上移${column}`} disabled={busy || index === 0} onClick={() => move(index, -1)}><ArrowUp size={16} aria-hidden /></button>
            <button type="button" className="secondary-button" aria-label={`下移${column}`} disabled={busy || index === columns.length - 1} onClick={() => move(index, 1)}><ArrowDown size={16} aria-hidden /></button>
            <button type="button" className="secondary-button" disabled={busy} aria-label={`移除${column}`}
              onClick={() => setColumns(current => current.filter(value => value !== column))}>移除</button>
          </div>
        </li>)}
      </ol>
      {available.some(column => !columns.includes(column)) && <div className="test-template-actions">
        <label className="data-import-template-team">添加已有字段
          <select value={columnCandidate} disabled={busy} onChange={event => setColumnCandidate(event.target.value)}>
            <option value="">选择字段</option>
            {available.filter(column => !columns.includes(column)).map(column => <option key={column}>{column}</option>)}
          </select>
        </label>
        <button type="button" className="secondary-button" disabled={busy || !available.includes(columnCandidate)} onClick={() => {
          setColumns(current => [...new Set([...current, columnCandidate])]);
          setColumnCandidate('');
        }}>添加到 Excel</button>
      </div>}
    </>}
    {changed && <p>Excel 列已修改，保存到本队后即可下载并供本队使用。</p>}
    <footer className="test-template-actions">
      <button type="button" className="primary-button" disabled={busy || editing || !changed || (names.length > 0 && !columns.length)} onClick={() => void run(async () => {
        const config = await api.saveTrainingTeamColumns(project, team, names, columns);
        setPublished(config.names);
        setPublishedColumns(config.columns);
        setStatus('Excel 列已保存到本队。');
      })}>保存到本队</button>
      <button type="button" className="secondary-button" disabled={busy || editing || changed || !published.length} onClick={() => void run(async () => {
        await api.downloadTrainingRecordTemplate(project, team);
        setStatus('训练模板已开始下载。');
      })}><Download size={16} aria-hidden />下载 Excel</button>
      <details><summary>旧版模板</summary>
        <button type="button" className="secondary-button" disabled={busy} onClick={onLegacy}>下载旧三表模板</button>
      </details>
    </footer>
  </TemplatePreviewDialog>;
}
