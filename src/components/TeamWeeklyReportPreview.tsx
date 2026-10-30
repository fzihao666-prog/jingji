import { weeklyReportMetadata } from '../../shared/team-weekly-sections';
import type { TeamWeeklyCommentary } from '../../shared/team-weekly-ai';
import type { TeamWeeklyReport } from '../../shared/team-weekly-report';
import { teamWeeklySections } from '../../shared/team-weekly-sections';
import {
  teamWeeklyCharts,
  weeklyTimetable,
  type WeeklyChart,
} from '../../shared/team-weekly-charts';
import { weeklyNumber } from '../../shared/team-weekly-sections';
import '../pages/ReportsPage.css';
type Props = {
  report: TeamWeeklyReport;
  commentary?: TeamWeeklyCommentary;
  commentaryErrorId?: string;
  onCommentaryChange?: (value: TeamWeeklyCommentary) => void;
};
export function TeamWeeklyReportPreview({
  report,
  commentary,
  onCommentaryChange,
  commentaryErrorId,
}: Props) {
  const charts = teamWeeklyCharts(report);
  return (
    <article className="reports-preview" aria-label="周总结预览">
      <h2>
        {report.teamName} ·{' '}
        {report.reportType === 'special' ? '专项' : report.reportType === 'physical' ? '体能' : ''}
        训练周总结
      </h2>
      {report.templateVersion === 'weekly-v3' && (
        <dl className="reports-metadata">
          {weeklyReportMetadata(report).map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      )}
      {report.stage && report.templateVersion !== 'weekly-v3' && <p>{report.stage}</p>}
      <p>
        {report.range.from} 至 {report.range.to} · 当前权限范围内 {report.athletes.length} 名队员
      </p>
      <div className="reports-kpis" aria-label="本周核心数据">
        {[
          ['队伍课次', report.totals.sessions, '次'],
          ['个人累计时长', report.totals.duration, '分钟'],
          ['记录平均RPE', report.totals.rpe, ''],
        ].map(([label, value, unit]) => (
          <p key={String(label)}>
            <span>{label}</span>
            <strong>{weeklyNumber(value as number | null)}</strong> {unit}
          </p>
        ))}
      </div>
      {teamWeeklySections(report).map((section) => (
        <section key={section.title}>
          <h3>{section.title}</h3>
          {(() => {
            const keys: (keyof TeamWeeklyCommentary)[] = section.commentaryKey
              ? [section.commentaryKey]
              : (
                  {
                    '一、本周训练摘要': ['summary'],
                    每日训练与负荷: ['training'],
                    力量训练个人与动作对比: ['strength'],
                    每日恢复趋势: ['recovery'],
                    '七、下周已发布安排': ['nextWeek'],
                    '三、专项分析': ['training'],
                    '四、体能分析': ['strength'],
                    '五、恢复与下周': ['recovery', 'nextWeek'],
                  } as Record<string, (keyof TeamWeeklyCommentary)[]>
                )[section.title] || [];
            if (!commentary) return null;
            return keys.map((key) => {
              const label =
                key === 'recovery' ? '恢复分析' : key === 'nextWeek' ? '下周安排' : section.title;
              return onCommentaryChange ? (
                <label className="reports-editor" key={key}>
                  {label}文案
                  <textarea
                    aria-invalid={Boolean(commentaryErrorId)}
                    aria-describedby={commentaryErrorId}
                    aria-label={`${label}文案`}
                    value={commentary[key]}
                    onChange={(event) =>
                      onCommentaryChange({ ...commentary, [key]: event.target.value })
                    }
                    maxLength={600}
                    rows={4}
                  />
                </label>
              ) : commentary[key] ? (
                <p key={key}>{commentary[key]}</p>
              ) : null;
            });
          })()}
          {section.paragraphs.map((p) => (
            <p key={p}>{p}</p>
          ))}
          <div className="reports-charts-grid">
            {charts
              .filter((c) => c.section === section.title)
              .map((chart) => (
                <ReportChart key={chart.id} chart={chart} />
              ))}
          </div>
          {report.plansAvailable &&
            (section.title === '七、下周已发布安排'
              ? report.nextPlans.length > 0
              : report.plans.length > 0) &&
            (section.title === '三、计划与实施' || section.title === '七、下周已发布安排') && (
              <div className="reports-timetable" aria-label="七天训练课表">
                {weeklyTimetable(report, section.title === '七、下周已发布安排').map((day) => (
                  <div key={day.date} className="reports-day">
                    <h4>
                      {day.day} <time dateTime={day.date}>{day.date.slice(5)}</time>
                    </h4>
                    {day.sessions.length ? (
                      day.sessions.map((session, index) => (
                        <p key={`${day.date}:${index}`}>
                          <strong>{session.period || '时段未记录'}</strong>
                          <br />
                          {session.content}
                          <br />
                          {weeklyNumber(session.duration)} 分钟 · {weeklyNumber(session.distance)}{' '}
                          km
                        </p>
                      ))
                    ) : (
                      <p>暂无已发布安排</p>
                    )}
                  </div>
                ))}
              </div>
            )}
          {section.headers && !!section.rows?.length && (
            <div
              className="reports-table-scroll"
              role="region"
              aria-label={section.title}
              tabIndex={0}
            >
              <table>
                <caption>{section.title}</caption>
                <thead>
                  <tr>
                    {section.headers.map((h) => (
                      <th scope="col" key={h}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {section.rows.map((row, i) => (
                    <tr key={i}>
                      {row.map((cell, j) => (
                        <td key={j}>{cell}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ))}
    </article>
  );
}

function ReportChart({ chart }: { chart: WeeklyChart }) {
  const series = chart.series?.length
    ? chart.series
    : [{ name: '本周', values: chart.points.map((p) => p.value) }];
  const values = series.flatMap((s) => s.values.flatMap((v) => (v === null ? [] : [v])));
  const min = chart.domain?.min ?? Math.min(0, ...values);
  const max = chart.domain?.max ?? Math.max(1, ...values);
  const scale = (v: number) => (v - min) / (max - min || 1);
  const rowHeights = chart.points.map((p) =>
    Math.max(36 * series.length + 12, Math.ceil(p.label.length / 10) * 14 + 12)
  );
  const rowTop = (i: number) => rowHeights.slice(0, i).reduce((sum, n) => sum + n, 0);
  const height =
    chart.kind === 'bar'
      ? Math.max(
          110,
          rowHeights.reduce((sum, n) => sum + n, 24)
        )
      : 250;
  const x = (i: number) => 45 + i * (510 / Math.max(1, chart.points.length - 1));
  const y = (v: number) => 165 - scale(v) * 125;
  return (
    <figure className="reports-chart">
      <figcaption>
        <strong>
          {chart.title}
          {chart.unit ? ` / ${chart.unit}` : ''}
        </strong>
        <p>{chart.note}</p>
      </figcaption>
      <p>
        {series
          .map(
            (s, i) =>
              `${s.name}：${chart.kind === 'bar' ? (i === 0 ? '实心条' : '虚线边框条') : i === 0 ? '实线 / 圆点' : '虚线 / 方点'}`
          )
          .join('；')}
      </p>
      {!values.length ? (
        <p className="reports-chart-empty">暂无有效数据</p>
      ) : (
        <svg
          viewBox={`0 0 720 ${height}`}
          role="img"
          aria-label={`${chart.title}，具体数值见下方数据表`}
        >
          {chart.kind === 'bar' ? (
            chart.points.map((p, i) => (
              <g key={`${p.label}:${i}`}>
                <text x="0" y={rowTop(i) + 24} fontSize="12">
                  {(p.label.match(/.{1,10}/gu) || ['']).map((line, j) => (
                    <tspan key={j} x="0" dy={j ? 14 : 0}>
                      {line}
                    </tspan>
                  ))}
                </text>
                {series.map((s, j) => {
                  const value = s.values[i] ?? null;
                  return (
                    <g key={s.name}>
                      {value !== null && (
                        <rect
                          x={140 + Math.min(scale(0), scale(value)) * 330}
                          y={rowTop(i) + 9 + j * 36}
                          width={Math.abs(scale(value) - scale(0)) * 330}
                          height="19"
                          rx="3"
                          fill={j === 0 ? 'var(--river)' : 'none'}
                          stroke="var(--river)"
                          strokeDasharray={j ? '4 2' : undefined}
                        />
                      )}
                      <text x="485" y={rowTop(i) + 24 + j * 36} fontSize="12">
                        {s.name} {weeklyNumber(value)}
                      </text>
                    </g>
                  );
                })}
              </g>
            ))
          ) : (
            <>
              <line x1="45" y1="165" x2="555" y2="165" stroke="currentColor" />
              {series.map((s, j) => (
                <g key={s.name}>
                  {s.values.map((v, i) =>
                    v === null ? null : (
                      <g key={i}>
                        {i > 0 && s.values[i - 1] !== null && (
                          <line
                            x1={x(i - 1)}
                            y1={y(s.values[i - 1]!)}
                            x2={x(i)}
                            y2={y(v)}
                            stroke="var(--river)"
                            strokeWidth="2"
                            strokeDasharray={j ? '5 3' : undefined}
                          />
                        )}
                        {j === 0 ? (
                          <circle cx={x(i)} cy={y(v)} r="4" fill="var(--river)" />
                        ) : (
                          <rect
                            x={x(i) - 4}
                            y={y(v) - 4}
                            width="8"
                            height="8"
                            fill="none"
                            stroke="var(--river)"
                          />
                        )}
                      </g>
                    )
                  )}
                </g>
              ))}
              {chart.points.map((p, i) => (
                <text key={`${p.label}:${i}`} x={x(i)} y="187" textAnchor="middle" fontSize="10">
                  {p.label.length > 5 ? p.label.slice(5) : p.label}
                </text>
              ))}
              <text x="8" y="169" fontSize="10">
                {weeklyNumber(min)}
              </text>
              <text x="8" y="40" fontSize="10">
                {weeklyNumber(max)}
              </text>
            </>
          )}
        </svg>
      )}
      <details>
        <summary>查看图表数据</summary>
        <div className="reports-table-scroll" role="region" aria-label={chart.title} tabIndex={0}>
          <table>
            <caption>{chart.title}</caption>
            <thead>
              <tr>
                <th scope="col">日期 / 队员 / 类型</th>
                {series.map((s) => (
                  <th scope="col" key={s.name}>
                    {s.name}
                    {chart.unit ? ` / ${chart.unit}` : ''}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {chart.points.map((p, i) => (
                <tr key={`${p.label}:${i}`}>
                  <th scope="row">{p.label}</th>
                  {series.map((s) => (
                    <td key={s.name}>{weeklyNumber(s.values[i] ?? null)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}
