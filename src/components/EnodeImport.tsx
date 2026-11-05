import { useEffect, useRef, useState } from 'react';
import { Upload } from 'lucide-react';
import { api } from '../api';
import type { Project } from '../types';
import {
  ENODE_KINDS,
  type EnodeImportResult,
  type EnodePreview,
  type EnodePersonDecision,
} from '../../shared/enode';
import './Enode.css';

export function EnodeImport({
  project,
  onChanged,
  onBusyChange,
  disabled = false,
  onView,
}: {
  project: Project;
  onChanged: () => void;
  onBusyChange: (busy: boolean) => void;
  disabled?: boolean;
  onView: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [results, setResults] = useState<EnodeImportResult[]>([]);
  const [preview, setPreview] = useState<EnodePreview>();
  const [choices, setChoices] = useState<Record<string, EnodePersonDecision>>({});
  const [team, setTeam] = useState('');
  const [summary, setSummary] = useState<{ linked: number; created: number; skipped: number }>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const pending = useRef(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (preview && !dialog.current?.open) dialog.current?.showModal();
  }, [preview]);

  function closePreview() {
    setPreview(undefined);
    setError('');
    trigger.current?.focus();
  }

  async function run(operation: () => Promise<void>) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    onBusyChange(true);
    setError('');
    try {
      await operation();
    } catch (e) {
      setError(e instanceof Error ? e.message : '操作失败，请重试。');
    } finally {
      pending.current = false;
      setBusy(false);
      onBusyChange(false);
    }
  }

  function prepare(selected: File[]) {
    if (!selected.length) return;
    if (selected.length > 12 || selected.some((file) => file.size > 12 * 1024 * 1024)) {
      setError('单文件限12MB，每次最多12个文件。');
      return;
    }
    void run(async () => {
      const next = await api.previewEnode(selected, project);
      setFiles(selected);
      setResults([]);
      setSummary(undefined);
      setTeam(next.teams.length === 1 ? next.teams[0] : '');
      setChoices(
        Object.fromEntries(
          next.people.flatMap((person) =>
            person.candidates.length === 1
              ? [[person.key, { action: 'link', athleteId: person.candidates[0].id }]]
              : []
          )
        )
      );
      setPreview(next);
    });
  }

  function choose(key: string, decision: EnodePersonDecision) {
    setChoices((current) => ({ ...current, [key]: decision }));
  }

  const unresolved =
    preview?.people.filter((person) => {
      const choice = choices[person.key];
      return !choice || (choice.action === 'create' && !choice.team);
    }).length ?? 0;

  function confirm() {
    void run(async () => {
      const response = await api.importEnode(files, project, choices);
      setResults(response.results);
      setSummary(response.summary);
      closePreview();
      if (response.summary.created || response.results.some((result) => result.inserted))
        onChanged();
    });
  }

  return (
    <section className="enode-import" aria-label="Enode VBT 导入" aria-busy={busy}>
      <div className="enode-actions">
        <button
          ref={trigger}
          type="button"
          className="primary-button"
          disabled={busy || disabled}
          onClick={() => input.current?.click()}
        >
          <Upload size={16} aria-hidden="true" />
          {busy ? '正在处理…' : 'Enode VBT'}
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
            prepare(selected);
          }}
        />
      </div>
      <p role="status">
        {busy ? '正在处理 Enode 文件…' : results.length ? '导入处理完成，结果如下。' : ''}
      </p>
      {error && !preview && <p role="alert">{error}</p>}
      {summary && (
        <p>
          已关联 {summary.linked} 人 · 新建 {summary.created} 人 · 本次跳过 {summary.skipped} 人
        </p>
      )}
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
      {preview && (
        <dialog
          ref={dialog}
          className="enode-people-dialog"
          aria-labelledby="enode-people-title"
          onCancel={(event) => {
            event.preventDefault();
            if (!busy) closePreview();
          }}
        >
          <h2 id="enode-people-title">确认运动员</h2>
          <p>共识别 {preview.people.length} 人。点击确认导入后，待建档人员与设备记录一起保存。</p>
          {preview.files
            .filter((file) => file.error)
            .map((file, index) => (
              <p key={index}>
                {file.filename} · {file.error}
              </p>
            ))}
          {preview.people.some((person) => !person.candidates.length) && (
            <div className="enode-filters">
              <label>
                <span>统一建档队伍</span>
                <select
                  value={team}
                  disabled={busy}
                  onChange={(event) => setTeam(event.target.value)}
                >
                  <option value="">选择队伍</option>
                  {preview.teams.map((name) => (
                    <option key={name}>{name}</option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                className="secondary-button"
                disabled={busy || !team}
                onClick={() => {
                  setChoices((current) => ({
                    ...current,
                    ...Object.fromEntries(
                      preview.people
                        .filter(
                          (person) =>
                            !person.candidates.length && current[person.key]?.action !== 'skip'
                        )
                        .map((person) => [person.key, { action: 'create', team }])
                    ),
                  }));
                }}
              >
                为未建档人员统一选队
              </button>
            </div>
          )}
          <div className="enode-table-wrap" tabIndex={0} role="region" aria-label="文件运动员名单">
            <table>
              <thead>
                <tr>
                  <th scope="col">运动员</th>
                  <th scope="col">文件记录</th>
                  <th scope="col">处理方式</th>
                </tr>
              </thead>
              <tbody>
                {preview.people.map((person) => {
                  const choice = choices[person.key];
                  return (
                    <tr key={person.key}>
                      <th scope="row">{person.name}</th>
                      <td>
                        {Object.entries(person.counts).map(([kind, count]) => (
                          <div key={kind}>
                            {ENODE_KINDS[kind as keyof typeof ENODE_KINDS]} {count} 条
                          </div>
                        ))}
                      </td>
                      <td>
                        {person.candidates.length > 0 ? (
                          <select
                            aria-label={`${person.name}关联档案`}
                            disabled={busy}
                            value={choice?.action === 'link' ? choice.athleteId : ''}
                            onChange={(event) => {
                              if (event.target.value)
                                choose(person.key, {
                                  action: 'link',
                                  athleteId: Number(event.target.value),
                                });
                            }}
                          >
                            <option value="" disabled>
                              选择已有档案
                            </option>
                            {person.candidates.map((candidate) => (
                              <option key={candidate.id} value={candidate.id}>
                                {candidate.name} · {candidate.team || '未分队'} · #{candidate.id}
                              </option>
                            ))}
                          </select>
                        ) : choice?.action === 'create' ? (
                          <label>
                            待建档 ·{' '}
                            <select
                              aria-label={`${person.name}所属队伍`}
                              value={choice.team}
                              disabled={busy}
                              onChange={(event) =>
                                choose(person.key, { action: 'create', team: event.target.value })
                              }
                            >
                              <option value="">选择所属队伍</option>
                              {preview.teams.map((name) => (
                                <option key={name}>{name}</option>
                              ))}
                            </select>
                          </label>
                        ) : (
                          <button
                            type="button"
                            className="secondary-button"
                            disabled={busy || !preview.teams.length}
                            onClick={() => choose(person.key, { action: 'create', team })}
                          >
                            新建运动员
                          </button>
                        )}
                        <button
                          type="button"
                          className="secondary-button"
                          disabled={busy || choice?.action === 'skip'}
                          onClick={() => choose(person.key, { action: 'skip' })}
                        >
                          {choice?.action === 'skip' ? '已跳过' : '本次跳过'}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {error && <p role="alert">{error}</p>}
          <div className="enode-actions">
            <span role="status">{unresolved ? `还有 ${unresolved} 人待处理` : ''}</span>
            <button
              type="button"
              className="secondary-button"
              disabled={busy}
              onClick={closePreview}
            >
              取消
            </button>
            <button
              type="button"
              className="primary-button"
              disabled={busy || unresolved > 0}
              onClick={confirm}
            >
              {busy ? '正在保存…' : '确认导入'}
            </button>
          </div>
        </dialog>
      )}
      {results.some((result) => result.inserted || result.skipped) && (
        <button type="button" className="secondary-button" onClick={onView} disabled={busy}>
          查看 Enode VBT 分析
        </button>
      )}
    </section>
  );
}
