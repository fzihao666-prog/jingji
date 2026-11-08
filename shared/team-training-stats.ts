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
    };

export type TeamTrainingMeasure = {
  category: string;
  unit: string;
  value: number;
  waterGroup: TeamTrainingWaterGroup | null;
  lessonGroup: TeamTrainingLessonGroup | null;
};

export type TeamTrainingDay = { date: string; minutes: number | null; distance: number | null };
export type TeamTrainingWeek = {
  start: string;
  minutes: number | null;
  water: number | null;
  slalomProxy: number | null;
  maxStrength: number | null;
  endurance: number | null;
  explosive: number | null;
  functionalCore: number | null;
};
export type TeamTrainingStatistics = {
  weekStart: string;
  weekEnd: string;
  weekYear: number;
  daily: TeamTrainingDay[];
  categories: TeamTrainingMeasure[];
  otherMeasures: (TeamTrainingMeasure & { date: string })[];
  weekly: TeamTrainingWeek[];
};
