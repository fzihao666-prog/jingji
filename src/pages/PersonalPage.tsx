import { BrainCircuit, CalendarRange, CheckCircle2, Gauge, Route, Save, Trophy } from 'lucide-react';
import { useEffect, useMemo, useState, type CSSProperties, type FormEvent } from 'react';
import { analyzeRowingPeriod } from '../../shared/rowing-model';
import { analyzeCanoePeriod } from '../../shared/canoe-model';
import { analyzeSlalomPeriod } from '../../shared/slalom-model';
import { DateToolbar } from '../components/DateToolbar';
import { InjuryRecoveryModule } from '../components/InjuryRecoveryModule';
import { StrengthProfileModule } from '../components/StrengthProfileModule';
import { BodyCompositionModelOverview, type BodyCompositionProfile } from '../components/AthleteProfileCharts';
import { ChampionModelBenchmark } from '../components/ChampionModelBenchmark';
import { FmsPersonalChart } from '../components/TrainingAnalysisCharts';
import { api } from '../api';
import type { Athlete, BodyCompositionRecord, ChampionBenchmarkPayload, OverviewMeasurement, Project, TrainingRecord, User } from '../types';
import { addDays, formatNumber } from '../utils';

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

function ageAtDate(birthDate: string | null, date: string) {
  if (!birthDate) return null;
  const birth = new Date(`${birthDate}T12:00:00`);
  const target = new Date(`${date}T12:00:00`);
  if (!Number.isFinite(birth.getTime()) || !Number.isFinite(target.getTime())) return null;
  let age = target.getFullYear() - birth.getFullYear();
  if (target.getMonth() < birth.getMonth() || (target.getMonth() === birth.getMonth() && target.getDate() < birth.getDate())) age -= 1;
  return age >= 0 ? age : null;
}

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
  const [bodyHistory, setBodyHistory] = useState<BodyCompositionRecord[]>([]);
  const [bodyHistoryLoading, setBodyHistoryLoading] = useState(false);
  const [profileMeasurements, setProfileMeasurements] = useState<OverviewMeasurement[]>([]);
  const [profileAnalysisLoading, setProfileAnalysisLoading] = useState(false);
  const [championBenchmark, setChampionBenchmark] = useState<ChampionBenchmarkPayload | null>(null);
  const [championLoading, setChampionLoading] = useState(false);

  useEffect(() => {
    let ignored = false;
    if (!selectedAthlete) {
      setBodyHistory([]);
      return;
    }
    setBodyHistoryLoading(true);
    api.getBodyCompositionHistory(selectedAthlete.id)
      .then((result) => { if (!ignored) setBodyHistory(result.history); })
      .catch(() => { if (!ignored) setBodyHistory([]); })
      .finally(() => { if (!ignored) setBodyHistoryLoading(false); });
    return () => { ignored = true; };
  }, [selectedAthlete?.id]);

  useEffect(() => {
    let ignored = false;
    if (!selectedAthlete) {
      setProfileMeasurements([]);
      setChampionBenchmark(null);
      return;
    }
    setProfileAnalysisLoading(true);
    api.personalOverview(selectedAthlete.id, props.from, props.to, selectedAthlete.project as Project)
      .then((result) => { if (!ignored) setProfileMeasurements(result.overview.measurements); })
      .catch(() => { if (!ignored) setProfileMeasurements([]); })
      .finally(() => { if (!ignored) setProfileAnalysisLoading(false); });
    setChampionLoading(true);
    api.championBenchmark(selectedAthlete.id)
      .then((result) => { if (!ignored) setChampionBenchmark(result.benchmark); })
      .catch(() => { if (!ignored) setChampionBenchmark(null); })
      .finally(() => { if (!ignored) setChampionLoading(false); });
    return () => { ignored = true; };
  }, [selectedAthlete?.id, selectedAthlete?.project, props.from, props.to]);

  const bodyCompositionProfile = useMemo<BodyCompositionProfile | null>(() => {
    if (!selectedAthlete) return null;
    const latest = bodyHistory[0];
    return {
      athleteId: selectedAthlete.id,
      athleteName: selectedAthlete.name,
      project: selectedAthlete.project,
      team: selectedAthlete.team,
      gender: selectedAthlete.gender,
      age: ageAtDate(selectedAthlete.birthDate, props.to),
      bodyMeasurementDate: latest?.measurementDate || selectedAthlete.bodyMeasurementDate,
      heightCm: latest?.heightCm ?? selectedAthlete.heightCm,
      weightKg: latest?.weightKg ?? selectedAthlete.weightKg,
      bodyFatPct: latest?.bodyFatPct ?? selectedAthlete.bodyFatPct,
      skeletalMuscleKg: latest?.skeletalMuscleKg ?? selectedAthlete.skeletalMuscleKg,
      upperLimbMuscleKg: latest?.upperLimbMuscleKg ?? selectedAthlete.upperLimbMuscleKg,
      lowerLimbMuscleKg: latest?.lowerLimbMuscleKg ?? selectedAthlete.lowerLimbMuscleKg,
      trunkMuscleKg: latest?.trunkMuscleKg ?? selectedAthlete.trunkMuscleKg,
      tricepsSkinfoldMm: latest?.tricepsSkinfoldMm ?? selectedAthlete.tricepsSkinfoldMm,
      abdominalSkinfoldMm: latest?.abdominalSkinfoldMm ?? selectedAthlete.abdominalSkinfoldMm,
      thighSkinfoldMm: latest?.thighSkinfoldMm ?? selectedAthlete.thighSkinfoldMm,
      calfSkinfoldMm: latest?.calfSkinfoldMm ?? selectedAthlete.calfSkinfoldMm,
      visceralFatLevel: latest?.visceralFatLevel ?? selectedAthlete.visceralFatLevel,
      basalMetabolismKcal: latest?.basalMetabolismKcal ?? selectedAthlete.basalMetabolismKcal,
      totalBodyWaterKg: latest?.totalBodyWaterKg ?? selectedAthlete.totalBodyWaterKg,
      ecwTbwRatio: latest?.ecwTbwRatio ?? selectedAthlete.ecwTbwRatio,
      phaseAngleDeg: latest?.phaseAngleDeg ?? selectedAthlete.phaseAngleDeg,
      visceralFatAreaCm2: latest?.visceralFatAreaCm2 ?? selectedAthlete.visceralFatAreaCm2,
      leftArmLeanKg: latest?.leftArmLeanKg ?? selectedAthlete.leftArmLeanKg,
      rightArmLeanKg: latest?.rightArmLeanKg ?? selectedAthlete.rightArmLeanKg,
      trunkLeanKg: latest?.trunkLeanKg ?? selectedAthlete.trunkLeanKg,
      leftLegLeanKg: latest?.leftLegLeanKg ?? selectedAthlete.leftLegLeanKg,
      rightLegLeanKg: latest?.rightLegLeanKg ?? selectedAthlete.rightLegLeanKg,
      bodyCompositionHistory: bodyHistory
    };
  }, [selectedAthlete, bodyHistory, props.to]);

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
    if (props.from === props.to) return { label: '日' } as const;
    if (props.from === addDays(props.to, -6)) return { label: '周' } as const;
    if (props.from === addDays(props.to, -29)) return { label: '月' } as const;
    return { label: '所选周期' } as const;
  }, [props.from, props.to]);

  return (
    <div className="page-content personal-page">
      <header className="page-heading">
        <div>
          <h1>个人档案</h1>
          <p>查看运动员基础信息、训练表现、伤病恢复与体能测试档案</p>
        </div>
        <DateToolbar {...props} presetMode="period" projectControl="segments" />
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

          <section className="panel professional-panel body-composition-card personal-body-assessment-card">
            <header className="personal-body-assessment-heading">
              <div><span>PHYSIQUE ASSESSMENT</span><h2>运动员身体成分评估</h2><p>节段去脂、肌脂平衡、水合状态与复测趋势</p></div>
              <small>{bodyHistoryLoading ? '正在读取身体成分历史…' : `已读取 ${bodyHistory.length} 次实测记录`}</small>
            </header>
            <BodyCompositionModelOverview profiles={bodyCompositionProfile ? [bodyCompositionProfile] : []} records={selectedRecords} individual />
            <p className="analysis-method-note">身体成分用于训练适应、营养干预和控重阶段观察；模拟项仅用于展示，录入实测值后自动替换。</p>
          </section>

          <section className="panel professional-panel analysis-feature-panel personal-fms-card">
            <header className="personal-analysis-card-heading">
              <div><BrainCircuit size={17} /><span><small>FMS SCREENING</small><h2>个人FMS测试分析</h2><p>六项动作筛查、目标差距与纠正训练优先级</p></span></div>
              <strong>{profileAnalysisLoading ? '读取中' : `${profileMeasurements.filter((item) => item.domain === 'movement' && item.value !== null).length} 项有效`}</strong>
            </header>
            {profileAnalysisLoading ? <div className="professional-chart-empty">正在读取个人FMS测试…</div> : <FmsPersonalChart measurements={profileMeasurements} />}
            <p className="analysis-method-note">FMS用于发现动作控制、活动度和稳定性短板；评分低于目标的项目优先安排纠正性训练和复测。</p>
          </section>

          <section className="panel professional-panel analysis-feature-panel personal-champion-card">
            <header className="personal-analysis-card-heading">
              <div><Trophy size={17} /><span><small>CHAMPION BENCHMARK</small><h2>冠军模型对标分析图</h2><p>冠军区间达标、标准化差距与补强优先级</p></span></div>
              <strong>{championBenchmark?.summary.averageStandardDistance === null || championBenchmark?.summary.averageStandardDistance === undefined ? '—' : `${formatNumber(championBenchmark.summary.averageStandardDistance, 2)}差距`}</strong>
            </header>
            <ChampionModelBenchmark benchmark={championBenchmark} loading={championLoading} />
            <p className="analysis-method-note">标准化差距以冠军参考区间宽度为单位，0代表进入冠军区间；补强优先级由差距和项目权重共同决定，缺失项不按0分处理。</p>
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
