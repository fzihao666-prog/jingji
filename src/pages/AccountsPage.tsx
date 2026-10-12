import { Check, Clock3, UserCheck, UserRound, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { EditableName } from '../components/EditableName';
import { ContentState, PageContainer, PageHeader } from '../components/PageLayout';
import type { ProjectTeam, RegistrationRequest } from '../types';
import { projectLabel } from '../../shared/projects';

type Filter = 'pending' | 'approved' | 'rejected';

const filterLabels: Record<Filter, string> = {
  pending: '待审核',
  approved: '已开通',
  rejected: '已拒绝',
};

export function AccountsPage() {
  const pendingFocus = useRef<{ id: number; target: 'project' | 'edit' | 'heading' } | null>(null);
  const activeFilterButton = useRef<HTMLButtonElement | null>(null);
  const focusTarget = (element: HTMLElement | null, id: number, target: 'project' | 'edit' | 'heading') => {
    if (element && !element.matches(':disabled') && pendingFocus.current?.id === id && pendingFocus.current.target === target) {
      element.focus();
      pendingFocus.current = null;
    }
  };
  const [filter, setFilter] = useState<Filter>('pending');
  const [requests, setRequests] = useState<RegistrationRequest[]>([]);
  const [teams, setTeams] = useState<ProjectTeam[]>([]);
  const [teamEdit, setTeamEdit] = useState<{ id: number; project: string; team: string } | null>(null);
  const [pending, setPending] = useState(0);
  const [loading, setLoading] = useState(true);
  const [workingId, setWorkingId] = useState<number | null>(null);
  const [message, setMessage] = useState('');
  const [approvalEnabled, setApprovalEnabled] = useState(true);
  const [approvalLoading, setApprovalLoading] = useState(true);
  const [approvalWorking, setApprovalWorking] = useState(false);

  useEffect(() => {
    if (!loading && workingId === null && pendingFocus.current) {
      activeFilterButton.current?.focus();
      pendingFocus.current = null;
    }
  }, [loading, workingId]);

  const load = async (nextFilter = filter) => {
    setLoading(true);
    try {
      const [result, teamResult] = await Promise.all([api.registrations(nextFilter), api.teams()]);
      setTeams(teamResult.teams);
      setRequests(result.requests);
      setPending(result.pending);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '账户申请加载失败。');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load(filter);
  }, [filter]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const result = await api.registrationApproval();
        if (!cancelled) setApprovalEnabled(result.enabled);
      } catch (error) {
        if (!cancelled)
          setMessage(error instanceof Error ? error.message : '注册审核开关加载失败。');
      } finally {
        if (!cancelled) setApprovalLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const toggleApproval = async () => {
    setApprovalWorking(true);
    setMessage('');
    try {
      const result = await api.setRegistrationApproval(!approvalEnabled);
      setApprovalEnabled(result.enabled);
      setMessage(result.enabled ? '注册审核已开启，新注册进入待审核。' : '注册审核已关闭，运动员可自动开通但入队待核实；教练仍需审核。');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '注册审核开关更新失败。');
    } finally {
      setApprovalWorking(false);
    }
  };

  const review = async (request: RegistrationRequest, action: 'approve' | 'reject') => {
    if (action === 'reject' && !window.confirm(`确认拒绝 ${request.displayName} 的注册申请？`))
      return;
    setWorkingId(request.id);
    setMessage('');
    try {
      const result = await api.reviewRegistration(request.id, action);
      setMessage(result.message);
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '操作失败。');
    } finally {
      setWorkingId(null);
    }
  };

  const verifyTeam = async (request: RegistrationRequest, approved: boolean) => {
    if (!window.confirm(approved
      ? `确认 ${request.displayName} 的入队归属？`
      : `确认拒绝 ${request.displayName} 入队并停用账号？`)) return;
    setWorkingId(request.id);
    setMessage('');
    try {
      const result = await api.verifyRegistrationTeam(request.id, approved);
      pendingFocus.current = { id: request.id, target: 'heading' };
      setMessage(result.message);
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '入队核实失败。');
    } finally {
      setWorkingId(null);
    }
  };

  const saveTeam = async () => {
    if (!teamEdit) return;
    setWorkingId(teamEdit.id);
    setMessage('');
    try {
      const result = await api.updateRegistrationTeam(teamEdit.id, teamEdit.project, teamEdit.team);
      setMessage(result.message);
      pendingFocus.current = { id: teamEdit.id, target: 'edit' };
      setTeamEdit(null);
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '项目队伍更正失败。');
    } finally {
      setWorkingId(null);
    }
  };

  const renameRequest = async (requestId: number, name: string) => {
    const result = await api.renameRegistration(requestId, name);
    setRequests((current) =>
      current.map((request) =>
        request.id === requestId ? { ...request, displayName: name } : request
      )
    );
    setMessage(result.message);
  };

  return (
    <PageContainer className="accounts-page">
      <PageHeader
        variant="compact"
        eyebrow="ACCOUNT REVIEW"
        title="账户审核"
        actions={
          <span className="pending-count">
            <Clock3 size={16} />
            {pending}项待处理
          </span>
        }
      />

      <section className="registration-approval-panel" aria-label="注册审核开关">
        <div className="registration-approval-copy">
          <strong>注册审核</strong>
          <p>
            {approvalLoading
              ? '正在加载开关状态…'
              : approvalEnabled
                ? '开启：新注册进入待审核，由有权限的上级在下方通过或拒绝；仅影响开关之后的新申请。'
                : '关闭：运动员新注册自动开通，入队归属仍需核实；体能教练仍需人工审核。历史申请不受影响。'}
          </p>
        </div>
        <button
          type="button"
          className={`registration-approval-toggle ${approvalEnabled ? 'on' : 'off'}`}
          role="switch"
          aria-checked={approvalEnabled}
          aria-label="注册审核开关"
          disabled={approvalLoading || approvalWorking}
          onClick={() => void toggleApproval()}
        >
          <span className="registration-approval-thumb" />
        </button>
      </section>

      <div className="account-filters">
        {(Object.keys(filterLabels) as Filter[]).map((item) => (
          <button
            key={item}
            ref={item === filter ? activeFilterButton : undefined}
            className={filter === item ? 'active' : ''}
            onClick={() => setFilter(item)}
          >
            {filterLabels[item]}
          </button>
        ))}
      </div>
      <div role="status" aria-live="polite">
        {message && <div className="message-banner success">{message}</div>}
      </div>

      {loading ? (
        <ContentState kind="loading" title="正在加载账户申请…" />
      ) : requests.length ? (
        <section className="account-list">
          {requests.map((request) => (
            <article key={request.id}>
              <div className="request-avatar">
                {request.requestedRole === 'SCC' ? <UserCheck /> : <UserRound />}
              </div>
              <div className="request-main">
                <div>
                  <h2 tabIndex={-1} ref={(element) => focusTarget(element, request.id, 'heading')}>
                    <EditableName
                      value={request.displayName}
                      canEdit
                      onSave={(name) => renameRequest(request.id, name)}
                      label="申请人姓名"
                    />
                  </h2>
                  <span>{request.requestedRole === 'SCC' ? '队伍体能教练' : '运动员'}</span>
                </div>
                <p>
                  @{request.username} · 性别：{request.gender || '未录入'} · 出生日期：
                  {request.birthDate || '未录入'} · 手机：
                  {request.phone || '未填'} · 籍贯：{request.nativePlace || '未填'} ·{' '}
                  {projectLabel(request.project || '')} · {request.team}
                </p>
                {request.status === 'approved' && request.teamVerification === 'pending' && (
                  <span className="review-result pending">自动开通 · 入队待核实</span>
                )}
                {request.teamVerification === 'verified' && (
                  <span className="review-result approved">入队已核实</span>
                )}
                {request.status === 'pending' && (teamEdit?.id === request.id ? (
                  <form onSubmit={(event) => { event.preventDefault(); void saveTeam(); }}>
                    <label>
                      项目
                      <select
                        ref={(element) => focusTarget(element, request.id, 'project')}
                        value={teamEdit.project}
                        disabled={workingId === request.id}
                        required
                        onChange={(event) => setTeamEdit({ ...teamEdit, project: event.target.value, team: '' })}
                      >
                        <option value="">请选择项目</option>
                        {[...new Set(teams.map((team) => team.project))].map((project) => (
                          <option key={project} value={project}>{projectLabel(project)}</option>
                        ))}
                      </select>
                    </label>
                    <label>
                      队伍
                      <select
                        value={teamEdit.team}
                        disabled={workingId === request.id}
                        required
                        onChange={(event) => setTeamEdit({ ...teamEdit, team: event.target.value })}
                      >
                        <option value="">请选择队伍</option>
                        {teams.filter((team) => team.project === teamEdit.project).map((team) => (
                          <option key={team.id} value={team.name}>{team.name}</option>
                        ))}
                      </select>
                    </label>
                    <button type="submit" disabled={workingId === request.id}>保存更正</button>
                    <button type="button" disabled={workingId === request.id} onClick={() => { pendingFocus.current = { id: request.id, target: 'edit' }; setTeamEdit(null); }}>取消</button>
                  </form>
                ) : (
                  <button type="button" ref={(element) => focusTarget(element, request.id, 'edit')} disabled={workingId === request.id} onClick={() => { pendingFocus.current = { id: request.id, target: 'project' }; setTeamEdit({ id: request.id, project: request.project || '', team: request.team || '' }); }}>
                    更正项目队伍
                  </button>
                ))}
              </div>
              <time>
                {new Date(request.createdAt.replace(' ', 'T') + 'Z').toLocaleDateString('zh-CN')}
              </time>
              {filter === 'pending' && (
                <div className="review-actions">
                  <button
                    className="reject-button"
                    disabled={workingId === request.id || teamEdit?.id === request.id}
                    onClick={() => review(request, 'reject')}
                  >
                    <X size={16} />
                    拒绝
                  </button>
                  <button
                    className="approve-button"
                    disabled={workingId === request.id || teamEdit?.id === request.id}
                    onClick={() => review(request, 'approve')}
                  >
                    <Check size={16} />
                    通过
                  </button>
                </div>
              )}
              {request.status === 'approved' && request.teamVerification === 'pending' && (
                <div className="review-actions">
                  <button type="button" className="reject-button" disabled={workingId === request.id} onClick={() => void verifyTeam(request, false)}>
                    <X size={16} />拒绝入队
                  </button>
                  <button type="button" className="approve-button" disabled={workingId === request.id} onClick={() => void verifyTeam(request, true)}>
                    <Check size={16} />确认入队
                  </button>
                </div>
              )}
              {filter !== 'pending' && (
                <span className={`review-result ${filter}`}>{filterLabels[filter]}</span>
              )}
            </article>
          ))}
        </section>
      ) : (
        <ContentState
          kind="empty"
          className="account-empty"
          icon={<UserCheck size={34} />}
          title={`没有${filterLabels[filter]}申请`}
        />
      )}
    </PageContainer>
  );
}
