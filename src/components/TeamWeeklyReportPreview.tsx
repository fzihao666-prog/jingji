import type { TeamWeeklyReport } from '../../shared/team-weekly-report';
import { teamWeeklySections } from '../../shared/team-weekly-sections';
import '../pages/ReportsPage.css';
type Props = { report: TeamWeeklyReport };
export function TeamWeeklyReportPreview({ report }: Props) {
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
