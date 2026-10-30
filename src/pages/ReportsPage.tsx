import { useEffect, useRef, useState } from 'react';
import { FileText, Sparkles, ImagePlus, X } from 'lucide-react';
import { api } from '../api';
import type { Project, ProjectTeam } from '../types';
import { projectLabel } from '../../shared/projects';
import { reportPeriod } from '../../shared/training-report';
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
  const [stage, setStage] = useState('');
  const [coachNotes, setCoachNotes] = useState('');
  const [consent, setConsent] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const photoInputRef = useRef<HTMLInputElement>(null);
  const errorRef = useRef<HTMLParagraphElement>(null);
  const state = useRef({ version: 0 }).current;
  const running = useRef(false);
  const range = date ? reportPeriod('week', date) : null;
  useEffect(() => {
    let active = true;
    setLoading(true);
    setTeams([]);
    setFiles([]);
    setMessage('');
    setError('');
    api
      .overviewTeams(project)
      .then((result) => {
        if (!active) return;
        setTeams(result.teams);
        setSelectedTeam(
          result.teams.some((t) => t.id === teamId)
            ? String(teamId)
            : result.teams.length === 1
              ? String(result.teams[0].id)
              : ''
        );
      })
      .catch((e) => {
        if (active) setError(e instanceof Error ? e.message : '队伍加载失败。');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
      state.version++;
    };
  }, [project, teamId, state]);
  function invalidate() {
    setError('');
    setMessage('');
  }
  async function generate() {
    if (running.current) return;
    if (!selectedTeam || !range) {
      setError('请选择队伍和有效周次。');
      errorRef.current?.focus();
      return;
    }
    const current = state.version;
    running.current = true;
    setBusy(true);
    setError('');
    setMessage('正在汇总数据并生成 Word，请稍候…');
    try {
      await api.downloadWeeklyReport(
        { query: { project, teamId: Number(selectedTeam), date }, stage, coachNotes, consent },
        files
      );
      if (current === state.version) setMessage('已开始下载，需要修改时直接编辑下载的 Word 文件。');
    } catch (e) {
      if (current === state.version) {
        setMessage('');
        setError(e instanceof Error ? e.message : '生成失败，请重试。');
        errorRef.current?.focus();
      }
    } finally {
      running.current = false;
      setBusy(false);
    }
  }
  return (
    <PageContainer className="reports-page">
      <PageHeader
        eyebrow="WEEKLY TRAINING REPORT"
        title="训练周总结"
        supportingContent={<p>一键生成并下载 Word，内容需要修改时直接编辑下载的文件。</p>}
      />
      <AppCard>
        <header className="reports-heading">
          <FileText size={22} aria-hidden="true" />
          <div>
            <h2>生成周总结</h2>
            <p>自动整合专项与体能训练，其余补充信息选填。</p>
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
              项目
              <input value={projectLabel(project)} readOnly />
            </label>
            <label>
              队伍
              <select
                required
                value={selectedTeam}
                onChange={(e) => {
                  invalidate();
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
                    if (chosen.length > 8) {
                      setError('每次报告最多八张照片，请减少后重试。');
                      return;
                    }
                    invalidate();
                    setFiles(chosen);
                  }}
                />
              </label>
            </fieldset>
            {files.length > 0 && (
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
              {busy ? '正在处理…' : '生成并下载 Word'}
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
    </PageContainer>
  );
}
