import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Download, Save } from 'lucide-react';
import { TEST_TEMPLATE_IDENTITY_HEADERS, testTemplateHeaders, testTemplateInputColumns, type TestTemplateMetric, type TestTemplateMetricInput, type TestTemplatePreview } from '../../shared/test-template';
import { api } from '../api';
import type { Project } from '../types';
import type { TrainingRecordTemplate } from '../../shared/training-record-template';
import { TemplateProjectPicker } from './TemplateProjectPicker';
import { TemplateProjectEditor } from './TemplateProjectEditor';
import { TemplatePreviewColumns, TemplateWorkspace } from './TemplatePreviewDialog';

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
  const [candidate, setCandidate] = useState('');
  const newGroupButton = useRef<HTMLButtonElement>(null);
  const groupForm = useRef<HTMLFormElement>(null);
  const [groupDraft, setGroupDraft] = useState<{
    name: string; protocol: string; fields: TrainingRecordTemplate['fields'];
  } | null>(null);
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

  const catalog = new Map(preview?.catalog.map(metric => [metric.code, metric]));
  const options = preview?.catalog.filter(metric => !codes.includes(metric.code)) ?? [];
  const groups = preview?.groups.filter(group => group.codes.some(code => !codes.includes(code))) ?? [];
  const projectOptions = groups.map(group => ({ value: `group:${group.name}`, label: group.name, common: group.common }));
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

  async function updateColumns(next: string[], message: string) {
    setCodes(next);
    if (!projectMode) {
      const config = await api.saveTestTemplateConfig(project, team, { action: 'team', codes: next });
      setPreview(current => current && { ...current, ...config });
      setCodes(config.codes);
    }
    setStatus(message);
  }

  function move(index: number, change: number) {
    const next = [...codes];
    [next[index], next[index + change]] = [next[index + change], next[index]];
    void run(() => updateColumns(next, 'Excel 列顺序已更新。'));
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
      setEditor(null);
      if (editor.mode === 'rename') {
        setStatus('指标名称已更新。');
        return;
      }
      const next = editor.mode === 'version' && editor.metric && codes.includes(editor.metric.code)
        ? codes.map(code => code === editor.metric?.code ? result.metric.code : code)
        : [...codes, result.metric.code];
      await updateColumns(next, '指标已添加到 Excel 列。');
    });
  }

  function saveGroup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!groupDraft) return;
    void run(async () => {
      const { name, protocol, fields } = groupDraft;
      const { group, metrics } = await api.createTestTemplateGroup(project, team, {
        name, protocol, fields: fields.map(({ name: label, unit, kind }) => ({ label, unit, valueKind: kind === 'time' ? 'time' : 'number' })),
      });
      const added = new Set(metrics.map(metric => metric.code));
      setPreview(current => current && {
        ...current,
        catalog: [...current.catalog.filter(metric => !added.has(metric.code)), ...metrics]
          .sort((a, b) => a.label.localeCompare(b.label, 'zh-CN')),
        groups: [...current.groups, group],
      });
      setGroupDraft({ name: '', protocol: '', fields: [] });
      await updateColumns([...new Set([...codes, ...group.codes])], `「${group.name}」已添加到 Excel 列。`);
      requestAnimationFrame(() => groupForm.current?.querySelector('input')?.focus());
    });
  }

  function configure(action: 'project' | 'team' | 'inherit') {
    void run(async () => {
      const config = await api.saveTestTemplateConfig(project, team,
        action === 'inherit' ? { action } : { action, codes });
      setPreview(current => current && { ...current, ...config });
      setCodes(action === 'project' ? config.projectCodes : config.codes);
      setStatus(action === 'project' ? '项目默认组合已保存。' : action === 'team' ? '测试模板已保存到本队。' : '本队已恢复项目默认组合。');
    });
  }

  const columnsChanged = Boolean(preview && (codes.length !== preview.codes.length || codes.some((code, index) => code !== preview.codes[index])));

  function download() {
    void run(async () => {
      await api.downloadTestTemplate(project, team);
      setStatus('测试模板已开始下载。');
    });
  }

  return (
    <TemplateWorkspace title="测试成绩模板预览" team={team} athleteCount={preview?.athleteCount} busy={pending} onClose={onClose}
      error={error} status={status || (!loaded ? '正在加载测试指标…' : '')}
      preview={preview && <TemplatePreviewColumns headers={testTemplateHeaders(selected)}
        fixedColumns={TEST_TEMPLATE_IDENTITY_HEADERS.length} columnGroups={testTemplateInputColumns(selected).map(column => column.metricIndex)} busy={pending} onMove={move}
        onRemove={index => void run(() => updateColumns(codes.filter((_, position) => position !== index), 'Excel 列已移除。'))} />}
      actions={preview && <>
          {projectMode ? <button type="button" className="primary-button" disabled={pending || !codes.length} onClick={() => configure('project')}><Save size={16} aria-hidden />保存项目默认</button> : <>
            <button type="button" className="primary-button" disabled={pending || columnsChanged || !codes.length} onClick={download}><Download size={16} aria-hidden />下载 Excel</button>
            {columnsChanged && <button type="button" className="secondary-button" disabled={pending} onClick={() => configure('team')}>重试保存</button>}
          </>}
      </>}>
      {loaded && !preview && <button type="button" className="secondary-button" onClick={() => {
        setLoaded(false);
        setError('');
        setRetry(value => value + 1);
      }}>重试</button>}
      {preview && <>
        {projectMode && <p>正在编辑运动项目的默认组合。</p>}
        <TemplateProjectPicker groups={[
          { label: '常用项目', options: projectOptions.filter(option => option.common) },
          { label: '已有项目', options: projectOptions.filter(option => !option.common) },
          { label: '单项指标', options: options.map(metric => ({
            value: metric.code, label: `${metric.label}${metric.unit ? `（${metric.unit}）` : ''}${metric.protocol ? ` · ${metric.protocol}` : ''}`,
          })) },
        ]} value={candidate} onChange={setCandidate} disabled={pending || Boolean(groupDraft || editor)}
          newLabel="新建测试项目" newButton={newGroupButton} onNew={() => {
            setGroupDraft({ name: '', protocol: '', fields: [] });
          }} onAdd={() => {
            const chosen = selectedGroup?.codes ?? (selectedOption ? [selectedOption.code] : []);
            setCandidate('');
            void run(() => updateColumns([...new Set([...codes, ...chosen])], '已添加到 Excel 列。'));
          }} />
        {groupDraft && <form ref={groupForm} className="test-template-editor" onSubmit={saveGroup}>
          <fieldset disabled={pending}>
            <legend>新建测试项目</legend>
            <div className="test-template-group-fields">
              <TemplateProjectEditor name={groupDraft.name} fields={groupDraft.fields} nameLimit={40} fieldLimit={100} autoFocus
                onName={name => setGroupDraft({ ...groupDraft, name })}
                onFields={fields => setGroupDraft({ ...groupDraft, fields })} />
              <details>
                <summary>测试协议（选填）</summary>
                <label className="data-import-template-team">测试协议
                  <input maxLength={160} value={groupDraft.protocol}
                    onChange={event => setGroupDraft({ ...groupDraft, protocol: event.target.value })} />
                </label>
              </details>
              <div className="test-template-actions">
                <button type="submit" className="primary-button" disabled={!groupDraft.fields.length}><Save size={16} aria-hidden />添加</button>
                <button type="button" className="secondary-button" onClick={() => {
                  setGroupDraft(null);
                  requestAnimationFrame(() => newGroupButton.current?.focus());
                }}>结束新建</button>
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
              <button type="submit" className="primary-button">{editor.mode === 'rename' ? '保存名称' : '添加'}</button>
              <button type="button" className="secondary-button" onClick={() => setEditor(null)}>取消</button>
            </div>
          </fieldset>
        </form>}
        {!codes.length && <p>添加本次要测的项目，系统会生成填写列。</p>}
        <details>
          <summary>模板设置</summary>
          <button type="button" className="secondary-button" disabled={pending || Boolean(groupDraft || editor)} onClick={() => openEditor('create')}>新建单项指标</button>
          <ol className="test-template-columns">
            {selected.map((metric) => (
              <li key={metric.code}>
                <div><strong>{metric.label}{metric.unit && `（${metric.unit}）`}</strong>
                  <div>协议 {metric.protocol || '未登记'}{metric.protocolVersion && ` · 版本 ${metric.protocolVersion}`}</div>
                </div>
                <div className="test-template-actions">
                  {metric.editable &&
                    <button type="button" className="secondary-button" disabled={pending} aria-label={`修改${metric.label}名称`} onClick={() => openEditor('rename', metric)}>改名</button>}
                  <button type="button" className="secondary-button" disabled={pending} aria-label={`为${metric.label}建新版本`} onClick={() => openEditor('version', metric)}>建新版本</button>
                </div>
              </li>
            ))}
          </ol>

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
        </details>
        {!projectMode && columnsChanged && <p>Excel 列尚未保存，重试保存后即可下载。</p>}

      </>}
    </TemplateWorkspace>
  );
}
