import { useRef, useState } from 'react';
import { Download, Upload } from 'lucide-react';
import { api } from '../api';
import type { Project, ProjectTeam } from '../types';
import { projectCapability } from '../../shared/projects';
import type {
  TeamTrainingColumnMapping,
  TeamTrainingImportResult,
  TeamTrainingUnknownColumn,
} from '../../shared/team-training-stats';
import './TeamTrainingStats.css';

export function TeamTrainingImport({
  project,
  teamId,
  teams,
  disabled,
  onBusyChange,
  onView,
}: {
  project: Project;
  teamId: number | null;
  teams: ProjectTeam[];
  disabled: boolean;
  onBusyChange: (busy: boolean) => void;
  onView: (id: number, date: string | null) => void;
}) {
  const groupFields = [
    {
      key: 'lessonGroup',
      label: '主辅分组',
      choices: [
        ['main', '主课'],
        ['auxiliary', '辅课'],
      ],
    },
    ...(projectCapability(project)
      ? [
          {
            key: 'waterGroup',
            label: '水陆分组',
            choices: [
              ['water', '水上'],
              ['land', '陆上'],
            ],
          } as const,
        ]
      : []),
  ] as const;
  const [selectedTeam, setSelectedTeam] = useState<number | null>(null);
  const [pendingFile, setPendingFile] = useState<File>();
  const [columns, setColumns] = useState<TeamTrainingUnknownColumn[]>([]);
  const [mappings, setMappings] = useState<Record<string, TeamTrainingColumnMapping>>({});
  const [receipt, setReceipt] =
    useState<Extract<TeamTrainingImportResult, { status: 'imported' }>>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const targetId = teamId ?? selectedTeam ?? (teams.length === 1 ? teams[0].id : null);
  const team = teams.find((item) => item.id === targetId);
  const templateName = projectCapability(project)
    ? '竞迹队伍训练统计模板（水上）.xlsx'
    : '竞迹队伍训练统计模板（通用）.xlsx';

  async function upload(file: File, choices: Record<string, TeamTrainingColumnMapping> = {}) {
    if (!team || pending.current) return;
    pending.current = true;
    setError('');
    setBusy(true);
    onBusyChange(true);
    setReceipt(undefined);
    try {
      const result = await api.importTeamTrainingStats(file, project, team.id, choices);
      if (result.status === 'mapping_required') {
        setPendingFile(file);
        setColumns(result.columns);
        setMappings(
          Object.fromEntries(
            result.columns.map((column) => [
              column.key,
              {
                category:
                  column.category ??
                  (column.unit ? column.label.slice(0, -column.unit.length - 3) : column.label),
                unit: column.unit,
              },
            ])
          )
        );
      } else {
        setPendingFile(undefined);
        setColumns([]);
        setReceipt(result);
      }
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : '队伍训练数据导入失败。');
    } finally {
      pending.current = false;
      setBusy(false);
      onBusyChange(false);
    }
  }

  return (
    <div className="team-training-import" aria-busy={busy}>
      <div className="team-training-controls">
        {teamId === null ? (
          <label>
            <span>导入队伍</span>
            <select
              value={team?.id ?? ''}
              disabled={busy || disabled}
              onChange={(event) => {
                setSelectedTeam(Number(event.target.value) || null);
                setColumns([]);
                setPendingFile(undefined);
                setReceipt(undefined);
                setError('');
              }}
            >
              <option value="">请选择队伍</option>
              {teams.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.name}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <span>导入队伍：{team?.name ?? '当前队伍不可用'}</span>
        )}
        <button
          type="button"
          className="primary-button"
          disabled={busy || disabled || !team}
          onClick={() => fileInput.current?.click()}
        >
          <Upload size={16} aria-hidden="true" />
          {busy ? '正在导入…' : '上传队伍训练 Excel'}
        </button>
        <a
          className="secondary-button"
          href={`${import.meta.env.BASE_URL}templates/${encodeURIComponent(templateName)}`}
          download={templateName}
        >
          <Download size={16} aria-hidden="true" />
          下载模板
        </a>
        <input
          ref={fileInput}
          type="file"
          hidden
          accept=".xls,.xlsx"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (!file) return;
            setColumns([]);
            setPendingFile(undefined);
            void upload(file);
          }}
        />
      </div>
      {error && <p role="alert">{error}</p>}
      {!!columns.length && pendingFile && (
        <form
          className="team-training-mappings"
          onSubmit={(event) => {
            event.preventDefault();
            void upload(pendingFile, mappings);
          }}
        >
          <h3>匹配新列</h3>
          <p>填写分项名称和原单位。分组选填，保存后本队上传同名列会自动沿用。</p>
          {columns.map((column) => (
            <fieldset key={column.key} disabled={busy || disabled}>
              <legend>{column.label}</legend>
              <label>
                <span>分项名称</span>
                <input
                  required
                  maxLength={80}
                  value={mappings[column.key]?.category ?? ''}
                  onChange={(event) =>
                    setMappings((current) => ({
                      ...current,
                      [column.key]: { ...current[column.key], category: event.target.value },
                    }))
                  }
                />
              </label>
              <label>
                <span>单位</span>
                <input
                  required
                  maxLength={20}
                  readOnly={Boolean(column.unit)}
                  value={mappings[column.key]?.unit ?? ''}
                  onChange={(event) =>
                    setMappings((current) => ({
                      ...current,
                      [column.key]: { ...current[column.key], unit: event.target.value },
                    }))
                  }
                />
              </label>
              {groupFields.map(({ key, label, choices }) => (
                <label key={key}>
                  <span>{label}（选填）</span>
                  <select
                    value={mappings[column.key]?.[key] ?? ''}
                    onChange={(event) => {
                      const choice = choices.find(([value]) => value === event.target.value);
                      setMappings((current) => ({
                        ...current,
                        [column.key]: { ...current[column.key], [key]: choice?.[0] },
                      }));
                    }}
                  >
                    <option value="">自动判断</option>
                    {choices.map(([value, name]) => (
                      <option key={value} value={value}>
                        {name}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </fieldset>
          ))}
          <button type="submit" className="primary-button" disabled={busy || disabled}>
            保存映射并导入
          </button>
        </form>
      )}
      {receipt && team && (
        <div className="team-training-controls">
          <p role="status">
            新增 {receipt.created} 项，更新 {receipt.updated} 项，相同值 {receipt.unchanged}{' '}
            项。忽略 {receipt.undatedRows} 行无日期数据。
          </p>
          <button
            type="button"
            className="secondary-button"
            onClick={() => onView(team.id, receipt.latestDate)}
          >
            查看周训练数据看板
          </button>
        </div>
      )}
    </div>
  );
}
