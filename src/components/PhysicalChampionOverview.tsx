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
  const [values, setValues] = useState<Record<number, string>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const rows = group.references.map((reference) => ({
    reference,
    team: group.team.find((item) => item.key === reference.key),
  }));
  const radar = rows.map((row) => ({
    label: row.reference.label,
    champion: 100,
    team: row.team?.achievedPercent ?? null,
  }));
  const estimated = rows.some((row) => row.reference.sourceType === 'estimated');
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canEdit || saving) return;
    const changed = group.references
      .filter((ref) => Number(values[ref.id]) !== ref.value)
      .map((ref) => ({
        id: ref.id,
        expectedRevision: ref.revision,
        value: Number(values[ref.id]),
      }));
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
                  <th key={reference.id} scope="col">
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
                  <td key={reference.id}>
                    {editing ? (
                      <input
                        aria-label={`冠军模型 · ${reference.label}（${reference.unit}）`}
                        type="number"
                        step="any"
                        min="0"
                        required
                        disabled={saving}
                        value={values[reference.id] ?? ''}
                        onChange={(event) =>
                          setValues((current) => ({
                            ...current,
                            [reference.id]: event.target.value,
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
                  <td key={reference.id}>{format(team?.value)}</td>
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
                onClick={() => {
                  setValues(
                    Object.fromEntries(group.references.map((ref) => [ref.id, String(ref.value)]))
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
            <PolarRadiusAxis domain={[0, 'auto']} />
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
        雷达图以冠军值为100%，团队平均自动计算。{estimated && '估算参考，不参与正式评分。'}
      </p>
    </>
  );
}
