import { useEffect, useMemo, useState } from 'react';
import { Download } from 'lucide-react';
import { COACH_CATEGORIES } from '../../shared/coach-categories';
import { projectLabel, type Project } from '../../shared/projects';
import type { SubmissionReport } from '../../shared/submission-report';
import { api } from '../api';
import { PageContainer, PageHeader } from '../components/PageLayout';
import './SubmissionReportPage.css';

const count = new Intl.NumberFormat('zh-CN').format;
const pageSize = 50;

export default function SubmissionReportPage({ projects }: { projects: Project[] }) {
  const [report, setReport] = useState<SubmissionReport>();
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [project, setProject] = useState('');
  const [team, setTeam] = useState('');
  const [role, setRole] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [coachId, setCoachId] = useState<number>();
  const [detailTeam, setDetailTeam] = useState<number>();
  const [page, setPage] = useState(1);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState('');
  const valid = !from || !to || from <= to;

  useEffect(() => {
    const controller = new AbortController();
    api.submissionReport(controller.signal).then(
      (result) => {
        if (!controller.signal.aborted) setReport(result);
      },
      (failure: Error) => {
        if (!controller.signal.aborted) setError(failure.message);
      }
    );
    return () => controller.abort();
  }, [retry]);

  const options = useMemo(
    () =>
      report?.teams
        .map((value, index) => ({ ...value, index }))
        .filter((value) => !project || value.project === project) ?? [],
    [report, project]
  );
  const view = useMemo(() => {
    if (!report || !valid) return;
    const totals = new Map(
      options
        .filter(({ index }) => !team || String(index) === team)
        .map((value) => [value.index, { ...value, total: 0, counts: new Map<number, number>() }])
    );
    const records = report.records.filter(([index, type, date]) => {
      const row = totals.get(index);
      if (!row || ((from || to) && (!date || (from && date < from) || (to && date > to))))
        return false;
      row.total++;
      row.counts.set(type, (row.counts.get(type) ?? 0) + 1);
      return true;
    });
    const teams = [...totals.values()];
    const byCoach = new Map<number, typeof teams>();
    for (const row of teams)
      for (const id of row.coaches) {
        const assigned = byCoach.get(id) ?? [];
        assigned.push(row);
        byCoach.set(id, assigned);
      }
    const coaches = report.coaches
      .flatMap((coach) => {
        const assigned = byCoach.get(coach.id);
        if (!assigned || (role && !coach.roles.includes(role))) return [];
        const counts = new Map<number, number>();
        for (const row of assigned)
          for (const [type, number] of row.counts)
            counts.set(type, (counts.get(type) ?? 0) + number);
        return [
          {
            ...coach,
            teams: assigned,
            counts,
            total: assigned.reduce((sum, row) => sum + row.total, 0),
          },
        ];
      })
      .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name, 'zh-CN'));
    return { teams, coaches, records };
  }, [report, valid, options, team, role, from, to]);

  const resetDetails = () => {
    setCoachId(undefined);
    setDetailTeam(undefined);
    setPage(1);
  };
  const selected = view?.coaches.find(({ id }) => id === coachId);
  const detail = useMemo(
    () =>
      detailTeam === undefined
        ? []
        : (view?.records.filter(([index]) => index === detailTeam) ?? []),
    [view, detailTeam]
  );
  const kinds = (counts: Map<number, number>) =>
    [...counts].map(([type, value]) => `${report?.types[type]} ${count(value)}`).join('、') || '—';
  const teamName = (row: SubmissionReport['teams'][number]) =>
    `${projectLabel(row.project)} · ${row.name || '未分队'}`;
  const exportReport = async () => {
    if (!report || !view) return;
    setExporting(true);
    setExportError('');
    try {
      const xlsx = await import('@e965/xlsx');
      const workbook = xlsx.utils.book_new();
      const add = (name: string, rows: (string | number)[][]) =>
        xlsx.utils.book_append_sheet(workbook, xlsx.utils.aoa_to_sheet(rows), name);
      add('教练汇总', [
        ['教练', '岗位', '所带队伍', '队伍数据总量', '各类数据数量'],
        ...view.coaches.map((row) => [
          row.name,
          row.roles.join('、'),
          row.teams.map(teamName).join('、'),
          row.total,
          kinds(row.counts),
        ]),
      ]);
      add('队伍汇总', [
        ['项目', '队伍', '数据总量', '各类数据数量'],
        ['全部筛选队伍', '系统总数（去重）', view.records.length, ''],
        ...view.teams.map((row) => [
          projectLabel(row.project),
          row.name || '未分队',
          row.total,
          kinds(row.counts),
        ]),
      ]);
      add('数据明细', [
        ['记录编号', '项目', '队伍', '数据类型', '业务日期'],
        ...view.records.map(([index, type, date, id]) => [
          id,
          projectLabel(report.teams[index].project),
          report.teams[index].name || '未分队',
          report.types[type],
          date,
        ]),
      ]);
      xlsx.writeFile(workbook, '队伍数据检查.xlsx');
    } catch {
      setExportError('Excel 导出失败，请重试。');
    } finally {
      setExporting(false);
    }
  };

  return (
    <PageContainer className="submission-report">
      <PageHeader title="队伍数据检查" />
      <div className="submission-filters">
        <label>
          项目
          <select
            value={project}
            onChange={(event) => {
              setProject(event.target.value);
              setTeam('');
              resetDetails();
            }}
          >
            <option value="">全部授权项目</option>
            {projects.map((value) => (
              <option key={value} value={value}>
                {projectLabel(value)}
              </option>
            ))}
          </select>
        </label>
        <label>
          队伍
          <select
            value={team}
            onChange={(event) => {
              setTeam(event.target.value);
              resetDetails();
            }}
          >
            <option value="">全部授权队伍</option>
            {options.map((row) => (
              <option key={row.index} value={row.index}>
                {teamName(row)}
              </option>
            ))}
          </select>
        </label>
        <label>
          岗位
          <select
            value={role}
            onChange={(event) => {
              setRole(event.target.value);
              resetDetails();
            }}
          >
            <option value="">全部岗位</option>
            {COACH_CATEGORIES.map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </label>
        <label>
          业务开始日期
          <input
            type="date"
            value={from}
            onChange={(event) => {
              setFrom(event.target.value);
              resetDetails();
            }}
          />
        </label>
        <label>
          业务结束日期
          <input
            type="date"
            value={to}
            onChange={(event) => {
              setTo(event.target.value);
              resetDetails();
            }}
          />
        </label>
        <button
          type="button"
          className="primary-button"
          disabled={!view || exporting}
          onClick={exportReport}
        >
          <Download size={16} aria-hidden="true" />
          {exporting ? '导出中…' : '导出 Excel'}
        </button>
      </div>
      <div role="status">
        {error || (!report ? '正在读取队伍数据…' : !valid ? '开始日期须早于或等于结束日期。' : '')}
        {exportError}
      </div>
      {error && (
        <button
          type="button"
          className="secondary-button"
          onClick={() => {
            setError('');
            setRetry(retry + 1);
          }}
        >
          重试
        </button>
      )}
      {view && (
        <>
          <h2>系统总数（去重） {count(view.records.length)} 条</h2>
          <p>数据量按当前带队关系展示。同队有多位教练时，每人显示该队的完整数量。</p>
          <div className="submission-table" role="region" aria-label="教练汇总" tabIndex={0}>
            <table>
              <thead>
                <tr>
                  {['教练', '岗位', '所带队伍', '队伍数据总量', '各类数据数量'].map((text) => (
                    <th key={text} scope="col">
                      {text}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {view.coaches.length === 0 && (
                  <tr>
                    <td colSpan={5}>当前范围无关联教练。</td>
                  </tr>
                )}
                {view.coaches.map((row) => (
                  <tr key={row.id}>
                    <th scope="row" className="submission-coach-name">{row.name}</th>
                    <td>{row.roles.join('、') || '—'}</td>
                    <td>{row.teams.map(teamName).join('、')}</td>
                    <td>
                      <button
                        type="button"
                        className="secondary-button"
                        aria-label={`查看${row.name}带队数据`}
                        onClick={() => {
                          resetDetails();
                          setCoachId(row.id);
                        }}
                      >
                        {count(row.total)}
                      </button>
                    </td>
                    <td>{kinds(row.counts)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {selected && (
            <section>
              <h2>{selected.name}的带队数据</h2>
              <ul>
                {selected.teams.map((row) => (
                  <li key={row.index}>
                    {teamName(row)} · {count(row.total)} 条 · {kinds(row.counts)}
                  </li>
                ))}
              </ul>
              <button type="button" className="secondary-button" onClick={resetDetails}>
                关闭
              </button>
            </section>
          )}
          <details>
            <summary>队伍汇总</summary>
            <div className="submission-table" role="region" aria-label="队伍汇总" tabIndex={0}>
              <table>
                <thead>
                  <tr>
                    {['队伍', '教练', '数据量', '各类数据数量'].map((text) => (
                      <th key={text} scope="col">
                        {text}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {view.teams.map((row) => (
                    <tr key={row.index}>
                      <th scope="row">{teamName(row)}</th>
                      <td>
                        {row.coaches
                          .map((id) => report?.coaches.find((coach) => coach.id === id)?.name)
                          .join('、') || '暂无关联教练'}
                      </td>
                      <td>
                        <button
                          type="button"
                          className="secondary-button"
                          aria-label={`查看${teamName(row)}的记录`}
                          onClick={() => {
                            setDetailTeam(row.index);
                            setPage(1);
                          }}
                        >
                          {count(row.total)}
                        </button>
                      </td>
                      <td>{kinds(row.counts)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
          {detailTeam !== undefined && (
            <section>
              <h2>{teamName(report!.teams[detailTeam])} · 数据明细</h2>
              <div className="submission-table" role="region" aria-label="数据明细" tabIndex={0}>
                <table>
                  <thead>
                    <tr>
                      <th scope="col">数据类型</th>
                      <th scope="col">业务日期</th>
                      <th scope="col">记录编号</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail
                      .slice((page - 1) * pageSize, page * pageSize)
                      .map(([, type, date, id]) => (
                        <tr key={id}>
                          <td>{report?.types[type]}</td>
                          <td>{date || '未记录'}</td>
                          <td>{id}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
              <div className="submission-filters">
                <button
                  type="button"
                  className="secondary-button"
                  disabled={page <= 1}
                  onClick={() => setPage(page - 1)}
                >
                  上一页
                </button>
                <span>
                  第 {page} 页，共 {count(detail.length)} 条
                </span>
                <button
                  type="button"
                  className="secondary-button"
                  disabled={page * pageSize >= detail.length}
                  onClick={() => setPage(page + 1)}
                >
                  下一页
                </button>
                <button type="button" className="secondary-button" onClick={resetDetails}>
                  关闭明细
                </button>
              </div>
            </section>
          )}
        </>
      )}
    </PageContainer>
  );
}
