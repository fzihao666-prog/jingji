import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import type { Athlete, User } from '../types';
import type { TeamPlan, TeamPlanOverride, TeamPlanSession } from '../../shared/team-plan';
import { resolveTeamPlanSessions } from '../../shared/team-plan';
import { projectLabel } from '../../shared/projects';
import { weekStart, addPlanDays } from '../pages/training-plan-week';
import {
  hasUnsupportedPlanFields,
  movePlanSession,
  planSessionChanges,
  removePlanSession,
  replacePlanSession,
} from '../pages/training-plan-edit';
import { TrainingPlanWeekView } from './TrainingPlanWeekView';
import { TrainingPlanSessionEditor } from './TrainingPlanSessionEditor';
import './TrainingPlanWorkspace.css';

type Props = {
  plan: TeamPlan;
  previousPlan?: TeamPlan;
  athletes: Pick<Athlete, 'id' | 'name' | 'teamId' | 'project'>[];
  user: User;
  onSaved: (plan: TeamPlan) => void;
  onDirtyChange: (dirty: boolean) => void;
};
type Editor = { session: TeamPlanSession; mode: 'session' | 'override'; athleteId: number };
const categoryLabels = { special: '专项', physical: '体能', recovery: '恢复' };
const statusLabels = { draft: '草稿', pending: '待审核', published: '已发布', archived: '已归档' };
const changeLabels: Record<string, string> = {
  period: '时段',
  content: '内容',
  durationMin: '时长（分钟）',
  distanceKm: '距离（公里）',
  intensity: '强度',
  sets: '组数',
  reps: '次数',
  load: '负重',
  notes: '备注',
};
const beijingToday = () =>
  new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai' }).format(new Date());
const differenceText = (item: TeamPlanOverride) =>
  Object.entries(item.changes)
    .map(([key, value]) => `${changeLabels[key] || key}：${value ?? '未设置'}`)
    .join('；');

export function TrainingPlanWorkspace({
  plan,
  previousPlan,
  athletes,
  user,
  onSaved,
  onDirtyChange,
}: Props) {
  const today = beijingToday();
  const initialDate = today >= plan.startDate && today <= plan.endDate ? today : plan.startDate;
  const [draft, setDraft] = useState(plan);
  const [baseline, setBaseline] = useState(plan);
  const [selectedDate, setSelectedDate] = useState(initialDate);
  const [start, setStart] = useState(weekStart(initialDate));
  const [previewId, setPreviewId] = useState(user.role === 'ATL' ? user.athleteId || 0 : 0);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [editorDirty, setEditorDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [preview, setPreview] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const dayHeading = useRef<HTMLHeadingElement>(null);
  const athleteSelect = useRef<HTMLSelectElement>(null);
  const draftDirty = JSON.stringify(draft.data) !== JSON.stringify(baseline.data);
  const dirty = draftDirty || editorDirty;
  const manager = ['SCC', 'REG', 'TD', 'DMD'].includes(user.role);
  const unsupported = hasUnsupportedPlanFields(draft);
  const editable = manager && draft.status === 'draft' && !unsupported && !saving;
  const scoped = athletes.filter(
    (athlete) => athlete.teamId === draft.teamId && athlete.project === draft.project
  );
  const sessions = previewId ? resolveTeamPlanSessions(draft, previewId) : draft.data.sessions;
  const daily = sessions.filter((session) => session.date === selectedDate);
  const withinPeriod = selectedDate >= draft.startDate && selectedDate <= draft.endDate;
  const priorOverride =
    editor?.mode === 'override'
      ? draft.data.overrides.find(
          (item) => item.sessionId === editor.session.id && item.athleteId === editor.athleteId
        )
      : undefined;
  const originalSession = editor
    ? draft.data.sessions.find((item) => item.id === editor.session.id)
    : undefined;

  const comparison = previousPlan || baseline;
  const lessonLabel = (id: string) => {
    const session =
      draft.data.sessions.find((item) => item.id === id) ||
      comparison.data.sessions.find((item) => item.id === id);
    return session
      ? `${session.date} ${session.period || '未指定时段'} · ${session.content}`
      : '已移除训练课';
  };
  const changes: string[] = [];
  for (const session of draft.data.sessions) {
    const old = comparison.data.sessions.find((item) => item.id === session.id);
    if (!old) {
      changes.push(`新增 ${session.date} ${session.period}：${session.content}`);
      continue;
    }
    for (const key of [
      'date',
      'category',
      'period',
      'content',
      'durationMin',
      'distanceKm',
      'intensity',
      'sets',
      'reps',
      'load',
      'notes',
    ] as const) {
      if (session[key] !== old[key])
        changes.push(
          `${session.date} ${session.period} ${changeLabels[key] || (key === 'date' ? '日期' : '类别')}：${old[key] ?? '未设置'} → ${session[key] ?? '未设置'}`
        );
    }
  }
  for (const old of comparison.data.sessions)
    if (!draft.data.sessions.some((item) => item.id === old.id))
      changes.push(`移除 ${old.date} ${old.period}：${old.content}`);
  const overrideKeys = new Set(
    [...comparison.data.overrides, ...draft.data.overrides].map(
      (item) => `${item.athleteId}:${item.sessionId}`
    )
  );
  for (const key of overrideKeys) {
    const old = comparison.data.overrides.find(
      (item) => `${item.athleteId}:${item.sessionId}` === key
    );
    const current = draft.data.overrides.find(
      (item) => `${item.athleteId}:${item.sessionId}` === key
    );
    if (
      JSON.stringify(old && { changes: old.changes, reason: old.reason }) !==
      JSON.stringify(current && { changes: current.changes, reason: current.reason })
    )
      changes.push(
        `个人调整 ${scoped.find((athlete) => athlete.id === (current || old)?.athleteId)?.name || '运动员'} · ${lessonLabel((current || old)!.sessionId)}：${old ? differenceText(old) : '继承队伍'} → ${current ? differenceText(current) : '恢复队伍'}；原因：${current?.reason || '撤销调整'}`
      );
  }
  useEffect(() => {
    if (editor?.mode === 'override' && !editor.athleteId) athleteSelect.current?.focus();
  }, [editor?.mode, editor?.athleteId, editor?.session.id]);
  useEffect(() => {
    onDirtyChange(dirty);
  }, [dirty, onDirtyChange]);
  useEffect(() => {
    if (!dirty) return;
    const preventExit = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', preventExit);
    return () => window.removeEventListener('beforeunload', preventExit);
  }, [dirty]);
  function permitSwitch() {
    return (
      !dirty ||
      window.confirm(
        '当前修改尚未保存到服务器。是否切换？编辑框内尚未加入草稿的内容将放弃，已加入草稿的修改会保留。'
      )
    );
  }
  function selectDate(date: string) {
    if (date === selectedDate) return;
    if (!permitSwitch()) return;
    setEditor(null);
    setEditorDirty(false);
    setSelectedDate(date);
    setStart(weekStart(date));
    setMessage(`已选择 ${date}，当日安排已更新。`);
  }
  function closeEditor() {
    if (editorDirty && !window.confirm('放弃编辑框中尚未保存的修改？')) return;
    setEditor(null);
    setEditorDirty(false);
    dayHeading.current?.focus();
  }
  function openEditor(session: TeamPlanSession, mode: Editor['mode']) {
    if (editorDirty && !window.confirm('放弃当前编辑框中尚未保存的修改？')) return;
    const base = draft.data.sessions.find((item) => item.id === session.id) || session;
    setEditor({ session: base, mode, athleteId: 0 });
    setEditorDirty(false);
    setError('');
  }
  function setOverrideAthlete(athleteId: number) {
    if (editorDirty && !window.confirm('放弃当前运动员尚未保存的调整？')) return;
    if (!editor || !originalSession) return;
    const previous = draft.data.overrides.find(
      (item) => item.sessionId === originalSession.id && item.athleteId === athleteId
    );
    setEditor({ ...editor, athleteId, session: { ...originalSession, ...previous?.changes } });
    setEditorDirty(false);
  }
  function saveSession(session: TeamPlanSession, reason: string) {
    if (!editable || !editor) return;
    if (editor.mode === 'session') setDraft((previous) => replacePlanSession(previous, session));
    else {
      const base = draft.data.sessions.find((item) => item.id === session.id);
      if (!base || !scoped.some((athlete) => athlete.id === editor.athleteId)) return;
      const changes = planSessionChanges(base, session);
      const now = new Date().toISOString();
      const overrides = draft.data.overrides.filter(
        (item) => !(item.sessionId === base.id && item.athleteId === editor.athleteId)
      );
      if (Object.keys(changes).length)
        overrides.push({
          ...priorOverride,
          athleteId: editor.athleteId,
          sessionId: base.id,
          changes,
          reason,
          createdBy: priorOverride?.createdBy || user.id,
          createdAt: priorOverride?.createdAt || now,
          updatedBy: user.id,
          updatedAt: now,
        });
      setDraft({ ...draft, data: { ...draft.data, overrides } });
    }
    setEditor(null);
    setEditorDirty(false);
    setConfirmed(false);
    setMessage('已加入草稿，周视图已更新；请保存草稿以同步到服务器。');
    dayHeading.current?.focus();
  }
  function restoreTeam() {
    if (!editable || !editor || !window.confirm('恢复该运动员的队伍原计划，移除这节课的个人调整？'))
      return;
    setDraft({
      ...draft,
      data: {
        ...draft.data,
        overrides: draft.data.overrides.filter(
          (item) => !(item.sessionId === editor.session.id && item.athleteId === editor.athleteId)
        ),
      },
    });
    setEditor(null);
    setEditorDirty(false);
    setConfirmed(false);
    setMessage('已恢复队伍计划；请保存草稿。');
    dayHeading.current?.focus();
  }
  async function saveDraft() {
    if (!editable || editor) return;
    setSaving(true);
    setError('');
    setMessage('');
    try {
      const result = await api.updateTeamPlan(draft);
      setDraft(result.plan);
      setBaseline(result.plan);
      setConfirmed(false);
      onSaved(result.plan);
      setMessage('草稿已保存到服务器。');
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败，修改仍保留在当前页。');
    } finally {
      setSaving(false);
    }
  }
  async function reload() {
    if (dirty && !window.confirm('重新载入会放弃当前未保存修改，是否继续？')) return;
    setSaving(true);
    setError('');
    try {
      const result = await api.teamPlans();
      const current = result.plans.find((item) => item.id === draft.id);
      if (!current) throw new Error('计划不再可访问，请重新选择计划。');
      setDraft(current);
      setBaseline(current);
      setEditor(null);
      setEditorDirty(false);
      setConfirmed(false);
      onSaved(current);
      setMessage('已载入最新版本。');
    } catch (err) {
      setError(err instanceof Error ? err.message : '重新载入失败。');
    } finally {
      setSaving(false);
    }
  }
  async function transition(action: 'submit' | 'return' | 'publish' | 'revise' | 'archive') {
    if (!manager || saving || dirty || editor || unsupported) return;
    if (action === 'publish' && !confirmed) return;
    if (
      !window.confirm(
        action === 'publish'
          ? `确认发布「${draft.title}」V${draft.version}？发布的是整个计划周期（${draft.startDate} 至 ${draft.endDate}），不仅当前周。`
          : action === 'revise'
            ? '基于已发布版本创建修订草稿，原版本及执行记录保持不变。是否继续？'
            : '确认执行此状态操作？'
      )
    )
      return;
    setSaving(true);
    setError('');
    setMessage('');
    try {
      const result = await api.transitionTeamPlan(draft.id, {
        revision: draft.revision,
        action,
        confirmed: action === 'publish',
      });
      setDraft(result.plan);
      setBaseline(result.plan);
      setConfirmed(false);
      onSaved(result.plan);
      setMessage(`操作成功：${statusLabels[result.plan.status]} V${result.plan.version}。`);
      dayHeading.current?.focus();
    } catch (err) {
      setError(err instanceof Error ? err.message : '状态操作失败。');
    } finally {
      setSaving(false);
    }
  }
  return (
    <section className="training-plan-workspace" aria-label="周计划编排">
      <div className="plan-workspace-preview-picker">
        {user.role === 'ATL' ? (
          <p>本人最终适用计划（已合并个人差异）</p>
        ) : (
          <div>
            <label htmlFor={`plan-preview-${draft.id}`}>最终适用计划预览</label>
            <select
              id={`plan-preview-${draft.id}`}
              value={previewId}
              onChange={(event) => {
                if (editorDirty && !window.confirm('放弃编辑框中未保存的修改并切换预览？')) return;
                setPreviewId(Number(event.target.value));
                setEditor(null);
                setEditorDirty(false);
              }}
            >
              <option value={0}>队伍主计划</option>
              {scoped.map((athlete) => (
                <option key={athlete.id} value={athlete.id}>
                  {athlete.name}
                </option>
              ))}
            </select>
          </div>
        )}
        <span className="plan-workspace-status">
          {statusLabels[draft.status]} · V{draft.version}
          {dirty ? ' · 有未保存修改' : ''}
        </span>
      </div>
      {unsupported && (
        <p role="note">
          此计划包含当前保存接口尚不支持的扩展字段，仅供查看，以免保存时丢失原字段。
        </p>
      )}
      <TrainingPlanWeekView
        sessions={sessions}
        overrides={draft.data.overrides}
        weekStart={start}
        selectedDate={selectedDate}
        today={today}
        onSelectDate={selectDate}
        onChangeWeek={(date) => selectDate(date)}
        onToday={() => selectDate(today)}
      />
      <div className="plan-workspace-day-heading">
        <h3 ref={dayHeading} tabIndex={-1}>
          {new Intl.DateTimeFormat('zh-CN', { weekday: 'long', timeZone: 'UTC' }).format(
            new Date(`${selectedDate}T00:00:00Z`)
          )}{' '}
          · {selectedDate}
        </h3>
        {editable && withinPeriod && (
          <button
            type="button"
            className="primary-button"
            onClick={() =>
              openEditor(
                {
                  id: crypto.randomUUID(),
                  date: selectedDate,
                  category: 'special',
                  period: '上午',
                  content: '',
                  durationMin: null,
                  distanceKm: null,
                  intensity: '',
                  sets: null,
                  reps: null,
                  load: null,
                  notes: '',
                },
                'session'
              )
            }
          >
            添加训练课
          </button>
        )}
      </div>
      {!withinPeriod && <p>所选日期不在计划周期内，不能添加训练课。</p>}
      {!daily.length && (
        <p className="plan-workspace-empty">当日暂无训练课，未安排不自动视为休息。</p>
      )}
      <div className="plan-workspace-layout">
        <div className="plan-workspace-lessons">
          {daily.map((session, index) => {
            const adjustments = draft.data.overrides.filter(
              (item) => item.sessionId === session.id
            );
            return (
              <article className="plan-workspace-lesson" key={session.id}>
                <div className="plan-workspace-lesson-heading">
                  <h4>
                    {session.period || '未指定时段'} · {categoryLabels[session.category]}
                  </h4>
                  <span>{new Set(adjustments.map((item) => item.athleteId)).size} 人调整</span>
                </div>
                <p className="plan-workspace-content">{session.content}</p>
                <p>
                  时长：{session.durationMin ?? '—'} 分钟
                  {session.category === 'special' && (
                    <>
                      {' '}
                      · 距离：{session.distanceKm ?? '—'} km · 强度：{session.intensity || '—'}
                    </>
                  )}
                  {session.category === 'physical' && (
                    <>
                      {' '}
                      · {session.sets ?? '—'} 组 × {session.reps ?? '—'} 次 · 负重：
                      {session.load ?? '—'}
                    </>
                  )}
                </p>
                {session.notes && <p className="plan-workspace-content">{session.notes}</p>}
                {adjustments.length > 0 && (
                  <details>
                    <summary>查看已调整运动员与差异</summary>
                    <ul>
                      {adjustments.map((item) => (
                        <li key={item.athleteId}>
                          {scoped.find((athlete) => athlete.id === item.athleteId)?.name ||
                            (user.role === 'ATL' ? '本人' : `运动员 ${item.athleteId}`)}
                          ：{differenceText(item)} · 原因：{item.reason}
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
                {editable && (
                  <div className="plan-workspace-actions">
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => openEditor(session, 'session')}
                    >
                      编辑队伍课
                    </button>
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => openEditor(session, 'override')}
                    >
                      个人调整
                    </button>
                    <button
                      type="button"
                      className="secondary-button"
                      aria-label={`上移训练课：${session.period} ${session.content}`}
                      disabled={index === 0 || Boolean(editor)}
                      onClick={() => {
                        setDraft(movePlanSession(draft, session.id, -1));
                        setConfirmed(false);
                      }}
                    >
                      上移
                    </button>
                    <button
                      type="button"
                      className="secondary-button"
                      aria-label={`下移训练课：${session.period} ${session.content}`}
                      disabled={index === daily.length - 1 || Boolean(editor)}
                      onClick={() => {
                        setDraft(movePlanSession(draft, session.id, 1));
                        setConfirmed(false);
                      }}
                    >
                      下移
                    </button>
                    <button
                      type="button"
                      className="secondary-button"
                      disabled={Boolean(editor)}
                      onClick={() => {
                        if (
                          window.confirm(
                            '删除此草稿训练课？该课个人调整也会一并移除；历史执行数据不受影响。'
                          )
                        ) {
                          setDraft(removePlanSession(draft, session.id));
                          setConfirmed(false);
                          dayHeading.current?.focus();
                        }
                      }}
                    >
                      删除训练课
                    </button>
                  </div>
                )}
              </article>
            );
          })}
        </div>
        {editor && editable && (
          <div className="plan-workspace-editor">
            {editor.mode === 'override' && (
              <>
                <h3>选择调整运动员</h3>
                <label htmlFor={`plan-athlete-${draft.id}`}>适用运动员</label>
                <select
                  id={`plan-athlete-${draft.id}`}
                  ref={athleteSelect}
                  value={editor.athleteId}
                  onChange={(event) => setOverrideAthlete(Number(event.target.value))}
                >
                  <option value={0}>请选择运动员</option>
                  {scoped.map((athlete) => (
                    <option key={athlete.id} value={athlete.id}>
                      {athlete.name}
                    </option>
                  ))}
                </select>
                {originalSession && (
                  <p>
                    队伍原计划：{originalSession.durationMin ?? '—'} 分钟 /{' '}
                    {originalSession.distanceKm ?? '—'} 公里 /{' '}
                    {originalSession.intensity || '未设置强度'}
                  </p>
                )}
                {priorOverride && (
                  <button type="button" className="secondary-button" onClick={restoreTeam}>
                    恢复队伍计划
                  </button>
                )}
              </>
            )}
            {editor.mode === 'session' || editor.athleteId > 0 ? (
              <TrainingPlanSessionEditor
                key={`${editor.session.id}:${editor.mode}:${editor.athleteId}`}
                session={editor.session}
                startDate={draft.startDate}
                endDate={draft.endDate}
                mode={editor.mode}
                reason={priorOverride?.reason}
                onSave={saveSession}
                onCancel={closeEditor}
                onDirtyChange={setEditorDirty}
              />
            ) : (
              <button type="button" className="secondary-button" onClick={closeEditor}>
                取消调整
              </button>
            )}
          </div>
        )}
      </div>
      <p>
        本日个人调整：
        {
          new Set(
            draft.data.overrides
              .filter((item) =>
                draft.data.sessions.some(
                  (session) => session.id === item.sessionId && session.date === selectedDate
                )
              )
              .map((item) => item.athleteId)
          ).size
        }{' '}
        人
      </p>
      <div className="plan-workspace-feedback">
        <p role="status" aria-live="polite">
          {saving ? '正在同步，请稍候…' : message}
        </p>
        {error && <p role="alert">{error}</p>}
      </div>
      {manager && (
        <div className="plan-workspace-actions">
          {draft.status === 'draft' && (
            <button
              type="button"
              className="primary-button"
              disabled={!editable || Boolean(editor) || !draftDirty}
              onClick={saveDraft}
            >
              保存草稿
            </button>
          )}
          <button
            type="button"
            className="secondary-button"
            disabled={Boolean(editor)}
            aria-expanded={preview}
            onClick={() => setPreview(!preview)}
          >
            预览计划
          </button>
          <button type="button" className="secondary-button" disabled={saving} onClick={reload}>
            重新载入
          </button>
          {draft.status === 'draft' && (
            <button
              type="button"
              className="secondary-button"
              disabled={dirty || Boolean(editor) || saving || unsupported}
              onClick={() => {
                setPreview(true);
                void transition('submit');
              }}
            >
              提交审核
            </button>
          )}
          {draft.status === 'pending' && (
            <button
              type="button"
              className="secondary-button"
              disabled={saving || unsupported}
              onClick={() => transition('return')}
            >
              退回修改
            </button>
          )}
          {draft.status === 'published' && (
            <button
              type="button"
              className="primary-button"
              disabled={saving || unsupported}
              onClick={() => transition('revise')}
            >
              创建修订草稿
            </button>
          )}
          {draft.status === 'published' && (
            <button
              type="button"
              className="secondary-button"
              disabled={saving || unsupported}
              onClick={() => transition('archive')}
            >
              归档计划
            </button>
          )}
        </div>
      )}
      {draftDirty && <p>训练课与个人调整尚未同步，请先保存草稿；保存后才能提交审核。</p>}
      {manager && (preview || draft.status === 'pending') && (
        <section className="plan-workspace-review" aria-label="发布前预览">
          <h3>发布前预览</h3>
          <p>
            {draft.team} · {projectLabel(draft.project)} · {draft.startDate} 至 {draft.endDate}
          </p>
          <p>
            目标：{draft.data.goal || '未设置'} · 重点：{draft.data.focus || '未设置'}
          </p>
          <p>
            当前周：{start} 至 {addPlanDays(start, 6)}；发布涵盖完整计划周期，共{' '}
            {draft.data.sessions.length} 节训练课、{draft.data.overrides.length} 项个人调整。
          </p>
          <ol>
            {draft.data.sessions.map((session) => (
              <li className="plan-workspace-content" key={session.id}>
                {session.date} {session.period} · {categoryLabels[session.category]} ·{' '}
                {session.content} · {session.durationMin ?? '—'} 分钟 / {session.distanceKm ?? '—'}{' '}
                km · 强度：{session.intensity || '—'}
                {session.category === 'physical' && (
                  <>
                    {' '}
                    · {session.sets ?? '—'} 组 × {session.reps ?? '—'} 次 · 负重：
                    {session.load ?? '—'}
                  </>
                )}
                {session.notes && <> · 备注：{session.notes}</>}
              </li>
            ))}
          </ol>
          <h4>个人调整名单</h4>
          {!draft.data.overrides.length ? (
            <p>无个人调整。</p>
          ) : (
            <ul>
              {draft.data.overrides.map((item) => (
                <li key={`${item.sessionId}:${item.athleteId}`}>
                  {scoped.find((athlete) => athlete.id === item.athleteId)?.name ||
                    `运动员 ${item.athleteId}`}{' '}
                  · {lessonLabel(item.sessionId)} · {differenceText(item)} · {item.reason}
                </li>
              ))}
            </ul>
          )}
          <h4>计划变化摘要{previousPlan ? `（相比 V${previousPlan.version}）` : ''}</h4>
          {changes.length ? (
            <ul>
              {changes.map((change, index) => (
                <li key={`${index}:${change}`}>{change}</li>
              ))}
            </ul>
          ) : (
            <p>
              {previousPlan ? '训练课与个人调整同前版。' : '首个发布版本，以以上完整安排为准。'}
            </p>
          )}
          <p>
            本地保存状态：
            {draftDirty ? '存在尚未保存的训练课或个人差异修改。' : '与当前已保存草稿一致。'}{' '}
            修订版请对照保留的前版内容核对；原发布时间和历史版本不覆盖。
          </p>
          {draft.status === 'pending' && (
            <>
              <label className="plan-workspace-confirm">
                <input
                  type="checkbox"
                  checked={confirmed}
                  onChange={(event) => setConfirmed(event.target.checked)}
                />
                我已核对每日训练安排、个人差异与完整发布周期
              </label>
              <button
                type="button"
                className="primary-button"
                disabled={!confirmed || saving || unsupported}
                onClick={() => transition('publish')}
              >
                确认发布
              </button>
            </>
          )}
        </section>
      )}
    </section>
  );
}
