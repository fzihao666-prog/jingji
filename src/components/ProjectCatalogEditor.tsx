import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { Plus, Save } from 'lucide-react';
import type { ProjectCatalogField, ProjectNameCatalog } from '../../shared/project-name-catalog';
import { api } from '../api';

type Project = ProjectNameCatalog['projects'][number];
const emptyField = { source: '', name: '', unit: '', protocol: '', version: '' };

function suggestedFields(project: Project, catalog: ProjectNameCatalog): ProjectCatalogField[] {
  const saved = catalog.settings.find(
    (entry) => entry.kind === project.kind && entry.name === project.name
  );
  if (saved) return saved.fields;
  const matching = catalog.metrics.filter(
    (metric) => metric.kind === project.kind && metric.projectName === project.name
  );
  if (!matching.length) {
    const source = project.kind === 'training' ? '强度' : '成绩';
    return [{ ...emptyField, source, name: source }];
  }
  return [...new Set(matching.map((metric) => metric.name))].map((label) => {
    const metrics = matching.filter((metric) => metric.name === label);
    const common = (key: 'unit' | 'protocol' | 'version') => {
      const values = new Set(metrics.map((metric) => metric[key]));
      return values.size === 1 ? metrics[0][key] : '';
    };
    return {
      source: project.kind === 'test' && label === project.name ? '成绩' : label,
      name: label,
      unit: common('unit'),
      protocol: common('protocol'),
      version: common('version'),
    };
  });
}

export function ProjectCatalogEditor({
  project,
  catalog,
  onClose,
  onSaved,
}: {
  project: Project;
  catalog: ProjectNameCatalog;
  onClose: () => void;
  onSaved: () => void;
}) {
  const heading = useId();
  const nameRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(project.name);
  const [fields, setFields] = useState(() => suggestedFields(project, catalog));
  const [fieldsEdited, setFieldsEdited] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => nameRef.current?.focus(), []);
  const editField = (index: number, key: keyof ProjectCatalogField, value: string) => {
    setFieldsEdited(true);
    setFields((items) =>
      items.map((field, position) => (position === index ? { ...field, [key]: value } : field))
    );
  };
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setError('');
    try {
      await api.saveProjectCatalog({
        kind: project.kind,
        source: project.name,
        name,
        ...(fieldsEdited ? { fields } : {}),
      });
      onSaved();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : '项目保存失败，请重试。');
    } finally {
      setSaving(false);
    }
  }
  return (
    <form onSubmit={submit} aria-labelledby={heading} className="data-import-review">
      <div className="data-import-review-head">
        <div>
          <h3 id={heading}>编辑{project.kind === 'training' ? '训练' : '测试'}项目</h3>
          <p>
            {project.sources.join('、')} · {project.recordCount} 条记录
          </p>
        </div>
      </div>
      <label className="data-import-date">
        <span>项目名称</span>
        <input
          ref={nameRef}
          required
          maxLength={120}
          value={name}
          disabled={saving}
          onChange={(event) => setName(event.target.value)}
        />
      </label>
      <p>项目改名会统一历史显示。单位、协议和版本用于后续填报，已入库记录保留原口径。</p>
      {project.kind === 'training' && (
        <p>每日训练可按项目设置强度单位；时长、次数和组数沿用模板表头单位。</p>
      )}
      <div className="data-import-table-wrap" role="region" aria-label="项目字段配置" tabIndex={0}>
        <table className="data-import-table">
          <thead>
            <tr>
              {['填报字段', '显示名称', '单位', '协议', '版本', '操作'].map((label) => (
                <th key={label} scope="col">
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {fields.map((field, index) => (
              <tr key={index}>
                {(
                  [
                    ['source', '填报字段', 120],
                    ['name', '显示名称', 120],
                    ['unit', '单位', 24],
                    ['protocol', '协议', 160],
                    ['version', '版本', 9],
                  ] as const
                ).map(([key, label, maxLength]) => (
                  <td key={key}>
                    <input
                      value={field[key]}
                      aria-label={`第 ${index + 1} 项${label}`}
                      maxLength={maxLength}
                      disabled={saving}
                      required={key === 'source' || key === 'name'}
                      inputMode={key === 'version' ? 'numeric' : undefined}
                      pattern={key === 'version' ? '[1-9][0-9]{0,8}' : undefined}
                      onChange={(event) => editField(index, key, event.target.value)}
                    />
                  </td>
                ))}
                <td>
                  <button
                    type="button"
                    className="secondary-button"
                    disabled={saving}
                    aria-label={`移除第 ${index + 1} 项字段配置`}
                    onClick={() => {
                      setFieldsEdited(true);
                      setFields((items) => items.filter((_, position) => position !== index));
                    }}
                  >
                    移除
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="metric-dictionary-filters">
        <button
          type="button"
          className="secondary-button"
          disabled={saving}
          onClick={() => {
            setFieldsEdited(true);
            setFields((items) => [...items, { ...emptyField }]);
          }}
        >
          <Plus size={16} aria-hidden="true" />
          添加字段
        </button>
        <button type="submit" className="primary-button" disabled={saving || !name.trim()}>
          <Save size={16} aria-hidden="true" />
          {saving ? '保存中…' : '保存项目'}
        </button>
        <button type="button" className="secondary-button" disabled={saving} onClick={onClose}>
          取消
        </button>
      </div>
      {error && <p role="alert">{error}</p>}
    </form>
  );
}
