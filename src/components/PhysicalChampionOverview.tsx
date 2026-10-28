import { useState, type FormEvent } from 'react';
import {
  Legend,
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ResponsiveContainer,
  Tooltip,
} from 'recharts';
import {
  physicalChampionValuesSchema,
  type PhysicalChampionPayload,
  type PhysicalChampionValuesInput,
} from '../../shared/physical-champion';

type Props = {
  group: PhysicalChampionPayload['groups'][number];
  canEdit: boolean;
  onSave: (values: PhysicalChampionValuesInput['values']) => Promise<void>;
};
const numberFormat = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 3 });
const format = (value: number | null | undefined) =>
  value == null ? '—' : numberFormat.format(value);

export function PhysicalChampionOverview({ group, canEdit, onSave }: Props) {
  const [editing, setEditing] = useState(false);
  const [values, setValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const columns =
    group.modelDimensions ??
    group.references.map((reference) => ({
      id: reference.id,
      revision: reference.revision,
      key: reference.key,
      label: reference.label,
      unit: reference.unit,
      value: reference.value,
      estimated: reference.sourceType === 'estimated',
    }));
  const rows = columns.map((reference) => ({
    reference,
    team: group.team.find((item) => item.key === reference.key),
  }));
  const radar = rows.map((row) => ({
    label: row.reference.label,
    champion: row.reference.value == null ? null : 100,
    team: row.team?.achievedPercent ?? null,
  }));
  const radarMax = Math.max(100, ...radar.map(point=>point.team??0));
  const estimated = columns.some((reference) => reference.estimated);
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canEdit || saving) return;
    const changed = columns
      .filter((ref) => {
        const raw = values[ref.key] ?? '';
        return ref.id === null ? raw.trim() !== '' : Number(raw) !== ref.value;
      })
      .map((ref) =>
        ref.id === null
          ? { key: ref.key, value: Number(values[ref.key]) }
          : { id: ref.id, expectedRevision: ref.revision, value: Number(values[ref.key]) }
      );
    if (!changed.length) {
      setEditing(false);
      return;
    }
    const parsed = physicalChampionValuesSchema.shape.values.safeParse(changed);
    if (!parsed.success) {
      setError('冠军值必须是大于0的有效数值。');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await onSave(parsed.data);
      setEditing(false);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : '保存失败，请重试。');
    } finally {
      setSaving(false);
    }
  }
  return (
    <>
      <form onSubmit={save}>
        <div
          className="physical-champion-table-wrap"
          role="region"
          aria-label="冠军模型和团队平均数值，可横向滚动"
          tabIndex={0}
        >
          <table className="physical-champion-table">
            <caption className="visually-hidden">
              冠军模型由教练维护，团队平均由系统根据同协议有效测试自动计算，缺测显示“—”。
            </caption>
            <thead>
              <tr>
                <th scope="col">模型</th>
                {rows.map(({ reference }) => (
                  <th key={reference.key} scope="col">
                    {reference.label}
                    <small>{reference.unit}</small>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr>
                <th scope="row">冠军模型</th>
                {rows.map(({ reference }) => (
                  <td key={reference.key}>
                    {editing ? (
                      <input
                        aria-label={`冠军模型 · ${reference.label}（${reference.unit}）`}
                        type="number"
                        step="any"
                        min="0"
                        required={reference.id !== null}
                        disabled={saving}
                        value={values[reference.key] ?? ''}
                        onChange={(event) =>
                          setValues((current) => ({
                            ...current,
                            [reference.key]: event.target.value,
                          }))
                        }
                      />
                    ) : (
                      format(reference.value)
                    )}
                  </td>
                ))}
              </tr>
              <tr>
                <th scope="row">团队平均</th>
                {rows.map(({ reference, team }) => (
                  <td key={reference.key}>{format(team?.value)}</td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
        {canEdit && (
          <div className="physical-champion-actions">
            {editing ? (
              <>
                <button type="submit" disabled={saving}>
                  {saving ? '保存中…' : '保存'}
                </button>
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => {
                    setEditing(false);
                    setError('');
                  }}
                >
                  取消
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={(event) => {
                  // 切换为提交按钮前取消本次点击的默认行为，避免立即提交并退出编辑。
                  event.preventDefault();
                  setValues(
                    Object.fromEntries(
                      columns.map((ref) => [ref.key, ref.value == null ? '' : String(ref.value)])
                    )
                  );
                  setError('');
                  setEditing(true);
                }}
              >
                修改冠军模型
              </button>
            )}
          </div>
        )}
        {error && (
          <p role="alert" className="physical-champion-note">
            {error}
          </p>
        )}
      </form>
      <div className="physical-champion-chart" aria-hidden="true">
        <ResponsiveContainer width="100%" height="100%">
          <RadarChart accessibilityLayer={false} data={radar} outerRadius="70%">
            <PolarGrid />
            <PolarAngleAxis dataKey="label" />
            <PolarRadiusAxis domain={[0, radarMax]} />
            <Tooltip />
            <Legend />
            <Radar
              name="冠军模型"
              dataKey="champion"
              stroke="var(--amber)"
              fill="var(--amber)"
              fillOpacity={0.08}
              strokeDasharray="5 3"
              isAnimationActive={false}
            />
            <Radar
              name="团队平均"
              dataKey="team"
              stroke="var(--river)"
              fill="var(--river)"
              fillOpacity={0.12}
              isAnimationActive={false}
            />
          </RadarChart>
        </ResponsiveContainer>
      </div>
      <p className="physical-champion-note">
        雷达图以冠军值为100%，团队平均自动计算。
        {columns.some((ref) => ref.value === null) && '未配置冠军值的指标暂不对比。'}
        {estimated && '估算参考，不参与正式评分。'}
      </p>
    </>
  );
}
