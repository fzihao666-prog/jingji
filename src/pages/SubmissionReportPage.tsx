import { Fragment, useEffect, useMemo, useState } from 'react';
import { Download } from 'lucide-react';
import { COACH_CATEGORIES } from '../../shared/coach-categories';
import { isProject, projectLabel, type Project } from '../../shared/projects';
import type { SubmissionReport, SubmissionSummary } from '../../shared/submission-report';
import { api } from '../api';
import { PageContainer, PageHeader } from '../components/PageLayout';
import './SubmissionReportPage.css';

const number = new Intl.NumberFormat('zh-CN');
const count = (value: number) => number.format(value);
const kinds = (types: Record<string, number>) =>
  Object.entries(types)
    .map(([type, value]) => `${type} ${count(value)}`)
    .join('、') || '—';

export default function SubmissionReportPage({
  project,
  projects,
  onProjectChange,
}: {
  project: Project;
  projects: Project[];
  onProjectChange: (project: Project) => void;
}) {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [team, setTeam] = useState<string>();
  const [roles, setRoles] = useState<string[]>([]);
  const [selection, setSelection] = useState<SubmissionSummary | null>(null);
  const [page, setPage] = useState(1);
  const [collapsed, setCollapsed] = useState<string[]>([]);
  const [result, setResult] = useState<{
    query: string;
    filters: string;
    report: SubmissionReport;
  }>();
  const [failure, setFailure] = useState<{ query: string; message: string }>();
  const [exportError, setExportError] = useState('');
  const [exporting, setExporting] = useState(false);
  const [retry, setRetry] = useState(0);
  const valid = !from || !to || from <= to;
  const filters = useMemo(() => {
    const query = new URLSearchParams({ project });
    if (from) query.set('from', from);
    if (to) query.set('to', to);
    if (team !== undefined) query.set('team', team);
    if (roles.length) query.set('roles', roles.join(','));
    return query;
  }, [project, from, to, team, roles]);
  const query = useMemo(() => {
    const params = new URLSearchParams(filters);
    if (selection) {
      params.set('key', selection.key);
      params.set('page', String(page));
    }
    return params;
  }, [filters, selection, page]);
  const queryKey = query.toString();
  const filterKey = filters.toString();
  useEffect(() => {
    if (!valid) return;
    const controller = new AbortController();
    api.submissionReport(query, controller.signal).then(
      (report) => {
        if (!controller.signal.aborted) {
          setFailure(undefined);
          setResult({ query: queryKey, filters: filterKey, report });
        }
      },
      (error: unknown) => {
        if (!controller.signal.aborted) {
          setFailure({
            query: queryKey,
            message: error instanceof Error ? error.message : '读取提交数据失败。',
          });
        }
      }
    );
    return () => controller.abort();
  }, [query, queryKey, filterKey, retry, valid]);

  const report = result?.query === queryKey && valid ? result.report : undefined;
  const summary = valid && result?.filters === filterKey ? result.report : undefined;
  const peopleByGroup = new Map<string, SubmissionSummary[]>();
  for (const row of summary?.rows ?? []) {
    if (row.group) continue;
    const key = JSON.stringify([row.team, row.role]);
    const people = peopleByGroup.get(key) ?? [];
    people.push(row);
    peopleByGroup.set(key, people);
  }
  const error = failure?.query === queryKey ? failure.message : '';
  const resetSelection = () => {
    setSelection(null);
    setPage(1);
    setExportError('');
  };
  const exportReport = async () => {
    setExporting(true);
    setExportError('');
    try {
      await api.exportSubmissionReport(filters);
    } catch (error) {
      setExportError(error instanceof Error ? error.message : '导出失败。');
    } finally {
      setExporting(false);
    }
  };
  const renderCount = (row: SubmissionSummary) =>
    row.total ? (
      <button
        type="button"
        className="secondary-button"
        aria-label={`查看${row.team}${row.name}${count(row.total)}条明细`}
        onClick={() => {
          setSelection(row);
          setPage(1);
        }}
      >
        {count(row.total)}
        {!row.group && '（已确认）'}
      </button>
    ) : (
      '0'
    );

  return (
    <PageContainer className="submission-report">
      <PageHeader title="数据提交检查" />
      <div className="submission-filters">
        <label>
          项目
          <select
            value={project}
            onChange={(event) => {
              const value = event.target.value;
              if (isProject(value)) onProjectChange(value);
            }}
          >
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
            value={team === undefined ? '' : JSON.stringify(team)}
            onChange={(event) => {
              const value = event.target.value;
              setTeam(result?.report.teams.find((name) => JSON.stringify(name) === value));
              resetSelection();
            }}
          >
            <option value="">全部授权队伍</option>
            {result?.report.teams.map((name) => (
              <option key={name} value={JSON.stringify(name)}>
                {name || '未分队'}
              </option>
            ))}
          </select>
        </label>
        <label>
          提交开始日期
          <input
            type="date"
            value={from}
            onChange={(event) => {
              setFrom(event.target.value);
              resetSelection();
            }}
          />
        </label>
        <label>
          提交结束日期
          <input
            type="date"
            value={to}
            onChange={(event) => {
              setTo(event.target.value);
              resetSelection();
            }}
          />
        </label>
        <button
          type="button"
          className="secondary-button"
          onClick={() => {
            setFrom('');
            setTo('');
            resetSelection();
          }}
        >
          全部时间
        </button>
        <button
          type="button"
          className="primary-button"
          disabled={!summary || exporting}
          onClick={exportReport}
        >
          <Download size={16} aria-hidden="true" />
          {exporting ? '导出中…' : '导出 Excel'}
        </button>
      </div>
      <fieldset className="submission-roles">
        <legend>岗位筛选</legend>
        {COACH_CATEGORIES.map((role) => (
          <label key={role}>
            <input
              type="checkbox"
              checked={roles.includes(role)}
              onChange={(event) => {
                setRoles(
                  event.target.checked ? [...roles, role] : roles.filter((value) => value !== role)
                );
                resetSelection();
              }}
            />
            {role}
          </label>
        ))}
        <span>未勾选时显示全部</span>
      </fieldset>
      <div role="status">
        {!valid ? '开始日期须早于或等于结束日期。' : error || (!report && '正在读取提交数据…')}
        {exportError}
      </div>
      {error && (
        <button
          type="button"
          className="secondary-button"
          onClick={() => {
            setFailure(undefined);
            setRetry(retry + 1);
          }}
        >
          重试
        </button>
      )}
      {summary && (report || selection) && !error && (
        <>
          <section aria-labelledby="submission-summary-heading">
            <h2 id="submission-summary-heading">系统总数（去重） {count(summary.total)} 条</h2>
            <p>
              {from || to
                ? '按提交日期统计，日期未记录的数据可在全部时间查看。'
                : '全部时间，含提交日期未记录的数据。'}{' '}
              系统总数覆盖所有岗位。
            </p>
            <p>{kinds(summary.types)}</p>
            <div
              className="submission-table"
              role="region"
              aria-label="人员与岗位汇总"
              tabIndex={0}
            >
              <table>
                <thead>
                  <tr>
                    <th scope="col">队伍</th>
                    <th scope="col">岗位 / 人员</th>
                    <th scope="col">本人导入</th>
                    <th scope="col">管理员代导入</th>
                    <th scope="col">来源待确认</th>
                    <th scope="col">总导入</th>
                    <th scope="col">数据类型</th>
                  </tr>
                </thead>
                <tbody>
                  {!summary.rows.length && (
                    <tr>
                      <td colSpan={7}>当前范围没有符合条件的人员或记录。</td>
                    </tr>
                  )}
                  {summary.rows
                    .filter((row) => row.group)
                    .map((group) => {
                      const open = !collapsed.includes(group.key);
                      return (
                        <Fragment key={group.key}>
                          <tr className="submission-group">
                            <td>{group.team || '未分队'}</td>
                            <th scope="row">
                              <button
                                type="button"
                                className="secondary-button"
                                aria-expanded={open}
                                onClick={() =>
                                  setCollapsed(
                                    open
                                      ? [...collapsed, group.key]
                                      : collapsed.filter((key) => key !== group.key)
                                  )
                                }
                              >
                                {group.role}汇总
                              </button>
                            </th>
                            <td>{count(group.direct)}</td>
                            <td>{count(group.delegated)}</td>
                            <td>{count(group.unknown)}</td>
                            <td>{renderCount(group)}</td>
                            <td>{kinds(group.types)}</td>
                          </tr>
                          {open &&
                            (peopleByGroup.get(group.key) ?? []).map((row) => (
                              <tr key={row.key}>
                                <td>{row.team || '未分队'}</td>
                                <th scope="row">{row.name}</th>
                                <td>{count(row.direct)}</td>
                                <td>{row.delegated ? count(row.delegated) : '—'}</td>
                                <td>—</td>
                                <td>{renderCount(row)}</td>
                                <td>{kinds(row.types)}</td>
                              </tr>
                            ))}
                        </Fragment>
                      );
                    })}
                </tbody>
              </table>
            </div>
            <p>个人数量为已确认归属的记录。个人来源未记录的代导入数据计入岗位汇总。</p>
          </section>
          {selection && (
            <section aria-labelledby="submission-detail-heading">
              <h2 id="submission-detail-heading">
                {selection.team || '未分队'} · {selection.name}明细
              </h2>
              <button type="button" className="secondary-button" onClick={resetSelection}>
                关闭明细
              </button>
              {report && (
                <>
                  <p role="status">
                    共 {count(report.detailTotal)} 条，第 {page} 页
                  </p>
                  <div
                    className="submission-table"
                    role="region"
                    aria-label="提交记录明细"
                    tabIndex={0}
                  >
                    <table>
                      <thead>
                        <tr>
                          {[
                            '数据类型',
                            '运动员',
                            '业务日期',
                            '提交日期',
                            '归属人员',
                            '操作账号',
                            '归属依据',
                          ].map((label) => (
                            <th key={label} scope="col">
                              {label}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {report.details.map((row) => (
                          <tr key={row.id}>
                            <td>{row.type}</td>
                            <td>{row.athlete || '—'}</td>
                            <td>{row.businessDate}</td>
                            <td>{row.submittedDate || '未记录'}</td>
                            <td>{row.name || '—'}</td>
                            <td>{row.operator || '—'}</td>
                            <td>{row.basis}</td>
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
                    <button
                      type="button"
                      className="secondary-button"
                      disabled={page * 50 >= report.detailTotal}
                      onClick={() => setPage(page + 1)}
                    >
                      下一页
                    </button>
                  </div>
                </>
              )}
            </section>
          )}
        </>
      )}
    </PageContainer>
  );
}
