import { ChevronLeft, ChevronRight, Clock3, Gauge, MoonStar, Route, UserRound } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { DateToolbar } from '../components/DateToolbar';
import { EditableName } from '../components/EditableName';
import { StatusPill } from '../components/StatusPill';
import type { Athlete, Project, TrainingRecord, User } from '../types';
import { aggregateRecords, formatDate, formatNumber, groupByDate, statusMeta, toIsoDate, worstStatus } from '../utils';
import { ROLE_META } from '../../shared/access';

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
  user: User;
  onAthleteNameChange: (id: number, name: string) => Promise<void>;
};

export function CalendarPage(props: Props) {
  const [selectedDate, setSelectedDate] = useState(props.to);
  const today = toIsoDate(new Date());
  const monthKey = selectedDate.slice(0, 7);
  const byDate = useMemo(() => groupByDate(props.records), [props.records]);
  const selectedRecords = byDate.get(selectedDate) || [];
  const summary = useMemo(() => aggregateRecords(props.records), [props.records]);

  useEffect(() => {
    if (props.to.slice(0, 7) !== monthKey) setSelectedDate(props.to);
  }, [props.to]);

  const monthCells = useMemo(() => {
    const [year, month] = monthKey.split('-').map(Number);
    const first = new Date(year, month - 1, 1);
    const leading = (first.getDay() + 6) % 7;
    const count = new Date(year, month, 0).getDate();
    const cells: Array<{ date: string; day: number } | null> = Array.from({ length: leading }, () => null);
    for (let day = 1; day <= count; day += 1) cells.push({ date: `${monthKey}-${String(day).padStart(2, '0')}`, day });
    while (cells.length % 7) cells.push(null);
    return cells;
  }, [monthKey]);

  const moveMonth = (amount: number) => {
    const [year, month] = monthKey.split('-').map(Number);
    const target = new Date(year, month - 1 + amount, 1);
    const from = toIsoDate(target);
    const to = toIsoDate(new Date(target.getFullYear(), target.getMonth() + 1, 0));
    setSelectedDate(from);
    props.onRangeChange(from, to);
  };

  return (
    <div className="page-content">
      <header className="page-heading">
        <h1>训练日历</h1>
        <DateToolbar {...props} presetMode="dayWeekMonth" canRenameAthletes={ROLE_META[props.user.role].level > 1} onAthleteNameChange={props.onAthleteNameChange} />
      </header>

      <section className="calendar-summary">
        <div><span>周期训练</span><strong>{formatNumber(summary.totalDuration / 60, 1)}<small>小时</small></strong></div>
        <div><span>专项距离</span><strong>{formatNumber(summary.totalDistance, 1)}<small>km</small></strong></div>
        <div><span>异常记录</span><strong className="danger-text">{summary.alerts}<small>条</small></strong></div>
        <div><span>平均睡眠</span><strong>{summary.avgSleep.toFixed(1)}<small>小时</small></strong></div>
        <div className="calendar-legend">
          {Object.entries(statusMeta).map(([key, meta]) => <span key={key}><i style={{ background: meta.color }} />{meta.short}</span>)}
        </div>
      </section>

      <div className="calendar-layout">
        <section className="calendar-panel">
          <div className="calendar-heading">
            <button className="icon-button" onClick={() => moveMonth(-1)} aria-label="上个月"><ChevronLeft /></button>
            <h2>{monthKey.slice(0, 4)}年 {Number(monthKey.slice(5))}月</h2>
            <button className="icon-button" onClick={() => moveMonth(1)} aria-label="下个月"><ChevronRight /></button>
          </div>
          <div className="weekday-row">{['周一', '周二', '周三', '周四', '周五', '周六', '周日'].map((day) => <span key={day}>{day}</span>)}</div>
          <div className={`calendar-grid ${props.loading ? 'loading-grid' : ''}`}>
            {monthCells.map((cell, index) => {
              if (!cell) return <div className="calendar-cell empty" key={`empty-${index}`} />;
              const dayRecords = byDate.get(cell.date) || [];
              const isFuture = cell.date > today;
              const status = dayRecords.length ? worstStatus(dayRecords) : isFuture ? null : 'missing';
              const load = dayRecords.reduce((sum, record) => sum + record.srpe, 0);
              const isSelected = selectedDate === cell.date;
              return (
                <button key={cell.date} className={`calendar-cell ${isSelected ? 'selected' : ''} ${isFuture ? 'future' : ''}`} onClick={() => setSelectedDate(cell.date)}>
                  <div className="calendar-day"><strong>{cell.day}</strong>{status && <span className={`day-status status-bg-${status}`} title={statusMeta[status].label} />}</div>
                  {dayRecords.length ? (
                    <div className="calendar-data">
                      <span>{dayRecords.length}人记录</span>
                      <strong>{formatNumber(load)}<small> SRPE</small></strong>
                      <div className="mini-status-bars">
                        {(['normal', 'attention', 'alert', 'rest'] as const).map((item) => {
                          const count = dayRecords.filter((record) => record.status === item).length;
                          return count ? <i key={item} className={`status-bg-${item}`} style={{ flex: count }} /> : null;
                        })}
                      </div>
                    </div>
                  ) : <span className="no-data">{isFuture ? '待安排' : '无数据'}</span>}
                </button>
              );
            })}
          </div>
        </section>

        <aside className="day-detail">
          <div className="day-detail-heading"><div><span>当日明细</span><h2>{formatDate(selectedDate)}</h2></div><span className="record-count">{selectedRecords.length}条</span></div>
          {selectedRecords.length ? (
            <div className="day-record-list">
              {selectedRecords.map((record) => (
                <article key={record.id}>
                  <div className="record-top"><div className="record-avatar">{record.athleteName.slice(0, 1)}</div><div><strong><EditableName value={record.athleteName} canEdit={ROLE_META[props.user.role].level > 1} onSave={(name) => props.onAthleteNameChange(record.athleteId, name)} label="运动员姓名" /></strong><small>{record.project} · {record.team}</small></div><StatusPill status={record.status} compact /></div>
                  <h3>{record.trainingType}<small>{record.content || '未填写训练内容'}</small></h3>
                  <div className="record-metrics">
                    <span><Clock3 />{record.durationMin}分钟</span>
                    <span><Route />{record.distanceKm}km</span>
                    <span><Gauge />{record.srpe} SRPE</span>
                    <span><MoonStar />{record.sleepHours ?? '—'}h</span>
                  </div>
                  {record.coachNote && <p className="coach-note">教练备注：{record.coachNote}</p>}
                </article>
              ))}
            </div>
          ) : (
            <div className="empty-state"><UserRound size={32} /><strong>当天没有数据</strong><p>教练上传Excel并确认后，记录会出现在这里。</p></div>
          )}
        </aside>
      </div>
    </div>
  );
}
