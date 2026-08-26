import {
  PolarAngleAxis, PolarGrid, PolarRadiusAxis, Radar, RadarChart,
  ResponsiveContainer, Tooltip
} from 'recharts';
import { geoMercator, geoPath } from 'd3-geo';
import ChinaData from 'china-map-geojson/lib/china.js';
import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import type { CompetitiveStateLevel, OverviewAthleteProfile } from '../types';
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

export function AthleteProfileOverview({ profiles, individual }: { profiles: OverviewAthleteProfile[]; individual: boolean }) {
  if (!profiles.length) return <ProfileEmpty detail="完善出生日期和身体测量后自动生成。" />;
  const age = average(profiles.map((profile) => profile.age));
  const height = average(profiles.map((profile) => profile.heightCm));
  const weight = average(profiles.map((profile) => profile.weightKg));
  const bodyCoverage = profiles.filter((profile) => profile.heightCm !== null && profile.weightKg !== null).length;
  const current = profiles[0];
  const weightChange = current.weightKg !== null && current.previousWeightKg !== null
    ? current.weightKg - current.previousWeightKg
    : null;

  return (
    <div className="profile-overview-visual" aria-label={individual ? '个人年龄和身体形态' : '团队年龄和身体形态分布'}>
      <div className="profile-stat-grid">
        <ProfileStat label={individual ? '年龄' : '平均年龄'} value={age === null ? '—' : formatNumber(age, 1)} unit="岁" note={individual ? current.birthDate || '出生日期未录入' : range(profiles.map((item) => item.age), '岁')} />
        <ProfileStat label={individual ? '身高' : '平均身高'} value={height === null ? '—' : formatNumber(height, 1)} unit="cm" note={individual ? current.bodyMeasurementDate || '未测量' : range(profiles.map((item) => item.heightCm), 'cm')} />
        <ProfileStat label={individual ? '体重' : '平均体重'} value={weight === null ? '—' : formatNumber(weight, 1)} unit="kg" note={individual ? (weightChange === null ? '暂无前次对比' : `较前次 ${weightChange >= 0 ? '+' : ''}${formatNumber(weightChange, 1)} kg`) : range(profiles.map((item) => item.weightKg), 'kg')} />
      </div>

      <div className="profile-data-note">
        <span>身体数据覆盖 <strong>{bodyCoverage}/{profiles.length}</strong></span>
        <span>最近测量 <strong>{profiles.map((profile) => profile.bodyMeasurementDate).filter(Boolean).sort().at(-1) || '—'}</strong></span>
        <span>口径 <strong>{individual ? '本人最新快照' : '权限队员均值/范围'}</strong></span>
      </div>
    </div>
  );
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
  const [activeProvince, setActiveProvince] = useState(provinces[0]?.province || '四川');
  const originKey = provinces.map((item) => `${item.province}:${item.count}`).join('|');

  useEffect(() => {
    setActiveProvince(provinces[0]?.province || '四川');
  }, [originKey]);

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
    <div className="birthplace-map-visual" aria-label={individual ? '个人生源地地图' : '队伍生源地省份分布地图'}>
      <div className="birthplace-map-stage">
        <svg viewBox="0 0 560 410" role="img" aria-label="中国省级生源地分布图">
          <title>{individual ? '个人生源地所在省份' : '队伍运动员生源地省份分布'}</title>
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
                onClick={() => setActiveProvince(province.name)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    setActiveProvince(province.name);
                  }
                }}
              />
            );
          })}
        </svg>
        <div className="birthplace-map-legend"><span>少</span><i /><span>多</span><em>点击省份查看详情</em></div>
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
              <header><span>{individual ? '具体生源信息' : '人员基本信息'}</span><small>{activeAthletes.length > 3 ? '上下滑动查看全部' : `共 ${activeAthletes.length} 人`}</small></header>
              <div className="birthplace-athlete-scroll" tabIndex={activeAthletes.length > 3 ? 0 : -1} aria-label={`${activeProvince}运动员名单，共${activeAthletes.length}人`}>
              {activeAthletes.map((profile) => (
                <div key={profile.athleteId}>
                  <i>{profile.athleteName.slice(0, 1)}</i>
                  <span><strong>{individual ? '本人' : profile.athleteName}</strong><small>{[profile.gender, profile.age === null ? '' : `${profile.age}岁`, profile.project].filter(Boolean).join(' · ')}</small></span>
                  <span><strong>{profile.team || '未分队'}</strong><small>{[profile.city, profile.county].filter(Boolean).join(' · ') || '地区未设置'}</small></span>
                  {profile.originIsDemo && <em>演示</em>}
                </div>
              ))}
              </div>
            </div>
          </>
        ) : <div className="birthplace-detail-empty"><strong>暂无生源</strong><span>该省份当前没有权限范围内的运动员记录。</span></div>}
        <p className="birthplace-coverage">有效籍贯 <strong>{available.length}/{profiles.length}</strong> · 来源省份 <strong>{provinces.length}</strong></p>
      </aside>
    </div>
  );
}

const stateMeta: Record<CompetitiveStateLevel, { label: string; color: string }> = {
  peak: { label: '峰值竞技', color: '#118b83' },
  good: { label: '良好竞技', color: '#3d82a5' },
  build: { label: '状态构建', color: '#e2a323' },
  adjust: { label: '调整恢复', color: '#d95b45' }
};

const dimensionMeta = [
  ['endurance', '专项耐力'], ['power', '力量爆发'], ['technique', '技术效率'],
  ['loadAdaptation', '负荷适应'], ['recovery', '恢复能力'], ['competition', '比赛能力']
] as const;

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

function ProfileEmpty({ detail }: { detail: string }) {
  return <div className="profile-visual-empty"><strong>暂无档案画像数据</strong><span>{detail}</span></div>;
}
