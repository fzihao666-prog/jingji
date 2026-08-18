import { Activity, Gauge, Trophy } from 'lucide-react';
import { useMemo, type CSSProperties } from 'react';
import { SLALOM_CHAMPION_METRICS, slalomComparison } from '../../shared/slalom-model';
import type { Athlete, StrengthTest } from '../types';
import { formatNumber } from '../utils';

type Props = {
  athlete: Athlete;
  test: StrengthTest;
};

const statusMeta = {
  target: { label: '冠军区间', color: '#168f8a' },
  improve: { label: '接近区间', color: '#d9a326' },
  practice: { label: '重点补强', color: '#e87a35' },
  missing: { label: '未测试', color: '#87979d' },
  'no-standard': { label: '暂无同性别标准', color: '#87979d' }
} as const;

export function SlalomChampionComparison({ athlete, test }: Props) {
  const rows = useMemo(() => SLALOM_CHAMPION_METRICS.map((metric) => ({
    metric,
    comparison: slalomComparison(metric, test.metrics, athlete.gender)
  })), [athlete.gender, test.metrics]);
  const comparable = rows.filter((row) => row.comparison.range && row.comparison.percent !== null);
  const targetCount = comparable.filter((row) => row.comparison.status === 'target').length;
  const completion = comparable.length ? Math.round(targetCount / comparable.length * 100) : 0;
  const groups = [...new Set(rows.map((row) => row.metric.group))];

  return <section className="slalom-champion-card">
    <header className="slalom-champion-heading">
      <div className="slalom-champion-title"><Trophy size={22} /><span><small>CANOE SLALOM CHAMPION MODEL</small><strong>激流回旋冠军模型对比</strong></span></div>
      <div className="slalom-champion-summary">
        <span><b>{athlete.gender || '未设置性别'}</b>参考标准</span>
        <strong>{targetCount}<small> / {comparable.length} 项达到冠军区间</small></strong>
        <i><b style={{ width: `${completion}%` }} /></i>
      </div>
    </header>

    <div className="slalom-champion-note"><Activity size={16} /><span>实测数据来自本次力量测试档案；卧推、卧拉相对力量由实测重量 ÷ 体重自动计算。未测试项目不记0分。</span></div>

    <div className="slalom-comparison-groups">
      {groups.map((group) => <section key={group} className="slalom-comparison-group">
        <h3>{group}</h3>
        <div className="slalom-comparison-grid">
          {rows.filter((row) => row.metric.group === group).map(({ metric, comparison }) => {
            const meta = statusMeta[comparison.status];
            const percent = comparison.percent === null ? 0 : Math.min(120, comparison.percent);
            return <article key={metric.key} style={{ '--champion-color': meta.color } as CSSProperties}>
              <div className="slalom-metric-copy">
                <span>{metric.label}</span>
                <strong>{comparison.value === null ? '未测试' : `${formatNumber(comparison.value, metric.unit.includes('倍') || metric.unit.includes('/kg') ? 2 : 1)} ${metric.unit}`}</strong>
                <small>{comparison.range ? `冠军参考 ${comparison.range[0]}—${comparison.range[1]} ${metric.unit}` : '该性别暂无参考区间'}</small>
              </div>
              <div className="slalom-metric-progress"><i><b style={{ width: `${percent / 1.2}%` }} /></i><span>{comparison.percent === null ? '—' : `${formatNumber(comparison.percent, 1)}%`}</span></div>
              <em>{meta.label}</em>
            </article>;
          })}
        </div>
      </section>)}
    </div>

    <footer><Gauge size={15} /><span>参考来源：用户提供的《ICF 国际奖牌运动员体能测试数据》；区间用于个人训练对比，不与赛艇、皮划艇模型混用。</span></footer>
  </section>;
}
