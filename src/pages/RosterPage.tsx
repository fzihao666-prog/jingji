import { Check, ChevronLeft, ChevronRight, Link2, ListFilter, MapPin, Search, Save, UsersRound, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import type { Athlete, User } from '../types';
import { PROVINCES } from '../../shared/regions';
import { ROLE_META } from '../../shared/access';
import { EditableName } from '../components/EditableName';

type AssignmentAthlete = Athlete & { coachIds: string };
const ROSTER_PAGE_SIZE = 6;

export function RosterPage({ user, athletes: visibleAthletes, onChanged }: { user: User; athletes: Athlete[]; onChanged: () => void }) {
  const [athletes, setAthletes] = useState<AssignmentAthlete[]>([]);
  const [coaches, setCoaches] = useState<Array<{ id: number; displayName: string }>>([]);
  const [editing, setEditing] = useState<Record<number, number[]>>({});
  const [regionEditing, setRegionEditing] = useState<Record<number, string>>({});
  const [cityEditing, setCityEditing] = useState<Record<number, string>>({});
  const [countyEditing, setCountyEditing] = useState<Record<number, string>>({});
  const [saving, setSaving] = useState<number | null>(null);
  const [message, setMessage] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [projectFilter, setProjectFilter] = useState('');
  const [teamFilter, setTeamFilter] = useState('');
  const [currentPage, setCurrentPage] = useState(1);

  const loadAssignments = async () => {
    const result = await api.assignments();
    setAthletes(result.athletes);
    setCoaches(result.coaches);
    setEditing(Object.fromEntries(result.athletes.map((athlete) => [athlete.id, athlete.coachIds ? athlete.coachIds.split(',').map(Number) : []])));
    setRegionEditing(Object.fromEntries(result.athletes.map((athlete) => [athlete.id, athlete.region])));
    setCityEditing(Object.fromEntries(result.athletes.map((athlete) => [athlete.id, athlete.city])));
    setCountyEditing(Object.fromEntries(result.athletes.map((athlete) => [athlete.id, athlete.county])));
  };

  useEffect(() => {
    void loadAssignments();
  }, [user.role]);

  const canManage = ROLE_META[user.role].level >= 3;
  const shown = athletes.length ? athletes : visibleAthletes;
  const projects = useMemo(
    () => [...new Set(shown.map((athlete) => athlete.project).filter(Boolean))].sort((left, right) => left.localeCompare(right, 'zh-CN')),
    [shown]
  );
  const teams = useMemo(
    () => [...new Set(shown
      .filter((athlete) => !projectFilter || athlete.project === projectFilter)
      .map((athlete) => athlete.team)
      .filter(Boolean))].sort((left, right) => left.localeCompare(right, 'zh-CN')),
    [shown, projectFilter]
  );
  const filteredAthletes = useMemo(() => {
    const query = searchTerm.trim().toLocaleLowerCase();
    return shown.filter((athlete) => {
      if (projectFilter && athlete.project !== projectFilter) return false;
      if (teamFilter && athlete.team !== teamFilter) return false;
      if (!query) return true;
      return [
        athlete.name,
        athlete.project,
        athlete.team,
        athlete.gender,
        athlete.region,
        athlete.city,
        athlete.county,
        athlete.coaches
      ].some((value) => String(value || '').toLocaleLowerCase().includes(query));
    });
  }, [shown, searchTerm, projectFilter, teamFilter]);
  const pageCount = Math.max(1, Math.ceil(filteredAthletes.length / ROSTER_PAGE_SIZE));
  const safePage = Math.min(currentPage, pageCount);
  const pagedAthletes = filteredAthletes.slice((safePage - 1) * ROSTER_PAGE_SIZE, safePage * ROSTER_PAGE_SIZE);
  const rangeStart = filteredAthletes.length ? (safePage - 1) * ROSTER_PAGE_SIZE + 1 : 0;
  const rangeEnd = Math.min(safePage * ROSTER_PAGE_SIZE, filteredAthletes.length);
  const hasActiveFilters = Boolean(searchTerm.trim() || projectFilter || teamFilter);

  useEffect(() => {
    if (currentPage > pageCount) setCurrentPage(pageCount);
  }, [currentPage, pageCount]);

  const changeProjectFilter = (project: string) => {
    setProjectFilter(project);
    setTeamFilter('');
    setCurrentPage(1);
  };

  const resetFilters = () => {
    setSearchTerm('');
    setProjectFilter('');
    setTeamFilter('');
    setCurrentPage(1);
  };

  const toggleCoach = (athleteId: number, coachId: number) => {
    const current = editing[athleteId] || [];
    setEditing({ ...editing, [athleteId]: current.includes(coachId) ? current.filter((id) => id !== coachId) : [...current, coachId] });
  };
  const save = async (athleteId: number) => {
    setSaving(athleteId);
    try {
      await api.updateAssignment(
        athleteId,
        editing[athleteId] || [],
        regionEditing[athleteId],
        cityEditing[athleteId],
        countyEditing[athleteId]
      );
      setMessage('人员关系和所属地区已更新。');
      await loadAssignments();
      onChanged();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '保存失败。');
    } finally {
      setSaving(null);
    }
  };

  const renameAthlete = async (athleteId: number, name: string) => {
    await api.renameAthlete(athleteId, name);
    await loadAssignments();
    setMessage('运动员姓名已修改。');
    onChanged();
  };

  const renameCoach = async (coachId: number, name: string) => {
    await api.renameUser(coachId, name);
    await loadAssignments();
    setMessage('教练姓名已修改。');
    onChanged();
  };

  return (
    <div className="page-content roster-page">
      <header className="page-heading compact-heading"><h1>人员关系</h1><span className="count-chip large"><UsersRound size={17} />{shown.length}名运动员</span></header>
      {message && <div className="message-banner success"><Check />{message}</div>}
      <section className="roster-control-bar" aria-label="人员筛选">
        <label className="roster-search-field">
          <span>搜索人员</span>
          <div><Search size={17} /><input value={searchTerm} onChange={(event) => { setSearchTerm(event.target.value); setCurrentPage(1); }} placeholder="姓名、教练、地区…" /></div>
        </label>
        <label className="roster-filter-field">
          <span>项目类别</span>
          <div><ListFilter size={16} /><select aria-label="项目类别" value={projectFilter} onChange={(event) => changeProjectFilter(event.target.value)}><option value="">全部项目</option>{projects.map((project) => <option key={project}>{project}</option>)}</select></div>
        </label>
        <label className="roster-filter-field">
          <span>队伍</span>
          <div><UsersRound size={16} /><select aria-label="队伍" value={teamFilter} onChange={(event) => { setTeamFilter(event.target.value); setCurrentPage(1); }}><option value="">全部队伍</option>{teams.map((team) => <option key={team}>{team}</option>)}</select></div>
        </label>
        <div className="roster-filter-summary" aria-live="polite">
          <small>当前结果</small>
          <strong>{filteredAthletes.length}<span> 人</span></strong>
          {hasActiveFilters && <button type="button" onClick={resetFilters}><X size={14} />清除</button>}
        </div>
      </section>
      <div className="roster-result-line">
        <span>{teamFilter ? <><strong>{teamFilter}</strong>队伍成员</> : projectFilter ? <><strong>{projectFilter}</strong>项目成员</> : '全部可管理人员'}</span>
        <small>显示 {rangeStart}–{rangeEnd}，共 {filteredAthletes.length} 人</small>
      </div>
      <section className="roster-grid">
        {pagedAthletes.map((athlete) => {
          const assigned = editing[athlete.id] || [];
          return (
            <article className="athlete-card" key={athlete.id}>
              <div className="athlete-card-top"><div className="record-avatar large">{athlete.name.slice(0, 1)}</div><div><h2><EditableName value={athlete.name} canEdit={canManage || user.role === 'SCC'} onSave={(name) => renameAthlete(athlete.id, name)} label="运动员姓名" /></h2><p>{athlete.project} · {athlete.team}</p></div><span>{athlete.gender}</span></div>
              <div className="athlete-region-row">
                <span><MapPin size={15} />所属地区</span>
                {canManage ? (
                  <div className="roster-area-fields">
                    <select value={regionEditing[athlete.id] || ''} onChange={(event) => setRegionEditing({ ...regionEditing, [athlete.id]: event.target.value })}>
                      <option value="">省份</option>
                      {PROVINCES.map((region) => <option key={region}>{region}</option>)}
                    </select>
                    <input value={cityEditing[athlete.id] || ''} onChange={(event) => setCityEditing({ ...cityEditing, [athlete.id]: event.target.value })} placeholder="城市" />
                    <input value={countyEditing[athlete.id] || ''} onChange={(event) => setCountyEditing({ ...countyEditing, [athlete.id]: event.target.value })} placeholder="区县" />
                  </div>
                ) : <strong>{[athlete.region, athlete.city, athlete.county].filter(Boolean).join(' / ') || '未设置'}</strong>}
              </div>
              <div className="assignment-heading"><span><Link2 size={15} />负责教练</span>{canManage && <small>可多选</small>}</div>
              {canManage ? (
                <div className="coach-options">
                  {coaches.map((coach) => (
                    <div key={coach.id} className={`coach-option-item ${assigned.includes(coach.id) ? 'checked' : ''}`}>
                      <label aria-label={`选择${coach.displayName}`}>
                        <input type="checkbox" checked={assigned.includes(coach.id)} onChange={() => toggleCoach(athlete.id, coach.id)} />
                        <i>{assigned.includes(coach.id) && <Check size={13} />}</i>
                      </label>
                      <EditableName value={coach.displayName} canEdit={ROLE_META[user.role].level > ROLE_META.SCC.level} onSave={(name) => renameCoach(coach.id, name)} label="教练姓名" />
                    </div>
                  ))}
                </div>
              ) : <div className="coach-readonly">{athlete.coaches || '尚未绑定教练'}</div>}
              {canManage && <button className="save-assignment" disabled={saving === athlete.id} onClick={() => save(athlete.id)}><Save size={15} />{saving === athlete.id ? '保存中…' : '保存关系'}</button>}
            </article>
          );
        })}
      </section>
      {!filteredAthletes.length && (
        <section className="roster-empty">
          <Search size={26} />
          <strong>没有找到符合条件的人员</strong>
          <span>更换项目或队伍，也可以缩短搜索关键词。</span>
          <button type="button" onClick={resetFilters}>查看全部人员</button>
        </section>
      )}
      {filteredAthletes.length > ROSTER_PAGE_SIZE && (
        <nav className="roster-pagination" aria-label="人员分页">
          <button type="button" aria-label="上一页" disabled={safePage === 1} onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}><ChevronLeft size={16} /></button>
          {Array.from({ length: pageCount }, (_, index) => index + 1).map((page) => <button type="button" key={page} className={page === safePage ? 'active' : ''} aria-current={page === safePage ? 'page' : undefined} onClick={() => setCurrentPage(page)}>{page}</button>)}
          <button type="button" aria-label="下一页" disabled={safePage === pageCount} onClick={() => setCurrentPage((page) => Math.min(pageCount, page + 1))}><ChevronRight size={16} /></button>
        </nav>
      )}
    </div>
  );
}
