import {
  AlarmClock, ArrowRight, BarChart3, Database, Dumbbell,
  Eye, EyeOff, Gauge, HeartPulse, Layers3, MoreHorizontal, Pin, UsersRound
} from 'lucide-react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent, ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { api } from '../api';
import type { Athlete, OverviewLayoutState, OverviewMeasurement, OverviewPayload, Project, ProjectTeam, StrengthTest, TrainingRecord, User } from '../types';
import { addDays, aggregateRecords, average, formatNumber, percentage } from '../utils';
import { ROLE_META } from '../../shared/access';
import { PerformanceRadarChart } from '../components/LoadCharts';
import {
  FmsTeamChart, InjuryAssessmentChart,
  TrainingContentChart, TrainingIntensityChart, TrainingVolumeDashboard, TrainingLoadEnergyChart, trainingLoadCategory
} from '../components/TrainingAnalysisCharts';
import { AthleteProfileOverview, BirthplaceMapOverview } from '../components/AthleteProfileCharts';
import { AppCard, ContentState, PageContainer, PageHeader, SectionHeader } from '../components/PageLayout';
import { buildDailyPerformance, buildPerformanceRadar, calculateLoadDiagnostics } from '../overview-analytics';

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
};

type CardSize = 'metric' | 'third' | 'half' | 'wide' | 'full';
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
  'athlete-profile', 'birthplace-map',
  'fms-analysis', 'performance-radar', 'injury-analysis',
  'training-load-analysis', 'training-intensity', 'training-content', 'water-land-load',
  'recovery'
];

const cardMeta: Record<string, { title: string; size: CardSize }> = {
  duration: { title: '训练时长', size: 'metric' },
  distance: { title: '疲劳指数', size: 'metric' },
  srpe: { title: '平均负荷', size: 'metric' },
  rpe: { title: '运动员总数', size: 'metric' },
  'acute-load': { title: '训练负荷', size: 'metric' },
  'recovery-time': { title: '损伤情况', size: 'metric' },
  'athlete-profile': { title: '身体与年龄画像', size: 'full' },
  'birthplace-map': { title: '输送单位', size: 'full' },
  'fms-analysis': { title: '功能动作筛查(FMS)', size: 'half' },
  'performance-radar': { title: '六维运动表现画像', size: 'half' },
  'injury-analysis': { title: '运动损伤评估', size: 'half' },
  'training-load-analysis': { title: '训练量统计', size: 'full' },
  'training-intensity': { title: '训练强度占比', size: 'half' },
  'training-content': { title: '训练课占比', size: 'half' },
  'water-land-load': { title: '训练负荷占比', size: 'half' }
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
    const newProfileCards = ['athlete-profile', 'birthplace-map'];
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
  const [trainingTeams, setTrainingTeams] = useState<ProjectTeam[]>([]);
  const [trainingTeamId, setTrainingTeamId] = useState<number | null>(null);
  const [teamTrainingOverview, setTeamTrainingOverview] = useState<OverviewPayload | null>(null);
  const [teamTrainingLoading, setTeamTrainingLoading] = useState(false);
  const isSelfOverview = props.user.role === 'ATL';
  const isIndividualOverview = isSelfOverview || props.athleteId !== null;
  // 日期、项目和运动员只由应用级筛选栏维护，所有训练页面读取同一份状态。
  const overviewAthleteId = isSelfOverview ? props.user.athleteId : props.athleteId;
  useEffect(() => {
    if (props.athleteId !== overviewAthleteId) props.onAthleteChange(overviewAthleteId);
  }, [overviewAthleteId, props.athleteId, props.onAthleteChange]);

  useEffect(() => {
    let active = true;
    setOverviewLoading(true);
    setOverviewError('');
    setOverview(null);
    api.overview(props.from, props.to, overviewAthleteId, props.project)
      .then((current) => {
        if (!active) return;
        setOverview(current.overview);
      })
      .catch((error) => {
        if (!active) return;
        setOverview(null);
        setOverviewError(error instanceof Error ? error.message : '统一总览数据读取失败');
      })
      .finally(() => { if (active) setOverviewLoading(false); });
    return () => { active = false; };
  }, [props.from, props.to, overviewAthleteId, props.project]);

  useEffect(() => {
    let active = true;
    if (isIndividualOverview) {
      setTrainingTeams([]);
      setTrainingTeamId(null);
      return () => { active = false; };
    }
    api.overviewTeams(props.project)
      .then((current) => {
        if (!active) return;
        setTrainingTeams(current.teams);
        setTrainingTeamId((selected) => current.teams.some((team) => team.id === selected)
          ? selected
          : current.teams[0]?.id ?? null);
      })
      .catch(() => {
        if (!active) return;
        setTrainingTeams([]);
        setTrainingTeamId(null);
      });
    return () => { active = false; };
  }, [isIndividualOverview, props.project]);

  useEffect(() => {
    let active = true;
    if (isIndividualOverview || !trainingTeamId) {
      setTeamTrainingOverview(null);
      setTeamTrainingLoading(false);
      return () => { active = false; };
    }
    setTeamTrainingLoading(true);
    setTeamTrainingOverview(null);
    api.overview(props.from, props.to, null, props.project, trainingTeamId)
      .then((current) => { if (active) setTeamTrainingOverview(current.overview); })
      .catch(() => { if (active) setTeamTrainingOverview(null); })
      .finally(() => { if (active) setTeamTrainingLoading(false); });
    return () => { active = false; };
  }, [isIndividualOverview, props.from, props.project, props.to, trainingTeamId]);

  const analysisRecords = overview?.records ?? props.records;
  const trainingOverview = teamTrainingOverview ?? overview;
  const selectedTrainingTeam = trainingTeams.find((team) => team.id === trainingTeamId) ?? null;
  const athleteProfiles = overview?.profiles ?? [];
  const strengthTests = overview?.strengthTests ?? [];
  const strengthLoading = overviewLoading;
  const measurementMap = useMemo(() => new Map((overview?.measurements || []).map((item) => [item.code, item])), [overview]);
  const summary = useMemo(() => aggregateRecords(analysisRecords), [analysisRecords]);
  const durationBreakdown = useMemo(() => analysisRecords
    .filter((record) => record.status !== 'rest')
    .reduce((totals, record) => {
      const category = trainingLoadCategory(record);
      if (category) totals[category] += record.durationMin;
      return totals;
    }, { physical: 0, special: 0, recovery: 0 }), [analysisRecords]);
  const durationSummary = overview?.trainingAnalytics?.summary;
  const displayTrainingDuration = durationSummary ? durationSummary.totalDurationMin : summary.totalDuration;
  const displayPhysicalDuration = durationSummary ? durationSummary.physicalDurationMin : durationBreakdown.physical;
  const displaySpecialDuration = durationSummary ? durationSummary.specialDurationMin : durationBreakdown.special;
  const recentLoadBreakdown = useMemo(() => {
    const from = addDays(props.to, -6);
    return analysisRecords
      .filter((record) => record.status !== 'rest' && record.date >= from && record.date <= props.to)
      .reduce((totals, record) => {
        const category = trainingLoadCategory(record);
        if (category) totals[category] += record.srpe;
        return totals;
      }, { physical: 0, special: 0, recovery: 0 });
  }, [analysisRecords, props.to]);
  const recentTrainingLoad = recentLoadBreakdown.physical + recentLoadBreakdown.special + recentLoadBreakdown.recovery;
  const averageLoadBreakdown = useMemo(() => analysisRecords
    .filter((record) => record.status !== 'rest')
    .reduce((totals, record) => {
      const category = trainingLoadCategory(record);
      if (category) totals[category] += record.srpe;
      return totals;
    }, { physical: 0, special: 0, recovery: 0 }), [analysisRecords]);
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
  const selectedAthlete = props.athletes.find((athlete) => athlete.id === overviewAthleteId);

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
    // 已保存的旧布局可能包含已下线卡片；忽略它们，避免刷新时因读取尺寸配置而中断页面渲染。
    if (!meta) return null;
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
      value={displayTrainingDuration === null ? '—' : formatNumber(displayTrainingDuration / 60, 1)}
      unit={displayTrainingDuration === null ? '' : '小时'}
      note={`体能 ${displayPhysicalDuration === null ? '—' : formatNumber(displayPhysicalDuration / 60, 1)}h · 专项 ${displaySpecialDuration === null ? '—' : formatNumber(displaySpecialDuration / 60, 1)}h`}
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
      <AppCard variant="chart" className={`professional-panel athlete-profile-panel${isIndividualOverview ? '' : ' team-profile-dashboard'}`}>
        <PanelHeading title={isIndividualOverview ? '个人身体与年龄画像' : '基本信息'} subtitle={isIndividualOverview ? `${scopeLabel} · 年龄 · 身高 · 体重` : `当前队伍 · ${athleteProfiles.length}名运动员 · 身体基础数据`} />
        <AthleteProfileOverview profiles={athleteProfiles} individual={isIndividualOverview} asOf={props.to} />
      </AppCard>
    ),
    'birthplace-map': (
      <AppCard variant="chart" className="professional-panel birthplace-map-panel">
        <PanelHeading title="输送单位" subtitle={`${scopeLabel} · 省份分布 · 运动员成绩与竞技状态`} />
        <BirthplaceMapOverview profiles={athleteProfiles} individual={isIndividualOverview} />
        <p className="analysis-method-note">生源地读取运动员籍贯档案，与账号所属区域及数据权限分开管理；地图仅展示当前账号有权访问的运动员。</p>
      </AppCard>
    ),
      'fms-analysis': (
      <AppCard variant="chart" className="professional-panel analysis-feature-panel fms-analysis-panel">
        <PanelHeading title="功能动作筛查(FMS)" subtitle={`${isIndividualOverview ? '个人FMS' : `最近一次团队测试 · n=${measurementSampleCount || '—'}`} · 标准七项21分制`} />
        <FmsTeamChart measurements={overview?.measurements || []} />
        <p className="analysis-method-note">每个动作按0–3分计，团队柱为最近一次测试的单项平均分；2分表示动作模式基本达标，低于2分列入纠正训练。七项齐全时汇总为21分制队均，14分仅作复查参考，不单独用于判断损伤风险。</p>
      </AppCard>
    ),
    'performance-radar': (
      <AppCard variant="chart" className="professional-panel">
        <PanelHeading title="制胜要素分析" subtitle={`${scopeLabel} · 目标达成制`} />
        {strengthLoading ? <ContentState kind="loading" className="professional-chart-empty" title="正在读取力量测试…"/> : <PerformanceRadarChart data={radar} />}
        <p className="analysis-method-note">评分只反映教练目标达成、双侧差异和本周期恢复记录，不用于选材或伤病诊断；未测试项不计0分。</p>
      </AppCard>
    ),
    'injury-analysis': (
      <AppCard variant="chart" className="professional-panel analysis-feature-panel">
        <PanelHeading title="运动损伤评估" subtitle={`${scopeLabel} · 最新伤病记录 · 训练可用性`} />
        <InjuryAssessmentChart injuries={overview?.injuries || []} athleteCount={scopeAthleteCount} />
        <p className="analysis-method-note">按每名运动员最新记录统计健康、观察、受限、康复和停训状态，不能替代医学诊断。</p>
      </AppCard>
    ),
    'training-load-analysis': (
      <AppCard variant="chart" className="professional-panel analysis-feature-panel">
        <div className="training-analytics-heading-row">
          <PanelHeading title="训练量统计" subtitle={selectedTrainingTeam ? `${selectedTrainingTeam.name} · 整体投入 · 专项 · 体能 · 生理生化 · RPE` : '整体投入 · 专项 · 体能 · 生理生化 · RPE'} />
          {!isIndividualOverview && <label className="training-analytics-team-filter">
            <span>队伍</span>
            <select value={trainingTeamId ?? ''} onChange={(event) => setTrainingTeamId(event.target.value ? Number(event.target.value) : null)}>
              <option value="">全部可访问队伍</option>
              {trainingTeams.map((team) => <option key={team.id} value={team.id}>{team.name}（{team.athleteCount}人）</option>)}
            </select>
          </label>}
        </div>
        {teamTrainingLoading
          ? <ContentState kind="loading" className="professional-chart-empty" title="正在按队伍汇总训练量…" />
          : <TrainingVolumeDashboard from={props.from} to={props.to} data={trainingOverview?.trainingAnalytics || { summary: { totalDurationMin: null, testSessionCount: 0, testedAthleteCount: 0, recoveryDurationMin: null, specialDurationMin: null, specialDistanceKm: null, physicalDurationMin: null, physicalLoad: null, rpeAverage: null, rpeHighest: null, rpeLowest: null }, days: [] }} physiology={trainingOverview?.physiologyHeatmap || { metrics: [] }} />}
      </AppCard>
    ),
    'training-intensity': (
      <AppCard variant="chart" className="professional-panel analysis-feature-panel">
        <PanelHeading title="训练强度占比" subtitle="按原始强度区间统计训练时长" />
        <TrainingIntensityChart data={overview?.intensityDistribution || []} />
      </AppCard>
    ),
    'training-content': (
      <AppCard variant="chart" className="professional-panel analysis-feature-panel">
        <PanelHeading title="训练课占比" subtitle="九类训练课次占比（当前页面时间范围）" />
        <TrainingContentChart records={analysisRecords} />
      </AppCard>
    ),
    'water-land-load': (
      <AppCard variant="chart" className="professional-panel analysis-feature-panel">
        <PanelHeading title="训练负荷占比" subtitle="专项 · 体能 · 恢复（SRPE 训练负荷）" />
        <TrainingLoadEnergyChart data={overview?.trainingLoadRatio || { specialLoad: 0, physicalLoad: 0, recoveryLoad: 0, totalLoad: 0, specialPercentage: 0, physicalPercentage: 0, recoveryPercentage: 0 }} />
      </AppCard>
    )
  };

  return (
    <PageContainer className="professional-overview" onClick={() => setActiveMenu(null)}>
      <PageHeader
        variant="dashboard"
        className="overview-page-heading"
        eyebrow="TRAINING OVERVIEW"
        title={isSelfOverview ? '我的训练总览' : isIndividualOverview ? '运动员训练总览' : '训练总览'}
        supportingContent={<div
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
        </div>}
      />
      {overviewError && <div className="overview-data-provenance error"><Database size={15} /><strong>统一指标接口暂不可用</strong><span>{overviewError}，当前显示兼容数据。</span></div>}
      {props.loading || (overviewLoading && !overview) ? <PageSkeleton /> : <section className="professional-dashboard-grid">{layout.order.filter((id) => cardMeta[id] && !layout.hidden.includes(id)).map((id) => renderShell(id, cards[id]))}</section>}
      {layout.hidden.filter((id) => cardMeta[id]).length > 0 && <div className="hidden-card-restore" onClick={(event) => event.stopPropagation()}><Eye size={15} /><span>已隐藏 {layout.hidden.filter((id) => cardMeta[id]).length} 项</span>{layout.hidden.filter((id) => cardMeta[id]).map((id) => <button key={id} type="button" onClick={() => restoreCard(id)}>{cardMeta[id].title}</button>)}</div>}
    </PageContainer>
  );
}

function PanelHeading({ title, subtitle, icon }: { title: string; subtitle: string; icon?: ReactNode }) {
  return <SectionHeader className="professional-heading" title={title} description={subtitle} icon={icon && <span className="analysis-title-icon">{icon}</span>} />;
}

function Metric({ icon, label, value, unit, note, tone }: { icon: ReactNode; label: string; value: string; unit: string; note: string; tone: string }) {
  return <article className={`metric-card tone-${tone}`}><div className="metric-icon">{icon}</div><div className="metric-copy"><span>{label}</span><strong>{value}<small>{unit}</small></strong><p>{note}</p></div><div className="metric-waterline" aria-hidden="true" /></article>;
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
