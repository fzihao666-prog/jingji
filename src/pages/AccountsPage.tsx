import { Check, Clock3, UserCheck, UserRound, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api } from '../api';
import { EditableName } from '../components/EditableName';
import { ContentState, PageContainer, PageHeader } from '../components/PageLayout';
import type { RegistrationRequest } from '../types';
import { projectLabel } from '../../shared/projects';

type Filter = 'pending' | 'approved' | 'rejected';

const filterLabels: Record<Filter, string> = {
  pending: '待审核',
  approved: '已通过',
  rejected: '已拒绝',
};

export function AccountsPage() {
  const [filter, setFilter] = useState<Filter>('pending');
  const [requests, setRequests] = useState<RegistrationRequest[]>([]);
  const [pending, setPending] = useState(0);
  const [loading, setLoading] = useState(true);
  const [workingId, setWorkingId] = useState<number | null>(null);
  const [message, setMessage] = useState('');
  const [approvalEnabled, setApprovalEnabled] = useState(true);
  const [approvalLoading, setApprovalLoading] = useState(true);
  const [approvalWorking, setApprovalWorking] = useState(false);

  const load = async (nextFilter = filter) => {
    setLoading(true);
    try {
      const result = await api.registrations(nextFilter);
      setRequests(result.requests);
      setPending(result.pending);
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
      setMessage(result.enabled ? '注册审核已开启，新注册进入待审核。' : '注册审核已关闭，新注册将自动开通。');
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
                : '关闭：新注册自动开通并可立即登录；历史待审核与已处理申请不受影响。'}
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
            className={filter === item ? 'active' : ''}
            onClick={() => setFilter(item)}
          >
            {filterLabels[item]}
          </button>
        ))}
      </div>
      {message && <div className="message-banner success">{message}</div>}

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
                  <h2>
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
                  @{request.username} · {request.gender} · 手机：
                  {request.phone || '未填'} · 籍贯：{request.nativePlace} · 身份证：
                  {request.identityNumber} · {projectLabel(request.project || '')} · {request.team}
                </p>
              </div>
              <time>
                {new Date(request.createdAt.replace(' ', 'T') + 'Z').toLocaleDateString('zh-CN')}
              </time>
              {filter === 'pending' && (
                <div className="review-actions">
                  <button
                    className="reject-button"
                    disabled={workingId === request.id}
                    onClick={() => review(request, 'reject')}
                  >
                    <X size={16} />
                    拒绝
                  </button>
                  <button
                    className="approve-button"
                    disabled={workingId === request.id}
                    onClick={() => review(request, 'approve')}
                  >
                    <Check size={16} />
                    通过
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
