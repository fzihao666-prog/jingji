import { CalendarRange, Check, ChevronDown, Search, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Athlete, Project } from '../types';
import { addDays, startOfWeek, toIsoDate } from '../utils';
import { EditableName } from './EditableName';
import { ProjectMark } from './ProjectMark';

type Props = {
  from: string;
  to: string;
  athleteId: number | null;
  athletes: Athlete[];
  onRangeChange: (from: string, to: string) => void;
  onAthleteChange: (athleteId: number | null) => void;
  project: Project;
  projects: Project[];
  onProjectChange: (project: Project) => void;
  canRenameAthletes?: boolean;
  onAthleteNameChange?: (id: number, name: string) => Promise<void>;
};

export function DateToolbar({ from, to, athleteId, athletes, onRangeChange, onAthleteChange, project, projects, onProjectChange, canRenameAthletes, onAthleteNameChange }: Props) {
  const selectedAthlete = athletes.find((athlete) => athlete.id === athleteId);
  const [athleteOpen, setAthleteOpen] = useState(false);
  const [query, setQuery] = useState('');
  const pickerRef = useRef<HTMLDivElement>(null);
  const filteredAthletes = useMemo(() => {
    const keyword = query.trim().toLocaleLowerCase('zh-CN');
    if (!keyword) return athletes;
    return athletes.filter((athlete) => [athlete.name, athlete.region, athlete.city, athlete.county, athlete.team]
      .some((value) => value?.toLocaleLowerCase('zh-CN').includes(keyword)));
  }, [athletes, query]);

  useEffect(() => {
    setQuery('');
    setAthleteOpen(false);
  }, [project]);

  useEffect(() => {
    const close = (event: MouseEvent) => {
      if (!pickerRef.current?.contains(event.target as Node)) setAthleteOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);
  const setPreset = (preset: 'week' | 'fourWeeks' | 'month') => {
    const today = toIsoDate(new Date());
    if (preset === 'week') onRangeChange(startOfWeek(today), today);
    if (preset === 'fourWeeks') onRangeChange(addDays(today, -27), today);
    if (preset === 'month') onRangeChange(`${today.slice(0, 7)}-01`, today);
  };

  return (
    <div className="date-toolbar">
      <div className="range-presets" aria-label="快速选择时间范围">
        <button onClick={() => setPreset('week')}>本周</button>
        <button onClick={() => setPreset('fourWeeks')}>近4周</button>
        <button onClick={() => setPreset('month')}>本月</button>
      </div>

      <label className="date-input">
        <CalendarRange size={17} />
        <input aria-label="开始日期" type="date" value={from} max={to} onChange={(event) => onRangeChange(event.target.value, to)} />
        <span>至</span>
        <input aria-label="结束日期" type="date" value={to} min={from} onChange={(event) => onRangeChange(from, event.target.value)} />
      </label>

      <label className={`project-filter ${project === '皮划艇' ? 'canoe' : project === '激流' ? 'slalom' : 'rowing'}`}>
        <span className="visually-hidden">选择项目大类</span>
        <ProjectMark project={project} />
        <select aria-label="选择项目大类" value={project} onChange={(event) => onProjectChange(event.target.value as Project)}>
          {projects.map((item) => <option key={item} value={item}>{item}</option>)}
        </select>
        <ChevronDown size={14} />
      </label>

      <div className={`athlete-picker ${athleteOpen ? 'open' : ''}`} ref={pickerRef}>
        <button className="athlete-picker-trigger" type="button" onClick={() => setAthleteOpen((value) => !value)} aria-expanded={athleteOpen}>
          <Search size={15} />
          <span>{selectedAthlete ? selectedAthlete.name : `全部${project}运动员`}</span>
          <ChevronDown size={15} />
        </button>
        {athleteOpen && <div className="athlete-picker-menu">
          <label className="athlete-search-box">
            <Search size={15} />
            <input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder={`搜索${project}运动员、地区或队伍`} onKeyDown={(event) => { if (event.key === 'Escape') setAthleteOpen(false); }} />
            {query && <button type="button" onClick={() => setQuery('')} aria-label="清空搜索"><X size={14} /></button>}
          </label>
          <div className={`athlete-picker-project ${project === '皮划艇' ? 'canoe' : project === '激流' ? 'slalom' : 'rowing'}`}><ProjectMark project={project} />{project}<span>{athletes.length}人</span></div>
          <div className="athlete-picker-options">
            <button type="button" className={athleteId === null ? 'selected' : ''} onClick={() => { onAthleteChange(null); setAthleteOpen(false); setQuery(''); }}>
              <span><strong>全部{project}运动员</strong><small>查看当前项目汇总</small></span>{athleteId === null && <Check size={15} />}
            </button>
            {filteredAthletes.map((athlete) => <button type="button" key={athlete.id} className={athlete.id === athleteId ? 'selected' : ''} onClick={() => { onAthleteChange(athlete.id); setAthleteOpen(false); setQuery(''); }}>
              <span><strong>{athlete.name}</strong><small>{athlete.region} · {athlete.team}</small></span>{athlete.id === athleteId && <Check size={15} />}
            </button>)}
            {!filteredAthletes.length && <div className="athlete-picker-empty">没有找到“{query}”</div>}
          </div>
        </div>}
      </div>
      {selectedAthlete && canRenameAthletes && onAthleteNameChange && (
        <EditableName
          value={selectedAthlete.name}
          showValue={false}
          canEdit
          onSave={(name) => onAthleteNameChange(selectedAthlete.id, name)}
          label="运动员姓名"
          className="select-name-editor"
        />
      )}
    </div>
  );
}
