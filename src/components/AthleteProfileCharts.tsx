import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { geoMercator, geoPath } from 'd3-geo';
import { scaleBand, scaleLinear } from 'd3-scale';
import ChinaData from 'china-map-geojson/lib/china.js';
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import type {
  BodyCompositionRecord,
  CompetitiveStateLevel,
  OverviewAthleteProfile,
} from '../types';
import { formatNumber, percentage } from '../utils';

function average(values: Array<number | null | undefined>) {
  const valid = values.filter(
    (value): value is number => typeof value === 'number' && Number.isFinite(value)
  );
  return valid.length ? valid.reduce((sum, value) => sum + value, 0) / valid.length : null;
}

function range(values: Array<number | null | undefined>, unit: string) {
  const valid = values.filter(
    (value): value is number => typeof value === 'number' && Number.isFinite(value)
  );
  if (!valid.length) return '暂无';
  return `${formatNumber(Math.min(...valid), 1)}—${formatNumber(Math.max(...valid), 1)} ${unit}`;
}

type TeamScatterPoint = {
  athleteId: number;
  name: string;
  age: number | null;
  height: number;
  weight: number;
};

function chartDomain(values: number[], minimumPadding: number): [number, number] {
  const low = Math.min(...values);
  const high = Math.max(...values);
  const padding = Math.max(minimumPadding, (high - low) * 0.12);
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
  const bmi = heightM && profile.weightKg !== null ? profile.weightKg / heightM ** 2 : null;
  const fatMass =
    profile.weightKg !== null && profile.bodyFatPct !== null
      ? (profile.weightKg * profile.bodyFatPct) / 100
      : null;
  const fatFreeMass =
    profile.weightKg !== null && fatMass !== null ? profile.weightKg - fatMass : null;
  const skeletalMuscleIndex =
    heightM && profile.skeletalMuscleKg !== null ? profile.skeletalMuscleKg / heightM ** 2 : null;
  const fatFreeMassIndex = heightM && fatFreeMass !== null ? fatFreeMass / heightM ** 2 : null;
  const female = profile.gender === '女';
  return {
    体重: compositionBand(bmi, female ? 18 : 19, female ? 24.5 : 25),
    BMI: compositionBand(bmi, female ? 18 : 19, female ? 24.5 : 25),
    体脂率: compositionBand(profile.bodyFatPct, female ? 14 : 6, female ? 24 : 18),
    脂肪量: compositionBand(fatMass, female ? 8 : 5, female ? 18 : 15),
    骨骼肌量: compositionBand(skeletalMuscleIndex, female ? 6.2 : 8.2, female ? 8.8 : 10.8),
    去脂体重: compositionBand(fatFreeMassIndex, female ? 14 : 16, female ? 19.5 : 22),
  };
}

function TeamProfileTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload?: TeamScatterPoint }>;
}) {
  const point = payload?.[0]?.payload;
  if (!active || !point) return null;
  return (
    <div className="team-profile-tooltip">
      <strong>{point.name}</strong>
      <span>年龄：{point.age === null ? '—' : `${formatNumber(point.age, 1)}岁`}</span>
      <span>身高：{formatNumber(point.height, 1)} cm</span>
      <span>体重：{formatNumber(point.weight, 1)} kg</span>
    </div>
  );
}

function AgePyramidTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload?: AgeBin }>;
}) {
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

export function AthleteProfileOverview({
  profiles,
  individual,
  asOf,
}: {
  profiles: OverviewAthleteProfile[];
  individual: boolean;
  asOf: string;
}) {
  const [activeTrainingYearsBand, setActiveTrainingYearsBand] = useState<TrainingYearsBand | null>(
    null
  );
  if (
    !profiles.length ||
    !profiles.some(
      (profile) => profile.age !== null || profile.heightCm !== null || profile.weightKg !== null
    )
  ) {
    return (
      <ProfileEmpty
        title={individual ? '暂无档案画像数据' : '暂无队伍身体数据'}
        detail="完善出生日期和身体测量后自动生成。"
      />
    );
  }
  const age = average(profiles.map((profile) => profile.age));
  const height = average(profiles.map((profile) => profile.heightCm));
  const weight = average(profiles.map((profile) => profile.weightKg));
  const current = profiles[0];
  const weightChange =
    current.weightKg !== null && current.previousWeightKg !== null
      ? current.weightKg - current.previousWeightKg
      : null;

  if (individual)
    return (
      <div className="profile-overview-visual" aria-label="个人年龄和身体形态">
        <div className="profile-stat-grid">
          <ProfileStat
            label="年龄"
            value={age === null ? '—' : formatNumber(age, 1)}
            unit="岁"
            note={current.birthDate || '出生日期未录入'}
          />
          <ProfileStat
            label="身高"
            value={height === null ? '—' : formatNumber(height, 1)}
            unit="cm"
            note={current.bodyMeasurementDate || '未测量'}
          />
          <ProfileStat
            label="体重"
            value={weight === null ? '—' : formatNumber(weight, 1)}
            unit="kg"
            note={
              weightChange === null
                ? '暂无前次对比'
                : `较前次 ${weightChange >= 0 ? '+' : ''}${formatNumber(weightChange, 1)} kg`
            }
          />
        </div>
      </div>
    );

  const scatterData: TeamScatterPoint[] = profiles.flatMap((profile) =>
    profile.heightCm !== null && profile.weightKg !== null
      ? [
          {
            athleteId: profile.athleteId,
            name: profile.athleteName,
            age: profile.age,
            height: profile.heightCm,
            weight: profile.weightKg,
          },
        ]
      : []
  );
  const ageProfiles = profiles.filter(
    (profile): profile is OverviewAthleteProfile & { age: number } =>
      profile.age !== null && Number.isFinite(profile.age)
  );
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
  const maxSideCount = useMemo(
    () => ageBins.reduce((max, bin) => Math.max(max, Math.abs(bin.male), bin.female), 0),
    [ageBins]
  );

  const heights = scatterData.map((item) => item.height);
  const weights = scatterData.map((item) => item.weight);
  const minHeight = heights.length ? Math.min(...heights) : null;
  const maxHeight = heights.length ? Math.max(...heights) : null;
  const minWeight = weights.length ? Math.min(...weights) : null;
  const maxWeight = weights.length ? Math.max(...weights) : null;
  const compositionRows = ['体重', 'BMI', '体脂率', '脂肪量', '骨骼肌量', '去脂体重'].map(
    (label) => {
      const counts: Record<CompositionBand, number> = { 偏低: 0, 目标范围: 0, 偏高: 0, 未测试: 0 };
      for (const profile of profiles) {
        const band =
          bodyCompositionStatus(profile)[label as keyof ReturnType<typeof bodyCompositionStatus>];
        counts[band] += 1;
      }
      const sample = profiles.length;
      return { label, ...counts, sample };
    }
  );
  const trainingYearsBands = [
    { label: '≤2年', phase: '新秀期', matches: (years: number) => years <= 2 },
    { label: '3～5年', phase: '成长期', matches: (years: number) => years > 2 && years < 6 },
    { label: '6～8年', phase: '成熟期', matches: (years: number) => years >= 6 && years < 9 },
    { label: '≥9年', phase: '资深期', matches: (years: number) => years >= 9 },
  ].map((band) => ({
    ...band,
    athletes: profiles.filter((profile) => {
      const years = sportYears(profile.startSportDate, asOf);
      return years !== null && band.matches(years);
    }).length,
  }));
  const trainedAthletes = profiles
    .map((profile) => sportYears(profile.startSportDate, asOf))
    .filter((value): value is number => value !== null);
  const trainingYearsTotal = trainingYearsBands.reduce((sum, item) => sum + item.athletes, 0);
  const trainingYearsData: TrainingYearsBand[] = trainingYearsBands.map((band, index) => ({
    ...band,
    percentage: trainingYearsTotal ? (band.athletes / trainingYearsTotal) * 100 : 0,
    fill: ['#0d8c84', '#2e9bba', '#d49a2e', '#556d83'][index],
  }));
  const leadingTrainingYearsBand = trainingYearsTotal
    ? trainingYearsData.reduce((leading, band) =>
        band.athletes > leading.athletes ? band : leading
      )
    : null;
  const missingTrainingYearsCount = Math.max(0, profiles.length - trainingYearsTotal);
  return (
    <div
      className="profile-overview-visual team-profile-visual"
      aria-label="队伍年龄、身体形态与竞技水平分布"
    >
      <div className="team-profile-chart-grid three-columns">
        <section className="team-profile-chart-card team-scatter-card">
          <header>
            <div>
              <h3>身高—体重分布</h3>
              <p>运动员身体形态相对位置</p>
            </div>
            <span>{scatterData.length} 名有效运动员</span>
          </header>
          <div className="team-profile-chart-canvas">
            {scatterData.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <ScatterChart margin={{ top: 18, right: 26, bottom: 27, left: 14 }}>
                  <CartesianGrid stroke="#e1eaeb" strokeDasharray="3 5" />
                  <XAxis
                    type="number"
                    dataKey="height"
                    name="身高"
                    domain={chartDomain(
                      scatterData.map((item) => item.height),
                      2
                    )}
                    tick={{ fontSize: 9, fill: '#74888f' }}
                    axisLine={false}
                    tickLine={false}
                    label={{
                      value: '身高 cm',
                      position: 'insideBottomRight',
                      offset: -8,
                      fill: '#74888f',
                      fontSize: 9,
                    }}
                  />
                  <YAxis
                    type="number"
                    dataKey="weight"
                    name="体重"
                    domain={chartDomain(
                      scatterData.map((item) => item.weight),
                      3
                    )}
                    tick={{ fontSize: 9, fill: '#74888f' }}
                    axisLine={false}
                    tickLine={false}
                    width={48}
                    label={{
                      value: '体重 kg',
                      angle: -90,
                      position: 'insideLeft',
                      offset: 8,
                      fill: '#74888f',
                      fontSize: 9,
                    }}
                  />
                  {height !== null && (
                    <ReferenceLine
                      x={height}
                      stroke="#2b7d8d"
                      strokeDasharray="5 5"
                      label={{
                        value: '平均身高',
                        position: 'insideTopRight',
                        fill: '#56808a',
                        fontSize: 8,
                      }}
                    />
                  )}
                  {weight !== null && (
                    <ReferenceLine
                      y={weight}
                      stroke="#2b7d8d"
                      strokeDasharray="5 5"
                      label={{
                        value: '平均体重',
                        position: 'insideTopLeft',
                        fill: '#56808a',
                        fontSize: 8,
                      }}
                    />
                  )}
                  <Tooltip
                    content={<TeamProfileTooltip />}
                    cursor={{ stroke: '#a9c5c8', strokeDasharray: '3 4' }}
                  />
                  <Scatter data={scatterData} fill="#12978f" stroke="#fff" strokeWidth={2} />
                </ScatterChart>
              </ResponsiveContainer>
            ) : (
              <div className="team-profile-chart-empty">暂无身高体重配对数据</div>
            )}
          </div>
          {scatterData.length > 0 && (
            <div className="team-scatter-summary">
              <span>
                平均身高 <strong>{formatNumber(height ?? 0, 1)} cm</strong>
              </span>
              <i>｜</i>
              <span>
                最小身高 <strong>{formatNumber(minHeight ?? 0, 1)} cm</strong>
              </span>
              <i>｜</i>
              <span>
                最大身高 <strong>{formatNumber(maxHeight ?? 0, 1)} cm</strong>
              </span>
              <i>｜</i>
              <span>
                平均体重 <strong>{formatNumber(weight ?? 0, 1)} kg</strong>
              </span>
              <i>｜</i>
              <span>
                最小体重 <strong>{formatNumber(minWeight ?? 0, 1)} kg</strong>
              </span>
              <i>｜</i>
              <span>
                最大体重 <strong>{formatNumber(maxWeight ?? 0, 1)} kg</strong>
              </span>
            </div>
          )}
        </section>

        <section className="team-profile-chart-card team-age-card">
          <header>
            <div>
              <h3>年龄结构</h3>
              <p>展示队伍运动员年龄性别金字塔结构</p>
            </div>
            <span>共 {ageProfiles.length} 人</span>
          </header>
          <div className="team-age-plot-heading">
            <strong>年龄金字塔</strong>
            <span>按性别分组的人数分布</span>
          </div>
          <div className="team-profile-age-canvas">
            {ageBins.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={ageBins}
                  layout="vertical"
                  margin={{ top: 4, right: 14, bottom: 2, left: 4 }}
                  barCategoryGap="16%"
                >
                  <CartesianGrid stroke="#e3ebed" strokeDasharray="3 5" horizontal={false} />
                  <XAxis
                    type="number"
                    domain={[-maxSideCount, maxSideCount]}
                    tickFormatter={(value) => `${Math.abs(Number(value))}`}
                    tick={{ fontSize: 8, fill: '#74888f' }}
                    axisLine={{ stroke: '#cad9dc' }}
                    tickLine={false}
                  />
                  <YAxis
                    type="category"
                    dataKey="group"
                    tick={{ fontSize: 8, fill: '#506c74', fontWeight: 700 }}
                    axisLine={false}
                    tickLine={false}
                    width={48}
                  />
                  <Tooltip
                    content={<AgePyramidTooltip />}
                    cursor={{ fill: 'rgba(17,139,131,.055)' }}
                  />
                  <Bar
                    dataKey="male"
                    name="男"
                    fill="#2f7fa3"
                    radius={[3, 0, 0, 3]}
                    minPointSize={2}
                  >
                    <LabelList
                      dataKey="male"
                      position="left"
                      fill="#4c6870"
                      fontSize={8}
                      fontWeight={800}
                      formatter={(value) => `${Math.abs(Number(value))}人`}
                    />
                  </Bar>
                  <Bar
                    dataKey="female"
                    name="女"
                    fill="#d96e8b"
                    radius={[0, 3, 3, 0]}
                    minPointSize={2}
                  >
                    <LabelList
                      dataKey="female"
                      position="right"
                      fill="#4c6870"
                      fontSize={8}
                      fontWeight={800}
                      formatter={(value) => `${value}人`}
                    />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="team-profile-chart-empty">暂无年龄数据</div>
            )}
          </div>
          {ageBins.length > 0 && (
            <>
              <div className="team-age-legend">
                <span>
                  <i />男
                </span>
                <span>
                  <i />女
                </span>
              </div>
              <div className="team-age-summary">
                <span>
                  平均年龄 <strong>{formatNumber(averageAge ?? 0, 1)} 岁</strong>
                </span>
                <i>｜</i>
                <span>
                  最小 <strong>{formatNumber(minAge ?? 0, 1)} 岁</strong>
                </span>
                <i>｜</i>
                <span>
                  最大 <strong>{formatNumber(maxAge ?? 0, 1)} 岁</strong>
                </span>
                <i>｜</i>
                <span>
                  年龄跨度 <strong>{formatNumber((maxAge ?? 0) - (minAge ?? 0), 1)} 岁</strong>
                </span>
              </div>
            </>
          )}
        </section>

        <CompetitiveLevelChart profiles={profiles} />
      </div>
      <div className="team-profile-insight-grid">
        <section className="team-profile-insight-card composition-status-card">
          <header>
            <div>
              <h3>身体成分</h3>
              <p>按运动训练参考区间统计 · 每行 100%</p>
            </div>
            <span>{profiles.length} 名运动员</span>
          </header>
          <div className="composition-status-list">
            {compositionRows.map((row) => (
              <div className="composition-status-row" key={row.label}>
                <strong>{row.label}</strong>
                <div
                  className="composition-stack"
                  role="img"
                  aria-label={`${row.label}：偏低${row.偏低}人，目标范围${row.目标范围}人，偏高${row.偏高}人，未测试${row.未测试}人`}
                >
                  {(['偏低', '目标范围', '偏高', '未测试'] as CompositionBand[]).map((band) =>
                    row.sample ? (
                      <span
                        key={band}
                        className={`composition-band ${band}`}
                        style={{ width: `${(row[band] / row.sample) * 100}%` }}
                      />
                    ) : null
                  )}
                </div>
                <small>{row.sample ? `${row.sample} 人` : '暂无数据'}</small>
              </div>
            ))}
          </div>
          <footer className="composition-legend">
            <span>
              <i className="偏低" />
              偏低
            </span>
            <span>
              <i className="目标范围" />
              目标范围
            </span>
            <span>
              <i className="偏高" />
              偏高
            </span>
            <span>
              <i className="未测试" />
              未测试
            </span>
            <em>体重按 BMI 区间判定</em>
          </footer>
        </section>
        <section className="team-profile-insight-card training-years-swarm-card">
          <header>
            <div>
              <h3>训练年限</h3>
              <p>
                {leadingTrainingYearsBand
                  ? `${leadingTrainingYearsBand.phase}为主力阶段 · 每个圆点代表 1 名运动员`
                  : '生涯阶段蜂群图 · 按开始运动日期计算'}
              </p>
            </div>
            <span>
              {activeTrainingYearsBand
                ? `${activeTrainingYearsBand.phase} ${activeTrainingYearsBand.athletes} 人`
                : `${trainingYearsTotal} 名已建档`}
            </span>
          </header>
          <div
            className={`training-years-swarm ${activeTrainingYearsBand ? 'has-active-stage' : ''}`}
            role="group"
            aria-label={`训练年限生涯阶段蜂群图：${trainingYearsData.map((band) => `${band.phase}${band.athletes}人，占比${formatNumber(band.percentage, 1)}%`).join('；')}`}
          >
            <i className="training-years-swarm-path" aria-hidden="true" />
            {trainingYearsData.map((band) => (
              <article
                key={band.label}
                className={`${leadingTrainingYearsBand?.label === band.label ? 'is-leading' : ''} ${activeTrainingYearsBand?.label === band.label ? 'is-active' : ''}`}
                style={{ '--stage-color': band.fill } as CSSProperties}
                tabIndex={0}
                aria-label={`${band.label}${band.phase}，${band.athletes}人，占比${formatNumber(band.percentage, 1)}%`}
                onMouseEnter={() => setActiveTrainingYearsBand(band)}
                onMouseLeave={() => setActiveTrainingYearsBand(null)}
                onFocus={() => setActiveTrainingYearsBand(band)}
                onBlur={() => setActiveTrainingYearsBand(null)}
              >
                <span>{band.label}</span>
                <strong>{band.phase}</strong>
                <div className="training-years-dot-cluster" aria-hidden="true">
                  {Array.from({ length: Math.min(band.athletes, 24) }, (_, index) => (
                    <i key={index} />
                  ))}
                  {band.athletes > 24 && <em>+{band.athletes - 24}</em>}
                </div>
                <b>
                  {band.athletes}
                  <small>人</small>
                </b>
                <em>{formatNumber(band.percentage, 1)}%</em>
              </article>
            ))}
          </div>
          <footer className="training-years-summary">
            <span>
              平均训练年限{' '}
              <strong>
                {trainedAthletes.length
                  ? `${formatNumber(average(trainedAthletes) || 0, 1)}年`
                  : '—'}
              </strong>
            </span>
            <i />
            <span>
              最长{' '}
              <strong>
                {trainedAthletes.length
                  ? `${formatNumber(Math.max(...trainedAthletes), 1)}年`
                  : '—'}
              </strong>
            </span>
            <i />
            <span>
              最短{' '}
              <strong>
                {trainedAthletes.length
                  ? `${formatNumber(Math.min(...trainedAthletes), 1)}年`
                  : '—'}
              </strong>
            </span>
            {missingTrainingYearsCount > 0 && (
              <>
                <i />
                <span>
                  待补 <strong>{missingTrainingYearsCount} 人</strong>
                </span>
              </>
            )}
          </footer>
        </section>
      </div>
    </div>
  );
}

type TrainingYearsBand = {
  label: string;
  phase: string;
  athletes: number;
  percentage: number;
  fill: string;
};

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
  muscleMassKg: number | null;
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
type SegmentMeasure = { id: string; label: string; value: number | null };
type BodyCompositionModelOverviewProps = {
  profiles: BodyCompositionProfile[];
  individual: boolean;
};

export function BodyCompositionModelOverview({
  profiles,
  individual,
}: BodyCompositionModelOverviewProps) {
  const availableProfiles = profiles.filter(
    (profile) =>
      profile.heightCm !== null ||
      profile.weightKg !== null ||
      profile.bodyFatPct !== null ||
      profile.skeletalMuscleKg !== null
  );
  const [activeAthleteId, setActiveAthleteId] = useState(
    availableProfiles[0]?.athleteId ?? profiles[0]?.athleteId ?? 0
  );
  const athleteKey = profiles
    .map((profile) => `${profile.athleteId}:${profile.bodyMeasurementDate || ''}`)
    .join('|');

  useEffect(() => {
    const next = availableProfiles[0]?.athleteId ?? profiles[0]?.athleteId ?? 0;
    setActiveAthleteId((current) =>
      profiles.some((profile) => profile.athleteId === current) ? current : next
    );
  }, [athleteKey]);

  if (!profiles.length)
    return <ProfileEmpty detail="选择运动员并录入身体成分实测后，这里会生成结构化评估。" />;

  const activeProfile =
    profiles.find((profile) => profile.athleteId === activeAthleteId) ||
    availableProfiles[0] ||
    profiles[0];
  const fatMass =
    activeProfile.weightKg !== null && activeProfile.bodyFatPct !== null
      ? (activeProfile.weightKg * activeProfile.bodyFatPct) / 100
      : null;
  const fatFreeMass =
    activeProfile.weightKg !== null && fatMass !== null ? activeProfile.weightKg - fatMass : null;
  return (
    <div className="body-composition-atlas" aria-label="运动员身体成分结构报告">
      {!individual && (
        <header className="body-atlas-toolbar">
          <label>
            <span>评估对象</span>
            <select
              value={activeProfile.athleteId}
              onChange={(event) => setActiveAthleteId(Number(event.target.value))}
            >
              {profiles.map((profile) => (
                <option key={profile.athleteId} value={profile.athleteId}>
                  {profile.athleteName} · {profile.project}
                </option>
              ))}
            </select>
          </label>
        </header>
      )}
      <div className="body-atlas-grid">
        <section className="body-atlas-panel body-simulation-panel">
          {activeProfile.weightKg !== null && fatMass !== null && fatFreeMass !== null ? (
            <>
              <BodyCompositionSimulation
                profile={activeProfile}
                total={activeProfile.weightKg}
                fatMass={fatMass}
                fatFreeMass={fatFreeMass}
              />
            </>
          ) : (
            <BodyAtlasEmpty detail="需同时录入体重与体脂率后生成成分分层模拟。" />
          )}
        </section>
      </div>
      <p className="body-atlas-note">
        体重、骨骼肌量与体脂率为原始采集字段；脂肪量与去脂体重仅在体重、体脂率齐全时按公式计算。该视图不提供医学判断或训练建议。
      </p>
    </div>
  );
}

function BodyAtlasEmpty({ detail }: { detail: string }) {
  return <p className="body-atlas-empty">{detail}</p>;
}

function LegacyBodyCompositionSimulation({
  total,
  fatMass,
  fatFreeMass,
  skeletalMuscle,
  totalBodyWater,
  segments,
}: {
  total: number;
  fatMass: number;
  fatFreeMass: number;
  skeletalMuscle: number | null;
  totalBodyWater: number | null;
  segments: SegmentMeasure[];
}) {
  const ratio = scaleLinear().domain([0, total]).range([0, 1]).clamp(true);
  const fatRatio = ratio(fatMass);
  const fatFreeRatio = ratio(fatFreeMass);
  const outerScale = 0.84 + fatRatio * 0.42;
  const coreScale = 0.72 + fatFreeRatio * 0.2;
  const rows = [
    ['体重', `${formatNumber(total, 1)} kg`, '实测'],
    [
      '去脂体重',
      `${formatNumber(fatFreeMass, 1)} kg · ${formatNumber(fatFreeRatio * 100, 1)}%`,
      '计算',
    ],
    ['脂肪量', `${formatNumber(fatMass, 1)} kg · ${formatNumber(fatRatio * 100, 1)}%`, '计算'],
    [
      '骨骼肌量',
      skeletalMuscle === null ? '—' : `${formatNumber(skeletalMuscle, 1)} kg`,
      skeletalMuscle === null ? '未采集' : '实测',
    ],
    [
      '总体水',
      totalBodyWater === null ? '—' : `${formatNumber(totalBodyWater, 1)} kg`,
      totalBodyWater === null ? '未采集' : '实测',
    ],
  ];
  const segmentValue = (id: string) => segments.find((segment) => segment.id === id)?.value ?? null;
  const monitors = [
    { id: 'leftArmLeanKg', label: '左上肢', x: 24, y: 132, lineEnd: 184, anchor: 'start' as const },
    { id: 'rightArmLeanKg', label: '右上肢', x: 576, y: 132, lineEnd: 416, anchor: 'end' as const },
    { id: 'trunkLeanKg', label: '躯干', x: 576, y: 202, lineEnd: 372, anchor: 'end' as const },
    { id: 'leftLegLeanKg', label: '左下肢', x: 24, y: 246, lineEnd: 228, anchor: 'start' as const },
    { id: 'rightLegLeanKg', label: '右下肢', x: 576, y: 276, lineEnd: 390, anchor: 'end' as const },
  ];
  return (
    <div className="body-composition-simulation">
      <svg
        viewBox="0 0 600 330"
        role="img"
        aria-label={`身体成分分区监测：体重 ${formatNumber(total, 1)} 千克，${segments.map((segment) => `${segment.label}${segment.value === null ? '未采集' : `${formatNumber(segment.value, 1)}千克`}`).join('，')}`}
      >
        <title>身体成分分区监测模拟图</title>
        <defs>
          <g id="body-sim-person">
            <ellipse cx="0" cy="-115" rx="23" ry="28" />
            <path d="M-16 -90 L16 -90 L20 -66 L-20 -66 Z" />
            <path d="M-20 -69 C-50 -66 -64 -49 -60 -17 L-48 53 C-43 78 -29 91 0 92 C29 91 43 78 48 53 L60 -17 C64 -49 50 -66 20 -69 Z" />
            <path d="M-51 -64 C-72 -52 -82 -28 -82 4 L-76 72 C-75 85 -60 86 -57 74 L-52 16 L-34 -42 Z" />
            <path d="M51 -64 C72 -52 82 -28 82 4 L76 72 C75 85 60 86 57 74 L52 16 L34 -42 Z" />
            <path d="M-38 88 C-42 118 -43 174 -38 212 L-22 212 L-8 112 L-4 92 Z" />
            <path d="M38 88 C42 118 43 174 38 212 L22 212 L8 112 L4 92 Z" />
            <path d="M-39 212 L-52 223 L-20 223 L-18 212 Z" />
            <path d="M39 212 L52 223 L20 223 L18 212 Z" />
          </g>
        </defs>
        <text x="24" y="24" className="body-chart-unit">
          SEGMENTAL LEAN MONITOR · kg
        </text>
        <g transform="translate(300 61)">
          <g
            className="body-sim-silhouette body-sim-fat-shell"
            transform={`scale(${outerScale} 1)`}
          >
            <use href="#body-sim-person" />
          </g>
          <g
            className="body-sim-silhouette body-sim-lean-core"
            transform={`scale(${coreScale} .97)`}
          >
            <use href="#body-sim-person" />
          </g>
          <g className="body-sim-zone-layer">
            <path
              className={`body-sim-zone ${segmentValue('trunkLeanKg') === null ? 'is-missing' : ''}`}
              d="M-20 -69 C-50 -66 -64 -49 -60 -17 L-48 53 C-43 78 -29 91 0 92 C29 91 43 78 48 53 L60 -17 C64 -49 50 -66 20 -69 Z"
            />
            <path
              className={`body-sim-zone ${segmentValue('leftArmLeanKg') === null ? 'is-missing' : ''}`}
              d="M-51 -64 C-72 -52 -82 -28 -82 4 L-76 72 C-75 85 -60 86 -57 74 L-52 16 L-34 -42 Z"
            />
            <path
              className={`body-sim-zone ${segmentValue('rightArmLeanKg') === null ? 'is-missing' : ''}`}
              d="M51 -64 C72 -52 82 -28 82 4 L76 72 C75 85 60 86 57 74 L52 16 L34 -42 Z"
            />
            <path
              className={`body-sim-zone ${segmentValue('leftLegLeanKg') === null ? 'is-missing' : ''}`}
              d="M-38 88 C-42 118 -43 174 -38 212 L-22 212 L-8 112 L-4 92 Z M-39 212 L-52 223 L-20 223 L-18 212 Z"
            />
            <path
              className={`body-sim-zone ${segmentValue('rightLegLeanKg') === null ? 'is-missing' : ''}`}
              d="M38 88 C42 118 43 174 38 212 L22 212 L8 112 L4 92 Z M39 212 L52 223 L20 223 L18 212 Z"
            />
          </g>
          <line x1="0" x2="0" y1="-85" y2="206" className="body-sim-center" />
        </g>
        {monitors.map((monitor) => {
          const value = segmentValue(monitor.id);
          return (
            <g className="body-segment-callout" key={monitor.id}>
              <line
                x1={monitor.anchor === 'start' ? monitor.x + 62 : monitor.x - 62}
                x2={monitor.lineEnd}
                y1={monitor.y}
                y2={monitor.y}
              />
              <text x={monitor.x} y={monitor.y - 5} textAnchor={monitor.anchor}>
                {monitor.label}
              </text>
              <text
                x={monitor.x}
                y={monitor.y + 13}
                textAnchor={monitor.anchor}
                className={value === null ? 'body-chart-missing' : 'body-chart-value'}
              >
                {value === null ? '未采集' : `${formatNumber(value, 1)} kg`}
              </text>
            </g>
          );
        })}
        <text x="300" y="314" textAnchor="middle" className="body-chart-label">
          分区为实测节段去脂量；内层与外层为总体成分比例示意
        </text>
      </svg>
      <dl className="body-chart-mobile-list">
        {[
          ...rows,
          ...segments.map((segment) => [
            segment.label,
            segment.value === null ? '—' : `${formatNumber(segment.value, 1)} kg`,
            segment.value === null ? '未采集' : '实测',
          ]),
        ].map(([label, value, source]) => (
          <div key={label}>
            <dt>
              {label}
              <small>{source}</small>
            </dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

type CompositionMetric = {
  id: string;
  label: string;
  value: number | null;
  unit: string;
};
type MeasuredCompositionMetric = CompositionMetric & { value: number };

type BodyCompositionSimulationDesktopProps = {
  profile: BodyCompositionProfile;
  total: number;
  fatMass: number;
  fatFreeMass: number;
};

function BodyCompositionSimulationDesktop({
  profile,
  total,
  fatMass,
  fatFreeMass,
}: BodyCompositionSimulationDesktopProps) {
  const fatPercent = total > 0 ? (fatMass / total) * 100 : 0;

  const fatFreePercent = total > 0 ? (fatFreeMass / total) * 100 : 0;

  const skeletalMusclePercent =
    total > 0 && profile.skeletalMuscleKg !== null
      ? (profile.skeletalMuscleKg / total) * 100
      : null;

  const bmi = profile.heightCm === null ? null : total / (profile.heightCm / 100) ** 2;

  const secondaryMetrics = [
    {
      id: 'bmi',
      label: 'BMI',
      value: bmi,
      unit: '',
    },
    {
      id: 'bodyFat',
      label: '体脂率',
      value: profile.bodyFatPct,
      unit: '%',
    },
    {
      id: 'totalBodyWater',
      label: '体水分',
      value: profile.totalBodyWaterKg,
      unit: 'kg',
    },
    {
      id: 'muscleMass',
      label: '肌肉量',
      value: profile.muscleMassKg,
      unit: 'kg',
    },
    {
      id: 'basalMetabolism',
      label: '基础代谢',
      value: profile.basalMetabolismKcal,
      unit: 'kcal',
    },
    {
      id: 'visceralFat',
      label: '内脏脂肪等级',
      value: profile.visceralFatLevel,
      unit: '级',
    },
  ].filter((metric): metric is MeasuredCompositionMetric => metric.value !== null);

  const renderCompositionBar = (
    label: string,
    value: number,
    percent: number,
    type: 'lean' | 'fat'
  ) => (
    <div className={`body-comp-card body-comp-bar is-${type}`} key={label}>
      <div className="body-comp-bar-head">
        <span>{label}</span>

        <strong>
          {formatNumber(value, 1)}
          <small> kg</small>
        </strong>
      </div>

      <div className="body-comp-track">
        <div className={`body-comp-fill is-${type}`} style={{ width: `${percent}%` }} />
      </div>

      <div className="body-comp-bar-foot">
        <span>{formatNumber(percent, 1)}%</span>
      </div>
    </div>
  );
  return (
    <div className="body-composition-simulation body-composition-simulation-v3">
      <div className="body-composition-main">
        {/* 左侧：身体成分模拟图 */}
        <div className="body-composition-figure-panel">
          <svg viewBox="0 0 260 420" role="img" aria-label="身体成分结构示意">
            <defs>
              <g id="body-sim-athlete">
                {/* 头部 */}
                <circle cx="130" cy="52" r="26" />

                {/* 颈肩 */}
                <path d="M114 82 L146 82 L154 108 L106 108 Z" />

                {/* 躯干 */}
                <path
                  d="
                M106 106
                C78 114 70 142 78 190
                L88 236
                C94 258 108 268 130 270
                C152 268 166 258 172 236
                L182 190
                C190 142 182 114 154 106
                Z
              "
                />

                {/* 左臂 */}
                <path
                  d="
                M88 118
                C66 134 60 162 66 196
                L74 236
                C76 250 90 250 92 236
                L95 184
                L112 132
                Z
              "
                />

                {/* 右臂 */}
                <path
                  d="
                M172 118
                C194 134 200 162 194 196
                L186 236
                C184 250 170 250 168 236
                L165 184
                L148 132
                Z
              "
                />

                {/* 左腿 */}
                <path
                  d="
                M102 264
                C96 304 96 356 102 404
                L120 404
                L126 292
                L126 270
                Z
              "
                />

                {/* 右腿 */}
                <path
                  d="
                M158 264
                C164 304 164 356 158 404
                L140 404
                L134 292
                L134 270
                Z
              "
                />
              </g>
            </defs>

            {/* 外层：脂肪层 */}
            <use href="#body-sim-athlete" className="body-sim-shell" />

            {/* 内层：去脂主体 */}
            <use
              href="#body-sim-athlete"
              className="body-sim-core"
              transform="translate(20 8) scale(0.84 0.96)"
            />
          </svg>

          <div className="body-sim-legend">
            <span>
              <i className="body-sim-legend-dot is-lean" />
              去脂组织
            </span>

            <span>
              <i className="body-sim-legend-dot is-fat" />
              脂肪组织
            </span>
          </div>
        </div>

        {/* 右侧：身体组成数据 */}
        <div className="body-composition-analysis">
          <div className="body-comp-total">
            <span>体重</span>
            <strong>{formatNumber(total, 1)} kg</strong>
          </div>

          {renderCompositionBar('去脂体重', fatFreeMass, fatFreePercent, 'lean')}

          {renderCompositionBar('脂肪量', fatMass, fatPercent, 'fat')}

          {profile.skeletalMuscleKg !== null && (
            <div className="body-comp-muscle">
              <span>骨骼肌量</span>

              <strong>{formatNumber(profile.skeletalMuscleKg, 1)} kg</strong>

              <small>
                占体重{' '}
                {skeletalMusclePercent === null
                  ? '--'
                  : `${formatNumber(skeletalMusclePercent, 1)}%`}
              </small>
            </div>
          )}
          <dl className="body-composition-secondary-metrics">
            {secondaryMetrics.map((metric) => (
              <div key={metric.id} className="body-comp-metric-card">
                <dt>{metric.label}</dt>
                <dd>
                  {formatNumber(metric.value, 1)}
                  {metric.unit && ` ${metric.unit}`}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      </div>
    </div>
  );
}

function BodyCompositionSimulation({
  profile,
  total,
  fatMass,
  fatFreeMass,
}: {
  profile: BodyCompositionProfile;
  total: number;
  fatMass: number;
  fatFreeMass: number;
}) {
  const bmi = profile.heightCm === null ? null : total / (profile.heightCm / 100) ** 2;

  const fatPercent = total > 0 ? (fatMass / total) * 100 : null;

  const fatFreePercent = total > 0 ? (fatFreeMass / total) * 100 : null;

  const skeletalMusclePercent =
    total > 0 && profile.skeletalMuscleKg !== null
      ? (profile.skeletalMuscleKg / total) * 100
      : null;

  const secondaryMetrics = [
    {
      id: 'bmi',
      label: 'BMI',
      value: bmi,
      unit: '',
    },
    {
      id: 'totalBodyWater',
      label: '体水分',
      value: profile.totalBodyWaterKg,
      unit: 'kg',
    },
    {
      id: 'muscleMass',
      label: '肌肉量',
      value: profile.muscleMassKg,
      unit: 'kg',
    },
    {
      id: 'basalMetabolism',
      label: '基础代谢',
      value: profile.basalMetabolismKcal,
      unit: 'kcal',
    },
    {
      id: 'visceralFat',
      label: '内脏脂肪等级',
      value: profile.visceralFatLevel,
      unit: '级',
    },
  ].filter(
    (
      metric
    ): metric is {
      id: string;
      label: string;
      value: number;
      unit: string;
    } => metric.value !== null
  );

  return (
    <div className="body-composition-simulation-shell">
      <BodyCompositionSimulationDesktop
        profile={profile}
        total={total}
        fatMass={fatMass}
        fatFreeMass={fatFreeMass}
      />

      <dl className="body-composition-mobile-summary">
        {secondaryMetrics.map((metric) => (
          <div key={metric.id}>
            <dt>{metric.label}</dt>

            <dd>
              {formatNumber(metric.value, 1)}
              {metric.unit && ` ${metric.unit}`}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function SegmentalLeanBalance({ segments }: { segments: SegmentMeasure[] }) {
  const measuredSegments = segments.filter(
    (segment): segment is SegmentMeasure & { value: number } => segment.value !== null
  );
  if (!measuredSegments.length)
    return <BodyAtlasEmpty detail="尚未采集左右上肢、躯干或下肢的节段去脂量。" />;
  const height = Math.max(168, 46 + measuredSegments.length * 30);
  const y = scaleBand()
    .domain(measuredSegments.map((segment) => segment.id))
    .range([34, height - 12])
    .padding(0.32);
  const x = scaleLinear()
    .domain([0, Math.max(...measuredSegments.map((segment) => segment.value))])
    .nice()
    .range([0, 228]);
  return (
    <div className="body-segment-chart">
      <svg
        viewBox={`0 0 600 ${height}`}
        role="img"
        aria-label={`节段去脂量：${measuredSegments.map((segment) => `${segment.label}${formatNumber(segment.value, 1)}千克`).join('，')}`}
      >
        <title>节段去脂量</title>
        <line x1="164" x2="164" y1="28" y2={height - 8} className="body-chart-axis" />
        {measuredSegments.map((segment) => {
          const rowY = y(segment.id) || 0;
          const width = x(segment.value);
          return (
            <g key={segment.id}>
              <text
                x="150"
                y={rowY + (y.bandwidth() + 9) / 2}
                textAnchor="end"
                className="body-chart-label"
              >
                {segment.label}
              </text>
              <rect
                x="176"
                y={rowY}
                width={width}
                height={y.bandwidth()}
                rx="4"
                className="body-segment-bar"
              />
              <text x={188 + width} y={rowY + (y.bandwidth() + 9) / 2} className="body-chart-value">
                {formatNumber(segment.value, 1)} kg
              </text>
            </g>
          );
        })}
      </svg>
      <dl className="body-chart-mobile-list">
        {measuredSegments.map((segment) => (
          <div key={segment.id}>
            <dt>{segment.label}</dt>
            <dd>{formatNumber(segment.value, 1)} kg</dd>
          </div>
        ))}
      </dl>
      <p>每行使用同一质量标尺；仅在对应节段已有实测时绘制。</p>
    </div>
  );
}

function BodyCompositionTimeline({ records }: { records: BodyCompositionRecord[] }) {
  const weightRecords = records.filter((record) => record.weightKg !== null);
  if (weightRecords.length < 2)
    return <BodyAtlasEmpty detail="至少需要两次含体重的实测，才会绘制复测轨迹。" />;
  const values = weightRecords.map((record) => record.weightKg as number);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const padding = Math.max(0.5, (max - min) * 0.2);
  const x = scaleLinear()
    .domain([0, weightRecords.length - 1])
    .range([32, 560]);
  const y = scaleLinear()
    .domain([min - padding, max + padding])
    .range([116, 28]);
  const path = weightRecords
    .map((record, index) => `${index ? 'L' : 'M'}${x(index)},${y(record.weightKg as number)}`)
    .join(' ');
  return (
    <div className="body-timeline">
      <svg
        viewBox="0 0 600 146"
        role="img"
        aria-label={`体重复测轨迹，共 ${weightRecords.length} 次；最新 ${formatNumber(values.at(-1) || 0, 1)} 千克`}
      >
        <title>体重复测轨迹</title>
        <line x1="32" x2="560" y1="116" y2="116" className="body-chart-axis" />
        <path d={path} className="body-timeline-line" />
        {weightRecords.map((record, index) => (
          <g key={record.measurementDate}>
            <circle
              cx={x(index)}
              cy={y(record.weightKg as number)}
              r="4"
              className="body-timeline-point"
            />
            <text
              x={x(index)}
              y="136"
              textAnchor={
                index === 0 ? 'start' : index === weightRecords.length - 1 ? 'end' : 'middle'
              }
              className="body-chart-date"
            >
              {record.measurementDate.slice(5)}
            </text>
          </g>
        ))}
        <text x="32" y="18" className="body-chart-unit">
          WEIGHT · kg
        </text>
        <text x="560" y={y(values.at(-1) || 0) - 10} textAnchor="end" className="body-chart-value">
          最新 {formatNumber(values.at(-1) || 0, 1)} kg
        </text>
      </svg>
      <details className="body-timeline-details">
        <summary>复测明细</summary>
        <ol>
          {weightRecords.map((record) => (
            <li key={record.measurementDate}>
              <time>{record.measurementDate}</time>
              <strong>{formatNumber(record.weightKg as number, 1)} kg</strong>
            </li>
          ))}
        </ol>
      </details>
    </div>
  );
}

const chinaProjection = geoMercator().fitExtent(
  [
    [16, 12],
    [544, 398],
  ],
  ChinaData
);
const chinaPath = geoPath(chinaProjection);
const chinaProvincePaths = ChinaData.features.map((feature) => ({
  name: feature.properties?.name || '',
  path: chinaPath(feature) || '',
}));

//输送单位

export function BirthplaceMapOverview({
  profiles,
  individual,
}: {
  profiles: OverviewAthleteProfile[];
  individual: boolean;
}) {
  const available = profiles.filter((profile) => profile.province && profile.province !== '未设置');
  const provinces = useMemo(() => {
    const grouped = new Map<string, OverviewAthleteProfile[]>();
    for (const profile of available)
      grouped.set(profile.province, [...(grouped.get(profile.province) || []), profile]);
    return [...grouped.entries()]
      .map(([province, athletes]) => ({ province, athletes, count: athletes.length }))
      .sort((a, b) => b.count - a.count || a.province.localeCompare(b.province, 'zh-CN'));
  }, [profiles]);
  const [activeProvince, setActiveProvince] = useState('');
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

  const selectProvince = useCallback((province: string) => {
    setActiveProvince((current) => (current === province ? current : province));
  }, []);

  const active = provinces.find((item) => item.province === activeProvince);
  const activeAthletes = (active?.athletes || [])
    .slice()
    .sort(
      (left, right) =>
        left.team.localeCompare(right.team, 'zh-CN') ||
        left.athleteName.localeCompare(right.athleteName, 'zh-CN')
    );
  const cityCounts = [
    ...activeAthletes
      .reduce((map, profile) => {
        const label = [profile.city, profile.county].filter(Boolean).join(' · ') || '城市未设置';
        map.set(label, (map.get(label) || 0) + 1);
        return map;
      }, new Map<string, number>())
      .entries(),
  ].sort((a, b) => b[1] - a[1]);
  const maxCount = Math.max(1, ...provinces.map((item) => item.count));

  if (!profiles.length) return <ProfileEmpty detail="录入运动员籍贯省市后自动生成生源地图。" />;

  return (
    <div
      className="birthplace-map-visual"
      aria-label={individual ? '个人代表和输送单位省份地图' : '队伍代表和输送单位省份分布地图'}
    >
      <div className="birthplace-map-stage">
        <svg viewBox="0 0 560 410" role="img" aria-label="中国省级代表和输送单位分布图">
          <title>
            {individual ? '个人代表和输送单位所在省份' : '队伍运动员代表和输送单位省份分布'}
          </title>
          {chinaProvincePaths.map((province) => {
            const row = provinces.find((item) => item.province === province.name);
            const count = row?.count || 0;
            const activePath = province.name === activeProvince;
            const opacity = count ? 0.28 + (count / maxCount) * 0.6 : 1;
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
                onClick={() => selectProvince(province.name)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    selectProvince(province.name);
                  }
                }}
              />
            );
          })}
        </svg>
        {/* <div className="birthplace-map-legend"><span>少</span><i /><span>多</span><em>滑过省份查看详情</em></div> */}
      </div>

      <aside className="birthplace-detail" aria-live="polite">
        <div className="birthplace-detail-heading">
          <div>
            <span>
              <i />
              实时人数
            </span>
            <strong>
              {activeProvince}
              <em>{active?.count || 0}人</em>
            </strong>
          </div>
          <div>
            <span>
              {individual
                ? '本人来源地'
                : `占有效档案 ${percentage(active?.count || 0, available.length || 1)}%`}
            </span>
            <strong>
              {available.length}
              <small>人总计</small>
            </strong>
          </div>
        </div>
        {active ? (
          <>
            <div className="birthplace-city-list">
              <span>地区分布</span>
              {cityCounts.map(([city, count]) => (
                <div key={city}>
                  <strong>{city}</strong>
                  <em>{count}人</em>
                </div>
              ))}
            </div>
            <div className="birthplace-athlete-list">
              <header>
                <span>{individual ? '本人详细信息' : '运动员详细信息'}</span>
                <small>
                  {activeAthletes.length > 3
                    ? '上下滑动查看全部'
                    : `共 ${activeAthletes.length} 人`}
                </small>
              </header>
              <div
                className="birthplace-athlete-scroll"
                tabIndex={activeAthletes.length > 3 ? 0 : -1}
                aria-label={`${activeProvince}运动员名单，共${activeAthletes.length}人`}
              >
                {activeAthletes.map((profile) => (
                  <div key={profile.athleteId}>
                    <i>{profile.athleteName.slice(0, 1)}</i>
                    <span className="birthplace-athlete-identity">
                      <strong>{individual ? '本人' : profile.athleteName}</strong>
                      <small>
                        {[
                          profile.gender,
                          profile.age === null ? '' : `${profile.age}岁`,
                          profile.project,
                          profile.athletePosition,
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </small>
                    </span>
                    <span className="birthplace-athlete-unit">
                      <strong>{profile.team || '代表单位未设置'}</strong>
                      <small>输送：{profile.originUnit || '未设置'}</small>
                    </span>
                    <span className="birthplace-athlete-result">
                      <small>最好成绩</small>
                      <strong>{profile.bestResult || '暂无记录'}</strong>
                    </span>
                    <span
                      className={`birthplace-athlete-state state-${profile.competitiveLevel || 'none'}`}
                    >
                      <strong>{competitiveStateLabel(profile.competitiveLevel)}</strong>
                      <small>
                        {profile.competitiveScore === null
                          ? '暂无评分'
                          : `${formatNumber(profile.competitiveScore, 1)}分`}
                      </small>
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </>
        ) : (
          <div className="birthplace-detail-empty">
            <strong>暂无生源</strong>
            <span>该省份当前没有权限范围内的运动员记录。</span>
          </div>
        )}
        <p className="birthplace-coverage">
          有效单位省份{' '}
          <strong>
            {available.length}/{profiles.length}
          </strong>{' '}
          · 覆盖省份 <strong>{provinces.length}</strong>
        </p>
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

type LevelPoint = {
  level: string;
  count: number;
  color: string;
  share: number;
};

const LEVEL_ORDER = [
  '国际级运动健将',
  '运动健将',
  '一级运动员',
  '二级运动员',
  '三级运动员',
  '未定级',
] as const;
type TechnicalLevel = (typeof LEVEL_ORDER)[number];

const LEVEL_COLORS: Record<string, string> = {
  国际级运动健将: '#c9a227',
  运动健将: '#2b7d8d',
  一级运动员: '#3d82a5',
  二级运动员: '#67a35c',
  三级运动员: '#a37b5c',
  未定级: '#9aa8ab',
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

function TechnicalLevelTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload?: LevelPoint }>;
}) {
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
        <header>
          <div>
            <h3>竞技水平</h3>
            <p>成绩、技术等级与竞技档案完整度</p>
          </div>
        </header>
        <div className="team-profile-chart-empty">暂无运动员数据</div>
      </section>
    );
  }

  const gradedProfiles = profiles.filter(
    (profile) => normalizeTechnicalLevel(profile.technicalLevel || '') !== '未定级'
  );
  const gradedCount = gradedProfiles.length;

  if (!profiles.length || !gradedCount) {
    return (
      <section className="team-profile-chart-card team-competitive-card">
        <header>
          <div>
            <h3>竞技水平</h3>
            <p>成绩、技术等级与竞技档案完整度</p>
          </div>
        </header>
        <div className="team-profile-chart-empty">暂无运动员数据</div>
      </section>
    );
  }

  const levelCounts = new Map<string, number>();
  for (const profile of gradedProfiles) {
    const level = normalizeTechnicalLevel(profile.technicalLevel || '');
    levelCounts.set(level, (levelCounts.get(level) || 0) + 1);
  }
  const levelData: LevelPoint[] = LEVEL_ORDER.filter((level) => level !== '未定级')
    .map((level) => {
      const count = levelCounts.get(level) || 0;
      return { level, count, color: LEVEL_COLORS[level], share: (count / gradedCount) * 100 };
    })
    .filter((point) => point.count > 0);

  return (
    <section className="team-profile-chart-card team-competitive-card">
      <header>
        <div>
          <h3>竞技水平</h3>
          <p>团队运动员技术等级结构</p>
        </div>
        <span>{profiles.length} 名运动员</span>
      </header>
      <div className="team-competitive-plot-heading">
        <strong>运动员技术等级分布</strong>
        <span>
          已定级 {gradedCount} / {profiles.length} 名
        </span>
      </div>
      <div className="team-profile-level-canvas">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={levelData}
            layout="vertical"
            margin={{ top: 4, right: 28, bottom: 2, left: 4 }}
            barCategoryGap="18%"
          >
            <CartesianGrid stroke="#e3ebed" strokeDasharray="3 5" horizontal={false} />
            <XAxis
              type="number"
              allowDecimals={false}
              tick={{ fontSize: 8, fill: '#74888f' }}
              axisLine={{ stroke: '#cad9dc' }}
              tickLine={false}
              unit="人"
            />
            <YAxis
              type="category"
              dataKey="level"
              tick={{ fontSize: 8, fill: '#506c74', fontWeight: 700 }}
              axisLine={false}
              tickLine={false}
              width={75}
            />
            <Tooltip
              content={<TechnicalLevelTooltip />}
              cursor={{ fill: 'rgba(17,139,131,.055)' }}
            />
            <Bar dataKey="count" name="人数" radius={[0, 3, 3, 0]} minPointSize={2}>
              {levelData.map((entry, index) => (
                <Cell key={`cell-${index}`} fill={entry.color} stroke="#fff" strokeWidth={1} />
              ))}
              <LabelList
                dataKey="count"
                position="right"
                fill="#4c6870"
                fontSize={8}
                fontWeight={800}
                formatter={(value) => `${value ?? 0}人`}
              />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}

function ProfileStat({
  label,
  value,
  unit,
  note,
}: {
  label: string;
  value: string;
  unit: string;
  note: string;
}) {
  return (
    <div>
      <span>{label}</span>
      <strong>
        {value}
        <small>{unit}</small>
      </strong>
      <p>{note}</p>
    </div>
  );
}

function ProfileEmpty({ detail, title = '暂无档案画像数据' }: { detail: string; title?: string }) {
  return (
    <div className="profile-visual-empty">
      <strong>{title}</strong>
      <span>{detail}</span>
    </div>
  );
}
