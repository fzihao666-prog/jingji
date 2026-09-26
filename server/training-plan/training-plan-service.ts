import ExcelJS from 'exceljs';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import {
  inferStrengthBodyPosition,
  inferStrengthCategory,
  isStrengthBodyPosition,
  isStrengthTrainingCategory,
} from '../../shared/strength-training.ts';
import { STRENGTH_METRICS, type StrengthMetricValues } from '../../shared/strength-model.ts';
import { SLALOM_CHAMPION_METRICS, slalomComparison } from '../../shared/slalom-model.ts';
import { TrainingPlanAIService, type AthleteContext } from './ai-service.ts';
import { db } from '../core/db.ts';
import { athletePhotoRoot } from '../core/uploads.ts';
import {
  intensityZones,
  type IntensityZoneKey,
  type TrainingBreakdown,
  type TrainingPlanData,
  type TrainingPlanExercise,
  type TrainingPlanLine,
  type TrainingPlanWeekEntry,
} from '../core/shared-server.ts';
import { cleanString, numberOrNull, strengthImportNumber } from '../core/utils.ts';

export function toLocalIsoDate(value: Date) {
  const local = new Date(value.getTime() - value.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

export function normalizeOverviewRange(input: { from: string; to: string }) {
  return { from: input.from, to: input.to, period: null };
}

export function optionalNumber(
  value: unknown,
  min: number,
  max: number,
  label: string,
  errors: string[]
) {
  if (value === '' || value === null || value === undefined) return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < min || numeric > max) {
    errors.push(`${label}应在${min}至${max}之间`);
    return null;
  }
  return Math.round(numeric * 10) / 10;
}

export const defaultTrainingPlanWeekKeys = ['1', '2', '3', '4'];

export function trainingPlanWeekKeys(source: Record<string, unknown>) {
  const explicit = Array.isArray(source.weekKeys)
    ? source.weekKeys.map(cleanString).filter(Boolean)
    : [];
  const exercises = Array.isArray(source.exercises) ? source.exercises : [];
  const firstExercise = exercises.find(
    (value) => value && typeof value === 'object' && !Array.isArray(value)
  ) as Record<string, unknown> | undefined;
  const lines = Array.isArray(firstExercise?.lines) ? firstExercise.lines : [];
  const firstLine = lines.find(
    (value) => value && typeof value === 'object' && !Array.isArray(value)
  ) as Record<string, unknown> | undefined;
  const weeks =
    firstLine?.weeks && typeof firstLine.weeks === 'object' && !Array.isArray(firstLine.weeks)
      ? Object.keys(firstLine.weeks as Record<string, unknown>)
      : [];
  const sourceKeys = explicit.length
    ? explicit
    : weeks.length
      ? weeks
      : defaultTrainingPlanWeekKeys;
  return [...new Set(sourceKeys.map((key) => key.slice(0, 20)))].slice(0, 52);
}

export function parseTrainingPlanData(input: unknown) {
  const source =
    input && typeof input === 'object' && !Array.isArray(input)
      ? (input as Record<string, unknown>)
      : {};
  const errors: string[] = [];
  const startDate = cleanString(source.startDate || source.planDate);
  const endDate =
    cleanString(source.endDate) ||
    (() => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) return '';
      const date = new Date(`${startDate}T12:00:00Z`);
      date.setUTCDate(date.getUTCDate() + 30);
      return date.toISOString().slice(0, 10);
    })();
  const title = cleanString(source.title);
  const scheduleLabel = cleanString(source.scheduleLabel);
  const sourceType =
    source.sourceType === 'ai_import' || source.sourceType === 'ai_generated'
      ? source.sourceType
      : undefined;
  const isAIPlan = Boolean(sourceType);
  const weekKeys = trainingPlanWeekKeys(source);
  const rawWeekLabels =
    source.weekLabels && typeof source.weekLabels === 'object' && !Array.isArray(source.weekLabels)
      ? (source.weekLabels as Record<string, unknown>)
      : {};
  const weekLabels = Object.fromEntries(
    weekKeys.map((key, index) => [
      key,
      cleanString(rawWeekLabels[key]).slice(0, 60) || `WEEK ${index + 1}`,
    ])
  );
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
    errors.push('请选择有效的开始日期和结束日期');
  } else {
    const days =
      Math.round(
        (Date.parse(`${endDate}T12:00:00Z`) - Date.parse(`${startDate}T12:00:00Z`)) / 86400000
      ) + 1;
    if (isAIPlan ? days < 1 || days > 730 : days < 28 || days > 31) {
      errors.push(
        isAIPlan
          ? 'AI体能训练起止日期应覆盖1至730天'
          : '体能训练须按一个月设置，起止日期应覆盖28至31天'
      );
    }
  }
  if (!title || title.length > (isAIPlan ? 80 : 60))
    errors.push(`训练名称应为1至${isAIPlan ? 80 : 60}个字符`);
  if ((!scheduleLabel && !isAIPlan) || scheduleLabel.length > 80)
    errors.push(`训练日安排应为${isAIPlan ? '0至80' : '1至80'}个字符`);
  if (!weekKeys.length) errors.push('至少需要一个训练阶段');

  const rawExercises = Array.isArray(source.exercises) ? source.exercises : [];
  if (!rawExercises.length) errors.push('至少添加一个训练项目');
  const exerciseLimit = isAIPlan ? 40 : 20;
  if (rawExercises.length > exerciseLimit) errors.push(`训练项目最多${exerciseLimit}项`);
  let totalLines = 0;
  const exercises: TrainingPlanExercise[] = rawExercises
    .slice(0, exerciseLimit)
    .map((rawExercise, exerciseIndex) => {
      const exercise =
        rawExercise && typeof rawExercise === 'object' && !Array.isArray(rawExercise)
          ? (rawExercise as Record<string, unknown>)
          : {};
      const name = cleanString(exercise.name);
      const unitNote = cleanString(exercise.unitNote);
      const category = isStrengthTrainingCategory(exercise.category)
        ? exercise.category
        : inferStrengthCategory(name);
      const bodyPosition = isStrengthBodyPosition(exercise.bodyPosition)
        ? exercise.bodyPosition
        : inferStrengthBodyPosition(name);
      if (name.length > 60) errors.push(`第${exerciseIndex + 1}项训练名称不能超过60个字符`);
      if (unitNote.length > 20) errors.push(`第${exerciseIndex + 1}项备注不能超过20个字符`);
      const rawLines = Array.isArray(exercise.lines) ? exercise.lines : [];
      if (!rawLines.length) errors.push(`第${exerciseIndex + 1}项至少需要一行处方`);
      const lineLimit = isAIPlan ? 20 : 8;
      if (rawLines.length > lineLimit)
        errors.push(`第${exerciseIndex + 1}项处方最多${lineLimit}行`);
      totalLines += rawLines.length;
      const lines: TrainingPlanLine[] = rawLines.slice(0, lineLimit).map((rawLine, lineIndex) => {
        const line =
          rawLine && typeof rawLine === 'object' && !Array.isArray(rawLine)
            ? (rawLine as Record<string, unknown>)
            : {};
        const rawWeeks =
          line.weeks && typeof line.weeks === 'object' && !Array.isArray(line.weeks)
            ? (line.weeks as Record<string, unknown>)
            : {};
        const weeks = {} as TrainingPlanLine['weeks'];
        for (const weekKey of weekKeys) {
          const rawWeek =
            rawWeeks[weekKey] &&
            typeof rawWeeks[weekKey] === 'object' &&
            !Array.isArray(rawWeeks[weekKey])
              ? (rawWeeks[weekKey] as Record<string, unknown>)
              : {};
          const sets = cleanString(rawWeek.sets);
          const reps = cleanString(rawWeek.reps);
          const actualCompleted = cleanString(rawWeek.actualCompleted);
          const arrangement = cleanString(rawWeek.arrangement);
          if (sets.length > 12 || reps.length > 20 || actualCompleted.length > 30) {
            errors.push(`第${exerciseIndex + 1}项第${lineIndex + 1}行第${weekKey}周输入过长`);
          }
          if (arrangement.length > 500)
            errors.push(
              `第${exerciseIndex + 1}项第${lineIndex + 1}行第${weekKey}周安排不能超过500个字符`
            );
          weeks[weekKey] = {
            sets,
            reps,
            percentage: optionalNumber(rawWeek.percentage, 0, 100, '训练百分比', errors),
            actualCompleted,
            arrangement,
          };
        }
        return {
          id: cleanString(line.id).slice(0, 50) || randomUUID(),
          weeks,
        };
      });
      const maxWeight = optionalNumber(exercise.maxWeight, 0, 1000, 'MAX重量', errors);
      return {
        id: cleanString(exercise.id).slice(0, 50) || randomUUID(),
        name,
        maxWeight,
        unitNote,
        category,
        bodyPosition,
        targetIntensity: optionalNumber(exercise.targetIntensity, 0, 100, '目标强度', errors),
        estimatedMinutes: optionalNumber(exercise.estimatedMinutes, 0, 600, '预计时间', errors),
        lines,
      };
    });
  if (!exercises.some((exercise) => exercise.name)) errors.push('至少填写一个训练项目名称');
  if (totalLines > (isAIPlan ? 200 : 30))
    errors.push(isAIPlan ? 'AI体能训练最多容纳200行训练处方' : '导出模板最多容纳30行训练处方');

  const data: TrainingPlanData = {
    startDate,
    endDate,
    title,
    scheduleLabel,
    bodyWeight: optionalNumber(source.bodyWeight, 0, 400, '体重', errors),
    age: optionalNumber(source.age, 8, 80, '年龄', errors),
    exercises,
    weekKeys,
    weekLabels,
    ...(sourceType
      ? {
          sourceType,
          summary: cleanString(source.summary).slice(0, 1000),
          durationWeeks: optionalNumber(source.durationWeeks, 0, 52, '训练阶段数', errors),
          weeklyPlans: Array.isArray(source.weeklyPlans) ? source.weeklyPlans : [],
          confidence: optionalNumber(source.confidence, 0, 1, '识别置信度', errors),
          warnings: Array.isArray(source.warnings)
            ? source.warnings.map(cleanString).filter(Boolean).slice(0, 50)
            : [],
          unmappedContent: Array.isArray(source.unmappedContent)
            ? source.unmappedContent.map(cleanString).filter(Boolean).slice(0, 100)
            : [],
        }
      : {}),
  };
  return { data, errors: [...new Set(errors)] };
}

export function planRecord(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function emptyMatrixWeek(): TrainingPlanWeekEntry {
  return { sets: '', reps: '', percentage: null, actualCompleted: '', arrangement: '' };
}

export function aiPercentage(value: unknown) {
  if (value === '' || value === null || value === undefined) return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 0 && numeric <= 100
    ? Math.round(numeric * 10) / 10
    : null;
}

export function recentTrainingPlanMaxWeights(athleteId: number) {
  const rows = db
    .prepare(
      `
    SELECT plan_data AS dataJson FROM training_plans
    WHERE athlete_id = ? ORDER BY start_date DESC, id DESC LIMIT 12
  `
    )
    .all(athleteId) as Array<{ dataJson: string }>;
  const maxWeights = new Map<string, number>();
  for (const row of rows) {
    try {
      const stored = planRecord(JSON.parse(row.dataJson));
      const exercises = Array.isArray(stored.exercises) ? stored.exercises : [];
      for (const exerciseValue of exercises) {
        const exercise = planRecord(exerciseValue);
        const name = cleanString(exercise.name);
        const maxWeight = Number(exercise.maxWeight);
        if (
          name &&
          Number.isFinite(maxWeight) &&
          maxWeight >= 0 &&
          !maxWeights.has(name.toLocaleLowerCase())
        ) {
          maxWeights.set(name.toLocaleLowerCase(), maxWeight);
        }
      }
    } catch {}
  }
  return maxWeights;
}

export function normalizeAIPlanToMatrix(planValue: unknown, athleteId?: number) {
  const plan = planRecord(planValue);
  const sourceType = plan.sourceType === 'ai_import' ? 'ai_import' : 'ai_generated';
  const sourceWeeks = Array.isArray(plan.weeklyPlans) ? plan.weeklyPlans.map(planRecord) : [];
  const weekKeys = sourceWeeks.map((_week, index) => String(index + 1));
  const weekLabels = Object.fromEntries(
    sourceWeeks.map((week, index) => {
      const weekNumber = Number(week.weekNumber);
      const label = cleanString(week.label);
      return [
        weekKeys[index],
        label ||
          (Number.isFinite(weekNumber) && weekNumber > 0
            ? `WEEK ${weekNumber}`
            : `阶段 ${index + 1}`),
      ];
    })
  );
  const configuredMax = new Map<string, number>();
  for (const exerciseValue of Array.isArray(plan.exercises) ? plan.exercises : []) {
    const exercise = planRecord(exerciseValue);
    const name = cleanString(exercise.name);
    const maxWeight = Number(exercise.maxWeight);
    if (name && Number.isFinite(maxWeight) && maxWeight >= 0)
      configuredMax.set(name.toLocaleLowerCase(), maxWeight);
  }
  const recentMax = athleteId ? recentTrainingPlanMaxWeights(athleteId) : new Map<string, number>();
  const exerciseMap = new Map<string, TrainingPlanExercise>();

  sourceWeeks.forEach((week, weekIndex) => {
    const weekKey = weekKeys[weekIndex];
    const occurrenceByExercise = new Map<string, number>();
    const days = Array.isArray(week.days) ? week.days.map(planRecord) : [];
    for (const day of days) {
      const dayLabel =
        sourceType === 'ai_import'
          ? [cleanString(day.date), cleanString(day.dayLabel)].filter(Boolean).join(' ')
          : cleanString(day.dayOfWeek);
      const dayFocus = cleanString(day.focus);
      const items =
        sourceType === 'ai_import'
          ? Array.isArray(day.items)
            ? day.items.map(planRecord)
            : []
          : Array.isArray(day.exercises)
            ? day.exercises.map(planRecord)
            : [];
      for (const item of items) {
        const name = cleanString(item.name);
        if (!name) continue;
        const normalizedName = name.toLocaleLowerCase();
        const occurrence = occurrenceByExercise.get(normalizedName) || 0;
        occurrenceByExercise.set(normalizedName, occurrence + 1);
        let exercise = exerciseMap.get(normalizedName);
        if (!exercise) {
          exercise = {
            id: randomUUID(),
            name,
            maxWeight: configuredMax.get(normalizedName) ?? recentMax.get(normalizedName) ?? null,
            unitNote: '',
            category: inferStrengthCategory(name),
            bodyPosition: inferStrengthBodyPosition(name),
            targetIntensity: aiPercentage(item.percentage),
            estimatedMinutes: strengthImportNumber(item.duration),
            lines: [],
          };
          exerciseMap.set(normalizedName, exercise);
        }
        while (exercise.lines.length <= occurrence) {
          exercise.lines.push({
            id: randomUUID(),
            weeks: Object.fromEntries(weekKeys.map((key) => [key, emptyMatrixWeek()])),
          });
        }
        const detailParts = [
          dayLabel,
          dayFocus,
          cleanString(item.load) && `负荷 ${cleanString(item.load)}`,
          cleanString(item.duration) && `时长 ${cleanString(item.duration)}`,
          cleanString(item.distance) && `距离 ${cleanString(item.distance)}`,
          cleanString(item.intensity) && `强度区间 ${cleanString(item.intensity)}`,
          cleanString(item.pace) && `配速 ${cleanString(item.pace)}`,
          cleanString(item.notes),
          sourceType === 'ai_import' && cleanString(item.rawText) !== name
            ? cleanString(item.rawText)
            : '',
        ].filter((part): part is string => Boolean(part));
        exercise.lines[occurrence].weeks[weekKey] = {
          sets: cleanString(item.sets),
          reps: cleanString(item.reps),
          percentage: aiPercentage(item.percentage),
          actualCompleted: '',
          arrangement: [...new Set(detailParts)].join(' · ').slice(0, 500),
        };
      }
    }
  });

  return {
    ...plan,
    sourceType,
    weekKeys,
    weekLabels,
    exercises: [...exerciseMap.values()],
  };
}

export function readStoredTrainingPlanData(dataJson: string): unknown {
  const raw = JSON.parse(dataJson || '{}') as Record<string, unknown>;
  if (
    raw.sourceType === 'ai_import' ||
    raw.sourceType === 'ai_generated' ||
    Array.isArray(raw.weeklyPlans)
  ) {
    const exercises = Array.isArray(raw.exercises) ? raw.exercises.map(planRecord) : [];
    const hasMatrixLines = exercises.some((exercise) => Array.isArray(exercise.lines));
    return parseTrainingPlanData(hasMatrixLines ? raw : normalizeAIPlanToMatrix(raw)).data;
  }
  return parseTrainingPlanData(raw).data;
}

export function excelCellText(cell: ExcelJS.Cell) {
  const value = cell.value;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (value && typeof value === 'object' && 'result' in value) {
    const result = (value as { result?: unknown }).result;
    if (result instanceof Date) return result.toISOString().slice(0, 10);
    return cleanString(result);
  }
  return cell.text.trim();
}

export function excelNumberOrText(value: string) {
  const trimmed = value.trim();
  if (/^\d+(?:\.\d+)?$/.test(trimmed)) return Number(trimmed);
  return trimmed || null;
}

export async function buildTrainingPlanWorkbook(input: {
  athleteName: string;
  project: string;
  team: string;
  photoUrl: string;
  data: TrainingPlanData;
}) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = '竞迹训练数据中心';
  workbook.created = new Date();
  workbook.modified = new Date();
  workbook.calcProperties.fullCalcOnLoad = true;
  const sheet = workbook.addWorksheet('个人体能训练', {
    pageSetup: {
      paperSize: 9,
      orientation: 'landscape',
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 1,
      margins: { left: 0.2, right: 0.2, top: 0.25, bottom: 0.25, header: 0.1, footer: 0.1 },
    },
    views: [{ state: 'frozen', xSplit: 2, ySplit: 6, topLeftCell: 'C7' }],
  });
  const widths = [9, 18];
  for (let week = 0; week < 4; week += 1) widths.push(5.5, 3.5, 7, 7, 8.5, 12);
  widths.forEach((width, index) => {
    sheet.getColumn(index + 1).width = width;
  });
  sheet.properties.defaultRowHeight = 22;
  sheet.getRow(1).height = 25;
  sheet.getRow(2).height = 25;
  sheet.getRow(3).height = 25;
  sheet.getRow(4).height = 30;
  sheet.getRow(5).height = 28;
  sheet.getRow(6).height = 24;

  const allBorder: Partial<ExcelJS.Borders> = {
    top: { style: 'thin', color: { argb: 'FF162832' } },
    left: { style: 'thin', color: { argb: 'FF162832' } },
    bottom: { style: 'thin', color: { argb: 'FF162832' } },
    right: { style: 'thin', color: { argb: 'FF162832' } },
  };
  const center: Partial<ExcelJS.Alignment> = {
    horizontal: 'center',
    vertical: 'middle',
    wrapText: true,
  };
  const ink = 'FF0B3442';
  const blue = 'FF9DC2E0';
  const blueBody = 'FFDCEBF6';
  const amber = 'FFFFD977';
  const amberBody = 'FFFFF0BD';
  const maxFill = 'FFFFC20A';

  for (let row = 1; row <= 36; row += 1) {
    for (let column = 1; column <= 26; column += 1) {
      const cell = sheet.getCell(row, column);
      cell.font = {
        name: 'Microsoft YaHei UI',
        size: row <= 6 ? 10.5 : 10,
        color: { argb: 'FF122832' },
      };
      cell.alignment = center;
      cell.border = allBorder;
    }
  }

  sheet.mergeCells('A1:B3');
  const photoCell = sheet.getCell('A1');
  photoCell.value = '证件照\n未上传';
  photoCell.font = {
    name: 'Microsoft YaHei UI',
    size: 10,
    bold: true,
    color: { argb: 'FF6E7F87' },
  };
  photoCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F4F5' } };

  const labelValue = (
    labelRange: string,
    valueRange: string,
    label: string,
    value: string | number | null
  ) => {
    sheet.mergeCells(labelRange);
    sheet.mergeCells(valueRange);
    const labelCell = sheet.getCell(labelRange.split(':')[0]);
    const valueCell = sheet.getCell(valueRange.split(':')[0]);
    labelCell.value = label;
    labelCell.font = {
      name: 'Microsoft YaHei UI',
      size: 10,
      italic: true,
      bold: true,
      color: { argb: ink },
    };
    valueCell.value = value ?? '';
    valueCell.font = {
      name: 'Microsoft YaHei UI',
      size: 11,
      bold: true,
      color: { argb: 'FF081F29' },
    };
  };
  const periodLabel = `${input.data.startDate.replaceAll('-', '.')}—${input.data.endDate.slice(5).replace('-', '.')}`;
  labelValue('C1:D1', 'E1:J1', '周期', periodLabel);
  sheet.getCell('E1').font = {
    name: 'Bahnschrift',
    size: 8.5,
    bold: true,
    color: { argb: 'FF081F29' },
  };
  labelValue('K1:L1', 'M1:N1', '年龄', input.data.age);
  labelValue(
    'O1:P1',
    'Q1:R1',
    '体重',
    input.data.bodyWeight === null ? '' : `${input.data.bodyWeight} kg`
  );
  labelValue('C2:D2', 'E2:J2', '姓名', input.athleteName);
  labelValue('K2:L2', 'M2:R2', '项目 / 组别', `${input.project} · ${input.team}`);
  const exerciseNames = input.data.exercises
    .map((exercise) =>
      exercise.name
        .trim()
        .replace(/\s*\r?\n\s*/g, ' / ')
        .replace(/\s{2,}/g, ' ')
    )
    .filter(Boolean)
    .slice(0, 8);
  labelValue('C3:D3', 'E3:F3', '项目数', `${exerciseNames.length} / 8`);
  sheet.mergeCells('G3:R3');
  const exerciseNamesCell = sheet.getCell('G3');
  exerciseNamesCell.value = exerciseNames.join(' ｜ ');
  exerciseNamesCell.font = {
    name: 'Microsoft YaHei UI',
    size: 9.5,
    bold: true,
    color: { argb: ink },
  };
  exerciseNamesCell.alignment = center;
  sheet.mergeCells('S1:Z3');
  sheet.getCell('S1').value = input.data.title;
  sheet.getCell('S1').font = {
    name: 'Microsoft YaHei UI',
    size: 15,
    bold: true,
    color: { argb: 'FFE53B2F' },
  };
  sheet.getCell('S1').alignment = center;

  if (input.photoUrl) {
    const photoName = basename(input.photoUrl);
    const photoPath = resolve(athletePhotoRoot, photoName);
    if (existsSync(photoPath)) {
      const extension = photoName.toLowerCase().endsWith('.png') ? 'png' : 'jpeg';
      const imageId = workbook.addImage({ filename: photoPath, extension });
      sheet.addImage(imageId, {
        tl: { col: 0.08, row: 0.08 },
        br: { col: 1.92, row: 2.92 },
        editAs: 'oneCell',
      } as never);
      photoCell.value = '';
    }
  }

  sheet.mergeCells('A4:Z4');
  sheet.getCell('A4').value = input.data.scheduleLabel;
  sheet.getCell('A4').font = {
    name: 'Microsoft YaHei UI',
    size: 15,
    bold: true,
    italic: true,
    color: { argb: 'FF102A35' },
  };
  sheet.getCell('A4').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: maxFill } };

  sheet.mergeCells('A5:A6');
  sheet.mergeCells('B5:B6');
  sheet.getCell('A5').value = 'MAX';
  sheet.getCell('B5').value = '项目';
  for (const coordinate of ['A5', 'B5']) {
    sheet.getCell(coordinate).font = {
      name: 'Microsoft YaHei UI',
      size: 11,
      bold: true,
      italic: true,
      color: { argb: 'FF081F29' },
    };
    sheet.getCell(coordinate).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: maxFill },
    };
  }
  const weekStarts = [3, 9, 15, 21];
  const subHeaders = ['组', '×', '次', '%', '重量', '完成次数'];
  weekStarts.forEach((start, weekIndex) => {
    sheet.mergeCells(5, start, 5, start + 5);
    const header = sheet.getCell(5, start);
    header.value = `WEEK ${weekIndex + 1}`;
    header.font = {
      name: 'Bahnschrift',
      size: 12,
      bold: true,
      italic: true,
      color: { argb: 'FF0B2530' },
    };
    header.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: weekIndex % 2 === 0 ? blue : amber },
    };
    subHeaders.forEach((label, offset) => {
      const cell = sheet.getCell(6, start + offset);
      cell.value = label;
      cell.font = { name: 'Microsoft YaHei UI', size: 10, bold: true, color: { argb: 'FF0B2530' } };
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: weekIndex % 2 === 0 ? blue : amber },
      };
    });
  });

  let rowCursor = 7;
  for (const exercise of input.data.exercises) {
    const startRow = rowCursor;
    const lineCount = Math.max(1, exercise.lines.length);
    const endRow = startRow + lineCount - 1;
    if (endRow > 36) break;
    if (lineCount > 1) {
      sheet.mergeCells(startRow, 1, endRow, 1);
      sheet.mergeCells(startRow, 2, endRow, 2);
    }
    const maxCell = sheet.getCell(startRow, 1);
    maxCell.value = exercise.maxWeight;
    maxCell.numFmt = '0.0';
    maxCell.font = { name: 'Bahnschrift', size: 12, bold: true, color: { argb: 'FF0B2530' } };
    maxCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: maxFill } };
    const itemCell = sheet.getCell(startRow, 2);
    itemCell.value = exercise.name;
    itemCell.font = {
      name: 'Microsoft YaHei UI',
      size: 11,
      bold: true,
      color: { argb: 'FF102A35' },
    };

    exercise.lines.forEach((line, lineOffset) => {
      const rowNumber = startRow + lineOffset;
      sheet.getRow(rowNumber).height = 25;
      weekStarts.forEach((columnStart, weekIndex) => {
        const week = line.weeks[String(weekIndex + 1) as '1' | '2' | '3' | '4'];
        const bodyFill = weekIndex % 2 === 0 ? blueBody : amberBody;
        for (let offset = 0; offset < 6; offset += 1) {
          sheet.getCell(rowNumber, columnStart + offset).fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: bodyFill },
          };
        }
        sheet.getCell(rowNumber, columnStart).value = excelNumberOrText(week.sets);
        sheet.getCell(rowNumber, columnStart + 1).value =
          week.sets || week.reps || week.percentage !== null ? '×' : '';
        sheet.getCell(rowNumber, columnStart + 2).value = excelNumberOrText(week.reps);
        const percentageCell = sheet.getCell(rowNumber, columnStart + 3);
        percentageCell.value = week.percentage === null ? null : week.percentage / 100;
        percentageCell.numFmt = '0.0%';
        const weightCell = sheet.getCell(rowNumber, columnStart + 4);
        const percentageCoordinate = percentageCell.address;
        const calculated =
          exercise.maxWeight !== null && week.percentage !== null
            ? Math.round(exercise.maxWeight * week.percentage) / 100
            : 0;
        weightCell.value = {
          formula: `IF(OR($A$${startRow}="",${percentageCoordinate}=""),"",ROUND($A$${startRow}*${percentageCoordinate},1))`,
          result: calculated || undefined,
        };
        weightCell.numFmt = '0.0';
        weightCell.font = {
          name: 'Bahnschrift',
          size: 10,
          bold: true,
          color: { argb: 'FFE64132' },
        };
        sheet.getCell(rowNumber, columnStart + 5).value = excelNumberOrText(week.actualCompleted);
        sheet.getCell(rowNumber, columnStart + 5).font = {
          name: 'Microsoft YaHei UI',
          size: 9.5,
          bold: Boolean(week.actualCompleted),
          color: { argb: 'FF14706D' },
        };
      });
    });
    rowCursor = endRow + 1;
  }

  for (let row = rowCursor; row <= 36; row += 1) sheet.getRow(row).hidden = true;
  sheet.pageSetup.printArea = `A1:Z${Math.max(7, rowCursor - 1)}`;
  sheet.headerFooter.oddFooter = '&L竞迹训练数据中心&C第 &P / &N 页&R' + input.athleteName;
  return workbook;
}

export function getAthleteContext(athleteId: number): AthleteContext {
  // 获取运动员基本信息
  const athlete = db
    .prepare(
      `
    SELECT id, name, project, team, gender, region
    FROM athletes WHERE id = ?
  `
    )
    .get(athleteId) as {
    id: number;
    name: string;
    project: string;
    team: string;
    gender: string;
    region: string;
  };

  // 获取最近6个月的体能训练
  const recentPlans = db
    .prepare(
      `
    SELECT plan_date as date, plan_data as dataJson
    FROM training_plans
    WHERE athlete_id = ? AND plan_date >= date('now', '-6 months')
    ORDER BY plan_date DESC
    LIMIT 3
  `
    )
    .all(athleteId) as Array<{ date: string; dataJson: string }>;

  const parsedPlans = recentPlans
    .map((plan) => {
      try {
        const data = JSON.parse(plan.dataJson);
        return {
          date: plan.date,
          duration: data.durationWeeks || 4,
          title: data.title || '',
          exercises: data.exercises?.map((e: { name: string }) => e.name) || [],
          maxWeights:
            data.exercises?.reduce(
              (acc: Record<string, number>, e: { name: string; maxWeight: number | null }) => {
                if (e.maxWeight) acc[e.name] = e.maxWeight;
                return acc;
              },
              {} as Record<string, number>
            ) || {},
        };
      } catch {
        return null;
      }
    })
    .filter(Boolean);

  // 训练与恢复分别来自权威表，按训练课次返回；恢复状态按日期关联。
  const recentRecords = db
    .prepare(
      `
    SELECT ts.session_date AS date, ts.training_type AS trainingType, ts.duration_min AS durationMin, ts.rpe,
      dw.fatigue_index AS fatigueIndex, COALESCE(dw.status, 'missing') AS status
    FROM training_sessions ts
    LEFT JOIN daily_wellness dw ON dw.athlete_id = ts.athlete_id AND dw.wellness_date = ts.session_date
    WHERE ts.athlete_id = ? AND ts.session_date >= date('now', '-28 days')
    ORDER BY ts.session_date DESC, ts.session_order DESC
  `
    )
    .all(athleteId) as Array<{
    date: string;
    trainingType: string;
    durationMin: number;
    rpe: number | null;
    fatigueIndex: number | null;
    status: string;
  }>;

  // 力量测试聚合自测试事件与指标明细，不再读取旧 JSON 宽字段。
  const strengthTests = db
    .prepare(
      `
    SELECT ts.id, ts.test_date AS date
    FROM test_sessions ts
    WHERE ts.athlete_id = ? AND ts.test_type = '力量素质测试'
    ORDER BY ts.test_date DESC, ts.id DESC
    LIMIT 3
  `
    )
    .all(athleteId) as Array<{ id: number; date: string }>;

  const parsedTests = strengthTests.map((test) => ({
    date: test.date,
    metrics: Object.fromEntries(
      (
        db
          .prepare(
            `SELECT metric_code AS code, value_num AS value FROM test_measurements WHERE test_session_id = ?`
          )
          .all(test.id) as Array<{ code: string; value: number }>
      ).map((item) => [item.code, item.value])
    ),
  }));

  return {
    athlete,
    recentPlans: parsedPlans as AthleteContext['recentPlans'],
    recentRecords,
    strengthTests: parsedTests as AthleteContext['strengthTests'],
  };
}
