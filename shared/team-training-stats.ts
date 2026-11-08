export type TeamTrainingWaterGroup = 'water' | 'land';
export type TeamTrainingLessonGroup = 'main' | 'auxiliary';
export type TeamTrainingColumnMapping = {
  category: string;
  unit: string;
  waterGroup?: TeamTrainingWaterGroup;
  lessonGroup?: TeamTrainingLessonGroup;
};

export type TeamTrainingUnknownColumn = { key: string; label: string; unit: string };
export type TeamTrainingImportResult =
  | { status: 'mapping_required'; columns: TeamTrainingUnknownColumn[] }
  | {
      status: 'imported';
      created: number;
      updated: number;
      unchanged: number;
      undatedRows: number;
      latestDate: string | null;
    };

export type TeamTrainingMeasure = {
  category: string;
  unit: string;
  value: number;
  waterGroup: TeamTrainingWaterGroup | null;
  lessonGroup: TeamTrainingLessonGroup | null;
};

export const TEAM_TRAINING_PERIODS = ['week', 'month', 'year'] as const;
export type TeamTrainingPeriod = (typeof TEAM_TRAINING_PERIODS)[number];
export type TeamTrainingBucket = {
  start: string;
  distance: number | null;
  minutes: number | null;
  water: number | null;
  slalomProxy: number | null;
  maxStrength: number | null;
  endurance: number | null;
  explosive: number | null;
  functionalCore: number | null;
};
export type TeamTrainingStatistics = {
  start: string;
  end: string;
  anchorDate: string;
  buckets: TeamTrainingBucket[];
  categories: TeamTrainingMeasure[];
  otherMeasures: (TeamTrainingMeasure & { date: string })[];
};
