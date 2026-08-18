import type { AreaLevel, Role } from '../shared/access';
import type { StrengthMetricValues } from '../shared/strength-model';
import type { Project } from '../shared/projects';

export type { AreaLevel, Role };
export type { Project };
export type TrainingStatus = 'normal' | 'attention' | 'alert' | 'rest' | 'missing';

export type User = {
  id: number;
  username: string;
  displayName: string;
  role: Role;
  athleteId: number | null;
};

export type TrainingBreakdown = {
  waterMinutes: number;
  ergMinutes: number;
  landMinutes: {
    functional: number;
    endurance: number;
    maxStrength: number;
    speedStrength: number;
    recovery: number;
    running: number;
    other: number;
  };
  waterDistanceByZone: Record<'U3' | 'U2' | 'U1' | 'AT' | 'TPT' | 'AN' | 'ATP', number>;
  waterTimeByZone: Record<'U3' | 'U2' | 'U1' | 'AT' | 'TPT' | 'AN' | 'ATP', number>;
  ergDistanceByZone: Record<'U3' | 'U2' | 'U1' | 'AT' | 'TPT' | 'AN' | 'ATP', number>;
};

export type Athlete = {
  id: number;
  name: string;
  project: string;
  team: string;
  gender: string;
  region: string;
  province: string;
  city: string;
  county: string;
  coaches: string;
  photoUrl: string;
  coachUsers?: Array<{ id: number; displayName: string }>;
};

export type TrainingPlanWeekEntry = {
  sets: string;
  reps: string;
  percentage: number | null;
  actualCompleted: string;
};

export type TrainingPlanLine = {
  id: string;
  weeks: Record<'1' | '2' | '3' | '4', TrainingPlanWeekEntry>;
};

export type TrainingPlanExercise = {
  id: string;
  name: string;
  maxWeight: number | null;
  unitNote: string;
  lines: TrainingPlanLine[];
};

export type TrainingPlanData = {
  startDate: string;
  endDate: string;
  title: string;
  scheduleLabel: string;
  bodyWeight: number | null;
  age: number | null;
  exercises: TrainingPlanExercise[];
};

export type TrainingPlan = {
  id: number;
  athleteId: number;
  athleteName: string;
  project: string;
  team: string;
  photoUrl: string;
  data: TrainingPlanData;
  updatedAt: string;
  updatedBy: string;
};

export type BatchTrainingPlanPreview = {
  importId: string;
  fileName: string;
  data: TrainingPlanData;
  exerciseCount: number;
  lineCount: number;
  athletes: Array<{
    id: number;
    name: string;
    team: string;
    hasConflict: boolean;
    reusedMaxCount: number;
  }>;
  conflictCount: number;
};

export type InjuryStatus = 'healthy' | 'observation' | 'restricted' | 'rehab' | 'suspended';

export type InjuryRecord = {
  id: number;
  athleteId: number;
  recordType: 'formal' | 'feedback';
  injuryName: string;
  bodyPart: string;
  side: 'left' | 'right' | 'bilateral' | 'center' | 'unspecified';
  status: InjuryStatus;
  painScore: number;
  onsetDate: string;
  restrictions: string;
  rehabPlan: string;
  reviewDate: string;
  note: string;
  createdBy: string;
  creatorRole: Role;
  createdAt: string;
};

export type SpecialTestResult = {
  id: number;
  rank: number;
  crewName: string;
  memberAthleteIds: number[];
  memberNames: string[];
  previousBestMs: number | null;
  attemptsMs: number[];
  averageMs: number;
  bestMs: number;
  deltaPreviousMs: number | null;
  gapLeaderMs: number;
};

export type SpecialTestEvent = {
  id: number;
  project: Project;
  testDate: string;
  distanceM: number;
  boatClass: string;
  genderGroup: string;
  session: string;
  windConditions: string;
  location: string;
  note: string;
  results: SpecialTestResult[];
};

export type SpecialTestImportRow = {
  rowNumber: number;
  testDate: string;
  project: Project | '';
  distanceM: number;
  boatClass: string;
  genderGroup: string;
  crewName: string;
  memberNames: string[];
  session: string;
  windConditions: string;
  location: string;
  note: string;
  previousBestMs: number | null;
  attemptsMs: number[];
  averageMs: number;
  bestMs: number;
  errors: string[];
  warnings: string[];
};

export type SpecialTestImportPreview = {
  importId: string;
  fileName: string;
  total: number;
  valid: number;
  invalid: number;
  warningCount: number;
  rows: SpecialTestImportRow[];
};

export type TrainingRecord = {
  id: number;
  athleteId: number;
  athleteName: string;
  project: string;
  team: string;
  region: string;
  province: string;
  city: string;
  county: string;
  date: string;
  trainingType: string;
  structureType: string;
  intensityZone: string;
  content: string;
  durationMin: number;
  distanceKm: number;
  rpe: number | null;
  srpe: number;
  smvl: number;
  morningPulse: number | null;
  weightKg: number | null;
  sleepHours: number | null;
  fatigueIndex: number | null;
  status: TrainingStatus;
  coachNote: string;
  trainingBreakdown: TrainingBreakdown;
  updatedAt: string;
  updatedBy: string;
};

export type ImportRow = Omit<TrainingRecord, 'id' | 'updatedAt' | 'updatedBy'> & {
  rowNumber: number;
  athleteId: number | null;
  errors: string[];
  warnings: string[];
};

export type ImportPreview = {
  importId: string;
  fileName: string;
  total: number;
  valid: number;
  invalid: number;
  warningCount: number;
  rows: ImportRow[];
};

export type RegistrationRequest = {
  id: number;
  username: string;
  displayName: string;
  requestedRole: 'ATL' | 'SCC';
  project: string | null;
  team: string | null;
  gender: string | null;
  region: string | null;
  city: string | null;
  county: string | null;
  status: 'pending' | 'approved' | 'rejected';
  createdAt: string;
  reviewedAt: string | null;
};

export type AreaPermission = {
  areaLevel: AreaLevel;
  province: string;
  city: string;
  county: string;
};

export type TeamPermission = {
  project: string;
  team: string;
};

export type AccessAccount = {
  id: number;
  username: string;
  displayName: string;
  role: Role;
  roleLabel: string;
  roleLevel: number;
  athleteId: number | null;
  active: number;
  parentUserId: number | null;
  parentName: string | null;
  accountCode: string;
  standardName: string;
  areas: AreaPermission[];
  projects: string[];
  teams: TeamPermission[];
};

export type AccessPayload = {
  current: AccessAccount;
  accounts: AccessAccount[];
  possibleParents: Array<{ id: number; displayName: string; role: Role; roleLabel: string }>;
  meta: {
    roles: Record<Role, { code: Role; label: string; level: number; scope: string }>;
    hierarchy: Role[][];
    areaLevels: Record<AreaLevel, { label: string; rank: number }>;
    provinces: string[];
    projects: string[];
  };
};

export type AuditLog = {
  id: number;
  action: string;
  entityType: string;
  entityId: number | null;
  detail: string | null;
  createdAt: string;
  actorId: number;
  actorName: string;
  actorUsername: string;
};

export type StrengthTest = {
  id: number;
  athleteId: number;
  testDate: string;
  metrics: StrengthMetricValues;
  targets: StrengthMetricValues;
  notes: string;
  updatedAt: string;
  updatedBy: string;
};

export type StrengthAdviceWeek = {
  week: number;
  focus: string;
  load: string;
  prescription: string[];
};

export type StrengthAdviceContent = {
  title: string;
  overview: string;
  strengths: string[];
  priorities: string[];
  weeks: StrengthAdviceWeek[];
  recovery: string[];
  cautions: string[];
};

export type StrengthAdvice = {
  id: number;
  strengthTestId: number;
  version: number;
  content: StrengthAdviceContent;
  source: 'ai' | 'rules';
  model: string;
  status: 'draft' | 'approved';
  generatedAt: string;
  generatedBy: string;
  reviewedAt: string | null;
  reviewedBy: string | null;
};
