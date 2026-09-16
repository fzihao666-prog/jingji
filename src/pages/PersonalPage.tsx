import { BrainCircuit, CalendarRange, CheckCircle2, Gauge, Route, Save, Search, Trophy } from 'lucide-react';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { analyzeRowingPeriod } from '../../shared/rowing-model';
import { analyzeCanoePeriod } from '../../shared/canoe-model';
import { analyzeSlalomPeriod } from '../../shared/slalom-model';
import { InjuryRecoveryModule } from '../components/InjuryRecoveryModule';
import { AppCard, ContentState, PageContainer, PageHeader } from '../components/PageLayout';
import { StrengthProfileModule } from '../components/StrengthProfileModule';
import { BodyCompositionModelOverview, type BodyCompositionProfile } from '../components/AthleteProfileCharts';
import { ChampionModelBenchmark } from '../components/ChampionModelBenchmark';
import { FmsPersonalChart } from '../components/TrainingAnalysisCharts';
import { api } from '../api';
import type { Athlete, BodyCompositionRecord, ChampionBenchmarkPayload, OverviewMeasurement, ProfileComparisonPayload, Project, SpecialTestEvent, TrainingRecord, User, WellnessTrend } from '../types';
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

type ProfileDetail = { label: string; value: string | number | null | undefined };

function profileValue(value: ProfileDetail['value']) {
  return value === null || value === undefined || String(value).trim() === '' ? '未填写' : String(value);
}

function rowingSeatValue(value: string | null | undefined) {
  const seat = value?.trim() || '';
  return /^(?:[1-8]|[一二三四五六七八])号位$|^舵手$/.test(seat) ? seat : '';
}

function ageAtDate(birthDate: string | null, date: string) {
  if (!birthDate) return null;
  const birth = new Date(`${birthDate}T12:00:00`);
  const target = new Date(`${date}T12:00:00`);
  if (!Number.isFinite(birth.getTime()) || !Number.isFinite(target.getTime())) return null;
  let age = target.getFullYear() - birth.getFullYear();
  if (target.getMonth() < birth.getMonth() || (target.getMonth() === birth.getMonth() && target.getDate() < birth.getDate())) age -= 1;
  return age >= 0 ? age : null;
}

function trainingExperience(startDate: string, date: string) {
  const start = new Date(`${startDate}T12:00:00`);
  const target = new Date(`${date}T12:00:00`);
  if (!startDate || !Number.isFinite(start.getTime()) || !Number.isFinite(target.getTime()) || start > target) return null;
  let months = (target.getFullYear() - start.getFullYear()) * 12 + target.getMonth() - start.getMonth();
  if (target.getDate() < start.getDate()) months -= 1;
  const years = Math.floor(Math.max(months, 0) / 12);
  const remainingMonths = Math.max(months, 0) % 12;
  return remainingMonths ? `${years}年${remainingMonths}个月` : `${years}年`;
}

export function PersonalPage(props: Props) {
  const [selectedTeam, setSelectedTeam] = useState<string | null>(null);
  const [athleteQuery, setAthleteQuery] = useState('');
  const canSwitchAthlete = props.user.role !== 'ATL';
  const teams = useMemo(
    () => [...new Set(props.athletes.map((athlete) => athlete.team).filter(Boolean))].sort((left, right) => left.localeCompare(right, 'zh-CN')),
    [props.athletes]
  );
  const visibleAthletes = useMemo(
    () => selectedTeam ? props.athletes.filter((athlete) => athlete.team === selectedTeam) : props.athletes,
    [props.athletes, selectedTeam]
  );
  const filteredAthletes = useMemo(() => {
    const query = athleteQuery.trim().toLocaleLowerCase();
    return query ? visibleAthletes.filter((athlete) => athlete.name.toLocaleLowerCase().includes(query)) : visibleAthletes;
  }, [athleteQuery, visibleAthletes]);
  const selectedAthlete = useMemo(
    () => props.athletes.find((athlete) => athlete.id === (canSwitchAthlete ? props.athleteId : props.user.athleteId)) || null,
    [canSwitchAthlete, props.athletes, props.athleteId, props.user.athleteId]
  );

  useEffect(() => {
    setSelectedTeam(null);
    setAthleteQuery('');
  }, [props.project]);

  useEffect(() => {
    if (canSwitchAthlete && !props.athleteId && props.athletes.length) props.onAthleteChange(props.athletes[0].id);
  }, [canSwitchAthlete, props.athleteId, props.athletes]);

  const switchAthlete = (athleteId: number) => {
    props.onAthleteChange(athleteId);
  };
  const submitAthleteSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const query = athleteQuery.trim().toLocaleLowerCase();
    const athlete = filteredAthletes.find((item) => item.name.toLocaleLowerCase() === query) || filteredAthletes[0];
    if (athlete) switchAthlete(athlete.id);
  };
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
  const [wellnessTrends, setWellnessTrends] = useState<WellnessTrend[]>([]);
  const [profileComparison, setProfileComparison] = useState<ProfileComparisonPayload | null>(null);
  const [specialTests, setSpecialTests] = useState<SpecialTestEvent[]>([]);
  const [dossierDataLoading, setDossierDataLoading] = useState(false);

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

  useEffect(() => {
    let ignored = false;
    if (!selectedAthlete) {
      setWellnessTrends([]);
      setProfileComparison(null);
      setSpecialTests([]);
      return;
    }
    setDossierDataLoading(true);
    Promise.all([
      api.wellnessTrends(selectedAthlete.id, props.from, props.to, selectedAthlete.project as Project),
      api.profileComparison(selectedAthlete.id, props.from, props.to, selectedAthlete.project as Project),
      api.specialTests(props.from, props.to, selectedAthlete.project as Project, selectedAthlete.id)
    ]).then(([wellness, comparison, tests]) => {
      if (ignored) return;
      setWellnessTrends(wellness.trends);
      setProfileComparison(comparison.comparison);
      setSpecialTests(tests.events);
    }).catch(() => {
      if (!ignored) { setWellnessTrends([]); setProfileComparison(null); setSpecialTests([]); }
    }).finally(() => { if (!ignored) setDossierDataLoading(false); });
    return () => { ignored = true; };
  }, [selectedAthlete?.id, selectedAthlete?.project, props.from, props.to]);

  const bodyCompositionProfile = useMemo<BodyCompositionProfile | null>(() => {
    if (!selectedAthlete) return null;
    const historyBeforeEnd = bodyHistory.filter((record) => record.measurementDate <= props.to);
    const latest = historyBeforeEnd[0];
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
      muscleMassKg: latest?.muscleMassKg ?? selectedAthlete.muscleMassKg,
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
      bodyCompositionHistory: historyBeforeEnd.filter((record) => record.measurementDate >= props.from)
    };
  }, [selectedAthlete, bodyHistory, props.from, props.to]);

  useEffect(() => {
    setPositionDraft(rowingSeatValue(selectedAthlete?.athletePosition));
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
  const athleteLocation = selectedAthlete
    ? [selectedAthlete.province, selectedAthlete.city, selectedAthlete.county].filter(Boolean).join('')
    : '';
  const athleteAffiliationLocation = selectedAthlete
    ? [...new Set([selectedAthlete.region, selectedAthlete.province, selectedAthlete.city, selectedAthlete.county].filter(Boolean))].join(' · ')
    : '';
  const dossierGroups = selectedAthlete ? [
    {
      title: '个人信息',
      tone: 'personal',
      fields: [
        { label: '运动项目', value: selectedAthlete.project },
        { label: '所属队伍', value: selectedAthlete.team },
        { label: '主管教练', value: selectedAthlete.coaches },
        { label: '训练年限', value: trainingExperience(selectedAthlete.startSportDate, props.to) },
        { label: '技术等级', value: selectedAthlete.technicalLevel },
        { label: '最佳成绩', value: selectedAthlete.bestResult },
        { label: '位置/号位', value: rowingSeatValue(selectedAthlete.athletePosition) },
        { label: '运动员状态', value: selectedAthlete.athleteStatus },
        { label: '健康状态', value: selectedAthlete.healthStatus },
        { label: '身高 / 体重', value: selectedAthlete.heightCm === null && selectedAthlete.weightKg === null ? null : `${selectedAthlete.heightCm ?? '—'} cm / ${selectedAthlete.weightKg ?? '—'} kg` },
        { label: '年龄 / 性别', value: ageAtDate(selectedAthlete.birthDate, props.to) === null ? selectedAthlete.gender : `${ageAtDate(selectedAthlete.birthDate, props.to)} 岁 / ${selectedAthlete.gender || '未填写'}` },
        { label: '血型', value: selectedAthlete.bloodType },
        { label: '籍贯', value: selectedAthlete.nativePlace },
        { label: '所属区域', value: athleteAffiliationLocation },
        { label: '专项特长', value: selectedAthlete.specialties }
      ] satisfies ProfileDetail[]
    }
  ] : [];
  const fmsMeasurementCount = profileMeasurements.filter((item) => item.domain === 'fms' && item.value !== null).length;

  return (
    <PageContainer className="personal-page">
      <PageHeader eyebrow="ATHLETE PROFILE" title="运动员档案"/>

      {canSwitchAthlete && (
        <section className="performance-athlete-picker">
          <div className="performance-picker-copy">
            <span>ATHLETE PROFILE</span>
            <strong>选择运动员</strong>
            {selectedAthlete && <small>{selectedAthlete.project} · {selectedAthlete.team} · {selectedAthlete.name}</small>}
          </div>
          <form className="performance-athlete-search" onSubmit={submitAthleteSearch}>
            <Search size={16} />
            <input
              value={athleteQuery}
              onChange={(event) => setAthleteQuery(event.target.value)}
              placeholder="搜索姓名，回车查看"
              aria-label="搜索运动员"
            />
          </form>
          <select
            className="performance-athlete-select"
            value={selectedTeam || ''}
            onChange={(event) => setSelectedTeam(event.target.value || null)}
            aria-label="筛选队伍"
          >
            <option value="">全部队伍</option>
            {teams.map((team) => <option key={team} value={team}>{team}</option>)}
          </select>
          <select
            className="performance-athlete-select"
            value={selectedAthlete?.id || ''}
            onChange={(event) => { if (event.target.value) switchAthlete(Number(event.target.value)); }}
            aria-label="选择运动员"
          >
            <option value="">选择运动员</option>
            {filteredAthletes.map((athlete) => <option key={athlete.id} value={athlete.id}>{athlete.name} · {athlete.team}</option>)}
          </select>
          {!filteredAthletes.length && <p className="performance-athlete-no-result">没有匹配的运动员</p>}
        </section>
      )}

      {!selectedAthlete ? (
        <ContentState kind="empty" className="personal-empty" icon={<CalendarRange size={34} />} title="请选择运动员" description={canSwitchAthlete ? '请从队伍中选择需要查看的运动员。' : '当前账号暂无可展示的运动员档案。'}/>
      ) : (
        <>
          <section className="personal-dossier">
            <header className="personal-dossier-identity">
              <div className={`personal-avatar ${selectedAthlete.photoUrl ? 'has-photo' : ''}`}>
                {selectedAthlete.photoUrl
                  ? <img src={selectedAthlete.photoUrl} alt={`${selectedAthlete.name}证件照`} />
                  : selectedAthlete.name.slice(0, 1)}
              </div>
              <div className="personal-identity-copy">
                <span>{selectedAthlete.project} · {selectedAthlete.team}</span>
                <h2>{selectedAthlete.name}</h2>
                <p>{athleteLocation || '地区待补充'} · {selectedAthlete.coaches || '未绑定教练'}</p>
                {canEditOwnPosition && <form className="personal-position-editor" onSubmit={savePosition}>
                  <label><span>位置/号位</span><input value={positionDraft} onChange={(event) => setPositionDraft(event.target.value)} maxLength={40} placeholder="例如：1号位、2号位、舵手" aria-invalid={positionMessage.includes('失败')} aria-describedby={positionMessage ? 'position-message' : undefined} /></label>
                  <button disabled={positionSaving || positionDraft === rowingSeatValue(selectedAthlete.athletePosition)}><Save size={14} />{positionSaving ? '保存中' : '保存'}</button>
                  <small id="position-message" aria-live="polite" role={positionMessage.includes('失败') ? 'alert' : undefined}>{positionMessage}</small>
                </form>}
              </div>
            </header>
            <section className="personal-dossier-groups" aria-label="运动员完整档案信息">
              {dossierGroups.map((group) => <section key={group.title} className={`personal-dossier-group ${group.tone}`} aria-label={group.title}>
                <dl>
                  {group.fields.map((field) => <div key={field.label}><dt>{field.label}</dt><dd>{field.label === '位置/号位' && !field.value ? '—' : profileValue(field.value)}</dd></div>)}
                </dl>
              </section>)}
            </section>
          </section>

          <ProfileSection title="制胜要素分析" subtitle="身体形态、功能动作、专项与体能测试均遵循当前项目和日期范围。">
            <AppCard variant="chart" className="professional-panel body-composition-card personal-body-assessment-card">
              <header className="personal-body-assessment-heading">
                <div><span>BODY COMPOSITION</span><h2>身体成分</h2></div>
                <small>{bodyHistoryLoading ? '读取中…' : bodyCompositionProfile?.bodyMeasurementDate || '暂无实测'}</small>
              </header>
              <BodyCompositionModelOverview profiles={bodyCompositionProfile ? [bodyCompositionProfile] : []} individual />
            </AppCard>
          </ProfileSection>

          <ProfileSection title="训练情况" subtitle={`${props.from} 至 ${props.to}，仅统计当前运动员的有效训练课次。`}>
          <section className="personal-training-overview" aria-labelledby="training-overview-title">
            <header>
              <div><span>PERIOD OVERVIEW</span><h2 id="training-overview-title">当前周期训练摘要</h2></div>
              <small>{props.from} 至 {props.to}</small>
            </header>
            <div className="personal-period-layout">
              <div className="personal-period-copy"><strong>体能训练与专项训练</strong><p>训练负荷、专项距离与课次随当前日期周期变化。</p></div>
              <section className="personal-metric-grid" aria-label="当前周期关键指标">
                <PersonalMetric icon={Gauge} label={`${rangeMode.label}负荷`} value={formatNumber(rangeAnalysis.totalSrpe)} unit="SRPE" />
                <PersonalMetric icon={Route} label="专项距离" value={formatNumber(rangeAnalysis.totalDistanceKm, 1)} unit="km" />
                <PersonalMetric icon={CalendarRange} label="训练课次" value={String(rangeAnalysis.sessions)} unit="课" />
                <PersonalMetric icon={CheckCircle2} label="数据完整率" value={formatNumber(rangeAnalysis.dataCoverage, 1)} unit="%" />
              </section>
            </div>
          </section>
          </ProfileSection>

          <ProfileSection title="功能与专项测试" subtitle="功能动作筛查、专项测试、体能测试档案与有氧指标。">
            <AppCard variant="chart" className="professional-panel analysis-feature-panel personal-fms-card">
              <header className="personal-analysis-card-heading">
                <div><BrainCircuit size={17} /><span><small>FMS SCREENING</small><h2>个人FMS测试分析</h2><p>标准七项、21分制与纠正训练优先级</p></span></div>
                <strong>{profileAnalysisLoading ? '读取中' : `${fmsMeasurementCount} 项有效`}</strong>
              </header>
              {profileAnalysisLoading ? <div className="professional-chart-empty">正在读取个人FMS测试…</div> : <FmsPersonalChart measurements={profileMeasurements} />}
              <p className="analysis-method-note">FMS采用七项标准测试，每项0-3分，总分21分；单项低于2分或总分低于14分时优先安排纠正性训练和复测。</p>
            </AppCard>
            <SpecialTestSummary events={specialTests} loading={dossierDataLoading} />

            <AppCard variant="chart" className="professional-panel analysis-feature-panel personal-champion-card">
            <header className="personal-analysis-card-heading">
              <div><Trophy size={17} /><span><small>CHAMPION RADAR</small><h2>冠军模型八维雷达分析</h2><p>当前水平、冠军标准、维度差距与补强优先级</p></span></div>
              <strong>八维雷达</strong>
            </header>
            <ChampionModelBenchmark benchmark={championBenchmark} loading={championLoading} />
            <p className="analysis-method-note">八维雷达聚合身体形态、耐力、VO2Max、不对称性、爆发力、无氧功、最大力量和核心力量；缺失项不按0分处理。</p>
            </AppCard>
            <AerobicEndurance measurements={profileMeasurements} loading={profileAnalysisLoading} />
            <StrengthProfileModule athlete={selectedAthlete} user={props.user} />
          </ProfileSection>

          <ProfileSection title="生理生化与恢复状态" subtitle="恢复趋势包含真实日报；生理生化尚未接入正式数据模型。">
            <AppCard variant="chart" className="professional-panel"><ContentState kind="empty" title="生理生化数据暂未接入" description="等待正式数据模型接入后展示，不使用模拟结果。" /></AppCard>
            <WellnessTrendCards trends={wellnessTrends} loading={dossierDataLoading} />
            <InjuryRecoveryModule athlete={selectedAthlete} user={props.user} asOfDate={props.to} />
          </ProfileSection>
          <ProfileSection title="个人 vs 团队对比" subtitle="同项目、同队伍、同周期且至少两名可比运动员；缺失数据不补零。">
            <ComparisonSummary comparison={profileComparison} loading={dossierDataLoading} />
          </ProfileSection>
        </>
      )}
    </PageContainer>
  );
}

function ProfileSection({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return <section className="personal-profile-section" aria-label={title}>
    <header className="personal-profile-section-heading"><div><span>ATHLETE DOSSIER</span><h2>{title}</h2><p>{subtitle}</p></div></header>
    {children}
  </section>;
}

function WellnessTrendCards({ trends, loading }: { trends: WellnessTrend[]; loading: boolean }) {
  if (loading) return <AppCard variant="chart" className="professional-panel"><div className="professional-chart-empty">正在读取恢复趋势…</div></AppCard>;
  if (!trends.some((trend) => trend.points.length)) return <AppCard variant="chart" className="professional-panel"><ContentState kind="empty" title="暂无恢复趋势数据" description="当前周期未找到有效的日报或训练 RPE 记录。" /></AppCard>;
  return <section className="personal-wellness-grid" aria-label="恢复趋势">
    {trends.map((trend) => <AppCard key={trend.key} variant="chart" className="professional-panel personal-wellness-card">
      <header><h3>{trend.label}</h3><small>{trend.unit || '主观评分'}</small></header>
      {trend.points.length ? <>
        <div className="personal-trend-points">{trend.points.slice(-7).map((point) => <div key={point.date}><span>{point.date.slice(5)}</span><strong>{point.personalValue ?? '—'}</strong><small>{point.teamMean === null ? '暂无团队均值' : `团队 ${point.teamMean} · n=${point.teamSampleCount}`}</small></div>)}</div>
        <details><summary>查看趋势数据表</summary><table><caption>{trend.label}个人值与团队日均</caption><thead><tr><th>日期</th><th>个人</th><th>团队均值</th><th>样本数</th></tr></thead><tbody>{trend.points.map((point) => <tr key={point.date}><td>{point.date}</td><td>{point.personalValue ?? '—'}</td><td>{point.teamMean ?? '—'}</td><td>{point.teamSampleCount ?? '—'}</td></tr>)}</tbody></table></details>
      </> : <p>暂无数据</p>}
    </AppCard>)}
  </section>;
}

function SpecialTestSummary({ events, loading }: { events: SpecialTestEvent[]; loading: boolean }) {
  return <AppCard variant="chart" className="professional-panel personal-special-test-card">
    <header className="personal-analysis-card-heading"><div><span><small>SPECIAL TEST</small><h2>专项测试</h2><p>仅展示当前运动员作为成员参与的艇组结果。</p></span></div></header>
    {loading ? <div className="professional-chart-empty">正在读取专项测试…</div> : events.length ? <div className="personal-special-test-list">{events.slice(0, 3).map((event) => event.results.map((result) => <article key={result.id}><strong>{event.testDate} · {event.boatClass}</strong><span>{result.crewName} · 第 {result.rank} 名</span><b>{(result.bestMs / 1000).toFixed(2)} 秒</b><small>{result.previousBestMs === null ? '暂无个人历史最佳' : `较历史最佳 ${result.deltaPreviousMs === null ? '—' : `${result.deltaPreviousMs > 0 ? '+' : ''}${(result.deltaPreviousMs / 1000).toFixed(2)} 秒`}`}</small>{event.dataQuality === 'unverified' && <small>来源：历史专项测试，质量待确认</small>}</article>))}</div> : <ContentState kind="empty" title="暂无专项测试结果" description="当前周期内没有包含该运动员的有效专项测试。" />}
  </AppCard>;
}

function AerobicEndurance({ measurements, loading }: { measurements: OverviewMeasurement[]; loading: boolean }) {
  const aerobic = measurements.filter((measurement) => /vo2|aerobic|endurance|耐力|heart|心率/i.test(`${measurement.code} ${measurement.label}`) && measurement.value !== null && !measurement.isDemo && measurement.quality === 'valid');
  return <AppCard variant="chart" className="professional-panel">
    <header className="personal-analysis-card-heading"><div><span><small>AEROBIC ENDURANCE</small><h2>有氧耐力</h2><p>仅展示指标字典中已有的有效有氧或心率类测试。</p></span></div></header>
    {loading ? <div className="professional-chart-empty">正在读取有氧指标…</div> : aerobic.length ? <div className="personal-comparison-grid">{aerobic.map((measurement) => <article key={measurement.code}><span>{measurement.label}</span><strong>{measurement.value} {measurement.unit}</strong><small>{measurement.previous === null ? '暂无前次对照' : `较前次 ${measurement.changePct === null ? '—' : `${measurement.changePct > 0 ? '+' : ''}${measurement.changePct}%`}`}</small></article>)}</div> : <ContentState kind="empty" title="暂无有效有氧耐力指标" description="当前数据字典和测试记录中没有可展示的有效指标。" />}
  </AppCard>;
}

function ComparisonSummary({ comparison, loading }: { comparison: ProfileComparisonPayload | null; loading: boolean }) {
  if (loading) return <AppCard variant="chart" className="professional-panel"><div className="professional-chart-empty">正在计算可比团队数据…</div></AppCard>;
  if (!comparison) return <AppCard variant="chart" className="professional-panel"><ContentState kind="empty" title="暂无可比团队数据" description="当前范围内没有足够的同队有效数据。" /></AppCard>;
  return <AppCard variant="chart" className="professional-panel personal-comparison-card">
    <p className="analysis-method-note">范围：{comparison.scope.project} · 当前队伍 · {comparison.scope.from} 至 {comparison.scope.to} · 可访问运动员 {comparison.scope.athleteCount} 人。</p>
    <div className="personal-comparison-grid">{comparison.items.map((item) => <article key={item.key}><span>{item.label}{item.unit ? ` (${item.unit})` : ''}</span><strong>{item.personalValue ?? '—'}</strong><small>{item.teamMean === null ? item.unavailableReason : `团队均值 ${item.teamMean} · 差异 ${item.difference === null ? '—' : item.difference > 0 ? `+${item.difference}` : item.difference} · n=${item.teamSampleCount}`}</small><em>{item.dateLabel || '暂无数据日期'}</em></article>)}</div>
  </AppCard>;
}

function PersonalMetric({ icon: Icon, label, value, unit }: { icon: typeof Gauge; label: string; value: string; unit: string }) {
  return <article><Icon size={19} /><span>{label}</span><strong>{value}<small>{unit}</small></strong></article>;
}

function analyzerForProject(project: string) {
  return project === '激流' ? analyzeSlalomPeriod : project === '皮划艇' ? analyzeCanoePeriod : analyzeRowingPeriod;
}
