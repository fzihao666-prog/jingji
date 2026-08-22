import { Layers3, Plus, Trash2, UsersRound } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { PROJECTS, type Project } from '../../shared/projects';
import { api } from '../api';
import type { ProjectTeam } from '../types';

export function TeamsPage() {
  const [teams, setTeams] = useState<ProjectTeam[]>([]);
  const [canCreateProjects, setCanCreateProjects] = useState<Project[]>([]);
  const [project, setProject] = useState<Project>('赛艇');
  const [name, setName] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const result = await api.adminTeams();
      setTeams(result.teams);
      setCanCreateProjects(result.canCreateProjects);
      if (result.canCreateProjects.length && !result.canCreateProjects.includes(project)) setProject(result.canCreateProjects[0]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const create = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setMessage('');
    try {
      const result = await api.createTeam(project, name.trim());
      setMessage(result.message);
      setName('');
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '添加失败。');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (team: ProjectTeam) => {
    if (!window.confirm(`确认删除“${team.name}”吗？`)) return;
    setMessage('');
    try {
      const result = await api.deleteTeam(team.id);
      setMessage(result.message);
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '删除失败。');
    }
  };

  return (
    <div className="page-content teams-page">
      <header className="page-heading compact-heading">
        <div><p className="eyebrow">PROJECT TEAM DIRECTORY</p><h1>队伍管理</h1><p>维护各项目可选队伍，注册申请将实时使用这里的队伍目录。</p></div>
        <span className="count-chip large"><Layers3 size={17} />{teams.length}支队伍</span>
      </header>

      {canCreateProjects.length > 0 && <form className="team-create-panel" onSubmit={create}>
        <label><span>所属项目</span><select value={project} onChange={(event) => setProject(event.target.value as Project)}>{canCreateProjects.map((item) => <option key={item}>{item}</option>)}</select></label>
        <label><span>队伍名称</span><input value={name} onChange={(event) => setName(event.target.value)} placeholder="如：女子双桨组" minLength={2} maxLength={30} required /></label>
        <button className="primary-button" disabled={busy}><Plus size={17} />{busy ? '添加中…' : '添加队伍'}</button>
      </form>}
      {message && <div className="message-banner success">{message}</div>}

      {loading ? <div className="simple-loading">正在加载…</div> : (
        <section className="team-project-grid">
          {PROJECTS.filter((item) => teams.some((team) => team.project === item) || canCreateProjects.includes(item)).map((item) => {
            const projectTeams = teams.filter((team) => team.project === item);
            return (
              <article className="team-project-card" key={item}>
                <header><div><strong>{item}</strong><small>{projectTeams.length}支队伍</small></div></header>
                <div className="team-directory-list">
                  {projectTeams.length ? projectTeams.map((team) => (
                    <div key={team.id}>
                      <span><UsersRound size={15} /><strong>{team.name}</strong><small>{team.athleteCount}名运动员</small></span>
                      {team.canDelete && <button className="icon-button" onClick={() => void remove(team)} disabled={team.athleteCount > 0} title={team.athleteCount ? '队伍仍有运动员，不能删除' : '删除队伍'} aria-label={`删除${team.name}`}><Trash2 size={16} /></button>}
                    </div>
                  )) : <p>暂无队伍，可在上方添加。</p>}
                </div>
              </article>
            );
          })}
        </section>
      )}
    </div>
  );
}
