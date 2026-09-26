import {
  AREA_LEVELS,
  AREA_LEVEL_META,
  ROLES,
  ROLE_HIERARCHY,
  ROLE_META,
  canManageRole,
  type AreaLevel,
  type Role,
} from '../../shared/access.ts';
import { PRIMARY_INTENSITY_ZONE_CODES } from '../../shared/training-intensity.ts';
import type { Project } from '../../shared/projects.ts';
export type { Project };
import type {
  StrengthBodyPosition,
  StrengthIntensityZone,
  StrengthTrainingCategory,
  StrengthTrainingEnvironment,
} from '../../shared/strength-training.ts';

export type AuthUser = {
  id: number;
  username: string;
  displayName: string;
  role: Role;
  athleteId: number | null;
};

export type AreaPermission = {
  areaLevel: AreaLevel;
  province: string;
  city: string;
  county: string;
};

export type ScopeAthlete = {
  id: number;
  region: string;
  city: string;
  county: string;
  project: string;
  team: string;
};

export const intensityZones = PRIMARY_INTENSITY_ZONE_CODES;
export type IntensityZoneKey = (typeof intensityZones)[number];
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
  waterDistanceByZone: Record<IntensityZoneKey, number>;
  waterTimeByZone: Record<IntensityZoneKey, number>;
  ergDistanceByZone: Record<IntensityZoneKey, number>;
};

export type TrainingPlanWeekEntry = {
  sets: string;
  reps: string;
  percentage: number | null;
  actualCompleted: string;
  arrangement: string;
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
  category: StrengthTrainingCategory;
  bodyPosition: StrengthBodyPosition;
  targetIntensity: number | null;
  estimatedMinutes: number | null;
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
  weekKeys: string[];
  weekLabels: Record<string, string>;
  sourceType?: 'ai_import' | 'ai_generated';
  summary?: string;
  durationWeeks?: number | null;
  weeklyPlans?: unknown[];
  confidence?: number | null;
  warnings?: string[];
  unmappedContent?: string[];
};

export type SpecialTestImportRow = {
  rowNumber: number;
  testDate: string;
  project: Project | '';
  distanceM: number;
  boatClass: string;
  genderGroup: string;
  crewName: string;
  memberAthleteIds: number[];
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

declare global {
  namespace Express {
    interface Request {
      authUser?: AuthUser;
    }
  }
}
