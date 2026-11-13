import { ArrowDownRight, Layers3, Plus, Search, Trash2, UsersRound } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { PROJECTS, projectLabel, type Project } from '../../shared/projects';
import { api } from '../api';
import type { ProjectTeam } from '../types';
import { ContentState, PageContainer, PageHeader } from '../components/PageLayout';

export function TeamsPage() {
  const [teams, setTeams] = useState<ProjectTeam[]>([]);
  const [canCreateProjects, setCanCreateProjects] = useState<Project[]>([]);
  const [project, setProject] = useState<Project>('ROWING');
  const [name, setName] = useState('');
  const [query, setQuery] = useState('');
  const createDialog = useRef<HTMLDialogElement>(null);
  const [createError, setCreateError] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const result = await api.adminTeams();
      setTeams(result.teams);
      setCanCreateProjects(result.canCreateProjects);
      if (result.canCreateProjects.length && !result.canCreateProjects.includes(project))
        setProject(result.canCreateProjects[0]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const create = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setCreateError('');
    setMessage('');
    try {
      const result = await api.createTeam(project, name.trim());
      setMessage(result.message);
      setName('');
      createDialog.current?.close();
      await load();
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '添加失败。';
      if (createDialog.current?.open) setCreateError(errorMessage);
      else setMessage(errorMessage);
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

  const searchTerm = query.trim().normalize('NFKC').toLowerCase();
  const matches = searchTerm
    ? teams.filter(team => team.name.normalize('NFKC').toLowerCase().includes(searchTerm))
    : [];

  const jumpToTeam = (team: ProjectTeam) => {
    const row = document.getElementById(`team-row-${team.id}`);
    if (!row) return;
    setQuery('');
    row.focus({ preventScroll: true });
    row.scrollIntoView({ block: 'center' });
  };

  const teamCount = (
    <span className="count-chip large team-total-count">
      <Layers3 size={17} aria-hidden="true" />
      {teams.length}支队伍
    </span>
  );

  return (
    <PageContainer className="teams-page">
      <PageHeader variant="compact" title="队伍管理" />

      <div className="team-directory-toolbar">
        {teamCount}
        <form
          className="team-search"
          role="search"
          onSubmit={(event) => {
            event.preventDefault();
            if (matches.length === 1) jumpToTeam(matches[0]);
          }}
        >
          <Search size={16} aria-hidden="true" />
          <input
            type="search"
            aria-label="搜索队伍名称"
            placeholder="搜索队伍名称"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            disabled={loading}
          />
        </form>
        {canCreateProjects.length > 0 && (
          <button
            type="button"
            className="primary-button team-create-toggle"
            aria-haspopup="dialog"
            onClick={() => {
              setCreateError('');
              createDialog.current?.showModal();
            }}
          >
            <Plus size={16} aria-hidden="true" />
            添加队伍
          </button>
        )}
      </div>
      {searchTerm && !loading && (
        <div className="team-search-results">
          <p role="status">{matches.length ? `找到 ${matches.length} 支队伍` : '没有找到匹配的队伍'}</p>
          {matches.length > 0 && (
            <ul>
              {matches.map(team => (
                <li key={team.id}>
                  <button type="button" className="secondary-button" onClick={() => jumpToTeam(team)}>
                    <span>{team.name}</span>
                    <small>{projectLabel(team.project)}</small>
                    <ArrowDownRight size={16} aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {canCreateProjects.length > 0 && (
        <dialog
          ref={createDialog}
          className="team-create-dialog"
          aria-labelledby="team-create-title"
          onCancel={(event) => {
            if (busy) event.preventDefault();
          }}
        >
          <h2 id="team-create-title">添加队伍</h2>
          <form className="team-create-panel" onSubmit={create}>
            <label>
              <span>所属项目</span>
              <select value={project} onChange={(event) => setProject(event.target.value as Project)}>
                {canCreateProjects.map((item) => (
                  <option key={item} value={item}>{projectLabel(item)}</option>
                ))}
              </select>
            </label>
            <label>
              <span>队伍名称</span>
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="如：女子双桨组"
                minLength={2}
                maxLength={30}
                required
              />
            </label>
            {createError && <p className="message-banner error" role="alert">{createError}</p>}
            <div className="team-create-actions">
              <button type="button" className="secondary-button" disabled={busy} onClick={() => createDialog.current?.close()}>
                取消
              </button>
              <button type="submit" className="primary-button" disabled={busy}>
                {busy ? '添加中…' : '确认添加'}
              </button>
            </div>
          </form>
        </dialog>
      )}
      {message && <div className="message-banner success">{message}</div>}

      {loading ? (
        <ContentState kind="loading" title="正在加载队伍目录…" />
      ) : (
        <section className="team-project-grid">
          {PROJECTS.map((item) => ({
            item,
            projectTeams: teams.filter((team) => team.project === item),
          }))
            .filter(({ item, projectTeams }) => projectTeams.length || canCreateProjects.includes(item))
            .sort((left, right) => right.projectTeams.length - left.projectTeams.length)
            .map(({ item, projectTeams }) => {
              return (
                <article className="team-project-card" key={item}>
                  <header>
                    <div>
                      <strong>{projectLabel(item)}</strong>
                      <small>{projectTeams.length}支队伍</small>
                    </div>
                  </header>
                  <div className="team-directory-list">
                    {projectTeams.length ? (
                      projectTeams.map((team) => (
                        <div id={`team-row-${team.id}`} key={team.id} tabIndex={-1}>
                          <span>
                            <UsersRound size={15} />
                            <strong>{team.name}</strong>
                            <small>
                              {team.athleteCount > 0
                                ? `${team.athleteCount}名运动员 · 仍有运动员，不能删除`
                                : `${team.athleteCount}名运动员`}
                            </small>
                          </span>
                          {team.canDelete && (
                            <button
                              className="icon-button"
                              onClick={() => void remove(team)}
                              disabled={team.athleteCount > 0}
                              title={team.athleteCount ? '队伍仍有运动员，不能删除' : '删除队伍'}
                              aria-label={`删除${team.name}`}
                            >
                              <Trash2 size={16} />
                            </button>
                          )}
                        </div>
                      ))
                    ) : (
                      <p>暂无队伍，可在上方添加。</p>
                    )}
                  </div>
                </article>
              );
            })}
        </section>
      )}
    </PageContainer>
  );
}
