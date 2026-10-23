import { importStatistics, type ImportStatistics } from '../../shared/import-statistics';
import { isImportException, importReviewGroups, selectImportReviewRecord, importSessionChoices } from '../../shared/import-conflict-review';
import { ImportConflictReview } from '../components/ImportConflictReview';
import { ImportSourceRowEditor } from '../components/ImportSourceRowEditor';
import { BODY_TEMPLATE_FIELDS } from '../../shared/data-import-template';
import type { ImportDraftCleanupPreview } from '../../shared/import-draft-cleanup';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Database,
  Download,
  FileCheck2,
  FileSpreadsheet,
  FileWarning,
  RefreshCw,
  Save,
  Search,
  UploadCloud,
  Users,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { dataImportPersonKey, importPersonNeedsConfirmation } from '../../shared/data-import-person';
import { createPortal } from 'react-dom';
import { api } from '../api';
import type {
  Athlete,
  DataImportBatch,
  DataImportAthleteCandidate,
  DataImportBatchSummary,
  DataImportItem,
  Project,
  ProjectTeam,
  User,
} from '../types';
import './DataImportPage.css';
import { PageContainer, PageHeader } from '../components/PageLayout';
import { projectLabel } from '../../shared/projects';
import { readImportReviewPosition, writeImportReviewPosition } from '../utils/import-review-position';

function ImportCountSummary({ counts }: { counts: ImportStatistics }) {
  return <details className="data-import-count-summary">
    <summary>查看完整统计与计数说明</summary>
    <p>新增{counts.newCount} · 更新{counts.updateCount} · 无变化{counts.unchangedCount} · 排除{counts.excludedCount} · 未填报{counts.unfilledRows} · 阻断错误{counts.errorCount}</p>
    <small>未填报按源行统计，其余按业务记录统计；一行可拆为多条记录。自动合并来源{counts.mergedCount}条，单独列示。</small>
  </details>;
}

type Props = {
  user: User;
  project: Project;
  athletes: Athlete[];
  onChanged: () => void;
  onNavigationGuardChange?: (guard: (() => boolean) | null) => void;
};

type Correction = {
  id: number;
  eventDate?: string;
  valueNum?: number | null;
  actualReps?: number | null;
  actualWeightKg?: number | null;
  payload?: Record<string, unknown>;
  sourceCells?: Record<string, string | number | null>;
  metricCode?: string;
  side?: DataImportItem['side'];
  resolution?: '' | 'skip' | 'update';
};

type AthleteCorrection = {
  id: number;
  name?: string;
  team?: string;
  gender?: string;
  matchedAthleteId?: number | null;
  excluded?: boolean;
  confirmed?: boolean;
};

type TemplateKind = 'profile' | 'training' | 'test' | 'unified';

const ITEM_LABELS: Record<DataImportItem['itemType'], string> = {
  athlete_profile: '运动员档案',
  wellness: '恢复状态',
  training_session: '训练课次',
  training_set: '训练组次',
  test_measurement: '测试成绩',
  body_measurement: '身体测量',
  injury_record: '伤病记录',
  competitive_state: '竞技状态',
  scoring_rule: '评分规则',
  invalid_row: '错误行',
};

const STATUS_LABELS: Record<DataImportBatch['status'], string> = {
  reviewing: '待确认',
  committed: '已入库',
  failed: '失败',
  rolled_back: '已撤销',
};

const PAGE_SIZE = 50;

function numberOrUndefined(value: string): number | null | undefined {
  if (value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function payloadNumber(payload: Record<string, unknown>, key: string): string {
  const value = payload[key];
  return value === null || value === undefined ? '' : String(value);
}

export function DataImportPage({ user, project, athletes, onChanged, onNavigationGuardChange }: Props) {
  const positionKey = `jingji:import-review:${user.id}:${project}`;
  const reviewRef = useRef<HTMLElement>(null);
  const [saveFailed, setSaveFailed] = useState(false);
  const [metrics, setMetrics] = useState<Array<{ code: string; label: string; unit: string }>>([]);
  const [mobileIndex, setMobileIndex] = useState(0);
  const [isCompact, setIsCompact] = useState(() => window.matchMedia('(max-width: 720px)').matches);
  const navigationState = useRef({ unsaved: false, busy: false });
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [defaultDate, setDefaultDate] = useState('');
  const [bulkCandidateTeam, setBulkCandidateTeam] = useState('');
  const [templateTeam, setTemplateTeam] = useState('');
  const [templateTeamsProject, setTemplateTeamsProject] = useState<Project | null>(null);
  const [teams, setTeams] = useState<ProjectTeam[]>([]);
  const [batch, setBatch] = useState<DataImportBatch | null>(null);
  const [batches, setBatches] = useState<DataImportBatchSummary[]>([]);
  const [busy, setBusy] = useState<
    'analyze' | 'save' | 'commit' | 'load' | 'template' | 'export' | 'discard' | 'cleanup' | 'errors' | ''
  >('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [reviewRevision, setReviewRevision] = useState(0);
  const [savingReviewGroups, setSavingReviewGroups] = useState<Set<number>>(new Set());
  const [pendingSelections, setPendingSelections] = useState<Set<number>>(new Set());
  const [filter, setFilter] = useState<'exception' | 'duplicate' | 'overwrite' | 'all'>(
    'exception'
  );
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(0);
  const [reviewGroupPage, setReviewGroupPage] = useState(0);
  const correctionQueue = useRef(Promise.resolve());
  const knownRevisions = useRef(new Map<string, number>());
  const expectedRevision = (current: DataImportBatch) => knownRevisions.current.get(current.id) ?? current.revision;
  const rememberRevision = (current: DataImportBatch) => {
    knownRevisions.current.set(current.id, Math.max(knownRevisions.current.get(current.id) ?? 0, current.revision));
  };
  const busyRef = useRef(busy);
  busyRef.current = busy;
  const [corrections, setCorrections] = useState<Map<number, Correction>>(new Map());
  const [athleteCorrections, setAthleteCorrections] = useState<Map<number, AthleteCorrection>>(
    new Map()
  );
  const [personDialogOpen, setPersonDialogOpen] = useState(false);
  const [personTab, setPersonTab] = useState<'all' | 'pending' | 'ambiguous'>('all');
  const [personQuery, setPersonQuery] = useState('');
  const [selectedPersonId, setSelectedPersonId] = useState<number | null>(null);
  const [personCreateModes, setPersonCreateModes] = useState<Set<number>>(new Set());
  const [personLinkModes, setPersonLinkModes] = useState<Set<number>>(new Set());
  const [confirmDialogOpen, setConfirmDialogOpen] = useState(false);
  const [duplicateDialogOpen, setDuplicateDialogOpen] = useState(false);
  const [result, setResult] = useState<{
    message: string;
    createdAthletes: number;
    linkedAthletes: number;
    createdRecords: number;
    updatedRecords: number;
    skipped: number;
    receipt?: ImportStatistics;
    filledProfileFields: number;
    overwrittenProfileFields: number;
  } | null>(null);

  const [cleanupPreview, setCleanupPreview] = useState<(ImportDraftCleanupPreview & { project: Project }) | null>(null);
  const cleanupProjectRef = useRef(project);
  cleanupProjectRef.current = project;

  const previewExpiredDrafts = async () => {
    if (busy || hasUnsavedChanges) return;
    setBusy('cleanup');
    setError('');
    setCleanupPreview(null);
    try {
      const preview = await api.expiredImportDrafts(project);
      if (cleanupProjectRef.current !== project) return;
      const drafts = preview.drafts.filter(item => item.id !== batch?.id);
      setCleanupPreview({ ...preview, project, drafts });
      if (!drafts.length) setMessage('没有可清理的过期草稿；当前打开的批次不会加入清理。');
    } catch (error) { if (cleanupProjectRef.current === project) setError(error instanceof Error ? error.message : '预览失败。'); }
    finally { setBusy(current => current === 'cleanup' ? '' : current); }
  };
  const cleanupExpiredDrafts = async () => {
    if (busy || hasUnsavedChanges || cleanupPreview?.project !== project || !cleanupPreview.drafts.length) return;
    if (!window.confirm(`确定永久删除预览中的${cleanupPreview.drafts.length}个过期草稿及暂存明细？此操作无法恢复，正式数据和已入库批次不受影响。`)) return;
    setBusy('cleanup');
    setError('');
    try {
      const result = await api.cleanupExpiredImportDrafts(project, cleanupPreview.drafts.map(({ id, revision }) => ({ id, revision })));
      if (cleanupProjectRef.current !== project) return;
      setBatches(current => current.filter(item => !result.deletedIds.includes(item.id)));
      setCleanupPreview(null);
      setMessage(result.message);
    } catch (error) {
      if (cleanupProjectRef.current === project) { setCleanupPreview(null); setError(error instanceof Error ? error.message : '清理失败，请重新预览。'); }
    } finally { setBusy(current => current === 'cleanup' ? '' : current); }
  };

  const refreshBatches = async () => {
    try {
      const list = await api.dataImportBatches(project);
      if (cleanupProjectRef.current === project) setBatches(list.batches);
    } catch (nextError) {
      if (cleanupProjectRef.current === project) setError(nextError instanceof Error ? nextError.message : '导入记录加载失败。');
    }
  };

  useEffect(() => {
    let cancelled = false;
    setTemplateTeamsProject(null);
    setTemplateTeam('');
    setTeams([]);
    setMetrics([]);
    void api.dataImportMetrics(project).then(result => { if (!cancelled) setMetrics(result.metrics); })
      .catch(error => { if (!cancelled) setError(error instanceof Error ? error.message : '测试项目加载失败。'); });
    setBatch(null);
    setBatches([]);
    setSaveFailed(false);
    setFile(null);
    setDefaultDate('');
    setPendingSelections(new Set());
    setCorrections(new Map());
    setAthleteCorrections(new Map());
    setMessage('');
    setError('');
    setResult(null);
    setPersonDialogOpen(false);
    setConfirmDialogOpen(false);
    setDuplicateDialogOpen(false);
    void refreshBatches();
    void api
      .adminTeams()
      .then((list) => {
        if (cancelled) return;
        const available = list.teams.filter((team) => team.project === project);
        setTeams(available);
        setTemplateTeam(available.length === 1 ? available[0].name : '');
        setTemplateTeamsProject(project);
        setBulkCandidateTeam((current) =>
          available.some((team) => team.name === current) ? current : ''
        );
      })
      .catch((nextError) => {
        if (!cancelled) setError(nextError instanceof Error ? nextError.message : '队伍列表加载失败。');
      });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project]);

  const startReview = (next: DataImportBatch) => {
    setCleanupPreview(null);
    rememberRevision(next);
    setBulkCandidateTeam('');
    const savedPosition = readImportReviewPosition(positionKey);
    const restoring = savedPosition?.batchId === next.id ? savedPosition : null;
    setReviewGroupPage(restoring?.reviewGroupPage ?? 0);
    setFilter(restoring?.filter ?? 'exception');
    setQuery(restoring?.query ?? '');
    setBatch(next);
    setPersonLinkModes(new Set());
    setPersonCreateModes(new Set());
    setCorrections(new Map());
    setAthleteCorrections(new Map());
    setPage(restoring?.page ?? 0);
    setMobileIndex(0);
    setSaveFailed(false);
    setResult(null);
    const unresolved = next.athleteCandidates.filter(
      (candidate) => importPersonNeedsConfirmation(candidate, next.items)
    );
    setSelectedPersonId(restoring?.selectedPersonId && next.athleteCandidates.some(person => person.id === restoring.selectedPersonId) ? restoring.selectedPersonId : unresolved[0]?.id ?? null);
    setPersonDialogOpen(next.status === 'reviewing' && unresolved.length > 0);
    setDuplicateDialogOpen(false);
    setConfirmDialogOpen(false);
    if (next.status === 'committed') {
      setMessage(`该文件已完成入库：写入${next.importedCount}条、跳过${next.skippedCount}条；无需再次确认人员或提交。当前显示历史导入结果。`);
    } else if (next.status === 'reviewing') {
      setMessage(unresolved.length
        ? `已识别${next.itemCount}条候选数据；还有${unresolved.length}名人员待确认，请完成人员确认后校对数据。`
        : `已识别${next.itemCount}条候选数据；人员已确认，请校对数据后确认导入。`);
    } else {
      setMessage('该历史批次当前不能提交，请检查批次状态后重新上传文件。');
    }
  };

  const analyze = async (options?: { reparse?: boolean }) => {
    if (!file) return;
    if (hasUnsavedChanges && !window.confirm('当前批次有未保存修改，上传其他文件会丢失这些修改。是否继续？')) return;
    setBusy('analyze');
    setError('');
    setMessage('');
    try {
      const info = await api.analyzeDataImport(file, project, defaultDate || undefined, { ...options, expectedRevision: options?.reparse && batch ? expectedRevision(batch) : undefined });
      if (info.batch.status === 'committed') {
        startReview(info.batch);
        await refreshBatches();
        return;
      }
      if (info.batch.status === 'reviewing' && info.batch.summary.duplicateFile && !options?.reparse) {
        rememberRevision(info.batch);
        setBatch(info.batch);
        setDuplicateDialogOpen(true);
        setMessage('该文件已上传过，可继续上次校对，或按当前参数重新解析。');
        await refreshBatches();
        return;
      }
      startReview(info.batch);
      await refreshBatches();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '文件解析失败。');
    } finally {
      setBusy('');
    }
  };

  const downloadTemplate = async (kind: TemplateKind) => {
    setBusy('template');
    setError('');
    setMessage('');
    try {
      await api.downloadDataImportTemplate(kind, project, templateTeam || undefined);
      setMessage(
        kind === 'unified'
          ? '统一数据模板已开始下载（含已有人员预填）。'
          : '分用途模板已开始下载（含已有人员预填）。'
      );
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '模板下载失败。');
    } finally {
      setBusy('');
    }
  };

  const exportUnifiedData = async () => {
    setBusy('export');
    setError('');
    setMessage('');
    try {
      await api.exportUnifiedData(project);
      setMessage('当前权限范围内的运动员数据已开始导出，可直接作为统一导入模板使用。');
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '统一数据导出失败。');
    } finally {
      setBusy('');
    }
  };

  const downloadErrors = async () => {
    if (!batch) return;
    setBusy('errors');
    try {
      await api.downloadDataImportErrorReport(batch.id, batch.filename);
      setMessage('问题清单已开始下载，包含工作表、行号与错误原因。');
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '问题清单导出失败。');
    } finally {
      setBusy('');
    }
  };

  const loadBatch = async (id: string) => {
    if (hasUnsavedChanges && !window.confirm('当前批次有未保存修改，切换批次会丢失这些修改。是否继续？')) return;
    setBusy('load');
    setError('');
    setMessage('');
    try {
      const info = await api.dataImportBatch(id);
      startReview(info.batch);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '批次加载失败。');
    } finally {
      setBusy('');
    }
  };

  const discardBatch = async (item: DataImportBatchSummary) => {
    if (busy || item.status !== 'reviewing') return;
    if (
      !window.confirm(
        `确定放弃提交“${item.filename}”？该批次及相关暂存数据将被永久删除，无法恢复。`
      )
    )
      return;
    setBusy('discard');
    setError('');
    setMessage('');
    try {
      const info = await api.discardDataImport(item.id, project);
      setBatches((current) => current.filter((entry) => entry.id !== item.id));
      if (batch?.id === item.id) {
        setBatch(null);
        setCorrections(new Map());
        setAthleteCorrections(new Map());
        setFile(null);
        if (fileRef.current) fileRef.current.value = '';
      }
      setMessage(info.message);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '放弃提交失败。');
    } finally {
      setBusy('');
    }
  };

  const patchItem = (itemId: number, patch: Omit<Correction, 'id'>) => {
    setBatch((current) =>
      current
        ? {
            ...current,
            items: current.items.map((item) =>
              item.id === itemId ? { ...item, ...patch, payload: patch.payload ? { ...item.payload, ...patch.payload } : item.payload } : item
            ),
          }
        : current
    );
    setCorrections((current) => {
      const next = new Map(current);
      const prior = next.get(itemId) || { id: itemId };
      next.set(itemId, {
        ...prior,
        ...patch,
        payload: patch.payload ? { ...(prior.payload || {}), ...patch.payload } : prior.payload,
        sourceCells: patch.sourceCells ? { ...(prior.sourceCells || {}), ...patch.sourceCells } : prior.sourceCells,
      });
      return next;
    });
  };

  const sourceCorrectionId = (item: DataImportItem) => {
    const source = item.payload.sourceRow as { rowIndex?: number } | undefined;
    return batch?.items.find(entry => entry.sourceSheet === item.sourceSheet && source?.rowIndex !== undefined &&
      (entry.payload.sourceRow as { rowIndex?: number } | undefined)?.rowIndex === source.rowIndex)?.id ?? item.id;
  };

  const patchAthleteCandidate = (candidateId: number, patch: Omit<AthleteCorrection, 'id'>) => {
    setBatch((current) =>
      current
        ? {
            ...current,
            athleteCandidates: current.athleteCandidates.map((candidate) =>
              candidate.id === candidateId ? { ...candidate, ...patch } : candidate
            ),
          }
        : current
    );
    setAthleteCorrections((current) => {
      const next = new Map(current);
      next.set(candidateId, {
        ...(next.get(candidateId) || { id: candidateId }),
        ...patch,
      });
      return next;
    });
  };

  const personHandlingLabel = (candidate: DataImportAthleteCandidate) => {
    if (candidate.excluded) return '已排除';
    if (candidate.status === 'created') return '新建';
    const athleteId = candidate.matchedAthleteId || candidate.createdAthleteId;
    if (athleteId) {
      const athlete = athletes.find(entry => entry.id === athleteId)
        || candidate.suggested.find(entry => entry.id === athleteId);
      return `自动关联：${athlete?.name || candidate.name} · ${athlete?.team || candidate.team || '无队伍'} · 编号 ${athleteId}`;
    }
    return candidate.suggested.length ? '身份待确认（请选择已有运动员）' : '新建';
  };

  const applyBulkCandidateTeam = (team: string) => {
    setBulkCandidateTeam(team);
    if (!batch || !team) return;
    const pending = batch.athleteCandidates.filter(
      (candidate) => candidate.status === 'pending' && !candidate.excluded && !candidate.matchedAthleteId
    );
    if (!pending.length) return;
    for (const candidate of pending) patchAthleteCandidate(candidate.id, { team });
    setMessage(`已为${pending.length}名待建档运动员填入“${team}”，保存后生效。`);
  };

  const saveCorrections = async (
    overrideAthlete?: Map<number, AthleteCorrection>,
    overrideItems?: Map<number, Correction>
  ) => {
    const athleteMap = overrideAthlete ?? athleteCorrections;
    const itemMap = overrideItems ?? corrections;
    if (!batch || busyRef.current) return null;
    busyRef.current = 'save';
    setBusy('save');
    setError('');
    setSaveFailed(false);
    try {
      let currentBatch = batch;
      if (athleteMap.size) {
        currentBatch = (await api.updateDataImportAthletes(batch.id, [...athleteMap.values()], expectedRevision(currentBatch))).batch;
        rememberRevision(currentBatch);
        setBatch(currentBatch);
        setAthleteCorrections(new Map());
      }
      if (itemMap.size || !athleteMap.size)
        currentBatch = (await api.updateDataImportItems(batch.id, [...itemMap.values()], undefined, expectedRevision(currentBatch))).batch;
      rememberRevision(currentBatch);
      setBatch(currentBatch);
      setCorrections(new Map());
      setAthleteCorrections(new Map());
      setMessage('校对内容已保存，服务端已按最终数据重新校验并检测重复。');
      return currentBatch;
    } catch (nextError) {
      setSaveFailed(true);
      setError(nextError instanceof Error ? nextError.message : '校对内容保存失败。');
      return null;
    } finally {
      setBusy('');
    }
  };

  // 连续编辑串行保存；只把最新一轮响应用于页面，避免旧响应覆盖正在输入的值。
  useEffect(() => {
    const batchId = batch?.id;
    if (!batchId || !corrections.size || athleteCorrections.size || [...corrections.values()].some(item => item.sourceCells)) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      correctionQueue.current = correctionQueue.current.then(async () => {
        if (cancelled) return;
        setBusy('save');
        setSaveFailed(false);
        try {
          const info = await api.updateDataImportItems(batchId, [...corrections.values()], undefined, expectedRevision(batch));
          rememberRevision(info.batch);
          if (!cancelled) {
            setBatch(info.batch);
            setCorrections(new Map());
            setError('');
          }
        } catch (error) {
          if (!cancelled) { setSaveFailed(true); setError(error instanceof Error ? error.message : '自动校验失败，请重试保存。'); }
        } finally {
          setBusy(current => current === 'save' ? '' : current);
        }
      });
    }, 600);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [corrections, athleteCorrections.size, batch]);

  const hasUnsavedChanges = corrections.size > 0 || athleteCorrections.size > 0 || pendingSelections.size > 0;
  navigationState.current = { unsaved: hasUnsavedChanges, busy: Boolean(busy) || savingReviewGroups.size > 0 };
  useEffect(() => {
    onNavigationGuardChange?.(() => {
      if (navigationState.current.busy) {
        setError('正在处理导入，请等待完成后再离开。');
        return false;
      }
      return !navigationState.current.unsaved || window.confirm('当前导入有未保存修改，离开会丢失这些修改。确定离开？');
    });
    return () => onNavigationGuardChange?.(null);
  }, [onNavigationGuardChange]);
  useEffect(() => {
    const media = window.matchMedia('(max-width: 720px)');
    const update = () => setIsCompact(media.matches);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  useEffect(() => {
    if (!batch || batch.project !== project) return;
    writeImportReviewPosition(positionKey, { batchId: batch.id, filter, query, page, reviewGroupPage, selectedPersonId });
  }, [positionKey, project, batch, filter, query, page, reviewGroupPage, selectedPersonId]);
  useEffect(() => { setMobileIndex(0); }, [filter, query, page]);
  useEffect(() => {
    if (!hasUnsavedChanges) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [hasUnsavedChanges]);

  useEffect(() => {
    if (!personDialogOpen && !confirmDialogOpen && !duplicateDialogOpen) return;
    const previous = document.activeElement;
    const dialog = document.querySelector<HTMLElement>('.data-import-dialog-backdrop [role="dialog"]');
    if (!dialog) return;
    const focusable = () => [...dialog.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex="0"]')];
    focusable()[0]?.focus();
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busyRef.current) {
        setPersonDialogOpen(false); setConfirmDialogOpen(false); setDuplicateDialogOpen(false);
      }
      if (event.key !== 'Tab') return;
      const elements = focusable();
      const first = elements[0], last = elements.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    dialog.addEventListener('keydown', handleKey);
    return () => { dialog.removeEventListener('keydown', handleKey); if (previous instanceof HTMLElement) previous.focus(); };
  }, [personDialogOpen, confirmDialogOpen, duplicateDialogOpen]);

  const unconfirmedPersons = useMemo(() => {
    if (!batch) return [];
    return batch.athleteCandidates.filter(
      (candidate) => importPersonNeedsConfirmation(candidate, batch.items)
    );
  }, [batch]);

  const commit = async () => {
    if (batch?.items.some(item => pendingSelections.has(item.id))) { setError('选择尚未保存，请等待保存完成；保存失败时请重新点击要采用的值。'); return; }
    if (!batch) return;
    setError('');
    setMessage('');
    let currentBatch = batch;
    if (corrections.size || athleteCorrections.size) {
      const saved = await saveCorrections();
      if (!saved) return;
      currentBatch = saved;
    }
    const stillUnconfirmed = currentBatch.athleteCandidates.filter(
      (candidate) => importPersonNeedsConfirmation(candidate, currentBatch.items)
    );
    if (stillUnconfirmed.length) {
      setError(`还有${stillUnconfirmed.length}名运动员未完成人员确认，请先处理。`);
      setPersonDialogOpen(true);
      return;
    }
    if (currentBatch.errorCount > 0) {
      setError(
        `仍有${currentBatch.errorCount}条红色错误：可编辑的红色字段请修正，无法修改的错误行请在列表中排除后再提交。`
      );
      return;
    }
    setConfirmDialogOpen(true);
  };

  const doCommit = async () => {
    if (!batch) return;
    setConfirmDialogOpen(false);
    setBusy('commit');
    try {
      const info = await api.commitDataImport(batch.id, 'update', expectedRevision(batch));
      rememberRevision(info.batch);
      setBatch(info.batch);
      setMessage(info.message);
      setResult({
        message: info.message,
        createdAthletes: info.createdAthletes,
        linkedAthletes: info.linkedAthletes,
        createdRecords: info.createdRecords,
        updatedRecords: info.updatedRecords,
        skipped: info.skipped,
        receipt: info.receipt,
        filledProfileFields: info.filledProfileFields,
        overwrittenProfileFields: info.overwrittenProfileFields,
      });
      await refreshBatches();
      onChanged();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '正式入库失败。');
    } finally {
      setBusy('');
    }
  };

  const confirmAndContinue = async () => {
    if (!batch) return;
    const nextMap = new Map(athleteCorrections);
    for (const candidate of batch.athleteCandidates) {
      if (candidate.status !== 'pending' || candidate.excluded) continue;
      const unresolvedAmbiguity = candidate.suggested.length > 0 && !personCreateModes.has(candidate.id) && !candidate.matchedAthleteId;
      const missingTeam = !candidate.matchedAthleteId && !candidate.team;
      const missingLink = personLinkModes.has(candidate.id) && !candidate.matchedAthleteId;
      if (unresolvedAmbiguity || missingTeam || missingLink) continue; // 身份歧义与缺队伍必须逐项解决
      nextMap.set(candidate.id, { ...(nextMap.get(candidate.id) || { id: candidate.id }), confirmed: true });
    }
    const pendingFix = batch.athleteCandidates.filter((candidate) => {
      if (candidate.status !== 'pending' || candidate.excluded) return false;
      if (candidate.suggested.length > 0 && !personCreateModes.has(candidate.id) && !candidate.matchedAthleteId) return true;
      if (!candidate.matchedAthleteId && (!candidate.team || personLinkModes.has(candidate.id))) return true;
      return false;
    });
    if (pendingFix.length) {
      setPersonTab('all');
      setPersonQuery('');
      setSelectedPersonId(pendingFix[0].id);
      setError(
        `还有${pendingFix.length}人需要处理，已定位到“${pendingFix[0].name}”：${pendingFix[0].suggested.length || personLinkModes.has(pendingFix[0].id) ? '请在右侧选择要关联的已有运动员' : '请在右侧选择所属队伍'}。`
      );
      return;
    }
    const saved = await saveCorrections(nextMap);
    if (!saved) return;
    setPersonDialogOpen(false);
    setMessage('人员确认完成，已保存人员映射草稿；请继续数据校对。');
  };

  const reviewGroups = useMemo(() => importReviewGroups(batch?.items || []), [batch]);
  const pendingReviewGroups = reviewGroups.filter(group => !group.some(item => item.payload.valueReviewDecision || importSessionChoices(item).length > 1));
  const recordCount = Math.max(0, ...pendingReviewGroups.map(group => group.length));
  const matchingReviewGroups = reviewGroups.filter(group => !query.trim() || group.some(item => `${item.rawAthleteName} ${item.athleteName} ${item.eventDate} ${item.metricLabel} ${item.metricCode} ${item.testType} ${item.exerciseName}`.includes(query.trim())));
  const reviewGroupPages = Math.max(1, Math.ceil(matchingReviewGroups.length / 8));
  const currentReviewPage = Math.min(reviewGroupPage, reviewGroupPages - 1);
  const reviewGroupIds = useMemo(() => new Set(reviewGroups.flatMap(group => group.map(item => item.id))), [reviewGroups]);
  const handleValueReview = async (updates: Correction[], bulk = false) => {
    const targetId = updates[0]?.id;
    const scoped = !bulk && updates.length > 0 && updates.every(update => update.id === targetId && update.payload?.valueReview);
    if (bulk) setBusy('save');
    const current = corrections.size || athleteCorrections.size ? await saveCorrections() : batch;
    if (!current) { if (bulk) setBusy(''); return; }
    if (scoped) setSavingReviewGroups(previous => new Set(previous).add(targetId));
    else setBusy('save');
    setError('');
    try {
      const result = await api.updateDataImportItems(current.id, updates, scoped ? targetId : undefined, expectedRevision(current));
      rememberRevision(result.batch);
      setBatch(previous => {
        if (!previous || previous.id !== current.id) return previous;
        if (!result.partial) return result.batch;
        const updated = new Map(result.batch.items.map(item => [item.id, item]));
        const items = previous.items.map(item => updated.get(item.id) || item);
        const active = items.filter(item => item.quality !== 'skipped' && item.itemType !== 'invalid_row');
        return { ...previous, revision: result.batch.revision, items,
          validCount: items.filter(item => item.quality === 'valid').length,
          warningCount: items.filter(item => item.quality === 'warning').length,
          errorCount: items.filter(item => item.quality === 'error').length,
          counts: { ...previous.counts,
            newCount: active.filter(item => !item.conflict?.exists).length,
            duplicateCount: active.filter(item => item.conflict?.exists).length,
            overwriteCount: active.filter(item => item.conflict?.fields.some(field => field.overwrites)).length,
            invalidCount: items.filter(item => item.itemType === 'invalid_row' || item.quality === 'error').length,
          },
        };
      });
      setPendingSelections(previous => new Set([...previous].filter(id => !updates.some(update => update.id === id))));
      if (bulk) setReviewRevision(previous => previous + 1);
      setMessage(bulk ? `已将所选记录应用到全部 ${updates.length} 组待审查数据；缺少的冲突字段仍需选择。` : '选择已保存。');
    } catch (error) {
      setError(error instanceof Error ? error.message : '选择保存失败，请重新点击要采用的值。');
    } finally {
      if (scoped) setSavingReviewGroups(previous => new Set([...previous].filter(id => id !== targetId)));
      else setBusy('');
    }
  };

  const filteredItems = useMemo(() => {
    if (!batch) return [];
    const needle = query.trim().toLowerCase();
    return batch.items
      .filter((item) => {
        if (reviewGroupIds.has(item.id) || item.payload.valueAutoMerged) return false;
        if (filter !== 'all' && item.payload.valueAutoMergeSources && item.quality === 'valid' && !item.conflict?.fields.some(field => field.overwrites)) return false;
        if (filter === 'exception' && !isImportException(item))
          return false;
        if (filter === 'duplicate' && !item.conflict?.exists) return false;
        if (filter === 'overwrite' && !item.conflict?.fields.some(field => field.overwrites))
          return false;
        if (!needle) return true;
        return [
          item.rawAthleteName,
          item.athleteName,
          item.exerciseName,
          item.metricLabel,
          item.sourceSheet,
          item.sourceAddress,
        ].some((value) => value.toLowerCase().includes(needle));
      })
      .sort((a, b) => {
        const rank = (item: DataImportItem) =>
          item.itemType === 'invalid_row' || item.quality === 'error'
            ? 0
            : item.quality === 'warning'
              ? 1
              : item.conflict?.fields.some(field => field.overwrites) ? 2 : item.conflict?.exists ? 3 : 4;
        return rank(a) - rank(b);
      });
  }, [batch, filter, query, reviewGroupIds]);

  const totalPages = Math.max(1, Math.ceil(filteredItems.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages - 1);
  const pageItems = filteredItems.slice(currentPage * PAGE_SIZE, currentPage * PAGE_SIZE + PAGE_SIZE);
  const compactIndex = Math.min(mobileIndex, Math.max(0, pageItems.length - 1));
  const displayedItems = isCompact ? pageItems.slice(compactIndex, compactIndex + 1) : pageItems;
  const goToErrors = () => {
    setFilter('exception');
    setQuery('');
    setPage(0);
    setReviewGroupPage(0);
    setMobileIndex(0);
    reviewRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    reviewRef.current?.focus({ preventScroll: true });
  };

  const summaryPreview = useMemo(() => {
    if (!batch) return null;
    const importable = batch.items.filter(
      (item) => (item.quality === 'valid' || item.quality === 'warning') && item.resolution !== 'skip' && !item.payload.valueAutoMerged && item.itemType !== 'invalid_row'
    );
    const excludedKeys = new Set(
      batch.athleteCandidates.filter((candidate) => candidate.excluded).map((c) => c.normalizedName)
    );
    const active = importable.filter((item) => !excludedKeys.has(dataImportPersonKey(item)));
    const createPersons = batch.athleteCandidates.filter(
      (candidate) =>
        candidate.status === 'pending' && !candidate.excluded && !candidate.matchedAthleteId &&
        active.some(item => dataImportPersonKey(item) === candidate.normalizedName)
    );
    const linkPersons = batch.athleteCandidates.filter(
      (candidate) =>
        (candidate.status === 'pending' && candidate.matchedAthleteId) ||
        candidate.status === 'matched'
    );
    const statistics = importStatistics(batch.items, excludedKeys, batch.summary.unfilledRows || 0);
    const { newCount: newRecords, updateCount: updateRecords } = statistics;
    const skipRecords = statistics.unchangedCount + statistics.excludedCount + statistics.mergedCount;
    const overwriteFields = active.reduce(
      (sum, item) => sum + (item.conflict?.fields.filter((field) => field.overwrites).length || 0),
      0
    );
    return {
      createPersons: createPersons.length,
      linkPersons: linkPersons.length,
      statistics,
      newRecords,
      updateRecords,
      skipRecords,
      overwriteFields,
    };
  }, [batch]);

  const selectedPerson = useMemo(
    () =>
      batch?.athleteCandidates.find((candidate) => candidate.id === selectedPersonId) || null,
    [batch, selectedPersonId]
  );

  const visiblePersons = useMemo(() => {
    if (!batch) return [];
    const needle = personQuery.trim().toLowerCase();
    return batch.athleteCandidates.filter((candidate) => {
      if (personTab === 'pending' && !(candidate.status === 'pending' && !candidate.matchedAthleteId && !candidate.suggested.length))
        return false;
      if (personTab === 'ambiguous' && !(candidate.status === 'pending' && !candidate.matchedAthleteId && candidate.suggested.length))
        return false;
      if (!needle) return true;
      return [candidate.name, candidate.team, candidate.sourceSheet].some((value) =>
        value.toLowerCase().includes(needle)
      );
    });
  }, [batch, personTab, personQuery]);

  const batchConfirmNoConflict = () => {
    if (!batch) return;
    const ready = batch.athleteCandidates.filter(
      (candidate) =>
        candidate.status === 'pending' &&
        !candidate.excluded &&
        !candidate.confirmed &&
        candidate.suggested.length === 0 &&
        (candidate.matchedAthleteId || (candidate.team && !personLinkModes.has(candidate.id)))
    );
    for (const candidate of ready) patchAthleteCandidate(candidate.id, { confirmed: true });
    setMessage(`已批量确认${ready.length}名无冲突人员，请保存后继续。`);
  };

  return (
    <PageContainer className="data-import-page">
      <PageHeader
        className="data-management-header data-import-header"
        eyebrow="DATA IMPORT"
        title="数据导入"
        actions={
          <div className="data-import-hero-actions">
            <label className="data-import-template-team">
              <span>模板预填队伍</span>
              <select
                value={templateTeamsProject === project ? templateTeam : ''}
                disabled={Boolean(busy) || templateTeamsProject !== project}
                onChange={(event) => setTemplateTeam(event.target.value)}
              >
                <option value="">{templateTeamsProject !== project ? '正在加载队伍…' : teams.length ? '全部授权队伍' : '暂无队伍（空模板）'}</option>
                {teams.map((team) => <option key={team.id} value={team.name}>{team.name}</option>)}
              </select>
            </label>
            <button
              type="button"
              className="data-import-template"
              disabled={Boolean(busy) || templateTeamsProject !== project}
              onClick={() => downloadTemplate('profile')}
            >
              <Download size={19} />
              <div>
                <strong>{busy === 'template' ? '正在准备模板…' : '队员资料模板'}</strong>
                <span>批量建档与补全，预填已有人员</span>
              </div>
            </button>
            <button
              type="button"
              className="data-import-template"
              disabled={Boolean(busy) || templateTeamsProject !== project}
              onClick={() => downloadTemplate('training')}
            >
              <Download size={19} />
              <div>
                <strong>训练记录模板</strong>
                <span>课次、组次与恢复，预填已有人员</span>
              </div>
            </button>
            <button
              type="button"
              className="data-import-template"
              disabled={Boolean(busy) || templateTeamsProject !== project}
              onClick={() => downloadTemplate('test')}
            >
              <Download size={19} />
              <div>
                <strong>测试成绩模板</strong>
                <span>专项测试与体能测试，预填已有人员</span>
              </div>
            </button>
            <button
              type="button"
              className="data-import-template"
              disabled={Boolean(busy) || templateTeamsProject !== project}
              onClick={() => downloadTemplate('unified')}
            >
              <FileSpreadsheet size={19} />
              <div>
                <strong>统一数据模板</strong>
                <span>按资料、测量、训练与测试分类，预填已有人员</span>
              </div>
            </button>
            <button
              type="button"
              className="data-import-template"
              disabled={Boolean(busy)}
              onClick={exportUnifiedData}
            >
              <Database size={19} />
              <div>
                <strong>导出统一数据</strong>
                <span>导出当前项目及权限范围内已入库数据</span>
              </div>
            </button>
          </div>
        }
      />

      <ol className="data-import-steps" aria-label="数据导入进度">
        {['上传并检查', '确认运动员', '数据校对与确认导入', '导入结果'].map((label, index) => {
          const current = !batch ? 0 : batch.status === 'committed' ? 3 : unconfirmedPersons.length ? 1 : 2;
          return <li key={label} aria-current={index === current ? 'step' : undefined}>
            <span>{index + 1}</span>{label}{index === 1 && batch && !unconfirmedPersons.length ? '（已自动通过）' : ''}
          </li>;
        })}
      </ol>

      <div className="data-import-grid">
        <section className="data-import-upload-card">
          <div className="data-import-card-heading">
            <FileSpreadsheet size={20} />
            <div>
              <strong>上传源文件</strong>
              <span>支持 XLS / XLSX，单文件不超过 80MB</span>
            </div>
          </div>
          <button
            type="button"
            className="data-import-drop"
            onClick={() => fileRef.current?.click()}
          >
            <UploadCloud size={28} />
            <strong>{file ? file.name : '选择 Excel 文件'}</strong>
            <span>
              {file
                ? `${(file.size / 1024 / 1024).toFixed(2)} MB`
                : '上传后先识别运动员，再校对业务数据'}
            </span>
          </button>
          <input
            ref={fileRef}
            className="visually-hidden"
            type="file"
            accept=".xls,.xlsx"
            aria-label="Excel文件"
            onChange={(event) => setFile(event.target.files?.[0] || null)}
          />
          <label className="data-import-date">
            <span>缺失日期时使用</span>
            <input
              type="date"
              value={defaultDate}
              onChange={(event) => setDefaultDate(event.target.value)}
            />
            <small>表内日期优先；新模板缺日期须在此选择。旧文件使用当天日期时会在审查中提示</small>
          </label>
          <button
            className="data-import-primary"
            disabled={!file || Boolean(busy)}
            onClick={() => void analyze()}
          >
            {busy === 'analyze' ? (
              <RefreshCw className="spin" size={17} />
            ) : (
              <FileCheck2 size={17} />
            )}
            上传并检查
          </button>
        </section>

        <section className="data-import-history-card">
          <div className="data-import-card-heading">
            <Clock3 size={20} />
            <div>
              <strong>最近导入批次</strong>
              <span>当前项目：{projectLabel(project)}</span>
            </div>
            <button type="button" disabled={Boolean(busy) || hasUnsavedChanges} title={hasUnsavedChanges ? '请先保存当前校对' : '预览过期草稿，不会立即删除'} onClick={() => void previewExpiredDrafts()}>清理过期草稿</button>
          </div>
          {cleanupPreview?.project === project && <section aria-label="过期草稿清理预览">
            <p>创建超过{cleanupPreview.retentionDays}天、且最近{cleanupPreview.retentionDays}天未保存校对的本人草稿，共{cleanupPreview.drafts.length}批。仅显示当前项目授权范围，每次最多200批；当前打开的批次不参与。缺少最后编辑时间的历史已校对草稿会保留。</p>
            {cleanupPreview.drafts.length > 0 && <details open><summary>查看待清理草稿及暂存条数</summary><ul>{cleanupPreview.drafts.map(item => <li key={item.id}>{item.filename} · 创建于{new Date(item.createdAt.endsWith('Z') ? item.createdAt : `${item.createdAt}Z`).toLocaleString('zh-CN')} · 暂存{item.itemCount}条</li>)}</ul></details>}
            <p>确认后永久删除草稿及暂存明细；已入库批次和正式数据会保留。数据库空闲空间可供后续复用，文件大小不一定立即缩小。</p>
            <button type="button" disabled={Boolean(busy) || hasUnsavedChanges || !cleanupPreview.drafts.length} onClick={() => void cleanupExpiredDrafts()}>确认清理{cleanupPreview.drafts.length}个草稿</button>
            <button type="button" disabled={Boolean(busy)} onClick={() => setCleanupPreview(null)}>取消清理</button>
          </section>}
          <div className="data-import-history-list">
            {!batches.length && <p className="data-import-empty">当前项目还没有导入记录。</p>}
            {batches.map((item) => (
              <div key={item.id} className="data-import-history-row">
                <button
                  type="button"
                  className={batch?.id === item.id ? 'active' : ''}
                  onClick={() => void loadBatch(item.id)}
                  disabled={Boolean(busy)}
                  aria-label={`查看导入批次：${item.filename}`}
                >
                  <span className={`batch-state ${item.status}`}>
                    {STATUS_LABELS[item.status as DataImportBatch['status']] || item.status}
                  </span>
                  <strong title={item.filename}>{item.filename}</strong>
                  <small>
                    {item.itemCount}条 · 错误{item.errorCount} ·{' '}
                    {new Date(item.createdAt).toLocaleString('zh-CN')}
                  </small>
                </button>
                {item.status === 'reviewing' && (
                  <button
                    type="button"
                    className="data-import-discard"
                    disabled={Boolean(busy)}
                    onClick={() => void discardBatch(item)}
                    aria-label={`放弃提交导入批次：${item.filename}`}
                  >
                    放弃提交
                  </button>
                )}
              </div>
            ))}
          </div>
        </section>
      </div>

      {createPortal(
        <div className="data-import-notifications" aria-live="polite" aria-atomic="true">
          {(message || error) && (
            <div className={`data-import-message ${error ? 'error' : 'success'}`} role={error ? 'alert' : 'status'}>
              {error ? <AlertTriangle size={20} aria-hidden="true" /> : <CheckCircle2 size={20} aria-hidden="true" />}
              <span>{error || message}</span>
              <button
                type="button"
                className="data-import-message-close"
                aria-label="关闭提示"
                onClick={() => { setError(''); setMessage(''); }}
              >
                <X size={18} aria-hidden="true" />
              </button>
            </div>
          )}
        </div>,
        document.body
      )}

      {result && (
        <section className="data-import-result">
          <div className="data-import-card-heading">
            <CheckCircle2 size={20} />
            <div>
              <strong>导入完成</strong>
              <span>{result.message}</span>
            </div>
          </div>
          {result.receipt && <ImportCountSummary counts={result.receipt} />}
          <div className="data-import-summary">
            <div>
              <span>新建运动员</span>
              <strong>{result.createdAthletes}</strong>
              <small>最小建档，无登录账号</small>
            </div>
            <div>
              <span>关联已有</span>
              <strong>{result.linkedAthletes}</strong>
              <small>非空数据按本次导入更新</small>
            </div>
            <div>
              <span>新增记录</span>
              <strong>{result.createdRecords}</strong>
              <small>业务数据新写入</small>
            </div>
            <div className="warning">
              <span>更新记录</span>
              <strong>{result.updatedRecords}</strong>
              <small>
                补全{result.filledProfileFields}项 / 覆盖{result.overwrittenProfileFields}项字段
              </small>
            </div>
            <div>
              <span>未写入合计</span>
              <strong>{result.skipped}</strong>
              <small>保留数据库原值</small>
            </div>
          </div>
        </section>
      )}

      {batch && (
        <>
          {batch.status === 'reviewing' && <section className="data-import-summary data-import-main-summary" aria-label="本次导入概况">
            <div className={batch.errorCount || unconfirmedPersons.length ? 'danger' : ''}>
              <span>待处理</span>
              <strong>{batch.errorCount}条错误 · {unconfirmedPersons.length}名人员</strong>
              <small>完成后即可确认导入</small>
            </div>
            <div><span>新增记录</span><strong>{summaryPreview?.newRecords ?? 0}</strong><small>新建运动员{summaryPreview?.createPersons ?? 0}名</small></div>
            <div><span>更新记录</span><strong>{summaryPreview?.updateRecords ?? 0}</strong><small>空白保留原值，真实0正常写入</small></div>
          </section>}
          {batch.status === 'reviewing' && summaryPreview && <ImportCountSummary counts={summaryPreview.statistics} />}
          {batch.status === 'committed' && !result && batch.summary.receipt && <section className="data-import-result"><h2>入库回执</h2><ImportCountSummary counts={batch.summary.receipt} /></section>}

          <section className="data-import-sheet-audit">
            <div className="data-import-card-heading">
              <FileCheck2 size={20} />
              <div>
                <strong>工作表识别结果</strong>
                <span>展示哪些工作表会入库、哪些被安全忽略</span>
              </div>
              <button
                type="button"
                className="data-import-outline"
                disabled={Boolean(busy)}
                onClick={() => void downloadErrors()}
              >
                <FileWarning size={16} />
                {busy === 'errors' ? '正在导出…' : '下载问题清单'}
              </button>
            </div>
            <div className="sheet-audit-grid">
              {batch.summary.recognizedSheets.map((sheet) => (
                <article key={`ok-${sheet.name}`}>
                  <CheckCircle2 size={16} />
                  <div>
                    <strong>{sheet.name}</strong>
                    <span>
                      {sheet.type} · {sheet.items}条
                    </span>
                    <small>{sheet.note}</small>
                  </div>
                </article>
              ))}
              {batch.summary.ignoredSheets.map((sheet) => (
                <article className="ignored" key={`ignore-${sheet.name}`}>
                  <AlertTriangle size={16} />
                  <div>
                    <strong>{sheet.name}</strong>
                    <span>未进入正式数据</span>
                    <small>{sheet.reason}</small>
                  </div>
                </article>
              ))}
            </div>
          </section>

          <section ref={reviewRef} className="data-import-review" tabIndex={-1}>
            <div className="data-import-review-head">
              <div>
                <span>REVIEW QUEUE</span>
                <h2>数据审查与校对</h2>
                <p>
                  修改后自动保存并重新校验；空白不覆盖已有数据，真实0值会保留。
                  {unconfirmedPersons.length > 0 && (
                    <strong className="data-import-gate">
                      还有{unconfirmedPersons.length}名运动员待确认，
                      <button type="button" onClick={() => setPersonDialogOpen(true)}>
                        打开人员确认
                      </button>
                    </strong>
                  )}
                </p>
              </div>
              <div className="data-import-review-actions">
                <label className="data-import-search">
                  <Search size={15} />
                  <input
                    value={query}
                    onChange={(event) => {
                      setQuery(event.target.value);
                      setPage(0);
                      setReviewGroupPage(0);
                    }}
                    placeholder="搜索姓名、动作或指标"
                  />
                </label>
                <button
                  type="button"
                  disabled={Boolean(busy) || batch.status !== 'reviewing'}
                  title="重新校验当前草稿并刷新数据库差异"
                  onClick={() => void saveCorrections()}
                >
                  <Save size={15} />
                  {busy === 'save' ? '正在重新校验…' : '保存校对'}
                  {corrections.size + athleteCorrections.size
                    ? `（${corrections.size + athleteCorrections.size}）`
                    : ''}
                </button>
                <button
                  type="button"
                  disabled={Boolean(busy) || batch.status !== 'reviewing'}
                  onClick={() => setPersonDialogOpen(true)}
                >
                  <Users size={15} />
                  人员确认
                </button>
              </div>
            </div>
            <p role="status" aria-live="polite" className="data-import-save-status">
              {busy === 'save' ? '正在保存修改并重新校验…' : saveFailed ? '保存失败，修改仍保留在当前页面，请重试保存。' : hasUnsavedChanges ? '尚有未保存修改；校验完成后才能确认最终数量。' : '当前校对已保存；正常数据无需逐行确认。'}
            </p>
            <div className="data-import-filters">
              {(
                [
                  ['exception', `异常 ${batch.items.filter(isImportException).length}`],
                  ['duplicate', `重复 ${batch.counts.duplicateCount}`],
                  ['overwrite', `将更新 ${batch.counts.overwriteCount}`],
                  ['all', `全部 ${batch.itemCount}`],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  className={filter === key ? 'active' : ''}
                  onClick={() => {
                    setFilter(key);
                    setPage(0);
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
            {reviewGroups.length > 0 && <div className="import-value-review-groups">
              <div className="import-value-review-heading">
                <h3>导入数据集中审查 · {reviewGroups.length} 组</h3>
                {recordCount > 0 && <div className="import-value-review-actions" role="group" aria-label="全选待审查记录">
                  <span>全选：</span>
                  {Array.from({ length: recordCount }, (_, index) => <button
                    key={index} type="button"
                    disabled={Boolean(busy) || savingReviewGroups.size > 0 || batch.items.some(item => pendingSelections.has(item.id)) || batch.status !== 'reviewing'}
                    title={`将记录 ${index + 1} 应用到所有页面的待审查组；缺少该记录的组保持不变`}
                    onClick={() => {
                      const updates = selectImportReviewRecord(pendingReviewGroups, index);
                      if (updates.length) void handleValueReview(updates, true);
                    }}
                  >记录 {index + 1}</button>)}
                </div>}
              </div>
              {matchingReviewGroups.slice(currentReviewPage * 8, (currentReviewPage + 1) * 8).map(group => <ImportConflictReview
                key={`${reviewRevision}-${group.map(item => item.id).join('-')}-${Boolean(group.find(item => item.payload.valueReviewDecision))}`}
                items={group} disabled={Boolean(busy) || group.some(item => savingReviewGroups.has(item.id)) || batch.status !== 'reviewing'}
                onAssignSession={(id, sessionOrder) => void handleValueReview([{ id, payload: { sessionOrder } }])}
                onPending={id => setPendingSelections(current => new Set(current).add(id))}
                onMerge={(targetId, memberIds, values, includeDatabase) => void handleValueReview([...(group.some(item => item.payload.valueReviewDecision) ? [{ id: targetId, payload: { valueReview: { action: 'reopen' } } }] : []), { id: targetId, payload: { valueReview: { action: 'merge', memberIds, values, includeDatabase } } }])}
                onDraft={(id, choices, manual) => void handleValueReview([{ id, payload: { valueReview: { action: 'draft', choices, manual } } }])}
                onExclude={id => void handleValueReview([{ id, resolution: 'skip' }])}
                onSplit={dates => void handleValueReview(dates)}
              />)}
              {reviewGroupPages > 1 && <nav className="import-value-review-heading" aria-label="数据冲突审查分页">
                <button type="button" disabled={currentReviewPage === 0 || Boolean(busy)} onClick={() => setReviewGroupPage(currentReviewPage - 1)}>上一组页</button>
                <span>第 {currentReviewPage + 1} / {reviewGroupPages} 页 · 每页 8 组</span>
                <button type="button" disabled={currentReviewPage >= reviewGroupPages - 1 || Boolean(busy)} onClick={() => setReviewGroupPage(currentReviewPage + 1)}>下一组页</button>
              </nav>}
            </div>}
            {isCompact && pageItems.length > 0 && <nav className="data-import-compact-navigation" aria-label="逐条校对">
              <button type="button" disabled={compactIndex === 0} onClick={() => setMobileIndex(compactIndex - 1)}>上一条</button>
              <span>本页第{compactIndex + 1} / {pageItems.length}条</span>
              <button type="button" disabled={compactIndex >= pageItems.length - 1} onClick={() => setMobileIndex(compactIndex + 1)}>下一条</button>
            </nav>}
            <div className="data-import-table-wrap">
              <table className="data-import-table data-import-review-table">
                <colgroup>
                  <col style={{ width: '5%' }} />
                  <col style={{ width: '6%' }} />
                  <col style={{ width: '11%' }} />
                  <col style={{ width: '10%' }} />
                  <col style={{ width: '9%' }} />
                  <col style={{ width: '24%' }} />
                  <col style={{ width: '9%' }} />
                  <col style={{ width: '26%' }} />
                </colgroup>
                <thead>
                  <tr>
                    <th>状态</th>
                    <th>类型</th>
                    <th>运动员</th>
                    <th>日期</th>
                    <th>动作/指标</th>
                    <th>数值（最终入库值）</th>
                    <th>重复处理</th>
                    <th>校验与冲突</th>
                  </tr>
                </thead>
                <tbody>
                  {displayedItems.map((item) => (
                    <tr key={item.id} className={item.quality}>
                      <td>
                        <span className={`quality-pill ${item.quality}`}>
                          {item.itemType === 'invalid_row'
                            ? '错误行'
                            : item.quality === 'valid'
                              ? '通过'
                              : item.quality === 'warning'
                                ? '复核'
                                : item.quality === 'error'
                                  ? '错误'
                                  : '跳过'}
                        </span>
                      </td>
                      <td>{ITEM_LABELS[item.itemType]}</td>
                      <td>
                        {item.itemType === 'scoring_rule' || item.itemType === 'invalid_row' ? (
                          <span>{item.itemType === 'invalid_row' ? item.rawValue.slice(0, 16) : '规则数据'}</span>
                        ) : (
                          <span>
                            {item.athleteName || item.rawAthleteName}
                            <small>{item.athleteId ? item.athleteTeam : '待完成人员确认'}</small>
                          </span>
                        )}
                      </td>
                      <td>
                        {item.itemType === 'scoring_rule' || item.itemType === 'invalid_row' ? (
                          '—'
                        ) : (
                          <input
                            disabled={Boolean(busy) || batch.status !== 'reviewing' || Boolean(item.payload.valueReviewDecision) || Boolean(item.payload.sourceRow) && !item.payload.sourceRowOutdated}
                            type="date"
                            value={item.eventDate}
                            onChange={(event) =>
                              patchItem(item.id, {
                                eventDate: event.target.value,
                              })
                            }
                          />
                        )}
                      </td>
                      <td>
                        {item.itemType === 'test_measurement' && batch.status === 'reviewing' && !item.payload.valueReviewDecision && (!item.payload.sourceRow || item.payload.sourceRowOutdated) ? <label>
                          <span>测试项目</span>
                          <select value={item.metricCode} disabled={Boolean(busy)} onChange={event => patchItem(item.id, { metricCode: event.target.value })}>
                            {!metrics.some(metric => metric.code === item.metricCode) && <option value={item.metricCode}>{item.metricLabel || '请选择有效项目'}</option>}
                            {metrics.map(metric => <option key={metric.code} value={metric.code}>{metric.label}{metric.unit ? `（${metric.unit}）` : ''}</option>)}
                          </select>
                        </label> : <strong>{item.exerciseName || item.metricLabel || '—'}</strong>}
                        {item.itemType === 'training_set' && importSessionChoices(item).length > 1 && <label>
                          <span>所属课次</span>
                          <select aria-label={`${item.exerciseName}所属课次`} disabled={Boolean(busy) || batch.status !== 'reviewing'}
                            value={Number(item.payload.sessionOrder) || ''}
                            onChange={event => void handleValueReview([{ id: item.id, payload: { sessionOrder: Number(event.target.value) } }])}>
                            <option value="">请选择课次</option>
                            {importSessionChoices(item).map(choice => <option key={choice.sessionOrder} value={choice.sessionOrder}>第 {choice.sessionOrder} 课 · {choice.label}</option>)}
                          </select>
                        </label>}

                        {item.side !== 'center' && (
                          <small>
                            {item.side === 'left' ? '左侧' : item.side === 'right' ? '右侧' : '双侧'}
                          </small>
                        )}
                      </td>
                      <td>
                        {item.itemType === 'training_set' ? (
                          <div className="training-value-inputs">
                            <input
                              disabled={Boolean(busy) || batch.status !== 'reviewing' || Boolean(item.payload.sourceRow) && !item.payload.sourceRowOutdated}
                              type="number"
                              step="0.1"
                              value={item.actualWeightKg ?? ''}
                              onChange={(event) => {
                                const value = numberOrUndefined(event.target.value);
                                if (value === undefined) return;
                                patchItem(item.id, { actualWeightKg: value });
                              }}
                            />
                            <span>kg ×</span>
                            <input
                              disabled={Boolean(busy) || batch.status !== 'reviewing' || Boolean(item.payload.sourceRow) && !item.payload.sourceRowOutdated}
                              type="number"
                              step="1"
                              value={item.actualReps ?? ''}
                              onChange={(event) => {
                                const value = numberOrUndefined(event.target.value);
                                if (value === undefined) return;
                                patchItem(item.id, { actualReps: value });
                              }}
                            />
                            <span>次</span>
                          </div>
                        ) : item.itemType === 'scoring_rule' ? (
                          <span>
                            {item.valueNum ?? '—'} {item.unit}
                          </span>
                        ) : item.itemType === 'invalid_row' ? (
                          <span>—</span>
                        ) : item.itemType === 'body_measurement' &&
                          item.metricCode === 'body_composition' ? (
                          <div className="training-value-inputs body-measurement-inputs">
                            {BODY_TEMPLATE_FIELDS.filter(([, field]) => field !== 'armSpanCm' && (item.payload[field] != null || ['heightCm', 'weightKg', 'bodyFatPct', 'skeletalMuscleKg'].includes(field))).map(([header, field]) => (
                              <label key={field}>
                                <span>{header}</span>
                                <input
                                  disabled={Boolean(busy) || batch.status !== 'reviewing' || Boolean(item.payload.valueReviewDecision) || Boolean(item.payload.sourceRow) && !item.payload.sourceRowOutdated}
                                  aria-label={`${item.rawAthleteName} ${item.sourceAddress} ${header}`}
                                  type="number"
                                  step="any"
                                  value={payloadNumber(item.payload, field)}
                                  onChange={(event) => {
                                    const value = numberOrUndefined(event.target.value);
                                    if (value === undefined) return;
                                    patchItem(item.id, { payload: { [field]: value } });
                                  }}
                                />
                              </label>
                            ))}
                          </div>
                        ) : item.itemType === 'wellness' ? (
                          <div className="training-value-inputs">
                            <input
                              disabled={Boolean(busy) || batch.status !== 'reviewing' || Boolean(item.payload.sourceRow) && !item.payload.sourceRowOutdated}
                              type="number"
                              step="0.1"
                              placeholder="睡眠h"
                              value={payloadNumber(item.payload, 'sleepHours')}
                              onChange={(event) => {
                                const value = numberOrUndefined(event.target.value);
                                if (value === undefined) return;
                                patchItem(item.id, { payload: { sleepHours: value } });
                              }}
                            />
                            <input
                              disabled={Boolean(busy) || batch.status !== 'reviewing' || Boolean(item.payload.sourceRow) && !item.payload.sourceRowOutdated}
                              type="number"
                              step="1"
                              placeholder="晨脉"
                              value={payloadNumber(item.payload, 'morningPulse')}
                              onChange={(event) => {
                                const value = numberOrUndefined(event.target.value);
                                if (value === undefined) return;
                                patchItem(item.id, { payload: { morningPulse: value } });
                              }}
                            />
                          </div>
                        ) : item.itemType === 'training_session' ? (
                          <div className="training-value-inputs">
                            <input
                              disabled={Boolean(busy) || batch.status !== 'reviewing' || Boolean(item.payload.sourceRow) && !item.payload.sourceRowOutdated}
                              type="number"
                              step="1"
                              placeholder="时长min"
                              value={item.valueNum ?? ''}
                              onChange={(event) => {
                                const value = numberOrUndefined(event.target.value);
                                if (value === undefined) return;
                                patchItem(item.id, { valueNum: value });
                              }}
                            />
                            <input
                              disabled={Boolean(busy) || batch.status !== 'reviewing' || Boolean(item.payload.sourceRow) && !item.payload.sourceRowOutdated}
                              type="number"
                              step="0.1"
                              placeholder="距离km"
                              value={payloadNumber(item.payload, 'distanceKm')}
                              onChange={(event) => {
                                const value = numberOrUndefined(event.target.value);
                                if (value === undefined) return;
                                patchItem(item.id, { payload: { distanceKm: value } });
                              }}
                            />
                          </div>
                        ) : (
                          <div className="metric-value-input">
                            <input
                              disabled={Boolean(busy) || batch.status !== 'reviewing' || Boolean(item.payload.sourceRow) && !item.payload.sourceRowOutdated}
                              type="number"
                              step="0.1"
                              value={item.valueNum ?? ''}
                              onChange={(event) => {
                                const value = numberOrUndefined(event.target.value);
                                if (value === undefined) return;
                                patchItem(item.id, { valueNum: value });
                              }}
                            />
                            <span>{item.unit}</span>
                          </div>
                        )}
                      </td>
                      <td>
                        {item.conflict?.exists ? (
                          <select
                            disabled={Boolean(busy) || batch.status !== 'reviewing'}
                            value={item.resolution === 'skip' ? 'skip' : ''}
                            onChange={(event) =>
                              patchItem(item.id, {
                                resolution: event.target.value as '' | 'skip' | 'update',
                              })
                            }
                            aria-label={`重复处理：${item.rawAthleteName}`}
                          >
                            <option value="">按本次导入更新</option>
                            <option value="skip">跳过此行（不写入）</option>
                          </select>
                        ) : item.itemType === 'invalid_row' || item.quality === 'error' || item.resolution === 'skip' ? (
                          <select
                            disabled={Boolean(busy) || batch.status !== 'reviewing'}
                            value={item.resolution}
                            onChange={(event) =>
                              patchItem(item.id, {
                                resolution: event.target.value as '' | 'skip' | 'update',
                              })
                            }
                            aria-label="错误行处理"
                          >
                            <option value="">未处理（阻止提交）</option>
                            <option value="skip">排除此行</option>
                          </select>
                        ) : (
                          <span className="data-import-new-tag">新增</span>
                        )}
                      </td>
                      <td>
                        <div className="import-messages">
                          {item.conflict?.fields.filter(field => field.oldValue !== field.newValue).map((field) => (
                            <span
                              key={field.field}
                              className={field.overwrites ? 'conflict-overwrite' : ''}
                            >
                              {field.label}：{field.oldValue || '空'} → {field.newValue}
                              {field.overwrites ? '（按本次导入更新）' : ''}
                            </span>
                          ))}
                          {item.messages.length ? (
                            item.messages.map((entry, index) => (
                              <span key={index}>{entry.replace(/^错误：|^警告：/, '')}</span>
                            ))
                          ) : !item.conflict?.fields.length ? (
                            <span>校验通过</span>
                          ) : null}
                        </div>
                        {batch.status === 'reviewing' && <ImportSourceRowEditor
                          item={item}
                          metrics={metrics}
                          disabled={Boolean(busy) || Boolean(item.payload.valueReviewDecision)}
                          pending={corrections.get(sourceCorrectionId(item))?.sourceCells}
                          onChange={sourceCells => patchItem(sourceCorrectionId(item), { sourceCells })}
                          onSave={() => void saveCorrections()}
                        />}
                        <details className="import-source-details">
                          <summary>查看原始记录</summary>
                          <div>
                            <strong>{item.sourceSheet} · {item.sourceAddress}</strong>
                            <p>原值：{item.rawValue || '空'}</p>
                          </div>
                        </details>
                      </td>
                    </tr>
                  ))}
                  {!pageItems.length && (
                    <tr>
                      <td colSpan={8} className="data-import-empty">
                        {reviewGroups.length ? '重复数据请在上方卡片中审查；此处展示其他数据。' : '当前筛选条件下没有数据。'}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <footer className="data-import-pagination">
              <small>
                共{filteredItems.length}条 · 第{currentPage + 1}/{totalPages}页 · 每页{PAGE_SIZE}条
              </small>
              <div>
                <button
                  type="button"
                  disabled={currentPage <= 0}
                  onClick={() => setPage(currentPage - 1)}
                  aria-label="上一页"
                >
                  <ChevronLeft size={16} />
                </button>
                <button
                  type="button"
                  disabled={currentPage >= totalPages - 1}
                  onClick={() => setPage(currentPage + 1)}
                  aria-label="下一页"
                >
                  <ChevronRight size={16} />
                </button>
              </div>
            </footer>
            <footer className="data-import-commit-bar">
              <div className="data-import-next-actions" aria-live="polite">
                <strong>{batch.errorCount || unconfirmedPersons.length ? `还需处理：${unconfirmedPersons.length}名人员、${batch.errorCount}条错误` : hasUnsavedChanges ? '修改待保存，校验后可确认导入' : '校对完成，可以确认导入'}</strong>
                {unconfirmedPersons.length > 0 && <button type="button" disabled={Boolean(busy)} onClick={() => setPersonDialogOpen(true)}>去确认人员</button>}
                {batch.errorCount > 0 && <button type="button" onClick={goToErrors}>去修正错误</button>}
                {saveFailed && <button type="button" disabled={Boolean(busy)} onClick={() => void saveCorrections()}>重试保存</button>}
              </div>
              <div>
                <small>
                  所有数据采用本次导入的非空值，空白保留原值；同一文件内不同值需先审查。整批在同一事务内提交，失败自动回滚。
                </small>
                <button
                  className="data-import-primary"
                  disabled={
                    Boolean(busy) ||
                    batch.status !== 'reviewing' ||
                    batch.errorCount > 0 ||
                    batch.items.some(item => pendingSelections.has(item.id)) ||
                    unconfirmedPersons.length > 0
                  }
                  onClick={() => void commit()}
                >
                  <Database size={17} />
                  {busy === 'commit'
                    ? '正在写入…'
                    : batch.status === 'committed'
                      ? '已写入数据库'
                      : hasUnsavedChanges ? '校验后确认导入' : `确认导入：新增${summaryPreview?.createPersons ?? 0}名运动员、写入${(summaryPreview?.newRecords ?? 0) + (summaryPreview?.updateRecords ?? 0)}条记录`}
                </button>
              </div>
            </footer>
          </section>
        </>
      )}

      {duplicateDialogOpen && batch?.status === 'reviewing' && (
        <div
          className="data-import-dialog-backdrop"
          role="presentation"
          onPointerDown={(event) => {
            if (event.target === event.currentTarget) setDuplicateDialogOpen(false);
          }}
        >
          <section className="data-import-dialog" role="dialog" aria-modal="true" aria-label="该文件已上传过">
            <header>
              <div>
                <span>DUPLICATE FILE</span>
                <h2>该文件已上传过</h2>
                <p>
                  “{batch.filename}”已有导入批次。可继续上次校对，或按当前项目、队伍和默认日期重新解析。
                </p>
              </div>
              <button
                type="button"
                className="data-import-icon-button"
                onClick={() => setDuplicateDialogOpen(false)}
                aria-label="关闭"
              >
                <X size={19} />
              </button>
            </header>
            <div className="data-import-dialog-actions">
              <button
                type="button"
                className="data-import-primary"
                onClick={() => {
                  setDuplicateDialogOpen(false);
                  startReview(batch);
                }}
              >
                继续上次校对
              </button>
              <button
                type="button"
                disabled={Boolean(busy)}
                onClick={() => {
                  setDuplicateDialogOpen(false);
                  void analyze({ reparse: true });
                }}
              >
                重新解析文件
              </button>
            </div>
          </section>
        </div>
      )}

      {personDialogOpen && batch && (
        <div
          className="data-import-dialog-backdrop"
          role="presentation"
          onPointerDown={(event) => {
            if (event.target === event.currentTarget && !busy) setPersonDialogOpen(false);
          }}
        >
          <section
            className="data-import-dialog data-import-person-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="data-import-person-title"
          >
            <header>
              <div>
                <span>PERSON CONFIRM</span>
                <h2 id="data-import-person-title">待确认运动员</h2>
                <p>
                  已匹配 {batch.athleteCandidates.filter(candidate => !candidate.excluded && Boolean(candidate.matchedAthleteId)).length} 人 · 待新建 {batch.athleteCandidates.filter(candidate => !candidate.excluded && candidate.status === 'pending' && !candidate.matchedAthleteId && !candidate.suggested.length).length} 人 ·
                  身份待确认 {batch.athleteCandidates.filter(candidate => !candidate.excluded && candidate.status === 'pending' && !candidate.matchedAthleteId && candidate.suggested.length > 0).length} 人。
                  只需姓名与所属队伍即可最小建档；关闭本窗口不会丢失已确认内容。
                </p>
              </div>
              <button
                type="button"
                className="data-import-icon-button"
                onClick={() => setPersonDialogOpen(false)}
                disabled={Boolean(busy)}
                aria-label="关闭人员确认"
              >
                <X size={19} />
              </button>
            </header>
            <div className="data-import-person-toolbar">
              <p role="status" aria-live="polite" className="data-import-save-status">
              {busy === 'save' ? '正在保存修改并重新校验…' : saveFailed ? '保存失败，修改仍保留在当前页面，请重试保存。' : hasUnsavedChanges ? '尚有未保存修改；校验完成后才能确认最终数量。' : '当前校对已保存；正常数据无需逐行确认。'}
            </p>
            <div className="data-import-filters">
                {(
                  [
                    ['all', '全部'],
                    ['pending', '待建档'],
                    ['ambiguous', '身份待确认'],
                  ] as const
                ).map(([key, label]) => (
                  <button
                    key={key}
                    className={personTab === key ? 'active' : ''}
                    onClick={() => setPersonTab(key)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <label className="data-import-search">
                <Search size={15} />
                <input
                  value={personQuery}
                  onChange={(event) => setPersonQuery(event.target.value)}
                  placeholder="搜索姓名或队伍"
                />
              </label>
              <div className="data-import-candidate-bulk">
                <select
                  value={bulkCandidateTeam}
                  disabled={batch.status !== 'reviewing' || Boolean(busy)}
                  aria-label="批量选择所属队伍，选择后立即应用"
                  onChange={(event) => applyBulkCandidateTeam(event.target.value)}
                >
                  <option value="">批量选择所属队伍</option>
                  {teams.map((team) => (
                    <option key={team.id} value={team.name}>
                      {team.name}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  disabled={batch.status !== 'reviewing' || Boolean(busy)}
                  onClick={batchConfirmNoConflict}
                >
                  批量确认无冲突
                </button>
              </div>
            </div>
            <div className="data-import-person-body">
              <div className="data-import-person-list">
                <table>
                  <thead>
                    <tr>
                      <th>姓名</th>
                      <th>项目</th>
                      <th>所属队伍</th>
                      <th>处理方式</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visiblePersons.map((candidate) => (
                      <tr
                        key={candidate.id}
                        className={[
                          selectedPersonId === candidate.id ? 'selected' : '',
                          candidate.excluded ? 'excluded' : '',
                        ]
                          .filter(Boolean)
                          .join(' ')}
                        onClick={() => setSelectedPersonId(candidate.id)}
                      >
                        <td><button type="button" className="data-import-person-name"
                          aria-pressed={selectedPersonId === candidate.id}
                          onClick={() => setSelectedPersonId(candidate.id)}>{candidate.name}</button></td>
                        <td>{candidate.project}</td>
                        <td>{candidate.team || '—'}</td>
                        <td>
                          <span
                            className={`person-state ${
                              candidate.excluded
                                ? 'excluded'
                                : candidate.status === 'matched' || candidate.matchedAthleteId
                                  ? 'matched'
                                  : candidate.confirmed
                                    ? 'confirmed'
                                    : 'pending'
                            }`}
                          >
                            {personHandlingLabel(candidate)}
                          </span>
                        </td>
                      </tr>
                    ))}
                    {!visiblePersons.length && (
                      <tr>
                        <td colSpan={4} className="data-import-empty">
                          没有符合条件的人员。
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              <aside className="data-import-person-detail">
                {!selectedPerson ? (
                  <p className="data-import-empty">点击左侧人员查看和修改必要信息。</p>
                ) : (
                  <>
                    <h3>{selectedPerson.name}</h3>
                    {selectedPerson.messages.map((entry, index) => (
                      <p key={index} className="data-import-person-hint">
                        {entry}
                      </p>
                    ))}
                    <label>
                      <span>姓名</span>
                      <input
                        disabled={
                          batch.status !== 'reviewing' ||
                          selectedPerson.status !== 'pending' ||
                          Boolean(selectedPerson.matchedAthleteId) ||
                          selectedPerson.excluded
                        }
                        value={selectedPerson.name}
                        onChange={(event) =>
                          patchAthleteCandidate(selectedPerson.id, { name: event.target.value })
                        }
                      />
                    </label>
                    <label>
                      <span>性别（可留空）</span>
                      <select
                        disabled={
                          batch.status !== 'reviewing' ||
                          selectedPerson.status !== 'pending' ||
                          Boolean(selectedPerson.matchedAthleteId) ||
                          selectedPerson.excluded
                        }
                        value={selectedPerson.gender}
                        onChange={(event) =>
                          patchAthleteCandidate(selectedPerson.id, { gender: event.target.value })
                        }
                      >
                        <option value="">暂不填写</option>
                        <option>男</option>
                        <option>女</option>
                      </select>
                    </label>
                    <label>
                      <span>处理方式</span>
                      <select
                        disabled={batch.status !== 'reviewing' || selectedPerson.status !== 'pending'}
                        value={
                          selectedPerson.excluded
                            ? 'exclude'
                            : selectedPerson.matchedAthleteId || selectedPerson.createdAthleteId || personLinkModes.has(selectedPerson.id)
                              ? 'link'
                              : selectedPerson.suggested.length && !personCreateModes.has(selectedPerson.id) ? '' : 'create'
                        }
                        onChange={(event) => {
                          const mode = event.target.value;
                          setPersonCreateModes(current => {
                            const next = new Set(current);
                            if (mode === 'create') next.add(selectedPerson.id); else next.delete(selectedPerson.id);
                            return next;
                          });
                          setPersonLinkModes(current => {
                            const next = new Set(current);
                            if (mode === 'link') next.add(selectedPerson.id);
                            else next.delete(selectedPerson.id);
                            return next;
                          });
                          if (mode === 'exclude')
                            patchAthleteCandidate(selectedPerson.id, {
                              excluded: true,
                              confirmed: true,
                            });
                          else if (mode === 'link')
                            patchAthleteCandidate(selectedPerson.id, {
                              excluded: false,
                              matchedAthleteId: selectedPerson.suggested.length === 1 ? selectedPerson.suggested[0].id : null,
                              confirmed: false,
                            });
                          else
                            patchAthleteCandidate(selectedPerson.id, {
                              excluded: false,
                              matchedAthleteId: null,
                              confirmed: false,
                            });
                        }}
                      >
                        <option value="" disabled>请选择处理方式</option>
                        <option value="create">新建</option>
                        <option value="link">
                          {selectedPerson.matchedAthleteId || selectedPerson.createdAthleteId
                            ? personHandlingLabel(selectedPerson)
                            : '选择已有运动员'}
                        </option>
                        <option value="exclude">排除此人（其记录一并排除）</option>
                      </select>
                    </label>
                    {!selectedPerson.excluded && !personCreateModes.has(selectedPerson.id) && (selectedPerson.matchedAthleteId !== null || personLinkModes.has(selectedPerson.id) || selectedPerson.suggested.length > 0) ? (
                      <label>
                        <span>关联已有运动员（请选择具体人员）</span>
                        <select
                          disabled={batch.status !== 'reviewing'}
                          value={selectedPerson.matchedAthleteId || ''}
                          onChange={(event) =>
                            patchAthleteCandidate(selectedPerson.id, {
                              matchedAthleteId: Number(event.target.value) || null,
                              confirmed: false,
                            })
                          }
                        >
                          <option value="">请选择</option>
                          {(selectedPerson.suggested.length
                            ? selectedPerson.suggested.map((entry) => ({
                                id: entry.id,
                                name: entry.name,
                                team: entry.team,
                              }))
                            : athletes
                                .filter((athlete) => athlete.project === selectedPerson.project)
                                .map((athlete) => ({
                                  id: athlete.id,
                                  name: athlete.name,
                                  team: athlete.team,
                                }))
                          ).map((entry) => (
                            <option key={entry.id} value={entry.id}>
                              {entry.name} · {entry.team || '无队伍'} · 编号 {entry.id}
                            </option>
                          ))}
                        </select>
                      </label>
                    ) : null}
                    {!selectedPerson.excluded && !selectedPerson.matchedAthleteId && !personLinkModes.has(selectedPerson.id) ? (
                      <label>
                        <span>所属队伍（必选）</span>
                        <select
                          disabled={batch.status !== 'reviewing'}
                          value={selectedPerson.team}
                          onChange={(event) =>
                            patchAthleteCandidate(selectedPerson.id, {
                              team: event.target.value,
                              confirmed: false,
                            })
                          }
                        >
                          <option value="">请选择所属队伍</option>
                          {teams.map((team) => (
                            <option key={team.id} value={team.name}>
                              {team.name}
                            </option>
                          ))}
                        </select>
                      </label>
                    ) : null}
                    {selectedPerson.status === 'pending' && !selectedPerson.excluded && (
                      <button
                        type="button"
                        className="data-import-primary"
                        disabled={
                          Boolean(busy) ||
                          (selectedPerson.matchedAthleteId
                            ? false
                            : !selectedPerson.team || (selectedPerson.suggested.length > 0 && !personCreateModes.has(selectedPerson.id)) || personLinkModes.has(selectedPerson.id))
                        }
                        onClick={() => {
                          patchAthleteCandidate(selectedPerson.id, { confirmed: true });
                          setMessage(`已确认“${selectedPerson.name}”，记得保存并继续。`);
                        }}
                      >
                        <CheckCircle2 size={16} />
                        {selectedPerson.confirmed ? '已确认' : '确认此人'}
                      </button>
                    )}
                  </>
                )}
              </aside>
            </div>
            <footer className="data-import-dialog-actions">
              <button type="button" disabled={Boolean(busy)} onClick={() => setPersonDialogOpen(false)}>
                返回上传
              </button>
              <button
                type="button"
                className="data-import-primary"
                disabled={Boolean(busy) || batch.status !== 'reviewing'}
                onClick={() => void confirmAndContinue()}
              >
                <Users size={16} />
                确认人员并继续
              </button>
            </footer>
          </section>
        </div>
      )}

      {confirmDialogOpen && batch && summaryPreview && (
        <div
          className="data-import-dialog-backdrop"
          role="presentation"
          onPointerDown={(event) => {
            if (event.target === event.currentTarget && !busy) setConfirmDialogOpen(false);
          }}
        >
          <section className="data-import-dialog" role="dialog" aria-modal="true" aria-label="确认导入">
            <header>
              <div>
                <span>FINAL CONFIRM</span>
                <h2>确认导入</h2>
                <p>以下数量来自最终校对结果，而非原始 Excel 行数；整个批次在同一事务内提交。</p>
              </div>
              <button
                type="button"
                className="data-import-icon-button"
                onClick={() => setConfirmDialogOpen(false)}
                disabled={Boolean(busy)}
                aria-label="关闭确认"
              >
                <X size={19} />
              </button>
            </header>
            <div className="data-import-summary data-import-main-summary">
              <div><span>待处理</span><strong>{batch.errorCount}</strong><small>新建运动员{summaryPreview.createPersons}名</small></div>
              <div><span>新增记录</span><strong>{summaryPreview.newRecords}</strong></div>
              <div><span>更新记录</span><strong>{summaryPreview.updateRecords}</strong><small>仅更新本次提供的非空字段</small></div>
            </div>
            <ImportCountSummary counts={summaryPreview.statistics} />
            <details className="data-import-final-differences">
              <summary>查看本次更新的原值与新值</summary>
              <p>空白不清空原值，真实0正常写入；完整差异也可在校对列表中按“将更新”查看。</p>
              <table><caption>更新差异（最多显示前100项）</caption><thead><tr><th scope="col">运动员 / 来源</th><th scope="col">字段</th><th scope="col">原值</th><th scope="col">新值</th></tr></thead><tbody>
                {batch.items.filter(item => item.quality !== 'error' && item.quality !== 'skipped' && item.resolution !== 'skip' && !item.payload.valueAutoMerged).flatMap(item => (item.conflict?.fields || []).filter(field => field.oldValue !== field.newValue).map(field => ({ item, field }))).slice(0, 100).map(({ item, field }) => <tr key={`${item.id}-${field.field}`}><td>{item.rawAthleteName} · {item.sourceSheet}!{item.sourceAddress}</td><td>{field.label}</td><td>{field.oldValue === '' ? '空' : field.oldValue}</td><td>{field.newValue === '' ? '空' : field.newValue}</td></tr>)}
              </tbody></table>
            </details>
            <div className="data-import-dialog-actions">
              <button type="button" disabled={Boolean(busy)} onClick={() => setConfirmDialogOpen(false)}>
                取消
              </button>
              <button
                type="button"
                className="data-import-primary"
                disabled={Boolean(busy)}
                onClick={() => void doCommit()}
              >
                <Database size={16} />
                确认导入：新增{summaryPreview.createPersons}名运动员、写入{summaryPreview.newRecords + summaryPreview.updateRecords}条记录
              </button>
            </div>
          </section>
        </div>
      )}
    </PageContainer>
  );
}
