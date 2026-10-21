import { BODY_TEMPLATE_FIELDS } from '../../shared/data-import-template';
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
import { automaticImportPersonLinks, dataImportPersonKey } from '../../shared/data-import-person';
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

type Props = {
  user: User;
  project: Project;
  athletes: Athlete[];
  onChanged: () => void;
};

type Correction = {
  id: number;
  athleteId?: number | null;
  eventDate?: string;
  valueNum?: number | null;
  actualReps?: number | null;
  actualWeightKg?: number | null;
  payload?: Record<string, unknown>;
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

export function DataImportPage({ project, athletes, onChanged }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [defaultDate, setDefaultDate] = useState('');
  const [bulkCandidateTeam, setBulkCandidateTeam] = useState('');
  const [teams, setTeams] = useState<ProjectTeam[]>([]);
  const [batch, setBatch] = useState<DataImportBatch | null>(null);
  const [batches, setBatches] = useState<DataImportBatchSummary[]>([]);
  const [busy, setBusy] = useState<
    'analyze' | 'save' | 'commit' | 'load' | 'template' | 'export' | 'discard' | 'errors' | ''
  >('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [filter, setFilter] = useState<'exception' | 'duplicate' | 'overwrite' | 'all'>(
    'exception'
  );
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(0);
  const [conflictPolicy, setConflictPolicy] = useState<'skip' | 'update'>('skip');
  const [corrections, setCorrections] = useState<Map<number, Correction>>(new Map());
  const [athleteCorrections, setAthleteCorrections] = useState<Map<number, AthleteCorrection>>(
    new Map()
  );
  const [personDialogOpen, setPersonDialogOpen] = useState(false);
  const [personTab, setPersonTab] = useState<'all' | 'pending' | 'ambiguous'>('all');
  const [personQuery, setPersonQuery] = useState('');
  const [selectedPersonId, setSelectedPersonId] = useState<number | null>(null);
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
    filledProfileFields: number;
    overwrittenProfileFields: number;
  } | null>(null);

  const refreshBatches = async () => {
    try {
      const list = await api.dataImportBatches(project);
      setBatches(list.batches);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '导入记录加载失败。');
    }
  };

  useEffect(() => {
    setBatch(null);
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
        const available = list.teams.filter((team) => team.project === project);
        setTeams(available);
        setBulkCandidateTeam((current) =>
          available.some((team) => team.name === current) ? current : ''
        );
      })
      .catch((nextError) =>
        setError(nextError instanceof Error ? nextError.message : '队伍列表加载失败。')
      );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project]);

  const startReview = (next: DataImportBatch) => {
    const links = next.status === 'reviewing'
      ? automaticImportPersonLinks(next.athleteCandidates, athletes) : new Map<number, number>();
    const automaticCorrections = new Map<number, AthleteCorrection>();
    next = { ...next, athleteCandidates: next.athleteCandidates.map(candidate => {
      const athleteId = links.get(candidate.id);
      if (!athleteId) return candidate;
      const correction = { id: candidate.id, matchedAthleteId: athleteId, confirmed: true };
      automaticCorrections.set(candidate.id, correction);
      return { ...candidate, ...correction, messages: ['已自动关联已有运动员，保留原档案及所属队伍'] };
    }) };
    setBulkCandidateTeam('');
    setBatch(next);
    setPersonLinkModes(new Set());
    setCorrections(new Map());
    setAthleteCorrections(automaticCorrections);
    setPage(0);
    setResult(null);
    const unresolved = next.athleteCandidates.filter(
      (candidate) => candidate.status === 'pending' && !candidate.excluded && !candidate.confirmed
    );
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
    setBusy('analyze');
    setError('');
    setMessage('');
    try {
      const info = await api.analyzeDataImport(file, project, defaultDate || undefined, options);
      if (info.batch.status === 'committed') {
        startReview(info.batch);
        await refreshBatches();
        return;
      }
      if (info.batch.status === 'reviewing' && info.batch.summary.duplicateFile && !options?.reparse) {
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
      await api.downloadDataImportTemplate(kind, project);
      setMessage(
        kind === 'unified' ? '统一数据模板已开始下载。' : '分用途模板已开始下载（含已有人员预填）。'
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
    const sourceItem = batch?.items.find((item) => item.id === itemId);
    const groupedIds =
      sourceItem && 'athleteId' in patch && sourceItem.itemType !== 'invalid_row'
        ? batch?.items
            .filter(
              (item) =>
                item.itemType !== 'invalid_row' &&
                item.rawAthleteName &&
                dataImportPersonKey(item) === dataImportPersonKey(sourceItem)
            )
            .map((item) => item.id) || [itemId]
        : [itemId];
    setBatch((current) =>
      current
        ? {
            ...current,
            items: current.items.map((item) =>
              groupedIds.includes(item.id) ? { ...item, ...patch, payload: patch.payload ? { ...item.payload, ...patch.payload } : item.payload } : item
            ),
          }
        : current
    );
    setCorrections((current) => {
      const next = new Map(current);
      for (const id of groupedIds) {
        const prior = next.get(id) || { id };
        next.set(id, {
          ...prior,
          ...patch,
          payload: patch.payload ? { ...(prior.payload || {}), ...patch.payload } : prior.payload,
        });
      }
      return next;
    });
  };

  const patchAthleteCandidate = (candidateId: number, patch: Omit<AthleteCorrection, 'id'>) => {
    const candidate = batch?.athleteCandidates.find(entry => entry.id === candidateId);
    if (candidate && ('team' in patch || 'name' in patch) && !candidate.excluded) {
      const name = (patch.name ?? candidate.name).trim();
      const team = patch.team ?? candidate.team;
      const existing = athletes.filter(athlete => athlete.project === candidate.project
        && athlete.name.trim() === name && athlete.team === team);
      if (existing.length === 1) patch = { ...patch, matchedAthleteId: existing[0].id, confirmed: true };
    }
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
    if (!batch || (!itemMap.size && !athleteMap.size)) return batch;
    setBusy('save');
    setError('');
    try {
      let currentBatch = batch;
      if (athleteMap.size)
        currentBatch = (await api.updateDataImportAthletes(batch.id, [...athleteMap.values()])).batch;
      if (itemMap.size)
        currentBatch = (await api.updateDataImportItems(batch.id, [...itemMap.values()])).batch;
      setBatch(currentBatch);
      setCorrections(new Map());
      setAthleteCorrections(new Map());
      setMessage('校对内容已保存，服务端已按最终数据重新校验并检测重复。');
      return currentBatch;
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '校对内容保存失败。');
      return null;
    } finally {
      setBusy('');
    }
  };

  const unconfirmedPersons = useMemo(() => {
    if (!batch) return [];
    return batch.athleteCandidates.filter(
      (candidate) => candidate.status === 'pending' && !candidate.excluded && !candidate.confirmed
    );
  }, [batch]);

  const commit = async () => {
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
      (candidate) => candidate.status === 'pending' && !candidate.excluded && !candidate.confirmed
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
      const info = await api.commitDataImport(batch.id, conflictPolicy);
      setBatch(info.batch);
      setMessage(info.message);
      setResult({
        message: info.message,
        createdAthletes: info.createdAthletes,
        linkedAthletes: info.linkedAthletes,
        createdRecords: info.createdRecords,
        updatedRecords: info.updatedRecords,
        skipped: info.skipped,
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
      const unresolvedAmbiguity = candidate.suggested.length > 0 && !candidate.matchedAthleteId;
      const missingTeam = !candidate.matchedAthleteId && !candidate.team;
      const missingLink = personLinkModes.has(candidate.id) && !candidate.matchedAthleteId;
      if (unresolvedAmbiguity || missingTeam || missingLink) continue; // 身份歧义与缺队伍必须逐项解决
      nextMap.set(candidate.id, { ...(nextMap.get(candidate.id) || { id: candidate.id }), confirmed: true });
    }
    const pendingFix = batch.athleteCandidates.filter((candidate) => {
      if (candidate.status !== 'pending' || candidate.excluded) return false;
      if (candidate.suggested.length > 0 && !candidate.matchedAthleteId) return true;
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

  const filteredItems = useMemo(() => {
    if (!batch) return [];
    const needle = query.trim().toLowerCase();
    return batch.items
      .filter((item) => {
        if (filter === 'exception' && item.itemType !== 'invalid_row' && item.quality === 'valid')
          return false;
        if (filter === 'duplicate' && !item.conflict?.exists) return false;
        if (filter === 'overwrite' && !item.conflict?.fields.some((field) => field.overwrites))
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
              : 2;
        return rank(a) - rank(b);
      });
  }, [batch, filter, query]);

  const totalPages = Math.max(1, Math.ceil(filteredItems.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages - 1);
  const pageItems = filteredItems.slice(currentPage * PAGE_SIZE, currentPage * PAGE_SIZE + PAGE_SIZE);

  const summaryPreview = useMemo(() => {
    if (!batch) return null;
    const importable = batch.items.filter(
      (item) => item.quality !== 'skipped' && item.resolution !== 'skip' && item.itemType !== 'invalid_row'
    );
    const excludedKeys = new Set(
      batch.athleteCandidates.filter((candidate) => candidate.excluded).map((c) => c.normalizedName)
    );
    const active = importable.filter((item) => !excludedKeys.has(dataImportPersonKey(item)));
    const createPersons = batch.athleteCandidates.filter(
      (candidate) =>
        candidate.status === 'pending' && !candidate.excluded && !candidate.matchedAthleteId
    );
    const linkPersons = batch.athleteCandidates.filter(
      (candidate) =>
        (candidate.status === 'pending' && candidate.matchedAthleteId) ||
        candidate.status === 'matched'
    );
    const newRecords = active.filter((item) => !item.conflict?.exists).length;
    const updateRecords = active.filter(
      (item) =>
        item.conflict?.exists &&
        (item.resolution || conflictPolicy) === 'update' &&
        !item.conflict.identical
    ).length;
    const skipRecords =
      active.filter(
        (item) =>
          item.conflict?.exists &&
          ((item.resolution || conflictPolicy) === 'skip' || item.conflict.identical)
      ).length +
      batch.items.filter((item) => item.resolution === 'skip').length +
      importable.filter((item) => excludedKeys.has(dataImportPersonKey(item))).length;
    const overwriteFields = active.reduce(
      (sum, item) => sum + (item.conflict?.fields.filter((field) => field.overwrites).length || 0),
      0
    );
    return {
      createPersons: createPersons.length,
      linkPersons: linkPersons.length,
      newRecords,
      updateRecords,
      skipRecords,
      overwriteFields,
    };
  }, [batch, conflictPolicy]);

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
            <button
              type="button"
              className="data-import-template"
              disabled={Boolean(busy)}
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
              disabled={Boolean(busy)}
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
              disabled={Boolean(busy)}
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
              disabled={Boolean(busy)}
              onClick={() => downloadTemplate('unified')}
            >
              <FileSpreadsheet size={19} />
              <div>
                <strong>统一数据模板</strong>
                <span>按资料、测量、训练与测试分类，按需填写</span>
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
            onChange={(event) => setFile(event.target.files?.[0] || null)}
          />
          <label className="data-import-date">
            <span>缺失日期时使用</span>
            <input
              type="date"
              value={defaultDate}
              onChange={(event) => setDefaultDate(event.target.value)}
            />
            <small>可选；表内日期优先，缺失时使用所选日期，未选择则使用北京时间当天</small>
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
          </div>
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
          <div className="data-import-summary">
            <div>
              <span>新建运动员</span>
              <strong>{result.createdAthletes}</strong>
              <small>最小建档，无登录账号</small>
            </div>
            <div>
              <span>关联已有</span>
              <strong>{result.linkedAthletes}</strong>
              <small>未覆盖已有档案</small>
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
              <span>跳过重复</span>
              <strong>{result.skipped}</strong>
              <small>保留数据库原值</small>
            </div>
          </div>
        </section>
      )}

      {batch && (
        <>
          <section className="data-import-summary">
            <div>
              <span>已确认运动员</span>
              <strong>{batch.athleteCandidates.filter(candidate => !candidate.excluded && Boolean(candidate.matchedAthleteId)).length}</strong>
              <small>
                待建档{batch.athleteCandidates.filter(candidate => !candidate.excluded && candidate.status === 'pending' && !candidate.matchedAthleteId && !candidate.suggested.length).length} · 待确认{batch.athleteCandidates.filter(candidate => !candidate.excluded && candidate.status === 'pending' && !candidate.matchedAthleteId && candidate.suggested.length > 0).length}
              </small>
            </div>
            <div>
              <span>待新增记录</span>
              <strong>{batch.counts.newCount}</strong>
              <small>业务键上没有重复</small>
            </div>
            <div className="warning">
              <span>重复记录</span>
              <strong>{batch.counts.duplicateCount}</strong>
              <small>按冲突策略处理</small>
            </div>
            <div className="danger">
              <span>待确认覆盖</span>
              <strong>{batch.counts.overwriteCount}</strong>
              <small>原值→新值需确认</small>
            </div>
            <div className="danger">
              <span>错误记录</span>
              <strong>{batch.counts.invalidCount}</strong>
              <small>修正可编辑项，错误行需排除</small>
            </div>
            <div>
              <span>批次状态</span>
              <strong className="status-text">{STATUS_LABELS[batch.status]}</strong>
              <small>{batch.parserVersion}</small>
            </div>
          </section>

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

          <section className="data-import-review">
            <div className="data-import-review-head">
              <div>
                <span>REVIEW QUEUE</span>
                <h2>数据审查与校对</h2>
                <p>
                  校对的修改就是最终入库值；空白不覆盖已有数据，真实0值会保留。
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
                    }}
                    placeholder="搜索姓名、动作或指标"
                  />
                </label>
                <button
                  type="button"
                  disabled={
                    (!corrections.size && !athleteCorrections.size) ||
                    Boolean(busy) ||
                    batch.status !== 'reviewing'
                  }
                  onClick={() => void saveCorrections()}
                >
                  <Save size={15} />
                  保存校对
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
            <div className="data-import-filters">
              {(
                [
                  ['exception', `异常 ${batch.counts.invalidCount}`],
                  ['duplicate', `重复 ${batch.counts.duplicateCount}`],
                  ['overwrite', `待覆盖 ${batch.counts.overwriteCount}`],
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
            <div className="data-import-table-wrap">
              <table className="data-import-table data-import-review-table">
                <colgroup>
                  <col style={{ width: '5%' }} />
                  <col style={{ width: '6%' }} />
                  <col style={{ width: '11%' }} />
                  <col style={{ width: '10%' }} />
                  <col style={{ width: '9%' }} />
                  <col style={{ width: '18%' }} />
                  <col style={{ width: '9%' }} />
                  <col style={{ width: '14%' }} />
                  <col style={{ width: '18%' }} />
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
                    <th>来源</th>
                    <th>校验与冲突</th>
                  </tr>
                </thead>
                <tbody>
                  {pageItems.map((item) => (
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
                          <select
                            disabled={batch.status !== 'reviewing'}
                            value={item.athleteId || ''}
                            onChange={(event) =>
                              patchItem(item.id, {
                                athleteId: Number(event.target.value) || null,
                              })
                            }
                          >
                            <option value="">人员确认后自动关联：{item.rawAthleteName}</option>
                            {athletes.map((athlete) => (
                              <option key={athlete.id} value={athlete.id}>
                                {athlete.name} · {athlete.team}
                              </option>
                            ))}
                          </select>
                        )}
                      </td>
                      <td>
                        {item.itemType === 'scoring_rule' || item.itemType === 'invalid_row' ? (
                          '—'
                        ) : (
                          <input
                            disabled={batch.status !== 'reviewing'}
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
                        <strong>{item.exerciseName || item.metricLabel || '—'}</strong>
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
                              disabled={batch.status !== 'reviewing'}
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
                              disabled={batch.status !== 'reviewing'}
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
                                  disabled={batch.status !== 'reviewing'}
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
                              disabled={batch.status !== 'reviewing'}
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
                              disabled={batch.status !== 'reviewing'}
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
                              disabled={batch.status !== 'reviewing'}
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
                              disabled={batch.status !== 'reviewing'}
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
                              disabled={batch.status !== 'reviewing'}
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
                            disabled={batch.status !== 'reviewing'}
                            value={item.resolution}
                            onChange={(event) =>
                              patchItem(item.id, {
                                resolution: event.target.value as '' | 'skip' | 'update',
                              })
                            }
                            aria-label={`重复处理：${item.rawAthleteName}`}
                          >
                            <option value="">按批次策略</option>
                            <option value="skip">跳过此行（不写入）</option>
                            <option value="update">更新已有</option>
                          </select>
                        ) : item.itemType === 'invalid_row' || item.quality === 'error' || item.resolution === 'skip' ? (
                          <select
                            disabled={batch.status !== 'reviewing'}
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
                        <strong>{item.sourceSheet}</strong>
                        <small>
                          {item.sourceAddress} · 原值 {item.rawValue || '空'}
                        </small>
                      </td>
                      <td>
                        <div className="import-messages">
                          {item.conflict?.fields.filter(field => field.oldValue !== field.newValue).map((field) => (
                            <span
                              key={field.field}
                              className={field.overwrites ? 'conflict-overwrite' : ''}
                            >
                              {field.label}：{field.oldValue || '空'} → {field.newValue}
                              {field.overwrites ? '（需确认覆盖）' : ''}
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
                      </td>
                    </tr>
                  ))}
                  {!pageItems.length && (
                    <tr>
                      <td colSpan={9} className="data-import-empty">
                        当前筛选条件下没有数据。
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
              <label>
                <span>冲突处理</span>
                <select
                  value={conflictPolicy}
                  onChange={(event) => setConflictPolicy(event.target.value as 'skip' | 'update')}
                  disabled={batch.status !== 'reviewing'}
                >
                  <option value="skip">补全空缺字段，保留已有值（不覆盖）</option>
                  <option value="update">使用本批次更新重复项（覆盖需确认）</option>
                </select>
              </label>
              <div>
                <small>
                  空白不覆盖已有数据；重复项默认只补空缺、保留已有值。整批在同一事务内提交，失败自动回滚。
                </small>
                <button
                  className="data-import-primary"
                  disabled={
                    Boolean(busy) ||
                    batch.status !== 'reviewing' ||
                    batch.errorCount > 0 ||
                    unconfirmedPersons.length > 0
                  }
                  onClick={() => void commit()}
                >
                  <Database size={17} />
                  {busy === 'commit'
                    ? '正在写入…'
                    : batch.status === 'committed'
                      ? '已写入数据库'
                      : '确认导入'}
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
          <section className="data-import-dialog" role="dialog" aria-modal="true">
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
                        <td>{candidate.name}</td>
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
                              : 'create'
                        }
                        onChange={(event) => {
                          const mode = event.target.value;
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
                        <option value="create">新建</option>
                        <option value="link">
                          {selectedPerson.matchedAthleteId || selectedPerson.createdAthleteId
                            ? personHandlingLabel(selectedPerson)
                            : '选择已有运动员'}
                        </option>
                        <option value="exclude">排除此人（其记录一并排除）</option>
                      </select>
                    </label>
                    {!selectedPerson.excluded && (selectedPerson.matchedAthleteId !== null || personLinkModes.has(selectedPerson.id) || selectedPerson.suggested.length > 0) ? (
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
                            : !selectedPerson.team || selectedPerson.suggested.length > 0 || personLinkModes.has(selectedPerson.id))
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
          <section className="data-import-dialog" role="dialog" aria-modal="true">
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
            <div className="data-import-summary">
              <div>
                <span>新建运动员</span>
                <strong>{summaryPreview.createPersons}</strong>
                <small>最小建档</small>
              </div>
              <div>
                <span>关联已有运动员</span>
                <strong>{summaryPreview.linkPersons}</strong>
                <small>不覆盖已有档案</small>
              </div>
              <div>
                <span>新增记录</span>
                <strong>{summaryPreview.newRecords}</strong>
                <small>训练/测试/恢复等</small>
              </div>
              <div className="warning">
                <span>更新已有记录</span>
                <strong>{summaryPreview.updateRecords}</strong>
                <small>仅更新提供的字段</small>
              </div>
              <div>
                <span>跳过重复记录</span>
                <strong>{summaryPreview.skipRecords}</strong>
                <small>保留数据库原值</small>
              </div>
              <div className="danger">
                <span>覆盖档案字段</span>
                <strong>{summaryPreview.overwriteFields}</strong>
                <small>原值→新值已展示</small>
              </div>
            </div>
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
                确认导入
              </button>
            </div>
          </section>
        </div>
      )}
    </PageContainer>
  );
}
