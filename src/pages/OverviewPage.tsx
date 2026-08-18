import { Activity, AlarmClock, ArrowRight, Gauge, Route, UsersRound } from 'lucide-react';
import { useMemo } from 'react';
import type { Athlete, Project, TrainingRecord, User } from '../types';
import { aggregateRecords, average, formatNumber, groupByDate, worstStatus } from '../utils';
import { ROLE_META } from '../../shared/access';
import { DateToolbar } from '../components/DateToolbar';
import { IntensityChart, LoadTrendChart, StructureChart, WaterIntensityLoadChart } from '../components/LoadCharts';
import { StatusPill } from '../components/StatusPill';
import { EditableName } from '../components/EditableName';

type Props = {
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
  onOpenCalendar: () => void;
  user: User;
  onAthleteNameChange: (id: number, name: string) => Promise<void>;
  onUserNameChange: (id: number, name: string) => Promise<void>;
};

export function OverviewPage(props: Props) {
  const summary = useMemo(() => aggregateRecords(props.records), [props.records]);
  const athleteRows = useMemo(() => {
    return props.athletes.map((athlete) => {
      const own = props.records.filter((record) => record.athleteId === athlete.id);
      const latestDate = own.reduce((latest, record) => record.date > latest ? record.date : latest, '');
      const latest = own.filter((record) => record.date === latestDate);
      return {
        athlete,
        status: latest.length ? worstStatus(latest) : 'missing' as const,
        load: own.reduce((sum, record) => sum + record.srpe, 0),
        sleep: average(own.map((record) => record.sleepHours)),
        fatigue: average(own.map((record) => record.fatigueIndex)),
        latestDate
      };
    });
  }, [props.athletes, props.records]);

  const statusCount = useMemo(() => {
    const byDate = groupByDate(props.records);
    const count = { normal: 0, attention: 0, alert: 0, rest: 0, missing: 0 };
    for (const dayRecords of byDate.values()) count[worstStatus(dayRecords)] += 1;
    return count;
  }, [props.records]);

  return (
    <div className="page-content">
      <header className="page-heading">
        <h1>训练总览</h1>
        <DateToolbar {...props} canRenameAthletes={ROLE_META[props.user.role].level > 1} onAthleteNameChange={props.onAthleteNameChange} />
      </header>

      {props.loading ? <PageSkeleton /> : (
        <>
          <section className="metric-grid">
            <Metric icon={<AlarmClock />} label="累计训练时间" value={formatNumber(summary.totalDuration / 60, 1)} unit="小时" note={`${summary.days}个记录日`} tone="navy" />
            <Metric icon={<Route />} label="专项距离" value={formatNumber(summary.totalDistance, 1)} unit="km" note="所选周期合计" tone="teal" />
            <Metric icon={<Gauge />} label="SRPE总负荷" value={formatNumber(summary.totalSrpe)} unit="AU" note="训练时间 × RPE" tone="blue" />
            <Metric icon={<Activity />} label="异常与关注" value={String(summary.alerts + summary.attention)} unit="条" note={`${summary.alerts}条异常记录`} tone="orange" />
          </section>

          <section className="dashboard-grid">
            <article className="panel panel-wide">
              <div className="panel-heading"><div><h2>每日训练负荷</h2></div><small>SRPE · AU</small></div>
              <LoadTrendChart records={props.records} />
            </article>

            <article className="panel status-panel">
              <div className="panel-heading"><div><h2>周期状态</h2></div><button className="text-button" onClick={props.onOpenCalendar}>查看日历 <ArrowRight size={15} /></button></div>
              <div className="status-orbit">
                <div className="orbit-main"><strong>{statusCount.normal}</strong><span>正常日</span></div>
                <div className="orbit-ring" aria-hidden="true" />
              </div>
              <div className="status-counts">
                <div><i className="dot normal" /><span>正常</span><strong>{statusCount.normal}</strong></div>
                <div><i className="dot attention" /><span>关注</span><strong>{statusCount.attention}</strong></div>
                <div><i className="dot alert" /><span>异常</span><strong>{statusCount.alert}</strong></div>
                <div><i className="dot rest" /><span>休息</span><strong>{statusCount.rest}</strong></div>
              </div>
            </article>

            <article className="panel">
              <div className="panel-heading"><div><h2>训练结构</h2></div><small>按训练分钟</small></div>
              <StructureChart records={props.records} />
            </article>

            <article className="panel">
              <div className="panel-heading"><div><h2>强度分布</h2></div><small>U3—ATP</small></div>
              <IntensityChart records={props.records} />
            </article>

            <article className="panel panel-wide water-zone-panel">
              <div className="panel-heading"><div><h2>水上强度距离与时间</h2></div><small>距离 · 时间 · /500m配速</small></div>
              <WaterIntensityLoadChart records={props.records} />
            </article>

            <article className="panel panel-wide roster-preview">
              <div className="panel-heading"><div><h2>运动员状态</h2></div><span className="count-chip"><UsersRound size={14} /> {athleteRows.length}人</span></div>
              <div className="table-scroll">
                <table className="data-table">
                  <thead><tr><th>运动员</th><th>所属地区</th><th>项目 / 组别</th><th>最新状态</th><th>周期SRPE</th><th>平均睡眠</th><th>疲劳指数</th></tr></thead>
                  <tbody>
                    {athleteRows.map((row) => (
                      <tr key={row.athlete.id}>
                        <td>
                          <strong><EditableName value={row.athlete.name} canEdit={ROLE_META[props.user.role].level > 1} onSave={(name) => props.onAthleteNameChange(row.athlete.id, name)} label="运动员姓名" /></strong>
                          {row.athlete.coachUsers?.length ? (
                            <small className="athlete-coach-names">
                              {row.athlete.coachUsers.map((coach) => (
                                <EditableName key={coach.id} value={coach.displayName} canEdit={ROLE_META[props.user.role].level > ROLE_META.SCC.level} onSave={(name) => props.onUserNameChange(coach.id, name)} label="教练姓名" />
                              ))}
                            </small>
                          ) : <small>未绑定教练</small>}
                        </td>
                        <td>{[row.athlete.region, row.athlete.city, row.athlete.county].filter(Boolean).join(' / ') || '未设置'}</td>
                        <td>{row.athlete.project}<small>{row.athlete.team}</small></td>
                        <td><StatusPill status={row.status} compact /></td>
                        <td>{formatNumber(row.load)}</td>
                        <td>{row.sleep ? `${row.sleep.toFixed(1)} h` : '—'}</td>
                        <td>{row.fatigue ? row.fatigue.toFixed(1) : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </article>
          </section>
        </>
      )}
    </div>
  );
}

function Metric({ icon, label, value, unit, note, tone }: { icon: React.ReactNode; label: string; value: string; unit: string; note: string; tone: string }) {
  return (
    <article className={`metric-card tone-${tone}`}>
      <div className="metric-icon">{icon}</div>
      <div className="metric-copy"><span>{label}</span><strong>{value}<small>{unit}</small></strong><p>{note}</p></div>
      <div className="metric-waterline" aria-hidden="true" />
    </article>
  );
}

function PageSkeleton() {
  return <div className="page-skeleton"><div /><div /><div /><div /><section /></div>;
}
