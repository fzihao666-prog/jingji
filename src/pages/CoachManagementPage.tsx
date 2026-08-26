import {
  AlertCircle,
  Check,
  Eye,
  Filter,
  LockKeyhole,
  PencilLine,
  Plus,
  RefreshCw,
  Search,
  SlidersHorizontal,
  UserRoundCheck,
  X
} from 'lucide-react';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { ROLE_META } from '../../shared/access';
import { COACH_CATEGORIES, DEFAULT_COACH_CATEGORY, type CoachCategory } from '../../shared/coach-categories';
import { api } from '../api';
import { EditableName } from '../components/EditableName';
import type { AccessAccount, Athlete, ProjectTeam, User } from '../types';

type AssignmentAthlete = Athlete & { coachIds: string };
type CoachAccount = Pick<AccessAccount, 'id' | 'username' | 'displayName' | 'active' | 'projects' | 'teams'> & { category: CoachCategory };
type StatusFilter = 'all' | 'active' | 'inactive';

const emptyCoachForm = { displayName: '', username: '', password: '', category: DEFAULT_COACH_CATEGORY, project: '', team: '' };

function assignedCoachIds(athlete: AssignmentAthlete) {
  return String(athlete.coachIds || '').split(',').map(Number).filter(Number.isFinite);
}

function uniqueById<T extends { id: number }>(items: T[]) {
  return [...new Map(items.map((item) => [item.id, item])).values()];
}

export function CoachManagementPage({ user, athletes: visibleAthletes, onChanged }: { user: User; athletes: Athlete[]; onChanged: () => void }) {
  const [athletes, setAthletes] = useState<AssignmentAthlete[]>([]);
  const [coaches, setCoaches] = useState<CoachAccount[]>([]);
  const [currentAccount, setCurrentAccount] = useState<AccessAccount | null>(null);
  const [teamDirectory, setTeamDirectory] = useState<ProjectTeam[]>([]);
  const [selectedCoachId, setSelectedCoachId] = useState<number | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [projectFilter, setProjectFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [detailOpen, setDetailOpen] = useState(false);
  const [scopeOpen, setScopeOpen] = useState(false);
  const [scopeSearch, setScopeSearch] = useState('');
  const [draftAthleteIds, setDraftAthleteIds] = useState<Set<number>>(new Set());
  const [createOpen, setCreateOpen] = useState(false);
  const [coachForm, setCoachForm] = useState(emptyCoachForm);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [messageTone, setMessageTone] = useState<'success' | 'error'>('success');

  const canManage = ROLE_META[user.role].level >= ROLE_META.PRJ.level;
  const canRename = ROLE_META[user.role].level > ROLE_META.SCC.level;

  const load = async () => {
    setLoading(true);
    try {
      const [assignmentResult, accessResult, teamResult] = await Promise.all([api.assignments(), api.accessAccounts(), api.teams()]);
      setAthletes(assignmentResult.athletes);
      setCurrentAccount(accessResult.current);
      setTeamDirectory(teamResult.teams);
      const categoryByCoachId = new Map(assignmentResult.coaches.map((coach) => [coach.id, coach.category]));
      const accessCoaches = [
        ...(accessResult.current?.role === 'SCC' ? [accessResult.current] : []),
        ...accessResult.accounts.filter((account) => account.role === 'SCC')
      ].map((account) => ({ id: account.id, username: account.username, displayName: account.displayName, active: account.active, projects: account.projects, teams: account.teams, category: categoryByCoachId.get(account.id) || DEFAULT_COACH_CATEGORY }));
      const assignmentCoaches = assignmentResult.coaches.map((coach) => ({ ...coach, username: '', active: 1, projects: [], teams: [] }));
      const nextCoaches = uniqueById([...assignmentCoaches, ...accessCoaches]);
      setCoaches(nextCoaches);
      setSelectedCoachId((current) => current && nextCoaches.some((coach) => coach.id === current) ? current : nextCoaches.find((coach) => coach.id === user.id)?.id || nextCoaches[0]?.id || null);
    } catch (error) {
      setMessageTone('error');
      setMessage(error instanceof Error ? error.message : '教练名册加载失败。');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, [user.id]);

  const shownAthletes = useMemo<AssignmentAthlete[]>(() => {
    if (athletes.length || !visibleAthletes.length) return athletes;
    return visibleAthletes.map((athlete) => ({ ...athlete, coachIds: athlete.coachUsers?.map((coach) => coach.id).join(',') || '' }));
  }, [athletes, visibleAthletes]);

  const coachProfiles = useMemo(() => coaches.map((coach) => {
    const ownedAthletes = shownAthletes.filter((athlete) => assignedCoachIds(athlete).includes(coach.id));
    const projectNames = [...new Set([...ownedAthletes.map((athlete) => athlete.project), ...coach.projects.filter((project) => project !== '*')].filter(Boolean))];
    const teamNames = [...new Set([...ownedAthletes.map((athlete) => athlete.team), ...coach.teams.filter((team) => team.team !== '*').map((team) => team.team)].filter(Boolean))];
    return { ...coach, athletes: ownedAthletes, projectNames, teamNames };
  }), [coaches, shownAthletes]);

  const projects = useMemo(() => [...new Set([...teamDirectory.map((team) => team.project), ...coachProfiles.flatMap((coach) => coach.projectNames)])].filter(Boolean), [teamDirectory, coachProfiles]);
  const filteredCoaches = useMemo(() => {
    const query = searchTerm.trim().toLocaleLowerCase();
    return coachProfiles.filter((coach) => {
      if (projectFilter && !coach.projectNames.includes(projectFilter)) return false;
      if (categoryFilter && coach.category !== categoryFilter) return false;
      if (statusFilter === 'active' && !coach.active) return false;
      if (statusFilter === 'inactive' && coach.active) return false;
      if (!query) return true;
      return [coach.displayName, coach.username, ...coach.projectNames, ...coach.teamNames].some((value) => value.toLocaleLowerCase().includes(query));
    });
  }, [coachProfiles, projectFilter, categoryFilter, statusFilter, searchTerm]);

  const selectedCoach = coachProfiles.find((coach) => coach.id === selectedCoachId) || null;
  const activeCount = coachProfiles.filter((coach) => coach.active).length;
  const coveredTeams = new Set(coachProfiles.flatMap((coach) => coach.teamNames)).size;
  const coveredAthletes = new Set(coachProfiles.flatMap((coach) => coach.athletes.map((athlete) => athlete.id))).size;

  const selectedGroups = useMemo(() => {
    if (!selectedCoach) return [];
    const groups = new Map<string, { project: string; team: string; athletes: AssignmentAthlete[] }>();
    selectedCoach.athletes.forEach((athlete) => {
      const key = `${athlete.project}::${athlete.team || '未分队'}`;
      const group = groups.get(key) || { project: athlete.project, team: athlete.team || '未分队', athletes: [] };
      group.athletes.push(athlete);
      groups.set(key, group);
    });
    return [...groups.values()];
  }, [selectedCoach]);

  const scopeAthletes = useMemo(() => {
    const query = scopeSearch.trim().toLocaleLowerCase();
    return [...shownAthletes]
      .filter((athlete) => !query || [athlete.name, athlete.project, athlete.team, athlete.region, athlete.coaches].some((value) => String(value || '').toLocaleLowerCase().includes(query)))
      .sort((left, right) => Number(draftAthleteIds.has(right.id)) - Number(draftAthleteIds.has(left.id)) || `${left.project}${left.team}${left.name}`.localeCompare(`${right.project}${right.team}${right.name}`, 'zh-CN'));
  }, [shownAthletes, scopeSearch, draftAthleteIds]);

  const formTeams = teamDirectory.filter((team) => !coachForm.project || team.project === coachForm.project);
  const openDetail = (coachId: number) => { setSelectedCoachId(coachId); setDetailOpen(true); };
  const openScope = () => {
    if (!selectedCoach) return;
    setScopeSearch('');
    setDraftAthleteIds(new Set(selectedCoach.athletes.map((athlete) => athlete.id)));
    setDetailOpen(false);
    setScopeOpen(true);
  };
  const toggleDraftAthlete = (athleteId: number) => setDraftAthleteIds((current) => {
    const next = new Set(current);
    if (next.has(athleteId)) next.delete(athleteId); else next.add(athleteId);
    return next;
  });

  const saveScope = async () => {
    if (!selectedCoach) return;
    const changed = shownAthletes.filter((athlete) => assignedCoachIds(athlete).includes(selectedCoach.id) !== draftAthleteIds.has(athlete.id));
    if (!changed.length) { setScopeOpen(false); return; }
    setSaving(true);
    let updated = 0;
    try {
      for (const athlete of changed) {
        const currentCoachIds = assignedCoachIds(athlete);
        const nextCoachIds = draftAthleteIds.has(athlete.id) ? [...new Set([...currentCoachIds, selectedCoach.id])] : currentCoachIds.filter((coachId) => coachId !== selectedCoach.id);
        await api.updateAssignment(athlete.id, nextCoachIds, athlete.region, athlete.city, athlete.county);
        updated += 1;
      }
      await load(); onChanged();
      setMessageTone('success'); setMessage(`已更新 ${selectedCoach.displayName} 的责任范围，共同步 ${updated} 名运动员。`); setScopeOpen(false);
    } catch (error) {
      setMessageTone('error'); setMessage(`${updated ? `已完成 ${updated} 项，` : ''}${error instanceof Error ? error.message : '责任范围保存失败。'}`);
      if (updated) await load();
    } finally { setSaving(false); }
  };

  const renameCoach = async (coachId: number, name: string) => {
    await api.renameUser(coachId, name); await load(); onChanged(); setMessageTone('success'); setMessage('教练姓名已同步更新。');
  };

  const updateCoachCategory = async (coachId: number, category: CoachCategory) => {
    setSaving(true);
    try {
      const result = await api.updateCoachCategory(coachId, category);
      setCoaches((current) => current.map((coach) => coach.id === coachId ? { ...coach, category: result.category } : coach));
      setMessageTone('success');
      setMessage(result.message);
    } catch (error) {
      setMessageTone('error');
      setMessage(error instanceof Error ? error.message : '教练类别更新失败。');
    } finally {
      setSaving(false);
    }
  };

  const createCoach = async (event: FormEvent) => {
    event.preventDefault();
    if (!currentAccount) return;
    const selectedTeam = teamDirectory.find((team) => team.project === coachForm.project && team.name === coachForm.team);
    if (!selectedTeam) { setMessageTone('error'); setMessage('请选择有效的执教项目和队伍。'); return; }
    setSaving(true);
    try {
      const username = coachForm.username.trim().toLowerCase();
      const result = await api.createAccessAccount({ username, password: coachForm.password, displayName: coachForm.displayName.trim(), role: 'SCC', parentUserId: user.id, areas: currentAccount.areas, projects: [coachForm.project], teams: [{ project: coachForm.project, team: coachForm.team }], coachCategory: coachForm.category });
      await load(); onChanged(); setSelectedCoachId(result.id); setCoachForm(emptyCoachForm); setCreateOpen(false); setMessageTone('success'); setMessage(`教练账号已创建，登录账号为 ${username}。`);
    } catch (error) { setMessageTone('error'); setMessage(error instanceof Error ? error.message : '教练账号创建失败。'); }
    finally { setSaving(false); }
  };

  const toggleCoachStatus = async () => {
    if (!selectedCoach) return;
    const nextActive = !selectedCoach.active;
    if (!window.confirm(`${nextActive ? '启用' : '停用'} ${selectedCoach.displayName} 的登录账号？`)) return;
    setSaving(true);
    try { const result = await api.setAccessAccountStatus(selectedCoach.id, nextActive); await load(); onChanged(); setMessageTone('success'); setMessage(result.message); }
    catch (error) { setMessageTone('error'); setMessage(error instanceof Error ? error.message : '账号状态更新失败。'); }
    finally { setSaving(false); }
  };

  const resetFilters = () => { setSearchTerm(''); setProjectFilter(''); setCategoryFilter(''); setStatusFilter('all'); };

  return (
    <div className="page-content coach-directory-page">
      <header className="page-heading coach-directory-heading">
        <div><p className="eyebrow">COACH DIRECTORY</p><h1>教练管理</h1><p>维护教练账号、执教范围以及与运动员的责任关系。</p></div>
        <div className="coach-directory-summary" aria-label="教练管理概览"><div><span>在岗教练</span><strong>{activeCount}</strong></div><div><span>关联队伍</span><strong>{coveredTeams}</strong></div><div><span>覆盖运动员</span><strong>{coveredAthletes}</strong></div></div>
      </header>
      {message && <div className={`message-banner ${messageTone}`}>{messageTone === 'success' ? <Check /> : <AlertCircle />}{message}</div>}

      <section className="coach-directory-toolbar" aria-label="教练筛选与操作">
        <label className="coach-directory-search"><Search size={17} /><input value={searchTerm} onChange={(event) => setSearchTerm(event.target.value)} placeholder="搜索教练姓名、账号、项目或队伍" aria-label="搜索教练" />{searchTerm && <button onClick={() => setSearchTerm('')} aria-label="清除搜索"><X size={14} /></button>}</label>
        <label className="coach-directory-filter"><Filter size={15} /><select value={projectFilter} onChange={(event) => setProjectFilter(event.target.value)} aria-label="筛选执教项目"><option value="">全部项目</option>{projects.map((project) => <option key={project}>{project}</option>)}</select></label>
        <label className="coach-directory-filter"><UserRoundCheck size={15} /><select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)} aria-label="筛选教练类别"><option value="">全部类别</option>{COACH_CATEGORIES.map((category) => <option key={category}>{category}</option>)}</select></label>
        <label className="coach-directory-filter"><UserRoundCheck size={15} /><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as StatusFilter)} aria-label="筛选教练状态"><option value="all">全部状态</option><option value="active">在岗</option><option value="inactive">已停用</option></select></label>
        {(searchTerm || projectFilter || categoryFilter || statusFilter !== 'all') && <button className="coach-reset-button" onClick={resetFilters}>重置</button>}
        <button className="coach-refresh-button" onClick={() => void load()} disabled={loading} aria-label="刷新教练名册"><RefreshCw size={16} /></button>
        {canManage && <button className="coach-create-button" onClick={() => { setCoachForm(emptyCoachForm); setCreateOpen(true); }}><Plus size={17} />新增教练</button>}
      </section>

      <section className="coach-directory-card">
        <header><div><strong>教练名册</strong><span>当前 {filteredCoaches.length} 条</span></div><small>点击“查看”打开完整责任档案</small></header>
      <div className="coach-directory-table-wrap"><table className="coach-directory-table"><thead><tr><th>教练</th><th>教练类别</th><th>执教项目</th><th>关联队伍</th><th>负责运动员</th><th>状态</th><th>操作</th></tr></thead><tbody>
          {filteredCoaches.map((coach) => <tr key={coach.id} className={!coach.active ? 'inactive' : ''}>
            <td><div className="coach-directory-person"><span>{coach.displayName.slice(0, 1)}</span><div><strong>{coach.displayName}</strong><small>@{coach.username || '账号未登记'}</small></div></div></td>
            <td><span className="coach-role-tag">{coach.category}</span></td>
            <td><div className="coach-project-tags">{coach.projectNames.length ? coach.projectNames.map((project) => <span key={project}>{project}</span>) : <em>未设置</em>}</div></td>
            <td><div className="coach-team-copy"><strong>{coach.teamNames[0] || '未关联队伍'}</strong>{coach.teamNames.length > 1 && <small>另有 {coach.teamNames.length - 1} 支队伍</small>}</div></td>
            <td><div className="coach-athlete-count"><div>{coach.athletes.slice(0, 3).map((athlete, index) => <i key={athlete.id} style={{ zIndex: 3 - index }}>{athlete.name.slice(0, 1)}</i>)}</div><strong>{coach.athletes.length}</strong><span>人</span></div></td>
            <td><span className={`coach-status ${coach.active ? 'active' : 'inactive'}`}><i />{coach.active ? '在岗' : '已停用'}</span></td>
            <td><div className="coach-row-actions"><button onClick={() => openDetail(coach.id)}><Eye size={15} />查看</button>{canManage && <button onClick={() => { setSelectedCoachId(coach.id); setDraftAthleteIds(new Set(coach.athletes.map((athlete) => athlete.id))); setScopeSearch(''); setScopeOpen(true); }}><SlidersHorizontal size={15} />调配</button>}</div></td>
          </tr>)}
        </tbody></table>{loading && <div className="coach-directory-loading">正在加载教练名册…</div>}{!loading && !filteredCoaches.length && <div className="coach-directory-empty"><Search size={26} /><strong>没有符合条件的教练</strong><p>调整搜索词或筛选条件后再试。</p><button onClick={resetFilters}>查看全部教练</button></div>}</div>
        <footer><span>共 {filteredCoaches.length} 条</span><span>教练停用后无法登录，已有训练数据和责任记录仍会保留。</span></footer>
      </section>

      {detailOpen && selectedCoach && <div className="coach-detail-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setDetailOpen(false); }}><aside className="coach-detail-drawer" role="dialog" aria-modal="true" aria-labelledby="coach-detail-title">
        <header><div><span>COACH PROFILE</span><h2 id="coach-detail-title">教练档案</h2></div><button className="icon-button" onClick={() => setDetailOpen(false)} aria-label="关闭"><X size={19} /></button></header>
        <div className="coach-detail-identity"><span>{selectedCoach.displayName.slice(0, 1)}</span><div><h3><EditableName value={selectedCoach.displayName} canEdit={canRename} onSave={(name) => renameCoach(selectedCoach.id, name)} label="教练姓名" /></h3><p>{selectedCoach.category} · @{selectedCoach.username || '账号未登记'}</p></div><b className={selectedCoach.active ? 'active' : 'inactive'}>{selectedCoach.active ? '在岗' : '已停用'}</b></div>
        <div className="coach-detail-facts"><div><span>执教项目</span><strong>{selectedCoach.projectNames.join('、') || '未设置'}</strong></div><div><span>关联队伍</span><strong>{selectedCoach.teamNames.length} 支</strong></div><div><span>负责运动员</span><strong>{selectedCoach.athletes.length} 人</strong></div></div>
        {canManage && <label className="coach-detail-category"><span>教练类别</span><select value={selectedCoach.category} disabled={saving} onChange={(event) => void updateCoachCategory(selectedCoach.id, event.target.value as CoachCategory)}>{COACH_CATEGORIES.map((category) => <option key={category}>{category}</option>)}</select></label>}
        <section className="coach-detail-section"><header><div><span>RESPONSIBILITY</span><h3>责任队伍与运动员</h3></div>{canManage && <button onClick={openScope}><PencilLine size={14} />调整</button>}</header><div className="coach-detail-groups">{selectedGroups.length ? selectedGroups.map((group) => <article key={`${group.project}-${group.team}`}><header><span>{group.project}</span><strong>{group.team}</strong><small>{group.athletes.length} 人</small></header><div>{group.athletes.map((athlete) => <span key={athlete.id}><i>{athlete.name.slice(0, 1)}</i><b>{athlete.name}</b><small>{athlete.gender}</small></span>)}</div></article>) : <p>尚未关联运动员，可使用“调整”建立责任关系。</p>}</div></section>
        <footer>{canManage && <button className={`coach-status-button ${selectedCoach.active ? 'danger' : ''}`} onClick={() => void toggleCoachStatus()} disabled={saving}><LockKeyhole size={15} />{selectedCoach.active ? '停用教练账号' : '重新启用账号'}</button>}<button className="primary-button" onClick={() => setDetailOpen(false)}>完成</button></footer>
      </aside></div>}

      {createOpen && <div className="modal-backdrop coach-create-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) setCreateOpen(false); }}><section className="coach-create-modal" role="dialog" aria-modal="true" aria-labelledby="coach-create-title">
        <header><div><span>NEW COACH ACCOUNT</span><h2 id="coach-create-title">新增教练</h2><p>一次完成教练账号、执教项目和队伍范围的建立。</p></div><button className="icon-button" onClick={() => setCreateOpen(false)} disabled={saving} aria-label="关闭"><X size={19} /></button></header>
        <form onSubmit={createCoach}><div className="coach-create-fields"><label><span>教练姓名</span><input value={coachForm.displayName} onChange={(event) => setCoachForm({ ...coachForm, displayName: event.target.value })} placeholder="请输入真实姓名" minLength={2} maxLength={20} required /></label><label><span>教练类别</span><select value={coachForm.category} onChange={(event) => setCoachForm({ ...coachForm, category: event.target.value as CoachCategory })} required>{COACH_CATEGORIES.map((category) => <option key={category}>{category}</option>)}</select></label><label><span>登录账号</span><input value={coachForm.username} onChange={(event) => setCoachForm({ ...coachForm, username: event.target.value })} placeholder="4—24位字母、数字或下划线" pattern="[A-Za-z0-9_]{4,24}" required /></label><label><span>初始密码</span><input type="password" value={coachForm.password} onChange={(event) => setCoachForm({ ...coachForm, password: event.target.value })} placeholder="至少8位，包含字母和数字" minLength={8} required /></label><label><span>执教项目</span><select value={coachForm.project} onChange={(event) => setCoachForm({ ...coachForm, project: event.target.value, team: '' })} required><option value="">请选择项目</option>{projects.map((project) => <option key={project}>{project}</option>)}</select></label><label><span>关联队伍</span><select value={coachForm.team} onChange={(event) => setCoachForm({ ...coachForm, team: event.target.value })} disabled={!coachForm.project} required><option value="">{coachForm.project ? '请选择队伍' : '请先选择项目'}</option>{formTeams.map((team) => <option key={team.id}>{team.name}</option>)}</select></label></div>
          <div className="coach-create-note"><LockKeyhole size={17} /><p><strong>账号创建规则</strong><span>新教练首次登录后应立即修改初始密码；更细的数据权限可继续在“账号权限”中维护。</span></p></div><footer><button type="button" className="secondary-button" onClick={() => setCreateOpen(false)} disabled={saving}>取消</button><button className="primary-button" disabled={saving}>{saving ? '正在创建…' : '创建教练账号'}</button></footer></form>
      </section></div>}

      {scopeOpen && selectedCoach && <div className="modal-backdrop coach-scope-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) setScopeOpen(false); }}><section className="coach-scope-modal" role="dialog" aria-modal="true" aria-labelledby="coach-scope-title">
        <header><div><span>RESPONSIBILITY EDITOR</span><h2 id="coach-scope-title">调整 {selectedCoach.displayName} 的责任范围</h2><p>选择该教练负责的运动员，不修改运动员的项目、队伍和地区。</p></div><button className="icon-button" onClick={() => setScopeOpen(false)} disabled={saving} aria-label="关闭"><X size={19} /></button></header>
        <div className="coach-scope-toolbar"><label><Search size={16} /><input value={scopeSearch} onChange={(event) => setScopeSearch(event.target.value)} placeholder="搜索姓名、项目、队伍或地区" aria-label="搜索运动员责任范围" /></label><div><span>已选择</span><strong>{draftAthleteIds.size}</strong><small>人</small></div></div>
        <div className="coach-scope-list">{scopeAthletes.map((athlete) => { const checked = draftAthleteIds.has(athlete.id); return <label key={athlete.id} className={checked ? 'selected' : ''}><input type="checkbox" checked={checked} onChange={() => toggleDraftAthlete(athlete.id)} /><i>{checked && <Check size={13} />}</i><span className="coach-scope-avatar">{athlete.name.slice(0, 1)}</span><span className="coach-scope-person"><strong>{athlete.name}</strong><small>{athlete.project} · {athlete.team || '未分队'}</small></span><span className="coach-scope-region">{[athlete.region, athlete.city].filter(Boolean).join(' / ') || '地区未填'}</span></label>; })}</div>
        <footer><p>本次仅更新责任关系，不修改运动员的项目、队伍和地区。</p><button className="secondary-button" onClick={() => setScopeOpen(false)} disabled={saving}>取消</button><button className="primary-button" onClick={() => void saveScope()} disabled={saving}>{saving ? '正在同步…' : '保存责任范围'}</button></footer>
      </section></div>}
    </div>
  );
}
