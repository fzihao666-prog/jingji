import {
  Activity, AlarmClock, ArrowRight, BarChart3, Clock3, Database, Eye, EyeOff, Gauge,
  MoreHorizontal, Pin, Route, ShieldCheck, Sparkles, UsersRound
} from 'lucide-react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent, ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { api } from '../api';
import type { Athlete, OverviewMeasurement, OverviewPayload, Project, StrengthTest, TrainingRecord, User } from '../types';
import { aggregateRecords, average, formatNumber, groupByDate, percentage, worstStatus } from '../utils';
import { ROLE_META } from '../../shared/access';
import { DateToolbar } from '../components/DateToolbar';
import {
  IntensityChart, PerformanceRadarChart, ProfessionalLoadChart, RecoveryTrendChart,
  RelativeStrengthChart, StrengthChangeChart, StructureChart, WaterIntensityLoadChart
} from '../components/LoadCharts';
import { StatusPill } from '../components/StatusPill';
import { EditableName } from '../components/EditableName';
import { AthleteProfileOverview, BirthplaceMapOverview, CompetitiveStateOverview } from '../components/AthleteProfileCharts';
import {
  buildDailyPerformance, buildPerformanceRadar, calculateLoadDiagnostics, calculateRecoveryTime,
  relativeStrengthRows, strengthChangeRows
} from '../overview-analytics';
import type { StrengthMetricKey } from '../../shared/strength-model';

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

type CardSize = 'metric' | 'third' | 'half' | 'wide' | 'full';
type LayoutState = { version: number; order: string[]; hidden: string[]; pinned: string[] };
type DropTarget = { id: string; position: 'before' | 'after' };
type CardRect = { left: number; top: number; right: number; bottom: number; width: number; height: number };
type PointerDragSession = {
  id: string;
  pointerId: number;
  startX: number;
  startY: number;
  offsetX: number;
  offsetY: number;
  active: boolean;
  preview: HTMLElement | null;
  cleanup: () => void;
};

function stableCardRect(element: HTMLElement, gridRect: DOMRect): CardRect {
  const left = gridRect.left + element.offsetLeft;
  const top = gridRect.top + element.offsetTop;
  const width = element.offsetWidth;
  const height = element.offsetHeight;
  return { left, top, right: left + width, bottom: top + height, width, height };
}

const defaultOrder = [
  'duration', 'distance', 'srpe', 'rpe', 'acute-load', 'recovery-time',
  'athlete-profile', 'competitive-state', 'birthplace-map',
  'performance-radar', 'load-response', 'load-diagnostics', 'recovery',
  'strength-change', 'relative-strength', 'structure', 'intensity', 'status',
  'water-zones', 'project-indicators', 'movement-efficiency', 'roster'
];

const cardMeta: Record<string, { title: string; size: CardSize }> = {
  duration: { title: '累计训练时间', size: 'metric' },
  distance: { title: '专项距离', size: 'metric' },
  srpe: { title: 'SRPE总负荷', size: 'metric' },
  rpe: { title: '平均主观强度', size: 'metric' },
  'acute-load': { title: '近7日急性负荷', size: 'metric' },
  'recovery-time': { title: '恢复时间', size: 'metric' },
  'athlete-profile': { title: '身体与年龄画像', size: 'half' },
  'competitive-state': { title: '竞技状态评估', size: 'half' },
  'birthplace-map': { title: '生源地分布地图', size: 'full' },
  'performance-radar': { title: '六维运动表现画像', size: 'half' },
  'load-response': { title: '训练负荷与机体刺激', size: 'half' },
  'load-diagnostics': { title: '负荷诊断', size: 'third' },
  recovery: { title: '恢复与机能趋势', size: 'wide' },
  'strength-change': { title: '力量与爆发前后测', size: 'half' },
  'relative-strength': { title: '相对力量', size: 'half' },
  structure: { title: '训练结构', size: 'third' },
  intensity: { title: '强度分布', size: 'third' },
  status: { title: '周期状态', size: 'third' },
  'water-zones': { title: '水上强度距离与时间', size: 'full' },
  'project-indicators': { title: '专项指标矩阵', size: 'half' },
  'movement-efficiency': { title: '动作效率与代偿', size: 'half' },
  roster: { title: '运动员状态', size: 'full' }
};

export function OverviewPage(props: Props) {
  const [overview, setOverview] = useState<OverviewPayload | null>(null);
  const [overviewLoading, setOverviewLoading] = useState(false);
  const [overviewError, setOverviewError] = useState('');
  const isIndividualOverview = props.user.role === 'ATL';
  const overviewAthleteId = isIndividualOverview ? props.user.athleteId : null;

  useEffect(() => {
    if (props.athleteId !== overviewAthleteId) props.onAthleteChange(overviewAthleteId);
  }, [overviewAthleteId, props.athleteId, props.onAthleteChange]);

  useEffect(() => {
    let active = true;
    setOverviewLoading(true);
    setOverviewError('');
    api.overview(props.from, props.to, overviewAthleteId, props.project)
      .then(({ overview: payload }) => { if (active) setOverview(payload); })
      .catch((error) => {
        if (!active) return;
        setOverview(null);
        setOverviewError(error instanceof Error ? error.message : '统一总览数据读取失败');
      })
      .finally(() => { if (active) setOverviewLoading(false); });
    return () => { active = false; };
  }, [props.from, props.to, overviewAthleteId, props.project]);

  const analysisRecords = overview?.records ?? props.records;
  const athleteProfiles = overview?.profiles ?? [];
  const strengthTests = overview?.strengthTests ?? [];
  const strengthLoading = overviewLoading;
  const measurementMap = useMemo(() => new Map((overview?.measurements || []).map((item) => [item.code, item])), [overview]);
  const summary = useMemo(() => aggregateRecords(analysisRecords), [analysisRecords]);
  const scopeAthleteCount = overview?.meta.athleteCount || new Set(analysisRecords.map((record) => record.athleteId)).size || props.athletes.length || 1;
  const daily = useMemo(
    () => buildDailyPerformance(analysisRecords, props.from, props.to, isIndividualOverview ? 'individual' : 'team', scopeAthleteCount),
    [analysisRecords, props.from, props.to, isIndividualOverview, scopeAthleteCount]
  );
  const diagnostics = useMemo(() => calculateLoadDiagnostics(analysisRecords, daily), [analysisRecords, daily]);
  const recoveryTime = useMemo(() => calculateRecoveryTime(analysisRecords), [analysisRecords]);
  const averageRpe = useMemo(() => average(analysisRecords.map((record) => record.rpe)), [analysisRecords]);

  const latestStrength = strengthTests[0];
  const measurementSampleCount = Math.max(0, ...(overview?.measurements || []).map((item) => item.sampleCount));
  const radar = useMemo(() => buildPerformanceRadar(latestStrength, diagnostics), [latestStrength, diagnostics]);
  const strengthChanges = useMemo(() => strengthChangeRows(strengthTests), [strengthTests]);
  const relativeStrength = useMemo(() => relativeStrengthRows(strengthTests), [strengthTests]);
  const selectedAthlete = props.athletes.find((athlete) => athlete.id === overviewAthleteId);

  const athleteRows = useMemo(() => props.athletes.map((athlete) => {
    const own = analysisRecords.filter((record) => record.athleteId === athlete.id);
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
  }), [props.athletes, analysisRecords]);

  const statusCount = useMemo(() => {
    const count = { normal: 0, attention: 0, alert: 0, rest: 0, missing: 0 };
    if (!isIndividualOverview) {
      for (const row of athleteRows) count[row.status] += 1;
      return count;
    }
    const byDate = groupByDate(analysisRecords);
    for (const dayRecords of byDate.values()) count[worstStatus(dayRecords)] += 1;
    return count;
  }, [analysisRecords, athleteRows, isIndividualOverview]);

  const statusTotal = Object.values(statusCount).reduce((sum, value) => sum + value, 0);
  const stableRate = percentage(statusCount.normal + statusCount.rest, statusTotal);
  const scopeLabel = isIndividualOverview
    ? `${selectedAthlete?.name || '本人'} · 个人纵向`
    : `${ROLE_META[props.user.role].label}权限范围 · ${scopeAthleteCount}人`;
  const perAthlete = (value: number) => value / Math.max(1, scopeAthleteCount);

  const storageKey = `jingji-overview-layout:${props.user.id}:${props.project}:${isIndividualOverview ? 'self' : 'team'}`;
  const [layout, setLayout] = useState<LayoutState>({ version: 4, order: defaultOrder, hidden: [], pinned: [] });
  const [layoutReady, setLayoutReady] = useState(false);
  const [activeMenu, setActiveMenu] = useState<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
  const dragSessionRef = useRef<PointerDragSession | null>(null);
  const lastDropTargetRef = useRef<DropTarget | null>(null);
  const suppressHandleClickRef = useRef(false);
  const flipRectsRef = useRef<Map<string, CardRect> | null>(null);

  useEffect(() => {
    setLayoutReady(false);
    try {
      const stored = JSON.parse(localStorage.getItem(storageKey) || '{}') as Partial<LayoutState>;
      const known = new Set(defaultOrder);
      const storedOrder = Array.isArray(stored.order) ? stored.order.filter((id) => known.has(id)) : [];
      const mergedOrder = [...storedOrder];
      for (const [index, id] of defaultOrder.entries()) {
        if (mergedOrder.includes(id)) continue;
        const nextKnown = defaultOrder.slice(index + 1).find((nextId) => mergedOrder.includes(nextId));
        if (nextKnown) mergedOrder.splice(mergedOrder.indexOf(nextKnown), 0, id);
        else mergedOrder.push(id);
      }
      if ((stored.version || 0) < 3) {
        const newProfileCards = ['athlete-profile', 'competitive-state', 'birthplace-map'];
        const withoutNewCards = mergedOrder.filter((id) => !newProfileCards.includes(id));
        const anchor = withoutNewCards.indexOf('recovery-time');
        withoutNewCards.splice(anchor >= 0 ? anchor + 1 : 0, 0, ...newProfileCards);
        mergedOrder.splice(0, mergedOrder.length, ...withoutNewCards);
      }
      setLayout({
        version: 4,
        order: mergedOrder,
        hidden: Array.isArray(stored.hidden) ? stored.hidden.filter((id) => known.has(id)) : [],
        pinned: Array.isArray(stored.pinned) ? stored.pinned.filter((id) => known.has(id)) : []
      });
    } catch {
      setLayout({ version: 4, order: defaultOrder, hidden: [], pinned: [] });
    }
    setLayoutReady(true);
  }, [storageKey]);

  useEffect(() => {
    if (layoutReady) localStorage.setItem(storageKey, JSON.stringify(layout));
  }, [layout, layoutReady, storageKey]);

  useEffect(() => () => {
    dragSessionRef.current?.cleanup();
  }, []);

  useLayoutEffect(() => {
    const before = flipRectsRef.current;
    if (!before) return;
    flipRectsRef.current = null;
    const grid = document.querySelector<HTMLElement>('.professional-dashboard-grid');
    if (!grid) return;
    const gridRect = grid.getBoundingClientRect();
    grid.querySelectorAll<HTMLElement>(':scope > .overview-card-shell').forEach((element) => {
      const id = element.dataset.cardId;
      const previous = id ? before.get(id) : null;
      if (!previous || id === dragging) return;
      element.getAnimations().forEach((animation) => animation.cancel());
      const current = stableCardRect(element, gridRect);
      const deltaX = previous.left - current.left;
      const deltaY = previous.top - current.top;
      if (Math.abs(deltaX) < 1 && Math.abs(deltaY) < 1) return;
      element.animate(
        [{ transform: `translate3d(${deltaX}px, ${deltaY}px, 0)` }, { transform: 'translate3d(0, 0, 0)' }],
        { duration: 230, easing: 'cubic-bezier(.2,.8,.2,1)' }
      );
    });
  }, [layout.order, dragging]);

  const togglePin = (id: string) => {
    setLayout((current) => {
      const pinned = current.pinned.includes(id) ? current.pinned.filter((item) => item !== id) : [...current.pinned, id];
      const order = current.pinned.includes(id) ? current.order : [id, ...current.order.filter((item) => item !== id)];
      return { ...current, pinned, order };
    });
    setActiveMenu(null);
  };

  const hideCard = (id: string) => {
    setLayout((current) => ({ ...current, hidden: [...new Set([...current.hidden, id])] }));
    setActiveMenu(null);
  };

  const restoreCard = (id: string) => setLayout((current) => ({ ...current, hidden: current.hidden.filter((item) => item !== id) }));

  const captureCardRects = () => {
    const grid = document.querySelector<HTMLElement>('.professional-dashboard-grid');
    if (!grid) return new Map<string, CardRect>();
    const gridRect = grid.getBoundingClientRect();
    return new Map(
      Array.from(grid.querySelectorAll<HTMLElement>(':scope > .overview-card-shell'))
        .flatMap((element) => element.dataset.cardId ? [[element.dataset.cardId, stableCardRect(element, gridRect)] as const] : [])
    );
  };

  const moveCard = (source: string, target: DropTarget) => {
    if (source === target.id) return;
    flushSync(() => {
      setLayout((current) => {
        const next = current.order.filter((id) => id !== source);
        const targetIndex = next.indexOf(target.id);
        const index = targetIndex < 0 ? next.length : targetIndex + (target.position === 'after' ? 1 : 0);
        next.splice(index, 0, source);
        if (next.every((id, position) => id === current.order[position])) return current;
        flipRectsRef.current = captureCardRects();
        return { ...current, order: next };
      });
    });
  };

  const beginPointerDrag = (event: ReactPointerEvent<HTMLButtonElement>, id: string) => {
    if (event.button !== 0) return;
    dragSessionRef.current?.cleanup();
    const session: PointerDragSession = {
      id, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY,
      offsetX: 0, offsetY: 0, active: false, preview: null, cleanup: () => undefined
    };
    const finish = () => {
      if (dragSessionRef.current !== session) return;
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleEnd);
      window.removeEventListener('pointercancel', handleEnd);
      window.removeEventListener('blur', finish);
      session.preview?.remove();
      document.body.classList.remove('overview-reordering');
      dragSessionRef.current = null;
      lastDropTargetRef.current = null;
      setDragging(null);
      setDropTarget(null);
      if (session.active) window.setTimeout(() => { suppressHandleClickRef.current = false; }, 0);
    };
    const handleEnd = (nativeEvent: PointerEvent) => {
      if (nativeEvent.pointerId === session.pointerId) finish();
    };
    const handleMove = (nativeEvent: PointerEvent) => {
      if (nativeEvent.pointerId !== session.pointerId) return;
      if (!session.active && Math.hypot(nativeEvent.clientX - session.startX, nativeEvent.clientY - session.startY) < 7) return;
      if (!session.active) {
        const grid = document.querySelector<HTMLElement>('.professional-dashboard-grid');
        const shell = Array.from(grid?.querySelectorAll<HTMLElement>(':scope > .overview-card-shell') || [])
          .find((element) => element.dataset.cardId === session.id);
        if (!shell) { finish(); return; }
        shell.getAnimations().forEach((animation) => animation.cancel());
        const rect = shell.getBoundingClientRect();
        const preview = shell.cloneNode(true) as HTMLElement;
        preview.classList.remove('is-dragging', 'is-drop-target');
        preview.classList.add('mobile-card-drag-preview');
        preview.setAttribute('aria-hidden', 'true');
        preview.querySelector('.overview-card-controls')?.remove();
        Object.assign(preview.style, { width: `${rect.width}px`, height: `${rect.height}px` });
        document.body.appendChild(preview);
        document.body.classList.add('overview-reordering');
        session.active = true;
        session.preview = preview;
        session.offsetX = nativeEvent.clientX - rect.left;
        session.offsetY = nativeEvent.clientY - rect.top;
        suppressHandleClickRef.current = true;
        setDragging(session.id);
        setActiveMenu(null);
      }
      nativeEvent.preventDefault();
      if (session.preview) {
        session.preview.style.transform = `translate3d(${nativeEvent.clientX - session.offsetX}px, ${nativeEvent.clientY - session.offsetY}px, 0) rotate(.35deg) scale(1.015)`;
      }
      const target = findDropTarget(nativeEvent.clientX, nativeEvent.clientY, session.id);
      const previous = lastDropTargetRef.current;
      if (previous?.id !== target?.id || previous?.position !== target?.position) {
        lastDropTargetRef.current = target;
        setDropTarget(target);
        if (target) moveCard(session.id, target);
      }
      const edge = 64;
      if (nativeEvent.clientY < edge) window.scrollBy({ top: -12, behavior: 'auto' });
      else if (nativeEvent.clientY > window.innerHeight - edge) window.scrollBy({ top: 12, behavior: 'auto' });
    };
    session.cleanup = finish;
    dragSessionRef.current = session;
    suppressHandleClickRef.current = false;
    window.addEventListener('pointermove', handleMove, { passive: false });
    window.addEventListener('pointerup', handleEnd);
    window.addEventListener('pointercancel', handleEnd);
    window.addEventListener('blur', finish);
  };

  const findDropTarget = (clientX: number, clientY: number, sourceId: string): DropTarget | null => {
    const grid = document.querySelector<HTMLElement>('.professional-dashboard-grid');
    if (!grid) return null;
    const gridRect = grid.getBoundingClientRect();
    if (clientX < gridRect.left - 24 || clientX > gridRect.right + 24 || clientY < gridRect.top - 24 || clientY > gridRect.bottom + 24) return null;
    const candidates = Array.from(grid.querySelectorAll<HTMLElement>(':scope > .overview-card-shell'))
      .filter((element) => element.dataset.cardId && element.dataset.cardId !== sourceId)
      .map((element) => ({ id: element.dataset.cardId as string, rect: stableCardRect(element, gridRect) }));
    if (!candidates.length) return null;
    const target = candidates.reduce<{ id: string; rect: CardRect; distance: number }>((nearest, candidate) => {
      const distanceX = Math.max(candidate.rect.left - clientX, 0, clientX - candidate.rect.right);
      const distanceY = Math.max(candidate.rect.top - clientY, 0, clientY - candidate.rect.bottom);
      const distance = Math.hypot(distanceX, distanceY);
      return distance < nearest.distance ? { ...candidate, distance } : nearest;
    }, { ...candidates[0], distance: Number.POSITIVE_INFINITY });
    if (target.distance > 30) return null;
    const targetCenterY = target.rect.top + target.rect.height / 2;
    const sharesVisualRow = candidates.some((candidate) => candidate.id !== target.id
      && Math.abs(candidate.rect.top + candidate.rect.height / 2 - targetCenterY) < Math.min(candidate.rect.height, target.rect.height) * .35);
    const after = sharesVisualRow
      ? clientX >= target.rect.left + target.rect.width / 2
      : clientY >= targetCenterY;
    return { id: target.id, position: after ? 'after' : 'before' };
  };

  const renderShell = (id: string, content: ReactNode) => {
    const meta = cardMeta[id];
    const pinned = layout.pinned.includes(id);
    return (
      <div
        key={id}
        data-card-id={id}
        className={`overview-card-shell card-size-${meta.size}${pinned ? ' is-pinned' : ''}${dragging === id ? ' is-dragging' : ''}${dropTarget?.id === id ? ' is-drop-target' : ''}`}
      >
        <div className="overview-card-controls" onClick={(event) => event.stopPropagation()}>
          <button
            className="card-more-button"
            type="button"
            title="点击管理卡片，按住拖动排序"
            aria-label={`${meta.title}卡片操作与拖动`}
            onPointerDown={(event) => beginPointerDrag(event, id)}
            onClick={() => { if (!suppressHandleClickRef.current) setActiveMenu((current) => current === id ? null : id); }}
          ><MoreHorizontal size={20} /></button>
          {activeMenu === id && (
            <div className="card-action-menu">
              <button type="button" onClick={() => togglePin(id)}><Pin size={14} />{pinned ? '取消置顶' : '置顶卡片'}</button>
              <button type="button" onClick={() => hideCard(id)}><EyeOff size={14} />隐藏卡片</button>
            </div>
          )}
        </div>
        {pinned && <span className="pinned-mark"><Pin size={11} />已置顶</span>}
        {content}
      </div>
    );
  };

  const cards: Record<string, ReactNode> = {
    duration: <Metric icon={<AlarmClock />} label={isIndividualOverview ? '累计训练时间' : '团队训练总时长'} value={formatNumber(summary.totalDuration / 60, 1)} unit="小时" note={isIndividualOverview ? `${summary.days}个记录日` : `人均 ${formatNumber(perAthlete(summary.totalDuration) / 60, 1)} 小时 · ${scopeAthleteCount}人`} tone="navy" />,
    distance: <Metric icon={<Route />} label={isIndividualOverview ? '专项距离' : '团队专项总距离'} value={formatNumber(summary.totalDistance, 1)} unit="km" note={isIndividualOverview ? `${props.project}周期累计` : `人均 ${formatNumber(perAthlete(summary.totalDistance), 1)} km`} tone="teal" />,
    srpe: <Metric icon={<Gauge />} label={isIndividualOverview ? 'SRPE总负荷' : '团队SRPE总负荷'} value={formatNumber(summary.totalSrpe)} unit="AU" note={isIndividualOverview ? '训练时间 × RPE' : `人均 ${formatNumber(perAthlete(summary.totalSrpe))} AU`} tone="orange" />,
    rpe: <Metric icon={<Activity />} label="平均主观强度" value={averageRpe ? formatNumber(averageRpe, 1) : '—'} unit="RPE" note="仅统计已填写记录" tone="blue" />,
    'acute-load': <Metric icon={<BarChart3 />} label={isIndividualOverview ? '近7日急性负荷' : '团队近7日人均负荷'} value={formatNumber(diagnostics.acuteLoad)} unit="AU" note={diagnostics.acuteChronicRatio === null ? '需至少28天数据计算负荷比' : `${isIndividualOverview ? '前21日周均比' : '前21日人均周负荷比'} ${diagnostics.acuteChronicRatio.toFixed(2)}`} tone="purple" />,
    'recovery-time': <Metric
      icon={<Clock3 />}
      label={isIndividualOverview ? '日均恢复时间' : '团队日均恢复时间'}
      value={recoveryTime.averageHours === null ? '—' : formatNumber(recoveryTime.averageHours, 1)}
      unit="小时"
      note={recoveryTime.adequateRate === null
        ? '暂无有效睡眠恢复记录'
        : `≥${recoveryTime.targetHours}h达标 ${formatNumber(recoveryTime.adequateRate, 1)}% · ${recoveryTime.validPersonDays}${isIndividualOverview ? '个记录日' : '人日'}`}
      tone="green"
    />,
    'athlete-profile': (
      <article className="panel professional-panel athlete-profile-panel">
        <PanelHeading title={isIndividualOverview ? '个人身体与年龄画像' : '队伍身体与年龄画像'} subtitle={`${scopeLabel} · 年龄 · 身高 · 体重`} />
        <AthleteProfileOverview profiles={athleteProfiles} individual={isIndividualOverview} />
        <p className="analysis-method-note">年龄由出生日期按分析截止日计算；身高体重读取不晚于截止日的最近一次身体测量。</p>
      </article>
    ),
    'competitive-state': (
      <article className="panel professional-panel competitive-state-panel">
        <PanelHeading title="竞技状态评估" subtitle={`${isIndividualOverview ? '本人' : '团队均值与等级分布'} · 六维综合`} />
        <CompetitiveStateOverview profiles={athleteProfiles} individual={isIndividualOverview} />
        <p className="analysis-method-note">竞技状态由专项耐力、力量爆发、技术效率、负荷适应、恢复和比赛能力综合形成，不替代教练现场判断。</p>
      </article>
    ),
    'birthplace-map': (
      <article className="panel professional-panel birthplace-map-panel">
        <PanelHeading title="生源地分布地图" subtitle={`${scopeLabel} · 籍贯省市 · 运动员明细`} />
        <BirthplaceMapOverview profiles={athleteProfiles} individual={isIndividualOverview} />
        <p className="analysis-method-note">生源地读取运动员籍贯档案，与账号所属区域及数据权限分开管理；地图仅展示当前账号有权访问的运动员。</p>
      </article>
    ),
    'performance-radar': (
      <article className="panel professional-panel">
        <PanelHeading title="六维运动表现画像" subtitle={`${scopeLabel} · 目标达成制`} />
        {strengthLoading ? <div className="professional-chart-empty">正在读取力量测试…</div> : <PerformanceRadarChart data={radar} />}
        <p className="analysis-method-note">评分只反映教练目标达成、双侧差异和本周期恢复记录，不用于选材或伤病诊断；未测试项不计0分。</p>
      </article>
    ),
    'load-response': (
      <article className="panel professional-panel">
        <PanelHeading title="训练负荷与机体刺激" subtitle={`${isIndividualOverview ? '个人' : '团队人均'} SRPE · SMVL · 日序列`} />
        <ProfessionalLoadChart data={daily} team={!isIndividualOverview} />
        <p className="analysis-method-note">{isIndividualOverview ? 'SRPE反映个人内部负荷，SMVL反映训练量刺激' : '团队曲线按权限范围内队员人数折算人均值，避免队伍人数变化放大总量'}；二者分离时应结合课表和恢复状态复核。</p>
      </article>
    ),
    'load-diagnostics': (
      <article className="panel professional-panel diagnostic-panel">
        <PanelHeading title="负荷诊断" subtitle="Foster单调度 · 应变" />
        <div className="diagnostic-metrics">
          <Diagnostic label="急/慢负荷比" value={diagnostics.acuteChronicRatio?.toFixed(2) || '待计算'} note="近7日 ÷ 前21日周均" />
          <Diagnostic label="训练单调度" value={diagnostics.monotony?.toFixed(2) || '待计算'} note="7日平均负荷 ÷ 标准差" />
          <Diagnostic label="训练应变" value={diagnostics.strain === null ? '待计算' : formatNumber(diagnostics.strain)} note="7日负荷 × 单调度" />
        </div>
        <div className="diagnostic-brief"><ShieldCheck size={18} /><p>{loadBrief(diagnostics.acuteChronicRatio, diagnostics.monotony, summary.alerts, diagnostics.dataCoverage, isIndividualOverview ? 'individual' : 'team')}</p></div>
        <p className="analysis-method-note">负荷比仅用于{isIndividualOverview ? '本人纵向' : '团队人均趋势'}监测，不作为伤病风险的单一判据。</p>
      </article>
    ),
    recovery: <article className="panel professional-panel"><PanelHeading title="恢复与机能趋势" subtitle={`${isIndividualOverview ? '个人' : '团队日均'} · 睡眠 · 晨脉 · 疲劳`} /><RecoveryTrendChart data={daily} /></article>,
    'strength-change': (
      <article className="panel professional-panel">
        <PanelHeading title="力量与爆发前后测" subtitle={`${isIndividualOverview ? '个人' : '团队均值'} · ${strengthTests[1] ? `${strengthTests[1].testDate} → ${strengthTests[0].testDate}` : '最近两次测试'}`} />
        {strengthLoading ? <div className="professional-chart-empty">正在读取力量测试…</div> : <StrengthChangeChart data={strengthChanges} />}
      </article>
    ),
    'relative-strength': (
      <article className="panel professional-panel">
        <PanelHeading title="相对力量" subtitle={`${isIndividualOverview ? '个人' : '团队均值'} · 1RM ÷ 体重`} />
        {strengthLoading ? <div className="professional-chart-empty">正在读取力量测试…</div> : <RelativeStrengthChart data={relativeStrength} />}
        <p className="analysis-method-note">{isIndividualOverview ? '相对力量用于本人纵向比较' : '当前为权限队员测试结果的团队均值，不代替个人评估'}；不同项目、性别和训练阶段应采用各自目标。</p>
      </article>
    ),
    structure: <article className="panel professional-panel structure-panel"><PanelHeading title="训练结构" subtitle={`${isIndividualOverview ? '个人' : '团队总量'} · 环境层级 · 训练目的`} /><StructureChart records={analysisRecords} /></article>,
    intensity: <article className="panel professional-panel"><PanelHeading title="强度分布" subtitle={`${isIndividualOverview ? '个人' : '团队总时长'} · U3—ATP`} /><IntensityChart records={analysisRecords} /></article>,
    status: (
      <article className="panel status-panel professional-panel">
        <div className="panel-heading"><div><h2>{isIndividualOverview ? '周期状态' : '团队状态分布'}</h2></div><button className="text-button" onClick={props.onOpenCalendar}>查看日历 <ArrowRight size={15} /></button></div>
        <div className="status-orbit"><div className="orbit-main"><strong>{isIndividualOverview ? statusCount.normal : `${stableRate}%`}</strong><span>{isIndividualOverview ? '正常日' : '状态稳定'}</span></div><div className="orbit-ring" aria-hidden="true" /></div>
        <div className="status-counts">
          <div><i className="dot normal" /><span>正常</span><strong>{statusCount.normal}</strong></div><div><i className="dot attention" /><span>关注</span><strong>{statusCount.attention}</strong></div><div><i className="dot alert" /><span>异常</span><strong>{statusCount.alert}</strong></div><div><i className="dot rest" /><span>休息</span><strong>{statusCount.rest}</strong></div><div><i className="dot missing" /><span>缺失</span><strong>{statusCount.missing}</strong></div>
        </div>
      </article>
    ),
    'water-zones': <article className="panel professional-panel water-zone-panel"><PanelHeading title="水上强度距离与时间" subtitle={`${isIndividualOverview ? '个人' : '团队总量'} · 距离 · 时间 · /500m配速`} /><WaterIntensityLoadChart records={analysisRecords} /></article>,
    'project-indicators': <article className="panel professional-panel indicator-panel"><PanelHeading title={`${props.project}专项指标矩阵`} subtitle={`${isIndividualOverview ? '最近批次' : `团队均值 · n=${measurementSampleCount || '—'}`} · 统一测试指标`} /><IndicatorMatrix project={props.project} latest={latestStrength} measurements={measurementMap} /></article>,
    'movement-efficiency': (
      <article className="panel professional-panel movement-panel">
        <PanelHeading title="动作效率与代偿" subtitle={`${isIndividualOverview ? '个人' : `团队均值 · n=${measurementSampleCount || '—'}`} · 功能控制`} /><MovementMatrix latest={latestStrength} measurements={measurementMap} />
        <p className="analysis-method-note">动作评分来自统一测试批次；单腿蹲对称性由左右实测次数自动计算。</p>
      </article>
    ),
    roster: (
      <article className="panel professional-panel roster-preview">
        <div className="panel-heading"><div><h2>运动员状态</h2></div><span className="count-chip"><UsersRound size={14} /> {athleteRows.length}人</span></div>
        <div className="table-scroll"><table className="data-table">
          <thead><tr><th>运动员</th><th>所属地区</th><th>项目 / 组别</th><th>最新状态</th><th>周期SRPE</th><th>平均睡眠</th><th>疲劳指数</th></tr></thead>
          <tbody>{athleteRows.map((row) => <tr key={row.athlete.id}>
            <td><strong><EditableName value={row.athlete.name} canEdit={ROLE_META[props.user.role].level > 1} onSave={(name) => props.onAthleteNameChange(row.athlete.id, name)} label="运动员姓名" /></strong>{row.athlete.coachUsers?.length ? <small className="athlete-coach-names">{row.athlete.coachUsers.map((coach) => <EditableName key={coach.id} value={coach.displayName} canEdit={ROLE_META[props.user.role].level > ROLE_META.SCC.level} onSave={(name) => props.onUserNameChange(coach.id, name)} label="教练姓名" />)}</small> : <small>未绑定教练</small>}</td>
            <td>{[row.athlete.region, row.athlete.city, row.athlete.county].filter(Boolean).join(' / ') || '未设置'}</td><td>{row.athlete.project}<small>{row.athlete.team}</small></td><td><StatusPill status={row.status} compact /></td><td>{formatNumber(row.load)}</td><td>{row.sleep ? `${row.sleep.toFixed(1)} h` : '—'}</td><td>{row.fatigue ? row.fatigue.toFixed(1) : '—'}</td>
          </tr>)}</tbody>
        </table></div>
      </article>
    )
  };

  return (
    <div className="page-content professional-overview" onClick={() => setActiveMenu(null)}>
      <header className="page-heading">
        <div><h1>{isIndividualOverview ? '我的训练总览' : '团队训练总览'}</h1><p className="overview-heading-note"><Sparkles size={14} />{scopeLabel} · 所有评分均基于权限范围内实测数据</p></div>
        <DateToolbar {...props} athleteId={overviewAthleteId} athleteMode={isIndividualOverview ? 'self' : 'team'} presetMode="dayWeekMonth" canRenameAthletes={false} onAthleteNameChange={props.onAthleteNameChange} />
      </header>
      {overview && <div className={`overview-data-provenance${overview.meta.containsDemoData ? ' demo' : ''}`}>
        <Database size={15} /><strong>{overview.meta.containsDemoData ? '演示数据模式' : '正式数据'} · {overview.meta.scope === 'team' ? '团队聚合' : '个人纵向'}</strong>
        <span>{overview.meta.athleteCount}名运动员 · {overview.meta.sessionCount}堂训练 · {overview.meta.wellnessDays}条恢复记录 · {overview.meta.testCount}次测试</span>
        <small>来源：{overview.meta.sources.join('、') || '未标记'} · 完整率 {formatNumber(overview.meta.coverage, 1)}%</small>
      </div>}
      {overviewError && <div className="overview-data-provenance error"><Database size={15} /><strong>统一指标接口暂不可用</strong><span>{overviewError}，当前显示兼容数据。</span></div>}
      {layout.hidden.length > 0 && <div className="hidden-card-restore" onClick={(event) => event.stopPropagation()}><Eye size={15} /><span>已隐藏 {layout.hidden.length} 项</span>{layout.hidden.map((id) => <button key={id} type="button" onClick={() => restoreCard(id)}>{cardMeta[id].title}</button>)}</div>}
      {props.loading || (overviewLoading && !overview) ? <PageSkeleton /> : <section className="professional-dashboard-grid">{layout.order.filter((id) => !layout.hidden.includes(id) && (isIndividualOverview ? id !== 'roster' : true)).map((id) => renderShell(id, cards[id]))}</section>}
    </div>
  );
}

function PanelHeading({ title, subtitle }: { title: string; subtitle: string }) {
  return <div className="panel-heading professional-heading"><div><h2>{title}</h2></div><small>{subtitle}</small></div>;
}

function Metric({ icon, label, value, unit, note, tone }: { icon: ReactNode; label: string; value: string; unit: string; note: string; tone: string }) {
  return <article className={`metric-card tone-${tone}`}><div className="metric-icon">{icon}</div><div className="metric-copy"><span>{label}</span><strong>{value}<small>{unit}</small></strong><p>{note}</p></div><div className="metric-waterline" aria-hidden="true" /></article>;
}

function Diagnostic({ label, value, note }: { label: string; value: string; note: string }) {
  return <div><span>{label}</span><strong>{value}</strong><small>{note}</small></div>;
}

function loadBrief(ratio: number | null, monotony: number | null, alerts: number, coverage: number, scope: 'individual' | 'team') {
  if (coverage < 60) return '监测数据完整率偏低，应先补齐RPE、晨脉、睡眠和疲劳记录，再判断训练适应。';
  if (alerts) return `本周期存在${alerts}条异常标记，应结合专项课表、恢复状态和教练观察逐条复核。`;
  if (ratio !== null && ratio > 1.5) return '近7日负荷相对前期周均增幅较大，建议结合恢复趋势确认是否继续递增。';
  if (monotony !== null && monotony > 2) return '近7日负荷变化较小、单调度较高，建议检查高低负荷日是否形成有效波动。';
  return scope === 'team'
    ? '当前团队人均负荷与恢复记录未见明显冲突，仍需结合队员分布识别被均值掩盖的个体异常。'
    : '当前负荷与恢复记录未见明显冲突，继续保持统一口径并观察个人纵向变化。';
}

type IndicatorDefinition = { id: string; label: string; note: string };
const projectIndicatorMap: Record<Project, IndicatorDefinition[]> = {
  赛艇: [
    { id: 'cmj', label: 'CMJ纵跳', note: '下肢爆发能力' }, { id: 'relative-squat', label: '相对深蹲', note: '基础力量/体重' },
    { id: 'seven-stroke', label: '7桨平均功率', note: '动态与代谢功率' }, { id: 'dsd', label: 'DSD动态力量缺陷', note: 'IMTP与CMJ力量平衡' },
    { id: 'rowing-erg', label: '2km/6km测功仪', note: '专项有氧能力' }, { id: 'rowing-technique', label: '船速/桨频/单桨距离', note: '艇上技术效率' }
  ],
  皮划艇: [
    { id: 'cmj', label: 'CMJ纵跳', note: '下肢爆发能力' }, { id: 'bench-pull', label: '卧拉力量', note: '上肢拉力基础' },
    { id: 'canoe-sprint', label: '分段竞速', note: '200米与500米' }, { id: 'canoe-technique', label: '桨频与航速', note: '专项技术效率' },
    { id: 'paddle-symmetry', label: '左右功率差', note: '双侧输出对称' }, { id: 'threshold', label: '乳酸与心率阈', note: '有氧/无氧转换' }
  ],
  激流: [
    { id: 'bench-power', label: '卧推峰值功率', note: '上肢推力功率' }, { id: 'pull-power', label: '卧拉峰值功率', note: '上肢拉力功率' },
    { id: 'wingate', label: 'Wingate峰值功率', note: '无氧爆发能力' }, { id: 'threshold-power', label: '乳酸阈功率', note: '专项持续输出' },
    { id: 'slalom-sprint', label: '300米静水竞速', note: '专项速度能力' }, { id: 'grip', label: '左右握力', note: '桨控与双侧差异' }
  ]
};

function measurementValue(measurements: Map<string, OverviewMeasurement>, code: string) {
  const value = measurements.get(code)?.value;
  return typeof value === 'number' ? value : null;
}

function secondsLabel(value: number | null) {
  if (value === null) return null;
  const minutes = Math.floor(value / 60);
  return `${minutes}:${String(Math.round(value % 60)).padStart(2, '0')}`;
}

function indicatorValue(id: string, latest: StrengthTest | undefined, measurements: Map<string, OverviewMeasurement>) {
  const metric = (code: string) => measurementValue(measurements, code);
  const strength = (key: StrengthMetricKey) => typeof latest?.metrics[key] === 'number' ? latest.metrics[key] as number : null;
  const pair = (left: number | null, right: number | null, unit: string) => left !== null && right !== null ? `${formatNumber(left, 1)} / ${formatNumber(right, 1)} ${unit}` : null;
  if (id === 'cmj') return strength('verticalJumpCm') === null ? null : `${formatNumber(strength('verticalJumpCm')!, 1)} cm`;
  if (id === 'relative-squat') {
    const squat = strength('squatKg'); const weight = strength('weightKg');
    return squat !== null && weight !== null && weight > 0 ? `${formatNumber(squat / weight, 2)} 倍体重` : null;
  }
  if (id === 'seven-stroke') return metric('seven_stroke_power_w') === null ? null : `${formatNumber(metric('seven_stroke_power_w')!, 0)} W`;
  if (id === 'dsd') return metric('dsd_ratio') === null ? null : formatNumber(metric('dsd_ratio')!, 2);
  if (id === 'rowing-erg') {
    const two = secondsLabel(metric('erg_2k_sec')); const six = secondsLabel(metric('erg_6k_sec'));
    return two && six ? `2k ${two} / 6k ${six}` : null;
  }
  if (id === 'rowing-technique') {
    const speed = metric('boat_speed_mps'); const stroke = metric('stroke_rate_spm'); const distance = metric('distance_per_stroke_m');
    return speed !== null && stroke !== null && distance !== null ? `${speed.toFixed(2)}m/s · ${stroke.toFixed(0)}spm · ${distance.toFixed(2)}m` : null;
  }
  if (id === 'bench-pull') return strength('benchPullKg') === null ? null : `${formatNumber(strength('benchPullKg')!, 1)} kg`;
  if (id === 'canoe-sprint') return pair(metric('sprint_200_sec'), metric('sprint_500_sec'), 's');
  if (id === 'canoe-technique') {
    const stroke = metric('stroke_rate_spm'); const speed = metric('boat_speed_mps');
    return stroke !== null && speed !== null ? `${stroke.toFixed(0)} spm / ${speed.toFixed(2)} m/s` : null;
  }
  if (id === 'paddle-symmetry') {
    const left = metric('left_paddle_power_w'); const right = metric('right_paddle_power_w');
    return left !== null && right !== null && Math.max(left, right) > 0 ? `${(Math.abs(left - right) / Math.max(left, right) * 100).toFixed(1)}%` : null;
  }
  if (id === 'threshold') {
    const lactate = metric('lactate_threshold_mmol'); const heartRate = strength('anaerobicThresholdHr');
    return lactate !== null && heartRate !== null ? `${lactate.toFixed(1)} mmol/L · ${heartRate.toFixed(0)} bpm` : lactate !== null ? `${lactate.toFixed(1)} mmol/L` : null;
  }
  const strengthIndicator: Partial<Record<string, [StrengthMetricKey, string]>> = {
    'bench-power': ['benchPressPeakPowerW', 'W'], 'pull-power': ['benchPullPeakPowerW', 'W'],
    wingate: ['wingatePeakPowerWkg', 'W/kg'], 'threshold-power': ['thresholdErgPowerW', 'W'],
    'slalom-sprint': ['sprint300Sec', 's']
  };
  const mapped = strengthIndicator[id];
  if (mapped) return strength(mapped[0]) === null ? null : `${formatNumber(strength(mapped[0])!, 1)} ${mapped[1]}`;
  if (id === 'grip') return pair(strength('leftGripKgf'), strength('rightGripKgf'), 'kgf');
  return null;
}

function IndicatorMatrix({ project, latest, measurements }: { project: Project; latest?: StrengthTest; measurements: Map<string, OverviewMeasurement> }) {
  return <div className="indicator-matrix">{projectIndicatorMap[project].map((item) => {
    const value = indicatorValue(item.id, latest, measurements);
    return <div key={item.id} className={value ? 'available' : 'missing'}><span>{item.label}</span><strong>{value || '待补测'}</strong><small>{item.note}</small></div>;
  })}</div>;
}

function MovementMatrix({ latest, measurements }: { latest?: StrengthTest; measurements: Map<string, OverviewMeasurement> }) {
  const score = (code: string) => {
    const value = measurementValue(measurements, code);
    return value === null ? null : `${formatNumber(value, 0)}分`;
  };
  const rows = [
    { label: '双腿深蹲', detail: '足踝、膝、髋与躯干代偿', value: score('movement_squat_score') },
    { label: '足跟抬起控制', detail: '踝关节活动与重心控制', value: score('movement_heel_lift_score') },
    { label: '单腿蹲对称', detail: '膝内扣与左右功能控制', value: symmetryLabel(latest?.metrics.leftSingleLegSquatReps, latest?.metrics.rightSingleLegSquatReps) },
    { label: '俯卧撑动作', detail: '头前伸与躯干稳定', value: score('movement_pushup_score') },
    { label: '肩关节活动', detail: '屈曲与内旋代偿', value: score('movement_shoulder_score') },
    { label: '躯干/腰椎', detail: '旋转与骨盆控制', value: score('movement_trunk_score') },
    { label: '颈椎控制', detail: '头位与上肢动作协同', value: score('movement_cervical_score') },
    { label: '柔韧能力', detail: '坐位体前屈', value: typeof latest?.metrics.sitReachCm === 'number' ? `${latest.metrics.sitReachCm.toFixed(1)} cm` : null }
  ];
  return <div className="movement-matrix">{rows.map((row) => <div key={row.label} className={row.value ? 'available' : 'missing'}><i /><span><strong>{row.label}</strong><small>{row.detail}</small></span><b>{row.value || '待补测'}</b></div>)}</div>;
}

function symmetryLabel(left?: number, right?: number) {
  if (typeof left !== 'number' || typeof right !== 'number' || Math.max(left, right) <= 0) return null;
  return `差异 ${(Math.abs(left - right) / Math.max(left, right) * 100).toFixed(1)}%`;
}

function PageSkeleton() {
  return <div className="page-skeleton"><div /><div /><div /><div /><section /></div>;
}
