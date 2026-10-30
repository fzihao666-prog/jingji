import { PRIMARY_INTENSITY_ZONE_CODES } from './training-intensity.js';

/** 沿用训练总览现有配色，提取为共享常量，不改变网页显示。 */
export const TRAINING_ANALYSIS_PALETTE = [
  '#0b7f7a',
  '#25aa9d',
  '#73c5ab',
  '#edaa32',
  '#df634d',
  '#66758a',
  '#8b6eb0',
  '#3d7db7',
  '#9a7f66',
] as const;
export const TRAINING_INTENSITY_COLORS: Readonly<Record<string, string>> = Object.freeze(
  Object.fromEntries(
    PRIMARY_INTENSITY_ZONE_CODES.map((zone, index) => [zone, TRAINING_ANALYSIS_PALETTE[index]!])
  )
);
