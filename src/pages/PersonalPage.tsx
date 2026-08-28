import { CalendarRange, CheckCircle2, Gauge, Route, Save } from 'lucide-react';
import { useEffect, useMemo, useState, type CSSProperties, type FormEvent } from 'react';
import { analyzeRowingPeriod } from '../../shared/rowing-model';
import { analyzeCanoePeriod } from '../../shared/canoe-model';
import { analyzeSlalomPeriod } from '../../shared/slalom-model';
import { DateToolbar } from '../components/DateToolbar';
import { InjuryRecoveryModule } from '../components/InjuryRecoveryModule';
import { StrengthProfileModule } from '../components/StrengthProfileModule';
import { api } from '../api';
import type { Athlete, Project, TrainingRecord, User } from '../types';
import { addDays, formatNumber, startOfWeek } from '../utils';

type Props = {
  user: User;
  records: TrainingRecord[];
  athletes: Athlete[];
  from: string;
  to: string;
  athleteId: number | null;
  loading: boolean;
  onRangeChange: (from: string, to: string) => void;
  onAthleteChange: (athleteId: number | null) => void;
  project: Project;
  projects: Project[];
  onProjectChange: (project: Project) => void;
  onChanged: () => void;
};

export function PersonalPage(props: Props) {
  const selectedAthlete = useMemo(
    () => props.athletes.find((athlete) => athlete.id === (props.athleteId || props.user.athleteId)) || null,
    [props.athletes, props.athleteId, props.user.athleteId]
  );
  const selectedRecords = useMemo(
    () => selectedAthlete ? props.records.filter((record) => record.athleteId === selectedAthlete.id) : [],
    [props.records, selectedAthlete]
  );
  const [positionDraft, setPositionDraft] = useState('');
  const [positionSaving, setPositionSaving] = useState(false);
  const [positionMessage, setPositionMessage] = useState('');
  const canEditOwnPosition = props.user.role === 'ATL' && selectedAthlete?.id === props.user.athleteId;

  useEffect(() => {
    setPositionDraft(selectedAthlete?.athletePosition || '');
    setPositionMessage('');
  }, [selectedAthlete?.id, selectedAthlete?.athletePosition]);

  const savePosition = async (event: FormEvent) => {
    event.preventDefault();
    if (!selectedAthlete || !canEditOwnPosition) return;
    setPositionSaving(true);
    setPositionMessage('');
    try {
      await api.updateAthletePosition(selectedAthlete.id, positionDraft);
      props.onChanged();
      setPositionMessage('位置/号位已保存。');
    } catch (error) {
      setPositionMessage(error instanceof Error ? error.message : '位置/号位保存失败。');
    } finally {
      setPositionSaving(false);
    }
  };
  const analyzePeriod = analyzerForProject(selectedAthlete?.project || props.project);
  const rangeAnalysis = useMemo(() => analyzePeriod(selectedRecords), [selectedRecords, analyzePeriod]);
  const rangeMode = useMemo(() => {
    if (props.from === props.to) return { label: '当日' } as const;
    if (props.from === addDays(props.to, -29)) return { label: '近一月' } as const;
    if (props.from === addDays(props.to, -364)) return { label: '近一年' } as const;
    if (props.from === startOfWeek(props.to) || props.to === addDays(props.from, 6)) return { label: '本周' } as const;
    if (props.from.endsWith('-01') && props.from.slice(0, 7) === props.to.slice(0, 7)) return { label: '本月' } as const;
    return { label: '所选周期' } as const;
  }, [props.from, props.to]);

  return (
    <div className="page-content personal-page">
      <header className="page-heading">
        <div>
          <h1>个人档案</h1>
          <p>查看运动员基础信息、训练表现、伤病恢复与体能测试档案</p>
        </div>
        <DateToolbar {...props} />
      </header>

      {!selectedAthlete ? (
        <section className="personal-empty">
          <CalendarRange size={34} />
          <strong>先选择一名运动员</strong>
          <p>在右上角选择运动员后，可查看完整个人档案。</p>
        </section>
      ) : (
        <>
          <section className="personal-identity-card">
            <div className={`personal-avatar ${selectedAthlete.photoUrl ? 'has-photo' : ''}`}>
              {selectedAthlete.photoUrl
                ? <img src={selectedAthlete.photoUrl} alt={`${selectedAthlete.name}证件照`} />
                : selectedAthlete.name.slice(0, 1)}
            </div>
            <div className="personal-identity-copy">
              <span>{selectedAthlete.project} · {selectedAthlete.team}</span>
              <h2>{selectedAthlete.name}</h2>
              <p>{selectedAthlete.province}{selectedAthlete.city}{selectedAthlete.county} · 位置/号位 {selectedAthlete.athletePosition || '未填写'} · 教练 {selectedAthlete.coaches || '未绑定'}</p>
              {canEditOwnPosition && <form className="personal-position-editor" onSubmit={savePosition}>
                <label><span>位置/号位</span><input value={positionDraft} onChange={(event) => setPositionDraft(event.target.value)} maxLength={40} placeholder="例如：舵手、1号位、左桨" /></label>
                <button disabled={positionSaving || positionDraft === (selectedAthlete.athletePosition || '')}><Save size={14} />{positionSaving ? '保存中' : '保存'}</button>
                {positionMessage && <small>{positionMessage}</small>}
              </form>}
            </div>
            <div className="personal-grade" style={{ '--grade-color': rangeAnalysis.status.color } as CSSProperties}>
              <span>{rangeMode.label}分级</span>
              <strong>{rangeAnalysis.status.label}</strong>
              <small>{rangeAnalysis.status.basis}</small>
            </div>
          </section>

          <section className="personal-metric-grid">
            <PersonalMetric icon={Gauge} label={`${rangeMode.label}负荷`} value={formatNumber(rangeAnalysis.totalSrpe)} unit="SRPE" />
            <PersonalMetric icon={Route} label="专项距离" value={formatNumber(rangeAnalysis.totalDistanceKm, 1)} unit="km" />
            <PersonalMetric icon={CalendarRange} label="训练课次" value={String(rangeAnalysis.sessions)} unit="课" />
            <PersonalMetric icon={CheckCircle2} label="数据完整率" value={formatNumber(rangeAnalysis.dataCoverage, 1)} unit="%" />
          </section>

          <InjuryRecoveryModule athlete={selectedAthlete} user={props.user} />
          <StrengthProfileModule athlete={selectedAthlete} user={props.user} />
        </>
      )}
    </div>
  );
}

function PersonalMetric({ icon: Icon, label, value, unit }: { icon: typeof Gauge; label: string; value: string; unit: string }) {
  return <article><Icon size={19} /><span>{label}</span><strong>{value}<small>{unit}</small></strong></article>;
}

function analyzerForProject(project: string) {
  return project === '激流' ? analyzeSlalomPeriod : project === '皮划艇' ? analyzeCanoePeriod : analyzeRowingPeriod;
}
