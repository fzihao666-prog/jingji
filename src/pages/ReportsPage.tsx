import { useEffect, useRef, useState } from 'react';
import { FileText, Sparkles, Download, ImagePlus, X, RefreshCw } from 'lucide-react';
import { api } from '../api';
import type { Project, ProjectTeam } from '../types';
import { projectLabel } from '../../shared/projects';
import { reportPeriod } from '../../shared/training-report';
import { teamWeeklyCommentarySchema, type TeamWeeklyCommentary } from '../../shared/team-weekly-ai';
import type { WeeklyDraft } from '../../shared/team-weekly-workflow';
import type { SavedTeamWeeklyReport, WeeklyPhoto } from '../../shared/team-weekly-storage';
import { TeamWeeklyReportPreview } from '../components/TeamWeeklyReportPreview';
import { WeeklyReportPhoto } from '../components/WeeklyReportPhoto';
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
  const [reportType, setReportType] = useState<'special' | 'physical'>('physical');
  const [date, setDate] = useState(previousWeekDate);
  const [stage, setStage] = useState('');
  const [coachNotes, setCoachNotes] = useState('');
  const [consent, setConsent] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [photos, setPhotos] = useState<WeeklyPhoto[]>([]);
  const [draft, setDraft] = useState<WeeklyDraft | null>(null);
  const [saved, setSaved] = useState<SavedTeamWeeklyReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [commentaryInvalid, setCommentaryInvalid] = useState(false);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const [history, setHistory] = useState<Awaited<
    ReturnType<typeof api.weeklyReportHistory>
  > | null>(null);
  const [historyPage, setHistoryPage] = useState(1);
  const [historyRetry, setHistoryRetry] = useState(0);
  const [historyWeek, setHistoryWeek] = useState('');
  const [historyError, setHistoryError] = useState('');
  const [historyLoading, setHistoryLoading] = useState(false);
  const state = useRef({ version: 0 }).current;
  const errorRef = useRef<HTMLParagraphElement>(null);
  const range = date ? reportPeriod('week', date) : null;
  useEffect(() => {
    let active = true;
    api
      .overviewTeams(project)
      .then((result) => {
        if (active) {
          setTeams(result.teams);
          setSelectedTeam((current) =>
            result.teams.some((t) => String(t.id) === current)
              ? current
              : result.teams.length === 1
                ? String(result.teams[0].id)
                : ''
          );
        }
      })
      .catch((e) => {
        if (active) setMessage(e instanceof Error ? e.message : '队伍加载失败。');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
      state.version++;
    };
  }, [project, state]);
  useEffect(() => {
    if (!selectedTeam) return;
    let active = true;
    setHistoryError('');
    setHistoryLoading(true);
    api
      .weeklyReportHistory({
        project,
        teamId: Number(selectedTeam),
        reportType,
        page: historyPage,
        ...(historyWeek ? { week: reportPeriod('week', historyWeek).from } : {}),
      })
      .then((result) => {
        if (active) setHistory(result);
      })
      .catch((e) => {
        if (active) {
          setHistory(null);
          setHistoryError(e instanceof Error ? e.message : '历史报告加载失败。');
        }
      })
      .finally(() => {
        if (active) setHistoryLoading(false);
      });
    return () => {
      active = false;
    };
  }, [project, selectedTeam, reportType, historyPage, historyRetry, historyWeek]);
  function invalidate(scope = false) {
    state.version++;
    setDraft(null);
    setSaved(null);
    setError('');
    setCommentaryInvalid(false);
    setMessage('');
    if (scope) {
      setPhotos([]);
      setFiles([]);
      setHistory(null);
      setHistoryPage(1);
    }
  }
  function updateCommentary(value: TeamWeeklyCommentary) {
    setDraft((current) => (current ? { ...current, commentary: value } : current));
    setError('');
    setCommentaryInvalid(false);
  }
  async function generate() {
    if (!selectedTeam || !range) {
      setError('请选择队伍和有效周次。');
      errorRef.current?.focus();
      return;
    }
    const version = ++state.version;
    setBusy(true);
    setError('');
    setMessage(files.length ? '正在压缩并上传照片…' : '正在汇总训练数据并生成周总结…');
    try {
      if (files.length) {
        const uploaded = [
          ...photos,
          ...(await api.uploadWeeklyPhotos(
            { project, teamId: Number(selectedTeam), reportType },
            files
          )),
        ];
        if (version !== state.version) return;
        setPhotos(uploaded);
        setFiles([]);
      }
      setMessage('正在生成图表与周总结，AI 不可用时将保留基础报告…');
      const result = await api.generateWeeklyReport({
        query: { project, teamId: Number(selectedTeam), date, reportType },
        stage,
        coachNotes,
        consent,
      });
      if (version !== state.version) return;
      setDraft(result);
      setSaved(null);
      setMessage(
        result.messages.join(' ') || '周总结已生成，可在预览中编辑文字，核对后保存并下载。'
      );
    } catch (e) {
      if (version === state.version) {
        setError(e instanceof Error ? e.message : '生成失败，请重试。');
        setMessage('已确认的历史报告不会被覆盖。');
        errorRef.current?.focus();
      }
    } finally {
      if (version === state.version) setBusy(false);
    }
  }
  async function saveAndDownload() {
    if (!draft || busy) return;
    const checked = teamWeeklyCommentarySchema.safeParse(draft.commentary);
    if (!checked.success) {
      setCommentaryInvalid(true);
      setError('点评每段最多600字、合计最多2000字，请缩短后保存。');
      errorRef.current?.focus();
      return;
    }
    const version = ++state.version;
    setBusy(true);
    setError('');
    setMessage('正在核对并保存报告…');
    try {
      const result = await api.saveWeeklyReport({
        report: draft.data,
        fingerprint: draft.fingerprint,
        commentary: checked.data,
        photoIds: photos.map((p) => p.id),
        expectedRevision: draft.expectedRevision,
        confirmed: true,
      });
      if (version !== state.version) return;
      setSaved(result);
      setDraft(null);
      setPhotos(result.photos);
      setHistoryRetry((v) => v + 1);
      setMessage('报告已保存，正在下载 PDF…');
      await api.downloadSavedWeekly(
        result.id,
        `${result.report.teamName}_${reportType === 'special' ? '专项' : '体能'}周总结_${result.report.range.from}.pdf`
      );
      if (version === state.version)
        setMessage('报告已保存并开始下载；同队同周同类型的上一份已替换。');
    } catch (e) {
      if (version === state.version) {
        setError(e instanceof Error ? e.message : '保存或下载失败，请重试。');
        errorRef.current?.focus();
      }
    } finally {
      if (version === state.version) setBusy(false);
    }
  }
  async function openHistory(id: string) {
    const version = ++state.version;
    setBusy(true);
    setError('');
    try {
      const result = await api.weeklySavedReport(id);
      if (version === state.version) {
        setSaved(result);
        setDraft(null);
        setDate(result.report.range.from);
        setStage(result.report.stage);
        setCoachNotes(result.report.coachNotes);
        setPhotos(result.photos);
        setFiles([]);
        setMessage('正在查看已确认快照；后续补录不会改变这份报告。');
      }
    } catch (e) {
      if (version === state.version)
        setError(e instanceof Error ? e.message : '历史报告加载失败。');
    } finally {
      if (version === state.version) setBusy(false);
    }
  }
  async function downloadHistory(value: SavedTeamWeeklyReport) {
    setBusy(true);
    try {
      await api.downloadSavedWeekly(
        value.id,
        `${value.report.teamName}_周总结_${value.report.range.from}.pdf`
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : '下载失败。');
    } finally {
      setBusy(false);
    }
  }
  const visible = draft?.data || saved?.report;
  return (
    <PageContainer className="reports-page">
      <PageHeader
        eyebrow="WEEKLY TRAINING REPORT"
        title="训练周总结"
        supportingContent={<p>把本周训练、教练观察与图表整理成可汇报、可保存的周总结。</p>}
      />
      <AppCard>
        <header className="reports-heading">
          <FileText size={22} aria-hidden="true" />
          <div>
            <h2>生成周总结</h2>
            <p>选择报告类型，其余内容由系统自动整理。</p>
          </div>
        </header>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void generate();
          }}
        >
          <fieldset className="reports-controls" disabled={busy || loading}>
            <legend>报告范围</legend>
            <label>
              报告类型
              <select
                value={reportType}
                onChange={(e) => {
                  invalidate(true);
                  setReportType(e.target.value as 'special' | 'physical');
                }}
              >
                <option value="physical">体能训练周总结</option>
                <option value="special">专项训练周总结</option>
              </select>
            </label>
            <label>
              项目
              <input value={projectLabel(project)} readOnly />
            </label>
            <label>
              队伍
              <select
                required
                value={selectedTeam}
                onChange={(e) => {
                  invalidate(true);
                  setSelectedTeam(e.target.value);
                }}
              >
                <option value="">{loading ? '正在加载…' : '请选择队伍'}</option>
                {teams.map((t) => (
                  <option value={t.id} key={t.id}>
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
                  invalidate();
                  setDate(e.target.value);
                }}
              />
            </label>
          </fieldset>
          <details className="reports-supplement">
            <summary>补充信息（选填）</summary>
            <fieldset disabled={busy} className="reports-controls">
              <legend>本周背景与附件</legend>
              <label>
                训练阶段名称
                <input
                  maxLength={100}
                  value={stage}
                  placeholder="例如：夏训第13周、赛前调整阶段"
                  onChange={(e) => {
                    invalidate();
                    setStage(e.target.value);
                  }}
                />
              </label>
              <label className="reports-commentary-field">
                本周训练背景与教练观察
                <textarea
                  maxLength={3000}
                  rows={4}
                  value={coachNotes}
                  placeholder="可写本周目标、队员反应、临时调整及原因、下周重点。留空也可以生成。"
                  onChange={(e) => {
                    invalidate();
                    setCoachNotes(e.target.value);
                  }}
                />
              </label>
              <label>
                训练照片（选填，自动压缩）
                <input
                  ref={photoInputRef}
                  type="file"
                  multiple
                  accept="image/jpeg,image/png,image/webp"
                  onChange={(e) => {
                    const chosen = Array.from(e.target.files || []);
                    if (chosen.length + photos.length > 8) {
                      setError('每次报告最多八张照片，请减少后重试。');
                      return;
                    }
                    invalidate();
                    setFiles(chosen);
                  }}
                />
              </label>
            </fieldset>
            {(files.length > 0 || photos.length > 0) && (
              <div className="reports-photo-list">
                {files.map((file, i) => (
                  <p key={`${file.name}:${i}`}>
                    <ImagePlus size={16} aria-hidden="true" />
                    {file.name}
                    <button
                      className="secondary-button"
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        invalidate();
                        setFiles((v) => v.filter((_, j) => j !== i));
                        photoInputRef.current?.focus();
                      }}
                      aria-label={`移除 ${file.name}`}
                    >
                      <X size={16} aria-hidden="true" />
                    </button>
                  </p>
                ))}
                {photos.map((photo, i) => (
                  <figure key={photo.id}>
                    <WeeklyReportPhoto id={photo.id} index={i} />
                    <button
                      type="button"
                      className="secondary-button"
                      disabled={busy}
                      onClick={() => {
                        invalidate();
                        setPhotos((v) => v.filter((p) => p.id !== photo.id));
                        photoInputRef.current?.focus();
                      }}
                    >
                      移除照片 {i + 1}
                    </button>
                  </figure>
                ))}
              </div>
            )}
          </details>
          <label className="reports-consent">
            <input
              type="checkbox"
              disabled={busy}
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
            />
            允许 AI
            结合去身份化训练统计与可发送的教练训练补充起草；身份、健康信息和照片保留本地。不启用也能生成。
          </label>
          <div className="reports-footer">
            <p className="reports-period">
              {range ? `${range.from} 至 ${range.to}（周一至周日）` : '请选择周次'}
            </p>
            <button
              className="primary-button"
              type="submit"
              disabled={busy || loading || !teams.length}
            >
              <Sparkles size={16} aria-hidden="true" />
              {busy ? '正在处理…' : '一键生成周总结'}
            </button>
          </div>
        </form>
        <p role="status" aria-live="polite">
          {message}
        </p>
        <p id="weekly-report-form-error" role="alert" tabIndex={-1} ref={errorRef}>
          {error}
        </p>
        {!loading && !teams.length && <p>当前项目暂无可访问队伍。</p>}
      </AppCard>
      {visible && (
        <>
          <TeamWeeklyReportPreview
            report={visible}
            commentary={draft?.commentary || saved?.commentary}
            onCommentaryChange={draft && !busy ? updateCommentary : undefined}
            commentaryErrorId={commentaryInvalid ? 'weekly-report-form-error' : undefined}
          />
          {(draft ? photos : saved?.photos || []).length > 0 && (
            <AppCard>
              <h2>训练照片附件</h2>
              <div className="reports-photo-list">
                {(draft ? photos : saved?.photos || []).map((p, i) => (
                  <figure key={p.id}>
                    <WeeklyReportPhoto id={p.id} index={i} />
                    <figcaption>训练照片 {i + 1}</figcaption>
                  </figure>
                ))}
              </div>
            </AppCard>
          )}
          <div className="reports-actions">
            {draft ? (
              <button
                type="button"
                className="primary-button"
                disabled={busy}
                onClick={() => void saveAndDownload()}
              >
                <Download size={16} aria-hidden="true" />
                保存并下载
              </button>
            ) : (
              saved && (
                <>
                  <p>
                    已确认保存：
                    {new Intl.DateTimeFormat('zh-CN', {
                      timeZone: 'Asia/Shanghai',
                      dateStyle: 'medium',
                      timeStyle: 'short',
                    }).format(new Date(saved.savedAt))}
                  </p>
                  <button
                    type="button"
                    className="primary-button"
                    disabled={busy}
                    onClick={() => void downloadHistory(saved)}
                  >
                    <Download size={16} aria-hidden="true" />
                    下载已保存报告
                  </button>
                </>
              )
            )}
          </div>
        </>
      )}
      <AppCard>
        <header className="reports-heading">
          <h2>历史报告</h2>
          <button
            type="button"
            className="secondary-button"
            disabled={busy || !selectedTeam}
            onClick={() => setHistoryRetry((v) => v + 1)}
          >
            <RefreshCw size={16} aria-hidden="true" />
            刷新
          </button>
        </header>
        <label>
          筛选历史周次（留空查看全部）
          <input
            type="date"
            value={historyWeek}
            disabled={busy}
            onChange={(e) => {
              setHistoryWeek(e.target.value);
              setHistoryPage(1);
            }}
          />
        </label>
        <p role="status" aria-live="polite">
          {historyLoading
            ? '正在加载历史报告…'
            : historyError ||
              (history
                ? `共${history.total}份报告，当前第${history.page}页。`
                : '请选择队伍查看历史报告。')}
        </p>
        {history?.items.length ? (
          <ul className="reports-history-list">
            {history.items.map((item) => (
              <li key={item.id}>
                <span>
                  {item.teamName} · {item.weekStart} ·{' '}
                  {item.reportType === 'special' ? '专项' : '体能'}
                </span>
                <button
                  type="button"
                  className="secondary-button"
                  disabled={busy}
                  onClick={() => void openHistory(item.id)}
                >
                  查看报告
                </button>
              </li>
            ))}
          </ul>
        ) : (
          !historyLoading && <p>当前条件下暂无已确认报告。</p>
        )}
        {history && history.total > history.pageSize && (
          <div className="reports-actions">
            <button
              type="button"
              className="secondary-button"
              disabled={busy || historyPage === 1}
              onClick={() => setHistoryPage((v) => v - 1)}
            >
              上一页
            </button>
            <span>第{historyPage}页</span>
            <button
              type="button"
              className="secondary-button"
              disabled={busy || historyPage * history.pageSize >= history.total}
              onClick={() => setHistoryPage((v) => v + 1)}
            >
              下一页
            </button>
          </div>
        )}
      </AppCard>
    </PageContainer>
  );
}
