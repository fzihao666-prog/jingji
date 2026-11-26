import { ChevronLeft, ChevronRight, Filter, Download, RefreshCw, Save } from 'lucide-react';
import { useEffect, useState } from 'react';
import {
  AI_FEATURES,
  AI_STATES,
  type AiManagementData,
  type AiSettings,
} from '../../shared/ai-management';
import type { Project } from '../../shared/projects';
import type { ProjectTeam } from '../types';
import { api, getAiManagement, saveAiSettings } from '../api';
import {
  AppCard,
  ContentState,
  FilterBar,
  PageContainer,
  PageHeader,
  SectionHeader,
} from '../components/PageLayout';
import './AiManagementPage.css';

const yuan = new Intl.NumberFormat('zh-CN', {
  style: 'currency',
  currency: 'CNY',
  minimumFractionDigits: 2,
  maximumFractionDigits: 6,
});
const money = (micros: number) => yuan.format(micros / 1_000_000);
const beijingTime = new Intl.DateTimeFormat('zh-CN', {
  timeZone: 'Asia/Shanghai',
  dateStyle: 'short',
  timeStyle: 'medium',
});
const emptySettings = { enabled: false, budgetYuan: 10 };

export function AiManagementPage({ project, currentTeamId }: { project: Project; currentTeamId: number | null }) {
  const [refresh, setRefresh] = useState(0);
  const [teams, setTeams] = useState<ProjectTeam[]>();
  const [teamError, setTeamError] = useState('');
  const [selection, setSelection] = useState<{ project: Project; id: number }>();
  const projectTeams = teams?.filter(team => team.project === project) ?? [];
  const preferredTeam = selection?.project === project ? selection.id : currentTeamId;
  const exportTeamId = projectTeams.find(team => team.id === preferredTeam)?.id
    ?? (projectTeams.length === 1 ? projectTeams[0].id : null);
  const teamPlaceholder = teamError || (!teams ? '正在读取队伍…' :
    projectTeams.length ? '请选择队伍' : '当前项目暂无队伍');
  useEffect(() => {
    let active = true;
    setTeamError('');
    api.teams()
      .then(result => { if (active) setTeams(result.teams); })
      .catch(() => { if (active) setTeamError('队伍列表加载失败。'); });
    return () => { active = false; };
  }, [refresh]);
  const [exporting, setExporting] = useState<'team' | 'basic' | null>(null);
  const [exportError, setExportError] = useState('');
  async function exportTeamData(kind: 'team' | 'basic') {
    setExporting(kind);
    setExportError('');
    try {
      const exporter = await import('../submission-report-excel');
      if (kind === 'team') await exporter.downloadSubmissionExcel(await api.submissionReport());
      else if (exportTeamId !== null) await exporter.downloadBasicSubmissionExcel(await api.basicSubmissionReport(exportTeamId));
    } catch (error) {
      setExportError(error instanceof Error ? error.message : 'Excel 导出失败，请重试。');
    } finally {
      setExporting(null);
    }
  }
  const [data, setData] = useState<AiManagementData>();
  const [settings, setSettings] = useState<AiSettings>(emptySettings);
  const [budget, setBudget] = useState('10');
  const [query, setQuery] = useState('');
  const [before, setBefore] = useState<number[]>([]);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const cursor = before.at(-1);
  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams(query);
    if (cursor) params.set('before', String(cursor));
    getAiManagement(params, controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return;
        setData(result);
        setSettings(result.settings);
        setBudget(String(result.settings.budgetYuan));
        setLoading(false);
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return;
        setError(reason instanceof Error ? reason.message : '无法读取 AI 用量。');
        setLoading(false);
      });
    return () => controller.abort();
  }, [query, cursor, refresh]);

  function reload() {
    setLoading(true);
    setError('');
    setRefresh((value) => value + 1);
  }

  return (
    <PageContainer className="ai-management">
      <PageHeader
        title="AI 管理"
        supportingContent={<p>预算和用量按北京时间统计。</p>}
        actions={
          <>
            <button
              type="button"
              className="primary-button"
              disabled={Boolean(exporting)}
              onClick={() => void exportTeamData('team')}
            >
              <Download size={16} aria-hidden="true" />
              {exporting === 'team' ? '正在生成 Excel…' : '队伍数据检查Excel'}
            </button>
            <label className="ai-management-export-team">
              <span>基本信息检查队伍</span>
              <select
                value={exportTeamId ?? ''}
                disabled={Boolean(exporting) || !projectTeams.length}
                onChange={event => setSelection({ project, id: Number(event.target.value) })}
              >
                <option value="" disabled>{teamPlaceholder}</option>
                {projectTeams.map(team => <option key={team.id} value={team.id}>{team.name}</option>)}
              </select>
            </label>
            <button
              type="button"
              className="secondary-button"
              disabled={Boolean(exporting) || exportTeamId === null}
              onClick={() => void exportTeamData('basic')}
            >
              <Download size={16} aria-hidden="true" />
              {exporting === 'basic' ? '正在生成 Excel…' : '基本信息检查'}
            </button>
            <button
              className="secondary-button"
              type="button"
              disabled={loading || saving}
              onClick={reload}
            >
              <RefreshCw size={16} aria-hidden="true" />
              刷新
            </button>
          </>
        }
      />
      {exportError && <p role="alert">{exportError}</p>}
      <div role="status" className="ai-management-status">
        {loading ? <ContentState kind="loading" title="正在读取 AI 用量…" /> : notice}
      </div>
      {error && <ContentState kind="error" title="AI 管理操作失败" description={error} />}
      <AppCard variant="compact">
        <SectionHeader title="今日用量" description={data?.today} />
        {data && (
          <dl className="ai-management-summary">
            {[
              ['业务请求', data.summary.requests],
              ['模型尝试', data.summary.attempts],
              ['输入 token', data.summary.input],
              ['输出 token', data.summary.output],
              ['已结算估算费用', money(data.summary.settled)],
              ['待确认及请求中占用', money(data.summary.pending)],
            ].map(([label, value]) => (
              <div key={label} className="overview-metric">
                <dt>{label}</dt>
                <dd>
                  <strong>
                    {typeof value === 'number' ? value.toLocaleString('zh-CN') : value}
                  </strong>
                </dd>
              </div>
            ))}
          </dl>
        )}
      </AppCard>
      <AppCard variant="compact">
        <SectionHeader
          title="全站调用设置"
          description="总开关覆盖网页、小程序和自动任务。关闭后，已发出的请求仍会结算。"
        />
        <form
          className="ai-management-controls"
          onSubmit={async (event) => {
            event.preventDefault();
            setSaving(true);
            setNotice('');
            setError('');
            try {
              const result = await saveAiSettings({
                enabled: settings.enabled,
                budgetYuan: Number(budget),
              });
              setSettings(result);
              setNotice('AI 设置已保存。');
              reload();
            } catch (reason) {
              setError(reason instanceof Error ? reason.message : '无法保存 AI 设置。');
            } finally {
              setSaving(false);
            }
          }}
        >
          <label>
            <input
              type="checkbox"
              checked={settings.enabled}
              disabled={!data || loading || saving}
              onChange={(event) => setSettings({ ...settings, enabled: event.target.checked })}
            />{' '}
            启用 AI 调用
          </label>
          <label>
            每日预算（元）
            <input
              type="number"
              min="0"
              step="0.01"
              required
              value={budget}
              disabled={!data || loading || saving}
              onChange={(event) => setBudget(event.target.value)}
            />
          </label>
          <button className="primary-button" type="submit" disabled={!data || loading || saving}>
            <Save size={16} aria-hidden="true" />
            {saving ? '正在保存…' : '保存设置'}
          </button>
        </form>
      </AppCard>
      <AppCard variant="compact">
        <SectionHeader
          title="请求明细"
          description="同一个请求编号下可能有多次模型尝试。筛选仅影响明细。"
        />
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const fields = new FormData(event.currentTarget);
            const params = new URLSearchParams();
            for (const [key, value] of fields)
              if (typeof value === 'string' && value.trim()) params.set(key, value.trim());
            setQuery(params.toString());
            setBefore([]);
            reload();
          }}
        >
          <FilterBar
            label="请求明细筛选"
            className="ai-management-filters"
            actions={
              <button className="secondary-button" type="submit" disabled={loading || saving}>
                <Filter size={16} aria-hidden="true" />
                筛选
              </button>
            }
          >
            <label>
              日期
              <input type="date" name="date" />
            </label>
            <label>
              账号 ID
              <input name="account" pattern="[1-9][0-9]{0,14}|system" placeholder="系统填 system" />
            </label>
            <label>
              功能
              <select name="feature">
                <option value="">全部</option>
                {AI_FEATURES.map((feature) => (
                  <option key={feature}>{feature}</option>
                ))}
              </select>
            </label>
            <label>
              状态
              <select name="state">
                <option value="">全部</option>
                {Object.entries(AI_STATES).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
          </FilterBar>
        </form>
        {data &&
          (data.attempts.length === 0 ? (
            <ContentState kind="empty" title="暂无符合条件的模型请求" />
          ) : (
            <div className="table-scroll" tabIndex={0} role="region" aria-label="模型请求明细">
              <table className="data-table">
                <thead>
                  <tr>
                    {[
                      '请求编号',
                      '时间',
                      '调用者',
                      '功能',
                      '供应商及模型',
                      '状态',
                      '输入 / 输出 token',
                      '费用 / 占用',
                    ].map((label) => (
                      <th key={label} scope="col">
                        {label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.attempts.map((attempt) => (
                    <tr key={attempt.id}>
                      <td>{attempt.job.slice(0, 8)}</td>
                      <td>{beijingTime.format(new Date(attempt.started))}</td>
                      <td>
                        {attempt.account === null
                          ? '系统'
                          : `${attempt.username ?? '账号'} #${attempt.account}`}
                      </td>
                      <td>{attempt.feature}</td>
                      <td>
                        <strong>{attempt.provider}</strong>
                        <small>{attempt.model}</small>
                      </td>
                      <td>{AI_STATES[attempt.state]}</td>
                      <td>
                        {attempt.input ?? '—'} / {attempt.output ?? '—'}
                      </td>
                      <td>
                        {attempt.cost === null
                          ? `占用 ${money(attempt.reserved)}`
                          : money(attempt.cost)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        {(Boolean(before.length) || data?.next) && (
          <div className="ai-management-pagination" role="group" aria-label="请求明细分页">
            <button
              className="secondary-button"
              type="button"
              disabled={loading || saving || !before.length}
              onClick={() => {
                setLoading(true);
                setError('');
                setBefore((values) => values.slice(0, -1));
              }}
            >
              <ChevronLeft size={16} aria-hidden="true" />
              上一页
            </button>
            <button
              className="secondary-button"
              type="button"
              disabled={loading || saving || !data?.next}
              onClick={() => {
                if (!data?.next) return;
                setLoading(true);
                setError('');
                setBefore([...before, data.next]);
              }}
            >
              下一页
              <ChevronRight size={16} aria-hidden="true" />
            </button>
          </div>
        )}
      </AppCard>
    </PageContainer>
  );
}
