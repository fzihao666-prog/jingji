import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { PROJECTS } from '../../shared/projects.ts';
import {
  inferStrengthBodyPosition,
  inferStrengthCategory,
  isStrengthBodyPosition,
  isStrengthIntensityZone,
  isStrengthTrainingCategory,
  isStrengthTrainingEnvironment,
} from '../../shared/strength-training.ts';
import { db, upsertAthleteOrigin } from '../core/db.ts';
import {
  accountPermissions,
  canManageAccount,
  hasAthleteAccess,
  permissionsAllowAthlete,
  permissionsAllowProjectTeam,
} from '../core/permissions.ts';
import type { AreaPermission, AuthUser, ScopeAthlete } from '../core/shared-server.ts';
import {
  birthDateFromIdentityNumber,
  cleanString,
  userById,
  validatePersonName,
} from '../core/utils.ts';

export const athleteHealthStatuses = new Set(['健康', '观察', '训练受限', '康复中']);
export const athleteTrainingStatuses = new Set(['在训', '集训', '休整', '离队']);

export function readAthleteAdminPayload(body: Record<string, unknown>) {
  return {
    name: cleanString(body.name),
    project: cleanString(body.project),
    team: cleanString(body.team),
    gender: cleanString(body.gender),
    region: cleanString(body.region) || '未设置',
    city: cleanString(body.city) || '未设置',
    county: cleanString(body.county) || '未设置',
    birthDate: cleanString(body.birthDate),
    identityNumber: cleanString(body.identityNumber).toUpperCase(),
    ethnicity: cleanString(body.ethnicity) || '汉族',
    phone: cleanString(body.phone),
    bloodType: cleanString(body.bloodType),
    emergencyContact: cleanString(body.emergencyContact),
    emergencyPhone: cleanString(body.emergencyPhone),
    education: cleanString(body.education),
    technicalLevel: cleanString(body.technicalLevel),
    athletePosition: cleanString(body.athletePosition),
    healthStatus: cleanString(body.healthStatus) || '健康',
    bestResult: cleanString(body.bestResult),
    nativePlace: cleanString(body.nativePlace),
    homeAddress: cleanString(body.homeAddress),
    athleteStatus: cleanString(body.athleteStatus) || '在训',
    startSportDate: cleanString(body.startSportDate),
    trainingVenue: cleanString(body.trainingVenue),
    currentEvent: cleanString(body.currentEvent),
    trainingPhase: cleanString(body.trainingPhase),
    campPeriod: cleanString(body.campPeriod),
    originPlace: cleanString(body.originPlace),
    originUnit: cleanString(body.originUnit),
    originCoach: cleanString(body.originCoach),
    specialties: cleanString(body.specialties),
    notes: cleanString(body.notes),
    coachId: Number(body.coachId) || 0,
  };
}

export function athletePayloadErrors(payload: ReturnType<typeof readAthleteAdminPayload>) {
  const errors: string[] = [];
  const nameResult = validatePersonName(payload.name);
  if (nameResult.error) errors.push(nameResult.error);
  if (!PROJECTS.includes(payload.project)) errors.push('请选择有效的运动项目');
  if (
    !db
      .prepare('SELECT id FROM project_teams WHERE project = ? AND name = ? AND active = 1')
      .get(payload.project, payload.team)
  )
    errors.push('请选择有效的所属队伍');
  if (payload.gender && !['男', '女'].includes(payload.gender))
    errors.push('运动员性别应为男、女或暂不填写');
  if (payload.identityNumber && !/^\d{17}[\dX]$/.test(payload.identityNumber))
    errors.push('身份证号格式不正确');
  if (payload.phone && !/^1\d{10}$/.test(payload.phone)) errors.push('手机号须为11位');
  if (payload.emergencyPhone && !/^1\d{10}$/.test(payload.emergencyPhone))
    errors.push('紧急联系电话须为11位');
  if (!athleteHealthStatuses.has(payload.healthStatus)) errors.push('请选择有效的身体状态');
  if (!athleteTrainingStatuses.has(payload.athleteStatus)) errors.push('请选择有效的运动员状态');
  return errors;
}

export function athleteProfileComplete(payload: ReturnType<typeof readAthleteAdminPayload>) {
  return (
    ['男', '女'].includes(payload.gender) &&
    [payload.region, payload.city, payload.county].every((value) => value && value !== '未设置')
  );
}

export function athleteScopeError(
  user: AuthUser,
  payload: ReturnType<typeof readAthleteAdminPayload>
) {
  const permissions = accountPermissions(user.id);
  if (!permissionsAllowProjectTeam(permissions, payload.project, payload.team))
    return '运动员项目或队伍不能超出当前账号权限';
  if ([payload.region, payload.city, payload.county].some((value) => !value || value === '未设置'))
    return '';
  const athlete: ScopeAthlete = {
    id: 0,
    project: payload.project,
    team: payload.team,
    region: payload.region,
    city: payload.city,
    county: payload.county,
  };
  return permissionsAllowAthlete(permissions, athlete) ? '' : '运动员地区不能超出当前账号权限';
}

export function upsertAthleteProfile(
  athleteId: number,
  payload: ReturnType<typeof readAthleteAdminPayload>
) {
  db.prepare(
    `
    INSERT INTO athlete_profiles (
      athlete_id, identity_number, ethnicity, phone, blood_type, emergency_contact, emergency_phone,
      education, technical_level, position, health_status, best_result, native_place, home_address, athlete_status,
      start_sport_date, training_venue, current_event, training_phase, camp_period, origin_place,
      origin_unit, origin_coach, specialties, notes, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(athlete_id) DO UPDATE SET
      identity_number = excluded.identity_number, ethnicity = excluded.ethnicity, phone = excluded.phone,
      blood_type = excluded.blood_type, emergency_contact = excluded.emergency_contact,
      emergency_phone = excluded.emergency_phone, education = excluded.education,
      technical_level = excluded.technical_level, position = excluded.position, health_status = excluded.health_status,
      best_result = excluded.best_result, native_place = excluded.native_place,
      home_address = excluded.home_address, athlete_status = excluded.athlete_status,
      start_sport_date = excluded.start_sport_date, training_venue = excluded.training_venue,
      current_event = excluded.current_event, training_phase = excluded.training_phase,
      camp_period = excluded.camp_period, origin_place = excluded.origin_place,
      origin_unit = excluded.origin_unit, origin_coach = excluded.origin_coach,
      specialties = excluded.specialties, notes = excluded.notes, updated_at = CURRENT_TIMESTAMP
  `
  ).run(
    athleteId,
    payload.identityNumber,
    payload.ethnicity,
    payload.phone,
    payload.bloodType,
    payload.emergencyContact,
    payload.emergencyPhone,
    payload.education,
    payload.technicalLevel,
    payload.athletePosition,
    payload.healthStatus,
    payload.bestResult,
    payload.nativePlace,
    payload.homeAddress,
    payload.athleteStatus,
    payload.startSportDate,
    payload.trainingVenue,
    payload.currentEvent,
    payload.trainingPhase,
    payload.campPeriod,
    payload.originPlace,
    payload.originUnit,
    payload.originCoach,
    payload.specialties,
    payload.notes
  );
}

export const athleteProfileText = (max: number) => z.string().trim().max(max);
export const optionalIsoDate = z.union([z.literal(''), z.iso.date()]);
export const selfAthleteProfileSchema = z.strictObject({
  name: z.string().trim().min(2).max(20),
  project: athleteProfileText(16).optional(),
  team: athleteProfileText(80).optional(),
  gender: athleteProfileText(2),
  region: athleteProfileText(80).optional(),
  city: athleteProfileText(80).optional(),
  county: athleteProfileText(80).optional(),
  birthDate: optionalIsoDate,
  identityNumber: athleteProfileText(18),
  ethnicity: athleteProfileText(40),
  phone: athleteProfileText(20),
  bloodType: athleteProfileText(8),
  emergencyContact: athleteProfileText(40),
  emergencyPhone: athleteProfileText(20),
  education: athleteProfileText(40),
  technicalLevel: athleteProfileText(40),
  athletePosition: athleteProfileText(80),
  healthStatus: athleteProfileText(20),
  bestResult: athleteProfileText(500),
  nativePlace: athleteProfileText(120),
  homeAddress: athleteProfileText(300),
  athleteStatus: athleteProfileText(20),
  startSportDate: optionalIsoDate,
  trainingVenue: athleteProfileText(120),
  currentEvent: athleteProfileText(120),
  trainingPhase: athleteProfileText(120),
  campPeriod: athleteProfileText(120),
  originPlace: athleteProfileText(120),
  originUnit: athleteProfileText(120),
  originCoach: athleteProfileText(80),
  specialties: athleteProfileText(500),
  notes: athleteProfileText(1000),
});

export function selfAthleteProfileValidationMessage(error: z.ZodError) {
  const issue = error.issues[0];
  const field = String(issue?.path[0] || '');
  if (issue?.code === 'unrecognized_keys') return '个人资料包含不支持的字段。';
  if (field === 'birthDate') return '出生日期须使用 YYYY-MM-DD 格式。';
  if (field === 'startSportDate') return '开始运动日期须使用 YYYY-MM-DD 格式。';
  const labels: Record<string, string> = {
    name: '姓名',
    project: '项目',
    team: '队伍',
    gender: '性别',
    region: '省份',
    city: '城市',
    county: '区县',
    identityNumber: '身份证号',
    ethnicity: '民族',
    phone: '本人手机',
    bloodType: '血型',
    emergencyContact: '紧急联系人',
    emergencyPhone: '紧急联系电话',
    education: '学历',
    technicalLevel: '技术等级',
    athletePosition: '位置/号位',
    healthStatus: '健康状态',
    bestResult: '最好成绩',
    nativePlace: '籍贯',
    homeAddress: '家庭住址',
    athleteStatus: '在训状态',
    trainingVenue: '训练场地',
    currentEvent: '当前小项',
    trainingPhase: '训练阶段',
    campPeriod: '集训周期',
    originPlace: '输送地',
    originUnit: '输送单位',
    originCoach: '启蒙教练',
    specialties: '专项特点',
    notes: '备注',
  };
  return labels[field] ? `${labels[field]}格式无效。` : '个人资料格式无效。';
}

export const bodyCompositionFields = [
  ['heightCm', 'height_cm', 80, 260],
  ['weightKg', 'weight_kg', 20, 220],
  ['bodyFatPct', 'body_fat_pct', 3, 60],
  ['skeletalMuscleKg', 'skeletal_muscle_kg', 5, 90],
  ['muscleMassKg', 'muscle_mass_kg', 10, 120],
  ['upperLimbMuscleKg', 'upper_limb_muscle_kg', 1, 30],
  ['lowerLimbMuscleKg', 'lower_limb_muscle_kg', 3, 60],
  ['trunkMuscleKg', 'trunk_muscle_kg', 3, 60],
  ['subcutaneousFatMm', 'subcutaneous_fat_mm', 1, 80],
  ['tricepsSkinfoldMm', 'triceps_skinfold_mm', 1, 80],
  ['abdominalSkinfoldMm', 'abdominal_skinfold_mm', 1, 100],
  ['thighSkinfoldMm', 'thigh_skinfold_mm', 1, 100],
  ['calfSkinfoldMm', 'calf_skinfold_mm', 1, 80],
  ['visceralFatLevel', 'visceral_fat_level', 1, 30],
  ['basalMetabolismKcal', 'basal_metabolism_kcal', 600, 4000],
  ['totalBodyWaterKg', 'total_body_water_kg', 10, 90],
  ['ecwTbwRatio', 'ecw_tbw_ratio', 0.3, 0.5],
  ['phaseAngleDeg', 'phase_angle_deg', 2, 15],
  ['visceralFatAreaCm2', 'visceral_fat_area_cm2', 5, 300],
  ['leftArmLeanKg', 'left_arm_lean_kg', 0.5, 20],
  ['rightArmLeanKg', 'right_arm_lean_kg', 0.5, 20],
  ['trunkLeanKg', 'trunk_lean_kg', 5, 60],
  ['leftLegLeanKg', 'left_leg_lean_kg', 2, 35],
  ['rightLegLeanKg', 'right_leg_lean_kg', 2, 35],
] as const;

export const injuryStatuses = new Set([
  'healthy',
  'observation',
  'restricted',
  'rehab',
  'suspended',
]);
export const injurySides = new Set(['left', 'right', 'bilateral', 'center', 'unspecified']);

export function injuryRecordById(recordId: number) {
  return db
    .prepare(
      `
    SELECT ir.id, ir.athlete_id AS athleteId, ir.record_type AS recordType,
      ir.injury_name AS injuryName, ir.body_part AS bodyPart, ir.side, ir.status,
      ir.pain_score AS painScore, ir.onset_date AS onsetDate,
      ir.restrictions, ir.rehab_plan AS rehabPlan, ir.review_date AS reviewDate,
      ir.note, u.display_name AS createdBy, u.role AS creatorRole, ir.created_at AS createdAt
    FROM injury_records ir
    JOIN users u ON u.id = ir.created_by
    WHERE ir.id = ?
  `
    )
    .get(recordId);
}
