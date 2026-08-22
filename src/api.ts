import type {
  AccessPayload,
  AreaPermission,
  Athlete,
  AuditLog,
  ImportInspection,
  ImportJobStatus,
  ImportPreview,
  ImportRow,
  InjuryRecord,
  InjuryStatus,
  OverviewPayload,
  Project,
  ProjectTeam,
  RegistrationRequest,
  Role,
  SpecialTestEvent,
  SpecialTestImportPreview,
  StrengthAdvice,
  StrengthAdviceContent,
  StrengthTest,
  TeamPermission,
  TrainingPlan,
  TrainingPlanData,
  AIImportedTrainingPlan,
  AITrainingPlanImportMetadata,
  TrainingRecord,
  User
} from './types';
import type { RowingPeriodAnalysis } from '../shared/rowing-model';

const TOKEN_KEY = 'training-monitor-token';

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string | null) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  const token = getToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (options.body && !(options.body instanceof FormData)) headers.set('Content-Type', 'application/json');
  const response = await fetch(path, { ...options, headers });
  const isJson = response.headers.get('content-type')?.includes('application/json');
  const payload = isJson ? await response.json() : null;
  if (!response.ok) throw new Error(payload?.message || `请求失败（${response.status}）`);
  return payload as T;
}

export const api = {
  async teams() {
    return request<{ teams: ProjectTeam[] }>('/api/teams');
  },
  async adminTeams() {
    return request<{ teams: ProjectTeam[]; canCreateProjects: Project[] }>('/api/admin/teams');
  },
  async createTeam(project: string, name: string) {
    return request<{ message: string; id: number }>('/api/admin/teams', {
      method: 'POST', body: JSON.stringify({ project, name })
    });
  },
  async deleteTeam(id: number) {
    return request<{ message: string }>(`/api/admin/teams/${id}`, { method: 'DELETE' });
  },
  async login(username: string, password: string) {
    return request<{ token: string; user: User }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password })
    });
  },
  async register(input: {
    username: string;
    password: string;
    displayName: string;
    role: 'ATL' | 'SCC';
    project?: string;
    team?: string;
    gender?: string;
    identityNumber: string;
    nativePlace: string;
  }) {
    return request<{ message: string }>('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify(input)
    });
  },
  async me() {
    return request<{ user: User }>('/api/me');
  },
  async changePassword(currentPassword: string, newPassword: string) {
    return request<{ message: string }>('/api/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({ currentPassword, newPassword })
    });
  },
  async updateProfileName(name: string) {
    return request<{ message: string; user: User }>('/api/profile/name', {
      method: 'PUT',
      body: JSON.stringify({ name })
    });
  },
  async renameUser(id: number, name: string) {
    return request<{ message: string; displayName: string }>(`/api/users/${id}/name`, {
      method: 'PUT',
      body: JSON.stringify({ name })
    });
  },
  async renameAthlete(id: number, name: string) {
    return request<{ message: string; name: string }>(`/api/admin/athletes/${id}/name`, {
      method: 'PUT',
      body: JSON.stringify({ name })
    });
  },
  async athletes() {
    return request<{ athletes: Athlete[] }>('/api/athletes');
  },
  async records(from: string, to: string, athleteId: number | null | undefined, project: Project) {
    const params = new URLSearchParams({ from, to, project });
    if (athleteId) params.set('athleteId', String(athleteId));
    return request<{ records: TrainingRecord[] }>(`/api/records?${params}`);
  },
  async overview(from: string, to: string, athleteId: number | null | undefined, project: Project) {
    const params = new URLSearchParams({ from, to, project });
    if (athleteId) params.set('athleteId', String(athleteId));
    return request<{ overview: OverviewPayload }>(`/api/overview?${params}`);
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
      body: JSON.stringify(input)
    });
  },
  async strengthAdvice(strengthTestId: number) {
    return request<{ advice: StrengthAdvice | null }>(`/api/strength-tests/${strengthTestId}/advice`);
  },
  async generateStrengthAdvice(strengthTestId: number) {
    return request<{ advice: StrengthAdvice; message: string }>(`/api/strength-tests/${strengthTestId}/advice/generate`, {
      method: 'POST'
    });
  },
  async saveStrengthAdvice(strengthTestId: number, adviceId: number, content: StrengthAdviceContent) {
    return request<{ advice: StrengthAdvice; message: string }>(`/api/strength-tests/${strengthTestId}/advice/${adviceId}`, {
      method: 'PUT',
      body: JSON.stringify({ content })
    });
  },
  async approveStrengthAdvice(strengthTestId: number, adviceId: number) {
    return request<{ advice: StrengthAdvice; message: string }>(`/api/strength-tests/${strengthTestId}/advice/${adviceId}/approve`, {
      method: 'POST'
    });
  },
  async trainingPlans(athleteId: number) {
    return request<{ plans: TrainingPlan[] }>(`/api/training-plans?athleteId=${athleteId}`);
  },
  async injuryRecords(athleteId: number) {
    return request<{ records: InjuryRecord[] }>(`/api/athletes/${athleteId}/injuries`);
  },
  async createInjuryRecord(athleteId: number, input: {
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
  }) {
    return request<{ message: string; record: InjuryRecord }>(`/api/athletes/${athleteId}/injuries`, {
      method: 'POST',
      body: JSON.stringify(input)
    });
  },
  async saveTrainingPlan(athleteId: number, data: TrainingPlanData, planId?: number | null) {
    return request<{ message: string; id: number }>('/api/training-plans', {
      method: 'POST',
      body: JSON.stringify({ athleteId, data, planId: planId || undefined })
    });
  },
  // AI 体能训练 API
  async analyzeAITrainingPlan(formData: FormData) {
    return request<{
      plan: {
        title: string;
        summary: string;
        durationWeeks: number;
        startDate: string;
        endDate: string;
        scheduleLabel: string;
        bodyWeight: number | null;
        age: number | null;
        weeklyPlans: Array<{
          weekNumber: number;
          focus: string;
          totalLoad: number;
          days: Array<{
            dayOfWeek: string;
            exercises: Array<{
              name: string;
              sets: string;
              reps: string;
              percentage: number;
              notes?: string;
            }>;
          }>;
        }>;
        exercises: Array<{
          id: string;
          name: string;
          maxWeight: number | null;
          unitNote: string;
        }>;
      };
      aiMetadata: {
        inputType: 'text';
        inputContent: string;
        fileMetadata?: {
          filename: string;
          mimetype: string;
          size: number;
        };
        modelUsed: string;
        attempts: number;
        generatedAt: string;
      };
    }>('/api/training-plans/ai/analyze', {
      method: 'POST',
      body: formData
    });
  },
  async previewAITrainingPlanImport(file: File, athleteId: number) {
    const body = new FormData();
    body.append('file', file);
    body.append('athleteId', String(athleteId));
    return request<{
      plan: AIImportedTrainingPlan;
      aiMetadata: AITrainingPlanImportMetadata;
    }>('/api/training-plans/ai/import/preview', {
      method: 'POST',
      body
    });
  },
  async saveAITrainingPlan(params: {
    athleteId?: number;
    athleteIds?: number[];
    plan: unknown;
    aiMetadata: unknown;
    replaceExisting?: boolean;
  }) {
    return request<{
      message: string;
      id: number;
      created: number;
      replaced: number;
      skipped: number;
      results: Array<{ athleteId: number; athleteName: string; status: 'created' | 'replaced' | 'skipped'; planId: number }>;
    }>('/api/training-plans/ai/save', {
      method: 'POST',
      body: JSON.stringify(params)
    });
  },
  async deleteTrainingPlan(planId: number) {
    return request<{ message: string }>(`/api/training-plans/${planId}`, { method: 'DELETE' });
  },
  async uploadAthletePhoto(athleteId: number, file: File) {
    const body = new FormData();
    body.append('photo', file);
    return request<{ message: string; photoUrl: string }>(`/api/athletes/${athleteId}/photo`, {
      method: 'POST',
      body
    });
  },
  async downloadTrainingPlan(planId: number, filename: string) {
    const response = await fetch(`/api/training-plans/${planId}/export`, {
      headers: { Authorization: `Bearer ${getToken()}` }
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      throw new Error(payload?.message || '体能训练导出失败。');
    }
    const blob = await response.blob();
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    link.click();
    URL.revokeObjectURL(link.href);
  },
  async previewImport(file: File, project: Project) {
    const body = new FormData();
    body.append('file', file);
    body.append('project', project);
    return request<ImportPreview>('/api/import/ai/preview', { method: 'POST', body });
  },
  async inspectImport(file: File, project: Project) {
    const body = new FormData();
    body.append('file', file);
    body.append('project', project);
    return request<ImportInspection>('/api/import/ai/inspect', { method: 'POST', body });
  },
  async recognizeInspectedImport(
    fileId: string,
    sectionNames: string[],
    targetType: 'auto' | 'training_plan' | 'training_record',
    onProgress?: (status: ImportJobStatus) => void
  ) {
    const started = await request<{ jobId: string; totalChunks: number }>('/api/import/ai/start', {
      method: 'POST',
      body: JSON.stringify({ fileId, sectionNames, targetType })
    });
    const deadline = Date.now() + 60 * 60 * 1000;
    while (Date.now() < deadline) {
      const status = await request<ImportJobStatus>(`/api/import/ai/jobs/${encodeURIComponent(started.jobId)}`);
      onProgress?.(status);
      if (status.status === 'complete' && status.result) return status.result;
      if (status.status === 'failed') throw new Error(status.error || 'AI识别失败');
      await new Promise((resolve) => window.setTimeout(resolve, 800));
    }
    throw new Error('AI识别任务等待超过1小时，请重新选择文件。');
  },
  async commitImport(importId: string, rows?: ImportRow[]) {
    return request<{ imported: number; skipped: number }>('/api/import/commit', {
      method: 'POST',
      body: JSON.stringify({ importId, rows })
    });
  },
  async downloadTemplate() {
    const response = await fetch('/api/import/template', {
      headers: { Authorization: `Bearer ${getToken()}` }
    });
    if (!response.ok) throw new Error('模板下载失败。');
    const blob = await response.blob();
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = '训练数据导入模板.xlsx';
    link.click();
    URL.revokeObjectURL(link.href);
  },
  async specialTests(from: string, to: string, project: Project) {
    const params = new URLSearchParams({ from, to, project });
    return request<{ events: SpecialTestEvent[] }>(`/api/special-tests?${params}`);
  },
  async previewSpecialTests(file: File, project: Project) {
    const body = new FormData();
    body.append('file', file);
    body.append('project', project);
    return request<SpecialTestImportPreview>('/api/special-tests/import/preview', { method: 'POST', body });
  },
  async commitSpecialTests(importId: string) {
    return request<{ imported: number; events: number; skipped: number }>('/api/special-tests/import/commit', {
      method: 'POST',
      body: JSON.stringify({ importId })
    });
  },
  async downloadSpecialTestTemplate() {
    const response = await fetch('/api/special-tests/import/template', {
      headers: { Authorization: `Bearer ${getToken()}` }
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
      coaches: Array<{ id: number; displayName: string }>;
    }>('/api/admin/assignments');
  },
  async updateAssignment(athleteId: number, coachIds: number[], region: string, city: string, county: string) {
    return request<{ updated: boolean }>(`/api/admin/assignments/${athleteId}`, {
      method: 'PUT',
      body: JSON.stringify({ coachIds, region, city, county })
    });
  },
  async registrations(status: 'pending' | 'approved' | 'rejected' = 'pending') {
    return request<{ requests: RegistrationRequest[]; pending: number }>(`/api/admin/registrations?status=${status}`);
  },
  async reviewRegistration(id: number, action: 'approve' | 'reject') {
    return request<{ message: string }>(`/api/admin/registrations/${id}/${action}`, { method: 'POST' });
  },
  async renameRegistration(id: number, name: string) {
    return request<{ message: string; displayName: string }>(`/api/admin/registrations/${id}/name`, {
      method: 'PUT',
      body: JSON.stringify({ name })
    });
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
  }) {
    return request<{ message: string; id: number }>('/api/access/accounts', {
      method: 'POST',
      body: JSON.stringify(input)
    });
  },
  async updateAccessAccount(id: number, input: {
    role: Role;
    parentUserId: number;
    areas: AreaPermission[];
    projects: string[];
    teams: TeamPermission[];
  }) {
    return request<{ message: string }>(`/api/access/accounts/${id}`, {
      method: 'PUT',
      body: JSON.stringify(input)
    });
  },
  async setAccessAccountStatus(id: number, active: boolean) {
    return request<{ message: string; active: boolean }>(`/api/access/accounts/${id}/status`, {
      method: 'PUT',
      body: JSON.stringify({ active })
    });
  },
  async auditLogs() {
    return request<{ logs: AuditLog[] }>('/api/access/audit-logs');
  }
};
