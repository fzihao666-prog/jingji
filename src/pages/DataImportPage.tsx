import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  Database,
  Download,
  FileCheck2,
  FileSpreadsheet,
  RefreshCw,
  Save,
  Search,
  UploadCloud,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api";
import type {
  Athlete,
  DataImportAthleteCandidate,
  DataImportBatch,
  DataImportBatchSummary,
  DataImportItem,
  Project,
  ProjectTeam,
  User,
} from "../types";
import "./DataImportPage.css";

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
};

type AthleteCorrection = {
  id: number;
  name?: string;
  team?: string;
  gender?: string;
};

function normalizeAthleteName(value: string) {
  return value.normalize("NFKC").replace(/[\s·•]/g, "");
}

const ITEM_LABELS: Record<DataImportItem["itemType"], string> = {
  athlete_profile: "运动员档案",
  wellness: "恢复状态",
  training_session: "训练课次",
  training_set: "训练组次",
  test_measurement: "力量测试",
  body_measurement: "身体测量",
  injury_record: "伤病记录",
  competitive_state: "竞技状态",
  scoring_rule: "评分规则",
};

const STATUS_LABELS: Record<DataImportBatch["status"], string> = {
  reviewing: "待审核",
  committed: "已入库",
  failed: "失败",
  rolled_back: "已撤销",
};

function displayValue(item: DataImportItem) {
  if (item.itemType === "athlete_profile") return "基础档案与生源信息";
  if (item.itemType === "wellness") return "每日恢复记录";
  if (item.itemType === "training_session") return `${item.valueNum ?? 0} min`;
  if (item.itemType === "injury_record") return item.metricLabel || "伤病记录";
  if (item.itemType === "training_set")
    return `${item.actualWeightKg ?? "—"} kg × ${item.actualReps ?? "—"} 次`;
  if (item.itemType === "scoring_rule")
    return `${item.valueNum ?? "—"} ${item.unit} / ${String(item.payload.score || "—")}分`;
  return `${item.valueNum ?? "—"} ${item.unit}`;
}

export function DataImportPage({ project, athletes, onChanged }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [defaultDate, setDefaultDate] = useState("");
  const [bulkCandidateTeam, setBulkCandidateTeam] = useState("");
  const [teams, setTeams] = useState<ProjectTeam[]>([]);
  const [batch, setBatch] = useState<DataImportBatch | null>(null);
  const [batches, setBatches] = useState<DataImportBatchSummary[]>([]);
  const [busy, setBusy] = useState<"analyze" | "save" | "commit" | "load" | "template" | "export" | "">(
    "",
  );
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<
    "all" | "error" | "warning" | "training" | "test"
  >("all");
  const [query, setQuery] = useState("");
  const [conflictPolicy, setConflictPolicy] = useState<"skip" | "update">(
    "skip",
  );
  const [corrections, setCorrections] = useState<Map<number, Correction>>(
    new Map(),
  );
  const [athleteCorrections, setAthleteCorrections] = useState<
    Map<number, AthleteCorrection>
  >(new Map());

  const refreshBatches = async () => {
    try {
      const result = await api.dataImportBatches(project);
      setBatches(result.batches);
    } catch (nextError) {
      setError(
        nextError instanceof Error ? nextError.message : "导入记录加载失败。",
      );
    }
  };

  useEffect(() => {
    setBatch(null);
    setCorrections(new Map());
    setAthleteCorrections(new Map());
    setMessage("");
    setError("");
    void refreshBatches();
    void api
      .adminTeams()
      .then((result) => {
        const available = result.teams.filter(
          (team) => team.project === project,
        );
        setTeams(available);
        setBulkCandidateTeam((current) =>
          available.some((team) => team.name === current) ? current : "",
        );
      })
      .catch((nextError) =>
        setError(
          nextError instanceof Error ? nextError.message : "队伍列表加载失败。",
        ),
      );
  }, [project]);

  const analyze = async () => {
    if (!file) return;
    setBusy("analyze");
    setError("");
    setMessage("");
    try {
      const result = await api.analyzeDataImport(
        file,
        project,
        defaultDate || undefined,
      );
      setBatch(result.batch);
      setCorrections(new Map());
      setAthleteCorrections(new Map());
      setMessage(
        result.batch.summary.duplicateFile
          ? "该文件已上传过，已打开原有导入批次。"
          : `已识别${result.batch.itemCount}条候选数据，请先处理红色错误并复核黄色警告。`,
      );
      await refreshBatches();
    } catch (nextError) {
      setError(
        nextError instanceof Error ? nextError.message : "文件解析失败。",
      );
    } finally {
      setBusy("");
    }
  };

  const downloadTemplate = async () => {
    setBusy("template");
    setError("");
    setMessage("");
    try {
      await api.downloadDataImportTemplate();
      setMessage("统一数据导入模板已开始下载。");
    } catch (nextError) {
      setError(
        nextError instanceof Error ? nextError.message : "统一数据导入模板下载失败。",
      );
    } finally {
      setBusy("");
    }
  };

  const exportUnifiedData = async () => {
    setBusy("export");
    setError("");
    setMessage("");
    try {
      await api.exportUnifiedData(project);
      setMessage("当前权限范围内的运动员数据已开始导出，可直接作为统一导入模板使用。");
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "统一数据导出失败。");
    } finally {
      setBusy("");
    }
  };

  const loadBatch = async (id: string) => {
    setBusy("load");
    setError("");
    setMessage("");
    try {
      const result = await api.dataImportBatch(id);
      setBatch(result.batch);
      setCorrections(new Map());
      setAthleteCorrections(new Map());
    } catch (nextError) {
      setError(
        nextError instanceof Error ? nextError.message : "批次加载失败。",
      );
    } finally {
      setBusy("");
    }
  };

  const patchItem = (itemId: number, patch: Omit<Correction, "id">) => {
    const sourceItem = batch?.items.find((item) => item.id === itemId);
    const groupedIds =
      sourceItem && "athleteId" in patch
        ? batch?.items
            .filter(
              (item) =>
                normalizeAthleteName(item.rawAthleteName) ===
                normalizeAthleteName(sourceItem.rawAthleteName),
            )
            .map((item) => item.id) || [itemId]
        : [itemId];
    setBatch((current) =>
      current
        ? {
            ...current,
            items: current.items.map((item) =>
              groupedIds.includes(item.id) ? { ...item, ...patch } : item,
            ),
          }
        : current,
    );
    setCorrections((current) => {
      const next = new Map(current);
      for (const id of groupedIds)
        next.set(id, { ...(next.get(id) || { id }), ...patch });
      return next;
    });
  };

  const patchAthleteCandidate = (
    candidateId: number,
    patch: Omit<AthleteCorrection, "id">,
  ) => {
    setBatch((current) =>
      current
        ? {
            ...current,
            athleteCandidates: current.athleteCandidates.map((candidate) =>
              candidate.id === candidateId
                ? { ...candidate, ...patch }
                : candidate,
            ),
          }
        : current,
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

  const applyBulkCandidateTeam = () => {
    if (!batch || !bulkCandidateTeam) {
      setError("请先选择要批量分配的新运动员所属队伍。");
      return;
    }
    const pending = batch.athleteCandidates.filter(
      (candidate) => candidate.status === "pending",
    );
    if (!pending.length) return;
    for (const candidate of pending)
      patchAthleteCandidate(candidate.id, { team: bulkCandidateTeam });
    setMessage(`已为${pending.length}名待创建运动员填入“${bulkCandidateTeam}”，请保存后提交。`);
  };

  const saveCorrections = async () => {
    if (!batch || (!corrections.size && !athleteCorrections.size)) return batch;
    setBusy("save");
    setError("");
    try {
      let currentBatch = batch;
      if (athleteCorrections.size)
        currentBatch = (
          await api.updateDataImportAthletes(batch.id, [
            ...athleteCorrections.values(),
          ])
        ).batch;
      if (corrections.size)
        currentBatch = (
          await api.updateDataImportItems(batch.id, [...corrections.values()])
        ).batch;
      setBatch(currentBatch);
      setCorrections(new Map());
      setAthleteCorrections(new Map());
      setMessage("校对内容已保存，服务端已重新执行数据校验。");
      return currentBatch;
    } catch (nextError) {
      setError(
        nextError instanceof Error ? nextError.message : "校对内容保存失败。",
      );
      return null;
    } finally {
      setBusy("");
    }
  };

  const commit = async () => {
    if (!batch) return;
    setError("");
    setMessage("");
    let currentBatch = batch;
    if (corrections.size || athleteCorrections.size) {
      const saved = await saveCorrections();
      if (!saved) return;
      currentBatch = saved;
    }
    if (currentBatch.errorCount > 0) {
      setError(`仍有${currentBatch.errorCount}条红色错误，请先修正后再提交。`);
      return;
    }
    setBusy("commit");
    try {
      const result = await api.commitDataImport(
        currentBatch.id,
        conflictPolicy,
      );
      setBatch(result.batch);
      setMessage(result.message);
      await refreshBatches();
      onChanged();
    } catch (nextError) {
      setError(
        nextError instanceof Error ? nextError.message : "正式入库失败。",
      );
    } finally {
      setBusy("");
    }
  };

  const filteredItems = useMemo(() => {
    if (!batch) return [];
    const needle = query.trim().toLowerCase();
    return batch.items
      .filter((item) => {
        if (filter === "error" && item.quality !== "error") return false;
        if (filter === "warning" && item.quality !== "warning") return false;
        if (filter === "training" && item.itemType !== "training_set")
          return false;
        if (
          filter === "test" &&
          !["test_measurement", "body_measurement"].includes(item.itemType)
        )
          return false;
        if (!needle) return true;
        return [
          item.rawAthleteName,
          item.athleteName,
          item.exerciseName,
          item.metricLabel,
          item.sourceSheet,
        ].some((value) => value.toLowerCase().includes(needle));
      })
      .slice(0, 500);
  }, [batch, filter, query]);

  return (
    <section className="data-import-page">
      <header className="data-import-hero">
        <div>
          <span>DATA INTAKE</span>
          <h1>统一数据导入</h1>
          <p>
            确定性识别 Excel 中的运动员档案、恢复、训练、身体测量、测试、伤病和竞技状态，审核通过后再写入正式数据库。
          </p>
        </div>
        <div className="data-import-hero-actions">
          <button
            type="button"
            className="data-import-template"
            disabled={Boolean(busy)}
            onClick={downloadTemplate}
          >
            <Download size={19} />
            <div>
              <strong>{busy === "template" ? "正在准备模板…" : "下载统一数据模板"}</strong>
              <span>档案、训练、FMS、冠军模型、伤病、竞技状态</span>
            </div>
          </button>
          <button
            type="button"
            className="data-import-template"
            disabled={Boolean(busy)}
            onClick={exportUnifiedData}
          >
            <FileSpreadsheet size={19} />
            <div>
              <strong>{busy === "export" ? "正在导出数据…" : "导出统一数据"}</strong>
              <span>导出当前项目及权限范围内的全部已入库数据</span>
            </div>
          </button>
          <div className="data-import-safety">
            <Database size={20} />
            <div>
              <strong>先暂存，后入库</strong>
              <span>原值、工作表和单元格坐标全程保留</span>
            </div>
          </div>
        </div>
      </header>

      <div className="data-import-grid">
        <section className="data-import-upload-card">
          <div className="data-import-card-heading">
            <FileSpreadsheet size={20} />
            <div>
              <strong>上传源文件</strong>
              <span>支持旧版 XLS 与新版 XLSX，单文件不超过 80MB</span>
            </div>
          </div>
          <button
            type="button"
            className="data-import-drop"
            onClick={() => fileRef.current?.click()}
          >
            <UploadCloud size={28} />
            <strong>{file ? file.name : "选择 Excel 文件"}</strong>
            <span>
              {file
                ? `${(file.size / 1024 / 1024).toFixed(2)} MB`
                : "系统会自动遍历多张工作表和重复运动员小表"}
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
            <small>可选；表内存在日期时仍优先保留表内日期</small>
          </label>
          <button
            className="data-import-primary"
            disabled={!file || Boolean(busy)}
            onClick={analyze}
          >
            {busy === "analyze" ? (
              <RefreshCw className="spin" size={17} />
            ) : (
              <FileCheck2 size={17} />
            )}
            解析并生成审核预览
          </button>
        </section>

        <section className="data-import-history-card">
          <div className="data-import-card-heading">
            <Clock3 size={20} />
            <div>
              <strong>最近导入批次</strong>
              <span>当前项目：{project}</span>
            </div>
          </div>
          <div className="data-import-history-list">
            {!batches.length && (
              <p className="data-import-empty">当前项目还没有导入记录。</p>
            )}
            {batches.map((item) => (
              <button
                key={item.id}
                className={batch?.id === item.id ? "active" : ""}
                onClick={() => loadBatch(item.id)}
                disabled={busy === "load"}
              >
                <span className={`batch-state ${item.status}`}>
                  {STATUS_LABELS[item.status as DataImportBatch["status"]] ||
                    item.status}
                </span>
                <strong title={item.filename}>{item.filename}</strong>
                <small>
                  {item.itemCount}条 · 错误{item.errorCount} ·{" "}
                  {new Date(item.createdAt).toLocaleString("zh-CN")}
                </small>
              </button>
            ))}
          </div>
        </section>
      </div>

      {(message || error) && (
        <div className={`data-import-message ${error ? "error" : "success"}`}>
          {error ? <AlertTriangle size={17} /> : <CheckCircle2 size={17} />}
          <span>{error || message}</span>
        </div>
      )}

      {batch && (
        <>
          {batch.athleteCandidates.length > 0 && (
            <section className="data-import-candidates">
              <div className="data-import-review-head">
                <div>
                  <span>NEW ATHLETES</span>
                  <h2>新运动员档案</h2>
                  <p>
                    这些姓名未匹配到现有名册。请先批量或逐人分配所属队伍；提交时只创建人员档案，不创建登录账号。
                  </p>
                </div>
                <div className="data-import-candidate-bulk">
                  <select
                    value={bulkCandidateTeam}
                    disabled={batch.status !== "reviewing" || Boolean(busy)}
                    onChange={(event) => setBulkCandidateTeam(event.target.value)}
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
                    disabled={batch.status !== "reviewing" || Boolean(busy)}
                    onClick={applyBulkCandidateTeam}
                  >
                    批量应用
                  </button>
                </div>
                <button
                  disabled={
                    !athleteCorrections.size ||
                    Boolean(busy) ||
                    batch.status !== "reviewing"
                  }
                  onClick={saveCorrections}
                >
                  <Save size={15} />
                  保存新运动员资料
                </button>
              </div>
              <div className="data-import-candidate-grid">
                {batch.athleteCandidates.map(
                  (candidate: DataImportAthleteCandidate) => (
                    <article key={candidate.id}>
                      <span className={`candidate-state ${candidate.status}`}>
                        {candidate.status === "pending"
                          ? "待创建"
                          : candidate.status === "created"
                            ? "已创建"
                            : "已匹配"}
                      </span>
                      <label>
                        <span>姓名</span>
                        <input
                          disabled={
                            batch.status !== "reviewing" ||
                            candidate.status !== "pending"
                          }
                          value={candidate.name}
                          onChange={(event) =>
                            patchAthleteCandidate(candidate.id, {
                              name: event.target.value,
                            })
                          }
                        />
                      </label>
                      <label>
                        <span>性别</span>
                        <select
                          disabled={
                            batch.status !== "reviewing" ||
                            candidate.status !== "pending"
                          }
                          value={candidate.gender}
                          onChange={(event) =>
                            patchAthleteCandidate(candidate.id, {
                              gender: event.target.value,
                            })
                          }
                        >
                          <option value="">暂不填写</option>
                          <option>男</option>
                          <option>女</option>
                        </select>
                      </label>
                      <label>
                        <span>所属队伍</span>
                        <select
                          disabled={
                            batch.status !== "reviewing" ||
                            candidate.status !== "pending"
                          }
                          value={candidate.team}
                          onChange={(event) =>
                            patchAthleteCandidate(candidate.id, {
                              team: event.target.value,
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
                      <small>
                        {candidate.region}/{candidate.city}/{candidate.county} ·
                        来源：{candidate.sourceSheet}
                      </small>
                    </article>
                  ),
                )}
              </div>
            </section>
          )}
          <section className="data-import-summary">
            <div>
              <span>候选数据</span>
              <strong>{batch.itemCount}</strong>
              <small>{batch.sheetCount}张工作表</small>
            </div>
            <div>
              <span>可直接导入</span>
              <strong>{batch.validCount}</strong>
              <small>已通过确定性校验</small>
            </div>
            <div className="warning">
              <span>需要复核</span>
              <strong>{batch.warningCount}</strong>
              <small>允许确认后导入</small>
            </div>
            <div className="danger">
              <span>阻止提交</span>
              <strong>{batch.errorCount}</strong>
              <small>必须先修正</small>
            </div>
            <div>
              <span>批次状态</span>
              <strong className="status-text">
                {STATUS_LABELS[batch.status]}
              </strong>
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
                <h2>数据校对</h2>
                <p>最多同时展示500条；修改运动员、日期或数值后先保存校对。</p>
              </div>
              <div className="data-import-review-actions">
                <label className="data-import-search">
                  <Search size={15} />
                  <input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="搜索姓名、动作或指标"
                  />
                </label>
                <button
                  disabled={
                    (!corrections.size && !athleteCorrections.size) ||
                    Boolean(busy) ||
                    batch.status !== "reviewing"
                  }
                  onClick={saveCorrections}
                >
                  <Save size={15} />
                  保存校对
                  {corrections.size + athleteCorrections.size
                    ? `（${corrections.size + athleteCorrections.size}）`
                    : ""}
                </button>
              </div>
            </div>
            <div className="data-import-filters">
              {(
                [
                  ["all", `全部 ${batch.itemCount}`],
                  ["error", `错误 ${batch.errorCount}`],
                  ["warning", `警告 ${batch.warningCount}`],
                  ["training", "训练组次"],
                  ["test", "测试与身体"],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  className={filter === key ? "active" : ""}
                  onClick={() => setFilter(key)}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="data-import-table-wrap">
              <table className="data-import-table">
                <thead>
                  <tr>
                    <th>状态</th>
                    <th>类型</th>
                    <th>运动员</th>
                    <th>日期</th>
                    <th>动作/指标</th>
                    <th>数值</th>
                    <th>来源</th>
                    <th>校验信息</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredItems.map((item) => (
                    <tr key={item.id} className={item.quality}>
                      <td>
                        <span className={`quality-pill ${item.quality}`}>
                          {item.quality === "valid"
                            ? "通过"
                            : item.quality === "warning"
                              ? "复核"
                              : item.quality === "error"
                                ? "错误"
                                : "跳过"}
                        </span>
                      </td>
                      <td>{ITEM_LABELS[item.itemType]}</td>
                      <td>
                        {item.itemType === "scoring_rule" ? (
                          <span>规则数据</span>
                        ) : (
                          <select
                            disabled={batch.status !== "reviewing"}
                            value={item.athleteId || ""}
                            onChange={(event) =>
                              patchItem(item.id, {
                                athleteId: Number(event.target.value) || null,
                              })
                            }
                          >
                            <option value="">
                              新建无账号档案：{item.rawAthleteName}
                            </option>
                            {athletes.map((athlete) => (
                              <option key={athlete.id} value={athlete.id}>
                                {athlete.name} · {athlete.team}
                              </option>
                            ))}
                          </select>
                        )}
                      </td>
                      <td>
                        {item.itemType === "scoring_rule" ? (
                          "—"
                        ) : (
                          <input
                            disabled={batch.status !== "reviewing"}
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
                        <strong>{item.exerciseName || item.metricLabel}</strong>
                        {item.side !== "center" && (
                          <small>
                            {item.side === "left"
                              ? "左侧"
                              : item.side === "right"
                                ? "右侧"
                                : "双侧"}
                          </small>
                        )}
                      </td>
                      <td>
                        {item.itemType === "training_set" ? (
                          <div className="training-value-inputs">
                            <input
                              disabled={batch.status !== "reviewing"}
                              type="number"
                              step="0.1"
                              value={item.actualWeightKg ?? ""}
                              onChange={(event) =>
                                patchItem(item.id, {
                                  actualWeightKg:
                                    event.target.value === ""
                                      ? null
                                      : Number(event.target.value),
                                })
                              }
                            />
                            <span>kg ×</span>
                            <input
                              disabled={batch.status !== "reviewing"}
                              type="number"
                              step="1"
                              value={item.actualReps ?? ""}
                              onChange={(event) =>
                                patchItem(item.id, {
                                  actualReps:
                                    event.target.value === ""
                                      ? null
                                      : Number(event.target.value),
                                })
                              }
                            />
                            <span>次</span>
                          </div>
                        ) : item.itemType === "scoring_rule" ? (
                          displayValue(item)
                        ) : (
                          <div className="metric-value-input">
                            <input
                              disabled={batch.status !== "reviewing"}
                              type="number"
                              step="0.1"
                              value={item.valueNum ?? ""}
                              onChange={(event) =>
                                patchItem(item.id, {
                                  valueNum:
                                    event.target.value === ""
                                      ? null
                                      : Number(event.target.value),
                                })
                              }
                            />
                            <span>{item.unit}</span>
                          </div>
                        )}
                      </td>
                      <td>
                        <strong>{item.sourceSheet}</strong>
                        <small>
                          {item.sourceAddress} · 原值 {item.rawValue || "空"}
                        </small>
                      </td>
                      <td>
                        <div className="import-messages">
                          {item.messages.length ? (
                            item.messages.map((entry, index) => (
                              <span key={index}>
                                {entry.replace(/^错误：|^警告：/, "")}
                              </span>
                            ))
                          ) : (
                            <span>校验通过</span>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                  {!filteredItems.length && (
                    <tr>
                      <td colSpan={8} className="data-import-empty">
                        当前筛选条件下没有数据。
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <footer className="data-import-commit-bar">
              <label>
                <span>冲突处理</span>
                <select
                  value={conflictPolicy}
                  onChange={(event) =>
                    setConflictPolicy(event.target.value as "skip" | "update")
                  }
                  disabled={batch.status !== "reviewing"}
                >
                  <option value="skip">保留数据库原值，跳过重复项</option>
                  <option value="update">使用本批次更新重复项</option>
                </select>
              </label>
              <div>
                <small>
                  跳过项和空白值不会写入；整个批次在同一事务内提交。
                </small>
                <button
                  className="data-import-primary"
                  disabled={
                    Boolean(busy) ||
                    batch.status !== "reviewing" ||
                    batch.errorCount > 0
                  }
                  onClick={commit}
                >
                  <Database size={17} />
                  {busy === "commit"
                    ? "正在写入…"
                    : batch.status === "committed"
                      ? "已写入数据库"
                      : "确认写入数据库"}
                </button>
              </div>
            </footer>
          </section>
        </>
      )}
    </section>
  );
}
