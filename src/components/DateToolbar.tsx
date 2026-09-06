import { CalendarRange, Check, ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { Project } from '../types';
import { addDays, toIsoDate } from '../utils';
import { projectKey } from '../../shared/projects';
import { ProjectMark } from './ProjectMark';

type Props = {
  from: string;
  to: string;
  onRangeChange: (from: string, to: string) => void;
  project: Project;
  projects: Project[];
  onProjectChange: (project: Project) => void;
  presetMode?: 'default' | 'period' | 'analysis';
  projectControl?: 'select' | 'segments';
};

export function DateToolbar({ from, to, onRangeChange, project, projects, onProjectChange, presetMode = 'default', projectControl = 'select' }: Props) {
  const [projectOpen, setProjectOpen] = useState(false);
  const projectRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setProjectOpen(false);
  }, [project]);

  useEffect(() => {
    const close = (event: MouseEvent) => {
      if (!projectRef.current?.contains(event.target as Node)) setProjectOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);
  const today = toIsoDate(new Date());
  const presetRanges = presetMode === 'analysis' ? {
    recent7: { from: addDays(today, -6), to: today },
    recent28: { from: addDays(today, -27), to: today },
    recent90: { from: addDays(today, -89), to: today }
  } : presetMode === 'period' ? {
    day: { from: today, to: today },
    week: { from: addDays(today, -6), to: today },
    month: { from: addDays(today, -29), to: today }
  } : {
    day: { from: today, to: today },
    recentMonth: { from: addDays(today, -29), to: today },
    recentYear: { from: addDays(today, -364), to: today }
  };
  const presets = presetMode === 'analysis'
    ? ([['recent7', '最近7天', '查看最近连续7天训练数据'], ['recent28', '最近28天', '查看最近连续28天训练数据'], ['recent90', '最近90天', '查看最近连续90天训练数据']] as const)
    : presetMode === 'period'
    ? ([['day', '日', '查看当天训练总览'], ['week', '周', '查看最近7天训练总览'], ['month', '月', '查看最近30天训练总览']] as const)
    : ([['day', '今天', '查看今天数据'], ['recentMonth', '最近一月', '查看最近30天数据'], ['recentYear', '最近一年', '查看最近365天数据']] as const);
  const setPreset = (preset: keyof typeof presetRanges) => {
    const range = presetRanges[preset]!;
    onRangeChange(range.from, range.to);
  };
  const rangeDays = Math.max(1, Math.round((Date.parse(`${to}T12:00:00`) - Date.parse(`${from}T12:00:00`)) / 86_400_000) + 1);
  const previousRange = () => onRangeChange(addDays(from, -rangeDays), addDays(to, -rangeDays));
  const nextFrom = addDays(from, rangeDays);
  const nextTo = addDays(to, rangeDays);
  const nextRange = () => { if (nextTo <= today) onRangeChange(nextFrom, nextTo); };

  return (
    <div className="date-toolbar">
      <div className="range-presets" aria-label="快速选择时间范围">
        {presets.map(([key, label, title]) => {
          const range = presetRanges[key]!;
          const active = from === range.from && to === range.to;
          return <button key={key} type="button" className={active ? 'active' : ''} aria-pressed={active} title={title} onClick={() => setPreset(key)}>{label}</button>;
        })}
      </div>

      {presetMode === 'analysis' && <div className="analysis-range-navigation" aria-label="切换统计周期">
        <button type="button" aria-label="上一周期" title="上一周期" onClick={previousRange}><ChevronLeft size={15} /></button>
        <strong>{from.replaceAll('-', '/')} — {to.replaceAll('-', '/')}</strong>
        <button type="button" aria-label="下一周期" title="下一周期" disabled={nextTo > today} onClick={nextRange}><ChevronRight size={15} /></button>
      </div>}

      <label className="date-input">
        <CalendarRange size={17} />
        <input aria-label="开始日期" type="date" value={from} max={presetMode === 'analysis' ? (to > today ? today : to) : to} onChange={(event) => onRangeChange(event.target.value, to)} />
        <span>至</span>
        <input aria-label="结束日期" type="date" value={to} min={from} max={presetMode === 'analysis' ? today : undefined} onChange={(event) => onRangeChange(from, event.target.value)} />
      </label>

      {projectControl === 'segments' ? (
        <div className="toolbar-project-segments" aria-label="选择运动种类">
          {projects.map((item) => <button key={item} type="button" className={`${item === project ? 'active' : ''} ${item === '皮划艇' ? 'canoe' : item === '激流' ? 'slalom' : 'rowing'}`} aria-pressed={item === project} onClick={() => onProjectChange(item)}>
            <ProjectMark project={item} />
            <span>{item}</span>
          </button>)}
        </div>
      ) : (
        <div className={`project-select project-select-${projectKey(project)} ${projectOpen ? 'open' : ''}`} ref={projectRef}>
          <button type="button" className="project-select-trigger" onClick={() => setProjectOpen((value) => !value)} aria-expanded={projectOpen} aria-haspopup="listbox" aria-label="选择项目大类">
            <ProjectMark project={project} />
            <span>{project}</span>
            <ChevronDown size={14} className="project-select-chevron" />
          </button>
          <div className="project-select-menu" role="listbox" aria-label="项目大类">
            {projects.map((item) => (
              <button
                key={item}
                type="button"
                role="option"
                aria-selected={item === project}
                className={`project-select-option ${item === project ? 'selected' : ''} project-select-option-${projectKey(item)}`}
                onClick={() => { onProjectChange(item); setProjectOpen(false); }}
              >
                <ProjectMark project={item} />
                <span>{item}</span>
                {item === project && <Check size={14} />}
              </button>
            ))}
          </div>
        </div>
      )}

    </div>
  );
}
