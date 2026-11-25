import { useId, useMemo, useState, type ReactNode } from 'react';
import {
  filterAnalysisAthletes,
  type AthleteAnalysisSearchable,
} from '../../shared/athlete-analysis-filter';
import './AthleteAnalysisSelector.css';

type Props = {
  athletes: Array<
    AthleteAnalysisSearchable & {
      gender: string;
      summary?: {
        sessionCount: number;
        durationMin: number | null;
        distanceKm: number | null;
        load: number | null;
      };
    }
  >;
  selectedAthleteId: number | null;
  onSelect: (athleteId: number) => void;
  onClear: () => void;
  renderSummary: (athlete: Props['athletes'][number]) => ReactNode;
};

export function AthleteAnalysisSelector({ athletes, selectedAthleteId, onSelect, onClear, renderSummary }: Props) {
  const [query, setQuery] = useState('');
  const searchId = useId();
  const visibleAthletes = useMemo(() => filterAnalysisAthletes(athletes, query), [athletes, query]);
  return <section className="athlete-analysis-selector" aria-labelledby={searchId + '-heading'}>
    <header><div><h2 id={searchId + '-heading'}>运动员</h2><p>搜索并选择运动员，切换为个人分析。</p></div><button type="button" className="athlete-analysis-selector-clear" aria-pressed={selectedAthleteId === null} onClick={onClear}>全部运动员</button></header>
    <label className="athlete-analysis-selector-search" htmlFor={searchId}>搜索运动员<input id={searchId} type="search" value={query} placeholder="姓名、编号、队伍或小项" onChange={(event) => setQuery(event.target.value)} /></label>
    <div className="athlete-analysis-selector-list">{visibleAthletes.length ? visibleAthletes.map((athlete) => <button key={athlete.id} type="button" className="athlete-analysis-selector-card" aria-pressed={athlete.id === selectedAthleteId} onClick={() => onSelect(athlete.id)}><span className="athlete-analysis-selector-name">{athlete.name}</span><span className="athlete-analysis-selector-meta">{athlete.gender || '性别未录入'} · {athlete.team || '未分队'} · {athlete.specialties || '小项未录入'}</span>{renderSummary(athlete)}</button>) : <p className="athlete-analysis-selector-empty" role="status">当前范围内没有匹配的运动员。</p>}</div>
  </section>;
}
