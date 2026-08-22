import {
  CalendarDays,
  Database,
  Download,
  FileImage,
  FileText,
  ImagePlus,
  LoaderCircle,
  PenLine,
  Printer,
  X
} from 'lucide-react';
import { useMemo, useRef, useState, type ChangeEvent, type CSSProperties } from 'react';
import { BrandLogo } from '../components/BrandLogo';
import { DateToolbar } from '../components/DateToolbar';
import type { Athlete, Project, TrainingBreakdown, TrainingRecord, TrainingStatus, User } from '../types';
import { aggregateRecords, average, formatDate, formatNumber, percentage, statusMeta, worstStatus } from '../utils';

type Props = {
  user: User;
  project: Project;
  projects: Project[];
  records: TrainingRecord[];
  athletes: Athlete[];
  from: string;
  to: string;
  athleteId: number | null;
  loading: boolean;
  onRangeChange: (from: string, to: string) => void;
  onAthleteChange: (athleteId: number | null) => void;
  onProjectChange: (project: Project) => void;
};

type DistributionRow = { label: string; amount: number; ratio: number };
type ReportPhoto = { name: string; url: string };
type DailySummary = {
  date: string;
  records: TrainingRecord[];
  duration: number;
  distance: number;
  srpe: number;
  smvl: number;
  waterDuration: number;
  landDuration: number;
  status: TrainingStatus;
  contentGroups: Array<{ athletes: string[]; content: string }>;
  types: string[];
  zones: string[];
};
type ChartBucket = {
  label: string;
  sublabel: string;
  duration: number;
  distance: number;
  srpe: number;
};

const reportColors = ['#0d6fac', '#1fa99c', '#e55a42', '#e7a82e', '#7357a7', '#4b8192', '#91b65b'];

export function ReportPage(props: Props) {
  const reportRef = useRef<HTMLDivElement>(null);
  const [exporting, setExporting] = useState(false);
  const [trainingPhase, setTrainingPhase] = useState('阶段训练周期');
  const [trainingLocation, setTrainingLocation] = useState('训练基地');
  const [customSummary, setCustomSummary] = useState('');
  const [customFocus, setCustomFocus] = useState('');
  const [photos, setPhotos] = useState<ReportPhoto[]>([]);

  const selectedAthlete = props.athletes.find((athlete) => athlete.id === props.athleteId);
  const periodRecords = useMemo(
    () => props.records
      .filter((record) => record.date >= props.from && record.date <= props.to)
      .filter((record) => !props.athleteId || record.athleteId === props.athleteId)
      .sort((a, b) => a.date.localeCompare(b.date) || a.athleteName.localeCompare(b.athleteName)),
    [props.records, props.from, props.to, props.athleteId]
  );
  const dateRange = useMemo(() => enumerateDates(props.from, props.to), [props.from, props.to]);
  const daily = useMemo(() => buildDailySummaries(dateRange, periodRecords), [dateRange, periodRecords]);
  const chartBuckets = useMemo(() => buildChartBuckets(daily), [daily]);
  const annualMode = dateRange.length > 92;
  const summary = useMemo(() => aggregateRecords(periodRecords), [periodRecords]);
  const trainingRecords = useMemo(() => periodRecords.filter((record) => record.status !== 'rest'), [periodRecords]);
  const scopeAthleteCount = useMemo(() => new Set(periodRecords.map((record) => record.athleteId)).size, [periodRecords]);
  const trainingDays = daily.filter((day) => day.records.some((record) => record.status !== 'rest')).length;
  const missingDays = daily.filter((day) => day.records.length === 0).length;
  const title = selectedAthlete ? `${selectedAthlete.name}个人训练周期报告` : `${props.project}训练周期报告`;
  const scopeLabel = selectedAthlete
    ? `${selectedAthlete.name} · ${selectedAthlete.project} · ${selectedAthlete.team}`
    : `${scopeAthleteCount || props.athletes.length}名运动员 · 当前权限范围`;
  const lastUpdated = [...periodRecords].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0]?.updatedAt;

  const mainAuxiliary = useMemo(
    () => buildMainAuxiliary(trainingRecords),
    [trainingRecords]
  );
  const environmentMix = useMemo(
    () => buildEnvironmentMix(trainingRecords),
    [trainingRecords]
  );
  const waterIntensityUsesDistance = useMemo(
    () => trainingRecords.some((record) => detailedWaterDistance(record.trainingBreakdown) > 0),
    [trainingRecords]
  );
  const waterIntensity = useMemo(
    () => buildWaterIntensity(trainingRecords, waterIntensityUsesDistance),
    [trainingRecords, waterIntensityUsesDistance]
  );
  const landTypes = useMemo(
    () => buildLandTypes(trainingRecords),
    [trainingRecords]
  );
  const structures = useMemo(
    () => groupMetric(trainingRecords, (record) => record.structureType || '未分类', (record) => record.durationMin),
    [trainingRecords]
  );
  const intensities = useMemo(
    () => groupMetric(
      trainingRecords,
      (record) => record.intensityZone && record.intensityZone !== '-' ? record.intensityZone : '未标注强度',
      (record) => record.durationMin
    ),
    [trainingRecords]
  );

  const athleteRows = useMemo(() => props.athletes.map((athlete) => {
    const own = periodRecords.filter((record) => record.athleteId === athlete.id);
    return {
      athlete,
      sessions: own.filter((record) => record.status !== 'rest').length,
      duration: own.reduce((sum, record) => sum + record.durationMin, 0),
      distance: own.reduce((sum, record) => sum + record.distanceKm, 0),
      srpe: own.reduce((sum, record) => sum + record.srpe, 0),
      smvl: own.reduce((sum, record) => sum + record.smvl, 0),
      pulse: average(own.map((record) => record.morningPulse)),
      sleep: average(own.map((record) => record.sleepHours)),
      fatigue: average(own.map((record) => record.fatigueIndex)),
      status: own.length ? worstStatus(own) : 'missing' as const
    };
  }).filter((row) => row.sessions || row.status !== 'missing'), [props.athletes, periodRecords]);

  const schedulePages = chunkRows(annualMode ? daily.filter((day) => day.records.length) : daily, 7);
  const safeSchedulePages = schedulePages.length ? schedulePages : [[]];
  const detailPages = chunkRows(athleteRows, 8);
  const safeDetailPages = detailPages.length ? detailPages : [[]];
  const scheduleStartPage = 3;
  const detailStartPage = scheduleStartPage + safeSchedulePages.length;
  const conclusionPage = detailStartPage + safeDetailPages.length;
  const totalPages = conclusionPage + (photos.length ? 1 : 0);

  const overviewText = `所选周期纳入${periodRecords.length}条已入库记录，覆盖${scopeAthleteCount}名运动员、${trainingDays}个训练日；累计训练${formatNumber(summary.totalDuration / 60, 1)}小时，专项距离${formatNumber(summary.totalDistance, 1)}公里，SRPE总负荷${formatNumber(summary.totalSrpe)} AU。`;
  const generatedFocus = summary.alerts
    ? `复核${summary.alerts}条异常记录，优先处理高疲劳和睡眠不足；下周期总负荷增幅建议控制在10%以内。`
    : `保持专项训练连续性，根据水陆结构和强度分布微调训练量；下周期总负荷增幅建议控制在10%以内。`;
  const reportSummary = customSummary.trim() || overviewText;
  const cycleFocus = customFocus.trim() || generatedFocus;

  const addPhotos = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []).slice(0, Math.max(0, 4 - photos.length));
    for (const file of files) {
      const reader = new FileReader();
      reader.onload = () => {
        const url = reader.result;
        if (typeof url === 'string') setPhotos((current) => [...current, { name: file.name, url }].slice(0, 4));
      };
      reader.readAsDataURL(file);
    }
    event.target.value = '';
  };

  const exportPdf = async () => {
    if (!reportRef.current) return;
    setExporting(true);
    reportRef.current.classList.add('pdf-capture');
    try {
      const [{ default: html2canvas }, { default: jsPDF }] = await Promise.all([
        import('html2canvas'),
        import('jspdf')
      ]);
      const sheets = Array.from(reportRef.current.querySelectorAll<HTMLElement>('.report-sheet'));
      const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
      for (let index = 0; index < sheets.length; index += 1) {
        if (index) pdf.addPage();
        const canvas = await html2canvas(sheets[index], { scale: 2, backgroundColor: '#ffffff', useCORS: true });
        const image = canvas.toDataURL('image/jpeg', 0.95);
        pdf.addImage(image, 'JPEG', 0, 0, 210, 297, undefined, 'FAST');
      }
      pdf.save(`${title}_${props.from}_${props.to}.pdf`);
    } finally {
      reportRef.current.classList.remove('pdf-capture');
      setExporting(false);
    }
  };

  return (
    <div className="page-content report-page">
      <header className="page-heading">
        <h1>周期报告</h1>
        <DateToolbar {...props} />
      </header>

      <div className="report-actions">
        <div><FileText /><span><strong>周期报告预览</strong><small>图表与训练安排均来自当前日期筛选，共 {totalPages} 页</small></span></div>
        <div className="report-action-buttons">
          <button className="secondary-button" onClick={() => window.print()}><Printer size={17} />浏览器打印</button>
          <button className="primary-button" onClick={exportPdf} disabled={exporting || props.loading}>
            {exporting ? <><LoaderCircle className="spin" size={17} />正在生成…</> : <><Download size={17} />导出PDF</>}
          </button>
        </div>
      </div>

      <div className="report-source-banner">
        <Database size={18} />
        <div><strong>数据口径已锁定</strong><span>仅统计 {formatDate(props.from)} 至 {formatDate(props.to)} 内、当前账号有权查看且已经入库的数据。</span></div>
        <b>{periodRecords.length} 条记录</b>
      </div>

      <details className="report-editor">
        <summary><span><PenLine size={17} /><strong>完善报告信息</strong></span><small>填写内容会进入本次预览和导出</small></summary>
        <div className="report-editor-body">
          <div className="report-editor-grid">
            <label><span>训练阶段</span><input value={trainingPhase} onChange={(event) => setTrainingPhase(event.target.value)} /></label>
            <label><span>训练地点</span><input value={trainingLocation} onChange={(event) => setTrainingLocation(event.target.value)} /></label>
            <label className="editor-wide"><span>周期总结</span><textarea value={customSummary} onChange={(event) => setCustomSummary(event.target.value)} placeholder={overviewText} /></label>
            <label className="editor-wide"><span>下周期重点</span><textarea value={customFocus} onChange={(event) => setCustomFocus(event.target.value)} placeholder={generatedFocus} /></label>
          </div>
          <div className="report-photo-editor">
            <div><strong>训练照片</strong><small>最多4张，上传后增加训练影像页</small></div>
            <label className="secondary-button"><ImagePlus size={16} />选择照片<input type="file" accept="image/*" multiple onChange={addPhotos} disabled={photos.length >= 4} /></label>
            {photos.map((photo, index) => <span key={`${photo.name}-${index}`}><FileImage size={14} />{photo.name}<button type="button" onClick={() => setPhotos((current) => current.filter((_, itemIndex) => itemIndex !== index))} aria-label={`移除${photo.name}`}><X size={13} /></button></span>)}
          </div>
        </div>
      </details>

      <div className="report-canvas" ref={reportRef}>
        <article className="report-sheet report-dashboard-sheet">
          <ReportHeader title={title} from={props.from} to={props.to} user={props.user} page={pageNumber(1, totalPages)} />
          <ReportScopeBand
            phase={trainingPhase}
            location={trainingLocation}
            scope={scopeLabel}
            count={periodRecords.length}
            lastUpdated={lastUpdated}
          />
          <section className="report-dashboard-metrics">
            <ReportMetric label="累计训练" value={formatNumber(summary.totalDuration / 60, 1)} unit="小时" />
            <ReportMetric label="专项距离" value={formatNumber(summary.totalDistance, 1)} unit="km" />
            <ReportMetric label="SRPE负荷" value={formatNumber(summary.totalSrpe)} unit="AU" />
            <ReportMetric label="训练日" value={formatNumber(trainingDays)} unit={`共${dateRange.length}天`} />
            <ReportMetric label="异常/关注" value={formatNumber(summary.alerts + summary.attention)} unit="条" tone={summary.alerts ? 'risk' : 'normal'} />
          </section>
          <section className="report-section">
            <div className="report-section-title"><span>01</span><h2>周期训练负荷</h2><small>{annualMode ? '按月汇总' : dateRange.length <= 14 ? '按日展示' : '按7天汇总'} · 柱形为SRPE，折线为训练时间</small></div>
            <PeriodLoadChart rows={chartBuckets} verticalLabels={annualMode} />
          </section>
          <section className="report-dashboard-ratios">
            <RatioCard title="主辅训练比例" rows={mainAuxiliary} centerLabel="训练结构" />
            <RatioCard title="水陆训练比例" rows={environmentMix} centerLabel="训练环境" />
            <div className="report-cycle-brief">
              <span>周期结论</span>
              <p>{reportSummary}</p>
              <div><b>{missingDays}</b><small>个日期无入库记录</small></div>
            </div>
          </section>
          <section className="report-section report-coverage-section">
            <div className="report-section-title"><span>02</span><h2>日期覆盖</h2><small>绿：正常　黄：关注　红：异常　灰：休息/未上传</small></div>
            <CoverageRail days={daily} />
          </section>
          <ReportFooter project={props.project} />
        </article>

        <article className="report-sheet report-composition-sheet">
          <ReportHeader title="水上与陆上训练构成" from={props.from} to={props.to} user={props.user} page={pageNumber(2, totalPages)} />
          <section className="report-environment-block water">
            <EnvironmentHeading code="WATER" title="水上训练分析" rows={waterIntensity} unit={waterIntensityUsesDistance ? 'km' : 'min'} />
            <div className="report-environment-grid">
              <HorizontalBars title={waterIntensityUsesDistance ? '强度专项距离' : '强度训练时长'} rows={waterIntensity} unit={waterIntensityUsesDistance ? 'km' : 'min'} emptyText="所选周期暂无水上训练数据" />
              <RatioCard title="水上强度占比" rows={waterIntensity} centerLabel="水上" unit={waterIntensityUsesDistance ? 'km' : 'min'} compact />
            </div>
            <MiniDayBars days={daily} environment="water" />
          </section>
          <section className="report-environment-block land">
            <EnvironmentHeading code="LAND" title="陆上训练分析" rows={landTypes} unit="min" />
            <div className="report-environment-grid">
              <HorizontalBars title="训练类型时长" rows={landTypes} unit="min" emptyText="所选周期暂无陆上训练数据" />
              <RatioCard title="陆上类型占比" rows={landTypes} centerLabel="陆上" compact />
            </div>
            <MiniDayBars days={daily} environment="land" />
          </section>
          <section className="report-analysis-pair">
            <HorizontalBars title="训练结构" rows={structures} unit="min" emptyText="暂无训练结构数据" maxRows={5} />
            <HorizontalBars title="全部强度区间" rows={intensities} unit="min" emptyText="暂无强度区间数据" maxRows={5} accent="warm" />
          </section>
          <ReportFooter project={props.project} />
        </article>

        {safeSchedulePages.map((days, pageIndex) => (
          <article className="report-sheet report-schedule-sheet" key={`schedule-${pageIndex}`}>
            <ReportHeader
              title="本周期训练安排"
              from={props.from}
              to={props.to}
              user={props.user}
              page={pageNumber(scheduleStartPage + pageIndex, totalPages)}
            />
            <section className="report-schedule-heading">
              <div><CalendarDays /><span><small>TRAINING SCHEDULE</small><h2>逐日训练安排</h2></span></div>
              <p>第 {pageIndex + 1} 页 / 共 {safeSchedulePages.length} 页 · 每一行均来自当前区间内的已入库记录</p>
            </section>
            <ScheduleTable days={days} />
            <section className="report-schedule-summary">
              <span>本页合计</span>
              <strong>{formatNumber(days.reduce((sum, day) => sum + day.duration, 0))} min</strong>
              <strong>{formatNumber(days.reduce((sum, day) => sum + day.distance, 0), 1)} km</strong>
              <strong>{formatNumber(days.reduce((sum, day) => sum + day.srpe, 0))} AU</strong>
            </section>
            <ReportFooter project={props.project} />
          </article>
        ))}

        {safeDetailPages.map((rows, detailIndex) => (
          <article className="report-sheet report-detail-sheet" key={`detail-${detailIndex}`}>
            <ReportHeader
              title="运动员个人状态与负荷"
              from={props.from}
              to={props.to}
              user={props.user}
              page={pageNumber(detailStartPage + detailIndex, totalPages)}
            />
            <section className="report-section athlete-report-section">
              <div className="report-section-title"><span>03</span><h2>个人周期指标</h2><small>第 {detailIndex + 1} 组 / 共 {safeDetailPages.length} 组</small></div>
              <AthleteTable rows={rows} />
            </section>
            {detailIndex === safeDetailPages.length - 1 && <>
              <section className="report-recovery-strip">
                <div><span>平均睡眠</span><strong>{summary.avgSleep.toFixed(1)}</strong><small>小时</small></div>
                <div><span>平均疲劳</span><strong>{summary.avgFatigue.toFixed(1)}</strong><small>指数</small></div>
                <div><span>正常记录</span><strong>{periodRecords.filter((record) => record.status === 'normal').length}</strong><small>条</small></div>
                <div className="risk"><span>异常与关注</span><strong>{summary.alerts + summary.attention}</strong><small>条</small></div>
              </section>
              <section className="report-section report-alerts">
                <div className="report-section-title"><span>04</span><h2>重点关注</h2><small>从当前周期记录自动筛选</small></div>
                <div className="alert-list">
                  {periodRecords.filter((record) => record.status === 'alert' || record.status === 'attention').slice(0, 8).map((record) => <div key={record.id}><span>{record.date.slice(5)}</span><strong>{record.athleteName}</strong><p>{record.coachNote || `疲劳${record.fatigueIndex ?? '—'}，睡眠${record.sleepHours ?? '—'}小时，训练前复核。`}</p></div>)}
                  {!periodRecords.some((record) => record.status === 'alert' || record.status === 'attention') && <p className="no-alert-copy">所选周期内没有异常或关注记录。</p>}
                </div>
              </section>
              <section className="report-section report-athlete-comparison">
                <div className="report-section-title"><span>05</span><h2>个人负荷对比</h2><small>按本周期累计值排序</small></div>
                <div>
                  <HorizontalBars title="SRPE总负荷" rows={distributionFromValues(athleteRows.map((row) => ({ label: row.athlete.name, amount: row.srpe })))} unit="AU" emptyText="暂无个人负荷数据" maxRows={8} />
                  <HorizontalBars title="训练时间" rows={distributionFromValues(athleteRows.map((row) => ({ label: row.athlete.name, amount: row.duration })))} unit="min" emptyText="暂无个人训练时间" maxRows={8} accent="warm" />
                </div>
              </section>
            </>}
            <ReportFooter project={props.project} />
          </article>
        ))}

        <article className="report-sheet report-plan-sheet">
          <ReportHeader title="周期结论与后续重点" from={props.from} to={props.to} user={props.user} page={pageNumber(conclusionPage, totalPages)} />
          <section className="report-decision">
            <span>PERFORMANCE DECISION</span>
            <h2>下周期工作重点</h2>
            <p>{cycleFocus}</p>
          </section>
          <section className="report-section">
            <div className="report-section-title"><span>05</span><h2>周期数据复盘</h2><small>结论只使用当前选择范围</small></div>
            <div className="report-review-grid">
              <ReviewItem label="专项训练" value={mainAuxiliary.find((row) => row.label === '主项训练')?.ratio || 0} note="占有效训练时间" />
              <ReviewItem label="水上训练" value={environmentMix.find((row) => row.label === '水上训练')?.ratio || 0} note="占有效训练时间" />
              <ReviewItem label="恢复状态" value={Math.max(0, 100 - percentage(summary.alerts + summary.attention, Math.max(periodRecords.length, 1)))} note="正常/休息记录占比" />
              <ReviewItem label="数据覆盖" value={percentage(dateRange.length - missingDays, Math.max(dateRange.length, 1))} note="选择日期有记录" />
            </div>
          </section>
          <section className="report-section">
            <div className="report-section-title"><span>06</span><h2>教练确认项</h2></div>
            <table className="report-plan-table">
              <thead><tr><th>确认项目</th><th>本周期依据</th><th>下周期动作</th></tr></thead>
              <tbody>
                <tr><td><strong>训练负荷</strong></td><td>累计 {formatNumber(summary.totalSrpe)} AU，训练 {formatNumber(summary.totalDuration / 60, 1)} 小时</td><td>确认周负荷增减幅度</td></tr>
                <tr><td><strong>专项结构</strong></td><td>水上 {environmentMix.find((row) => row.label === '水上训练')?.ratio || 0}% / 陆上 {environmentMix.find((row) => row.label === '陆上训练')?.ratio || 0}%</td><td>确认水陆训练比例</td></tr>
                <tr><td><strong>强度分布</strong></td><td>{intensities.slice(0, 3).map((row) => `${row.label} ${row.ratio}%`).join(' · ') || '暂无强度数据'}</td><td>确认重点强度区间</td></tr>
                <tr><td><strong>恢复风险</strong></td><td>异常 {summary.alerts} 条，关注 {summary.attention} 条</td><td>复核个体减量与恢复安排</td></tr>
              </tbody>
            </table>
          </section>
          <section className="report-signoff">
            <div><span>报告结论</span><p>{reportSummary}</p></div>
            <div><span>报告签发</span><strong>{new Date().toLocaleDateString('zh-CN')}</strong><small>生成者：{props.user.displayName}</small></div>
          </section>
          <ReportFooter project={props.project} />
        </article>

        {photos.length > 0 && <article className="report-sheet report-photo-sheet">
          <ReportHeader title="周期训练影像记录" from={props.from} to={props.to} user={props.user} page={pageNumber(totalPages, totalPages)} />
          <section className={`report-photo-grid photo-count-${photos.length}`}>
            {photos.map((photo, index) => <figure key={`${photo.name}-${index}`}><img src={photo.url} alt={`训练记录 ${index + 1}`} /><figcaption>{String(index + 1).padStart(2, '0')} · {photo.name.replace(/\.[^.]+$/, '')}</figcaption></figure>)}
          </section>
          <section className="report-photo-signature"><span>训练阶段</span><strong>{trainingPhase}</strong><p>{formatDate(props.from)} 至 {formatDate(props.to)} · {trainingLocation}</p></section>
          <ReportFooter project={props.project} />
        </article>}
      </div>
    </div>
  );
}

function enumerateDates(from: string, to: string) {
  if (!from || !to || from > to) return [];
  const dates: string[] = [];
  const current = new Date(`${from}T12:00:00`);
  const end = new Date(`${to}T12:00:00`);
  while (current <= end && dates.length < 370) {
    dates.push(current.toISOString().slice(0, 10));
    current.setDate(current.getDate() + 1);
  }
  return dates;
}

function buildDailySummaries(dates: string[], records: TrainingRecord[]): DailySummary[] {
  const grouped = new Map<string, TrainingRecord[]>();
  for (const record of records) grouped.set(record.date, [...(grouped.get(record.date) || []), record]);
  return dates.map((date) => {
    const own = grouped.get(date) || [];
    const contentMap = new Map<string, string[]>();
    for (const record of own) {
      const content = record.status === 'rest' ? '休息与恢复' : record.content || record.trainingType || '未填写训练内容';
      contentMap.set(content, [...(contentMap.get(content) || []), record.athleteName]);
    }
    return {
      date,
      records: own,
      duration: own.reduce((sum, record) => sum + record.durationMin, 0),
      distance: own.reduce((sum, record) => sum + record.distanceKm, 0),
      srpe: own.reduce((sum, record) => sum + record.srpe, 0),
      smvl: own.reduce((sum, record) => sum + record.smvl, 0),
      waterDuration: own
        .filter((record) => record.status !== 'rest')
        .reduce((sum, record) => sum + environmentMinutes(record).water, 0),
      landDuration: own
        .filter((record) => record.status !== 'rest')
        .reduce((sum, record) => sum + environmentMinutes(record).land, 0),
      status: own.length ? worstStatus(own) : 'missing',
      contentGroups: [...contentMap.entries()].map(([content, athletes]) => ({ athletes: [...new Set(athletes)], content })),
      types: [...new Set(own.map((record) => record.trainingType).filter(Boolean))],
      zones: [...new Set(own.map((record) => record.intensityZone).filter((zone) => zone && zone !== '-'))]
    };
  });
}

function buildChartBuckets(days: DailySummary[]): ChartBucket[] {
  if (days.length <= 14) return days.map((day) => ({
    label: dayLabel(day.date),
    sublabel: day.date.slice(5),
    duration: day.duration,
    distance: day.distance,
    srpe: day.srpe
  }));
  const chunks = days.length > 92 ? groupDaysByMonth(days) : chunkRows(days, 7);
  return chunks.map((chunk) => ({
    label: days.length > 92 ? monthChartLabel(chunk[0].date, days) : `${chunk[0].date.slice(5)}-${chunk[chunk.length - 1].date.slice(5)}`,
    sublabel: `${chunk.length}天`,
    duration: chunk.reduce((sum, day) => sum + day.duration, 0),
    distance: chunk.reduce((sum, day) => sum + day.distance, 0),
    srpe: chunk.reduce((sum, day) => sum + day.srpe, 0)
  }));
}

function groupDaysByMonth(days: DailySummary[]) {
  const groups = new Map<string, DailySummary[]>();
  for (const day of days) {
    const month = day.date.slice(0, 7);
    groups.set(month, [...(groups.get(month) || []), day]);
  }
  return [...groups.values()];
}

function monthChartLabel(date: string, days: DailySummary[]) {
  const spansYears = days[0]?.date.slice(0, 4) !== days[days.length - 1]?.date.slice(0, 4);
  return spansYears ? `${date.slice(2, 4)}.${date.slice(5, 7)}` : `${Number(date.slice(5, 7))}月`;
}

function groupMetric(records: TrainingRecord[], key: (record: TrainingRecord) => string, value: (record: TrainingRecord) => number) {
  const map = new Map<string, number>();
  for (const record of records) map.set(key(record), (map.get(key(record)) || 0) + value(record));
  const total = [...map.values()].reduce((sum, item) => sum + item, 0);
  return [...map.entries()]
    .map(([label, amount]) => ({ label, amount, ratio: percentage(amount, total) }))
    .sort((a, b) => b.amount - a.amount);
}

function distributionFromValues(rows: Array<{ label: string; amount: number }>) {
  const total = rows.reduce((sum, row) => sum + row.amount, 0);
  return rows
    .map((row) => ({ ...row, ratio: percentage(row.amount, total) }))
    .sort((a, b) => b.amount - a.amount);
}

const reportIntensityZones = ['U3', 'U2', 'U1', 'AT', 'TPT', 'AN', 'ATP'] as const;

function detailedLandMinutes(breakdown?: TrainingBreakdown) {
  return breakdown
    ? Object.values(breakdown.landMinutes || {}).reduce((sum, value) => sum + (Number(value) || 0), 0)
    : 0;
}

function detailedWaterDistance(breakdown?: TrainingBreakdown) {
  return breakdown
    ? Object.values(breakdown.waterDistanceByZone || {}).reduce((sum, value) => sum + (Number(value) || 0), 0)
    : 0;
}

function detailedErgDistance(breakdown?: TrainingBreakdown) {
  return breakdown
    ? Object.values(breakdown.ergDistanceByZone || {}).reduce((sum, value) => sum + (Number(value) || 0), 0)
    : 0;
}

function hasDetailedBreakdown(record: TrainingRecord) {
  const breakdown = record.trainingBreakdown;
  return Boolean(breakdown && (
    breakdown.waterMinutes
    || breakdown.ergMinutes
    || detailedLandMinutes(breakdown)
    || detailedWaterDistance(breakdown)
    || detailedErgDistance(breakdown)
  ));
}

function environmentMinutes(record: TrainingRecord) {
  if (hasDetailedBreakdown(record)) {
    return {
      water: Number(record.trainingBreakdown.waterMinutes) || 0,
      land: (Number(record.trainingBreakdown.ergMinutes) || 0) + detailedLandMinutes(record.trainingBreakdown)
    };
  }
  return classifyEnvironment(record) === 'water'
    ? { water: record.durationMin, land: 0 }
    : { water: 0, land: record.durationMin };
}

function buildMainAuxiliary(records: TrainingRecord[]) {
  let main = 0;
  let auxiliary = 0;
  for (const record of records) {
    if (hasDetailedBreakdown(record)) {
      main += (Number(record.trainingBreakdown.waterMinutes) || 0) + (Number(record.trainingBreakdown.ergMinutes) || 0);
      auxiliary += detailedLandMinutes(record.trainingBreakdown);
    } else if (isMainTraining(record)) {
      main += record.durationMin;
    } else {
      auxiliary += record.durationMin;
    }
  }
  return distributionFromValues([
    { label: '主项训练', amount: main },
    { label: '辅助训练', amount: auxiliary }
  ].filter((row) => row.amount > 0));
}

function buildEnvironmentMix(records: TrainingRecord[]) {
  let water = 0;
  let land = 0;
  for (const record of records) {
    const minutes = environmentMinutes(record);
    water += minutes.water;
    land += minutes.land;
  }
  return distributionFromValues([
    { label: '水上训练', amount: water },
    { label: '陆上训练', amount: land }
  ].filter((row) => row.amount > 0));
}

function buildWaterIntensity(records: TrainingRecord[], useDistance: boolean) {
  const values = new Map<string, number>();
  for (const record of records) {
    if (useDistance) {
      const hasZoneDistance = detailedWaterDistance(record.trainingBreakdown) > 0;
      if (hasZoneDistance) {
        for (const zone of reportIntensityZones) {
          const amount = Number(record.trainingBreakdown.waterDistanceByZone[zone]) || 0;
          if (amount > 0) values.set(zone, (values.get(zone) || 0) + amount);
        }
      } else if (classifyEnvironment(record) === 'water' && record.distanceKm > 0) {
        const label = record.intensityZone && record.intensityZone !== '-' ? record.intensityZone : '未标注强度';
        values.set(label, (values.get(label) || 0) + record.distanceKm);
      }
      continue;
    }
    const amount = hasDetailedBreakdown(record)
      ? Number(record.trainingBreakdown.waterMinutes) || 0
      : classifyEnvironment(record) === 'water'
        ? record.durationMin
        : 0;
    if (amount > 0) {
      const label = record.intensityZone && record.intensityZone !== '-' ? record.intensityZone : '未标注强度';
      values.set(label, (values.get(label) || 0) + amount);
    }
  }
  return distributionFromValues([...values.entries()].map(([label, amount]) => ({ label, amount })));
}

function buildLandTypes(records: TrainingRecord[]) {
  const values = new Map<string, number>();
  const add = (label: string, amount: number) => {
    if (amount > 0) values.set(label, (values.get(label) || 0) + amount);
  };
  const labels: Record<keyof TrainingBreakdown['landMinutes'], string> = {
    functional: '功能力量',
    endurance: '力量耐力',
    maxStrength: '最大力量',
    speedStrength: '速度力量',
    recovery: '恢复再生',
    running: '跑步',
    other: '其他训练'
  };
  for (const record of records) {
    if (hasDetailedBreakdown(record)) {
      add('测功仪', Number(record.trainingBreakdown.ergMinutes) || 0);
      for (const [key, label] of Object.entries(labels) as Array<[keyof TrainingBreakdown['landMinutes'], string]>) {
        add(label, Number(record.trainingBreakdown.landMinutes[key]) || 0);
      }
    } else if (classifyEnvironment(record) === 'land') {
      add(landTrainingBucket(record), record.durationMin);
    }
  }
  return distributionFromValues([...values.entries()].map(([label, amount]) => ({ label, amount })));
}

function classifyEnvironment(record: TrainingRecord): 'water' | 'land' {
  const value = `${record.trainingType} ${record.structureType} ${record.content}`.toLowerCase();
  if (/水上|艇上|静水|划行|划船/.test(value) && !/测功仪|划船机/.test(value)) return 'water';
  return 'land';
}

function isMainTraining(record: TrainingRecord) {
  const value = `${record.trainingType} ${record.structureType} ${record.content}`;
  return classifyEnvironment(record) === 'water' || /专项|比赛|测功仪/.test(value);
}

function landTrainingBucket(record: TrainingRecord) {
  const value = `${record.trainingType} ${record.structureType} ${record.content}`;
  if (/恢复|再生|拉伸|放松/.test(value)) return '恢复再生';
  if (/爆发|速度力量|高翻|跳跃/.test(value)) return '爆发力';
  if (/最大力量|大力量/.test(value)) return '最大力量';
  if (/力量耐力/.test(value)) return '力量耐力';
  if (/核心/.test(value)) return '核心力量';
  if (/功能/.test(value)) return '功能训练';
  if (/测功仪|划船机/.test(value)) return '测功仪';
  if (/跑步|单车|自行车|有氧/.test(value)) return '陆上有氧';
  if (/热身/.test(value)) return '热身';
  return record.structureType || record.trainingType || '陆上综合';
}

function chunkRows<T>(rows: T[], size: number) {
  return Array.from({ length: Math.ceil(rows.length / size) }, (_, index) => rows.slice(index * size, (index + 1) * size));
}

function pageNumber(current: number, total: number) {
  return `${String(current).padStart(2, '0')} / ${String(total).padStart(2, '0')}`;
}

function dayLabel(date: string) {
  return new Date(`${date}T12:00:00`).toLocaleDateString('zh-CN', { weekday: 'short' }).replace('周', '星期');
}

function ReportHeader({ title, from, to, user, page }: { title: string; from: string; to: string; user: User; page: string }) {
  return <header className="report-header"><div className="report-brand"><BrandLogo className="print" /><div><strong>竞迹</strong><small>JINGJI PERFORMANCE</small></div></div><div className="report-title"><span>TRAINING PERFORMANCE REPORT</span><h1>{title}</h1><p>{formatDate(from)} — {formatDate(to)} · {user.displayName}</p></div><span className="report-page-number">{page}</span></header>;
}

function ReportScopeBand({ phase, location, scope, count, lastUpdated }: { phase: string; location: string; scope: string; count: number; lastUpdated?: string }) {
  return <section className="report-scope-band">
    <div><span>训练阶段</span><strong>{phase || '未填写'}</strong></div>
    <div><span>训练地点</span><strong>{location || '未填写'}</strong></div>
    <div className="wide"><span>报告对象</span><strong>{scope}</strong></div>
    <div><span>数据来源</span><strong>已入库记录 {count} 条</strong></div>
    <div><span>最后更新</span><strong>{lastUpdated ? lastUpdated.replace('T', ' ').slice(0, 16) : '暂无记录'}</strong></div>
  </section>;
}

function ReportMetric({ label, value, unit, tone = 'default' }: { label: string; value: string; unit: string; tone?: 'default' | 'normal' | 'risk' }) {
  return <div className={`metric-${tone}`}><span>{label}</span><strong>{value}</strong><small>{unit}</small></div>;
}

function PeriodLoadChart({ rows, verticalLabels = false }: { rows: ChartBucket[]; verticalLabels?: boolean }) {
  if (!rows.length) return <div className="report-empty">所选周期暂无训练负荷。</div>;
  const maxSrpe = Math.max(...rows.map((row) => row.srpe), 1);
  const maxDuration = Math.max(...rows.map((row) => row.duration), 1);
  const srpeTicks = [1, .75, .5, .25, 0].map((ratio) => Math.round(maxSrpe * ratio));
  const durationTicks = [1, .75, .5, .25, 0].map((ratio) => Math.round(maxDuration * ratio));
  const linePoints = rows.map((row, index) => `${index * 100 + 50},${94 - row.duration / maxDuration * 82}`).join(' ');
  return <div className={`period-load-chart ${verticalLabels || rows.length > 10 ? 'dense-labels' : ''}`} style={{ '--period-columns': rows.length } as CSSProperties}>
    <div className="period-chart-grid" />
    <div className="period-axis period-axis-left"><b>SRPE(AU)</b>{srpeTicks.map((tick, index) => <span key={`${tick}-${index}`}>{formatNumber(tick)}</span>)}</div>
    <div className="period-axis period-axis-right"><b>时间(min)</b>{durationTicks.map((tick, index) => <span key={`${tick}-${index}`}>{formatNumber(tick)}</span>)}</div>
    <svg className="period-load-line" viewBox={`0 0 ${rows.length * 100} 100`} preserveAspectRatio="none" aria-hidden="true">
      <polyline points={linePoints} />
      {rows.map((row, index) => <circle key={`${row.label}-${index}`} cx={index * 100 + 50} cy={94 - row.duration / maxDuration * 82} r="2.8" vectorEffect="non-scaling-stroke" />)}
    </svg>
    <div className="period-load-columns">
      {rows.map((row) => <div className="period-load-column" key={`${row.label}-${row.sublabel}`}>
        <div className="period-bar-stage"><i style={{ height: `${Math.max(row.srpe ? 5 : 0, row.srpe / maxSrpe * 100)}%` }}><b>{formatNumber(row.srpe)}</b></i></div>
        <strong>{row.label}</strong><small>{row.sublabel} · {formatNumber(row.duration)}min</small>
      </div>)}
    </div>
    <div className="period-load-legend"><span><i />SRPE总负荷</span><span><b />训练时间</span></div>
  </div>;
}

function RatioCard({ title, rows, centerLabel, compact = false, unit = 'min' }: { title: string; rows: DistributionRow[]; centerLabel: string; compact?: boolean; unit?: string }) {
  const total = rows.reduce((sum, row) => sum + row.amount, 0);
  let offset = 0;
  return <div className={`report-ratio-card ${compact ? 'compact' : ''}`}>
    <div className="report-ratio-heading"><h3>{title}</h3><small>{formatNumber(total)} {unit}</small></div>
    <div className="report-ratio-body">
      <div className="report-ratio-donut">
        <svg viewBox="0 0 100 100" aria-hidden="true">
          <circle cx="50" cy="50" r="39" pathLength="100" className="ratio-base" />
          {rows.slice(0, 7).map((row, index) => {
            const currentOffset = offset;
            offset += row.ratio;
            return <circle key={row.label} cx="50" cy="50" r="39" pathLength="100" className="ratio-segment" stroke={reportColors[index]} strokeDasharray={`${row.ratio} ${100 - row.ratio}`} strokeDashoffset={-currentOffset} />;
          })}
        </svg>
        <span><strong>{rows.length ? rows[0].ratio : 0}%</strong><small>{centerLabel}</small></span>
      </div>
      <div className="report-ratio-legend">
        {rows.slice(0, compact ? 6 : 4).map((row, index) => <div key={row.label}><span><i style={{ background: reportColors[index] }} />{row.label}</span><strong>{row.ratio}%</strong></div>)}
        {!rows.length && <p>暂无数据</p>}
      </div>
    </div>
  </div>;
}

function CoverageRail({ days }: { days: DailySummary[] }) {
  if (!days.length) return <div className="report-empty">请选择有效日期范围。</div>;
  const annual = days.length > 92;
  const shown = annual ? groupDaysByMonth(days).map((month) => {
    const records = month.flatMap((day) => day.records);
    return {
      date: month[0].date.slice(0, 7),
      duration: month.reduce((sum, day) => sum + day.duration, 0),
      status: records.length ? worstStatus(records) : 'missing' as TrainingStatus
    };
  }) : days.slice(0, 31);
  return <div className={`report-coverage-rail ${annual ? 'monthly' : ''}`} style={{ '--coverage-columns': shown.length } as CSSProperties}>
    {shown.map((day) => <div key={day.date} className={`coverage-${day.status}`}>
      <span>{annual ? monthChartLabel(`${day.date}-01`, days) : day.date.slice(8)}</span>
      <i />
      <small>{day.duration ? `${formatNumber(day.duration)}′` : day.status === 'missing' ? '未传' : '休息'}</small>
    </div>)}
    {!annual && days.length > 31 && <p>共 {days.length} 天，图表显示前31天；训练安排页包含完整日期。</p>}
  </div>;
}

function EnvironmentHeading({ code, title, rows, unit }: { code: string; title: string; rows: DistributionRow[]; unit: string }) {
  const total = rows.reduce((sum, row) => sum + row.amount, 0);
  return <header className="environment-heading"><span>{code}</span><h2>{title}</h2><strong>{formatNumber(total)} {unit}</strong></header>;
}

function HorizontalBars({ title, rows, unit, emptyText, maxRows = 7, accent = 'cool' }: { title: string; rows: DistributionRow[]; unit: string; emptyText: string; maxRows?: number; accent?: 'cool' | 'warm' }) {
  const shown = rows.slice(0, maxRows);
  const max = Math.max(...shown.map((row) => row.amount), 1);
  return <div className={`report-horizontal-bars bars-${accent}`}>
    <h3>{title}</h3>
    {shown.length ? <div className="horizontal-bar-list">
      {shown.map((row, index) => <div key={row.label}>
        <span>{row.label}</span>
        <i><b style={{ width: `${Math.max(2, row.amount / max * 100)}%`, '--bar-index': index } as CSSProperties} /></i>
        <strong>{formatNumber(row.amount)} {unit}</strong>
      </div>)}
    </div> : <p className="horizontal-empty">{emptyText}</p>}
  </div>;
}

function MiniDayBars({ days, environment }: { days: DailySummary[]; environment: 'water' | 'land' }) {
  const annual = days.length > 92;
  const rows = days.length <= 14 ? days.map((day) => ({ ...day, chartLabel: day.date.slice(5) })) : (annual ? groupDaysByMonth(days) : chunkRows(days, 7)).map((chunk) => ({
    date: chunk[0].date,
    chartLabel: annual ? monthChartLabel(chunk[0].date, days) : `${chunk[0].date.slice(5)}-${chunk[chunk.length - 1].date.slice(5)}`,
    waterDuration: chunk.reduce((sum, day) => sum + day.waterDuration, 0),
    landDuration: chunk.reduce((sum, day) => sum + day.landDuration, 0)
  }));
  const values = rows.map((row) => environment === 'water' ? row.waterDuration : row.landDuration);
  const max = Math.max(...values, 1);
  return <div className="report-mini-days" style={{ '--mini-columns': rows.length } as CSSProperties}>
    <span>{annual ? '每月时长' : days.length <= 14 ? '每日时长' : '每7天时长'}</span>
    <div>{rows.map((row, index) => <i key={`${row.date}-${index}`} style={{ height: `${Math.max(values[index] ? 4 : 0, values[index] / max * 100)}%` }}><b>{values[index] ? formatNumber(values[index]) : ''}</b><small>{row.chartLabel}</small></i>)}</div>
  </div>;
}

function ScheduleTable({ days }: { days: DailySummary[] }) {
  if (!days.length) return <div className="report-empty schedule-empty">所选周期暂无可展示日期。</div>;
  return <table className="report-schedule-table">
    <thead><tr><th>日期</th><th>训练类别</th><th>本日训练安排</th><th>强度</th><th>训练量</th><th>负荷/状态</th></tr></thead>
    <tbody>{days.map((day) => <tr key={day.date}>
      <td><strong>{day.date.slice(5)}</strong><small>{dayLabel(day.date)}</small></td>
      <td>{day.records.length ? <><strong>{day.types.join(' / ') || '未分类'}</strong><small>{day.waterDuration ? `水上${formatNumber(day.waterDuration)}′` : ''}{day.waterDuration && day.landDuration ? ' · ' : ''}{day.landDuration ? `陆上${formatNumber(day.landDuration)}′` : ''}</small></> : <span>未上传</span>}</td>
      <td><div className="schedule-content-list">
        {day.contentGroups.length
          ? day.contentGroups.map((group) => <p key={`${group.athletes.join('-')}-${group.content}`}><b>{group.athletes.join('、')}</b><span>{group.content}</span></p>)
          : <p><span>当日暂无已入库训练安排。</span></p>}
      </div></td>
      <td><strong>{day.zones.join(' / ') || '—'}</strong></td>
      <td><strong>{formatNumber(day.duration)} min</strong><small>{day.distance ? `${formatNumber(day.distance, 1)} km` : '—'}</small></td>
      <td><strong>{formatNumber(day.srpe)} AU</strong><small><i className={`report-status status-bg-${day.status}`} />{statusMeta[day.status].short}</small></td>
    </tr>)}</tbody>
  </table>;
}

function AthleteTable({ rows }: { rows: Array<{ athlete: Athlete; sessions: number; duration: number; distance: number; srpe: number; smvl: number; pulse: number; sleep: number; fatigue: number; status: TrainingRecord['status'] }> }) {
  return <table className="report-table">
    <thead><tr><th>运动员</th><th>状态</th><th>课次</th><th>时间(h)</th><th>距离(km)</th><th>SRPE</th><th>SMVL</th><th>晨脉</th><th>睡眠</th><th>疲劳</th></tr></thead>
    <tbody>{rows.map((row) => <tr key={row.athlete.id}><td><strong>{row.athlete.name}</strong><small>{row.athlete.project} · {row.athlete.team}</small></td><td><span className={`report-status status-bg-${row.status}`} />{statusMeta[row.status].short}</td><td>{row.sessions}</td><td>{(row.duration / 60).toFixed(1)}</td><td>{row.distance.toFixed(1)}</td><td>{formatNumber(row.srpe)}</td><td>{formatNumber(row.smvl)}</td><td>{row.pulse ? row.pulse.toFixed(0) : '—'}</td><td>{row.sleep ? row.sleep.toFixed(1) : '—'}</td><td>{row.fatigue ? row.fatigue.toFixed(1) : '—'}</td></tr>)}</tbody>
  </table>;
}

function ReviewItem({ label, value, note }: { label: string; value: number; note: string }) {
  return <div><span>{label}</span><strong>{formatNumber(value, 1)}%</strong><i><b style={{ width: `${Math.min(100, Math.max(0, value))}%` }} /></i><small>{note}</small></div>;
}

function ReportFooter({ project }: { project: Project }) {
  return <footer className="report-footer"><span>竞迹 · {project}训练数据监控平台</span><span>图表、安排与统计均来自当前{project}空间的已入库数据</span></footer>;
}
