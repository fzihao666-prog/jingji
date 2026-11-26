export const DAILY_TRAINING_SHEET = '每日训练';

export type DailyTrainingRecord = {
  id: number;
  date: string;
  projectName: string;
  durationMin: number | null;
  intensity: number | null;
  intensityUnit: string | null;
  repetitions: number | null;
  sets: number | null;
  pre: number | null;
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
