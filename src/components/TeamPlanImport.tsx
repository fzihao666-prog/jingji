import { useRef, useState } from 'react';
import { Download, Upload } from 'lucide-react';
import { api } from '../api';
import type { Project, ProjectTeam } from '../types';

export function TeamPlanImport({
  project,
  team,
  disabled,
}: {
  project: Project;
  team?: ProjectTeam;
  disabled: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<'upload' | 'download'>();
  const [error, setError] = useState('');
  const [receipt, setReceipt] = useState<Awaited<ReturnType<typeof api.importTeamPlanWorkbook>>>();

  async function download() {
    setPending('download');
    setError('');
    try {
      const url = URL.createObjectURL(await api.teamPlanTemplate());
      const link = document.createElement('a');
      link.href = url;
      link.download = '竞迹队伍训练计划模板.xlsx';
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : '模板下载失败。');
    } finally {
      setPending(undefined);
    }
  }

  async function upload(file: File) {
    if (!team || disabled || pending) return;
    setPending('upload');
    setError('');
    setReceipt(undefined);
    try {
      setReceipt(await api.importTeamPlanWorkbook(file, project, team.id));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : '队伍计划导入失败。');
    } finally {
      setPending(undefined);
    }
  }

  return (
    <div className="team-training-import" aria-busy={Boolean(pending)}>
      <div className="team-training-controls">
        {!team && <span>请先在页面顶部选择队伍</span>}
        <button
          type="button"
          className="primary-button"
          disabled={!team || disabled || Boolean(pending)}
          onClick={() => input.current?.click()}
        >
          <Upload size={16} aria-hidden="true" />
          {pending === 'upload' ? '正在导入…' : '上传 Excel 为草稿'}
        </button>
        <button
          type="button"
          className="secondary-button"
          disabled={Boolean(pending)}
          onClick={() => void download()}
        >
          <Download size={16} aria-hidden="true" />
          {pending === 'download' ? '正在下载…' : '下载模板'}
        </button>
        <input
          type="file"
          accept=".xlsx"
          hidden
          ref={input}
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (file) void upload(file);
          }}
        />
      </div>
      {error && <p role="alert">{error}</p>}
      <div role="status">
        {receipt && (
          <>
            <p>
              已导入 {receipt.drafts.length} 份草稿。
              {receipt.skipped ? `已跳过 ${receipt.skipped} 份相同计划。` : ''}
              可在「训练计划」查看。
            </p>
            {receipt.drafts.length > 0 && (
              <ul>
                {receipt.drafts.map((draft) => (
                  <li key={draft.id}>
                    {draft.title} · {draft.sessions} 节训练课
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </div>
  );
}
