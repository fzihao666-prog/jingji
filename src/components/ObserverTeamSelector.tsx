import { useState } from 'react';
import { projectLabel } from '../../shared/projects';
import type { ProjectTeam, TeamPermission } from '../types';

type Props = {
  options: ProjectTeam[];
  selected: TeamPermission[];
  onChange: (teams: TeamPermission[]) => void;
  disabled?: boolean;
};

export function ObserverTeamSelector({ options, selected, onChange, disabled = false }: Props) {
  const [query, setQuery] = useState('');
  const search = query.trim().toLocaleLowerCase();
  const visible = options.filter((team) =>
    `${team.name} ${projectLabel(team.project)}`.toLocaleLowerCase().includes(search)
  );

  function toggle(team: ProjectTeam, checked: boolean) {
    const remaining = selected.filter(
      (scope) => scope.team && (scope.project !== team.project || scope.team !== team.name)
    );
    onChange(checked ? [...remaining, { project: team.project, team: team.name }] : remaining);
  }

  return (
    <fieldset className="observer-team-selector wide">
      <legend>可阅览队伍</legend>
      <div className="observer-team-toolbar">
        <label className="observer-team-search">
          <span className="visually-hidden">搜索队伍或所属项目</span>
          <input
            type="search"
            placeholder="搜索队伍或所属项目"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <span className="observer-team-count" role="status">
          已选 {selected.filter((team) => team.team).length} 支
        </span>
      </div>
      <div className="observer-team-options">
        {visible.map((team) => {
          const checked = selected.some(
            (scope) => scope.project === team.project && scope.team === team.name
          );
          return (
            <label key={team.id} className={`observer-team-option${checked ? ' is-selected' : ''}`}>
              <input
                type="checkbox"
                checked={checked}
                disabled={disabled}
                onChange={(event) => toggle(team, event.target.checked)}
              />
              <span className="observer-team-copy">
                <span className="observer-team-name">{team.name}</span>
                <span className="observer-team-project">{projectLabel(team.project)}</span>
              </span>
            </label>
          );
        })}
        {!visible.length && (
          <p className="observer-team-empty" role="status">
            {options.length ? '没有匹配的队伍，请更换搜索词。' : '暂无可授权队伍'}
          </p>
        )}
      </div>
    </fieldset>
  );
}
