import {
  Activity,
  Check,
  ChevronRight,
  CirclePower,
  FileClock,
  Fingerprint,
  GitBranch,
  MapPinned,
  Plus,
  Save,
  ShieldCheck,
  UserRoundPlus,
  UsersRound,
  X
} from 'lucide-react';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { api } from '../api';
import { EditableName } from '../components/EditableName';
import type {
  AccessAccount,
  AccessPayload,
  AreaLevel,
  AreaPermission,
  AuditLog,
  Role,
  TeamPermission,
  User
} from '../types';
import { AREA_LEVEL_META, ROLE_META, ROLES, canManageRole } from '../../shared/access';

const blankArea = (): AreaPermission => ({
  areaLevel: 'province',
  province: '四川',
  city: '',
  county: ''
});

const blankTeam = (): TeamPermission => ({ project: '赛艇', team: '' });

function areaLabel(area: AreaPermission) {
  if (area.areaLevel === 'national') return '全国';
  return [area.province, area.city, area.county].filter(Boolean).join(' / ');
}

function compactScope(account: AccessAccount) {
  const areas = account.areas.map(areaLabel).join('、');
  const projects = account.projects.includes('*') ? '全部项目' : account.projects.join('、');
  return `${areas} · ${projects}`;
}

const auditLabels: Record<string, string> = {
  CREATE_ACCOUNT: '创建账号',
  UPDATE_ACCOUNT_ACCESS: '调整账号权限',
  ENABLE_ACCOUNT: '启用账号',
  DISABLE_ACCOUNT: '停用账号',
  UPDATE_NAME: '修改姓名',
  UPDATE_ATHLETE_NAME: '修改运动员姓名',
  UPDATE_REGIONAL_ACCESS: '调整区域权限',
  CREATE_REGIONAL_MANAGER: '创建区域负责人',
  UPDATE_ASSIGNMENT: '调整人员关系',
  APPROVE_REGISTRATION: '通过注册申请',
  REJECT_REGISTRATION: '拒绝注册申请',
  IMPORT_RECORDS: '导入训练数据'
};

export function RegionAccessPage({ user }: { user: User }) {
  const [payload, setPayload] = useState<AccessPayload | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [role, setRole] = useState<Role>('ATL');
  const [parentUserId, setParentUserId] = useState<number>(user.id);
  const [areas, setAreas] = useState<AreaPermission[]>([blankArea()]);
  const [projects, setProjects] = useState<string[]>(['赛艇']);
  const [teams, setTeams] = useState<TeamPermission[]>([blankTeam()]);
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [createForm, setCreateForm] = useState({
    displayName: '',
    username: '',
    password: '',
    role: 'ATL' as Role,
    parentUserId: user.id,
    areaLevel: 'county' as AreaLevel,
    province: '四川',
    city: '成都市',
    county: '武侯区',
    project: '赛艇',
    team: '',
    gender: '男'
  });

  const selected = payload?.accounts.find((account) => account.id === selectedId) || null;
  const manageableRoles = ROLES.filter((item) => canManageRole(user.role, item));
  const accountGroups = useMemo(() => {
    if (!payload) return [];
    return payload.meta.hierarchy
      .map((group) => ({
        roles: group,
        label: group.map((item) => payload.meta.roles[item].label).join(' / '),
        accounts: payload.accounts.filter((account) => group.includes(account.role))
      }))
      .filter((group) => group.accounts.length);
  }, [payload]);

  const load = async (preferredId?: number) => {
    setLoading(true);
    setError('');
    try {
      const result = await api.accessAccounts();
      setPayload(result);
      const nextId = preferredId && result.accounts.some((account) => account.id === preferredId)
        ? preferredId
        : selectedId && result.accounts.some((account) => account.id === selectedId)
          ? selectedId
          : result.accounts[0]?.id || null;
      setSelectedId(nextId);
      const next = result.accounts.find((account) => account.id === nextId);
      if (next) applyAccount(next);
      if (user.role === 'DMD') {
        const auditResult = await api.auditLogs();
        setLogs(auditResult.logs);
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '账号权限加载失败。');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const applyAccount = (account: AccessAccount) => {
    setRole(account.role);
    setParentUserId(account.parentUserId || user.id);
    setAreas(account.areas.map((area) => ({ ...area })));
    setProjects([...account.projects]);
    setTeams(account.teams.map((team) => ({ ...team })));
    setMessage('');
    setError('');
  };

  const chooseAccount = (account: AccessAccount) => {
    setSelectedId(account.id);
    applyAccount(account);
  };

  const updateArea = (index: number, key: keyof AreaPermission, value: string) => {
    setAreas((current) => current.map((area, itemIndex) => {
      if (itemIndex !== index) return area;
      const next = { ...area, [key]: value } as AreaPermission;
      if (key === 'areaLevel' && value === 'national') return { areaLevel: 'national', province: '', city: '', county: '' };
      if (key === 'areaLevel' && value === 'province') return { ...next, city: '', county: '' };
      if (key === 'areaLevel' && value === 'city') return { ...next, county: '' };
      return next;
    }));
  };

  const toggleProject = (project: string) => {
    setProjects((current) => {
      if (project === '*') return current.includes('*') ? ['赛艇'] : ['*'];
      const withoutAll = current.filter((item) => item !== '*');
      return withoutAll.includes(project)
        ? withoutAll.filter((item) => item !== project)
        : [...withoutAll, project];
    });
  };

  const save = async () => {
    if (!selected) return;
    setSaving(true);
    setMessage('');
    setError('');
    try {
      const result = await api.updateAccessAccount(selected.id, { role, parentUserId, areas, projects, teams });
      setMessage(result.message);
      await load(selected.id);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : '权限保存失败。');
    } finally {
      setSaving(false);
    }
  };

  const createAccount = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setMessage('');
    setError('');
    const createArea: AreaPermission = {
      areaLevel: createForm.role === 'ATL' ? 'county' : createForm.areaLevel,
      province: createForm.areaLevel === 'national' && createForm.role !== 'ATL' ? '' : createForm.province,
      city: ['city', 'county'].includes(createForm.areaLevel) || createForm.role === 'ATL' ? createForm.city : '',
      county: createForm.areaLevel === 'county' || createForm.role === 'ATL' ? createForm.county : ''
    };
    try {
      const result = await api.createAccessAccount({
        username: createForm.username,
        password: createForm.password,
        displayName: createForm.displayName,
        role: createForm.role,
        parentUserId: createForm.parentUserId,
        gender: createForm.role === 'ATL' ? createForm.gender : undefined,
        areas: [createArea],
        projects: [createForm.project],
        teams: [{ project: createForm.project, team: createForm.team }]
      });
      setMessage(result.message);
      setCreateOpen(false);
      setCreateForm((current) => ({ ...current, displayName: '', username: '', password: '', team: '' }));
      await load(result.id);
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : '账号创建失败。');
    } finally {
      setSaving(false);
    }
  };

  const setStatus = async () => {
    if (!selected) return;
    const nextActive = !selected.active;
    if (!nextActive && !window.confirm(`确认停用 ${selected.displayName}？该账号会立即退出登录。`)) return;
    setSaving(true);
    try {
      const result = await api.setAccessAccountStatus(selected.id, nextActive);
      setMessage(result.message);
      await load(selected.id);
    } catch (statusError) {
      setError(statusError instanceof Error ? statusError.message : '账号状态更新失败。');
    } finally {
      setSaving(false);
    }
  };

  const renameAccount = async (accountId: number, name: string) => {
    const result = await api.renameUser(accountId, name);
    setMessage(result.message);
    await load(accountId);
  };

  const visibleParentOptions = (targetRole: Role) =>
    payload?.possibleParents.filter((parent) => canManageRole(parent.role, targetRole)) || [];

  const canEditAccess = user.role !== 'SCC';
  const activeCount = payload?.accounts.filter((account) => account.active).length || 0;
  const areaCount = new Set(payload?.accounts.flatMap((account) => account.areas.map(areaLabel))).size;

  return (
    <div className="page-content access-center-page">
      <header className="page-heading compact-heading access-heading">
        <div>
          <p className="eyebrow">ACCOUNT AUTHORITY</p>
          <h1>账号权限</h1>
        </div>
        <div className="authority-formula"><Fingerprint size={18} /><span>角色</span><i>×</i><span>行政区域</span><i>×</i><span>项目 / 队伍</span></div>
      </header>

      <section className="access-summary">
        <div><UsersRound /><span>可管理账号<strong>{payload?.accounts.length || 0}</strong></span></div>
        <div><CirclePower /><span>正常启用<strong>{activeCount}</strong></span></div>
        <div><MapPinned /><span>授权区域<strong>{areaCount}</strong></span></div>
        <div><ShieldCheck /><span>本级身份<strong>{payload?.current.roleLabel || ROLE_META[user.role].label}</strong></span></div>
      </section>

      {message && <div className="message-banner success"><Check size={18} />{message}</div>}
      {error && <div className="message-banner error"><X size={18} />{error}</div>}

      <div className="access-workspace">
        <aside className="account-tree">
          <div className="account-tree-head">
            <div><span>组织账号</span><strong>本级及下级</strong></div>
            <button onClick={() => setCreateOpen((current) => !current)}><Plus size={16} />新增</button>
          </div>

          {createOpen && (
            <form className="account-create-card" onSubmit={createAccount}>
              <div className="create-card-title"><UserRoundPlus size={18} /><strong>创建下级账号</strong><button type="button" onClick={() => setCreateOpen(false)}><X size={15} /></button></div>
              <div className="create-grid">
                <label><span>姓名</span><input value={createForm.displayName} onChange={(event) => setCreateForm({ ...createForm, displayName: event.target.value })} required /></label>
                <label><span>角色</span><select value={createForm.role} onChange={(event) => {
                  const nextRole = event.target.value as Role;
                  const parents = visibleParentOptions(nextRole);
                  setCreateForm({ ...createForm, role: nextRole, areaLevel: nextRole === 'ATL' ? 'county' : createForm.areaLevel, parentUserId: parents[0]?.id || user.id });
                }}>{manageableRoles.map((item) => <option key={item} value={item}>{ROLE_META[item].label} · {item}</option>)}</select></label>
                <label><span>登录账号</span><input value={createForm.username} onChange={(event) => setCreateForm({ ...createForm, username: event.target.value.toLowerCase() })} required /></label>
                <label><span>初始密码</span><input type="password" value={createForm.password} onChange={(event) => setCreateForm({ ...createForm, password: event.target.value })} required /></label>
                <label className="wide"><span>上级账号</span><select value={createForm.parentUserId} onChange={(event) => setCreateForm({ ...createForm, parentUserId: Number(event.target.value) })}>{visibleParentOptions(createForm.role).map((parent) => <option key={parent.id} value={parent.id}>{parent.displayName} · {parent.roleLabel}</option>)}</select></label>
                {createForm.role !== 'ATL' && <label><span>区域级别</span><select value={createForm.areaLevel} onChange={(event) => setCreateForm({ ...createForm, areaLevel: event.target.value as AreaLevel })}>{Object.entries(AREA_LEVEL_META).map(([key, meta]) => <option key={key} value={key}>{meta.label}</option>)}</select></label>}
                {(createForm.areaLevel !== 'national' || createForm.role === 'ATL') && <label><span>省份</span><select value={createForm.province} onChange={(event) => setCreateForm({ ...createForm, province: event.target.value })}>{payload?.meta.provinces.map((province) => <option key={province}>{province}</option>)}</select></label>}
                {(['city', 'county'].includes(createForm.areaLevel) || createForm.role === 'ATL') && <label><span>城市</span><input value={createForm.city} onChange={(event) => setCreateForm({ ...createForm, city: event.target.value })} required /></label>}
                {(createForm.areaLevel === 'county' || createForm.role === 'ATL') && <label><span>区县</span><input value={createForm.county} onChange={(event) => setCreateForm({ ...createForm, county: event.target.value })} required /></label>}
                <label><span>项目</span><select value={createForm.project} onChange={(event) => setCreateForm({ ...createForm, project: event.target.value })}>{payload?.meta.projects.map((project) => <option key={project}>{project}</option>)}</select></label>
                <label><span>队伍</span><input value={createForm.team} onChange={(event) => setCreateForm({ ...createForm, team: event.target.value })} required /></label>
                {createForm.role === 'ATL' && <label><span>性别</span><select value={createForm.gender} onChange={(event) => setCreateForm({ ...createForm, gender: event.target.value })}><option>男</option><option>女</option></select></label>}
              </div>
              <button className="primary-button" disabled={saving}>{saving ? '创建中…' : '创建并绑定权限'}</button>
            </form>
          )}

          <div className="account-tree-scroll">
            {loading ? <div className="access-empty">正在加载账号…</div> : accountGroups.length ? accountGroups.map((group) => (
              <section className="account-level-group" key={group.roles.join('-')}>
                <div className="level-label"><span>{group.label}</span><i>{group.accounts.length}</i></div>
                {group.accounts.map((account) => (
                  <button key={account.id} className={selectedId === account.id ? 'active' : ''} onClick={() => chooseAccount(account)}>
                    <span className={`account-avatar role-${account.role.toLowerCase()}`}>{account.displayName.slice(0, 1)}</span>
                    <span className="account-list-copy">
                      <strong>{account.displayName}<i>{account.role}</i></strong>
                      <small>{compactScope(account)}</small>
                    </span>
                    {!account.active && <em>停用</em>}
                    <ChevronRight size={16} />
                  </button>
                ))}
              </section>
            )) : <div className="access-empty">暂无可管理的下级账号</div>}
          </div>
        </aside>

        <section className="access-editor">
          {selected ? (
            <>
              <header className="access-profile">
                <div className={`access-profile-avatar role-${selected.role.toLowerCase()}`}>{selected.displayName.slice(0, 1)}</div>
                <div>
                  <span>{selected.roleLabel} · {selected.role}</span>
                  <h2><EditableName value={selected.displayName} canEdit onSave={(name) => renameAccount(selected.id, name)} label="账号姓名" /></h2>
                  <p>@{selected.username}</p>
                </div>
                <button className={selected.active ? 'status-button active' : 'status-button'} onClick={setStatus} disabled={!canEditAccess || saving}><CirclePower size={16} />{selected.active ? '正常启用' : '已停用'}</button>
              </header>

              <div className="account-signature">
                <Fingerprint size={18} />
                <div><span>统一账号标识</span><strong>{selected.accountCode}</strong><small>{selected.standardName}</small></div>
              </div>

              <section className="coordinate-section">
                <div className="coordinate-title"><GitBranch size={18} /><div><h3>岗位与归属</h3><p>上级只能配置权限范围内的下级账号</p></div></div>
                <div className="coordinate-grid">
                  <label><span>账号角色</span><select disabled={!canEditAccess} value={role} onChange={(event) => {
                    const nextRole = event.target.value as Role;
                    setRole(nextRole);
                    const nextParents = visibleParentOptions(nextRole);
                    if (!nextParents.some((parent) => parent.id === parentUserId)) setParentUserId(nextParents[0]?.id || user.id);
                  }}>{manageableRoles.filter((item) => selected.role === 'ATL' ? item === 'ATL' : item !== 'ATL').map((item) => <option key={item} value={item}>{ROLE_META[item].label} · {item}</option>)}</select></label>
                  <label><span>上级管理账号</span><select disabled={!canEditAccess} value={parentUserId} onChange={(event) => setParentUserId(Number(event.target.value))}>{visibleParentOptions(role).filter((parent) => parent.id !== selected.id).map((parent) => <option key={parent.id} value={parent.id}>{parent.displayName} · {parent.roleLabel}</option>)}</select></label>
                </div>
              </section>

              <section className="coordinate-section">
                <div className="coordinate-title"><MapPinned size={18} /><div><h3>行政区域范围</h3><p>同级区域相互隔离，可为负责人增加多个授权区域</p></div>{canEditAccess && selected.role !== 'ATL' && <button onClick={() => setAreas([...areas, blankArea()])}><Plus size={15} />增加区域</button>}</div>
                <div className="area-scope-list">
                  {areas.map((area, index) => (
                    <div className="area-scope-row" key={`${index}-${area.areaLevel}`}>
                      <select disabled={!canEditAccess || selected.role === 'ATL'} value={area.areaLevel} onChange={(event) => updateArea(index, 'areaLevel', event.target.value)}>
                        {Object.entries(AREA_LEVEL_META).map(([key, meta]) => <option key={key} value={key}>{meta.label}</option>)}
                      </select>
                      {area.areaLevel !== 'national' && <select disabled={!canEditAccess} value={area.province} onChange={(event) => updateArea(index, 'province', event.target.value)}>{payload?.meta.provinces.map((province) => <option key={province}>{province}</option>)}</select>}
                      {['city', 'county'].includes(area.areaLevel) && <input disabled={!canEditAccess} value={area.city} onChange={(event) => updateArea(index, 'city', event.target.value)} placeholder="城市" />}
                      {area.areaLevel === 'county' && <input disabled={!canEditAccess} value={area.county} onChange={(event) => updateArea(index, 'county', event.target.value)} placeholder="区县" />}
                      {canEditAccess && areas.length > 1 && <button onClick={() => setAreas(areas.filter((_, itemIndex) => itemIndex !== index))} aria-label="移除区域"><X size={16} /></button>}
                    </div>
                  ))}
                </div>
              </section>

              <section className="coordinate-section">
                <div className="coordinate-title"><Activity size={18} /><div><h3>项目与队伍范围</h3><p>查询时行政区域、项目和队伍三个条件必须同时满足</p></div></div>
                <div className="project-options">
                  {selected.role !== 'ATL' && <button disabled={!canEditAccess} className={projects.includes('*') ? 'selected' : ''} onClick={() => toggleProject('*')}>全部项目</button>}
                  {payload?.meta.projects.map((project) => <button disabled={!canEditAccess} key={project} className={projects.includes(project) ? 'selected' : ''} onClick={() => toggleProject(project)}>{project}</button>)}
                </div>
                <div className="team-scope-list">
                  {teams.map((team, index) => (
                    <div className="team-scope-row" key={`${index}-${team.project}`}>
                      <select disabled={!canEditAccess || selected.role === 'ATL'} value={team.project} onChange={(event) => setTeams(teams.map((item, itemIndex) => itemIndex === index ? { ...item, project: event.target.value } : item))}>
                        {selected.role !== 'ATL' && <option value="*">全部项目</option>}
                        {payload?.meta.projects.map((project) => <option key={project}>{project}</option>)}
                      </select>
                      <input disabled={!canEditAccess} value={team.team} onChange={(event) => setTeams(teams.map((item, itemIndex) => itemIndex === index ? { ...item, team: event.target.value } : item))} placeholder="队伍名称；填写 * 代表全部队伍" />
                      {canEditAccess && selected.role !== 'ATL' && teams.length > 1 && <button onClick={() => setTeams(teams.filter((_, itemIndex) => itemIndex !== index))}><X size={16} /></button>}
                    </div>
                  ))}
                  {canEditAccess && selected.role !== 'ATL' && <button className="add-team-scope" onClick={() => setTeams([...teams, blankTeam()])}><Plus size={15} />增加队伍范围</button>}
                </div>
              </section>

              {canEditAccess && <footer className="access-editor-footer"><span>保存后，服务端查询会立即应用新的权限条件。</span><button className="primary-button" disabled={saving} onClick={save}><Save size={16} />{saving ? '保存中…' : '保存账号权限'}</button></footer>}
            </>
          ) : <div className="access-editor-empty"><ShieldCheck size={42} /><strong>选择一个下级账号</strong><p>查看并设置角色、上级、区域和项目队伍范围。</p></div>}
        </section>
      </div>

      {user.role === 'DMD' && (
        <section className="audit-panel">
          <div className="audit-head"><div><FileClock size={19} /><span><strong>权限与操作日志</strong><small>最近200条</small></span></div><span>原始记录不可在此删除</span></div>
          <div className="audit-table-wrap">
            <table>
              <thead><tr><th>时间</th><th>操作账号</th><th>动作</th><th>对象</th></tr></thead>
              <tbody>{logs.slice(0, 20).map((log) => <tr key={log.id}><td>{new Date(log.createdAt.replace(' ', 'T') + 'Z').toLocaleString('zh-CN')}</td><td>{log.actorName}<small>@{log.actorUsername}</small></td><td>{auditLabels[log.action] || log.action}</td><td>{log.entityType} #{log.entityId || '—'}</td></tr>)}</tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
