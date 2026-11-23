import {
  AlertCircle,
  Check,
  Eye,
  Filter,
  LockKeyhole,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  UserRoundCheck,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { ROLE_META } from '../../shared/access';
import { projectLabel } from '../../shared/projects';
import {
  COACH_CATEGORIES,
  DEFAULT_COACH_CATEGORY,
  type CoachCategory,
} from '../../shared/coach-categories';
import { api } from '../api';
import { EditableName } from '../components/EditableName';
import { FilterBar, PageContainer, PageHeader } from '../components/PageLayout';
import type { AccessAccount, Athlete, ProjectTeam, User } from '../types';

type AssignmentAthlete = Athlete & { coachIds: string };
type CoachAccount = Pick<
  AccessAccount,
  'id' | 'username' | 'displayName' | 'active' | 'projects' | 'teams'
> & { categories: CoachCategory[] };
type StatusFilter = 'all' | 'active' | 'inactive';

const emptyCoachForm = {
  displayName: '',
  username: '',
  password: '',
  category: DEFAULT_COACH_CATEGORY,
  project: '',
  team: '',
};

function assignedCoachIds(athlete: AssignmentAthlete) {
  return String(athlete.coachIds || '')
    .split(',')
    .map(Number)
    .filter(Number.isFinite);
}

function uniqueById<T extends { id: number }>(items: T[]) {
  return [...new Map(items.map((item) => [item.id, item])).values()];
}

export function CoachManagementPage({
  user,
  onChanged,
  onEditScope,
}: {
  user: User;
  athletes: Athlete[];
  onChanged: () => void;
  onEditScope: (id: number) => void;
}) {
  const [athletes, setAthletes] = useState<AssignmentAthlete[]>([]);
  const [coaches, setCoaches] = useState<CoachAccount[]>([]);
  const [manageableCoachIds, setManageableCoachIds] = useState<number[]>([]);
  const [currentAccount, setCurrentAccount] = useState<AccessAccount | null>(null);
  const [teamDirectory, setTeamDirectory] = useState<ProjectTeam[]>([]);
  const [selectedCoachId, setSelectedCoachId] = useState<number | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [projectFilter, setProjectFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [detailOpen, setDetailOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [coachForm, setCoachForm] = useState(emptyCoachForm);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [messageTone, setMessageTone] = useState<'success' | 'error'>('success');

  const canManage = ROLE_META[user.role].level >= ROLE_META.REG.level;
  const canRename = ROLE_META[user.role].level > ROLE_META.SCC.level;

  const load = async () => {
    setLoading(true);
    try {
      const [assignmentResult, accessResult, teamResult] = await Promise.all([
        api.assignments(),
        api.accessAccounts(),
        api.teams(),
      ]);
      setAthletes(assignmentResult.athletes);
      setCurrentAccount(accessResult.current);
      setTeamDirectory(teamResult.teams);
      setManageableCoachIds(accessResult.accounts.filter((account) => account.role === 'SCC').map(({ id }) => id));
      const categoryByCoachId = new Map(
        assignmentResult.coaches.map((coach) => [coach.id, coach.categories])
      );
      const accessCoaches = [
        ...(accessResult.current?.role === 'SCC' ? [accessResult.current] : []),
        ...accessResult.accounts.filter((account) => account.role === 'SCC'),
      ].map((account) => ({
        id: account.id,
        username: account.username,
        displayName: account.displayName,
        active: account.active,
        projects: account.projects,
        teams: account.teams,
        categories: categoryByCoachId.get(account.id) ?? [],
      }));
      const assignmentCoaches = assignmentResult.coaches.map((coach) => ({
        ...coach,
        username: '',
        active: 1,
        projects: [],
        teams: [],
      }));
      const nextCoaches = uniqueById([...assignmentCoaches, ...accessCoaches]);
      setCoaches(nextCoaches);
      setSelectedCoachId((current) =>
        current && nextCoaches.some((coach) => coach.id === current)
          ? current
          : nextCoaches.find((coach) => coach.id === user.id)?.id || nextCoaches[0]?.id || null
      );
    } catch (error) {
      setMessageTone('error');
      setMessage(error instanceof Error ? error.message : '教练名册加载失败。');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [user.id]);

  const shownAthletes = athletes;

  const coachProfiles = useMemo(
    () =>
      coaches.map((coach) => {
        const ownedAthletes = shownAthletes.filter((athlete) =>
          assignedCoachIds(athlete).includes(coach.id)
        );
        const athletesByTeam = new Map<number, AssignmentAthlete[]>();
        for (const athlete of ownedAthletes) {
          if (athlete.teamId == null) continue;
          const members = athletesByTeam.get(athlete.teamId) ?? [];
          members.push(athlete);
          athletesByTeam.set(athlete.teamId, members);
        }
        const responsibilityTeams = teamDirectory
          .filter(
            (team) =>
              athletesByTeam.has(team.id) ||
              (coach.active &&
                coach.projects.some((project) => project === '*' || project === team.project) &&
                coach.teams.some(
                  (scope) =>
                    (scope.project === '*' || scope.project === team.project) &&
                    (scope.team === '*' || scope.team === team.name)
                ))
          )
          .map((team) => ({
            ...team,
            athletes: athletesByTeam.get(team.id) ?? [],
          }));
        const teamNames = responsibilityTeams.map(
          (team) => `${projectLabel(team.project)} · ${team.name}`
        );
        const projectNames = [...new Set([
          ...responsibilityTeams.map((team) => team.project),
          ...ownedAthletes.map((athlete) => athlete.project),
          ...coach.projects.filter((project) => project !== '*'),
        ].filter(Boolean))];
        return { ...coach, athletes: ownedAthletes, projectNames, teamNames, responsibilityTeams };
      }),
    [coaches, shownAthletes, teamDirectory]
  );

  const projects = useMemo(
    () =>
      [
        ...new Set([
          ...teamDirectory.map((team) => team.project),
          ...coachProfiles.flatMap((coach) => coach.projectNames),
        ]),
      ].filter(Boolean),
    [teamDirectory, coachProfiles]
  );
  const filteredCoaches = useMemo(() => {
    const query = searchTerm.trim().toLocaleLowerCase();
    return coachProfiles.filter((coach) => {
      if (projectFilter && !coach.projectNames.includes(projectFilter)) return false;
      if (categoryFilter && !coach.categories.some((category) => category === categoryFilter)) return false;
      if (statusFilter === 'active' && !coach.active) return false;
      if (statusFilter === 'inactive' && coach.active) return false;
      if (!query) return true;
      return [coach.displayName, coach.username, ...coach.projectNames, ...coach.teamNames].some(
        (value) => value.toLocaleLowerCase().includes(query)
      );
    });
  }, [coachProfiles, projectFilter, categoryFilter, statusFilter, searchTerm]);

  const selectedCoach = coachProfiles.find((coach) => coach.id === selectedCoachId) || null;
  const canManageSelected = canManage && !!selectedCoach && manageableCoachIds.includes(selectedCoach.id);
  const activeCount = coachProfiles.filter((coach) => coach.active).length;
  const coveredTeams = new Set(
    coachProfiles.flatMap((coach) => coach.responsibilityTeams.map((team) => team.id))
  ).size;
  const coveredAthletes = new Set(
    coachProfiles.flatMap((coach) => coach.athletes.map((athlete) => athlete.id))
  ).size;

  const formTeams = teamDirectory.filter(
    (team) => !coachForm.project || team.project === coachForm.project
  );
  const openDetail = (coachId: number) => {
    setSelectedCoachId(coachId);
    setDetailOpen(true);
  };
  const renameCoach = async (coachId: number, name: string) => {
    await api.renameUser(coachId, name);
    await load();
    onChanged();
    setMessageTone('success');
    setMessage('教练姓名已同步更新。');
  };

  const updateCoachCategory = async (coachId: number, categories: CoachCategory[]) => {
    setSaving(true);
    try {
      const result = await api.updateCoachCategory(coachId, categories);
      setCoaches((current) =>
        current.map((coach) =>
          coach.id === coachId ? { ...coach, categories: result.categories } : coach
        )
      );
      setMessageTone('success');
      setMessage(result.message);
      onChanged();
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
    const selectedTeam = teamDirectory.find(
      (team) => team.project === coachForm.project && team.name === coachForm.team
    );
    if (!selectedTeam) {
      setMessageTone('error');
      setMessage('请选择有效的执教项目和队伍。');
      return;
    }
    setSaving(true);
    try {
      const username = coachForm.username.trim().toLowerCase();
      const result = await api.createAccessAccount({
        username,
        password: coachForm.password,
        displayName: coachForm.displayName.trim(),
        role: 'SCC',
        parentUserId: user.id,
        areas: currentAccount.areas,
        projects: [coachForm.project],
        teams: [{ project: coachForm.project, team: coachForm.team }],
        coachCategory: coachForm.category,
      });
      await load();
      onChanged();
      setSelectedCoachId(result.id);
      setCoachForm(emptyCoachForm);
      setCreateOpen(false);
      setMessageTone('success');
      setMessage(`教练账号已创建，登录账号为 ${username}。`);
    } catch (error) {
      setMessageTone('error');
      setMessage(error instanceof Error ? error.message : '教练账号创建失败。');
    } finally {
      setSaving(false);
    }
  };

  const toggleCoachStatus = async () => {
    if (!selectedCoach || !canManageSelected) return;
    const nextActive = !selectedCoach.active;
    if (
      !window.confirm(`${nextActive ? '启用' : '停用'} ${selectedCoach.displayName} 的登录账号？`)
    )
      return;
    setSaving(true);
    try {
      const result = await api.setAccessAccountStatus(selectedCoach.id, nextActive);
      await load();
      onChanged();
      setMessageTone('success');
      setMessage(result.message);
    } catch (error) {
      setMessageTone('error');
      setMessage(error instanceof Error ? error.message : '账号状态更新失败。');
    } finally {
      setSaving(false);
    }
  };

  const resetFilters = () => {
    setSearchTerm('');
    setProjectFilter('');
    setCategoryFilter('');
    setStatusFilter('all');
  };

  return (
    <PageContainer className="coach-directory-page">
      <PageHeader
        className="coach-directory-heading"
        title="教练管理"
        actions={
          <div className="coach-directory-summary" aria-label="教练管理概览">
            <div className="coach-summary-enabled">
              <span>已启用教练</span>
              <strong>{activeCount}</strong>
            </div>
            <div className="coach-summary-disabled">
              <span>已停用教练</span>
              <strong>{coachProfiles.length - activeCount}</strong>
            </div>
            <div>
              <span>关联队伍</span>
              <strong>{coveredTeams}</strong>
            </div>
            <div>
              <span>覆盖运动员（当前权限内）</span>
              <strong>{coveredAthletes}</strong>
            </div>
          </div>
        }
      />
      {message && (
        <div className={`message-banner ${messageTone}`}>
          {messageTone === 'success' ? <Check /> : <AlertCircle />}
          {message}
        </div>
      )}

      <FilterBar className="coach-directory-toolbar" label="教练筛选与操作">
        <label className="coach-directory-search">
          <Search size={17} />
          <input
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
            placeholder="搜索教练姓名、账号、项目或队伍"
            aria-label="搜索教练"
          />
          {searchTerm && (
            <button onClick={() => setSearchTerm('')} aria-label="清除搜索">
              <X size={14} />
            </button>
          )}
        </label>
        <label className="coach-directory-filter">
          <Filter size={15} />
          <select
            value={projectFilter}
            onChange={(event) => setProjectFilter(event.target.value)}
            aria-label="筛选执教项目"
          >
            <option value="">全部项目</option>
            {projects.map((project) => (
              <option key={project} value={project}>
                {projectLabel(project)}
              </option>
            ))}
          </select>
        </label>
        <label className="coach-directory-filter">
          <UserRoundCheck size={15} />
          <select
            value={categoryFilter}
            onChange={(event) => setCategoryFilter(event.target.value)}
            aria-label="筛选教练类别"
          >
            <option value="">全部类别</option>
            {COACH_CATEGORIES.map((category) => (
              <option key={category}>{category}</option>
            ))}
          </select>
        </label>
        <label className="coach-directory-filter">
          <UserRoundCheck size={15} />
          <select
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}
            aria-label="筛选教练状态"
          >
            <option value="all">全部状态</option>
            <option value="active">已启用</option>
            <option value="inactive">已停用</option>
          </select>
        </label>
        {(searchTerm || projectFilter || categoryFilter || statusFilter !== 'all') && (
          <button className="coach-reset-button" onClick={resetFilters}>
            重置
          </button>
        )}
        <button
          className="coach-refresh-button"
          onClick={() => void load()}
          disabled={loading}
          aria-label="刷新教练名册"
        >
          <RefreshCw size={16} />
        </button>
        {canManage && (
          <button
            className="coach-create-button"
            onClick={() => {
              setCoachForm(emptyCoachForm);
              setCreateOpen(true);
            }}
          >
            <Plus size={17} />
            新增教练
          </button>
        )}
      </FilterBar>

      <section className="coach-directory-card">
        <header>
          <div>
            <strong>教练名册</strong>
            <span>当前 {filteredCoaches.length} 条</span>
          </div>
          <small>点击“查看”打开完整责任档案</small>
        </header>
        <div className="coach-directory-table-wrap">
          <table className="coach-directory-table">
            <thead>
              <tr>
                <th>教练</th>
                <th>教练类别</th>
                <th>执教项目</th>
                <th>关联队伍</th>
                <th>负责运动员（当前权限内）</th>
                <th>账号状态</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {filteredCoaches.map((coach) => (
                <tr key={coach.id} className={!coach.active ? 'inactive' : ''}>
                  <td>
                    <div className="coach-directory-person">
                      <span>{coach.displayName.slice(0, 1)}</span>
                      <div>
                        <strong>{coach.displayName}</strong>
                        <small>@{coach.username || '账号未登记'}</small>
                      </div>
                    </div>
                  </td>
                  <td>
                    <span className="coach-role-tag">{coach.categories.join('、') || '未设置'}</span>
                  </td>
                  <td>
                    <div className="coach-project-tags">
                      {coach.projectNames.length ? (
                        coach.projectNames.map((project) => (
                          <span key={project}>{projectLabel(project)}</span>
                        ))
                      ) : (
                        <em>未设置</em>
                      )}
                    </div>
                  </td>
                  <td>{coach.responsibilityTeams.length} 支</td>
                  <td>
                    <div className="coach-athlete-count">
                      <div>
                        {coach.athletes.slice(0, 3).map((athlete, index) => (
                          <i key={athlete.id} style={{ zIndex: 3 - index }}>
                            {athlete.name.slice(0, 1)}
                          </i>
                        ))}
                      </div>
                      <strong>{coach.athletes.length}</strong>
                      <span>人</span>
                    </div>
                  </td>
                  <td>
                    <span className={`coach-status ${coach.active ? 'active' : 'inactive'}`}>
                      <i />
                      {coach.active ? '已启用' : '已停用'}
                    </span>
                  </td>
                  <td>
                    <div className="coach-row-actions">
                      <button onClick={() => openDetail(coach.id)}>
                        <Eye size={15} />
                        查看
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {loading && <div className="coach-directory-loading">正在加载教练名册…</div>}
          {!loading && !filteredCoaches.length && (
            <div className="coach-directory-empty">
              <Search size={26} />
              <strong>没有符合条件的教练</strong>
              <p>调整搜索词或筛选条件后再试。</p>
              <button onClick={resetFilters}>查看全部教练</button>
            </div>
          )}
        </div>
        <footer>
          <span>共 {filteredCoaches.length} 条</span>
          <span>教练停用后无法登录，已有训练数据仍会保留。</span>
        </footer>
      </section>

      {detailOpen && selectedCoach && (
        <div
          className="coach-detail-backdrop"
          role="presentation"
          onPointerDown={(event) => {
            if (event.target === event.currentTarget) setDetailOpen(false);
          }}
        >
          <aside
            className="coach-detail-drawer"
            role="dialog"
            aria-modal="true"
            aria-labelledby="coach-detail-title"
          >
            <header>
              <div>
                <h2 id="coach-detail-title">教练档案</h2>
              </div>
              <button
                className="icon-button"
                onClick={() => setDetailOpen(false)}
                aria-label="关闭"
              >
                <X size={19} />
              </button>
            </header>
            <div className="coach-detail-identity">
              <span>{selectedCoach.displayName.slice(0, 1)}</span>
              <div>
                <h3>
                  <EditableName
                    value={selectedCoach.displayName}
                    canEdit={canRename}
                    onSave={(name) => renameCoach(selectedCoach.id, name)}
                    label="教练姓名"
                  />
                </h3>
                <p>
                  {selectedCoach.categories.join('、') || '未设置'} · @{selectedCoach.username || '账号未登记'}
                </p>
              </div>
              <b className={selectedCoach.active ? 'active' : 'inactive'}>
                {selectedCoach.active ? '已启用' : '已停用'}
              </b>
            </div>
            {canManageSelected && (
              <div className="coach-detail-actions">
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => onEditScope(selectedCoach.id)}
                  disabled={saving}
                >
                  <Pencil size={16} aria-hidden="true" />
                  修改项目与队伍
                </button>
                <button
                  type="button"
                  className={`coach-status-button ${selectedCoach.active ? 'danger' : ''}`}
                  onClick={() => void toggleCoachStatus()}
                  disabled={saving}
                >
                  <LockKeyhole size={16} aria-hidden="true" />
                  {selectedCoach.active ? '停用账号' : '启用账号'}
                </button>
              </div>
            )}
            <div className="coach-detail-facts">
              <div>
                <span>执教项目</span>
                <strong>
                  {selectedCoach.projectNames.map((project) => projectLabel(project)).join('、') ||
                    '未设置'}
                </strong>
              </div>
              <div>
                <span>关联队伍</span>
                <strong>{selectedCoach.teamNames.length} 支</strong>
              </div>
              <div>
                <span>负责运动员（当前权限内）</span>
                <strong>{selectedCoach.athletes.length} 人</strong>
              </div>
            </div>
            <section className="coach-detail-section">
              <header>
                <div>
                  <h3>关联队伍与人数</h3>
                  <p>人数按当前权限内可见运动员统计。</p>
                </div>
              </header>
              <div className="coach-detail-groups">
                {selectedCoach.responsibilityTeams.length ? (
                  selectedCoach.responsibilityTeams.map((team) => (
                    <article key={team.id}>
                      <header>
                        <span>{projectLabel(team.project)}</span>
                        <strong>{team.name}</strong>
                        <small>{team.athletes.length} 人</small>
                      </header>
                      {team.athletes.length > 0 && (
                        <details>
                          <summary>查看运动员</summary>
                          <div className="coach-team-members">
                            {team.athletes.map((athlete) => (
                              <span key={athlete.id}>
                                <i aria-hidden="true">{athlete.name.slice(0, 1)}</i>
                                <b>{athlete.name}</b>
                                <small>{athlete.gender}</small>
                              </span>
                            ))}
                          </div>
                        </details>
                      )}
                    </article>
                  ))
                ) : (
                  <p>暂无关联队伍。</p>
                )}
              </div>
            </section>
            {canManageSelected && (
              <fieldset className="coach-detail-category" disabled={saving}>
                <legend>教练类别</legend>
                {COACH_CATEGORIES.map((category) => (
                  <label key={category}>
                    <input
                      type="checkbox"
                      checked={selectedCoach.categories.includes(category)}
                      onChange={(event) =>
                        void updateCoachCategory(
                          selectedCoach.id,
                          event.target.checked
                            ? [...selectedCoach.categories, category]
                            : selectedCoach.categories.filter((role) => role !== category)
                        )
                      }
                    />
                    {category}
                  </label>
                ))}
              </fieldset>
            )}
            <footer>
              <button className="primary-button" onClick={() => setDetailOpen(false)}>
                完成
              </button>
            </footer>
          </aside>
        </div>
      )}

      {createOpen && (
        <div
          className="modal-backdrop coach-create-backdrop"
          role="presentation"
          onPointerDown={(event) => {
            if (event.target === event.currentTarget && !saving) setCreateOpen(false);
          }}
        >
          <section
            className="coach-create-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="coach-create-title"
          >
            <header>
              <div>
                <span>NEW COACH ACCOUNT</span>
                <h2 id="coach-create-title">新增教练</h2>
                <p>一次完成教练账号、执教项目和队伍范围的建立。</p>
              </div>
              <button
                className="icon-button"
                onClick={() => setCreateOpen(false)}
                disabled={saving}
                aria-label="关闭"
              >
                <X size={19} />
              </button>
            </header>
            <form onSubmit={createCoach}>
              <div className="coach-create-fields">
                <label>
                  <span>教练姓名</span>
                  <input
                    value={coachForm.displayName}
                    onChange={(event) =>
                      setCoachForm({ ...coachForm, displayName: event.target.value })
                    }
                    placeholder="请输入真实姓名"
                    minLength={2}
                    maxLength={20}
                    required
                  />
                </label>
                <label>
                  <span>教练类别</span>
                  <select
                    value={coachForm.category}
                    onChange={(event) =>
                      setCoachForm({ ...coachForm, category: event.target.value as CoachCategory })
                    }
                    required
                  >
                    {COACH_CATEGORIES.map((category) => (
                      <option key={category}>{category}</option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>登录账号</span>
                  <input
                    value={coachForm.username}
                    onChange={(event) =>
                      setCoachForm({ ...coachForm, username: event.target.value })
                    }
                    placeholder="4—24位字母、数字或下划线"
                    pattern="[A-Za-z0-9_]{4,24}"
                    required
                  />
                </label>
                <label>
                  <span>初始密码</span>
                  <input
                    type="password"
                    value={coachForm.password}
                    onChange={(event) =>
                      setCoachForm({ ...coachForm, password: event.target.value })
                    }
                    placeholder="至少8位，包含字母和数字"
                    minLength={8}
                    required
                  />
                </label>
                <label>
                  <span>执教项目</span>
                  <select
                    value={coachForm.project}
                    onChange={(event) =>
                      setCoachForm({ ...coachForm, project: event.target.value, team: '' })
                    }
                    required
                  >
                    <option value="">请选择项目</option>
                    {projects.map((project) => (
                      <option key={project} value={project}>
                        {projectLabel(project)}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>关联队伍</span>
                  <select
                    value={coachForm.team}
                    onChange={(event) => setCoachForm({ ...coachForm, team: event.target.value })}
                    disabled={!coachForm.project}
                    required
                  >
                    <option value="">{coachForm.project ? '请选择队伍' : '请先选择项目'}</option>
                    {formTeams.map((team) => (
                      <option key={team.id}>{team.name}</option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="coach-create-note">
                <LockKeyhole size={17} />
                <p>
                  <strong>账号创建规则</strong>
                  <span>
                    新教练首次登录后应立即修改初始密码；更细的数据权限可继续在“账号权限”中维护。
                  </span>
                </p>
              </div>
              <footer>
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => setCreateOpen(false)}
                  disabled={saving}
                >
                  取消
                </button>
                <button className="primary-button" disabled={saving}>
                  {saving ? '正在创建…' : '创建教练账号'}
                </button>
              </footer>
            </form>
          </section>
        </div>
      )}
    </PageContainer>
  );
}
