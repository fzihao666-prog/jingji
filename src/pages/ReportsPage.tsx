import {
  emptyTeamWeeklyCommentary,
  teamWeeklyCommentarySchema,
  type TeamWeeklyCommentary,
} from '../../shared/team-weekly-ai';
import { useEffect, useRef, useState } from 'react';
import { Download, Eye, FileText, RefreshCw } from 'lucide-react';
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
  const [commentary, setCommentary] = useState<TeamWeeklyCommentary>(emptyTeamWeeklyCommentary);
  const [validationError, setValidationError] = useState('');
  const errorSummary = useRef<HTMLParagraphElement>(null);
  const [consent, setConsent] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
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
    setCommentary(emptyTeamWeeklyCommentary());
    setConfirmed(false);
    setValidationError('');
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
        if (version === generation.version) {
          setReport(result);
          if (report?.fingerprint !== result.fingerprint) {
            setCommentary(emptyTeamWeeklyCommentary());
            setConfirmed(false);
          }
        }
      }
    } catch (error) {
      if (version === generation.version)
        setMessage(error instanceof Error ? error.message : '周总结生成失败，请重试。');
    } finally {
      if (version === generation.version) setBusy(false);
    }
  }
  async function handleAi() {
    if (!report?.fingerprint || !consent || busy) return;
    const version = ++generation.version;
    setBusy(true);
    setMessage('');
    try {
      const draft = await api.weeklyCommentary(
        { project, teamId: Number(selectedTeam), date },
        report.fingerprint
      );
      if (version === generation.version) {
        setCommentary(draft);
        setConfirmed(false);
        setValidationError('');
        setMessage('AI 草稿已生成，请结合图表核对并编辑。');
      }
    } catch (error) {
      if (version === generation.version)
        setMessage(error instanceof Error ? error.message : 'AI 生成失败，可继续手动填写。');
    } finally {
      if (version === generation.version) setBusy(false);
    }
  }
  async function handleReviewedDownload() {
    if (!report?.fingerprint || !confirmed || busy) return;
    const parsed = teamWeeklyCommentarySchema.safeParse(commentary);
    if (!parsed.success) {
      setValidationError('每段最多600字，五段合计最多2000字，请缩短后下载。');
      errorSummary.current?.focus();
      return;
    }
    const version = ++generation.version;
    setBusy(true);
    setMessage('');
    try {
      await api.weeklyReviewedPdf(
        { project, teamId: Number(selectedTeam), date },
        report.fingerprint,
        parsed.data
      );
      if (version === generation.version) setMessage('含教练点评的周总结已开始下载。');
    } catch (error) {
      if (version === generation.version)
        setMessage(error instanceof Error ? error.message : '下载失败，请重试。');
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
              <RefreshCw size={16} aria-hidden="true" />
              重新加载队伍
            </button>
          )}
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
          <div className="reports-footer">
            {range && (
              <p className="reports-period">
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
          </div>
        </form>
        <p role="status" aria-live="polite">
          {message}
        </p>
        {!loading && !teams.length && <p>当前项目暂无可访问队伍，请检查当前项目及队伍授权。</p>}
        <p className="reports-note">
          根据当前权限范围内在册队员的数据生成。缺失不计为零、未填报不计为未训练；不生成自动诊断或训练处方。
        </p>
      </AppCard>
      {report && (
        <AppCard>
          <h2>教练总结</h2>
          <p>
            可选择 AI
            起草，也可直接填写。每段最多600字，合计最多2000字；请补充本周目标、现场反应和调整原因。
          </p>
          <label>
            <input
              type="checkbox"
              disabled={busy}
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
            />
            同意发送去身份化训练统计生成 AI 草稿；健康数据和自由备注不发送。
          </label>
          <button
            type="button"
            className="secondary-button"
            disabled={busy || !consent || !report.fingerprint}
            onClick={() => void handleAi()}
          >
            AI 生成总结
          </button>
          {(
            Object.entries({
              summary: '本周总结',
              training: '训练分析',
              strength: '力量分析',
              recovery: '恢复反馈',
              nextWeek: '下周重点',
            }) as [keyof TeamWeeklyCommentary, string][]
          ).map(([key, label]) => (
            <label key={key} className="reports-commentary-field">
              {label}
              <textarea
                disabled={busy}
                placeholder="可填写或修改教练现场观察；此处文字仅用于本地报告，不发送给 AI。"
                aria-invalid={Boolean(validationError)}
                aria-describedby="weekly-commentary-error"
                maxLength={600}
                value={commentary[key]}
                onChange={(e) => {
                  setCommentary((v) => ({ ...v, [key]: e.target.value }));
                  setConfirmed(false);
                  setValidationError('');
                }}
              />
            </label>
          ))}
          <p id="weekly-commentary-error" role="alert" tabIndex={-1} ref={errorSummary}>
            {validationError}
          </p>
          <label>
            <input
              type="checkbox"
              disabled={busy}
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
            />
            已核对总结与数据
          </label>
          <button
            type="button"
            className="primary-button"
            disabled={busy || !confirmed || !report.fingerprint}
            onClick={() => void handleReviewedDownload()}
          >
            下载含点评 PDF
          </button>
        </AppCard>
      )}
      {report && <TeamWeeklyReportPreview report={report} />}
    </PageContainer>
  );
}
