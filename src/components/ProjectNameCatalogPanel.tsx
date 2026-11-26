import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { Pencil, Plus, Save } from 'lucide-react';
import type { ProjectNameCatalog, ProjectNameMapping } from '../../shared/project-name-catalog';
import { api } from '../api';
import { ProjectCatalogEditor } from './ProjectCatalogEditor';

const views = {
  trainingProjects: '训练项目',
  testProjects: '测试项目',
  mappings: '名称映射',
} as const;
type View = keyof typeof views;
type Draft = ProjectNameMapping & { previousSource?: string };
const kindLabel = { training: '训练项目', test: '测试项目' };

export function ProjectNameCatalogPanel({
  editable,
  revision,
}: {
  editable: boolean;
  revision: number;
}) {
  const title = useId();
  const searchRef = useRef<HTMLInputElement>(null);
  const targetRef = useRef<HTMLInputElement>(null);
  const [view, setView] = useState<View>('trainingProjects');
  const [search, setSearch] = useState('');
  const [retry, setRetry] = useState(0);
  const [catalog, setCatalog] = useState<ProjectNameCatalog>();
  const [loadError, setLoadError] = useState('');
  const [message, setMessage] = useState('');
  const [draft, setDraft] = useState<Draft>();
  const [editing, setEditing] = useState<ProjectNameCatalog['projects'][number]>();
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    api
      .projectNameCatalog(controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) {
          setCatalog(data);
          setLoadError('');
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setLoadError('目录读取失败，请重试。');
      });
    return () => controller.abort();
  }, [revision, retry]);
  const focusTarget = () => requestAnimationFrame(() => targetRef.current?.focus());
  const begin = (next: Draft) => {
    setDraft(next);
    setSaveError('');
    setMessage('');
    focusTarget();
  };
  const close = () => {
    setDraft(undefined);
    setEditing(undefined);
    setSaveError('');
    searchRef.current?.focus();
  };
  async function save(next: Draft) {
    if (saving || !editable) return;
    setSaving(true);
    setSaveError('');
    const { kind, source, target, previousSource } = next;
    try {
      await api.saveProjectNameMapping({
        kind,
        source: source.trim(),
        target: target.trim(),
        previousSource,
      });
      close();
      setMessage('名称映射已保存。');
      setRetry((count) => count + 1);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : '保存失败，请重试。');
    } finally {
      setSaving(false);
    }
  }
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (draft) void save(draft);
  };
  const term = search.trim().toLocaleLowerCase();
  const includes = (...values: string[]) =>
    values.some((value) => value.toLocaleLowerCase().includes(term));
  const kind = view.startsWith('training') ? 'training' : 'test';
  const projects =
    catalog?.projects.filter(
      (entry) =>
        entry.kind === kind &&
        includes(
          entry.name,
          ...entry.sources,
          ...catalog.mappings
            .filter((rule) => rule.kind === kind && rule.target === entry.name)
            .map((rule) => rule.source)
        )
    ) ?? [];
  const mappings =
    catalog?.mappings.filter((rule) => includes(kindLabel[rule.kind], rule.source, rule.target)) ??
    [];
  const showingMappings = view === 'mappings';
  const count = showingMappings ? mappings.length : projects.length;
  const columns = showingMappings
    ? ['项目类型', '原始名称', '标准名称']
    : ['项目名称', '来源', '记录数'];
  const showActions = editable;

  return (
    <section className="data-import-review" aria-labelledby={title}>
      <div className="data-import-review-head">
        <div>
          <h2 id={title}>训练与测试项目及指标</h2>
          <p>在项目内维护名称、指标、单位、协议与版本。名称映射可随时编辑。</p>
        </div>
        {editable && showingMappings && (
          <button
            type="button"
            className="primary-button"
            onClick={() => begin({ kind: 'training', source: '', target: '' })}
          >
            <Plus size={16} aria-hidden="true" />
            添加映射
          </button>
        )}
      </div>
      <div className="metric-dictionary-filters">
        <label className="data-import-date">
          <span>目录类别</span>
          <select
            value={view}
            onChange={(event) => {
              setView(event.target.value as View);
              setSearch('');
              setEditing(undefined);
              setDraft(undefined);
            }}
          >
            {Object.entries(views).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="data-import-date">
          <span>搜索{views[view]}</span>
          <input
            ref={searchRef}
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
      </div>
      {message && <p role="status">{message}</p>}
      {editing && catalog && (
        <ProjectCatalogEditor
          key={JSON.stringify([editing.kind, editing.name])}
          project={editing}
          catalog={catalog}
          onClose={close}
          onSaved={() => {
            close();
            setMessage('项目已保存。');
            setRetry((count) => count + 1);
          }}
        />
      )}
      {draft && (
        <form className="metric-dictionary-filters" onSubmit={submit} aria-label="编辑名称映射">
          {!draft.previousSource && (
            <label className="data-import-date">
              <span>项目类型</span>
              <select
                disabled={saving}
                value={draft.kind}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    kind: event.target.value === 'training' ? 'training' : 'test',
                  })
                }
              >
                <option value="training">训练项目</option>
                <option value="test">测试项目</option>
              </select>
            </label>
          )}
          <label className="data-import-date">
            <span>原始名称</span>
            <input
              disabled={saving}
              maxLength={120}
              required
              value={draft.source}
              onChange={(event) => setDraft({ ...draft, source: event.target.value })}
            />
          </label>
          <label className="data-import-date">
            <span>标准名称</span>
            <input
              ref={targetRef}
              disabled={saving}
              maxLength={120}
              required
              value={draft.target}
              aria-describedby={saveError ? `${title}-error` : undefined}
              onChange={(event) => setDraft({ ...draft, target: event.target.value })}
            />
          </label>
          <button
            type="submit"
            className="primary-button"
            disabled={saving || !draft.source.trim() || !draft.target.trim()}
          >
            <Save size={16} aria-hidden="true" />
            {saving ? '保存中…' : '保存'}
          </button>
          <button type="button" className="secondary-button" disabled={saving} onClick={close}>
            取消
          </button>
          {draft.previousSource && (
            <button
              type="button"
              className="secondary-button"
              disabled={saving}
              onClick={() => {
                const source = draft.previousSource;
                if (source) void save({ ...draft, source, target: source });
              }}
            >
              恢复原名
            </button>
          )}
          {saveError && (
            <p id={`${title}-error`} role="alert">
              {saveError}
            </p>
          )}
        </form>
      )}
      {loadError ? (
        <p role="alert">
          {loadError}{' '}
          <button
            type="button"
            className="secondary-button"
            onClick={() => setRetry((value) => value + 1)}
          >
            重试
          </button>
        </p>
      ) : !catalog ? (
        <p role="status">正在读取项目与指标…</p>
      ) : (
        <div className="data-import-table-wrap" role="region" aria-label={views[view]} tabIndex={0}>
          <table className="data-import-table">
            <caption>
              {views[view]} · {count} 项
            </caption>
            <thead>
              <tr>
                {columns.map((label) => (
                  <th key={label} scope="col">
                    {label}
                  </th>
                ))}
                {showActions && <th scope="col">操作</th>}
              </tr>
            </thead>
            <tbody>
              {showingMappings
                ? mappings.map((rule) => (
                    <tr key={JSON.stringify([rule.kind, rule.source])}>
                      <td>{kindLabel[rule.kind]}</td>
                      <td>{rule.source}</td>
                      <td>{rule.target}</td>
                      {showActions && (
                        <td>
                          <button
                            type="button"
                            className="secondary-button"
                            disabled={saving}
                            onClick={() => begin({ ...rule, previousSource: rule.source })}
                          >
                            编辑
                          </button>
                        </td>
                      )}
                    </tr>
                  ))
                : projects.map((entry) => (
                    <tr key={entry.name}>
                      <th scope="row">{entry.name}</th>
                      <td>{entry.sources.join('、')}</td>
                      <td>{entry.recordCount}</td>
                      {showActions && (
                        <td>
                          <button
                            type="button"
                            className="secondary-button"
                            disabled={saving}
                            aria-label={`编辑${entry.name}`}
                            onClick={() => {
                              setDraft(undefined);
                              setMessage('');
                              setEditing(entry);
                            }}
                          >
                            <Pencil size={16} aria-hidden="true" />
                            编辑
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
              {!count && (
                <tr>
                  <td colSpan={columns.length + Number(showActions)}>暂无匹配的{views[view]}。</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
