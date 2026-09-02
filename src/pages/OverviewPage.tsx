import {
  AlarmClock, ArrowRight, BarChart3, Database, Dumbbell,
  Eye, EyeOff, Gauge, HeartPulse, Layers3, MoreHorizontal, Pin, Search,
  ShieldCheck, UsersRound
} from 'lucide-react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent, ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { api } from '../api';
import type { Athlete, OverviewLayoutState, OverviewMeasurement, OverviewPayload, Project, StrengthTest, TrainingRecord, User } from '../types';
import { addDays, aggregateRecords, average, formatNumber, groupByDate, percentage, worstStatus } from '../utils';
import { ROLE_META } from '../../shared/access';
import { DateToolbar } from '../components/DateToolbar';
import {
  PerformanceRadarChart, RecoveryTrendChart
} from '../components/LoadCharts';
import {
  BasicStrengthAnalysis, FmsTeamChart, InjuryAssessmentChart, RpeStatisticsChart,
  TrainingContentChart, TrainingLoadComparisonChart, TrainingVolumeChart, trainingLoadCategory
} from '../components/TrainingAnalysisCharts';
import { StatusPill } from '../components/StatusPill';
import { AthleteProfileOverview, BirthplaceMapOverview, CompetitiveStateOverview } from '../components/AthleteProfileCharts';
import {
  buildDailyPerformance, buildPerformanceRadar, calculateLoadDiagnostics,
  relativeStrengthRows, strengthChangeRows
} from '../overview-analytics';

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
  onUserNameChange: (id: number, name: string) => Promise<void>;
};

type CardSize = 'metric' | 'third' | 'half' | 'wide' | 'full';
type DropTarget = { id: string; position: 'before' | 'after' };
type CardRect = { left: number; top: number; right: number; bottom: number; width: number; height: number };
type OverviewPeriod = 'day' | 'week' | 'month';
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

function overviewPeriodFromRange(from: string, to: string): OverviewPeriod | undefined {
  if (from === to) return 'day';
  const start = new Date(`${from}T00:00:00`);
  const end = new Date(`${to}T00:00:00`);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) return undefined;
  const days = Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1;
  if (days === 7) return 'week';
  if (days === 30) return 'month';
  return undefined;
}

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
  'fms-analysis', 'performance-radar', 'strength-analysis', 'injury-analysis',
  'training-load-analysis', 'training-volume', 'training-content', 'rpe-analysis',
  'load-diagnostics', 'recovery', 'roster'
];

const cardMeta: Record<string, { title: string; size: CardSize }> = {
  duration: { title: '训练时长', size: 'metric' },
  distance: { title: '疲劳指数', size: 'metric' },
  srpe: { title: '平均负荷', size: 'metric' },
  rpe: { title: '运动员总数', size: 'metric' },
  'acute-load': { title: '训练负荷', size: 'metric' },
  'recovery-time': { title: '损伤情况', size: 'metric' },
  'athlete-profile': { title: '身体与年龄画像', size: 'full' },
  'competitive-state': { title: '竞技状态评估', size: 'half' },
  'birthplace-map': { title: '代表单位/输送单位', size: 'full' },
  'fms-analysis': { title: 'FMS测试全队分析', size: 'half' },
  'performance-radar': { title: '六维运动表现画像', size: 'half' },
  'strength-analysis': { title: '基础力量分析', size: 'full' },
  'injury-analysis': { title: '运动损伤评估', size: 'half' },
  'training-load-analysis': { title: '体能与专项训练负荷分析', size: 'full' },
  'training-volume': { title: '训练量统计', size: 'wide' },
  'training-content': { title: '训练内容统计', size: 'half' },
  'rpe-analysis': { title: 'RPE统计', size: 'half' },
  'load-diagnostics': { title: '负荷诊断', size: 'third' },
  recovery: { title: '恢复与机能趋势', size: 'wide' },
  roster: { title: '运动员状态', size: 'full' }
};

function normalizeOverviewLayout(stored: Partial<OverviewLayoutState> | null | undefined): OverviewLayoutState {
  const known = new Set(defaultOrder);
  const storedOrder = Array.isArray(stored?.order) ? stored.order.filter((id) => known.has(id)) : [];
  const mergedOrder = [...storedOrder];
  for (const [index, id] of defaultOrder.entries()) {
    if (mergedOrder.includes(id)) continue;
    const nextKnown = defaultOrder.slice(index + 1).find((nextId) => mergedOrder.includes(nextId));
    if (nextKnown) mergedOrder.splice(mergedOrder.indexOf(nextKnown), 0, id);
    else mergedOrder.push(id);
  }
  if ((stored?.version || 0) < 3) {
    const newProfileCards = ['athlete-profile', 'competitive-state', 'birthplace-map'];
    const withoutNewCards = mergedOrder.filter((id) => !newProfileCards.includes(id));
    const anchor = withoutNewCards.indexOf('recovery-time');
    withoutNewCards.splice(anchor >= 0 ? anchor + 1 : 0, 0, ...newProfileCards);
    mergedOrder.splice(0, mergedOrder.length, ...withoutNewCards);
  }
  return {
    version: 6,
    order: mergedOrder,
    hidden: Array.isArray(stored?.hidden) ? stored.hidden.filter((id) => known.has(id)) : [],
    pinned: Array.isArray(stored?.pinned) ? stored.pinned.filter((id) => known.has(id)) : []
  };
}

export function OverviewPage(props: Props) {
  const [overview, setOverview] = useState<OverviewPayload | null>(null);
  const [overviewLoading, setOverviewLoading] = useState(false);
  const [overviewError, setOverviewError] = useState('');
  const [rosterSearch, setRosterSearch] = useState('');
  const isIndividualOverview = props.user.role === 'ATL';
  const overviewAthleteId = isIndividualOverview ? props.user.athleteId : null;
  const overviewPeriod = useMemo(() => overviewPeriodFromRange(props.from, props.to), [props.from, props.to]);

  useEffect(() => {
    if (props.athleteId !== overviewAthleteId) props.onAthleteChange(overviewAthleteId);
  }, [overviewAthleteId, props.athleteId, props.onAthleteChange]);

  useEffect(() => {
    let active = true;
    setOverviewLoading(true);
    setOverviewError('');
    api.overview(props.from, props.to, overviewAthleteId, props.project, overviewPeriod)
      .then(({ overview: payload }) => { if (active) setOverview(payload); })
      .catch((error) => {
        if (!active) return;
        setOverview(null);
        setOverviewError(error instanceof Error ? error.message : '统一总览数据读取失败');
      })
      .finally(() => { if (active) setOverviewLoading(false); });
    return () => { active = false; };
  }, [props.from, props.to, overviewAthleteId, props.project, overviewPeriod]);

  const analysisRecords = overview?.records ?? props.records;
  const athleteProfiles = overview?.profiles ?? [];
  const strengthTests = overview?.strengthTests ?? [];
  const strengthLoading = overviewLoading;
  const measurementMap = useMemo(() => new Map((overview?.measurements || []).map((item) => [item.code, item])), [overview]);
  const summary = useMemo(() => aggregateRecords(analysisRecords), [analysisRecords]);
  const durationBreakdown = useMemo(() => analysisRecords
    .filter((record) => record.status !== 'rest')
    .reduce((totals, record) => {
      totals[trainingLoadCategory(record)] += record.durationMin;
      return totals;
    }, { physical: 0, special: 0 }), [analysisRecords]);
  const recentLoadBreakdown = useMemo(() => {
    const from = addDays(props.to, -6);
    return analysisRecords
      .filter((record) => record.status !== 'rest' && record.date >= from && record.date <= props.to)
      .reduce((totals, record) => {
        totals[trainingLoadCategory(record)] += record.srpe;
        return totals;
      }, { physical: 0, special: 0 });
  }, [analysisRecords, props.to]);
  const recentTrainingLoad = recentLoadBreakdown.physical + recentLoadBreakdown.special;
  const averageLoadBreakdown = useMemo(() => analysisRecords
    .filter((record) => record.status !== 'rest')
    .reduce((totals, record) => {
      totals[trainingLoadCategory(record)] += record.srpe;
      return totals;
    }, { physical: 0, special: 0 }), [analysisRecords]);
  const fatigueSummary = useMemo(() => {
    const athleteDays = new Map<string, number>();
    for (const record of analysisRecords) {
      if (typeof record.fatigueIndex !== 'number' || !Number.isFinite(record.fatigueIndex)) continue;
      const key = `${record.athleteId}:${record.date}`;
      if (!athleteDays.has(key)) athleteDays.set(key, record.fatigueIndex);
    }
    const values = [...athleteDays.values()];
    const averageValue = values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
    return {
      average: averageValue,
      validDays: values.length,
      highDays: values.filter((value) => value >= 6).length
    };
  }, [analysisRecords]);
  const scopeAthleteCount = overview?.meta.athleteCount || new Set(analysisRecords.map((record) => record.athleteId)).size || props.athletes.length || 1;
  const injurySummary = useMemo(() => {
    const injuries = overview?.injuries || [];
    const counts = { healthy: 0, observation: 0, restricted: 0, rehab: 0, suspended: 0 };
    for (const injury of injuries) counts[injury.status] += 1;
    counts.healthy += Math.max(0, scopeAthleteCount - injuries.length);
    const active = counts.observation + counts.restricted + counts.rehab + counts.suspended;
    const limited = counts.restricted + counts.rehab + counts.suspended;
    return { ...counts, active, limited };
  }, [overview?.injuries, scopeAthleteCount]);
  const daily = useMemo(
    () => buildDailyPerformance(analysisRecords, props.from, props.to, isIndividualOverview ? 'individual' : 'team', scopeAthleteCount),
    [analysisRecords, props.from, props.to, isIndividualOverview, scopeAthleteCount]
  );
  const diagnostics = useMemo(() => calculateLoadDiagnostics(analysisRecords, daily), [analysisRecords, daily]);

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
  const visibleAthleteRows = useMemo(() => {
    const query = rosterSearch.trim().toLowerCase();
    const filtered = query ? athleteRows.filter(({ athlete }) => [
      athlete.name, athlete.project, athlete.team, athlete.athletePosition, athlete.region, athlete.city, athlete.county,
      athlete.coachUsers?.map((coach) => coach.displayName).join(' ')
    ].filter(Boolean).join(' ').toLowerCase().includes(query)) : athleteRows;
    return filtered.slice(0, 5);
  }, [athleteRows, rosterSearch]);

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

  const layoutScope = isIndividualOverview ? 'self' : 'team';
  const storageKey = `jingji-overview-layout:${props.user.id}:${props.project}:${layoutScope}`;
  const [layout, setLayout] = useState<OverviewLayoutState>(() => normalizeOverviewLayout(null));
  const [layoutReady, setLayoutReady] = useState(false);
  const [activeMenu, setActiveMenu] = useState<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
  const dragSessionRef = useRef<PointerDragSession | null>(null);
  const lastDropTargetRef = useRef<DropTarget | null>(null);
  const suppressHandleClickRef = useRef(false);
  const flipRectsRef = useRef<Map<string, CardRect> | null>(null);

  useEffect(() => {
    let active = true;
    setLayoutReady(false);
    const readLocalLayout = () => {
      try {
        return normalizeOverviewLayout(JSON.parse(localStorage.getItem(storageKey) || '{}') as Partial<OverviewLayoutState>);
      } catch {
        return normalizeOverviewLayout(null);
      }
    };

    api.getOverviewLayout(props.project, layoutScope)
      .then(({ layout: remoteLayout }) => {
        if (!active) return;
        setLayout(remoteLayout ? normalizeOverviewLayout(remoteLayout) : readLocalLayout());
      })
      .catch(() => {
        if (active) setLayout(readLocalLayout());
      })
      .finally(() => {
        if (active) setLayoutReady(true);
      });
    return () => { active = false; };
  }, [layoutScope, props.project, storageKey]);

  useEffect(() => {
    if (!layoutReady) return undefined;
    localStorage.setItem(storageKey, JSON.stringify(layout));
    const timeout = window.setTimeout(() => {
      api.saveOverviewLayout(props.project, layoutScope, layout).catch(() => undefined);
    }, 350);
    return () => window.clearTimeout(timeout);
  }, [layout, layoutReady, layoutScope, props.project, storageKey]);

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
    const size = id === 'athlete-profile' && isIndividualOverview ? 'half' : meta.size;
    const pinned = layout.pinned.includes(id);
    return (
      <div
        key={id}
        data-card-id={id}
        className={`overview-card-shell card-size-${size}${pinned ? ' is-pinned' : ''}${dragging === id ? ' is-dragging' : ''}${dropTarget?.id === id ? ' is-drop-target' : ''}`}
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
    duration: <Metric
      icon={<AlarmClock />}
      label="训练时长"
      value={formatNumber(summary.totalDuration / 60, 1)}
      unit="小时"
      note={`体能 ${formatNumber(durationBreakdown.physical / 60, 1)}h · 专项 ${formatNumber(durationBreakdown.special / 60, 1)}h`}
      tone="navy"
    />,
    distance: <Metric
      icon={<Gauge />}
      label="疲劳指数"
      value={fatigueSummary.average === null ? '—' : formatNumber(fatigueSummary.average, 1)}
      unit={fatigueSummary.average === null ? '' : '分'}
      note={fatigueSummary.average === null ? '暂无疲劳记录' : `有效 ${fatigueSummary.validDays}人日 · 偏高 ${fatigueSummary.highDays}人日`}
      tone="teal"
    />,
    srpe: <Metric
      icon={<Gauge />}
      label="平均负荷"
      value={formatNumber(perAthlete(summary.totalSrpe))}
      unit="AU"
      note={`体能 ${formatNumber(perAthlete(averageLoadBreakdown.physical))}AU · 专项 ${formatNumber(perAthlete(averageLoadBreakdown.special))}AU`}
      tone="orange"
    />,
    rpe: <Metric icon={<UsersRound />} label={isIndividualOverview ? '当前运动员' : '运动员总数'} value={formatNumber(scopeAthleteCount)} unit="人" note={isIndividualOverview ? '个人视图 · 本人数据' : `${props.project} · 权限范围内全部运动员`} tone="blue" />,
    'acute-load': <Metric
      icon={<BarChart3 />}
      label="训练负荷"
      value={formatNumber(recentTrainingLoad)}
      unit="AU"
      note={`体能 ${formatNumber(recentLoadBreakdown.physical)}AU · 专项 ${formatNumber(recentLoadBreakdown.special)}AU`}
      tone="purple"
    />,
    'recovery-time': <Metric
      icon={<HeartPulse />}
      label="损伤情况"
      value={formatNumber(injurySummary.active)}
      unit="人"
      note={injurySummary.active
        ? `观察 ${injurySummary.observation}人 · 受限/康复/停训 ${injurySummary.limited}人`
        : '当前无活动性损伤'}
      tone="green"
    />,
    'athlete-profile': (
      <article className={`panel professional-panel athlete-profile-panel${isIndividualOverview ? '' : ' team-profile-dashboard'}`}>
        <PanelHeading title={isIndividualOverview ? '个人身体与年龄画像' : '基本信息'} subtitle={isIndividualOverview ? `${scopeLabel} · 年龄 · 身高 · 体重` : `当前队伍 · ${athleteProfiles.length}名运动员 · 身体基础数据`} />
        <AthleteProfileOverview profiles={athleteProfiles} individual={isIndividualOverview} />
      </article>
    ),
    'competitive-state': (
      <article className="panel professional-panel competitive-state-panel">
        <PanelHeading title="竞技状态六维分析" subtitle={`${isIndividualOverview ? '本人' : '团队均值与等级分布'} · 专项耐力 · 力量爆发 · 技术效率 · 负荷适应 · 恢复 · 比赛能力`} />
        <CompetitiveStateOverview profiles={athleteProfiles} individual={isIndividualOverview} />
        <p className="analysis-method-note">六维能力由专项耐力、力量爆发、技术效率、负荷适应、恢复和比赛能力综合形成；与上方「竞技水平」分数分布互为补充，不替代教练现场判断。</p>
      </article>
    ),
    'birthplace-map': (
      <article className="panel professional-panel birthplace-map-panel">
        <PanelHeading title="代表单位/输送单位" subtitle={`${scopeLabel} · 省份分布 · 运动员成绩与竞技状态`} />
        <BirthplaceMapOverview profiles={athleteProfiles} individual={isIndividualOverview} />
        <p className="analysis-method-note">生源地读取运动员籍贯档案，与账号所属区域及数据权限分开管理；地图仅展示当前账号有权访问的运动员。</p>
      </article>
    ),
      'fms-analysis': (
      <article className="panel professional-panel analysis-feature-panel">
        <PanelHeading title="FMS测试全队分析" subtitle={`${isIndividualOverview ? '个人FMS' : `最近一次团队测试 · n=${measurementSampleCount || '—'}`} · 标准七项21分制`} />
        <FmsTeamChart measurements={overview?.measurements || []} />
        <p className="analysis-method-note">每个动作按0–3分计，团队柱为最近一次测试的单项平均分；2分表示动作模式基本达标，低于2分列入纠正训练。七项齐全时汇总为21分制队均，14分仅作复查参考，不单独用于判断损伤风险。</p>
      </article>
    ),
    'performance-radar': (
      <article className="panel professional-panel">
        <PanelHeading title="全队多要素分析雷达图" subtitle={`${scopeLabel} · 目标达成制`} />
        {strengthLoading ? <div className="professional-chart-empty">正在读取力量测试…</div> : <PerformanceRadarChart data={radar} />}
        <p className="analysis-method-note">评分只反映教练目标达成、双侧差异和本周期恢复记录，不用于选材或伤病诊断；未测试项不计0分。</p>
      </article>
    ),
    'strength-analysis': (
      <article className="panel professional-panel analysis-feature-panel">
        <PanelHeading title="基础力量分析" subtitle={`${isIndividualOverview ? '个人' : '全队均值'} · 前后测变化 · 相对力量`} />
        <BasicStrengthAnalysis changes={strengthChanges} relative={relativeStrength} />
        <p className="analysis-method-note">合并原“力量与爆发前后测”和“相对力量”，同时观察变化率与倍体重水平，悬浮可查看精确数值。</p>
      </article>
    ),
    'injury-analysis': (
      <article className="panel professional-panel analysis-feature-panel">
        <PanelHeading title="运动损伤评估图" subtitle={`${scopeLabel} · 最新伤病记录 · 训练可用性`} />
        <InjuryAssessmentChart injuries={overview?.injuries || []} athleteCount={scopeAthleteCount} />
        <p className="analysis-method-note">按每名运动员最新记录统计健康、观察、受限、康复和停训状态，不能替代医学诊断。</p>
      </article>
    ),
    'training-load-analysis': (
      <article className="panel professional-panel analysis-feature-panel">
        <PanelHeading title="体能与专项训练负荷分析" subtitle="体能负荷 · 专项负荷 · 对比分析（日/周/月/阶段）" />
        <TrainingLoadComparisonChart records={analysisRecords} />
        <p className="analysis-method-note">体能训练自动关联力量、功能、跑步、恢复和测功仪记录；专项训练关联水上、竞速及项目技术训练。</p>
      </article>
    ),
    'training-volume': (
      <article className="panel professional-panel analysis-feature-panel">
        <PanelHeading title="训练量统计图" subtitle="训练时长 · SRPE（日/周/月/阶段）" />
        <TrainingVolumeChart records={analysisRecords} />
      </article>
    ),
    'training-content': (
      <article className="panel professional-panel analysis-feature-panel">
        <PanelHeading title="训练内容统计图" subtitle="内容结构（日/周/月/阶段）" />
        <TrainingContentChart records={analysisRecords} />
      </article>
    ),
    'rpe-analysis': (
      <article className="panel professional-panel analysis-feature-panel">
        <PanelHeading title="RPE统计图" subtitle="主观用力程度（日/周/月/阶段）" />
        <RpeStatisticsChart records={analysisRecords} />
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
    roster: (
      <article className="panel professional-panel roster-preview">
        <div className="panel-heading roster-panel-heading"><div><h2><UsersRound size={18} />运动员状态</h2><small>稳定率 {stableRate}% · 正常 {statusCount.normal} · 关注 {statusCount.attention} · 异常 {statusCount.alert}</small></div><div className="roster-panel-tools"><label><Search size={14} /><input value={rosterSearch} onChange={(event) => setRosterSearch(event.target.value)} placeholder="搜索成员、队伍或教练" aria-label="搜索运动员状态" /></label><span className="count-chip"><UsersRound size={14} /> {athleteRows.length}人</span></div></div>
        <div className="table-scroll"><table className="data-table">
          <thead><tr><th>运动员</th><th>所属地区</th><th>项目 / 组别</th><th>位置/号位</th><th>最新状态</th><th>周期SRPE</th><th>平均睡眠</th><th>疲劳指数</th></tr></thead>
          <tbody>{visibleAthleteRows.map((row) => <tr key={row.athlete.id}>
            <td><strong>{row.athlete.name}</strong>{row.athlete.coachUsers?.length ? <small className="athlete-coach-names">{row.athlete.coachUsers.map((coach) => coach.displayName).join('、')}</small> : <small>未绑定教练</small>}</td>
            <td>{[row.athlete.region, row.athlete.city, row.athlete.county].filter(Boolean).join(' / ') || '未设置'}</td><td>{row.athlete.project}<small>{row.athlete.team}</small></td><td>{row.athlete.athletePosition || '未填写'}</td><td><StatusPill status={row.status} compact /></td><td>{formatNumber(row.load)}</td><td>{row.sleep ? `${row.sleep.toFixed(1)} h` : '—'}</td><td>{row.fatigue ? row.fatigue.toFixed(1) : '—'}</td>
          </tr>)}{!visibleAthleteRows.length && <tr><td colSpan={8} className="roster-search-empty">未找到匹配成员</td></tr>}</tbody>
        </table></div>
      </article>
    )
  };

  return (
    <div className="page-content professional-overview" onClick={() => setActiveMenu(null)}>
      <header className="page-heading overview-page-heading">
        <div className="overview-title-block">
          <h1>{isIndividualOverview ? '我的训练总览' : '训练总览'}</h1>
        </div>
        <DateToolbar {...props} athleteId={overviewAthleteId} athleteMode={isIndividualOverview ? 'self' : 'team'} presetMode="period" canRenameAthletes={false} onAthleteNameChange={props.onAthleteNameChange} />
        <div
          className="overview-principle"
          role="note"
          aria-label="有训练就要有数据，有数据就要有统计，有统计就要有分析，有分析就要对标对表"
        >
          <div className="overview-principle-flow" aria-hidden="true">
            <span>有训练就要有<strong>数据</strong></span><ArrowRight />
            <span>有数据就要有<strong>统计</strong></span><ArrowRight />
            <span>有统计就要有<strong>分析</strong></span><ArrowRight />
            <span>有分析就要<strong>对标对表</strong></span>
          </div>
        </div>
      </header>
      {overviewError && <div className="overview-data-provenance error"><Database size={15} /><strong>统一指标接口暂不可用</strong><span>{overviewError}，当前显示兼容数据。</span></div>}
      {layout.hidden.length > 0 && <div className="hidden-card-restore" onClick={(event) => event.stopPropagation()}><Eye size={15} /><span>已隐藏 {layout.hidden.length} 项</span>{layout.hidden.map((id) => <button key={id} type="button" onClick={() => restoreCard(id)}>{cardMeta[id].title}</button>)}</div>}
      {props.loading || (overviewLoading && !overview) ? <PageSkeleton /> : <section className="professional-dashboard-grid">{layout.order.filter((id) => !layout.hidden.includes(id) && (isIndividualOverview ? id !== 'roster' : true)).map((id) => renderShell(id, cards[id]))}</section>}
    </div>
  );
}

function PanelHeading({ title, subtitle, icon }: { title: string; subtitle: string; icon?: ReactNode }) {
  return <div className="panel-heading professional-heading"><div><h2>{icon && <span className="analysis-title-icon">{icon}</span>}{title}</h2></div><small>{subtitle}</small></div>;
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

function measurementValue(measurements: Map<string, OverviewMeasurement>, code: string) {
  const value = measurements.get(code)?.value;
  return typeof value === 'number' ? value : null;
}

function MovementMatrix({ latest, measurements }: { latest?: StrengthTest; measurements: Map<string, OverviewMeasurement> }) {
  const score = (code: string) => {
    const value = measurementValue(measurements, code);
    return value === null ? null : `${formatNumber(value, 0)}分`;
  };
  const rows = [
    { label: '深蹲', detail: '踝、膝、髋与躯干整体控制', value: score('fms_deep_squat') },
    { label: '跨栏步', detail: '单腿支撑、髋膝踝控制', value: score('fms_hurdle_step') },
    { label: '直线弓步蹲', detail: '分腿姿态下稳定和控制', value: score('fms_inline_lunge') },
    { label: '肩部灵活性', detail: '肩胛胸廓和肩关节活动度', value: score('fms_shoulder_mobility') },
    { label: '主动直腿上抬', detail: '髋关节灵活性和骨盆控制', value: score('fms_active_straight_leg_raise') },
    { label: '躯干稳定俯卧撑', detail: '反伸抗力和躯干稳定', value: score('fms_trunk_stability_pushup') },
    { label: '旋转稳定性', detail: '多平面核心控制和对称性', value: score('fms_rotary_stability') },
    { label: '单腿蹲对称', detail: '膝内扣与左右功能控制', value: symmetryLabel(latest?.metrics.leftSingleLegSquatReps, latest?.metrics.rightSingleLegSquatReps) },
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
