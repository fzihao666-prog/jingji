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
import type { PhysicalChampionPayload } from '../../shared/physical-champion';

type Props = {
  group: PhysicalChampionPayload['groups'][number];
  athleteId: number | null;
  scopeName: string;
};
const numberFormat = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 3 });
const format = (value: number | null | undefined) =>
  value == null ? '—' : numberFormat.format(value);

export function PhysicalChampionOverview({ group, athleteId, scopeName }: Props) {
  const personal = group.athletes.find((item) => item.athleteId === athleteId);
  const rows = group.references.map((reference) => ({
    reference,
    team: group.team.find((item) => item.key === reference.key),
    personal: personal?.dimensions.find((item) => item.key === reference.key),
  }));
  const current = rows.map((row) => (athleteId ? row.personal : row.team));
  const coverage = current.filter((row) => row?.achievedPercent != null).length;
  const latest = group.trend
    .filter((item) => item.athleteId === (athleteId || null))
    .sort((a, b) => a.date.localeCompare(b.date))
    .at(-1);
  const score = athleteId ? personal?.score : latest?.score;
  const sampleCount = athleteId
    ? Number(coverage > 0)
    : group.athletes.filter((item) =>
        item.dimensions.some((dimension) => dimension.achievedPercent != null)
      ).length;
  const estimated = rows.some(
    (row) =>
      (athleteId ? row.personal : row.team)?.appliedReference?.sourceType === 'estimated' ||
      row.reference.sourceType === 'estimated'
  );
  const radar = rows.map((row) => ({
    label: row.reference.label,
    champion: 100,
    team: row.team?.achievedPercent ?? null,
    personal: row.personal?.achievedPercent ?? null,
  }));
  return (
    <>
      <dl className="physical-champion-summary">
        <div>
          <dt>展示性达成度</dt>
          <dd>
            {format(score)}
            {score != null && <small>%</small>}
          </dd>
        </div>
        <div>
          <dt>可比维度</dt>
          <dd>
            {coverage}
            <small> / {rows.length} 项</small>
          </dd>
        </div>
        <div>
          <dt>可比人数</dt>
          <dd>
            {sampleCount}
            <small> 人</small>
          </dd>
        </div>
      </dl>
      <p className="physical-champion-note">
        冠军参考为 100%；{estimated ? '含估算参考，不参与正式评分。' : '仅对比同协议有效测试。'}
        缺测显示“—”。
      </p>
      <div className="physical-champion-chart" aria-hidden="true">
        <ResponsiveContainer width="100%" height="100%">
          <RadarChart accessibilityLayer={false} data={radar} outerRadius="70%">
            <PolarGrid />
            <PolarAngleAxis dataKey="label" />
            <PolarRadiusAxis domain={[0, 'auto']} />
            <Tooltip />
            <Legend />
            <Radar
              name="冠军参考"
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
            {athleteId && (
              <Radar
                name={scopeName}
                dataKey="personal"
                stroke="var(--signal)"
                fill="var(--signal)"
                fillOpacity={0.1}
                isAnimationActive={false}
              />
            )}
          </RadarChart>
        </ResponsiveContainer>
      </div>
      {!coverage && (
        <p className="physical-champion-note" role="status">
          暂无同协议可比成绩，待采集。
        </p>
      )}
      <details className="physical-champion-data">
        <summary>查看指标数据</summary>
        <div
          className="physical-champion-table-wrap"
          role="region"
          aria-label="冠军模型指标数据，可横向滚动"
          tabIndex={0}
        >
          <table className="physical-champion-table">
            <caption>{scopeName}与冠军参考；缺测不补零。</caption>
            <thead>
              <tr>
                <th scope="col">指标</th>
                <th scope="col">当前值</th>
                <th scope="col">参考值</th>
                <th scope="col">达成度</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr key={row.reference.id}>
                  <th scope="row">
                    {row.reference.label}（{row.reference.unit}）
                  </th>
                  <td>{format(current[index]?.value)}</td>
                  <td>
                    {format(current[index]?.appliedReference?.value ?? row.reference.value)}
                    {row.reference.sourceType === 'estimated' && '（估算）'}
                  </td>
                  <td>
                    {format(current[index]?.achievedPercent)}
                    {current[index]?.achievedPercent != null && '%'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </>
  );
}
