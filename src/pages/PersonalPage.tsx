import {
  CalendarRange,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Download,
  FileBarChart2,
  FileClock,
  FlaskConical,
  Gauge,
  LoaderCircle,
  Route,
  ShieldAlert
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { ROWING_MODEL_STANDARD, analyzeRowingPeriod, type RowingPeriodAnalysis } from '../../shared/rowing-model';
import { CANOE_MODEL_STANDARD, analyzeCanoePeriod } from '../../shared/canoe-model';
import { SLALOM_MODEL_STANDARD, analyzeSlalomPeriod } from '../../shared/slalom-model';
import { PROJECT_META, type Project as SharedProject } from '../../shared/projects';
import { api } from '../api';
import { BrandLogo } from '../components/BrandLogo';
import { DateToolbar } from '../components/DateToolbar';
import { InjuryRecoveryModule } from '../components/InjuryRecoveryModule';
import { StrengthProfileModule } from '../components/StrengthProfileModule';
import { exportPdfSheets } from '../pdf/exportPdf';
import type { Athlete, Project, TrainingRecord, User } from '../types';
import { addDays, formatDate, formatNumber, groupByDate } from '../utils';

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
};

type ExportKind = 'summary' | 'log';
type ExportScope = 'day' | 'week';
type ExportJob = {
  key: string;
  kind: ExportKind;
  scope: ExportScope;
  from: string;
  to: string;
  athlete: Athlete;
  records: TrainingRecord[];
  analysis: RowingPeriodAnalysis;
  fileName: string;
};

function monthRange(month: string) {
  const [year, monthNumber] = month.split('-').map(Number);
  const lastDay = new Date(year, monthNumber, 0).getDate();
  return { from: `${month}-01`, to: `${month}-${String(lastDay).padStart(2, '0')}` };
}

function shiftMonth(month: string, offset: number) {
  const [year, monthNumber] = month.split('-').map(Number);
  const date = new Date(year, monthNumber - 1 + offset, 1, 12);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function calendarDates(month: string) {
  const { from } = monthRange(month);
  const first = new Date(`${from}T12:00:00`);
  const mondayOffset = (first.getDay() + 6) % 7;
  const start = addDays(from, -mondayOffset);
  return Array.from({ length: 42 }, (_, index) => addDays(start, index));
}

export function PersonalPage(props: Props) {
  const exportStageRef = useRef<HTMLDivElement>(null);
  const [exportJob, setExportJob] = useState<ExportJob | null>(null);
  const [exportingKey, setExportingKey] = useState('');
  const [exportError, setExportError] = useState('');
  const [calendarMonth, setCalendarMonth] = useState(() => props.to.slice(0, 7));
  const [calendarSelection, setCalendarSelection] = useState<{ scope: ExportScope; key: string } | null>(null);
  const selectedAthlete = useMemo(
    () => props.athletes.find((athlete) => athlete.id === (props.athleteId || props.user.athleteId)) || null,
    [props.athletes, props.athleteId, props.user.athleteId]
  );
  const selectedRecords = useMemo(
    () => selectedAthlete ? props.records.filter((record) => record.athleteId === selectedAthlete.id) : [],
    [props.records, selectedAthlete]
  );
  const analyzePeriod = analyzerForProject(selectedAthlete?.project || props.project);
  const modelStandard = standardForProject(selectedAthlete?.project || props.project);
  const rangeAnalysis = useMemo(() => analyzePeriod(selectedRecords), [selectedRecords, analyzePeriod]);

  const days = useMemo(() => {
    const grouped = groupByDate(selectedRecords);
    return [...grouped.entries()]
      .sort(([left], [right]) => right.localeCompare(left))
      .map(([date, records]) => ({ date, records, analysis: analyzePeriod(records) }));
  }, [selectedRecords, analyzePeriod]);

  const dayMap = useMemo(() => new Map(days.map((day) => [day.date, day])), [days]);
  const calendarRows = useMemo(() => {
    const dates = calendarDates(calendarMonth);
    return Array.from({ length: 6 }, (_, index) => dates.slice(index * 7, index * 7 + 7));
  }, [calendarMonth]);
  const effectiveSelection = useMemo(() => {
    if (calendarSelection?.scope === 'day') {
      const day = dayMap.get(calendarSelection.key);
      if (day) return { scope: 'day' as const, from: day.date, to: day.date, records: day.records, analysis: day.analysis };
    }
    if (calendarSelection?.scope === 'week') {
      const from = calendarSelection.key;
      const to = addDays(from, 6);
      const records = selectedRecords.filter((record) => record.date >= from && record.date <= to);
      return { scope: 'week' as const, from, to, records, analysis: analyzePeriod(records) };
    }
    const latestDay = days.find((day) => day.date.startsWith(calendarMonth));
    if (latestDay) return { scope: 'day' as const, from: latestDay.date, to: latestDay.date, records: latestDay.records, analysis: latestDay.analysis };
    return null;
  }, [calendarMonth, calendarSelection, dayMap, days, selectedRecords, analyzePeriod]);

  useEffect(() => {
    const nextMonth = props.to.slice(0, 7);
    if (/^\d{4}-\d{2}$/.test(nextMonth)) setCalendarMonth(nextMonth);
  }, [props.to]);

  useEffect(() => {
    if (!exportJob || !exportStageRef.current) return;
    let cancelled = false;
    const run = async () => {
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      if (cancelled || !exportStageRef.current) return;
      try {
        await exportPdfSheets(exportStageRef.current, exportJob.fileName, '齐总');
      } catch (error) {
        setExportError(error instanceof Error ? error.message : 'PDF生成失败。');
      } finally {
        if (!cancelled) {
          setExportJob(null);
          setExportingKey('');
        }
      }
    };
    void run();
    return () => { cancelled = true; };
  }, [exportJob]);

  const beginExport = async (scope: ExportScope, kind: ExportKind, from: string, to: string) => {
    if (!selectedAthlete) return;
    const key = `${scope}-${kind}-${from}`;
    setExportingKey(key);
    setExportError('');
    try {
      const [{ records }, { analysis }] = await Promise.all([
        api.records(from, to, selectedAthlete.id, selectedAthlete.project as SharedProject),
        api.analysisSummary(from, to, selectedAthlete.id, selectedAthlete.project as SharedProject)
      ]);
      const title = scope === 'week'
        ? kind === 'summary' ? '周训练总结' : '周训练日志'
        : kind === 'summary' ? '日训练总结' : '日训练日志';
      setExportJob({
        key,
        kind,
        scope,
        from,
        to,
        athlete: selectedAthlete,
        records,
        analysis,
        fileName: `${selectedAthlete.name}_${title}_${from}${scope === 'week' ? `_至_${to}` : ''}`
      });
    } catch (error) {
      setExportError(error instanceof Error ? error.message : '无法读取导出数据。');
      setExportingKey('');
    }
  };

  const moveCalendarMonth = (offset: number) => {
    const nextMonth = shiftMonth(calendarMonth, offset);
    const range = monthRange(nextMonth);
    setCalendarMonth(nextMonth);
    setCalendarSelection(null);
    props.onRangeChange(range.from, range.to);
  };

  return (
    <div className="page-content personal-page">
      <header className="page-heading">
        <div>
          <h1>个人档案</h1>
          <p>按周、按日生成总结和原始训练日志</p>
        </div>
        <DateToolbar {...props} />
      </header>

      {!selectedAthlete ? (
        <section className="personal-empty">
          <CalendarRange size={34} />
          <strong>先选择一名运动员</strong>
          <p>在右上角选择运动员后，可查看分级结果并下载个人PDF。</p>
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
              <p>{selectedAthlete.province}{selectedAthlete.city}{selectedAthlete.county} · 教练 {selectedAthlete.coaches || '未绑定'}</p>
            </div>
            <div className="personal-grade" style={{ '--grade-color': rangeAnalysis.status.color } as CSSProperties}>
              <span>当前分级</span>
              <strong>{rangeAnalysis.status.label}</strong>
              <small>{rangeAnalysis.status.basis}</small>
            </div>
          </section>

          <section className="personal-metric-grid">
            <PersonalMetric icon={Gauge} label="本期负荷" value={formatNumber(rangeAnalysis.totalSrpe)} unit="SRPE" />
            <PersonalMetric icon={Route} label="专项距离" value={formatNumber(rangeAnalysis.totalDistanceKm, 1)} unit="km" />
            <PersonalMetric icon={CalendarRange} label="训练日" value={String(rangeAnalysis.trainingDays)} unit="天" />
            <PersonalMetric icon={CheckCircle2} label="数据完整率" value={formatNumber(rangeAnalysis.dataCoverage, 1)} unit="%" />
          </section>

          <InjuryRecoveryModule athlete={selectedAthlete} user={props.user} />

          <StrengthProfileModule athlete={selectedAthlete} user={props.user} />

          <section className="model-standard-card">
            <div className="model-standard-heading">
              <div><FlaskConical size={20} /><span><strong>{selectedAthlete.project}分析标准</strong><small>{modelStandard.version}</small></span></div>
              <span className="standard-decision">{modelStandard.decision}</span>
            </div>
            <div className="model-standard-body">
              <div className="zone-strip">
                {modelStandard.zones.map((zone) => (
                  <span key={zone.key} className={zone.key === 'practice' ? 'pending' : ''}>
                    <i style={{ background: zone.color }} />
                    <strong>{zone.label}</strong>
                    <small>{zone.key === 'practice' ? '待确认阈值' : '已接入'}</small>
                  </span>
                ))}
              </div>
              <div className="latest-model-list">
                {modelStandard.latestAdditions.map((item) => (
                  <article key={item.shortLabel}>
                    <span>{item.status}</span>
                    <strong>{item.shortLabel}</strong>
                    <p>{item.usage}</p>
                  </article>
                ))}
              </div>
              <p className="model-note"><ShieldAlert size={15} />未测试项目不记0分；Wingate、左右差、生化星级、Z-Score和综合权重继续等待专家确认。</p>
            </div>
          </section>

          {exportError && <div className="global-error">{exportError}</div>}

          <section className="personal-calendar-section">
            <header className="calendar-command-bar">
              <div>
                <span>TRAINING CALENDAR</span>
                <h2>训练日历与报告</h2>
                <p>点击日期查看日报，点击左侧周次查看整周报告。</p>
              </div>
              <div className="calendar-month-switcher">
                <button type="button" aria-label="上个月" onClick={() => moveCalendarMonth(-1)}><ChevronLeft size={18} /></button>
                <strong>{calendarMonth.slice(0, 4)}年 {Number(calendarMonth.slice(5))}月</strong>
                <button type="button" aria-label="下个月" onClick={() => moveCalendarMonth(1)}><ChevronRight size={18} /></button>
              </div>
            </header>

            <div className="training-calendar-layout">
              <div className="training-calendar-board">
                <div className="calendar-weekdays"><span>周</span>{['一', '二', '三', '四', '五', '六', '日'].map((label) => <b key={label}>周{label}</b>)}</div>
                <div className="personal-calendar-grid">
                  {calendarRows.map((row, rowIndex) => {
                    const weekFrom = row[0];
                    const weekTo = row[6];
                    const weekRecords = selectedRecords.filter((record) => record.date >= weekFrom && record.date <= weekTo);
                    const weekAnalysis = analyzePeriod(weekRecords);
                    const weekSelected = effectiveSelection?.scope === 'week' && effectiveSelection.from === weekFrom;
                    return (
                      <div className="calendar-week-row" key={weekFrom}>
                        <button type="button" className={`calendar-week-rail ${weekSelected ? 'selected' : ''}`} onClick={() => setCalendarSelection({ scope: 'week', key: weekFrom })}>
                          <small>W{rowIndex + 1}</small><strong>{weekRecords.length ? weekAnalysis.sessions : '—'}</strong><span>{weekRecords.length ? '课' : '空'}</span>
                        </button>
                        {row.map((date) => {
                          const day = dayMap.get(date);
                          const inMonth = date.startsWith(calendarMonth);
                          const selected = effectiveSelection?.scope === 'day' && effectiveSelection.from === date;
                          return (
                            <button
                              type="button"
                              key={date}
                              disabled={!inMonth}
                              className={`personal-calendar-day ${inMonth ? '' : 'outside'} ${day ? 'has-data' : ''} ${selected ? 'selected' : ''}`}
                              style={day ? { '--day-color': day.analysis.status.color } as CSSProperties : undefined}
                              onClick={() => setCalendarSelection({ scope: 'day', key: date })}
                            >
                              <span>{Number(date.slice(-2))}</span>
                              {day ? <><i /><strong>{day.analysis.sessions}课</strong><small>{formatNumber(day.analysis.totalSrpe)} SRPE</small></> : <small className="calendar-rest">无训练</small>}
                            </button>
                          );
                        })}
                      </div>
                    );
                  })}
                </div>
                <footer className="calendar-legend">
                  {modelStandard.zones.map((zone) => <span key={zone.key}><i style={{ background: zone.color }} />{zone.label}</span>)}
                  <small>{days.filter((day) => day.date.startsWith(calendarMonth)).length}个训练日</small>
                </footer>
              </div>

              <aside className="calendar-report-dock">
                {effectiveSelection ? (
                  <>
                    <div className="report-dock-date">
                      <span>{effectiveSelection.scope === 'week' ? 'WEEK REPORT' : 'DAY REPORT'}</span>
                      <strong>{effectiveSelection.scope === 'week' ? `${effectiveSelection.from.slice(5).replace('-', '.')} — ${effectiveSelection.to.slice(5).replace('-', '.')}` : formatDate(effectiveSelection.from)}</strong>
                      <small>{effectiveSelection.scope === 'week' ? '整周训练统计' : new Date(`${effectiveSelection.from}T12:00:00`).toLocaleDateString('zh-CN', { weekday: 'long' })}</small>
                    </div>
                    <div className="report-dock-grade" style={{ '--grade-color': effectiveSelection.analysis.status.color } as CSSProperties}>
                      <span>训练状态</span><strong>{effectiveSelection.records.length ? effectiveSelection.analysis.status.label : '无训练数据'}</strong>
                    </div>
                    <div className="report-dock-metrics">
                      <div><span>训练课次</span><strong>{effectiveSelection.analysis.sessions}<small>课</small></strong></div>
                      <div><span>专项距离</span><strong>{formatNumber(effectiveSelection.analysis.totalDistanceKm, 1)}<small>km</small></strong></div>
                      <div><span>训练负荷</span><strong>{formatNumber(effectiveSelection.analysis.totalSrpe)}<small>SRPE</small></strong></div>
                      <div><span>数据完整率</span><strong>{formatNumber(effectiveSelection.analysis.dataCoverage, 1)}<small>%</small></strong></div>
                    </div>
                    <div className="report-dock-actions">
                      <ExportButton
                        busy={exportingKey === `${effectiveSelection.scope}-summary-${effectiveSelection.from}`}
                        icon={FileBarChart2}
                        label={effectiveSelection.scope === 'week' ? '下载周训练总结' : '下载日总结'}
                        onClick={() => beginExport(effectiveSelection.scope, 'summary', effectiveSelection.from, effectiveSelection.to)}
                      />
                      <ExportButton
                        busy={exportingKey === `${effectiveSelection.scope}-log-${effectiveSelection.from}`}
                        icon={FileClock}
                        label={effectiveSelection.scope === 'week' ? '下载周日志' : '下载训练日志'}
                        onClick={() => beginExport(effectiveSelection.scope, 'log', effectiveSelection.from, effectiveSelection.to)}
                      />
                    </div>
                  </>
                ) : (
                  <div className="calendar-report-empty"><CalendarRange size={30} /><strong>本月暂无训练数据</strong><p>可以切换月份查看历史记录。</p></div>
                )}
              </aside>
            </div>
          </section>
        </>
      )}

      {exportJob && (
        <div className="pdf-export-stage" ref={exportStageRef} aria-hidden="true">
          <PersonalPdfDocument job={exportJob} />
        </div>
      )}
    </div>
  );
}

function PersonalMetric({ icon: Icon, label, value, unit }: { icon: typeof Gauge; label: string; value: string; unit: string }) {
  return <article><Icon size={19} /><span>{label}</span><strong>{value}<small>{unit}</small></strong></article>;
}

function ExportButton({ busy, icon: Icon, label, onClick }: { busy: boolean; icon: typeof Download; label: string; onClick: () => void }) {
  return <button className="secondary-button" disabled={busy} onClick={onClick}>
    {busy ? <LoaderCircle className="spin" size={16} /> : <Icon size={16} />}
    {busy ? '生成中…' : label}
  </button>;
}

function PersonalPdfDocument({ job }: { job: ExportJob }) {
  const title = job.scope === 'week'
      ? job.kind === 'summary' ? '周训练总结' : '周训练日志'
    : job.kind === 'summary' ? '日训练总结' : '日训练日志';
  if (job.kind === 'summary') {
    return <SummarySheet job={job} title={title} />;
  }
  const pages = chunk(job.records, 7);
  return <>{(pages.length ? pages : [[]]).map((records, index) => (
    <LogSheet key={index} job={job} title={title} records={records} page={index + 1} total={Math.max(1, pages.length)} />
  ))}</>;
}

function PdfHeader({ title, job, page }: { title: string; job: ExportJob; page: string }) {
  return <header className="personal-pdf-header">
    <div className="personal-pdf-brand"><BrandLogo className="print" /><span><strong>竞迹</strong><small>JINGJI PERFORMANCE</small></span></div>
    <div><span>{PROJECT_META[job.athlete.project as SharedProject]?.report || 'PERFORMANCE REPORT'}</span><h1>{title}</h1><p>{formatDate(job.from)}{job.from !== job.to ? ` — ${formatDate(job.to)}` : ''}</p></div>
    <strong>{page}</strong>
  </header>;
}

function SummarySheet({ job, title }: { job: ExportJob; title: string }) {
  const daily = [...groupByDate(job.records).entries()].sort(([left], [right]) => left.localeCompare(right));
  return <article className="personal-pdf-sheet summary-sheet">
    <PdfHeader title={title} job={job} page="01 / 01" />
    <section className="pdf-athlete-hero">
      <div><span>{job.athlete.project} · {job.athlete.team}</span><h2>{job.athlete.name}</h2><p>{job.athlete.province}{job.athlete.city}{job.athlete.county}</p></div>
      <div style={{ '--grade-color': job.analysis.status.color } as CSSProperties}><span>周期状态</span><strong>{job.analysis.status.label}</strong><small>{job.analysis.status.basis}</small></div>
    </section>
    <section className="pdf-kpi-grid">
      <PdfMetric label="训练课次" value={String(job.analysis.sessions)} unit="课" />
      <PdfMetric label="训练时间" value={formatNumber(job.analysis.totalDurationMin / 60, 1)} unit="小时" />
      <PdfMetric label="专项距离" value={formatNumber(job.analysis.totalDistanceKm, 1)} unit="km" />
      <PdfMetric label="周期负荷" value={formatNumber(job.analysis.totalSrpe)} unit="SRPE" />
      <PdfMetric label="平均RPE" value={nullable(job.analysis.averageRpe, 1)} unit="" />
      <PdfMetric label="数据完整率" value={formatNumber(job.analysis.dataCoverage, 1)} unit="%" />
    </section>
    <section className="pdf-analysis-grid">
      <div>
        <PdfSectionTitle index="01" title="训练结构" />
        <DistributionRows rows={job.analysis.distributions.trainingTypes} />
      </div>
      <div>
        <PdfSectionTitle index="02" title="强度分布" />
        <DistributionRows rows={job.analysis.distributions.intensityZones} />
      </div>
    </section>
    <section className="pdf-daily-section">
      <PdfSectionTitle index="03" title="日负荷与恢复" />
      <table><thead><tr><th>日期</th><th>课次</th><th>时间</th><th>距离</th><th>SRPE</th><th>睡眠</th><th>疲劳</th><th>状态</th></tr></thead>
        <tbody>{daily.slice(0, 7).map(([date, records]) => {
          const analysis = analyzeForProject(job.athlete.project, records);
          return <tr key={date}><td>{date.slice(5)}</td><td>{analysis.sessions}</td><td>{formatNumber(analysis.totalDurationMin)}min</td><td>{formatNumber(analysis.totalDistanceKm, 1)}km</td><td>{formatNumber(analysis.totalSrpe)}</td><td>{nullable(analysis.averageSleepHours, 1)}</td><td>{nullable(analysis.averageFatigueIndex, 1)}</td><td><i style={{ background: analysis.status.color }} />{analysis.status.label}</td></tr>;
        })}</tbody>
      </table>
      {!daily.length && <p className="pdf-no-data">本期没有训练记录。</p>}
    </section>
    <section className="pdf-recovery-grid">
      <div><PdfSectionTitle index="04" title="恢复指标" /><dl><div><dt>平均晨脉</dt><dd>{nullable(job.analysis.averageMorningPulse, 0)}</dd></div><div><dt>平均睡眠</dt><dd>{nullable(job.analysis.averageSleepHours, 1)} h</dd></div><div><dt>平均疲劳</dt><dd>{nullable(job.analysis.averageFatigueIndex, 1)}</dd></div><div><dt>平均体重</dt><dd>{nullable(job.analysis.averageWeightKg, 1)} kg</dd></div></dl></div>
      <div><PdfSectionTitle index="05" title="教练建议" /><ul>{job.analysis.recommendations.map((item) => <li key={item}>{item}</li>)}</ul></div>
    </section>
    <section className="pdf-standard-note"><strong>分级依据</strong><p>{standardForProject(job.athlete.project).version}：{job.athlete.project === '激流' ? '采用激流独立训练负荷与冠军模型口径，未测试不记0分；男女参考区间分开比较。' : job.athlete.project === '皮划艇' ? '采用皮划艇独立训练负荷口径，未测试不记0分；专项技术阈值须由皮划艇教练确认。' : '采用赛艇独立分析口径，未测试不记0分；专项权重须经赛艇专家确认。'}</p></section>
    <PdfFooter project={job.athlete.project} />
  </article>;
}

function LogSheet({ job, title, records, page, total }: { job: ExportJob; title: string; records: TrainingRecord[]; page: number; total: number }) {
  return <article className="personal-pdf-sheet log-sheet">
    <PdfHeader title={title} job={job} page={`${String(page).padStart(2, '0')} / ${String(total).padStart(2, '0')}`} />
    <section className="pdf-log-meta"><div><span>运动员</span><strong>{job.athlete.name}</strong></div><div><span>项目 / 队伍</span><strong>{job.athlete.project} / {job.athlete.team}</strong></div><div><span>记录范围</span><strong>{job.from === job.to ? formatDate(job.from) : `${job.from} 至 ${job.to}`}</strong></div></section>
    <section className="pdf-log-list">
      {records.map((record, index) => <article key={record.id}>
        <div className="pdf-log-number">{String((page - 1) * 7 + index + 1).padStart(2, '0')}</div>
        <div className="pdf-log-main"><span>{record.date} · {record.trainingType} · {record.intensityZone}</span><h3>{record.content || '未填写训练内容'}</h3><p>{record.coachNote ? `教练备注：${record.coachNote}` : '教练备注：未填写'}</p></div>
        <div className="pdf-log-metrics"><span><b>{record.durationMin}</b>分钟</span><span><b>{formatNumber(record.distanceKm, 1)}</b>km</span><span><b>{record.rpe ?? '未测试'}</b>RPE</span><span><b>{formatNumber(record.srpe)}</b>SRPE</span><span><b>{record.sleepHours ?? '未测试'}</b>睡眠(h)</span><span><b>{record.fatigueIndex ?? '未测试'}</b>疲劳</span></div>
        <span className="pdf-log-status" style={{ '--grade-color': statusColor(record.status) } as CSSProperties}>{statusLabel(record.status)}</span>
      </article>)}
      {!records.length && <p className="pdf-no-data">本期没有训练记录。</p>}
    </section>
    <section className="pdf-log-statement"><strong>数据说明</strong><p>本日志按系统原始训练记录生成；缺失字段显示“未测试”，不补零、不推算。数据修改记录以后台审计日志为准。</p></section>
    <PdfFooter project={job.athlete.project} />
  </article>;
}

function PdfMetric({ label, value, unit }: { label: string; value: string; unit: string }) {
  return <div><span>{label}</span><strong>{value}</strong><small>{unit}</small></div>;
}

function PdfSectionTitle({ index, title }: { index: string; title: string }) {
  return <div className="pdf-section-title"><span>{index}</span><h2>{title}</h2></div>;
}

function DistributionRows({ rows }: { rows: RowingPeriodAnalysis['distributions']['trainingTypes'] }) {
  return <div className="pdf-distribution-rows">{rows.slice(0, 4).map((row) => <div key={row.label}><span>{row.label}</span><i><b style={{ width: `${row.ratio}%` }} /></i><strong>{row.ratio}%</strong></div>)}{!rows.length && <p>未测试</p>}</div>;
}

function PdfFooter({ project }: { project: string }) {
  return <footer className="personal-pdf-footer"><span>竞迹 · {project}训练数据中心</span><span>水印：齐总</span><span>{standardForProject(project).version}</span></footer>;
}

function analyzeForProject(project: string, records: Parameters<typeof analyzeRowingPeriod>[0]) {
  return analyzerForProject(project)(records);
}

function standardForProject(project: string) {
  return project === '激流' ? SLALOM_MODEL_STANDARD : project === '皮划艇' ? CANOE_MODEL_STANDARD : ROWING_MODEL_STANDARD;
}

function analyzerForProject(project: string) {
  return project === '激流' ? analyzeSlalomPeriod : project === '皮划艇' ? analyzeCanoePeriod : analyzeRowingPeriod;
}

function nullable(value: number | null, digits: number) {
  return value === null ? '未测试' : formatNumber(value, digits);
}

function statusLabel(status: TrainingRecord['status']) {
  return { normal: '目标区', attention: '可改善区', alert: '预警区', rest: '恢复', missing: '未评级' }[status];
}

function statusColor(status: TrainingRecord['status']) {
  return { normal: '#1a9b83', attention: '#d9a326', alert: '#d94a3d', rest: '#778b93', missing: '#778b93' }[status];
}

function chunk<T>(rows: T[], size: number) {
  return Array.from({ length: Math.ceil(rows.length / size) }, (_, index) => rows.slice(index * size, (index + 1) * size));
}
