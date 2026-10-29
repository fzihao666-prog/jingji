import { useEffect, useRef, useState } from 'react';
import { Download, Eye, FileText } from 'lucide-react';
import { api } from '../api';
import type { Project, ProjectTeam } from '../types';
import { projectLabel } from '../../shared/projects';
import { reportPeriod } from '../../shared/training-report';
import type { TeamWeeklyReport } from '../../shared/team-weekly-report';
import { TeamWeeklyReportPreview } from '../components/TeamWeeklyReportPreview';
import { AppCard, PageContainer, PageHeader } from '../components/PageLayout';
import './ReportsPage.css';
type Props = { project: Project; teamId: number | null };
export function previousWeekDate(now = new Date()) {
  const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai' }).format(now);
  return new Date(Date.parse(reportPeriod('week', today).from) - 7 * 86400000)
    .toISOString()
    .slice(0, 10);
}
export function ReportsPage({ project, teamId }: Props) {
  const [teams, setTeams] = useState<ProjectTeam[]>([]);
  const [selectedTeam, setSelectedTeam] = useState(teamId ? String(teamId) : '');
  const [date, setDate] = useState(previousWeekDate);
  const [report, setReport] = useState<TeamWeeklyReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');
  const [retry, setRetry] = useState(0);
  const generation = useRef({ version: 0 }).current;
  useEffect(() => {
    let active = true;
    api
      .overviewTeams(project)
      .then(({ teams: items }) => {
        if (active) {
          setTeams(items);
          setSelectedTeam((v) =>
            items.some((t) => String(t.id) === v)
              ? v
              : items.length === 1
                ? String(items[0].id)
                : ''
          );
        }
      })
      .catch((error: unknown) => {
        if (active) setMessage(error instanceof Error ? error.message : '队伍加载失败，请重试。');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
      generation.version++;
    };
  }, [project, retry, generation]);
  const range = date ? reportPeriod('week', date) : null;
  const change = () => {
    generation.version++;
    setReport(null);
    setMessage('');
  };
  async function generate(download: boolean) {
    if (!selectedTeam || !date) {
      setMessage('请选择队伍和周内日期。');
      return;
    }
    const version = ++generation.version;
    setBusy(true);
    setMessage('');
    const query = { project, teamId: Number(selectedTeam), date };
    try {
      if (download) {
        await api.downloadTeamWeekly(query);
        if (version === generation.version) setMessage('周总结已生成，已开始下载 PDF。');
      } else {
        const result = await api.teamWeeklyPreview(query);
        if (version === generation.version) setReport(result);
      }
    } catch (error) {
      if (version === generation.version)
        setMessage(error instanceof Error ? error.message : '周总结生成失败，请重试。');
    } finally {
      if (version === generation.version) setBusy(false);
    }
  }
  return (
    <PageContainer className="reports-page">
      <PageHeader
        eyebrow="TRAINING REPORTS"
        title="报告"
        supportingContent={
          <p>将已有训练、测试和恢复记录，整理为教练复盘与汇报使用的队伍周总结。</p>
        }
      />
      <AppCard>
        <header className="reports-heading">
          <FileText size={22} aria-hidden="true" />
          <div>
            <h2>训练周总结</h2>
            <p>自然周 · 全队汇总 · PDF 下载</p>
          </div>
        </header>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void generate(true);
          }}
        >
          <fieldset disabled={busy || loading} className="reports-controls">
            <legend>报告范围</legend>
            <label>
              项目
              <input value={projectLabel(project)} readOnly />
            </label>
            <label>
              队伍
              <select
                value={selectedTeam}
                onChange={(e) => {
                  change();
                  setSelectedTeam(e.target.value);
                }}
                required
              >
                <option value="">{loading ? '正在加载队伍…' : '请选择队伍'}</option>
                {teams.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              所在周的日期
              <input
                type="date"
                required
                value={date}
                onChange={(e) => {
                  change();
                  setDate(e.target.value);
                }}
              />
            </label>
          </fieldset>
          {range && (
            <p>
              报告周期：{range.from} 至 {range.to}（周一至周日）
            </p>
          )}
          <div className="reports-actions">
            <button
              type="submit"
              className="primary-button"
              disabled={busy || loading || !teams.length}
            >
              <Download size={16} aria-hidden="true" />
              {busy ? '正在生成…' : '生成并下载 PDF'}
            </button>
            <button
              type="button"
              className="secondary-button"
              disabled={busy || loading || !teams.length}
              onClick={() => void generate(false)}
            >
              <Eye size={16} aria-hidden="true" />
              预览
            </button>
          </div>
        </form>
        <p role="status" aria-live="polite">
          {message}
        </p>
        {!loading && !teams.length && <p>当前项目暂无可访问队伍，请检查当前项目及队伍授权。</p>}
        {!loading && (
          <button
            type="button"
            className="secondary-button"
            disabled={busy}
            onClick={() => {
              change();
              setLoading(true);
              setRetry((v) => v + 1);
            }}
          >
            重新加载队伍
          </button>
        )}
        <p className="reports-note">
          根据当前权限范围内在册队员的数据生成。缺失不计为零、未填报不计为未训练；不生成自动诊断或训练处方。
        </p>
      </AppCard>
      {report && <TeamWeeklyReportPreview report={report} />}
    </PageContainer>
  );
}
