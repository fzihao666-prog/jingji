import type { AreaLevel, Role } from '../shared/access';
import type { StrengthMetricValues } from '../shared/strength-model';
import type { StrengthBodyPosition, StrengthIntensityZone, StrengthTrainingCategory, StrengthTrainingEnvironment } from '../shared/strength-training';
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

export type ProjectTeam = {
  id: number;
  project: Project;
  name: string;
  athleteCount: number;
  canDelete?: boolean;
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
  birthDate: string | null;
  heightCm: number | null;
  weightKg: number | null;
  bodyFatPct: number | null;
  identityNumber: string;
  ethnicity: string;
  phone: string;
  bloodType: string;
  emergencyContact: string;
  emergencyPhone: string;
  education: string;
  technicalLevel: string;
  athletePosition: string;
  healthStatus: string;
  bestResult: string;
  nativePlace: string;
  homeAddress: string;
  athleteStatus: string;
  startSportDate: string;
  trainingVenue: string;
  currentEvent: string;
  trainingPhase: string;
  campPeriod: string;
  originPlace: string;
  originUnit: string;
  originCoach: string;
  specialties: string;
  notes: string;
  createdAt: string;
  coachUsers?: Array<{ id: number; displayName: string }>;
};

export type TrainingPlanWeekEntry = {
  sets: string;
  reps: string;
  percentage: number | null;
  actualCompleted: string;
  arrangement?: string;
};

export type TrainingPlanLine = {
  id: string;
  weeks: Record<string, TrainingPlanWeekEntry>;
};

export type TrainingPlanExercise = {
  id: string;
  name: string;
  maxWeight: number | null;
  unitNote: string;
  category?: StrengthTrainingCategory;
  bodyPosition?: StrengthBodyPosition;
  targetIntensity?: number | null;
  estimatedMinutes?: number | null;
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
  weekKeys?: string[];
  weekLabels?: Record<string, string>;
  sourceType?: 'ai_import' | 'ai_generated';
  summary?: string;
  durationWeeks?: number | null;
  weeklyPlans?: Array<Record<string, unknown>>;
  confidence?: number | null;
  warnings?: string[];
  unmappedContent?: string[];
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

export type StrengthResultSet = {
  id: number;
  exerciseName: string;
  setIndex: number;
  targetReps: number | null;
  actualReps: number;
  actualWeightKg: number;
  plannedWeightKg: number | null;
  trainingCategory: StrengthTrainingCategory;
  bodyPosition: StrengthBodyPosition;
  trainingEnvironment: StrengthTrainingEnvironment;
  durationMin: number;
  distanceKm: number;
  intensityPercent: number | null;
  intensityZone: StrengthIntensityZone;
  rpe: number | null;
  completed: boolean;
  note: string;
  importBatchId: string;
  confidence: number | null;
};

export type StrengthTrainingSession = {
  id: number;
  trainingDate: string;
  sessionOrder: number;
  sessionLabel: string;
  rpe: number | null;
  volume: number;
  durationMin: number;
  distanceKm: number;
  trainingType: string;
  structureType: string;
  intensityZone: StrengthIntensityZone;
  srpe: number;
  source: string;
  sourceFilename: string;
  modelUsed: string;
  importedAt: string;
  sets: StrengthResultSet[];
};

export type StrengthImportRow = {
  rowNumber: number;
  athleteId: number | null;
  athleteName: string;
  matchedAthleteName: string;
  team: string;
  trainingDate: string;
  sessionLabel: string;
  trainingCategory: StrengthTrainingCategory;
  bodyPosition: StrengthBodyPosition;
  trainingEnvironment: StrengthTrainingEnvironment;
  exerciseName: string;
  setIndex: number;
  targetReps: number | null;
  actualReps: number | null;
  actualWeightKg: number | null;
  plannedWeightKg: number | null;
  durationMin: number;
  distanceKm: number;
  intensityPercent: number | null;
  intensityZone: StrengthIntensityZone;
  rpe: number | null;
  completed: boolean;
  note: string;
  confidence: number | null;
  originalText: string;
  duplicate: boolean;
  errors: string[];
  warnings: string[];
};

export type StrengthImportPreview = {
  token: string;
  filename: string;
  modelUsed: string;
  total: number;
  valid: number;
  invalid: number;
  duplicate: number;
  rows: StrengthImportRow[];
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
  averageHeartRate?: number | null;
  maxHeartRate?: number | null;
  averagePowerW?: number | null;
  strokeRateSpm?: number | null;
  status: TrainingStatus;
  coachNote: string;
  trainingBreakdown: TrainingBreakdown;
  updatedAt: string;
  updatedBy: string;
};

export type RegistrationRequest = {
  id: number;
  username: string;
  displayName: string;
  requestedRole: 'ATL' | 'SCC';
  project: string | null;
  team: string | null;
  gender: string | null;
  identityNumber: string | null;
  nativePlace: string | null;
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

export type OverviewMeasurement = {
  code: string;
  label: string;
  domain: string;
  value: number | null;
  target: number | null;
  previous: number | null;
  changePct: number | null;
  unit: string;
  quality: 'valid' | 'partial' | 'insufficient' | 'outlier' | 'estimated';
  source: string;
  sampleCount: number;
  isDemo: boolean;
};

export type CompetitiveStateLevel = 'peak' | 'good' | 'build' | 'adjust';

export type OverviewAthleteProfile = {
  athleteId: number;
  athleteName: string;
  project: string;
  team: string;
  gender: string;
  athletePosition: string;
  province: string;
  city: string;
  county: string;
  originSource: string;
  originIsDemo: boolean;
  birthDate: string | null;
  age: number | null;
  bodyMeasurementDate: string | null;
  heightCm: number | null;
  weightKg: number | null;
  previousWeightKg: number | null;
  bodyFatPct: number | null;
  competitiveAssessmentDate: string | null;
  competitiveScore: number | null;
  previousCompetitiveScore: number | null;
  competitiveLevel: CompetitiveStateLevel | null;
  competitiveDimensions: {
    endurance: number | null;
    power: number | null;
    technique: number | null;
    loadAdaptation: number | null;
    recovery: number | null;
    competition: number | null;
  };
  source: string;
  isDemo: boolean;
};

export type OverviewPayload = {
  records: TrainingRecord[];
  strengthTests: StrengthTest[];
  measurements: OverviewMeasurement[];
  profiles: OverviewAthleteProfile[];
  meta: {
    project: string;
    from: string;
    to: string;
    athleteCount: number;
    sessionCount: number;
    wellnessDays: number;
    testCount: number;
    coverage: number;
    containsDemoData: boolean;
    sources: string[];
    scope: 'individual' | 'team';
    generatedAt: string;
  };
};
