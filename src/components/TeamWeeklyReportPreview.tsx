import type { TeamWeeklyReport } from '../../shared/team-weekly-report';
import { teamWeeklySections } from '../../shared/team-weekly-sections';
import {
  teamWeeklyCharts,
  weeklyTimetable,
  type WeeklyChart,
} from '../../shared/team-weekly-charts';
import { weeklyNumber } from '../../shared/team-weekly-sections';
import '../pages/ReportsPage.css';
type Props = { report: TeamWeeklyReport };
export function TeamWeeklyReportPreview({ report }: Props) {
  const charts = teamWeeklyCharts(report);
  return (
    <article className="reports-preview" aria-label="周总结预览">
      <h2>{report.teamName} · 训练周总结</h2>
      <p>
        {report.range.from} 至 {report.range.to} · 当前权限范围内 {report.athletes.length} 名队员
      </p>
      <p className="reports-note">预览为本次读取结果；下载时按最新数据生成。</p>
      {teamWeeklySections(report).map((section) => (
        <section key={section.title}>
          <h3>{section.title}</h3>
          {section.paragraphs.map((p) => (
            <p key={p}>{p}</p>
          ))}
          {charts
            .filter((c) => c.section === section.title)
            .map((chart) => (
              <ReportChart key={chart.id} chart={chart} />
            ))}
          {report.plansAvailable &&
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
  const values = chart.points.flatMap((p) => (p.value === null ? [] : [p.value]));
  const min = Math.min(0, ...values),
    max = Math.max(1, ...values);
  const scale = (v: number) => (v - min) / (max - min);
  const height = chart.kind === 'bar' ? Math.max(110, chart.points.length * 34 + 24) : 220;
  const x = (i: number) => 45 + i * (510 / Math.max(1, chart.points.length - 1));
  const y = (value: number) => 165 - scale(value) * 125;
  return (
    <figure className="reports-chart">
      <figcaption>
        <strong>
          {chart.title}
          {chart.unit ? ` / ${chart.unit}` : ''}
        </strong>
        <p>{chart.note}</p>
      </figcaption>
      {!values.length ? (
        <p className="reports-chart-empty">暂无有效数据</p>
      ) : (
        <svg
          viewBox={`0 0 620 ${height}`}
          role="img"
          aria-label={`${chart.title}，具体数值见下方数据表`}
        >
          {chart.kind === 'bar' ? (
            chart.points.map((p, i) => (
              <g key={`${p.label}:${i}`}>
                <text x="0" y={i * 34 + 24} fontSize="12">
                  {p.label.length > 11 ? `${p.label.slice(0, 10)}…` : p.label}
                </text>
                {p.value !== null && (
                  <rect
                    x="140"
                    y={i * 34 + 9}
                    width={scale(p.value) * 370}
                    height="19"
                    rx="3"
                    fill="var(--river)"
                  />
                )}
                <text x="525" y={i * 34 + 24} fontSize="12">
                  {weeklyNumber(p.value)}
                </text>
              </g>
            ))
          ) : (
            <>
              <line x1="45" y1="165" x2="555" y2="165" stroke="currentColor" />
              {chart.points.map((p, i) => (
                <g key={`${p.label}:${i}`}>
                  {p.value !== null && (
                    <>
                      {i > 0 && chart.points[i - 1].value !== null && (
                        <line
                          x1={x(i - 1)}
                          y1={y(chart.points[i - 1].value!)}
                          x2={x(i)}
                          y2={y(p.value)}
                          stroke="var(--river)"
                          strokeWidth="2"
                        />
                      )}
                      <circle cx={x(i)} cy={y(p.value)} r="4" fill="var(--river)" />
                      <text x={x(i)} y={y(p.value) - 10} textAnchor="middle" fontSize="11">
                        {weeklyNumber(p.value)}
                      </text>
                    </>
                  )}
                  <text x={x(i)} y="187" textAnchor="middle" fontSize="10">
                    {p.label.length > 5 ? p.label.slice(5) : p.label}
                  </text>
                </g>
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
                <th scope="col">数值{chart.unit ? ` / ${chart.unit}` : ''}</th>
              </tr>
            </thead>
            <tbody>
              {chart.points.map((p, i) => (
                <tr key={`${p.label}:${i}`}>
                  <th scope="row">{p.label}</th>
                  <td>{weeklyNumber(p.value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}
