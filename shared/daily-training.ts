import type { ProjectCatalogField } from './project-name-catalog.js';

export const DAILY_TRAINING_SHEET = '每日训练';

export type DailyTrainingRecord = {
  id: number;
  setGroupId: number | null;
  date: string;
  projectName: string;
  durationMin: number | null;
  distanceKm: number | null;
  rpe: number | null;
  intensity: number | null;
  intensityUnit: string | null;
  repetitions: number | null;
  sets: number | null;
  pre: number | null;
  fields?: ProjectCatalogField[];
};

export type DailyTrainingAthlete = {
  id: number;
  name: string;
  recordCount: number;
  trainingDays: number;
  durationMin: number | null;
  latestDate: string | null;
};

export type DailyTrainingData = {
  athletes: DailyTrainingAthlete[];
  rows: DailyTrainingRecord[];
  truncated: boolean;
};
