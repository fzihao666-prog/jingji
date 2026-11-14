import { useEffect, useMemo, useState } from 'react';
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

export default function SubmissionReportPage({ projects }: { projects: Project[] }) {
  const [project, setProject] = useState<Project>();
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [team, setTeam] = useState<string>();
  const [roles, setRoles] = useState<string[]>([]);
  const [selection, setSelection] = useState<SubmissionSummary | null>(null);
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<{
    query: string;
    filters: string;
    project: Project | undefined;
    report: SubmissionReport;
  }>();
  const [failure, setFailure] = useState<{ query: string; message: string }>();
  const [exportError, setExportError] = useState('');
  const [exporting, setExporting] = useState(false);
  const [retry, setRetry] = useState(0);
  const valid = !from || !to || from <= to;
  const filters = useMemo(() => {
    const query = new URLSearchParams();
    if (project) query.set('project', project);
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
          setResult({ query: queryKey, filters: filterKey, project, report });
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
  }, [query, queryKey, filterKey, project, retry, valid]);

  const report = result?.query === queryKey && valid ? result.report : undefined;
  const summary = valid && result?.filters === filterKey ? result.report : undefined;
  const teams = result?.project === project ? result?.report.teams : undefined;
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
            value={project ?? ''}
            onChange={(event) => {
              const value = event.target.value;
              setProject(isProject(value) ? value : undefined);
              setTeam(undefined);
              resetSelection();
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
            value={team === undefined ? '' : JSON.stringify(team)}
            onChange={(event) => {
              const value = event.target.value;
              setTeam(teams?.find((name) => JSON.stringify(name) === value));
              resetSelection();
            }}
          >
            <option value="">全部授权队伍</option>
            {teams?.map((name) => (
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
            <h3>人员提交明细</h3>
            <p>按已确认提交量降序排列，包含零提交人员。提交量供检查参考。</p>
            <div className="submission-table" role="region" aria-label="人员提交明细" tabIndex={0}>
              <table>
                <thead>
                  <tr>
                    {[
                      '人员',
                      '岗位',
                      '项目',
                      '队伍',
                      '本人提交',
                      '已确认代导入',
                      '已确认总量',
                      '最近提交',
                      '数据类型',
                    ].map((label) => (
                      <th scope="col" key={label}>
                        {label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {!summary.rows.some((row) => !row.group) && (
                    <tr>
                      <td colSpan={9}>当前范围无人员。</td>
                    </tr>
                  )}
                  {summary.rows
                    .filter((row) => !row.group)
                    .map((row) => (
                      <tr key={row.key}>
                        <th scope="row">{row.name}</th>
                        <td>{row.role}</td>
                        <td>{row.projects?.join('、')}</td>
                        <td>{row.team || '未分队'}</td>
                        <td>{count(row.direct)}</td>
                        <td>{row.delegated ? count(row.delegated) : '—'}</td>
                        <td>{renderCount(row)}</td>
                        <td>{row.lastSubmitted || '—'}</td>
                        <td>{kinds(row.types)}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
            <details>
              <summary>查看队伍岗位汇总与管理员代导入</summary>
              <div
                className="submission-table"
                role="region"
                aria-label="队伍岗位汇总"
                tabIndex={0}
              >
                <table>
                  <thead>
                    <tr>
                      {[
                        '项目',
                        '队伍',
                        '岗位',
                        '本人提交',
                        '管理员代导入',
                        '来源待确认',
                        '总量',
                        '数据类型',
                      ].map((label) => (
                        <th scope="col" key={label}>
                          {label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {summary.rows
                      .filter((row) => row.group)
                      .map((row) => (
                        <tr key={row.key}>
                          <td>{row.projects?.join('、')}</td>
                          <td>{row.team || '未分队'}</td>
                          <th scope="row">{row.role}</th>
                          <td>{count(row.direct)}</td>
                          <td>{count(row.delegated)}</td>
                          <td>{count(row.unknown)}</td>
                          <td>{renderCount(row)}</td>
                          <td>{kinds(row.types)}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </details>
          </section>
          {selection && (
            <section aria-labelledby="submission-detail-heading">
              <h2 id="submission-detail-heading">{selection.name} · 提交记录</h2>
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
                            '项目',
                            '队伍',
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
                          <tr key={`${row.project}:${row.id}`}>
                            <td>{row.project ? projectLabel(row.project) : '—'}</td>
                            <td>{row.team || '未分队'}</td>
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
