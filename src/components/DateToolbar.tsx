import { CalendarRange, Check, ChevronDown, Search, UserRound, UsersRound, X } from 'lucide-react';
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
  presetMode?: 'default' | 'dayWeekMonth';
  athleteMode?: 'select' | 'team' | 'self';
};

export function DateToolbar({ from, to, athleteId, athletes, onRangeChange, onAthleteChange, project, projects, onProjectChange, canRenameAthletes, onAthleteNameChange, presetMode = 'default', athleteMode = 'select' }: Props) {
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
  const today = toIsoDate(new Date());
  const presetRanges = {
    day: { from: today, to: today },
    week: { from: startOfWeek(today), to: today },
    month: { from: `${today.slice(0, 7)}-01`, to: today },
    recentMonth: { from: addDays(today, -29), to: today },
    recentYear: { from: addDays(today, -364), to: today }
  };
  const presets = presetMode === 'dayWeekMonth'
    ? ([['day', '日', '查看今日数据'], ['week', '周', '查看本周数据'], ['month', '月', '查看本月数据']] as const)
    : ([['day', '今天', '查看今天数据'], ['recentMonth', '最近一月', '查看最近30天数据'], ['recentYear', '最近一年', '查看最近365天数据']] as const);
  const setPreset = (preset: keyof typeof presetRanges) => {
    const range = presetRanges[preset];
    onRangeChange(range.from, range.to);
  };

  return (
    <div className="date-toolbar">
      <div className="range-presets" aria-label="快速选择时间范围">
        {presets.map(([key, label, title]) => {
          const range = presetRanges[key];
          const active = from === range.from && to === range.to;
          return <button key={key} type="button" className={active ? 'active' : ''} aria-pressed={active} title={title} onClick={() => setPreset(key)}>{label}</button>;
        })}
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

      {athleteMode === 'select' ? <div className={`athlete-picker ${athleteOpen ? 'open' : ''}`} ref={pickerRef}>
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
      </div> : (
        <div className={`overview-scope-filter ${athleteMode}`} aria-label={athleteMode === 'team' ? '当前按权限范围汇总团队数据' : '当前仅展示本人数据'}>
          {athleteMode === 'team' ? <UsersRound size={16} /> : <UserRound size={16} />}
          <span><strong>{athleteMode === 'team' ? '权限团队汇总' : selectedAthlete?.name || '本人数据'}</strong><small>{athleteMode === 'team' ? `${athletes.length}名${project}运动员` : '仅本人训练数据'}</small></span>
        </div>
      )}
      {athleteMode === 'select' && selectedAthlete && canRenameAthletes && onAthleteNameChange && (
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
