import { CalendarRange, Check, ChevronDown } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { Project, ProjectTeam } from '../types';
import { addDays, toIsoDate } from '../utils';
import { projectEnglish, projectKey, projectLabel } from '../../shared/projects';
import { ProjectMark } from './ProjectMark';

type Props = {
  teams?: ProjectTeam[];
  teamId?: number | null;
  teamError?: string;
  onTeamChange?: (id: number | null) => void;
  from: string;
  to: string;
  onRangeChange: (from: string, to: string) => void;
  project: Project;
  projects: Project[];
  onProjectChange: (project: Project) => void;
  presetMode?: 'default' | 'period';
  projectControl?: 'select' | 'segments';
};

export function DateToolbar({
  teams = [], teamId = null, teamError, onTeamChange,
  from,
  to,
  onRangeChange,
  project,
  projects,
  onProjectChange,
  presetMode = 'default',
  projectControl = 'select',
}: Props) {
  const [teamOpen, setTeamOpen] = useState(false);
  const [teamSearch, setTeamSearch] = useState('');
  const teamRef = useRef<HTMLDivElement>(null);
  const [projectOpen, setProjectOpen] = useState(false);
  const [projectSearch, setProjectSearch] = useState('');
  const projectRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setTeamOpen(false);
    setTeamSearch('');
    setProjectOpen(false);
    setProjectSearch('');
  }, [project]);

  useEffect(() => {
    const close = (event: MouseEvent) => {
      if (!projectRef.current?.contains(event.target as Node)) setProjectOpen(false);
      if (!teamRef.current?.contains(event.target as Node)) setTeamOpen(false);
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, []);
  const today = toIsoDate(new Date());
  const presetRanges =
    presetMode === 'period'
      ? {
          day: { from: today, to: today },
          week: { from: addDays(today, -6), to: today },
          month: { from: addDays(today, -29), to: today },
        }
      : {
          day: { from: today, to: today },
          recentMonth: { from: addDays(today, -29), to: today },
          recentYear: { from: addDays(today, -364), to: today },
        };
  const presets =
    presetMode === 'period'
      ? ([
          ['day', '日', '查看当天训练总览'],
          ['week', '周', '查看最近7天训练总览'],
          ['month', '月', '查看最近30天训练总览'],
        ] as const)
      : ([
          ['day', '今天', '查看今天数据'],
          ['recentMonth', '最近一月', '查看最近30天数据'],
          ['recentYear', '最近一年', '查看最近365天数据'],
        ] as const);
  const setPreset = (preset: keyof typeof presetRanges) => {
    const range = presetRanges[preset]!;
    onRangeChange(range.from, range.to);
  };
  const visibleProjects = projects.filter((item) => {
    const keyword = projectSearch.trim().toLocaleLowerCase();
    return (
      !keyword ||
      projectLabel(item).includes(projectSearch.trim()) ||
      projectEnglish(item).toLocaleLowerCase().includes(keyword)
    );
  });
  return (
    <div className="date-toolbar">
      <div className="range-presets" aria-label="快速选择时间范围">
        {presets.map(([key, label, title]) => {
          const range = presetRanges[key]!;
          const active = from === range.from && to === range.to;
          return (
            <button
              key={key}
              type="button"
              className={active ? 'active' : ''}
              aria-pressed={active}
              title={title}
              onClick={() => setPreset(key)}
            >
              {label}
            </button>
          );
        })}
      </div>

      <label className="date-input">
        <CalendarRange size={17} />
        <input
          aria-label="开始日期"
          type="date"
          value={from}
          max={to}
          onChange={(event) => onRangeChange(event.target.value, to)}
        />
        <span>至</span>
        <input
          aria-label="结束日期"
          type="date"
          value={to}
          min={from}
          onChange={(event) => onRangeChange(from, event.target.value)}
        />
      </label>

      {projectControl === 'segments' ? (
        <div className="toolbar-project-segments" aria-label="选择运动种类">
          {projects.map((item) => (
            <button
              key={item}
              type="button"
              className={`${item === project ? 'active' : ''} ${projectKey(item)}`}
              aria-pressed={item === project}
              onClick={() => onProjectChange(item)}
            >
              <ProjectMark project={item} />
              <span>{projectLabel(item)}</span>
            </button>
          ))}
        </div>
      ) : (
        <div
          className={`project-select project-select-${projectKey(project)} ${projectOpen ? 'open' : ''}`}
          ref={projectRef}
        >
          <button
            type="button"
            className="project-select-trigger"
            onClick={() => { setProjectOpen((value) => !value); setTeamOpen(false); }}
            aria-expanded={projectOpen}
            aria-haspopup="listbox"
            aria-label="选择项目大类"
          >
            <ProjectMark project={project} />
            <span>{projectLabel(project)}</span>
            <ChevronDown size={14} className="project-select-chevron" />
          </button>
          <div className="project-select-menu" role="listbox" aria-label="项目大类">
            <input
              className="project-select-search"
              aria-label="搜索运动项目"
              value={projectSearch}
              onChange={(event) => setProjectSearch(event.target.value)}
              placeholder="搜索项目 / English"
            />
            {visibleProjects.map((item) => (
              <button
                key={item}
                type="button"
                role="option"
                aria-selected={item === project}
                className={`project-select-option ${item === project ? 'selected' : ''} project-select-option-${projectKey(item)}`}
                onClick={() => {
                  onProjectChange(item);
                  setProjectOpen(false);
                }}
              >
                <ProjectMark project={item} />
                <span>
                  <strong>{projectLabel(item)}</strong>
                  <small>{projectEnglish(item)}</small>
                </span>
                {item === project && <Check size={14} />}
              </button>
            ))}
          </div>
        </div>
      )}
      {onTeamChange && <div ref={teamRef} className={`project-select toolbar-team-select ${teamOpen ? 'open' : ''}`}
        onKeyDown={event => { if (event.key === 'Escape') { setTeamOpen(false); teamRef.current?.querySelector('button')?.focus(); } }}>
        <button type="button" className="project-select-trigger" aria-label="全局队伍筛选" aria-expanded={teamOpen} aria-haspopup="listbox"
          onClick={() => { setTeamOpen(open => !open); setProjectOpen(false); }}>
          <span>{teams.find(team => team.id === teamId)?.name ?? '全部队伍'}</span>
          <ChevronDown size={14} aria-hidden="true" className="project-select-chevron" />
        </button>
        <div className="project-select-menu" role="listbox" aria-label="队伍">
          <input className="project-select-search" aria-label="搜索队伍" placeholder="搜索队伍" value={teamSearch} onChange={event => setTeamSearch(event.target.value)} />
          {[{ id: null, name: '全部队伍' }, ...teams].filter(team => team.id === null || team.name.includes(teamSearch.trim())).map(team =>
            <button key={team.id ?? 'all'} type="button" role="option" aria-selected={team.id === teamId}
              className={`project-select-option ${team.id === teamId ? 'selected' : ''}`}
              onClick={() => { onTeamChange(team.id); setTeamOpen(false); setTeamSearch(''); teamRef.current?.querySelector('button')?.focus(); }}>
              <span><strong>{team.name}</strong></span>{team.id === teamId && <Check size={14} aria-hidden="true" />}
            </button>
          )}
        </div>
        {teamError && <span role="alert">{teamError}</span>}
      </div>}

    </div>
  );
}
