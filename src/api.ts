import type { TeamPlan } from '../shared/team-plan';
import type { CatalogPlan, PlanExecutionRow } from '../shared/training-plan-catalog';
import {
  resetAccountPasswordSchema,
  resetAccountPasswordResponseSchema,
} from '../shared/account-password';
import { LOGIN_ERROR_MESSAGES } from '../shared/login-errors';
import { profilePhysiologyRecordSchema } from '../shared/profile-physiology';
import { z } from 'zod';
import { physicalChampionPayloadSchema } from '../shared/physical-champion';
import type {
  SpecialTestComparison,
  SpecialTrainingAnalytics,
  SpecialTrainingAthlete,
} from '../shared/special-training';
import type {
  AccessPayload,
  AreaPermission,
  Athlete,
  AthleteRadarModelsPayload,
  AuditLog,
  BodyCompositionRecord,
  AerobicEndurancePayload,
  WellnessTrendsPayload,
  ProfileComparisonPayload,
  ProfileTrainingStatusPayload,
  ChampionBenchmarkPayload,
  DataImportBatch,
  DataImportBatchSummary,
  InjuryRecord,
  InjuryStatus,
  OverviewPayload,
  Project,
  ProjectTeam,
  RegistrationRequest,
  SpecialChampionModelPayload,
  Role,
  SpecialTestEvent,
  SpecialTestImportPreview,
  StrengthTest,
  StrengthTrainingSession,
  TeamPermission,
  TrainingPlan,
  TrainingRecord,
  User,
  ErgometerChampionModelPayload,
} from './types';
import type { RowingPeriodAnalysis } from '../shared/rowing-model';
import type { CoachCategory } from '../shared/coach-categories';

const TOKEN_KEY = 'training-monitor-token';

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string | null) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

/** 携带结构化信息的请求错误：业务错误码、HTTP 状态与失败类别，供登录等流程按码映射提示。 */
export class ApiRequestError extends Error {
  readonly code?: string;
  readonly status?: number;
  readonly timedOut: boolean;
  readonly networkError: boolean;
  readonly serverMessage: string;
  readonly fieldErrors?: Partial<Record<'gender' | 'birthDate', string>>;

  constructor(
    message: string,
    detail: {
      code?: string;
      status?: number;
      timedOut?: boolean;
      networkError?: boolean;
      serverMessage?: string;
      fieldErrors?: Partial<Record<'gender' | 'birthDate', string>>;
    } = {}
  ) {
    super(message);
    this.name = 'ApiRequestError';
    this.code = detail.code;
    this.status = detail.status;
    this.timedOut = detail.timedOut ?? false;
    this.networkError = detail.networkError ?? false;
    this.serverMessage = detail.serverMessage ?? '';
    this.fieldErrors = detail.fieldErrors;
  }
}

type ApiRequestOptions = RequestInit & {
  /** 为 false 时不附加令牌，401 也不触发会话清理与刷新（登录、注册等免登录接口）。 */
  auth?: boolean;
  /** 请求超时毫秒数；仅对需要快速失败的接口（如登录）启用。 */
  timeoutMs?: number;
};

async function request<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
  const { auth = true, timeoutMs, ...init } = options;
  const headers = new Headers(init.headers);
  const token = getToken();
  if (token && auth !== false) headers.set('Authorization', `Bearer ${token}`);
  if (init.body && !(init.body instanceof FormData))
    headers.set('Content-Type', 'application/json');
  const controller = timeoutMs ? new AbortController() : undefined;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : undefined;
  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      headers,
      signal: controller?.signal ?? init.signal,
    });
  } catch {
    const timedOut = controller?.signal.aborted ?? false;
    throw new ApiRequestError(
      timedOut ? LOGIN_ERROR_MESSAGES.TIMEOUT : LOGIN_ERROR_MESSAGES.NETWORK_ERROR,
      { timedOut, networkError: !timedOut }
    );
  } finally {
    if (timer) clearTimeout(timer);
  }
  // 仅已登录会话的 401 视为 Token 失效；登录接口自身的 401 是认证失败，不得刷新页面。
  if (response.status === 401 && auth !== false && token) {
    setToken(null);
    window.location.reload();
    throw new ApiRequestError('登录已过期，请重新登录。', {
      status: 401,
      code: 'SESSION_EXPIRED',
    });
  }
  const isJson = response.headers.get('content-type')?.includes('application/json');
  let payload: unknown = null;
  if (isJson) {
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }
  }
  const body = payload as { message?: unknown; code?: unknown; fieldErrors?: unknown } | null;
  const code = typeof body?.code === 'string' ? body.code : undefined;
  const serverMessage = typeof body?.message === 'string' ? body.message : '';
  if (!response.ok) {
    throw new ApiRequestError(serverMessage || `请求失败（${response.status}）`, {
      code,
      status: response.status,
      serverMessage,
      fieldErrors: (() => {
        const parsed = z
          .object({
            gender: z.string().max(200).optional(),
            birthDate: z.string().max(200).optional(),
          })
          .safeParse(body?.fieldErrors);
        return parsed.success ? parsed.data : undefined;
      })(),
    });
  }
  if (isJson && payload === null) {
    throw new ApiRequestError('服务响应异常，请稍后重试', { status: response.status });
  }
  return payload as T;
}

export const api = {
  async physicalChampion(query: { project: string; from: string; to: string }) {
    const payload = await request<unknown>(`/api/physical-champion?${new URLSearchParams(query)}`);
    return physicalChampionPayloadSchema.parse(payload);
  },
  async updatePhysicalReference(
    id: number,
    body: {
      value: number;
      expectedValue: number;
      expectedRevision: number;
      protocol: string;
      sourceType: 'measured' | 'public_reference' | 'estimated';
      sourceNote: string;
    }
  ) {
    const payload = await request<unknown>(`/api/physical-champion/references/${id}`, {
      method: 'PUT',
      body: JSON.stringify(body),
    });
    return z.object({ message: z.string() }).parse(payload);
  },

  async teams() {
    return request<{ teams: ProjectTeam[] }>('/api/teams');
  },
  async registrationTeams() {
    return request<{ teams: ProjectTeam[] }>('/api/registration/teams', { auth: false });
  },
  async adminTeams() {
    return request<{ teams: ProjectTeam[]; canCreateProjects: Project[] }>('/api/admin/teams');
  },
  async createTeam(project: string, name: string) {
    return request<{ message: string; id: number }>('/api/admin/teams', {
      method: 'POST',
      body: JSON.stringify({ project, name }),
    });
  },
  async deleteTeam(id: number) {
    return request<{ message: string }>(`/api/admin/teams/${id}`, { method: 'DELETE' });
  },
  async login(username: string, password: string) {
    return request<{ token: string; user: User }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
      auth: false,
      timeoutMs: 30000,
    });
  },
  async register(input: {
    username: string;
    password: string;
    displayName: string;
    role: 'ATL' | 'SCC';
    project?: string;
    team?: string;
    gender: string;
    birthDate: string;
    phone: string;
    nativePlace: string;
  }) {
    return request<{ message: string }>('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify(input),
      auth: false,
    });
  },
  async me() {
    return request<{ user: User }>('/api/me');
  },
  async changePassword(currentPassword: string, newPassword: string) {
    return request<{ message: string }>('/api/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({ currentPassword, newPassword }),
    });
  },
  async logout() {
    return request<{ message: string }>('/api/auth/logout', { method: 'POST' });
  },
  async updateProfileName(name: string) {
    return request<{ message: string; user: User }>('/api/profile/name', {
      method: 'PUT',
      body: JSON.stringify({ name }),
    });
  },
  async renameUser(id: number, name: string) {
    return request<{ message: string; displayName: string }>(`/api/users/${id}/name`, {
      method: 'PUT',
      body: JSON.stringify({ name }),
    });
  },
  async renameAthlete(id: number, name: string) {
    return request<{ message: string; name: string }>(`/api/admin/athletes/${id}/name`, {
      method: 'PUT',
      body: JSON.stringify({ name }),
    });
  },
  async athletes() {
    return request<{ athletes: Athlete[] }>('/api/athletes');
  },
  async createAthlete(input: Record<string, unknown>) {
    return request<{ message: string; id: number; accountId: number | null }>(
      '/api/admin/athletes',
      {
        method: 'POST',
        body: JSON.stringify(input),
      }
    );
  },
  async updateAthlete(id: number, input: Record<string, unknown>) {
    return request<{ message: string }>(`/api/admin/athletes/${id}`, {
      method: 'PUT',
      body: JSON.stringify(input),
    });
  },
  async updateAthletePosition(id: number, athletePosition: string) {
    return request<{ message: string; athletePosition: string }>(`/api/athletes/${id}/position`, {
      method: 'PUT',
      body: JSON.stringify({ athletePosition }),
    });
  },
  async saveBodyComposition(id: number, input: Record<string, unknown>) {
    return request<{ message: string }>(`/api/athletes/${id}/body-composition`, {
      method: 'PUT',
      body: JSON.stringify(input),
    });
  },
  async getBodyCompositionHistory(id: number) {
    return request<{ history: BodyCompositionRecord[] }>(`/api/athletes/${id}/body-composition`);
  },
  async personalOverview(id: number, from: string, to: string, project: Project) {
    const params = new URLSearchParams({ from, to, project });
    const result = await request<{ overview: OverviewPayload }>(
      `/api/athletes/${id}/overview?${params}`
    );
    return {
      ...result,
      overview: {
        ...result.overview,
        physiologyRecords: z
          .array(profilePhysiologyRecordSchema)
          .parse(result.overview.physiologyRecords ?? []),
      },
    };
  },
  async wellnessTrends(id: number, from: string, to: string, project: Project) {
    return request<WellnessTrendsPayload>(
      `/api/athletes/${id}/wellness-trends?${new URLSearchParams({ from, to, project })}`
    );
  },
  async aerobicEndurance(id: number, from: string, to: string, project: Project) {
    return request<AerobicEndurancePayload>(
      `/api/athletes/${id}/aerobic-endurance?${new URLSearchParams({ from, to, project })}`
    );
  },
  async profileComparison(id: number, from: string, to: string, project: Project) {
    return request<{
      comparison: ProfileComparisonPayload;
      trainingStatus: ProfileTrainingStatusPayload;
    }>(`/api/athletes/${id}/profile-comparison?${new URLSearchParams({ from, to, project })}`);
  },
  async championBenchmark(id: number) {
    return request<{ benchmark: ChampionBenchmarkPayload }>(`/api/athletes/${id}/champion-model`);
  },
  async radarModels(id: number, from: string, to: string) {
    const params = new URLSearchParams({ from, to });
    return request<AthleteRadarModelsPayload>(`/api/athletes/${id}/radar-models?${params}`);
  },
  async specialChampionModels(project: Project) {
    const params = new URLSearchParams({ project });
    return request<SpecialChampionModelPayload>(`/api/special-champion-models?${params}`);
  },
  async ergometerChampionModels(
    project: Project,
    gender: 'MALE' | 'FEMALE',
    testType: '2000M' | '5000M' | '30MIN_20SPM'
  ) {
    const params = new URLSearchParams({
      project,
      gender,
      testType,
    });

    return request<ErgometerChampionModelPayload>(
      `/api/special-champion-models/ergometer?${params}`
    );
  },
  async bulkUpdateAthletes(ids: number[], input: Record<string, unknown>) {
    return request<{ message: string }>('/api/admin/athletes/bulk/profile', {
      method: 'PUT',
      body: JSON.stringify({ ids, ...input }),
    });
  },
  async deleteAthlete(id: number) {
    return request<{ message: string }>(`/api/admin/athletes/${id}`, { method: 'DELETE' });
  },
  async bulkDeleteAthletes(ids: number[]) {
    return request<{ message: string }>('/api/admin/athletes/bulk/delete', {
      method: 'POST',
      body: JSON.stringify({ ids }),
    });
  },
  async records(from: string, to: string, athleteId: number | null | undefined, project: Project) {
    const params = new URLSearchParams({ from, to, project });
    if (athleteId) params.set('athleteId', String(athleteId));
    return request<{ records: TrainingRecord[] }>(`/api/records?${params}`);
  },
  async saveSpecialTrainingSessions(
    sessions: Array<{
      athleteId: number;
      project: Project;
      date: string;
      type: string;
      content: string;
      duration: number;
      distance: number;
      rpe: number;
      strokeRate: number;
      heartRate: number;
      maxHeartRate: number;
      power: number;
      source: 'manual' | 'import';
    }>
  ) {
    return request<{ message: string; imported: number }>('/api/special-training/sessions', {
      method: 'POST',
      body: JSON.stringify({ sessions }),
    });
  },
  async overview(
    from: string,
    to: string,
    athleteId: number | null | undefined,
    project: Project,
    teamId?: number | null
  ) {
    const params = new URLSearchParams({ from, to, project });
    if (athleteId) params.set('athleteId', String(athleteId));
    if (teamId) params.set('teamId', String(teamId));
    return request<{ overview: OverviewPayload }>(`/api/overview?${params}`);
  },
  async overviewTeams(project: Project) {
    const params = new URLSearchParams({ project });
    return request<{ teams: ProjectTeam[] }>(`/api/overview/teams?${params}`);
  },
  async analysisSummary(from: string, to: string, athleteId: number, project: Project) {
    const params = new URLSearchParams({ from, to, athleteId: String(athleteId), project });
    return request<{
      standard: { version: string; decision: string; missingDataRule: string };
      analysis: RowingPeriodAnalysis;
    }>(`/api/analysis/summary?${params}`);
  },
  async strengthTests(athleteId: number) {
    return request<{ tests: StrengthTest[] }>(`/api/strength-tests?athleteId=${athleteId}`);
  },
  async saveStrengthTest(input: {
    athleteId: number;
    testDate: string;
    metrics: StrengthTest['metrics'];
    targets: StrengthTest['targets'];
    notes: string;
  }) {
    return request<{ message: string; id: number }>('/api/strength-tests', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  },
  async teamPlans(params: { athleteId?: number; project?: string } = {}) {
    const query = new URLSearchParams();
    if (params.athleteId !== undefined) query.set('athleteId', String(params.athleteId));
    if (params.project) query.set('project', params.project);
    return request<{
      plans: TeamPlan[];
      teams: Pick<ProjectTeam, 'id' | 'project' | 'name'>[];
      athletes: Pick<Athlete, 'id' | 'name' | 'teamId' | 'project'>[];
    }>(`/api/team-plans?${query}`);
  },
  async updateTeamPlan(plan: TeamPlan) {
    return request<{ plan: TeamPlan }>(`/api/team-plans/${plan.id}`, {
      method: 'PUT',
      body: JSON.stringify({
        revision: plan.revision,
        title: plan.title,
        startDate: plan.startDate,
        endDate: plan.endDate,
        data: plan.data,
      }),
    });
  },
  async transitionTeamPlan(
    planId: number,
    input: {
      revision: number;
      action: 'submit' | 'return' | 'publish' | 'archive' | 'revise';
      confirmed?: boolean;
    }
  ) {
    return request<{ plan: TeamPlan }>(`/api/team-plans/${planId}/transition`, {
      method: 'POST',
      body: JSON.stringify(input),
    });
  },
  async trainingPlanCatalog() {
    return request<{ plans: CatalogPlan[] }>('/api/training-plans/catalog');
  },
  async planExecution(project: string) {
    return request<{ date: string; athletes: PlanExecutionRow[] }>(
      `/api/coach/plan-execution?${new URLSearchParams({ project })}`
    );
  },
  async trainingPlans(athleteId: number) {
    return request<{ plans: TrainingPlan[] }>(`/api/training-plans?athleteId=${athleteId}`);
  },
  async injuryRecords(athleteId: number) {
    return request<{ records: InjuryRecord[] }>(`/api/athletes/${athleteId}/injuries`);
  },
  async createInjuryRecord(
    athleteId: number,
    input: {
      injuryName: string;
      bodyPart: string;
      side: InjuryRecord['side'];
      status: InjuryStatus;
      painScore: number;
      onsetDate: string;
      restrictions: string;
      rehabPlan: string;
      reviewDate: string;
      note: string;
    }
  ) {
    return request<{ message: string; record: InjuryRecord }>(
      `/api/athletes/${athleteId}/injuries`,
      {
        method: 'POST',
        body: JSON.stringify(input),
      }
    );
  },
  async uploadAthletePhoto(athleteId: number, file: File) {
    const body = new FormData();
    body.append('photo', file);
    return request<{ message: string; photoUrl: string }>(`/api/athletes/${athleteId}/photo`, {
      method: 'POST',
      body,
    });
  },
  async strengthTrainingResults(athleteId: number) {
    return request<{ sessions: StrengthTrainingSession[] }>(
      `/api/strength-training/results?athleteId=${athleteId}`
    );
  },
  async currentProject() {
    return request<{ project: Project | null; projects: Project[] }>(
      '/api/preferences/current-project'
    );
  },
  async saveCurrentProject(project: Project) {
    return request<{ project: Project }>('/api/preferences/current-project', {
      method: 'PUT',
      body: JSON.stringify({ project }),
    });
  },
  async downloadDataImportTemplate() {
    const response = await fetch('/api/data-import/template', {
      headers: { Authorization: `Bearer ${getToken()}` },
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      throw new Error(payload?.message || '统一数据导入模板下载失败。');
    }
    const blob = await response.blob();
    const link = document.createElement('a');
    const objectUrl = URL.createObjectURL(blob);
    link.href = objectUrl;
    link.download = '竞迹统一数据导入模板.xlsx';
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1500);
  },
  async exportUnifiedData(project: Project) {
    const response = await fetch(`/api/data-import/export?project=${encodeURIComponent(project)}`, {
      headers: { Authorization: `Bearer ${getToken()}` },
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      throw new Error(payload?.message || '统一数据导出失败。');
    }
    const blob = await response.blob();
    const link = document.createElement('a');
    const objectUrl = URL.createObjectURL(blob);
    link.href = objectUrl;
    link.download = `竞迹${project}统一数据导出.xlsx`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1500);
  },
  async analyzeDataImport(file: File, project: Project, defaultDate?: string) {
    const body = new FormData();
    body.append('file', file);
    body.append('project', project);
    if (defaultDate) body.append('defaultDate', defaultDate);
    return request<{ batch: DataImportBatch }>('/api/data-import/analyze', {
      method: 'POST',
      body,
    });
  },
  async dataImportBatches(project: Project) {
    return request<{ batches: DataImportBatchSummary[] }>(
      `/api/data-import/batches?project=${encodeURIComponent(project)}`
    );
  },
  async dataImportBatch(id: string) {
    return request<{ batch: DataImportBatch }>(
      `/api/data-import/batches/${encodeURIComponent(id)}`
    );
  },
  async discardDataImport(id: string, project: Project) {
    return request<{ message: string }>(
      `/api/data-import/batches/${encodeURIComponent(id)}?project=${encodeURIComponent(project)}`,
      { method: 'DELETE' }
    );
  },
  async updateDataImportItems(
    id: string,
    corrections: Array<{
      id: number;
      athleteId?: number | null;
      eventDate?: string;
      valueNum?: number | null;
      actualReps?: number | null;
      actualWeightKg?: number | null;
    }>
  ) {
    return request<{ batch: DataImportBatch }>(
      `/api/data-import/batches/${encodeURIComponent(id)}/items`,
      {
        method: 'PUT',
        body: JSON.stringify({ corrections }),
      }
    );
  },
  async updateDataImportAthletes(
    id: string,
    corrections: Array<{ id: number; name?: string; team?: string; gender?: string }>
  ) {
    return request<{ batch: DataImportBatch }>(
      `/api/data-import/batches/${encodeURIComponent(id)}/athletes`,
      {
        method: 'PUT',
        body: JSON.stringify({ corrections }),
      }
    );
  },
  async commitDataImport(id: string, conflictPolicy: 'skip' | 'update') {
    return request<{
      message: string;
      imported: number;
      skipped: number;
      createdAthletes: number;
      batch: DataImportBatch;
    }>(`/api/data-import/batches/${encodeURIComponent(id)}/commit`, {
      method: 'POST',
      body: JSON.stringify({ conflictPolicy }),
    });
  },
  async dataManagementMetrics() {
    return request<{
      metrics: Array<{
        code: string;
        label: string;
        domain: string;
        unit: string;
        direction: string;
        frequency: string;
        active: number;
      }>;
      aliases: Array<{
        alias: string;
        normalizedAlias: string;
        metricCode: string;
        canonicalLabel: string;
        unit: string;
        side: string;
      }>;
    }>('/api/data-management/metrics');
  },
  async updateDataManagementMetric(
    code: string,
    input: { label: string; unit: string; active: boolean }
  ) {
    return request<{ message: string }>(
      `/api/data-management/metrics/${encodeURIComponent(code)}`,
      { method: 'PUT', body: JSON.stringify(input) }
    );
  },
  async saveMetricAlias(input: { alias: string; metricCode: string; side?: string }) {
    return request<{ message: string }>('/api/data-management/metric-aliases', {
      method: 'PUT',
      body: JSON.stringify(input),
    });
  },
  async dataManagementStandards() {
    return request<{
      athlete: string[];
      training: { types: string[]; structures: string[]; zoneSystems: string[] };
      testing: string[];
      sources: string[];
      qualities: string[];
      retiredTables: string[];
    }>('/api/data-management/standards');
  },
  async specialTrainingOverview(
    from: string,
    to: string,
    project: Project,
    teamId: number | null,
    athleteId: number | null = null
  ) {
    const params = new URLSearchParams({ from, to, project });
    if (teamId) params.set('teamId', String(teamId));
    if (athleteId) params.set('athleteId', String(athleteId));
    return request<{
      training: SpecialTrainingAnalytics;
      teamTraining: SpecialTrainingAnalytics;
      athletes: SpecialTrainingAthlete[];
      selectedAthlete: SpecialTrainingAthlete | null;
      specialTestComparison: SpecialTestComparison | null;
    }>(`/api/special-training/overview?${params}`);
  },
  async specialTests(from: string, to: string, project: Project, athleteId?: number) {
    const params = new URLSearchParams({ from, to, project });
    if (athleteId) params.set('athleteId', String(athleteId));
    return request<{ events: SpecialTestEvent[] }>(`/api/special-tests?${params}`);
  },
  async previewSpecialTests(file: File, project: Project) {
    const body = new FormData();
    body.append('file', file);
    body.append('project', project);
    return request<SpecialTestImportPreview>('/api/special-tests/import/preview', {
      method: 'POST',
      body,
    });
  },
  async commitSpecialTests(importId: string) {
    return request<{
      imported: number;
      events: number;
      skipped: number;
      conflicts?: Array<{ rowNumber: number; crewName: string }>;
    }>('/api/special-tests/import/commit', {
      method: 'POST',
      body: JSON.stringify({ importId }),
    });
  },
  async downloadSpecialTestTemplate() {
    const response = await fetch('/api/special-tests/import/template', {
      headers: { Authorization: `Bearer ${getToken()}` },
    });
    if (!response.ok) throw new Error('专项训练模板下载失败。');
    const blob = await response.blob();
    const link = document.createElement('a');
    const objectUrl = URL.createObjectURL(blob);
    link.href = objectUrl;
    link.download = '竞迹专项训练导入模板.xlsx';
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1500);
  },
  async assignments() {
    return request<{
      athletes: Array<Athlete & { coachIds: string }>;
      coaches: Array<{ id: number; displayName: string; category: CoachCategory }>;
    }>('/api/admin/assignments');
  },
  async updateAssignment(athleteId: number, region: string, city: string, county: string) {
    return request<{ updated: boolean }>(`/api/admin/assignments/${athleteId}`, {
      method: 'PUT',
      body: JSON.stringify({ region, city, county }),
    });
  },
  async registrations(status: 'pending' | 'approved' | 'rejected' = 'pending') {
    return request<{ requests: RegistrationRequest[]; pending: number }>(
      `/api/admin/registrations?status=${status}`
    );
  },
  async registrationApproval() {
    return request<{ enabled: boolean }>('/api/admin/registrations/approval');
  },
  async setRegistrationApproval(enabled: boolean) {
    return request<{ enabled: boolean }>('/api/admin/registrations/approval', {
      method: 'PUT',
      body: JSON.stringify({ enabled }),
    });
  },
  async reviewRegistration(id: number, action: 'approve' | 'reject') {
    return request<{ message: string }>(`/api/admin/registrations/${id}/${action}`, {
      method: 'POST',
    });
  },
  async verifyRegistrationTeam(id: number, approved: boolean) {
    return request<{ message: string }>(`/api/admin/registrations/${id}/verify-team`, {
      method: 'POST',
      body: JSON.stringify({ approved }),
    });
  },
  async updateRegistrationTeam(id: number, project: string, team: string) {
    return request<{ message: string }>(`/api/admin/registrations/${id}/team`, {
      method: 'PUT',
      body: JSON.stringify({ project, team }),
    });
  },
  async renameRegistration(id: number, name: string) {
    return request<{ message: string; displayName: string }>(
      `/api/admin/registrations/${id}/name`,
      {
        method: 'PUT',
        body: JSON.stringify({ name }),
      }
    );
  },
  async accessAccounts() {
    return request<AccessPayload>('/api/access/accounts');
  },
  async createAccessAccount(input: {
    username: string;
    password: string;
    displayName: string;
    role: Role;
    parentUserId: number;
    gender?: string;
    areas: AreaPermission[];
    projects: string[];
    teams: TeamPermission[];
    coachCategory?: CoachCategory;
  }) {
    return request<{ message: string; id: number }>('/api/access/accounts', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  },
  async updateAccessAccount(
    id: number,
    input: {
      role: Role;
      parentUserId: number;
      areas: AreaPermission[];
      projects: string[];
      teams: TeamPermission[];
    }
  ) {
    return request<{ message: string }>(`/api/access/accounts/${id}`, {
      method: 'PUT',
      body: JSON.stringify(input),
    });
  },
  async resetAccessAccountPassword(id: number, newPassword: string) {
    const body = resetAccountPasswordSchema.parse({ newPassword });
    return resetAccountPasswordResponseSchema.parse(
      await request<unknown>(`/api/access/accounts/${id}/reset-password`, {
        method: 'POST',
        body: JSON.stringify(body),
      })
    );
  },
  async setAccessAccountStatus(id: number, active: boolean) {
    return request<{ message: string; active: boolean }>(`/api/access/accounts/${id}/status`, {
      method: 'PUT',
      body: JSON.stringify({ active }),
    });
  },
  async updateCoachCategory(id: number, category: CoachCategory) {
    return request<{ message: string; category: CoachCategory }>(
      `/api/admin/coaches/${id}/category`,
      {
        method: 'PUT',
        body: JSON.stringify({ category }),
      }
    );
  },
  async auditLogs() {
    return request<{ logs: AuditLog[] }>('/api/access/audit-logs');
  },
};
