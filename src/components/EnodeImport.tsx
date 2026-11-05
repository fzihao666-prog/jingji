import { useRef, useState } from 'react';
import { Upload, RotateCcw } from 'lucide-react';
import { api } from '../api';
import type { Athlete, Project } from '../types';
import { ENODE_KINDS, type EnodeImportResult } from '../../shared/enode';
import './Enode.css';

export function EnodeImport({
  project,
  athletes,
  onChanged,
  onBusyChange,
  disabled = false,
  onView,
}: {
  project: Project;
  athletes: Athlete[];
  onChanged: () => void;
  onBusyChange: (busy: boolean) => void;
  disabled?: boolean;
  onView: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [results, setResults] = useState<EnodeImportResult[]>([]);
  const [matches, setMatches] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const pending = useRef(false);
  const names = [...new Set(results.flatMap((result) => result.unresolvedNames))];
  async function upload(selected: File[], selectedMatches = matches) {
    if (!selected.length || pending.current) return;
    if (selected.length > 12 || selected.some((file) => file.size > 12 * 1024 * 1024)) {
      setError('单文件限12MB，每次最多12个文件。');
      return;
    }
    pending.current = true;
    setFiles(selected);
    setBusy(true);
    onBusyChange(true);
    setError('');
    setResults([]);
    try {
      const response = await api.importEnode(selected, project, selectedMatches);
      setResults(response.results);
      if (response.results.some((result) => result.inserted > 0)) onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : '导入失败，请重试；已入库数据不会重复新增。');
    } finally {
      pending.current = false;
      setBusy(false);
      onBusyChange(false);
    }
  }
  return (
    <section className="enode-import" aria-label="Enode VBT 导入" aria-busy={busy}>
      <div className="enode-actions">
        <button
          type="button"
          className="primary-button"
          disabled={busy || disabled}
          onClick={() => input.current?.click()}
        >
          <Upload size={16} aria-hidden="true" />
          {busy ? '正在自动导入…' : 'Enode VBT'}
        </button>
        <span>上传动作测量、Wellness 或 Session RPE 原始 CSV，可多选，无需修改文件名。</span>
        <input
          ref={input}
          type="file"
          multiple
          hidden
          onChange={(event) => {
            const selected = Array.from(event.target.files || []);
            event.target.value = '';
            setMatches({});
            void upload(selected, {});
          }}
        />
      </div>
      <p role="status">
        {busy
          ? '正在解析并保存，请等待完成；正常记录无需再次确认。'
          : results.length
            ? '导入处理完成，结果如下。'
            : ''}
      </p>
      {error && <p role="alert">{error}</p>}
      {results.map((result, index) => (
        <div key={index} className="enode-import-result">
          <strong>{result.filename}</strong>
          <p>
            {result.kind ? ENODE_KINDS[result.kind] : '未识别文件'}：新增 {result.inserted} ·
            重复跳过 {result.skipped} · 失败 {result.failed}
            {result.kind && !result.inserted && !result.skipped && !result.failed
              ? ' · 文件内无数据'
              : ''}
          </p>
          {result.issues.length > 0 && (
            <details>
              <summary>查看问题{result.failed > 100 ? '（展示前100项）' : ''}</summary>
              <ul>
                {result.issues.map((issue, i) => (
                  <li key={i}>
                    {issue.row ? `第${issue.row}行：` : ''}
                    {issue.message}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      ))}
      {names.length > 0 && (
        <div className="enode-filters">
          {names.map((name) => (
            <label key={name}>
              <span>文件中的“{name}”对应</span>
              <select
                value={matches[name] || ''}
                disabled={busy}
                onChange={(e) =>
                  setMatches((current) => ({ ...current, [name]: Number(e.target.value) }))
                }
              >
                <option value="">选择已有运动员</option>
                {athletes
                  .filter((a) => a.project === project)
                  .map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name} · {a.team}
                    </option>
                  ))}
              </select>
            </label>
          ))}
        </div>
      )}
      {(error || names.length > 0) && files.length > 0 && (
        <button
          type="button"
          className="secondary-button"
          disabled={busy || disabled || names.some((name) => !matches[name])}
          onClick={() => void upload(files)}
        >
          <RotateCcw size={16} aria-hidden="true" />
          重试导入（成功记录自动跳过）
        </button>
      )}
      {results.some((result) => result.inserted || result.skipped) && (
        <button type="button" className="secondary-button" onClick={onView} disabled={busy}>
          查看 Enode VBT 分析
        </button>
      )}
    </section>
  );
}
