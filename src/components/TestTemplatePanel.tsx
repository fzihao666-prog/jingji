import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowDown, ArrowUp, Download, Plus, Save } from 'lucide-react';
import { testTemplateHeaders, type TestTemplateGroupInput, type TestTemplateMetric, type TestTemplateMetricInput, type TestTemplatePreview } from '../../shared/test-template';
import { api } from '../api';
import type { Project } from '../types';
import { TemplatePreviewColumns, TemplatePreviewDialog } from './TemplatePreviewDialog';

const emptyMetric: TestTemplateMetricInput = {
  label: '', unit: '', protocol: '', valueKind: 'number', direction: 'neutral',
};

export function TestTemplatePanel({ project, team, onClose }: {
  project: Project;
  team: string;
  onClose: () => void;
}) {
  const [preview, setPreview] = useState<TestTemplatePreview | null>(null);
  const [codes, setCodes] = useState<string[]>([]);
  const [projectMode, setProjectMode] = useState(false);
  const [query, setQuery] = useState('');
  const [candidate, setCandidate] = useState('');
  const addButton = useRef<HTMLButtonElement>(null);
  const newGroupButton = useRef<HTMLButtonElement>(null);
  const groupNameInput = useRef<HTMLInputElement>(null);
  const [adding, setAdding] = useState(false);
  const [groupDraft, setGroupDraft] = useState<{
    name: string; protocol: string; fields: Array<TestTemplateGroupInput['fields'][number] & { id: number }>;
  } | null>(null);
  const nextFieldId = useRef(0);
  const [editor, setEditor] = useState<{ mode: 'create' | 'rename' | 'version'; metric?: TestTemplateMetric } | null>(null);
  const [draft, setDraft] = useState<TestTemplateMetricInput>(emptyMetric);
  const [pending, setPending] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [retry, setRetry] = useState(0);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    void api.testTemplatePreview(project, team, controller.signal).then(result => {
      if (controller.signal.aborted) return;
      setPreview(result);
      setCodes(result.codes);
      setLoaded(true);
    }).catch(cause => {
      if (controller.signal.aborted) return;
      setError(cause instanceof Error ? cause.message : '模板预览加载失败。');
      setLoaded(true);
    });
    return () => controller.abort();
  }, [project, retry, team]);

  const search = query.trim().toLowerCase();
  const matchesSearch = (...values: string[]) => values.join(' ').toLowerCase().includes(search);
  const catalog = new Map(preview?.catalog.map(metric => [metric.code, metric]));
  const options = preview?.catalog.filter(metric =>
    !codes.includes(metric.code) && matchesSearch(metric.label, metric.protocol, metric.unit),
  ) ?? [];
  const groups = preview?.groups.filter(group =>
    group.codes.some(code => !codes.includes(code)) &&
    matchesSearch(group.name, ...group.codes.flatMap(code => {
      const metric = catalog.get(code);
      return metric ? [metric.label, metric.protocol] : [];
    })),
  ) ?? [];
  const selectedGroup = groups.find(group => candidate === `group:${group.name}`);
  const selectedOption = options.find(metric => candidate === metric.code);
  const selected = codes.flatMap(code => catalog.get(code) ?? []);

  async function run(operation: () => Promise<void>) {
    setPending(true);
    setError('');
    setStatus('');
    try {
      await operation();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '操作失败，请重试。');
    } finally {
      setPending(false);
    }
  }

  function move(index: number, change: number) {
    const next = [...codes];
    [next[index], next[index + change]] = [next[index + change], next[index]];
    setCodes(next);
  }

  function openEditor(mode: 'create' | 'rename' | 'version', metric?: TestTemplateMetric) {
    setGroupDraft(null);
    setEditor({ mode, metric });
    const { label, unit, protocol, valueKind, direction } = metric ?? emptyMetric;
    setDraft({ label, unit, protocol, valueKind, direction });
  }

  function saveMetric(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editor) return;
    void run(async () => {
      const result = editor.mode === 'rename' && editor.metric
        ? await api.renameTestTemplateMetric(project, team, editor.metric.code, draft.label)
        : await api.createTestTemplateMetric(project, team, {
            ...draft, ...(editor.mode === 'version' ? { previousCode: editor.metric?.code } : {}),
          });
      setPreview(current => current && {
        ...current,
        catalog: [...current.catalog.filter(metric => metric.code !== result.metric.code), result.metric]
          .sort((a, b) => a.label.localeCompare(b.label, 'zh-CN')),
      });
      if (editor.mode === 'version')
        setCodes(current => editor.metric && current.includes(editor.metric.code)
          ? current.map(code => code === editor.metric?.code ? result.metric.code : code)
          : [...current, result.metric.code]);
      else if (editor.mode === 'create') setCodes(current => [...current, result.metric.code]);
      setEditor(null);
      setStatus(editor.mode === 'rename' ? '指标名称已更新。' : '指标已保存并加入当前预览。');
    });
  }

  function finishAdding() {
    setCandidate('');
    setGroupDraft(null);
    setAdding(false);
    setEditor(current => current?.mode === 'create' ? null : current);
    requestAnimationFrame(() => addButton.current?.focus());
  }

  function saveGroup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!groupDraft) return;
    void run(async () => {
      const { name, protocol, fields } = groupDraft;
      const { group, metrics } = await api.createTestTemplateGroup(project, team, {
        name, protocol, fields: fields.map(({ label, unit }) => ({ label, unit })),
      });
      const added = new Set(metrics.map(metric => metric.code));
      setPreview(current => current && {
        ...current,
        catalog: [...current.catalog.filter(metric => !added.has(metric.code)), ...metrics]
          .sort((a, b) => a.label.localeCompare(b.label, 'zh-CN')),
        groups: [...current.groups, group],
      });
      setCodes(current => [...new Set([...current, ...group.codes])]);
      finishAdding();
      setStatus(`「${group.name}」已保存并加入模板。`);
    });
  }

  function setGroupField(id: number, key: 'label' | 'unit', value: string) {
    setGroupDraft(current => current && {
      ...current, fields: current.fields.map(field => field.id === id ? { ...field, [key]: value } : field),
    });
  }

  function configure(action: 'project' | 'inherit') {
    void run(async () => {
      const config = await api.saveTestTemplateConfig(project, team,
        action === 'project' ? { action, codes } : { action });
      setPreview(current => current && { ...current, ...config });
      setCodes(action === 'project' ? config.projectCodes : config.codes);
      setStatus(action === 'project' ? '项目默认组合已保存。' : '本队已恢复项目默认组合。');
    });
  }

  function download(saveTeam: boolean) {
    void run(async () => {
      await api.downloadTestTemplate(project, team, codes, saveTeam);
      if (saveTeam) setPreview(current => current && { ...current, source: 'team', codes });
      setStatus(saveTeam ? '本队模板已保存，下载已开始。' : '本次模板已开始下载。');
    });
  }

  return (
    <TemplatePreviewDialog title="测试成绩模板预览" busy={pending} onClose={onClose}>
      <div role="status">{status || (!loaded ? '正在加载测试指标…' : '')}</div>
      {error && <p role="alert">{error}</p>}
      {loaded && !preview && <button type="button" className="secondary-button" onClick={() => {
        setLoaded(false);
        setError('');
        setRetry(value => value + 1);
      }}>重试</button>}
      {preview && <>
        <p>{team} · 预填 {preview.athleteCount} 名运动员 · {projectMode ? '编辑项目默认组合' : preview.source === 'team' ? '队伍自定义组合' : '继承项目默认组合'}</p>
        <div className="test-template-actions">
          {preview.canManageProject && <button type="button" className="secondary-button" disabled={pending} onClick={() => {
            setProjectMode(!projectMode);
            setCodes(projectMode ? preview.codes : preview.projectCodes);
            setEditor(null);
            setGroupDraft(null);
            setStatus('');
          }}>{projectMode ? '返回队伍模板' : '编辑项目默认'}</button>}
          {!projectMode && preview.source === 'team' && <button type="button" className="secondary-button" disabled={pending} onClick={() => configure('inherit')}>恢复项目默认</button>}
        </div>
        <TemplatePreviewColumns headers={testTemplateHeaders(selected)} />
        {!codes.length && <p>添加本次要测的项目，系统会生成填写列。</p>}
        <ol className="test-template-columns">
          {selected.map((metric, index) => (
            <li key={metric.code}>
              <div><strong>{metric.label}{metric.unit && `（${metric.unit}）`}</strong>
                <div>协议 {metric.protocol || '未登记'}{metric.protocolVersion && ` · 版本 ${metric.protocolVersion}`}</div>
              </div>
              <div className="test-template-actions">
                <button type="button" className="secondary-button" aria-label={`上移${metric.label}`} disabled={pending || index === 0} onClick={() => move(index, -1)}><ArrowUp size={16} aria-hidden /></button>
                <button type="button" className="secondary-button" aria-label={`下移${metric.label}`} disabled={pending || index === codes.length - 1} onClick={() => move(index, 1)}><ArrowDown size={16} aria-hidden /></button>
                {metric.editable &&
                  <button type="button" className="secondary-button" disabled={pending} aria-label={`修改${metric.label}名称`} onClick={() => openEditor('rename', metric)}>改名</button>}
                <button type="button" className="secondary-button" disabled={pending} aria-label={`为${metric.label}建新版本`} onClick={() => openEditor('version', metric)}>建新版本</button>
                <button type="button" className="secondary-button" disabled={pending} aria-label={`移除${metric.label}`} onClick={() => setCodes(current => current.filter(code => code !== metric.code))}>移除</button>
              </div>
            </li>
          ))}
        </ol>
        <div>
          <button ref={addButton} type="button" className="secondary-button" disabled={pending}
            aria-expanded={adding} onClick={() => adding ? finishAdding() : setAdding(true)}>
            <Plus size={16} aria-hidden />添加测试项目
          </button>
        </div>
        {adding && !groupDraft && <div className="test-template-actions">
          <label className="data-import-template-team">搜索项目或指标
            <input type="search" autoFocus disabled={pending} value={query} onChange={event => {
              setQuery(event.target.value);
              setCandidate('');
            }} />
          </label>
          <label className="data-import-template-team">项目或指标
            <select value={candidate} onChange={event => setCandidate(event.target.value)} disabled={pending}>
              <option value="">请选择</option>
              {groups.length > 0 && <optgroup label="测试项目">
                {groups.map(group => <option key={group.name} value={`group:${group.name}`}>{group.name}（{group.codes.length}项）</option>)}
              </optgroup>}
              {options.length > 0 && <optgroup label="单项指标">
                {options.map(metric => <option key={metric.code} value={metric.code}>{metric.label}{metric.unit && `（${metric.unit}）`}{metric.protocol && ` · ${metric.protocol}`}</option>)}
              </optgroup>}
            </select>
          </label>
          <button type="button" className="primary-button" disabled={pending || (!selectedGroup && !selectedOption)} onClick={() => {
            const chosen = selectedGroup?.codes ?? (selectedOption ? [selectedOption.code] : []);
            setCodes(current => [...new Set([...current, ...chosen])]);
            setStatus(`「${selectedGroup?.name || selectedOption?.label}」已加入模板。`);
            finishAdding();
          }}><Plus size={16} aria-hidden />加入模板</button>
          <button ref={newGroupButton} type="button" className="secondary-button" disabled={pending} onClick={() => {
            setEditor(null);
            setGroupDraft({ name: '', protocol: '', fields: [{ id: nextFieldId.current++, label: '', unit: '' }] });
          }}>新建测试项目</button>
          <details>
            <summary>高级设置</summary>
            <button type="button" className="secondary-button" disabled={pending} onClick={() => openEditor('create')}>新建单项指标</button>
          </details>
        </div>}
        {groupDraft && <form className="test-template-editor" onSubmit={saveGroup}>
          <fieldset disabled={pending}>
            <legend>新建测试项目</legend>
            <div className="test-template-group-fields">
              <label className="data-import-template-team">项目名称
                <input ref={groupNameInput} autoFocus required maxLength={40} placeholder="例如：抓举" value={groupDraft.name}
                  onChange={event => setGroupDraft({ ...groupDraft, name: event.target.value })} />
              </label>
              {groupDraft.fields.map((field, index) => (
                <div key={field.id} className="test-template-actions">
                  <label className="data-import-template-team">字段名称
                    <input required maxLength={40} placeholder={index === 0 ? '例如：重量' : undefined}
                      value={field.label} onChange={event => setGroupField(field.id, 'label', event.target.value)} />
                  </label>
                  <label className="data-import-template-team">单位（选填）
                    <input maxLength={24} placeholder={index === 0 ? '例如：kg' : undefined}
                      value={field.unit} onChange={event => setGroupField(field.id, 'unit', event.target.value)} />
                  </label>
                  {groupDraft.fields.length > 1 && <button type="button" className="secondary-button" aria-label={`删除第 ${index + 1} 项字段`}
                    onClick={() => {
                      setGroupDraft({ ...groupDraft, fields: groupDraft.fields.filter(entry => entry.id !== field.id) });
                      groupNameInput.current?.focus();
                    }}>删除</button>}
                </div>
              ))}
              <div>
                <button type="button" className="secondary-button" disabled={groupDraft.fields.length >= 100}
                  onClick={() => setGroupDraft({ ...groupDraft, fields: [...groupDraft.fields, { id: nextFieldId.current++, label: '', unit: '' }] })}>
                  <Plus size={16} aria-hidden />再加一项
                </button>
              </div>
              <details>
                <summary>测试协议（选填）</summary>
                <label className="data-import-template-team">测试协议
                  <input maxLength={160} value={groupDraft.protocol}
                    onChange={event => setGroupDraft({ ...groupDraft, protocol: event.target.value })} />
                </label>
              </details>
              <div className="test-template-actions">
                <button type="submit" className="primary-button"><Save size={16} aria-hidden />保存并加入模板</button>
                <button type="button" className="secondary-button" onClick={() => {
                  setGroupDraft(null);
                  requestAnimationFrame(() => newGroupButton.current?.focus());
                }}>取消</button>
              </div>
            </div>
          </fieldset>
        </form>}
        {editor && <form className="test-template-editor" onSubmit={saveMetric}>
          <fieldset disabled={pending}>
            <legend>{editor.mode === 'rename' ? '修改指标名称' : editor.mode === 'version' ? '新建指标版本' : '新建单项指标'}</legend>
            <div className="test-template-actions">
              <label className="data-import-template-team">指标名称<input autoFocus required maxLength={80} value={draft.label} onChange={event => setDraft({ ...draft, label: event.target.value })} /></label>
              {editor.mode !== 'rename' && <>
                <label className="data-import-template-team">成绩格式<select value={draft.valueKind} onChange={event => {
                  const valueKind = event.target.value === 'time' ? 'time' : 'number';
                  setDraft({ ...draft, valueKind, unit: valueKind === 'time' ? 's' : draft.unit });
                }}><option value="number">数值</option><option value="time">计时</option></select></label>
                <label className="data-import-template-team">单位<input maxLength={24} readOnly={draft.valueKind === 'time'} value={draft.unit} onChange={event => setDraft({ ...draft, unit: event.target.value })} /></label>
                <label className="data-import-template-team">成绩方向<select value={draft.direction} onChange={event => {
                  const direction = event.target.value;
                  if (direction === 'higher_better' || direction === 'lower_better' || direction === 'neutral') setDraft({ ...draft, direction });
                }}><option value="neutral">不评价</option><option value="higher_better">越大越好</option><option value="lower_better">越小越好</option></select></label>
                <label className="data-import-template-team test-template-protocol">测试协议（选填）<input maxLength={160} value={draft.protocol} onChange={event => setDraft({ ...draft, protocol: event.target.value })} /></label>
              </>}
              <button type="submit" className="primary-button"><Save size={16} aria-hidden />保存指标</button>
              <button type="button" className="secondary-button" onClick={() => setEditor(null)}>取消</button>
            </div>
          </fieldset>
        </form>}
        <footer className="test-template-actions">
          {projectMode ? <button type="button" className="primary-button" disabled={pending || !codes.length} onClick={() => configure('project')}><Save size={16} aria-hidden />保存项目默认</button> : <>
            <button type="button" className="secondary-button" disabled={pending || !codes.length} onClick={() => download(false)}><Download size={16} aria-hidden />仅下载本次模板</button>
            <button type="button" className="primary-button" disabled={pending || !codes.length} onClick={() => download(true)}><Download size={16} aria-hidden />保存为本队模板并下载</button>
          </>}
        </footer>
      </>}
    </TemplatePreviewDialog>
  );
}
