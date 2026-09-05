import {
  Bar, BarChart, CartesianGrid, Cell, LabelList, Line, LineChart, PolarAngleAxis, PolarGrid, PolarRadiusAxis,
  Radar, RadarChart, ReferenceLine, ResponsiveContainer, Scatter, ScatterChart, Tooltip,
  XAxis, YAxis
} from 'recharts';
import { geoMercator, geoPath } from 'd3-geo';
import ChinaData from 'china-map-geojson/lib/china.js';
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import type { BodyCompositionRecord, CompetitiveStateLevel, OverviewAthleteProfile, TrainingRecord } from '../types';
import { formatNumber, percentage } from '../utils';

function average(values: Array<number | null | undefined>) {
  const valid = values.filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  return valid.length ? valid.reduce((sum, value) => sum + value, 0) / valid.length : null;
}

function range(values: Array<number | null | undefined>, unit: string) {
  const valid = values.filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  if (!valid.length) return '暂无';
  return `${formatNumber(Math.min(...valid), 1)}—${formatNumber(Math.max(...valid), 1)} ${unit}`;
}

type TeamScatterPoint = { athleteId: number; name: string; age: number | null; height: number; weight: number };

function chartDomain(values: number[], minimumPadding: number): [number, number] {
  const low = Math.min(...values);
  const high = Math.max(...values);
  const padding = Math.max(minimumPadding, (high - low) * .12);
  return [Math.floor((low - padding) * 10) / 10, Math.ceil((high + padding) * 10) / 10];
}

type AgeBin = { group: string; male: number; female: number; start: number; end: number };
type CompositionBand = '偏低' | '目标范围' | '偏高' | '未测试';

function compositionBand(value: number | null, lower: number, upper: number): CompositionBand {
  if (value === null || !Number.isFinite(value)) return '未测试';
  if (value < lower) return '偏低';
  if (value > upper) return '偏高';
  return '目标范围';
}

function sportYears(startDate: string | null, asOf: string) {
  if (!startDate) return null;
  const start = new Date(`${startDate}T00:00:00`).getTime();
  const end = new Date(`${asOf}T00:00:00`).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
  return (end - start) / 31_557_600_000;
}

function bodyCompositionStatus(profile: OverviewAthleteProfile) {
  const heightM = profile.heightCm === null ? null : profile.heightCm / 100;
  const bmi = heightM && profile.weightKg !== null ? profile.weightKg / (heightM ** 2) : null;
  const fatMass = profile.weightKg !== null && profile.bodyFatPct !== null ? profile.weightKg * profile.bodyFatPct / 100 : null;
  const fatFreeMass = profile.weightKg !== null && fatMass !== null ? profile.weightKg - fatMass : null;
  const skeletalMuscleIndex = heightM && profile.skeletalMuscleKg !== null ? profile.skeletalMuscleKg / (heightM ** 2) : null;
  const fatFreeMassIndex = heightM && fatFreeMass !== null ? fatFreeMass / (heightM ** 2) : null;
  const female = profile.gender === '女';
  return {
    体重: compositionBand(bmi, female ? 18 : 19, female ? 24.5 : 25),
    BMI: compositionBand(bmi, female ? 18 : 19, female ? 24.5 : 25),
    体脂率: compositionBand(profile.bodyFatPct, female ? 14 : 6, female ? 24 : 18),
    脂肪量: compositionBand(fatMass, female ? 8 : 5, female ? 18 : 15),
    骨骼肌量: compositionBand(skeletalMuscleIndex, female ? 6.2 : 8.2, female ? 8.8 : 10.8),
    去脂体重: compositionBand(fatFreeMassIndex, female ? 14 : 16, female ? 19.5 : 22)
  };
}

function TeamProfileTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload?: TeamScatterPoint }> }) {
  const point = payload?.[0]?.payload;
  if (!active || !point) return null;
  return <div className="team-profile-tooltip"><strong>{point.name}</strong><span>年龄：{point.age === null ? '—' : `${formatNumber(point.age, 1)}岁`}</span><span>身高：{formatNumber(point.height, 1)} cm</span><span>体重：{formatNumber(point.weight, 1)} kg</span></div>;
}

function AgePyramidTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload?: AgeBin }> }) {
  const point = payload?.[0]?.payload;
  if (!active || !point) return null;
  const male = Math.abs(point.male);
  return (
    <div className="team-profile-tooltip">
      <strong>{point.group}</strong>
      <span>男：{male} 人</span>
      <span>女：{point.female} 人</span>
      <span>合计：{male + point.female} 人</span>
    </div>
  );
}

export function AthleteProfileOverview({ profiles, individual, asOf }: { profiles: OverviewAthleteProfile[]; individual: boolean; asOf: string }) {
  if (!profiles.length || !profiles.some((profile) => profile.age !== null || profile.heightCm !== null || profile.weightKg !== null)) {
    return <ProfileEmpty title={individual ? '暂无档案画像数据' : '暂无队伍身体数据'} detail="完善出生日期和身体测量后自动生成。" />;
  }
  const age = average(profiles.map((profile) => profile.age));
  const height = average(profiles.map((profile) => profile.heightCm));
  const weight = average(profiles.map((profile) => profile.weightKg));
  const current = profiles[0];
  const weightChange = current.weightKg !== null && current.previousWeightKg !== null
    ? current.weightKg - current.previousWeightKg
    : null;

  if (individual) return (
    <div className="profile-overview-visual" aria-label="个人年龄和身体形态">
      <div className="profile-stat-grid">
        <ProfileStat label="年龄" value={age === null ? '—' : formatNumber(age, 1)} unit="岁" note={current.birthDate || '出生日期未录入'} />
        <ProfileStat label="身高" value={height === null ? '—' : formatNumber(height, 1)} unit="cm" note={current.bodyMeasurementDate || '未测量'} />
        <ProfileStat label="体重" value={weight === null ? '—' : formatNumber(weight, 1)} unit="kg" note={weightChange === null ? '暂无前次对比' : `较前次 ${weightChange >= 0 ? '+' : ''}${formatNumber(weightChange, 1)} kg`} />
      </div>
    </div>
  );

  const scatterData: TeamScatterPoint[] = profiles.flatMap((profile) => profile.heightCm !== null && profile.weightKg !== null ? [{ athleteId: profile.athleteId, name: profile.athleteName, age: profile.age, height: profile.heightCm, weight: profile.weightKg }] : []);
  const ageProfiles = profiles.filter((profile): profile is OverviewAthleteProfile & { age: number } => profile.age !== null && Number.isFinite(profile.age));
  const ages = ageProfiles.map((profile) => profile.age);
  const averageAge = average(ages);
  const minAge = ages.length ? Math.min(...ages) : null;
  const maxAge = ages.length ? Math.max(...ages) : null;

  const ageBins: AgeBin[] = useMemo(() => {
    if (!ageProfiles.length || minAge === null || maxAge === null) return [];
    const binSize = maxAge - minAge > 16 ? 2 : 1;
    const start = Math.floor(minAge / binSize) * binSize;
    const end = Math.ceil((maxAge + 1) / binSize) * binSize;
    const bins: AgeBin[] = [];
    for (let s = start; s < end; s += binSize) {
      const e = s + binSize;
      const label = binSize === 1 ? `${s}岁` : `${s}-${e - 1}岁`;
      let male = 0;
      let female = 0;
      for (const profile of ageProfiles) {
        if (profile.age < s || profile.age >= e) continue;
        if (profile.gender === '男') male += 1;
        else if (profile.gender === '女') female += 1;
      }
      bins.push({ group: label, male: -male, female, start: s, end: e });
    }
    return bins.sort((left, right) => right.start - left.start);
  }, [ageProfiles, minAge, maxAge]);
  const maxSideCount = useMemo(() => ageBins.reduce((max, bin) => Math.max(max, Math.abs(bin.male), bin.female), 0), [ageBins]);

  const heights = scatterData.map((item) => item.height);
  const weights = scatterData.map((item) => item.weight);
  const minHeight = heights.length ? Math.min(...heights) : null;
  const maxHeight = heights.length ? Math.max(...heights) : null;
  const minWeight = weights.length ? Math.min(...weights) : null;
  const maxWeight = weights.length ? Math.max(...weights) : null;
  const compositionRows = ['体重', 'BMI', '体脂率', '脂肪量', '骨骼肌量', '去脂体重'].map((label) => {
    const counts: Record<CompositionBand, number> = { 偏低: 0, 目标范围: 0, 偏高: 0, 未测试: 0 };
    for (const profile of profiles) {
      const band = bodyCompositionStatus(profile)[label as keyof ReturnType<typeof bodyCompositionStatus>];
      counts[band] += 1;
    }
    const sample = profiles.length;
    return { label, ...counts, sample };
  });
  const experienceBands = [
    { label: '≤2年', phase: '新秀期', matches: (years: number) => years <= 2 },
    { label: '3～5年', phase: '成长期', matches: (years: number) => years > 2 && years < 6 },
    { label: '6～8年', phase: '成熟期', matches: (years: number) => years >= 6 && years < 9 },
    { label: '≥9年', phase: '资深期', matches: (years: number) => years >= 9 }
  ].map((band) => ({ ...band, athletes: profiles.filter((profile) => {
    const years = sportYears(profile.startSportDate, asOf);
    return years !== null && band.matches(years);
  }).length }));
  const experienced = profiles.map((profile) => sportYears(profile.startSportDate, asOf)).filter((value): value is number => value !== null);
  const experienceTotal = experienceBands.reduce((sum, item) => sum + item.athletes, 0);

  return (
    <div className="profile-overview-visual team-profile-visual" aria-label="队伍年龄、身体形态与竞技水平分布">
      <div className="team-profile-chart-grid three-columns">
        <section className="team-profile-chart-card team-scatter-card">
          <header><div><h3>身高—体重分布</h3><p>运动员身体形态相对位置</p></div><span>{scatterData.length} 名有效运动员</span></header>
          <div className="team-profile-chart-canvas">
            {scatterData.length ? <ResponsiveContainer width="100%" height="100%"><ScatterChart margin={{ top: 18, right: 26, bottom: 27, left: 14 }}>
              <CartesianGrid stroke="#e1eaeb" strokeDasharray="3 5" />
              <XAxis type="number" dataKey="height" name="身高" domain={chartDomain(scatterData.map((item) => item.height), 2)} tick={{ fontSize: 9, fill: '#74888f' }} axisLine={false} tickLine={false} label={{ value: '身高 cm', position: 'insideBottomRight', offset: -8, fill: '#74888f', fontSize: 9 }} />
              <YAxis type="number" dataKey="weight" name="体重" domain={chartDomain(scatterData.map((item) => item.weight), 3)} tick={{ fontSize: 9, fill: '#74888f' }} axisLine={false} tickLine={false} width={48} label={{ value: '体重 kg', angle: -90, position: 'insideLeft', offset: 8, fill: '#74888f', fontSize: 9 }} />
              {height !== null && <ReferenceLine x={height} stroke="#2b7d8d" strokeDasharray="5 5" label={{ value: '平均身高', position: 'insideTopRight', fill: '#56808a', fontSize: 8 }} />}
              {weight !== null && <ReferenceLine y={weight} stroke="#2b7d8d" strokeDasharray="5 5" label={{ value: '平均体重', position: 'insideTopLeft', fill: '#56808a', fontSize: 8 }} />}
              <Tooltip content={<TeamProfileTooltip />} cursor={{ stroke: '#a9c5c8', strokeDasharray: '3 4' }} />
              <Scatter data={scatterData} fill="#12978f" stroke="#fff" strokeWidth={2} />
            </ScatterChart></ResponsiveContainer> : <div className="team-profile-chart-empty">暂无身高体重配对数据</div>}
          </div>
          {scatterData.length > 0 && <div className="team-scatter-summary"><span>平均身高 <strong>{formatNumber(height ?? 0, 1)} cm</strong></span><i>｜</i><span>最小身高 <strong>{formatNumber(minHeight ?? 0, 1)} cm</strong></span><i>｜</i><span>最大身高 <strong>{formatNumber(maxHeight ?? 0, 1)} cm</strong></span><i>｜</i><span>平均体重 <strong>{formatNumber(weight ?? 0, 1)} kg</strong></span><i>｜</i><span>最小体重 <strong>{formatNumber(minWeight ?? 0, 1)} kg</strong></span><i>｜</i><span>最大体重 <strong>{formatNumber(maxWeight ?? 0, 1)} kg</strong></span></div>}
        </section>

        <section className="team-profile-chart-card team-age-card">
          <header><div><h3>年龄结构</h3><p>展示队伍运动员年龄性别金字塔结构</p></div><span>共 {ageProfiles.length} 人</span></header>
          <div className="team-age-plot-heading"><strong>年龄金字塔</strong><span>按性别分组的人数分布</span></div>
          <div className="team-profile-age-canvas">
            {ageBins.length ? <ResponsiveContainer width="100%" height="100%"><BarChart data={ageBins} layout="vertical" margin={{ top: 4, right: 14, bottom: 2, left: 4 }} barCategoryGap="16%">
              <CartesianGrid stroke="#e3ebed" strokeDasharray="3 5" horizontal={false} />
              <XAxis type="number" domain={[-maxSideCount, maxSideCount]} tickFormatter={(value) => `${Math.abs(Number(value))}`} tick={{ fontSize: 8, fill: '#74888f' }} axisLine={{ stroke: '#cad9dc' }} tickLine={false} />
              <YAxis type="category" dataKey="group" tick={{ fontSize: 8, fill: '#506c74', fontWeight: 700 }} axisLine={false} tickLine={false} width={48} />
              <Tooltip content={<AgePyramidTooltip />} cursor={{ fill: 'rgba(17,139,131,.055)' }} />
              <Bar dataKey="male" name="男" fill="#2f7fa3" radius={[3, 0, 0, 3]} minPointSize={2}>
                <LabelList dataKey="male" position="left" fill="#4c6870" fontSize={8} fontWeight={800} formatter={(value) => `${Math.abs(Number(value))}人`} />
              </Bar>
              <Bar dataKey="female" name="女" fill="#d96e8b" radius={[0, 3, 3, 0]} minPointSize={2}>
                <LabelList dataKey="female" position="right" fill="#4c6870" fontSize={8} fontWeight={800} formatter={(value) => `${value}人`} />
              </Bar>
            </BarChart></ResponsiveContainer> : <div className="team-profile-chart-empty">暂无年龄数据</div>}
          </div>
          {ageBins.length > 0 && <><div className="team-age-legend"><span><i />男</span><span><i />女</span></div><div className="team-age-summary"><span>平均年龄 <strong>{formatNumber(averageAge ?? 0, 1)} 岁</strong></span><i>｜</i><span>最小 <strong>{formatNumber(minAge ?? 0, 1)} 岁</strong></span><i>｜</i><span>最大 <strong>{formatNumber(maxAge ?? 0, 1)} 岁</strong></span><i>｜</i><span>年龄跨度 <strong>{formatNumber((maxAge ?? 0) - (minAge ?? 0), 1)} 岁</strong></span></div></>}
        </section>

        <CompetitiveLevelChart profiles={profiles} />
      </div>
      <div className="team-profile-insight-grid">
        <section className="team-profile-insight-card composition-status-card">
          <header><div><h3>身体成分状态分布</h3><p>按运动训练参考区间统计 · 每行 100%</p></div><span>{profiles.length} 名运动员</span></header>
          <div className="composition-status-list">
            {compositionRows.map((row) => <div className="composition-status-row" key={row.label}>
              <strong>{row.label}</strong><div className="composition-stack" role="img" aria-label={`${row.label}：偏低${row.偏低}人，目标范围${row.目标范围}人，偏高${row.偏高}人，未测试${row.未测试}人`}>
                {(['偏低', '目标范围', '偏高', '未测试'] as CompositionBand[]).map((band) => row.sample ? <span key={band} className={`composition-band ${band}`} style={{ width: `${row[band] / row.sample * 100}%` }} /> : null)}
              </div><small>{row.sample ? `${row.sample} 人` : '暂无数据'}</small>
            </div>)}
          </div>
          <footer className="composition-legend"><span><i className="偏低" />偏低</span><span><i className="目标范围" />目标范围</span><span><i className="偏高" />偏高</span><span><i className="未测试" />未测试</span><em>体重按 BMI 区间判定</em></footer>
        </section>
        <section className="team-profile-insight-card experience-ladder-card">
          <header><div><h3>运动经验结构</h3><p>依据开始运动日期自动计算</p></div><span>{experienceTotal} 名已建档</span></header>
          <div className="experience-ladder">
            <i className="experience-rail" aria-hidden="true" />
            {experienceBands.map((band) => <article key={band.label}>
              <i className="experience-node" aria-hidden="true" /><span>{band.label}</span><strong>{band.phase}</strong><b>{band.athletes}<small>人</small></b><em>{experienceTotal ? `${formatNumber(band.athletes / experienceTotal * 100, 1)}%` : '—'}</em>
            </article>)}
          </div>
          <footer className="experience-summary"><span>平均运动年限 <strong>{experienced.length ? `${formatNumber(average(experienced) || 0, 1)}年` : '—'}</strong></span><i /><span>最长 <strong>{experienced.length ? `${formatNumber(Math.max(...experienced), 1)}年` : '—'}</strong></span><i /><span>最短 <strong>{experienced.length ? `${formatNumber(Math.min(...experienced), 1)}年` : '—'}</strong></span></footer>
        </section>
      </div>
    </div>
  );
}

type BodyPartKey = 'leftArm' | 'rightArm' | 'trunk' | 'abdomen' | 'leftLeg' | 'rightLeg';
export type BodyCompositionProfile = {
  athleteId: number;
  athleteName: string;
  project: string;
  team: string;
  gender: string;
  age: number | null;
  bodyMeasurementDate: string | null;
  heightCm: number | null;
  weightKg: number | null;
  bodyFatPct: number | null;
  skeletalMuscleKg: number | null;
  upperLimbMuscleKg: number | null;
  lowerLimbMuscleKg: number | null;
  trunkMuscleKg: number | null;
  tricepsSkinfoldMm: number | null;
  abdominalSkinfoldMm: number | null;
  thighSkinfoldMm: number | null;
  calfSkinfoldMm: number | null;
  visceralFatLevel: number | null;
  basalMetabolismKcal: number | null;
  totalBodyWaterKg: number | null;
  ecwTbwRatio: number | null;
  phaseAngleDeg: number | null;
  visceralFatAreaCm2: number | null;
  leftArmLeanKg: number | null;
  rightArmLeanKg: number | null;
  trunkLeanKg: number | null;
  leftLegLeanKg: number | null;
  rightLegLeanKg: number | null;
  bodyCompositionHistory: BodyCompositionRecord[];
};
type DataOrigin = '实测' | '推算' | '模拟';
type ReportValue = { value: number; origin: DataOrigin };
type SegmentReport = { key: BodyPartKey; label: string; leanKg: number; standardPct: number; origin: DataOrigin; trainingNote: string };
type ProfessionalBodyReport = {
  height: ReportValue;
  weight: ReportValue;
  bodyFatPct: ReportValue;
  skeletalMuscle: ReportValue;
  fatMass: ReportValue;
  fatFreeMass: ReportValue;
  bmi: ReportValue;
  smi: ReportValue;
  basalMetabolism: ReportValue;
  totalBodyWater: ReportValue;
  protein: ReportValue;
  mineral: ReportValue;
  phaseAngle: ReportValue;
  ecwTbw: ReportValue;
  visceralFat: ReportValue;
  visceralFatArea: ReportValue;
  skinfolds: Array<{ label: string; value: number; origin: DataOrigin }>;
  segments: SegmentReport[];
  simulatedCount: number;
  trainingSummary: string;
};

const bodyPartMeta: Record<BodyPartKey, { label: string; note: string }> = {
  leftArm: { label: '左上肢', note: '关注拉力链、肩胛稳定和双侧输出差异；节段值为去脂量，并不等同于纯肌肉量。' },
  rightArm: { label: '右上肢', note: '结合专项动作惯用侧判断优势，持续扩大差异可能提示技术代偿或局部负荷偏高。' },
  trunk: { label: '躯干', note: '躯干去脂量反映核心区域组织基础，需结合抗旋转、力量传导和躯干耐力测试解读。' },
  abdomen: { label: '腹部脂肪', note: '腹部皮褶与内脏脂肪用于追踪控重和能量储备，单次结果不用于直接判断竞技能力。' },
  leftLeg: { label: '左下肢', note: '下肢节段去脂量与蹬伸、起动和稳定相关；左右差异宜结合测力台和伤病史复核。' },
  rightLeg: { label: '右下肢', note: '建议关注左右侧变化趋势，而不是只追求单侧绝对值；同一测量条件下复测更有意义。' }
};

export function BodyCompositionModelOverview({ profiles, records, individual }: { profiles: BodyCompositionProfile[]; records: TrainingRecord[]; individual: boolean }) {
  const availableProfiles = profiles.filter((profile) => profile.heightCm !== null || profile.weightKg !== null || profile.bodyFatPct !== null || profile.skeletalMuscleKg !== null);
  const [activeAthleteId, setActiveAthleteId] = useState(availableProfiles[0]?.athleteId ?? profiles[0]?.athleteId ?? 0);
  const [activePart, setActivePart] = useState<BodyPartKey>('trunk');
  const athleteKey = profiles.map((profile) => `${profile.athleteId}:${profile.bodyMeasurementDate || ''}`).join('|');

  useEffect(() => {
    const next = availableProfiles[0]?.athleteId ?? profiles[0]?.athleteId ?? 0;
    setActiveAthleteId((current) => profiles.some((profile) => profile.athleteId === current) ? current : next);
  }, [athleteKey]);

  if (!profiles.length) return <ProfileEmpty detail="选择运动员并填写身体成分后，将生成可交互人体模型。" />;

  const activeProfile = profiles.find((profile) => profile.athleteId === activeAthleteId) || availableProfiles[0] || profiles[0];
  const history = [...(activeProfile.bodyCompositionHistory || [])].reverse();
  const weeklyRecords = weeklyTrainingRecords(records.filter((record) => record.athleteId === activeProfile.athleteId), activeProfile.bodyCompositionHistory || []);
  const report = buildProfessionalBodyReport(activeProfile);
  const part = bodyPartMeta[activePart];
  const activeSegment = report.segments.find((item) => item.key === activePart);
  const lowerImbalance = sideDifference(report.segments, 'leftLeg', 'rightLeg');
  const upperImbalance = sideDifference(report.segments, 'leftArm', 'rightArm');

  return (
    <div className="body-composition-model" aria-label="运动员专业身体成分报告">
      <div className="body-composition-toolbar">
        <label><span>评估对象</span><select value={activeProfile.athleteId} onChange={(event) => setActiveAthleteId(Number(event.target.value))} disabled={individual}>{profiles.map((profile) => <option key={profile.athleteId} value={profile.athleteId}>{profile.athleteName} · {profile.project}</option>)}</select></label>
        <div className="body-report-identity"><strong>{activeProfile.athleteName}</strong><small>{activeProfile.gender || '性别未录入'} · {activeProfile.age === null ? '年龄未录入' : `${activeProfile.age}岁`} · {activeProfile.project} · {activeProfile.team}</small></div>
        <div className="body-report-source"><span>{activeProfile.bodyMeasurementDate || '本期模拟'}</span><small><i className="is-measured" />实测/录入 <i className="is-derived" />推算 <i className="is-simulated" />模拟 {report.simulatedCount}项</small></div>
      </div>
      <div className="body-composition-main">
        <div className="body-model-stage">
          <header><span>节段去脂分析</span><small>移动至身体区域查看训练解读</small></header>
          <HumanModel activePart={activePart} onPartChange={setActivePart} segments={report.segments} />
          <div className="body-part-popover">
            <span>{part.label}<em className={`origin-${activeSegment?.origin === '实测' ? 'measured' : activeSegment?.origin === '推算' ? 'derived' : 'simulated'}`}>{activeSegment?.origin || '推算'}</em></span>
            <strong>{activePart === 'abdomen' ? `${formatNumber(report.skinfolds[1].value, 1)} mm` : `${formatNumber(activeSegment?.leanKg || 0, 1)} kg`}<small>{activePart === 'abdomen' ? `内脏脂肪 ${formatNumber(report.visceralFat.value, 1)}级` : ` 标准度 ${formatNumber(activeSegment?.standardPct || 0, 0)}%`}</small></strong>
            <p>{part.note}</p>
          </div>
        </div>
        <div className="body-composition-panel professional-body-report">
          <div className="body-composition-kpis">
            <BodyKpi label="体重" metric={report.weight} unit="kg" />
            <BodyKpi label="骨骼肌量 SMM" metric={report.skeletalMuscle} unit="kg" />
            <BodyKpi label="体脂率 PBF" metric={report.bodyFatPct} unit="%" />
            <BodyKpi label="去脂体重 FFM" metric={report.fatFreeMass} unit="kg" />
            <BodyKpi label="骨骼肌指数 SMI" metric={report.smi} unit="kg/m²" />
            <BodyKpi label="基础代谢 BMR" metric={report.basalMetabolism} unit="kcal" digits={0} />
          </div>
          <section className="body-analysis-box body-composition-analysis">
            <header><strong>身体成分分析</strong><small>四分模型 · kg</small></header>
            <CompositionRow label="总体水 TBW" metric={report.totalBodyWater} total={report.weight.value} color="#2d8ca4" />
            <CompositionRow label="蛋白质" metric={report.protein} total={report.weight.value} color="#30a58e" />
            <CompositionRow label="无机盐" metric={report.mineral} total={report.weight.value} color="#d3a43a" />
            <CompositionRow label="脂肪量 BFM" metric={report.fatMass} total={report.weight.value} color="#e37b62" />
            <div className="composition-total"><span>体重 = 水分 + 蛋白质 + 无机盐 + 脂肪</span><strong>{formatNumber(report.weight.value, 1)} kg</strong></div>
          </section>
          <section className="body-analysis-box body-water-analysis">
            <header><strong>水合与细胞状态</strong><small>BIA参考</small></header>
            <GaugeMetric label="ECW/TBW" metric={report.ecwTbw} min={0.36} max={0.40} reference="常用观察区间 0.360–0.390" digits={3} />
            <GaugeMetric label="全身相位角" metric={report.phaseAngle} min={4.5} max={9} reference="结合个人基线追踪恢复状态" unit="°" />
            <GaugeMetric label="内脏脂肪面积" metric={report.visceralFatArea} min={30} max={130} reference="训练监测参考，非影像学诊断" unit="cm²" digits={0} />
          </section>
          <section className="body-analysis-box segmental-analysis">
            <header><strong>节段去脂与左右平衡</strong><small>100% = 对体重支撑充足的参考线</small></header>
            <div className="segmental-table-head"><span>部位</span><span>去脂量</span><span>标准度</span><span>训练判读</span></div>
            {report.segments.filter((item) => item.key !== 'abdomen').map((segment) => <div className="segmental-table-row" key={segment.key} onMouseEnter={() => setActivePart(segment.key)}><span>{segment.label}<i className={`origin-${segment.origin === '实测' ? 'measured' : segment.origin === '推算' ? 'derived' : 'simulated'}`} /></span><strong>{formatNumber(segment.leanKg, 1)} kg</strong><span><b><i style={{ width: `${Math.min(100, segment.standardPct / 120 * 100)}%` }} /></b>{formatNumber(segment.standardPct, 0)}%</span><em>{segment.trainingNote}</em></div>)}
            <footer><span>上肢差 {formatNumber(upperImbalance, 1)}%</span><span>下肢差 {formatNumber(lowerImbalance, 1)}%</span><strong>{Math.max(upperImbalance, lowerImbalance) <= 3 ? '双侧平衡良好' : '建议复核单侧力量'}</strong></footer>
          </section>
          <section className="body-analysis-box skinfold-analysis">
            <header><strong>皮褶与脂肪分布</strong><small>同测量者、同点位纵向对比</small></header>
            <div className="skinfold-site-list">{report.skinfolds.map((item) => <div key={item.label}><span>{item.label}<i className={`origin-${item.origin === '实测' ? 'measured' : 'simulated'}`} /></span><strong>{formatNumber(item.value, 1)}<small>mm</small></strong><b><i style={{ height: `${Math.min(100, item.value / 25 * 100)}%` }} /></b></div>)}</div>
            <div className="fat-distribution-summary"><span>四点皮褶和</span><strong>{formatNumber(report.skinfolds.reduce((sum, item) => sum + item.value, 0), 1)} mm</strong><span>内脏脂肪</span><strong>{formatNumber(report.visceralFat.value, 1)} 级</strong></div>
          </section>
          <section className="body-analysis-box body-training-interpretation">
            <header><strong>体能训练判读</strong><small>依据本期快照</small></header>
            <p>{report.trainingSummary}</p>
            <ul><li>优先追踪左右侧差异、骨骼肌量和四点皮褶和的趋势。</li><li>复测尽量保持晨起、空腹、排空和训练后间隔一致。</li><li>模拟项仅用于界面预览，录入实测值后自动替换。</li></ul>
          </section>
        </div>
      </div>
      <div className="body-report-trend">
        <section className="body-weekly-records"><header><span>每周训练与体重记录</span><small>训练课次 / 周均体重 / 体脂</small></header>{weeklyRecords.map((week) => <div key={week.label}><strong>{week.label}</strong><span>{week.sessions}课</span><em>{week.weight === null ? '—' : `${formatNumber(week.weight, 1)}kg`}</em><b>{week.bodyFat === null ? '—' : `${formatNumber(week.bodyFat, 1)}%`}</b></div>)}{!weeklyRecords.length && <p>当前周期暂无训练记录。</p>}</section>
        <section className="body-history-strip"><span>身体成分复测趋势</span>{history.map((item) => <div key={item.measurementDate}><strong>{item.measurementDate.slice(5)}</strong><em>{item.weightKg === null ? '—' : `${formatNumber(item.weightKg, 1)}kg`}</em><b>{item.bodyFatPct === null ? '—' : `${formatNumber(item.bodyFatPct, 1)}%`}</b></div>)}{!history.length && <p>暂无实测历史；当前模拟值不写入趋势。</p>}</section>
      </div>
      <p className="body-report-disclaimer">报告结构参考专业BIA、DXA与皮褶纵向监测口径。带橙色标记的数据为稳定模拟值，仅用于功能演示，不可作为医学诊断、营养处方或选材结论。</p>
    </div>
  );
}

function HumanModel({ activePart, onPartChange, segments }: { activePart: BodyPartKey; onPartChange: (part: BodyPartKey) => void; segments: SegmentReport[] }) {
  const partProps = (part: BodyPartKey) => ({
    className: `${part === 'abdomen' ? 'abdomen-zone ' : ''}${activePart === part ? 'active' : ''}`,
    onMouseEnter: () => onPartChange(part),
    onFocus: () => onPartChange(part),
    tabIndex: 0,
    role: 'button',
    'aria-label': bodyPartMeta[part].label
  });
  return (
    <div className="human-model-wrap">
      <span className="human-view-label">正面</span><span className="human-view-label">背面</span>
      {[0, 1].map((view) => <svg key={view} className="human-model-svg" viewBox="0 0 150 330" role="img" aria-label={view ? '人体背面节段模型' : '人体正面节段模型'}>
        <defs><linearGradient id={`muscle-${view}`} x1="0" y1="0" x2="1" y2="1"><stop stopColor="#26a79c" /><stop offset="1" stopColor="#0b6470" /></linearGradient></defs>
        <circle className="human-head" cx="75" cy="29" r="20" />
        <path className="human-neck" d="M64 48 L86 48 L91 66 L59 66 Z" />
        <path {...partProps('leftArm')} d="M57 67 C45 65 34 72 29 88 L12 169 C11 177 22 180 26 172 L48 111 L61 88 Z" />
        <path {...partProps('rightArm')} d="M93 67 C105 65 116 72 121 88 L138 169 C139 177 128 180 124 172 L102 111 L89 88 Z" />
        <path {...partProps('trunk')} d="M59 63 C68 59 82 59 91 63 L103 91 L97 176 C89 185 61 185 53 176 L47 91 Z" />
        <path {...partProps('abdomen')} d="M54 119 C65 113 85 113 96 119 L97 172 C87 180 63 180 53 172 Z" />
        <path {...partProps('leftLeg')} d="M54 178 C64 182 70 183 74 178 L72 238 L60 313 C53 319 44 315 46 306 L48 232 Z" />
        <path {...partProps('rightLeg')} d="M96 178 C86 182 80 183 76 178 L78 238 L90 313 C97 319 106 315 104 306 L102 232 Z" />
        <path className="human-muscle-line" d={view ? 'M55 88 C66 80 84 80 95 88 M57 115 C70 107 80 107 93 115 M56 145 C67 137 83 137 94 145 M51 216 C58 207 67 207 72 214 M99 216 C92 207 83 207 78 214' : 'M52 91 C61 83 68 83 74 91 M98 91 C89 83 82 83 76 91 M58 126 L92 126 M61 145 L89 145 M52 213 C59 204 68 204 73 212 M98 213 C91 204 82 204 77 212'} />
        {segments.filter((item) => item.key !== 'abdomen').map((segment) => <text key={segment.key} className="human-segment-value" x={segment.key.includes('Arm') ? (segment.key === 'leftArm' ? 24 : 126) : segment.key === 'trunk' ? 75 : segment.key === 'leftLeg' ? 58 : 92} y={segment.key.includes('Arm') ? 124 : segment.key === 'trunk' ? 103 : 247} textAnchor="middle">{formatNumber(segment.leanKg, 1)}</text>)}
      </svg>)}
    </div>
  );
}

function BodyKpi({ label, metric, unit, digits = 1 }: { label: string; metric: ReportValue; unit: string; digits?: number }) {
  return <div><span>{label}<i className={`origin-${metric.origin === '实测' ? 'measured' : metric.origin === '推算' ? 'derived' : 'simulated'}`} /></span><strong>{formatNumber(metric.value, digits)}<small>{unit}</small></strong></div>;
}

function CompositionRow({ label, metric, total, color }: { label: string; metric: ReportValue; total: number; color: string }) {
  return <div className="composition-row"><span>{label}<i className={`origin-${metric.origin === '实测' ? 'measured' : metric.origin === '推算' ? 'derived' : 'simulated'}`} /></span><b><i style={{ width: `${Math.min(100, metric.value / total * 100 * 1.55)}%`, background: color }} /></b><strong>{formatNumber(metric.value, 1)}</strong></div>;
}

function GaugeMetric({ label, metric, min, max, reference, unit = '', digits = 1 }: { label: string; metric: ReportValue; min: number; max: number; reference: string; unit?: string; digits?: number }) {
  const position = Math.max(0, Math.min(100, (metric.value - min) / (max - min) * 100));
  return <div className="body-gauge"><div><span>{label}<i className={`origin-${metric.origin === '实测' ? 'measured' : metric.origin === '推算' ? 'derived' : 'simulated'}`} /></span><strong>{formatNumber(metric.value, digits)}{unit}</strong></div><b><i style={{ left: `${position}%` }} /></b><small>{reference}</small></div>;
}

function seeded(profile: BodyCompositionProfile, salt: number) {
  let value = (profile.athleteId * 9301 + salt * 49297 + 233280) % 233280;
  for (const char of profile.athleteName) value = (value * 31 + char.charCodeAt(0)) % 233280;
  return value / 233280;
}

function resolved(actual: number | null, fallback: number, derived = false): ReportValue {
  return actual === null ? { value: fallback, origin: derived ? '推算' : '模拟' } : { value: actual, origin: '实测' };
}

function buildProfessionalBodyReport(profile: BodyCompositionProfile): ProfessionalBodyReport {
  const female = profile.gender === '女';
  const height = resolved(profile.heightCm, (female ? 169 : 180) + (seeded(profile, 1) - .5) * 8);
  const weight = resolved(profile.weightKg, (female ? 62 : 76) + (seeded(profile, 2) - .5) * 12);
  const bodyFatPct = resolved(profile.bodyFatPct, (female ? 19.5 : 12.5) + (seeded(profile, 3) - .5) * 5);
  const skeletalMuscle = resolved(profile.skeletalMuscleKg, weight.value * (female ? .385 : .445) + (seeded(profile, 4) - .5) * 1.6);
  const fatMass = { value: weight.value * bodyFatPct.value / 100, origin: bodyFatPct.origin === '实测' && weight.origin === '实测' ? '推算' : '模拟' } as ReportValue;
  const fatFreeMass = { value: weight.value - fatMass.value, origin: fatMass.origin } as ReportValue;
  const bmi = { value: weight.value / ((height.value / 100) ** 2), origin: height.origin === '实测' && weight.origin === '实测' ? '推算' : '模拟' } as ReportValue;
  const smi = { value: skeletalMuscle.value / ((height.value / 100) ** 2), origin: skeletalMuscle.origin === '实测' && height.origin === '实测' ? '推算' : '模拟' } as ReportValue;
  const totalBodyWater = resolved(profile.totalBodyWaterKg, fatFreeMass.value * (.725 + seeded(profile, 5) * .012), true);
  const mineral = { value: fatFreeMass.value * (.066 + seeded(profile, 6) * .006), origin: '推算' } as ReportValue;
  const protein = { value: Math.max(1, fatFreeMass.value - totalBodyWater.value - mineral.value), origin: '推算' } as ReportValue;
  const age = profile.age || 23;
  const bmrFallback = 10 * weight.value + 6.25 * height.value - 5 * age + (female ? -161 : 5);
  const basalMetabolism = resolved(profile.basalMetabolismKcal, bmrFallback, true);
  const phaseAngle = resolved(profile.phaseAngleDeg, (female ? 6.5 : 7.1) + (seeded(profile, 7) - .5) * .8);
  const ecwTbw = resolved(profile.ecwTbwRatio, .371 + seeded(profile, 8) * .014);
  const visceralFat = resolved(profile.visceralFatLevel, (female ? 4 : 5) + seeded(profile, 9) * 2);
  const visceralFatArea = resolved(profile.visceralFatAreaCm2, visceralFat.value * 9.4 + seeded(profile, 10) * 5, true);

  const armTotal = profile.upperLimbMuscleKg ?? fatFreeMass.value * .11;
  const legTotal = profile.lowerLimbMuscleKg ?? fatFreeMass.value * .39;
  const trunk = profile.trunkMuscleKg ?? fatFreeMass.value * .50;
  const armBias = (seeded(profile, 11) - .5) * .035;
  const legBias = (seeded(profile, 12) - .5) * .035;
  const segmentOrigin = (actual: number | null): DataOrigin => actual === null ? '模拟' : '推算';
  const segments: SegmentReport[] = [
    { key: 'leftArm', label: '左上肢', leanKg: profile.leftArmLeanKg ?? armTotal * (.5 + armBias), standardPct: 101 + seeded(profile, 13) * 10, origin: profile.leftArmLeanKg === null ? segmentOrigin(profile.upperLimbMuscleKg) : '实测', trainingNote: '拉力链' },
    { key: 'rightArm', label: '右上肢', leanKg: profile.rightArmLeanKg ?? armTotal * (.5 - armBias), standardPct: 101 + seeded(profile, 14) * 10, origin: profile.rightArmLeanKg === null ? segmentOrigin(profile.upperLimbMuscleKg) : '实测', trainingNote: '支撑侧' },
    { key: 'trunk', label: '躯干', leanKg: profile.trunkLeanKg ?? trunk, standardPct: 102 + seeded(profile, 15) * 9, origin: profile.trunkLeanKg === null ? segmentOrigin(profile.trunkMuscleKg) : '实测', trainingNote: '核心传导' },
    { key: 'leftLeg', label: '左下肢', leanKg: profile.leftLegLeanKg ?? legTotal * (.5 + legBias), standardPct: 102 + seeded(profile, 16) * 10, origin: profile.leftLegLeanKg === null ? segmentOrigin(profile.lowerLimbMuscleKg) : '实测', trainingNote: '蹬伸输出' },
    { key: 'rightLeg', label: '右下肢', leanKg: profile.rightLegLeanKg ?? legTotal * (.5 - legBias), standardPct: 102 + seeded(profile, 17) * 10, origin: profile.rightLegLeanKg === null ? segmentOrigin(profile.lowerLimbMuscleKg) : '实测', trainingNote: '稳定支撑' },
    { key: 'abdomen', label: '腹部脂肪', leanKg: 0, standardPct: 100, origin: profile.abdominalSkinfoldMm === null ? '模拟' : '实测', trainingNote: '控重观察' }
  ];
  const skinfolds = [
    { label: '肱三头肌', value: profile.tricepsSkinfoldMm ?? (female ? 13 : 8) + seeded(profile, 18) * 4, origin: profile.tricepsSkinfoldMm === null ? '模拟' as const : '实测' as const },
    { label: '腹部', value: profile.abdominalSkinfoldMm ?? (female ? 15 : 10) + seeded(profile, 19) * 5, origin: profile.abdominalSkinfoldMm === null ? '模拟' as const : '实测' as const },
    { label: '大腿', value: profile.thighSkinfoldMm ?? (female ? 18 : 11) + seeded(profile, 20) * 5, origin: profile.thighSkinfoldMm === null ? '模拟' as const : '实测' as const },
    { label: '小腿', value: profile.calfSkinfoldMm ?? (female ? 12 : 7) + seeded(profile, 21) * 4, origin: profile.calfSkinfoldMm === null ? '模拟' as const : '实测' as const }
  ];
  const simulatedCount = [height, weight, bodyFatPct, skeletalMuscle, phaseAngle, ecwTbw, visceralFat, ...skinfolds].filter((item) => item.origin === '模拟').length;
  const imbalance = Math.max(sideDifference(segments, 'leftArm', 'rightArm'), sideDifference(segments, 'leftLeg', 'rightLeg'));
  const fatBand = female ? [16, 24] : [8, 16];
  const fatText = bodyFatPct.value < fatBand[0] ? '体脂处于较低区间，需同步关注能量可用性与恢复' : bodyFatPct.value > fatBand[1] ? '体脂高于当前训练参考带，宜结合营养与专项周期观察趋势' : '体脂处于一般运动训练参考带内';
  const balanceText = imbalance <= 3 ? '左右节段差异较小，当前平衡性良好' : `最大左右差约${formatNumber(imbalance, 1)}%，建议结合单侧力量和伤病史复核`;
  return { height, weight, bodyFatPct, skeletalMuscle, fatMass, fatFreeMass, bmi, smi, basalMetabolism, totalBodyWater, protein, mineral, phaseAngle, ecwTbw, visceralFat, visceralFatArea, skinfolds, segments, simulatedCount, trainingSummary: `${fatText}；${balanceText}。身体成分应与功率、力量、训练负荷和恢复指标联合判断。` };
}

function sideDifference(segments: SegmentReport[], left: BodyPartKey, right: BodyPartKey) {
  const leftValue = segments.find((item) => item.key === left)?.leanKg || 0;
  const rightValue = segments.find((item) => item.key === right)?.leanKg || 0;
  return Math.max(leftValue, rightValue) ? Math.abs(leftValue - rightValue) / Math.max(leftValue, rightValue) * 100 : 0;
}

function weekLabel(date: string) {
  const parsed = new Date(`${date}T12:00:00`);
  const day = parsed.getDay() || 7;
  parsed.setDate(parsed.getDate() - day + 1);
  return `${String(parsed.getMonth() + 1).padStart(2, '0')}/${String(parsed.getDate()).padStart(2, '0')}`;
}

function weeklyTrainingRecords(records: TrainingRecord[], bodyHistory: BodyCompositionRecord[]) {
  const grouped = new Map<string, { label: string; sessions: number; weights: number[]; bodyFats: number[] }>();
  for (const record of records) {
    const label = weekLabel(record.date);
    const row = grouped.get(label) || { label, sessions: 0, weights: [], bodyFats: [] };
    row.sessions += 1;
    if (record.weightKg !== null) row.weights.push(record.weightKg);
    grouped.set(label, row);
  }
  for (const item of bodyHistory) {
    const label = weekLabel(item.measurementDate);
    const row = grouped.get(label) || { label, sessions: 0, weights: [], bodyFats: [] };
    if (item.weightKg !== null) row.weights.push(item.weightKg);
    if (item.bodyFatPct !== null) row.bodyFats.push(item.bodyFatPct);
    grouped.set(label, row);
  }
  return [...grouped.values()].slice(-8).map((row) => ({
    label: row.label,
    sessions: row.sessions,
    weight: row.weights.length ? average(row.weights) : null,
    bodyFat: row.bodyFats.length ? average(row.bodyFats) : null
  }));
}

const chinaProjection = geoMercator().fitExtent([[16, 12], [544, 398]], ChinaData);
const chinaPath = geoPath(chinaProjection);
const chinaProvincePaths = ChinaData.features.map((feature) => ({
  name: feature.properties?.name || '',
  path: chinaPath(feature) || ''
}));

export function BirthplaceMapOverview({ profiles, individual }: { profiles: OverviewAthleteProfile[]; individual: boolean }) {
  const available = profiles.filter((profile) => profile.province && profile.province !== '未设置');
  const provinces = useMemo(() => {
    const grouped = new Map<string, OverviewAthleteProfile[]>();
    for (const profile of available) grouped.set(profile.province, [...(grouped.get(profile.province) || []), profile]);
    return [...grouped.entries()]
      .map(([province, athletes]) => ({ province, athletes, count: athletes.length }))
      .sort((a, b) => b.count - a.count || a.province.localeCompare(b.province, 'zh-CN'));
  }, [profiles]);
  const [activeProvince, setActiveProvince] = useState('');
  const pendingProvince = useRef('');
  const hoverFrame = useRef<number | null>(null);
  const defaultProvinceReady = useRef(false);
  const originKey = provinces.map((item) => `${item.province}:${item.count}`).join('|');

  useEffect(() => {
    if (!provinces.length) return;
    setActiveProvince((current) => {
      if (!defaultProvinceReady.current || !provinces.some((item) => item.province === current)) {
        defaultProvinceReady.current = true;
        return provinces[0].province;
      }
      return current;
    });
  }, [originKey]);

  useEffect(() => () => {
    if (hoverFrame.current !== null) cancelAnimationFrame(hoverFrame.current);
  }, []);

  const activateProvince = useCallback((province: string, immediate = false) => {
    if (immediate) {
      if (hoverFrame.current !== null) {
        cancelAnimationFrame(hoverFrame.current);
        hoverFrame.current = null;
      }
      setActiveProvince((current) => current === province ? current : province);
      return;
    }
    pendingProvince.current = province;
    if (hoverFrame.current !== null) return;
    hoverFrame.current = requestAnimationFrame(() => {
      hoverFrame.current = null;
      setActiveProvince((current) => current === pendingProvince.current ? current : pendingProvince.current);
    });
  }, []);

  const active = provinces.find((item) => item.province === activeProvince);
  const activeAthletes = (active?.athletes || []).slice().sort((left, right) =>
    left.team.localeCompare(right.team, 'zh-CN') || left.athleteName.localeCompare(right.athleteName, 'zh-CN')
  );
  const cityCounts = [...activeAthletes.reduce((map, profile) => {
    const label = [profile.city, profile.county].filter(Boolean).join(' · ') || '城市未设置';
    map.set(label, (map.get(label) || 0) + 1);
    return map;
  }, new Map<string, number>()).entries()].sort((a, b) => b[1] - a[1]);
  const maxCount = Math.max(1, ...provinces.map((item) => item.count));

  if (!profiles.length) return <ProfileEmpty detail="录入运动员籍贯省市后自动生成生源地图。" />;

  return (
    <div className="birthplace-map-visual" aria-label={individual ? '个人代表和输送单位省份地图' : '队伍代表和输送单位省份分布地图'}>
      <div className="birthplace-map-stage">
        <svg viewBox="0 0 560 410" role="img" aria-label="中国省级代表和输送单位分布图">
          <title>{individual ? '个人代表和输送单位所在省份' : '队伍运动员代表和输送单位省份分布'}</title>
          {chinaProvincePaths.map((province) => {
            const row = provinces.find((item) => item.province === province.name);
            const count = row?.count || 0;
            const activePath = province.name === activeProvince;
            const opacity = count ? .28 + count / maxCount * .6 : 1;
            return (
              <path
                key={province.name}
                d={province.path}
                className={`${count ? 'has-origin-data' : ''}${activePath ? ' is-active' : ''}`}
                style={{ '--origin-opacity': opacity } as CSSProperties}
                role="button"
                tabIndex={0}
                aria-label={`${province.name}，${count}名运动员`}
                aria-pressed={activePath}
                onMouseEnter={() => activateProvince(province.name)}
                onFocus={() => activateProvince(province.name, true)}
                onClick={() => activateProvince(province.name, true)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    activateProvince(province.name, true);
                  }
                }}
              />
            );
          })}
        </svg>
        <div className="birthplace-map-legend"><span>少</span><i /><span>多</span><em>滑过省份查看详情</em></div>
      </div>

      <aside className="birthplace-detail" aria-live="polite">
        <div className="birthplace-detail-heading">
          <div>
            <span><i />实时人数</span>
            <strong>{activeProvince}<em>{active?.count || 0}人</em></strong>
          </div>
          <div><span>{individual ? '本人来源地' : `占有效档案 ${percentage(active?.count || 0, available.length || 1)}%`}</span><strong>{available.length}<small>人总计</small></strong></div>
        </div>
        {active ? (
          <>
            <div className="birthplace-city-list">
              <span>地区分布</span>
              {cityCounts.map(([city, count]) => <div key={city}><strong>{city}</strong><em>{count}人</em></div>)}
            </div>
            <div className="birthplace-athlete-list">
              <header><span>{individual ? '本人详细信息' : '运动员详细信息'}</span><small>{activeAthletes.length > 3 ? '上下滑动查看全部' : `共 ${activeAthletes.length} 人`}</small></header>
              <div className="birthplace-athlete-scroll" tabIndex={activeAthletes.length > 3 ? 0 : -1} aria-label={`${activeProvince}运动员名单，共${activeAthletes.length}人`}>
              {activeAthletes.map((profile) => (
                <div key={profile.athleteId}>
                  <i>{profile.athleteName.slice(0, 1)}</i>
                  <span className="birthplace-athlete-identity"><strong>{individual ? '本人' : profile.athleteName}</strong><small>{[profile.gender, profile.age === null ? '' : `${profile.age}岁`, profile.project, profile.athletePosition].filter(Boolean).join(' · ')}</small></span>
                  <span className="birthplace-athlete-unit"><strong>{profile.team || '代表单位未设置'}</strong><small>输送：{profile.originUnit || '未设置'}</small></span>
                  <span className="birthplace-athlete-result"><small>最好成绩</small><strong>{profile.bestResult || '暂无记录'}</strong></span>
                  <span className={`birthplace-athlete-state state-${profile.competitiveLevel || 'none'}`}><strong>{competitiveStateLabel(profile.competitiveLevel)}</strong><small>{profile.competitiveScore === null ? '暂无评分' : `${formatNumber(profile.competitiveScore, 1)}分`}</small></span>
                </div>
              ))}
              </div>
            </div>
          </>
        ) : <div className="birthplace-detail-empty"><strong>暂无生源</strong><span>该省份当前没有权限范围内的运动员记录。</span></div>}
        <p className="birthplace-coverage">有效单位省份 <strong>{available.length}/{profiles.length}</strong> · 覆盖省份 <strong>{provinces.length}</strong></p>
      </aside>
    </div>
  );
}

function competitiveStateLabel(level: CompetitiveStateLevel | null) {
  if (level === 'peak') return '巅峰';
  if (level === 'good') return '良好';
  if (level === 'build') return '进阶';
  if (level === 'adjust') return '调整';
  return '未知';
}

const stateMeta: Record<CompetitiveStateLevel, { label: string; color: string }> = {
  peak: { label: '巅峰', color: '#118b83' },
  good: { label: '良好', color: '#3d82a5' },
  build: { label: '进阶', color: '#e2a323' },
  adjust: { label: '调整', color: '#d95b45' }
};

const dimensionMeta = [
  ['endurance', '专项耐力'], ['power', '力量爆发'], ['technique', '技术效率'],
  ['loadAdaptation', '负荷适应'], ['recovery', '恢复能力'], ['competition', '比赛能力']
] as const;

type LevelPoint = {
  level: string;
  count: number;
  color: string;
  share: number;
};

const LEVEL_ORDER = ['国际级运动健将', '运动健将', '一级运动员', '二级运动员', '三级运动员', '未定级'] as const;
type TechnicalLevel = (typeof LEVEL_ORDER)[number];

const LEVEL_COLORS: Record<string, string> = {
  '国际级运动健将': '#c9a227',
  '运动健将': '#2b7d8d',
  '一级运动员': '#3d82a5',
  '二级运动员': '#67a35c',
  '三级运动员': '#a37b5c',
  '未定级': '#9aa8ab'
};

function normalizeTechnicalLevel(value: string | null | undefined): TechnicalLevel {
  if (!value?.trim()) return '未定级';
  const clean = value.trim().replaceAll(' ', '');
  const knownLevel = LEVEL_ORDER.find((level) => level === clean);
  if (knownLevel) return knownLevel;
  if (/国际.*健将/.test(clean)) return '国际级运动健将';
  if (/健将/.test(clean)) return '运动健将';
  if (/一级/.test(clean)) return '一级运动员';
  if (/二级/.test(clean)) return '二级运动员';
  if (/三级/.test(clean)) return '三级运动员';
  return '未定级';
}

function TechnicalLevelTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload?: LevelPoint }> }) {
  const point = payload?.[0]?.payload;
  if (!active || !point) return null;
  return (
    <div className="team-profile-tooltip">
      <strong>{point.level}</strong>
      <span>运动员：{point.count} 名</span>
      <span>队内占比：{formatNumber(point.share, 1)}%</span>
    </div>
  );
}

function CompetitiveLevelChart({ profiles }: { profiles: OverviewAthleteProfile[] }) {
  if (!profiles.length) {
    return (
      <section className="team-profile-chart-card team-competitive-card">
        <header><div><h3>竞技水平</h3><p>成绩、技术等级与竞技档案完整度</p></div></header>
        <div className="team-profile-chart-empty">暂无运动员数据</div>
      </section>
    );
  }

  const gradedProfiles = profiles.filter((profile) => normalizeTechnicalLevel(profile.technicalLevel || '') !== '未定级');
  const gradedCount = gradedProfiles.length;

  if (!profiles.length || !gradedCount) {
    return (
      <section className="team-profile-chart-card team-competitive-card">
        <header><div><h3>竞技水平</h3><p>成绩、技术等级与竞技档案完整度</p></div></header>
        <div className="team-profile-chart-empty">暂无运动员数据</div>
      </section>
    );
  }

  const levelCounts = new Map<string, number>();
  for (const profile of gradedProfiles) {
    const level = normalizeTechnicalLevel(profile.technicalLevel || '');
    levelCounts.set(level, (levelCounts.get(level) || 0) + 1);
  }
  const levelData: LevelPoint[] = LEVEL_ORDER
    .filter((level) => level !== '未定级')
    .map((level) => {
      const count = levelCounts.get(level) || 0;
      return { level, count, color: LEVEL_COLORS[level], share: count / gradedCount * 100 };
    })
    .filter((point) => point.count > 0);

  return (
    <section className="team-profile-chart-card team-competitive-card">
      <header><div><h3>竞技水平</h3><p>团队运动员技术等级结构</p></div><span>{profiles.length} 名运动员</span></header>
      <div className="team-competitive-plot-heading"><strong>运动员技术等级分布</strong><span>已定级 {gradedCount} / {profiles.length} 名</span></div>
      <div className="team-profile-level-canvas">
        <ResponsiveContainer width="100%" height="100%"><BarChart data={levelData} layout="vertical" margin={{ top: 4, right: 28, bottom: 2, left: 4 }} barCategoryGap="18%">
          <CartesianGrid stroke="#e3ebed" strokeDasharray="3 5" horizontal={false} />
          <XAxis type="number" allowDecimals={false} tick={{ fontSize: 8, fill: '#74888f' }} axisLine={{ stroke: '#cad9dc' }} tickLine={false} unit="人" />
          <YAxis type="category" dataKey="level" tick={{ fontSize: 8, fill: '#506c74', fontWeight: 700 }} axisLine={false} tickLine={false} width={75} />
          <Tooltip content={<TechnicalLevelTooltip />} cursor={{ fill: 'rgba(17,139,131,.055)' }} />
          <Bar dataKey="count" name="人数" radius={[0, 3, 3, 0]} minPointSize={2}>
            {levelData.map((entry, index) => (
              <Cell key={`cell-${index}`} fill={entry.color} stroke="#fff" strokeWidth={1} />
            ))}
            <LabelList dataKey="count" position="right" fill="#4c6870" fontSize={8} fontWeight={800} formatter={(value) => `${value ?? 0}人`} />
          </Bar>
        </BarChart></ResponsiveContainer>
      </div>
    </section>
  );
}

export function CompetitiveStateOverview({ profiles, individual }: { profiles: OverviewAthleteProfile[]; individual: boolean }) {
  const available = profiles.filter((profile) => profile.competitiveScore !== null);
  if (!available.length) return <ProfileEmpty detail="完成竞技状态评估后生成总分、等级分布和六维能力画像。" />;
  const score = average(available.map((profile) => profile.competitiveScore)) || 0;
  const comparable = available.filter((profile) => profile.previousCompetitiveScore !== null);
  const previousScore = average(comparable.map((profile) => profile.previousCompetitiveScore));
  const change = previousScore === null ? null : score - previousScore;
  const dimensions = dimensionMeta.map(([key, label]) => ({
    key,
    label,
    score: average(available.map((profile) => profile.competitiveDimensions[key])) || 0
  }));
  const stateCounts = (Object.keys(stateMeta) as CompetitiveStateLevel[]).map((level) => ({
    level,
    ...stateMeta[level],
    count: available.filter((profile) => profile.competitiveLevel === level).length
  }));
  const leadingDimension = dimensions.slice().sort((a, b) => b.score - a.score)[0];
  const weakestDimension = dimensions.slice().sort((a, b) => a.score - b.score)[0];

  return (
    <div className="competitive-state-visual" aria-label={individual ? '个人竞技状态六维评估' : '团队竞技状态分布与六维均值'}>
      <div className="competitive-radar">
        <ResponsiveContainer width="100%" height="100%">
          <RadarChart data={dimensions} outerRadius="67%">
            <PolarGrid stroke="#cadadd" />
            <PolarAngleAxis dataKey="label" tick={{ fill: '#405e68', fontSize: 8, fontWeight: 700 }} />
            <PolarRadiusAxis domain={[0, 100]} tickCount={5} tick={{ fill: '#91a0a5', fontSize: 7 }} axisLine={false} />
            <Tooltip formatter={(value) => `${formatNumber(Number(value), 1)}分`} />
            <Radar dataKey="score" name={individual ? '本人评分' : '团队均值'} stroke="#118b83" strokeWidth={2.2} fill="#24a99a" fillOpacity={.28} />
          </RadarChart>
        </ResponsiveContainer>
      </div>
      <div className="competitive-summary">
        <div className="competitive-score-ring" style={{ '--competitive-score': `${score * 3.6}deg` } as CSSProperties}>
          <div><strong>{formatNumber(score, 1)}</strong><span>竞技状态</span></div>
        </div>
        <div className="competitive-change"><span>较前次</span><strong className={change !== null && change < 0 ? 'down' : ''}>{change === null ? '—' : `${change >= 0 ? '+' : ''}${formatNumber(change, 1)}`}</strong></div>
      </div>
      <div className="competitive-levels">
        {stateCounts.map((item) => <div key={item.level}><i style={{ background: item.color }} /><span>{item.label}</span><strong>{item.count}{individual ? '' : '人'}</strong></div>)}
      </div>
      <p className="competitive-insight">{individual ? '本人' : '团队平均'}优势维度为<strong>{leadingDimension.label}</strong>（{formatNumber(leadingDimension.score, 1)}分），相对薄弱维度为<strong>{weakestDimension.label}</strong>（{formatNumber(weakestDimension.score, 1)}分）；结论仅用于训练周期监测。</p>
    </div>
  );
}

function ProfileStat({ label, value, unit, note }: { label: string; value: string; unit: string; note: string }) {
  return <div><span>{label}</span><strong>{value}<small>{unit}</small></strong><p>{note}</p></div>;
}

function ProfileEmpty({ detail, title = '暂无档案画像数据' }: { detail: string; title?: string }) {
  return <div className="profile-visual-empty"><strong>{title}</strong><span>{detail}</span></div>;
}
