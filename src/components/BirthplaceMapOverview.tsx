import ChinaData from 'china-map-geojson/lib/china.js';
import { geoMercator, geoPath } from 'd3-geo';
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { projectLabel } from '../../shared/projects';
import { trainingYearsFromDate } from '../../shared/training-years';
import type { OverviewAthleteProfile } from '../types';
import { percentage } from '../utils';

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

export function BirthplaceMapOverview({
  profiles,
  individual,
  asOf = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai' }).format(new Date()),
}: {
  profiles: OverviewAthleteProfile[];
  individual: boolean;
  asOf?: string;
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

  return (
    <div
      className="birthplace-map-visual"
      aria-label={individual ? '个人代表和输送单位省份地图' : '队伍代表和输送单位省份分布地图'}
    >
      <div className="birthplace-map-stage">
        {!available.length && (
          <p className="app-chart-example birthplace-map-empty-note">暂无真实生源数据</p>
        )}
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
                {activeAthletes.map((profile) => {
                  const years = trainingYearsFromDate(profile.startSportDate, asOf);
                  const trainingYears = years === null ? null : Math.floor(years);
                  return (
                    <div key={profile.athleteId}>
                      <i>{profile.athleteName.slice(0, 1)}</i>
                      <span className="birthplace-athlete-identity">
                        <strong>{individual ? '本人' : profile.athleteName}</strong>
                        <small>
                          {[
                            profile.gender,
                            profile.age === null ? null : `${profile.age}岁`,
                            projectLabel(profile.project),
                          ]
                            .filter(Boolean)
                            .join(' · ')}
                        </small>
                      </span>
                      <span className="birthplace-athlete-info">
                        <small>
                          {[
                            profile.athletePosition || null,
                            profile.heightCm ? `${Math.round(profile.heightCm)}cm` : null,
                            profile.weightKg ? `${Math.round(profile.weightKg)}kg` : null,
                            trainingYears !== null ? `${trainingYears}年` : null,
                          ]
                            .filter(Boolean)
                            .join(' · ') || '—'}
                        </small>
                      </span>
                      <span className="birthplace-athlete-unit">
                        <small>
                          <span className="visually-hidden">代表队伍：</span>
                          {profile.team || '代表单位未设置'}
                        </small>
                      </span>
                      <span className="birthplace-athlete-result">
                        <strong>{profile.bestResult || '—'}</strong>
                        <small>输送：{profile.originUnit || '未设置'}</small>
                      </span>
                    </div>
                  );
                })}
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
