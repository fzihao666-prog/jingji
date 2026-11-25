import { useEffect, useState } from 'react';
import { api } from '../api';
import { normalizeProject, projectLabel } from '../../shared/projects';

type Facts = Awaited<ReturnType<typeof api.pendingProjectFacts>>;
export function ProjectFactVerification({
  athleteId,
  project,
  onChanged,
}: {
  athleteId: number;
  project: string;
  onChanged: () => void;
}) {
  const [facts, setFacts] = useState<Facts | null>(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    setFacts(null);
    setError('');
    api
      .pendingProjectFacts(athleteId)
      .then((data) => {
        if (active) setFacts(data);
      })
      .catch((cause) => {
        if (active) setError(cause instanceof Error ? cause.message : '待核实记录加载失败。');
      });
    return () => {
      active = false;
    };
  }, [athleteId, revision]);
  async function verify(kind: 'training-sessions' | 'test-sessions', id: number) {
    setSaving(true);
    setError('');
    try {
      const target = normalizeProject(project);
      if (!target) throw new Error('项目无效，请核对档案。');
      await api.verifyFactProject(kind, id, target);
      setRevision((value) => value + 1);
      onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '核实失败。');
    } finally {
      setSaving(false);
    }
  }
  const rows = [
    ...(facts?.training || []).map((row) => ({
      ...row,
      kind: 'training-sessions' as const,
      label: '训练课次',
    })),
    ...(facts?.tests || []).map((row) => ({
      ...row,
      kind: 'test-sessions' as const,
      label: '测试会话',
    })),
  ];
  return (
    <section aria-label="历史项目归属核实">
      <h4>待核实的历史记录</h4>
      <p>请依据原始记录确认发生时项目；核实只改变项目归属，不推断测试协议或补写测量。</p>
      {error && (
        <p role="alert">
          {error}
          <button type="button" onClick={() => setRevision((value) => value + 1)}>
            重试
          </button>
        </p>
      )}
      {!facts && !error && <p role="status">正在读取待核实记录…</p>}
      {facts && !rows.length && <p>没有待核实记录。</p>}
      <ul>
        {rows.map((row) => (
          <li key={`${row.kind}:${row.id}`}>
            {row.date} · {row.label} · {row.content || '未填写内容'}{' '}
            <button type="button" disabled={saving} onClick={() => verify(row.kind, row.id)}>
              确认归属{projectLabel(project)}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
