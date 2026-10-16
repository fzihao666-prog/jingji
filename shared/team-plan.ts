export interface TeamPlanSession {
  id: string;
  date: string;
  category: 'special' | 'physical' | 'recovery';
  period: string;
  content: string;
  durationMin: number | null;
  distanceKm: number | null;
  intensity: string;
  sets: number | null;
  reps: number | null;
  load: number | null;
  notes: string;
}
export interface TeamPlanOverride {
  athleteId: number;
  sessionId: string;
  changes: Partial<Omit<TeamPlanSession, 'id' | 'date' | 'category'>>;
  reason: string;
  createdBy: number;
  updatedBy: number;
  createdAt: string;
  updatedAt: string;
}
export interface TeamPlanData {
  sessions: TeamPlanSession[];
  overrides: TeamPlanOverride[];
  goal: string;
  focus: string;
}
export interface TeamPlan {
  id: number;
  rootId: number;
  version: number;
  revision: number;
  status: 'draft' | 'pending' | 'published' | 'archived';
  teamId: number;
  project: string;
  team: string;
  title: string;
  startDate: string;
  endDate: string;
  data: TeamPlanData;
  publishedAt: string | null;
  archivedAt: string | null;
}
export function resolveTeamPlanSessions(
  plan: Pick<TeamPlan, 'data'>,
  athleteId: number
): TeamPlanSession[] {
  return plan.data.sessions.map((session) => ({
    ...session,
    ...plan.data.overrides.find(
      (item) => item.sessionId === session.id && item.athleteId === athleteId
    )?.changes,
  }));
}
