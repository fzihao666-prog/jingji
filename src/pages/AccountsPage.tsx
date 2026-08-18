import { Check, Clock3, UserCheck, UserRound, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api } from '../api';
import type { RegistrationRequest } from '../types';
import { EditableName } from '../components/EditableName';

type Filter = 'pending' | 'approved' | 'rejected';

const filterLabels: Record<Filter, string> = { pending: '待审核', approved: '已通过', rejected: '已拒绝' };

export function AccountsPage() {
  const [filter, setFilter] = useState<Filter>('pending');
  const [requests, setRequests] = useState<RegistrationRequest[]>([]);
  const [pending, setPending] = useState(0);
  const [loading, setLoading] = useState(true);
  const [workingId, setWorkingId] = useState<number | null>(null);
  const [message, setMessage] = useState('');

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

  useEffect(() => { void load(filter); }, [filter]);

  const review = async (request: RegistrationRequest, action: 'approve' | 'reject') => {
    if (action === 'reject' && !window.confirm(`确认拒绝 ${request.displayName} 的注册申请？`)) return;
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
    setRequests((current) => current.map((request) => request.id === requestId ? { ...request, displayName: name } : request));
    setMessage(result.message);
  };

  return (
    <div className="page-content accounts-page">
      <header className="page-heading compact-heading">
        <h1>账户审核</h1>
        <span className="pending-count"><Clock3 size={16} />{pending}项待处理</span>
      </header>

      <div className="account-filters">
        {(Object.keys(filterLabels) as Filter[]).map((item) => (
          <button key={item} className={filter === item ? 'active' : ''} onClick={() => setFilter(item)}>{filterLabels[item]}</button>
        ))}
      </div>
      {message && <div className="message-banner success">{message}</div>}

      {loading ? <div className="simple-loading">正在加载…</div> : requests.length ? (
        <section className="account-list">
          {requests.map((request) => (
            <article key={request.id}>
              <div className="request-avatar">{request.requestedRole === 'SCC' ? <UserCheck /> : <UserRound />}</div>
              <div className="request-main">
                <div><h2><EditableName value={request.displayName} canEdit onSave={(name) => renameRequest(request.id, name)} label="申请人姓名" /></h2><span>{request.requestedRole === 'SCC' ? '队伍体能教练' : '运动员'}</span></div>
                <p>@{request.username} · {[request.region, request.city, request.county].filter(Boolean).join(' / ') || '未设置地区'} · {request.project} · {request.team}</p>
              </div>
              <time>{new Date(request.createdAt.replace(' ', 'T') + 'Z').toLocaleDateString('zh-CN')}</time>
              {filter === 'pending' && <div className="review-actions">
                <button className="reject-button" disabled={workingId === request.id} onClick={() => review(request, 'reject')}><X size={16} />拒绝</button>
                <button className="approve-button" disabled={workingId === request.id} onClick={() => review(request, 'approve')}><Check size={16} />通过</button>
              </div>}
              {filter !== 'pending' && <span className={`review-result ${filter}`}>{filterLabels[filter]}</span>}
            </article>
          ))}
        </section>
      ) : <div className="empty-state account-empty"><UserCheck size={34} /><strong>没有{filterLabels[filter]}申请</strong></div>}
    </div>
  );
}
