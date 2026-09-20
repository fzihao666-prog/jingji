import type { EChartsOption } from 'echarts';
import { CalendarRange, Save, Search, Trophy } from 'lucide-react';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { analyzeCanoePeriod } from '../../shared/canoe-model';
import { analyzeRowingPeriod } from '../../shared/rowing-model';
import { analyzeSlalomPeriod } from '../../shared/slalom-model';
import { api } from '../api';
import { BodyCompositionModelOverview } from '../components/AthleteProfileCharts';
import { AthleteRadarComparison } from '../components/AthleteRadarComparison';
import { ChampionModelBenchmark } from '../components/ChampionModelBenchmark';
import { EChart } from '../components/EChart';
import { InjuryRecoveryModule } from '../components/InjuryRecoveryModule';
import { AppCard, ContentState, PageContainer, PageHeader } from '../components/PageLayout';
import { ProfileTrainingStatus } from '../components/ProfileTrainingStatus';
import { StrengthProfileModule } from '../components/StrengthProfileModule';
import { FmsPersonalChart } from '../components/TrainingAnalysisCharts';
import type {
  Athlete,
  AthleteRadarModelsPayload,
  BodyCompositionRecord,
  ChampionBenchmarkPayload,
  OverviewMeasurement,
  Project,
  ProfileTrainingStatusPayload,
  SpecialTestEvent,
  TrainingRecord,
  User,
  WellnessTrend,
} from '../types';
import { formatNumber } from '../utils';

function daysBetweenInclusive(from: string, to: string) {
  const [fy, fm, fd] = from.split('-').map(Number);
  const [ty, tm, td] = to.split('-').map(Number);
  const start = Date.UTC(fy, fm - 1, fd);
  const end = Date.UTC(ty, tm - 1, td);
  return Math.round((end - start) / 86400000) + 1;
}

function getLoadPeriodLabel(from: string, to: string) {
  const days = daysBetweenInclusive(from, to);
  if (days <= 1) return '日负荷';
  if (days <= 7) return '周负荷';
  if (days >= 28 && days <= 31) return '月负荷';
  return '周期负荷';
}

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

type ProfileDetail = {
  label: string;
  value: string | number | null | undefined;
};

function profileValue(value: ProfileDetail['value']) {
  return value === null || value === undefined || String(value).trim() === ''
    ? '未填写'
    : String(value);
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
  if (
    target.getMonth() < birth.getMonth() ||
    (target.getMonth() === birth.getMonth() && target.getDate() < birth.getDate())
  )
    age -= 1;
  return age >= 0 ? age : null;
}

function trainingExperience(startDate: string, date: string) {
  const start = new Date(`${startDate}T12:00:00`);
  const target = new Date(`${date}T12:00:00`);
  if (
    !startDate ||
    !Number.isFinite(start.getTime()) ||
    !Number.isFinite(target.getTime()) ||
    start > target
  )
    return null;
  let months =
    (target.getFullYear() - start.getFullYear()) * 12 + target.getMonth() - start.getMonth();
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
    () =>
      [...new Set(props.athletes.map((athlete) => athlete.team).filter(Boolean))].sort(
        (left, right) => left.localeCompare(right, 'zh-CN')
      ),
    [props.athletes]
  );
  const visibleAthletes = useMemo(
    () =>
      selectedTeam
        ? props.athletes.filter((athlete) => athlete.team === selectedTeam)
        : props.athletes,
    [props.athletes, selectedTeam]
  );
  const filteredAthletes = useMemo(() => {
    const query = athleteQuery.trim().toLocaleLowerCase();
    return query
      ? visibleAthletes.filter((athlete) => athlete.name.toLocaleLowerCase().includes(query))
      : visibleAthletes;
  }, [athleteQuery, visibleAthletes]);
  const selectedAthlete = useMemo(
    () =>
      props.athletes.find(
        (athlete) => athlete.id === (canSwitchAthlete ? props.athleteId : props.user.athleteId)
      ) || null,
    [canSwitchAthlete, props.athletes, props.athleteId, props.user.athleteId]
  );

  useEffect(() => {
    setSelectedTeam(null);
    setAthleteQuery('');
  }, [props.project]);

  useEffect(() => {
    if (canSwitchAthlete && !props.athleteId && props.athletes.length)
      props.onAthleteChange(props.athletes[0].id);
  }, [canSwitchAthlete, props.athleteId, props.athletes]);

  const switchAthlete = (athleteId: number) => {
    props.onAthleteChange(athleteId);
  };
  const submitAthleteSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const query = athleteQuery.trim().toLocaleLowerCase();
    const athlete =
      filteredAthletes.find((item) => item.name.toLocaleLowerCase() === query) ||
      filteredAthletes[0];
    if (athlete) switchAthlete(athlete.id);
  };
  const selectedRecords = useMemo(
    () =>
      selectedAthlete
        ? props.records.filter((record) => record.athleteId === selectedAthlete.id)
        : [],
    [props.records, selectedAthlete]
  );
  const [positionDraft, setPositionDraft] = useState('');
  const [positionSaving, setPositionSaving] = useState(false);
  const [positionMessage, setPositionMessage] = useState('');
  const canEditOwnPosition =
    props.user.role === 'ATL' && selectedAthlete?.id === props.user.athleteId;
  const [profileMeasurements, setProfileMeasurements] = useState<OverviewMeasurement[]>([]);
  const [profileAnalysisLoading, setProfileAnalysisLoading] = useState(false);
  const [championBenchmark, setChampionBenchmark] = useState<ChampionBenchmarkPayload | null>(null);
  const [championLoading, setChampionLoading] = useState(false);
  const [wellnessTrends, setWellnessTrends] = useState<WellnessTrend[]>([]);
  const [specialTests, setSpecialTests] = useState<SpecialTestEvent[]>([]);
  const [bodyCompositionHistory, setBodyCompositionHistory] = useState<BodyCompositionRecord[]>([]);
  const [bodyCompositionLoading, setBodyCompositionLoading] = useState(false);
  const [bodyCompositionError, setBodyCompositionError] = useState(false);
  const [dossierDataLoading, setDossierDataLoading] = useState(false);
  const [radarModels, setRadarModels] = useState<AthleteRadarModelsPayload | null>(null);
  const [radarModelsLoading, setRadarModelsLoading] = useState(false);
  const [trainingStatus, setTrainingStatus] = useState<ProfileTrainingStatusPayload | null>(null);
  const [trainingStatusLoading, setTrainingStatusLoading] = useState(false);

  useEffect(() => {
    let ignored = false;
    if (!selectedAthlete) {
      setProfileMeasurements([]);
      setChampionBenchmark(null);
      return;
    }
    setProfileAnalysisLoading(true);
    api
      .personalOverview(
        selectedAthlete.id,
        props.from,
        props.to,
        selectedAthlete.project as Project
      )
      .then((result) => {
        if (!ignored) setProfileMeasurements(result.overview.measurements);
      })
      .catch(() => {
        if (!ignored) setProfileMeasurements([]);
      })
      .finally(() => {
        if (!ignored) setProfileAnalysisLoading(false);
      });
    setChampionLoading(true);
    api
      .championBenchmark(selectedAthlete.id)
      .then((result) => {
        if (!ignored) setChampionBenchmark(result.benchmark);
      })
      .catch(() => {
        if (!ignored) setChampionBenchmark(null);
      })
      .finally(() => {
        if (!ignored) setChampionLoading(false);
      });
    return () => {
      ignored = true;
    };
  }, [selectedAthlete?.id, selectedAthlete?.project, props.from, props.to]);

  useEffect(() => {
    let ignored = false;
    if (!selectedAthlete) {
      setTrainingStatus(null);
      setTrainingStatusLoading(false);
      return;
    }
    setTrainingStatus(null);
    setTrainingStatusLoading(true);
    api
      .profileComparison(
        selectedAthlete.id,
        props.from,
        props.to,
        selectedAthlete.project as Project
      )
      .then((result) => {
        if (!ignored) setTrainingStatus(result.trainingStatus);
      })
      .catch(() => {
        if (!ignored) setTrainingStatus(null);
      })
      .finally(() => {
        if (!ignored) setTrainingStatusLoading(false);
      });
    return () => {
      ignored = true;
    };
  }, [selectedAthlete?.id, selectedAthlete?.project, props.from, props.to]);

  useEffect(() => {
    let ignored = false;
    if (!selectedAthlete) {
      setBodyCompositionHistory([]);
      setBodyCompositionLoading(false);
      setBodyCompositionError(false);
      return;
    }

    setBodyCompositionHistory([]);
    setBodyCompositionLoading(true);
    setBodyCompositionError(false);
    api
      .getBodyCompositionHistory(selectedAthlete.id)
      .then((result) => {
        if (!ignored) {
          setBodyCompositionHistory(result.history);
          setBodyCompositionError(false);
        }
      })
      .catch(() => {
        if (!ignored) {
          setBodyCompositionHistory([]);
          setBodyCompositionError(true);
        }
      })
      .finally(() => {
        if (!ignored) setBodyCompositionLoading(false);
      });

    return () => {
      ignored = true;
    };
  }, [selectedAthlete?.id]);

  useEffect(() => {
    let ignored = false;
    setRadarModels(null);

    if (!selectedAthlete || selectedAthlete.project !== 'ROWING') {
      setRadarModelsLoading(false);
      return;
    }

    setRadarModelsLoading(true);
    api
      .radarModels(selectedAthlete.id, props.from, props.to)
      .then((result) => {
        if (!ignored) setRadarModels(result);
      })
      .catch(() => {
        if (!ignored) setRadarModels(null);
      })
      .finally(() => {
        if (!ignored) setRadarModelsLoading(false);
      });

    return () => {
      ignored = true;
    };
  }, [selectedAthlete?.id, selectedAthlete?.project, props.from, props.to]);

  useEffect(() => {
    let ignored = false;
    if (!selectedAthlete) {
      setWellnessTrends([]);
      setSpecialTests([]);
      return;
    }
    setDossierDataLoading(true);
    Promise.all([
      api.wellnessTrends(
        selectedAthlete.id,
        props.from,
        props.to,
        selectedAthlete.project as Project
      ),
      api.specialTests(
        props.from,
        props.to,
        selectedAthlete.project as Project,
        selectedAthlete.id
      ),
    ])
      .then(([wellness, tests]) => {
        if (ignored) return;
        setWellnessTrends(wellness.trends);
        setSpecialTests(tests.events);
      })
      .catch(() => {
        if (!ignored) {
          setWellnessTrends([]);
          setSpecialTests([]);
        }
      })
      .finally(() => {
        if (!ignored) setDossierDataLoading(false);
      });
    return () => {
      ignored = true;
    };
  }, [selectedAthlete?.id, selectedAthlete?.project, props.from, props.to]);

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
  const rangeAnalysis = useMemo(
    () => analyzePeriod(selectedRecords),
    [selectedRecords, analyzePeriod]
  );
  const athleteLocation = selectedAthlete
    ? [selectedAthlete.province, selectedAthlete.city, selectedAthlete.county]
        .filter(Boolean)
        .join('')
    : '';
  const athleteAffiliationLocation = selectedAthlete
    ? [
        ...new Set(
          [
            selectedAthlete.region,
            selectedAthlete.province,
            selectedAthlete.city,
            selectedAthlete.county,
          ].filter(Boolean)
        ),
      ].join(' · ')
    : '';
  const dossierGroups = selectedAthlete
    ? [
        {
          title: '个人信息',
          tone: 'personal',
          fields: [
            { label: '运动项目', value: selectedAthlete.project },
            { label: '所属队伍', value: selectedAthlete.team },
            { label: '主管教练', value: selectedAthlete.coaches },
            {
              label: '训练年限',
              value: trainingExperience(selectedAthlete.startSportDate, props.to),
            },
            { label: '技术等级', value: selectedAthlete.technicalLevel },
            { label: '最佳成绩', value: selectedAthlete.bestResult },
            {
              label: '位置/号位',
              value: rowingSeatValue(selectedAthlete.athletePosition),
            },
            { label: '运动员状态', value: selectedAthlete.athleteStatus },
            { label: '健康状态', value: selectedAthlete.healthStatus },
            {
              label: '身高 / 体重',
              value:
                selectedAthlete.heightCm === null && selectedAthlete.weightKg === null
                  ? null
                  : `${selectedAthlete.heightCm ?? '—'} cm / ${selectedAthlete.weightKg ?? '—'} kg`,
            },
            {
              label: '年龄 / 性别',
              value:
                ageAtDate(selectedAthlete.birthDate, props.to) === null
                  ? selectedAthlete.gender
                  : `${ageAtDate(selectedAthlete.birthDate, props.to)} 岁 / ${selectedAthlete.gender || '未填写'}`,
            },
            { label: '血型', value: selectedAthlete.bloodType },
            { label: '籍贯', value: selectedAthlete.nativePlace },
            { label: '所属区域', value: athleteAffiliationLocation },
            { label: '专项特长', value: selectedAthlete.specialties },
          ] satisfies ProfileDetail[],
        },
      ]
    : [];
  const fmsMeasurementCount = profileMeasurements.filter(
    (item) => item.domain === 'fms' && item.value !== null
  ).length;
  const bodyCompositionProfiles = useMemo(() => {
    if (!selectedAthlete || !bodyCompositionHistory.length) return [];

    const measurementTimestamp = (measurementDate: string) => {
      const timestamp = new Date(`${measurementDate}T12:00:00`).getTime();
      return Number.isFinite(timestamp) ? timestamp : Number.NEGATIVE_INFINITY;
    };
    const latestRecord = [...bodyCompositionHistory].sort(
      (left, right) =>
        measurementTimestamp(right.measurementDate) - measurementTimestamp(left.measurementDate)
    )[0];

    return [
      {
        athleteId: selectedAthlete.id,
        athleteName: selectedAthlete.name,
        project: selectedAthlete.project,
        team: selectedAthlete.team,
        gender: selectedAthlete.gender,
        age: ageAtDate(selectedAthlete.birthDate, latestRecord.measurementDate),
        bodyMeasurementDate: latestRecord.measurementDate,
        heightCm: latestRecord.heightCm,
        weightKg: latestRecord.weightKg,
        bodyFatPct: latestRecord.bodyFatPct,
        skeletalMuscleKg: latestRecord.skeletalMuscleKg,
        muscleMassKg: latestRecord.muscleMassKg,
        upperLimbMuscleKg: latestRecord.upperLimbMuscleKg,
        lowerLimbMuscleKg: latestRecord.lowerLimbMuscleKg,
        trunkMuscleKg: latestRecord.trunkMuscleKg,
        tricepsSkinfoldMm: latestRecord.tricepsSkinfoldMm,
        abdominalSkinfoldMm: latestRecord.abdominalSkinfoldMm,
        thighSkinfoldMm: latestRecord.thighSkinfoldMm,
        calfSkinfoldMm: latestRecord.calfSkinfoldMm,
        visceralFatLevel: latestRecord.visceralFatLevel,
        basalMetabolismKcal: latestRecord.basalMetabolismKcal,
        totalBodyWaterKg: latestRecord.totalBodyWaterKg,
        ecwTbwRatio: latestRecord.ecwTbwRatio,
        phaseAngleDeg: latestRecord.phaseAngleDeg,
        visceralFatAreaCm2: latestRecord.visceralFatAreaCm2,
        leftArmLeanKg: latestRecord.leftArmLeanKg,
        rightArmLeanKg: latestRecord.rightArmLeanKg,
        trunkLeanKg: latestRecord.trunkLeanKg,
        leftLegLeanKg: latestRecord.leftLegLeanKg,
        rightLegLeanKg: latestRecord.rightLegLeanKg,
        bodyCompositionHistory,
      },
    ];
  }, [bodyCompositionHistory, selectedAthlete]);
  const bodyCompositionStatus = !selectedAthlete
    ? '未选择运动员。'
    : bodyCompositionLoading
      ? '正在读取身体成分。'
      : bodyCompositionError
        ? '身体成分读取失败，当前显示空状态。'
        : bodyCompositionHistory.length
          ? '身体成分已更新。'
          : '暂无身体成分记录。';

  return (
    <PageContainer className="personal-page">
      <PageHeader eyebrow="ATHLETE PROFILE" title="运动员档案" />

      {canSwitchAthlete && (
        <section className="performance-athlete-picker">
          <div className="performance-picker-copy">
            <span>ATHLETE PROFILE</span>
            <strong>选择运动员</strong>
            {selectedAthlete && (
              <small>
                {selectedAthlete.project} · {selectedAthlete.team} · {selectedAthlete.name}
              </small>
            )}
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
            {teams.map((team) => (
              <option key={team} value={team}>
                {team}
              </option>
            ))}
          </select>
          <select
            className="performance-athlete-select"
            value={selectedAthlete?.id || ''}
            onChange={(event) => {
              if (event.target.value) switchAthlete(Number(event.target.value));
            }}
            aria-label="选择运动员"
          >
            <option value="">选择运动员</option>
            {filteredAthletes.map((athlete) => (
              <option key={athlete.id} value={athlete.id}>
                {athlete.name} · {athlete.team}
              </option>
            ))}
          </select>
          {!filteredAthletes.length && (
            <p className="performance-athlete-no-result">没有匹配的运动员</p>
          )}
        </section>
      )}

      {!selectedAthlete ? (
        <ContentState
          kind="empty"
          className="personal-empty"
          icon={<CalendarRange size={34} />}
          title="请选择运动员"
          description={
            canSwitchAthlete
              ? '请从队伍中选择需要查看的运动员。'
              : '当前账号暂无可展示的运动员档案。'
          }
        />
      ) : (
        <>
          <section className="personal-dossier">
            <header className="personal-dossier-identity">
              <div className={`personal-avatar ${selectedAthlete.photoUrl ? 'has-photo' : ''}`}>
                {selectedAthlete.photoUrl ? (
                  <img src={selectedAthlete.photoUrl} alt={`${selectedAthlete.name}证件照`} />
                ) : (
                  selectedAthlete.name.slice(0, 1)
                )}
              </div>
              <div className="personal-identity-copy">
                <span>
                  {selectedAthlete.project} · {selectedAthlete.team}
                </span>
                <h2>{selectedAthlete.name}</h2>
                <p>
                  {athleteLocation || '地区待补充'} · {selectedAthlete.coaches || '未绑定教练'}
                </p>
                {canEditOwnPosition && (
                  <form className="personal-position-editor" onSubmit={savePosition}>
                    <label>
                      <span>位置/号位</span>
                      <input
                        value={positionDraft}
                        onChange={(event) => setPositionDraft(event.target.value)}
                        maxLength={40}
                        placeholder="例如：1号位、2号位、舵手"
                        aria-invalid={positionMessage.includes('失败')}
                        aria-describedby={positionMessage ? 'position-message' : undefined}
                      />
                    </label>
                    <button
                      disabled={
                        positionSaving ||
                        positionDraft === rowingSeatValue(selectedAthlete.athletePosition)
                      }
                    >
                      <Save size={14} />
                      {positionSaving ? '保存中' : '保存'}
                    </button>
                    <small
                      id="position-message"
                      aria-live="polite"
                      role={positionMessage.includes('失败') ? 'alert' : undefined}
                    >
                      {positionMessage}
                    </small>
                  </form>
                )}
              </div>
              <section className="personal-header-metrics" aria-label="当前周期训练指标">
                <article>
                  <span>{getLoadPeriodLabel(props.from, props.to)}</span>
                  <strong>
                    {formatNumber(rangeAnalysis.totalSrpe)}
                    <small>SRPE</small>
                  </strong>
                </article>
                <article>
                  <span>专项距离</span>
                  <strong>
                    {formatNumber(rangeAnalysis.totalDistanceKm, 1)}
                    <small>km</small>
                  </strong>
                </article>
                <article>
                  <span>训练课次</span>
                  <strong>
                    {rangeAnalysis.sessions}
                    <small>课</small>
                  </strong>
                </article>
              </section>
            </header>
            <section className="personal-dossier-groups" aria-label="运动员完整档案信息">
              {dossierGroups.map((group) => (
                <section
                  key={group.title}
                  className={`personal-dossier-group ${group.tone}`}
                  aria-label={group.title}
                >
                  <dl>
                    {group.fields.map((field) => (
                      <div key={field.label}>
                        <dt>{field.label}</dt>
                        <dd>
                          {field.label === '位置/号位' && !field.value
                            ? '—'
                            : profileValue(field.value)}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </section>
              ))}
            </section>
          </section>

          <section className="personal-profile-section" aria-label="测试模块">
            <div className="functional-test-grid">
              <AppCard variant="chart" className="professional-panel body-composition-profile-card">
                <header className="personal-analysis-card-heading">
                  <div>
                    <span>
                      <small>BODY COMPOSITION</small>
                      <h3>身体成分</h3>
                      <p>身体组成、肌肉量与节段分布</p>
                    </span>
                  </div>
                </header>
                <section aria-busy={bodyCompositionLoading} aria-label="身体成分">
                  <p className="visually-hidden" aria-live="polite">
                    {bodyCompositionStatus}
                  </p>
                  {bodyCompositionLoading ? (
                    <div className="professional-chart-empty">正在读取身体成分…</div>
                  ) : bodyCompositionError ? (
                    <ContentState
                      kind="empty"
                      title="身体成分暂不可用"
                      description="读取身体成分记录失败，请稍后重试。"
                    />
                  ) : (
                    <BodyCompositionModelOverview profiles={bodyCompositionProfiles} individual />
                  )}
                </section>
              </AppCard>
              <AppCard
                variant="chart"
                className="professional-panel analysis-feature-panel personal-fms-card"
              >
                <header className="personal-analysis-card-heading">
                  <div>
                    <span>
                      <small>FMS SCREENING</small>
                      <h3>（FMS）功能动作筛查</h3>
                      <p>标准七项、21分制与纠正训练优先级</p>
                    </span>
                  </div>
                  <strong>
                    {profileAnalysisLoading ? '读取中' : `${fmsMeasurementCount} 项有效`}
                  </strong>
                </header>
                {profileAnalysisLoading ? (
                  <div className="professional-chart-empty">正在读取个人FMS测试…</div>
                ) : (
                  <FmsPersonalChart measurements={profileMeasurements} />
                )}
                <p className="analysis-method-note">
                  FMS采用七项标准测试，每项0-3分，总分21分；单项低于2分或总分低于14分时优先安排纠正性训练和复测。
                </p>
              </AppCard>
              <AppCard
                variant="chart"
                className="professional-panel analysis-feature-panel athlete-radar-card"
              >
                <header className="personal-analysis-card-heading">
                  <div>
                    <span>
                      <small>SPECIAL TEST RADAR</small>
                      <h3>专项测试雷达</h3>
                      <p>当前周期测试与正式参考标准的可达成度对照</p>
                    </span>
                  </div>
                </header>
                <AthleteRadarComparison
                  title="专项测试雷达"
                  model={radarModels?.special ?? null}
                  loading={radarModelsLoading}
                  unavailableReason={
                    selectedAthlete.project === 'ROWING' ? undefined : '该项目雷达维度待配置'
                  }
                />
              </AppCard>
              <AppCard
                variant="chart"
                className="professional-panel analysis-feature-panel athlete-radar-card"
              >
                <header className="personal-analysis-card-heading">
                  <div>
                    <span>
                      <small>PHYSICAL TEST RADAR</small>
                      <h3>体能测试雷达</h3>
                      <p>力量、爆发力与核心能力的正式参考标准对照</p>
                    </span>
                  </div>
                </header>
                <AthleteRadarComparison
                  title="体能测试雷达"
                  model={radarModels?.physical ?? null}
                  loading={radarModelsLoading}
                  unavailableReason={
                    selectedAthlete.project === 'ROWING' ? undefined : '该项目雷达维度待配置'
                  }
                />
              </AppCard>
            </div>
            <AppCard
              variant="chart"
              className="professional-panel analysis-feature-panel personal-champion-card"
            >
              <header className="personal-analysis-card-heading">
                <div>
                  <Trophy size={17} />
                  <span>
                    <small>CHAMPION RADAR</small>
                    <h2>冠军模型八维雷达分析</h2>
                    <p>当前水平、冠军标准、维度差距与补强优先级</p>
                  </span>
                </div>
                <strong>八维雷达</strong>
              </header>
              <ChampionModelBenchmark benchmark={championBenchmark} loading={championLoading} />
              <p className="analysis-method-note">
                八维雷达聚合身体形态、耐力、VO2Max、不对称性、爆发力、无氧功、最大力量和核心力量；缺失项不按0分处理。
              </p>
            </AppCard>
            <ProfileSection
              title="训练情况"
              subtitle="与同项目、同队且在当前授权范围内的团队平均对照；所有数据跟随页面总周期。"
            >
              <ProfileTrainingStatus
                trainingStatus={trainingStatus}
                loading={trainingStatusLoading}
              />
            </ProfileSection>
            <AerobicEndurance measurements={profileMeasurements} loading={profileAnalysisLoading} />
          </section>

          <ProfileSection
            title="生理生化与恢复状态"
            subtitle="恢复趋势包含真实日报；生理生化尚未接入正式数据模型。"
          >
            <AppCard variant="chart" className="professional-panel">
              <ContentState
                kind="empty"
                title="生理生化数据暂未接入"
                description="等待正式数据模型接入后展示，不使用模拟结果。"
              />
            </AppCard>
            <WellnessTrendCards trends={wellnessTrends} loading={dossierDataLoading} />
            <InjuryRecoveryModule athlete={selectedAthlete} user={props.user} asOfDate={props.to} />
            <StrengthProfileModule athlete={selectedAthlete} user={props.user} />
          </ProfileSection>
        </>
      )}
    </PageContainer>
  );
}

function ProfileSection({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <section className="personal-profile-section" aria-label={title}>
      <header className="personal-profile-section-heading">
        <div>
          <span>ATHLETE DOSSIER</span>
          <h2>{title}</h2>
          <p>{subtitle}</p>
        </div>
      </header>
      {children}
    </section>
  );
}

function WellnessTrendCards({ trends, loading }: { trends: WellnessTrend[]; loading: boolean }) {
  const hasData = trends.some((trend) =>
    trend.points.some((point) => point.personalValue !== null)
  );
  const statusMessage = loading
    ? '正在读取恢复趋势。'
    : hasData
      ? '恢复趋势已更新。'
      : '暂无恢复趋势数据。';
  return (
    <div className="personal-wellness-status">
      <p className="visually-hidden" aria-live="polite">
        {statusMessage}
      </p>
      {loading ? (
        <AppCard variant="chart" className="professional-panel">
          <div className="professional-chart-empty">正在读取恢复趋势…</div>
        </AppCard>
      ) : !hasData ? (
        <AppCard variant="chart" className="professional-panel">
          <ContentState
            kind="empty"
            title="暂无恢复趋势数据"
            description="当前周期未找到有效的日报或训练 RPE 记录。"
          />
        </AppCard>
      ) : (
        <section className="personal-wellness-grid" aria-label="恢复趋势">
          {trends.map((trend) => (
            <AppCard
              key={trend.key}
              variant="chart"
              className="professional-panel personal-wellness-card"
            >
              <header>
                <h3>{trend.label}</h3>
                <small>{trend.unit || '主观评分'}</small>
              </header>
              {trend.points.some((point) => point.personalValue !== null) ? (
                <EChart
                  option={wellnessTrendOption(trend)}
                  label={`${trend.label}个人变化趋势，共 ${trend.points.filter((point) => point.personalValue !== null).length} 个有效记录；缺失日期不连线、不以零补齐。`}
                />
              ) : (
                <p>暂无数据</p>
              )}
            </AppCard>
          ))}
        </section>
      )}
    </div>
  );
}

function wellnessTrendOption(trend: WellnessTrend): EChartsOption {
  const dates = trend.points.map((point) => Date.parse(`${point.date}T00:00:00Z`));
  return {
    animation: false,
    useUTC: true,
    tooltip: {
      trigger: 'axis',
      renderMode: 'richText',
      confine: true,
      valueFormatter: (value) =>
        `${formatNumber(Number(value), 1)}${trend.unit ? ` ${trend.unit}` : ''}`,
    },
    grid: {
      top: 24,
      right: 20,
      bottom: 34,
      left: 46,
      outerBoundsMode: 'same',
      outerBoundsContain: 'axisLabel',
    },
    xAxis: {
      type: 'time',
      min: dates[0],
      max: dates.at(-1),
      axisLabel: { formatter: '{MM}/{dd}', hideOverlap: true },
    },
    yAxis: {
      type: 'value',
      name: trend.unit,
      scale: true,
      splitLine: { lineStyle: { color: '#e0e9e9' } },
    },
    series: [
      {
        id: trend.key,
        name: trend.label,
        type: 'line',
        connectNulls: false,
        symbol: 'circle',
        symbolSize: 7,
        lineStyle: { width: 2 },
        data: trend.points.map((point) => [
          Date.parse(`${point.date}T00:00:00Z`),
          point.personalValue,
        ]),
      },
    ],
  };
}

function AerobicEndurance({
  measurements,
  loading,
}: {
  measurements: OverviewMeasurement[];
  loading: boolean;
}) {
  const aerobic = measurements.filter(
    (measurement) =>
      /vo2|aerobic|endurance|耐力|heart|心率/i.test(`${measurement.code} ${measurement.label}`) &&
      measurement.value !== null &&
      !measurement.isDemo &&
      measurement.quality === 'valid'
  );
  return (
    <AppCard variant="chart" className="professional-panel">
      <header className="personal-analysis-card-heading">
        <div>
          <span>
            <small>AEROBIC ENDURANCE</small>
            <h2>有氧耐力</h2>
            <p>仅展示指标字典中已有的有效有氧或心率类测试。</p>
          </span>
        </div>
      </header>
      {loading ? (
        <div className="professional-chart-empty">正在读取有氧指标…</div>
      ) : aerobic.length ? (
        <div className="personal-comparison-grid">
          {aerobic.map((measurement) => (
            <article key={measurement.code}>
              <span>{measurement.label}</span>
              <strong>
                {measurement.value} {measurement.unit}
              </strong>
              <small>
                {measurement.previous === null
                  ? '暂无前次对照'
                  : `较前次 ${measurement.changePct === null ? '—' : `${measurement.changePct > 0 ? '+' : ''}${measurement.changePct}%`}`}
              </small>
            </article>
          ))}
        </div>
      ) : (
        <ContentState
          kind="empty"
          title="暂无有效有氧耐力指标"
          description="当前数据字典和测试记录中没有可展示的有效指标。"
        />
      )}
    </AppCard>
  );
}

function analyzerForProject(project: string) {
  return project === '激流'
    ? analyzeSlalomPeriod
    : project === '皮划艇'
      ? analyzeCanoePeriod
      : analyzeRowingPeriod;
}
