import express, { type NextFunction, type Request, type Response } from 'express';
import multer from 'multer';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import ExcelJS from 'exceljs';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { db, upsertAthleteOrigin } from './db.ts';
import { buildOverviewPayload } from './overview-service.ts';
import { PROVINCES, PROVINCE_CITIES } from '../shared/regions.ts';
import {
  AREA_LEVEL_META,
  AREA_LEVELS,
  ROLE_HIERARCHY,
  ROLE_META,
  ROLES,
  canManageRole,
  type AreaLevel,
  type Role
} from '../shared/access.ts';
import {
  ROWING_MODEL_STANDARD,
  analyzeRowingPeriod,
  type RowingAnalysisRecord
} from '../shared/rowing-model.ts';
import { CANOE_MODEL_STANDARD, analyzeCanoePeriod } from '../shared/canoe-model.ts';
import { SLALOM_CHAMPION_METRICS, SLALOM_MODEL_STANDARD, analyzeSlalomPeriod, slalomComparison } from '../shared/slalom-model.ts';
import { PROJECTS, type Project } from '../shared/projects.ts';
import { DEFAULT_COACH_CATEGORY, isCoachCategory } from '../shared/coach-categories.ts';
import {
  STRENGTH_METRICS,
  type StrengthMetricValues
} from '../shared/strength-model.ts';
import {
  STRENGTH_BODY_POSITIONS,
  STRENGTH_INTENSITY_ZONES,
  STRENGTH_TRAINING_CATEGORIES,
  STRENGTH_TRAINING_ENVIRONMENTS,
  inferStrengthBodyPosition,
  inferStrengthCategory,
  isStrengthBodyPosition,
  isStrengthIntensityZone,
  isStrengthTrainingCategory,
  isStrengthTrainingEnvironment,
  type StrengthBodyPosition,
  type StrengthIntensityZone,
  type StrengthTrainingCategory,
  type StrengthTrainingEnvironment
} from '../shared/strength-training.ts';
import {
  TrainingPlanAIService,
  type AthleteContext
} from './ai-service.ts';
import { recognizeStrengthImport, type RecognizedStrengthRow } from './strength-import-ai.ts';

try {
  process.loadEnvFile(resolve(process.cwd(), '.env'));
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
}

type AuthUser = {
  id: number;
  username: string;
  displayName: string;
  role: Role;
  athleteId: number | null;
};

const intensityZones = ['U3', 'U2', 'U1', 'AT', 'TPT', 'AN', 'ATP'] as const;
type IntensityZoneKey = typeof intensityZones[number];
type TrainingBreakdown = {
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

type TrainingPlanWeekEntry = {
  sets: string;
  reps: string;
  percentage: number | null;
  actualCompleted: string;
  arrangement: string;
};

type TrainingPlanLine = {
  id: string;
  weeks: Record<string, TrainingPlanWeekEntry>;
};

type TrainingPlanExercise = {
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

type TrainingPlanData = {
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

type SpecialTestImportRow = {
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

type StrengthImportRow = {
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

type OverviewLayoutState = {
  version: number;
  order: string[];
  hidden: string[];
  pinned: string[];
};

declare global {
  namespace Express {
    interface Request {
      authUser?: AuthUser;
    }
  }
}

const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 12 * 1024 * 1024 } });
const athletePhotoRoot = resolve(process.env.ATHLETE_PHOTO_ROOT || resolve(process.cwd(), 'data', 'uploads', 'athlete-photos'));
mkdirSync(athletePhotoRoot, { recursive: true });
const photoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 4 * 1024 * 1024 },
  fileFilter: (_req, file, callback) => {
    if (!['image/jpeg', 'image/png'].includes(file.mimetype)) {
      callback(new Error('证件照仅支持 JPG 或 PNG。'));
      return;
    }
    callback(null, true);
  }
});

const port = Number(process.env.PORT || 8787);
const jwtSecretPath = resolve(process.cwd(), 'data', '.jwt-secret');
const jwtSecret = (() => {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  if (existsSync(jwtSecretPath)) return readFileSync(jwtSecretPath, 'utf8').trim();
  const generated = randomBytes(48).toString('hex');
  writeFileSync(jwtSecretPath, generated, { encoding: 'utf8', flag: 'wx' });
  return generated;
})();
const specialTestImportCache = new Map<string, { ownerId: number; rows: SpecialTestImportRow[]; expiresAt: number }>();
const strengthImportCache = new Map<string, {
  ownerId: number;
  filename: string;
  mimetype: string;
  sourceType: 'excel' | 'csv' | 'image' | 'pdf';
  rows: StrengthImportRow[];
  modelUsed: string;
  expiresAt: number;
}>();
const rateBuckets = new Map<string, { count: number; resetAt: number }>();
const provinceSet = new Set<string>(PROVINCES);
const projectSet = new Set<string>(PROJECTS);

function analysisStandardForProject(project: string) {
  return project === '激流' ? SLALOM_MODEL_STANDARD : project === '皮划艇' ? CANOE_MODEL_STANDARD : ROWING_MODEL_STANDARD;
}

function analyzePeriodForProject(project: string, records: RowingAnalysisRecord[]) {
  return project === '激流' ? analyzeSlalomPeriod(records) : project === '皮划艇' ? analyzeCanoePeriod(records) : analyzeRowingPeriod(records);
}

app.disable('x-powered-by');
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; font-src 'self' data:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'");
  next();
});
app.use(express.json({ limit: '2mb' }));
app.use('/uploads/athlete-photos', express.static(athletePhotoRoot, {
  fallthrough: false,
  immutable: true,
  maxAge: '30d'
}));

function consumeRateLimit(req: Request, scope: string, maxAttempts: number, windowMs: number) {
  const key = `${scope}:${req.ip || req.socket.remoteAddress || 'unknown'}`;
  const now = Date.now();
  const bucket = rateBuckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    rateBuckets.set(key, { count: 1, resetAt: now + windowMs });
    return false;
  }
  bucket.count += 1;
  return bucket.count > maxAttempts;
}

function clearRateLimit(req: Request, scope: string) {
  const key = `${scope}:${req.ip || req.socket.remoteAddress || 'unknown'}`;
  rateBuckets.delete(key);
}

function getAuthUser(req: Request): AuthUser | null {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return null;
  try {
    const tokenUser = jwt.verify(header.slice(7), jwtSecret) as AuthUser;
    const current = db.prepare(`
      SELECT id, username, display_name AS displayName, role, athlete_id AS athleteId
      FROM users WHERE id = ? AND active = 1
    `).get(tokenUser.id) as AuthUser | undefined;
    return current || null;
  } catch {
    return null;
  }
}

function requireAuth(req: Request, res: Response, next: NextFunction) {
  const user = getAuthUser(req);
  if (!user) return res.status(401).json({ message: '登录状态已失效，请重新登录。' });
  req.authUser = user;
  next();
}

function requireRole(...roles: Role[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    const user = req.authUser;
    if (!user || !roles.includes(user.role)) {
      return res.status(403).json({ message: '当前账户没有执行此操作的权限。' });
    }
    next();
  };
}

function isOverviewLayoutState(value: unknown): value is OverviewLayoutState {
  if (!value || typeof value !== 'object') return false;
  const layout = value as Record<string, unknown>;
  return typeof layout.version === 'number'
    && Number.isFinite(layout.version)
    && Array.isArray(layout.order)
    && Array.isArray(layout.hidden)
    && Array.isArray(layout.pinned)
    && [layout.order, layout.hidden, layout.pinned].every((items) => items.every((item) => typeof item === 'string'));
}

type AreaPermission = {
  areaLevel: AreaLevel;
  province: string;
  city: string;
  county: string;
};

type ScopeAthlete = {
  id: number;
  region: string;
  city: string;
  county: string;
  project: string;
  team: string;
};

function accountPermissions(userId: number) {
  const areas = db.prepare(`
    SELECT area_level AS areaLevel, province, city, county
    FROM user_area_permissions WHERE user_id = ?
  `).all(userId) as AreaPermission[];
  const projects = (db.prepare('SELECT project FROM user_project_permissions WHERE user_id = ?').all(userId) as { project: string }[])
    .map((item) => item.project);
  const teams = db.prepare(`
    SELECT project, team FROM user_team_permissions WHERE user_id = ?
  `).all(userId) as Array<{ project: string; team: string }>;
  return { areas, projects, teams };
}

function areaAllowsAthlete(area: AreaPermission, athlete: ScopeAthlete) {
  if (area.areaLevel === 'national') return true;
  if (area.province !== athlete.region) return false;
  if (area.areaLevel === 'province') return true;
  if (area.city !== athlete.city) return false;
  if (area.areaLevel === 'city') return true;
  return area.county === athlete.county;
}

function permissionsAllowAthlete(
  permissions: ReturnType<typeof accountPermissions>,
  athlete: ScopeAthlete
) {
  const areaAllowed = permissions.areas.some((area) => areaAllowsAthlete(area, athlete));
  const projectAllowed = permissions.projects.includes('*') || permissions.projects.includes(athlete.project);
  const teamAllowed = permissions.teams.some((item) =>
    (item.project === '*' || item.project === athlete.project)
      && (item.team === '*' || item.team === athlete.team)
  );
  return areaAllowed && projectAllowed && teamAllowed;
}

function permissionsAllowProjectTeam(permissions: ReturnType<typeof accountPermissions>, project: string, team: string) {
  return (permissions.projects.includes('*') || permissions.projects.includes(project))
    && permissions.teams.some((item) =>
      (item.project === '*' || item.project === project) && (item.team === '*' || item.team === team)
    );
}

function areaContains(manager: AreaPermission, target: AreaPermission) {
  if (manager.areaLevel === 'national') return true;
  if (manager.province !== target.province) return false;
  if (manager.areaLevel === 'province') return true;
  if (manager.city !== target.city) return false;
  if (manager.areaLevel === 'city') return true;
  return target.areaLevel === 'county' && manager.county === target.county;
}

function canManageAccount(manager: AuthUser, target: AuthUser) {
  if (!canManageRole(manager.role, target.role)) return false;
  const managerPermissions = accountPermissions(manager.id);
  const targetPermissions = accountPermissions(target.id);
  return permissionsContain(managerPermissions, targetPermissions);
}

function permissionsContain(
  managerPermissions: ReturnType<typeof accountPermissions>,
  targetPermissions: ReturnType<typeof accountPermissions>
) {
  if (!targetPermissions.areas.length || !targetPermissions.projects.length || !targetPermissions.teams.length) return false;
  const areasContained = targetPermissions.areas.every((targetArea) =>
    managerPermissions.areas.some((managerArea) => areaContains(managerArea, targetArea))
  );
  const projectsContained = managerPermissions.projects.includes('*')
    || targetPermissions.projects.every((project) => managerPermissions.projects.includes(project));
  const teamsContained = managerPermissions.teams.some((team) => team.project === '*' && team.team === '*')
    || targetPermissions.teams.every((targetTeam) =>
      managerPermissions.teams.some((managerTeam) =>
        (managerTeam.project === '*' || managerTeam.project === targetTeam.project)
          && (managerTeam.team === '*' || managerTeam.team === targetTeam.team)
      )
    );
  return areasContained && projectsContained && teamsContained;
}

function accountCodeFor(userId: number, role: Role, province: string, project: string) {
  const areaCodes: Record<string, string> = { 四川: '510000', 浙江: '330000', 广东: '440000' };
  const projectCodes: Record<string, string> = { 赛艇: 'ROW', 皮划艇: 'CAN' };
  return `${areaCodes[province] || '000000'}-${projectCodes[project] || 'ALL'}-${role}-${String(userId).padStart(4, '0')}`;
}

function initializeAccountScope(input: {
  userId: number;
  role: Role;
  parentUserId: number | null;
  province: string;
  city: string;
  county: string;
  project: string;
  team: string;
  grantedBy: number;
  areaLevel?: AreaLevel;
}) {
  const areaLevel = input.areaLevel || (input.province ? (input.county ? 'county' : input.city ? 'city' : 'province') : 'national');
  db.prepare(`
    INSERT INTO account_profiles (user_id, parent_user_id, account_code)
    VALUES (?, ?, ?)
  `).run(
    input.userId,
    input.parentUserId,
    accountCodeFor(input.userId, input.role, input.province, input.project)
  );
  db.prepare(`
    INSERT INTO user_area_permissions (user_id, area_level, province, city, county, granted_by)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(input.userId, areaLevel, input.province, input.city, input.county, input.grantedBy);
  db.prepare(`
    INSERT INTO user_project_permissions (user_id, project, granted_by)
    VALUES (?, ?, ?)
  `).run(input.userId, input.project || '*', input.grantedBy);
  db.prepare(`
    INSERT INTO user_team_permissions (user_id, project, team, granted_by)
    VALUES (?, ?, ?, ?)
  `).run(input.userId, input.project || '*', input.team || '*', input.grantedBy);
}

function parseScopePayload(body: any) {
  const areas: AreaPermission[] = Array.isArray(body?.areas)
    ? body.areas.map((area: any) => ({
      areaLevel: cleanString(area?.areaLevel) as AreaLevel,
      province: cleanString(area?.province),
      city: cleanString(area?.city),
      county: cleanString(area?.county)
    }))
    : [];
  const projects = Array.isArray(body?.projects)
    ? [...new Set<string>(body.projects.map((project: unknown) => cleanString(project)).filter(Boolean))]
    : [];
  const teams = Array.isArray(body?.teams)
    ? body.teams.map((team: any) => ({ project: cleanString(team?.project), team: cleanString(team?.team) }))
      .filter((team: { project: string; team: string }) => team.project && team.team)
    : [];
  return { areas, projects, teams };
}

function validateScopePayload(permissions: ReturnType<typeof parseScopePayload>) {
  if (!permissions.areas.length) return '至少绑定一个行政区域。';
  if (!permissions.projects.length) return '至少绑定一个运动项目。';
  if (!permissions.teams.length) return '至少绑定一个队伍范围。';
  for (const area of permissions.areas) {
    if (!AREA_LEVELS.includes(area.areaLevel)) return '行政区域级别无效。';
    if (area.areaLevel === 'national') continue;
    if (!provinceSet.has(area.province)) return '省份信息无效。';
    if ((area.areaLevel === 'city' || area.areaLevel === 'county') && area.city.length < 2) return '请填写所属城市。';
    if (area.areaLevel === 'county' && area.county.length < 2) return '请填写所属区县。';
  }
  if (permissions.projects.some((project) => project !== '*' && !projectSet.has(project))) {
    return '运动项目信息无效。';
  }
  return '';
}

function replaceAccountScope(input: {
  userId: number;
  role: Role;
  parentUserId: number | null;
  permissions: ReturnType<typeof parseScopePayload>;
  grantedBy: number;
}) {
  db.prepare('DELETE FROM user_area_permissions WHERE user_id = ?').run(input.userId);
  db.prepare('DELETE FROM user_project_permissions WHERE user_id = ?').run(input.userId);
  db.prepare('DELETE FROM user_team_permissions WHERE user_id = ?').run(input.userId);
  const areaInsert = db.prepare(`
    INSERT INTO user_area_permissions (user_id, area_level, province, city, county, granted_by)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  for (const area of input.permissions.areas) {
    areaInsert.run(input.userId, area.areaLevel, area.province, area.city, area.county, input.grantedBy);
  }
  const projectInsert = db.prepare(`
    INSERT INTO user_project_permissions (user_id, project, granted_by) VALUES (?, ?, ?)
  `);
  for (const project of input.permissions.projects) projectInsert.run(input.userId, project, input.grantedBy);
  const teamInsert = db.prepare(`
    INSERT INTO user_team_permissions (user_id, project, team, granted_by) VALUES (?, ?, ?, ?)
  `);
  for (const team of input.permissions.teams) teamInsert.run(input.userId, team.project, team.team, input.grantedBy);
  const firstArea = input.permissions.areas[0];
  const firstProject = input.permissions.projects[0];
  db.prepare(`
    UPDATE account_profiles SET parent_user_id = ?, account_code = ?, updated_at = CURRENT_TIMESTAMP
    WHERE user_id = ?
  `).run(
    input.parentUserId,
    accountCodeFor(input.userId, input.role, firstArea?.province || '', firstProject || '*'),
    input.userId
  );
}

function standardAccountName(input: {
  displayName: string;
  role: Role;
  areas: AreaPermission[];
  projects: string[];
  teams: Array<{ project: string; team: string }>;
}) {
  const area = input.areas[0];
  const areaLabel = area?.areaLevel === 'national'
    ? '全国'
    : [area?.province, area?.city, area?.county].filter(Boolean).join('·') || '未设置区域';
  const projectLabel = input.projects.includes('*') ? '全部项目' : input.projects.join('、');
  const teamLabel = input.teams.some((team) => team.team === '*') ? '' : `·${input.teams.map((team) => team.team).join('、')}`;
  return `${areaLabel}·${projectLabel}${teamLabel}·${ROLE_META[input.role].label}·${input.displayName}`;
}

function accessibleAthleteIds(user: AuthUser): number[] {
  if (user.role === 'ATL') return user.athleteId ? [user.athleteId] : [];
  const permissions = accountPermissions(user.id);
  const candidates = user.role === 'SCC'
    ? db.prepare(`
      SELECT a.id, a.region, a.city, a.county, a.project, a.team
      FROM athletes a JOIN coach_athletes ca ON ca.athlete_id = a.id
      WHERE ca.coach_user_id = ? AND a.active = 1
    `).all(user.id) as ScopeAthlete[]
    : db.prepare(`
      SELECT id, region, city, county, project, team
      FROM athletes WHERE active = 1
    `).all() as ScopeAthlete[];
  return candidates.filter((athlete) => permissionsAllowAthlete(permissions, athlete)).map((athlete) => athlete.id);
}

function hasAthleteAccess(user: AuthUser, athleteId: number) {
  return accessibleAthleteIds(user).includes(athleteId);
}

function cleanString(value: unknown) {
  return String(value ?? '').trim();
}

type OverviewPeriod = 'day' | 'week' | 'month';

function isOverviewPeriod(value: string): value is OverviewPeriod {
  return value === 'day' || value === 'week' || value === 'month';
}

function toLocalIsoDate(value: Date) {
  const local = new Date(value.getTime() - value.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

function addIsoDays(date: string, amount: number) {
  const target = new Date(`${date}T00:00:00`);
  target.setDate(target.getDate() + amount);
  return toLocalIsoDate(target);
}

function normalizeOverviewRange(input: { from: string; to: string; period: string }) {
  if (!isOverviewPeriod(input.period)) return { from: input.from, to: input.to, period: null };
  const anchor = /^\d{4}-\d{2}-\d{2}$/.test(input.to)
    ? input.to
    : /^\d{4}-\d{2}-\d{2}$/.test(input.from)
      ? input.from
      : toLocalIsoDate(new Date());
  if (input.period === 'day') return { from: anchor, to: anchor, period: input.period };
  if (input.period === 'week') return { from: addIsoDays(anchor, -6), to: anchor, period: input.period };
  return { from: addIsoDays(anchor, -29), to: anchor, period: input.period };
}

function optionalNumber(value: unknown, min: number, max: number, label: string, errors: string[]) {
  if (value === '' || value === null || value === undefined) return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < min || numeric > max) {
    errors.push(`${label}应在${min}至${max}之间`);
    return null;
  }
  return Math.round(numeric * 10) / 10;
}

const defaultTrainingPlanWeekKeys = ['1', '2', '3', '4'];

function trainingPlanWeekKeys(source: Record<string, unknown>) {
  const explicit = Array.isArray(source.weekKeys)
    ? source.weekKeys.map(cleanString).filter(Boolean)
    : [];
  const exercises = Array.isArray(source.exercises) ? source.exercises : [];
  const firstExercise = exercises.find((value) => value && typeof value === 'object' && !Array.isArray(value)) as Record<string, unknown> | undefined;
  const lines = Array.isArray(firstExercise?.lines) ? firstExercise.lines : [];
  const firstLine = lines.find((value) => value && typeof value === 'object' && !Array.isArray(value)) as Record<string, unknown> | undefined;
  const weeks = firstLine?.weeks && typeof firstLine.weeks === 'object' && !Array.isArray(firstLine.weeks)
    ? Object.keys(firstLine.weeks as Record<string, unknown>)
    : [];
  const sourceKeys = explicit.length ? explicit : weeks.length ? weeks : defaultTrainingPlanWeekKeys;
  return [...new Set(sourceKeys.map((key) => key.slice(0, 20)))].slice(0, 52);
}

function parseTrainingPlanData(input: unknown) {
  const source = input && typeof input === 'object' && !Array.isArray(input)
    ? input as Record<string, unknown>
    : {};
  const errors: string[] = [];
  const startDate = cleanString(source.startDate || source.planDate);
  const endDate = cleanString(source.endDate) || (() => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) return '';
    const date = new Date(`${startDate}T12:00:00Z`);
    date.setUTCDate(date.getUTCDate() + 30);
    return date.toISOString().slice(0, 10);
  })();
  const title = cleanString(source.title);
  const scheduleLabel = cleanString(source.scheduleLabel);
  const sourceType = source.sourceType === 'ai_import' || source.sourceType === 'ai_generated' ? source.sourceType : undefined;
  const isAIPlan = Boolean(sourceType);
  const weekKeys = trainingPlanWeekKeys(source);
  const rawWeekLabels = source.weekLabels && typeof source.weekLabels === 'object' && !Array.isArray(source.weekLabels)
    ? source.weekLabels as Record<string, unknown>
    : {};
  const weekLabels = Object.fromEntries(weekKeys.map((key, index) => [key, cleanString(rawWeekLabels[key]).slice(0, 60) || `WEEK ${index + 1}`]));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
    errors.push('请选择有效的开始日期和结束日期');
  } else {
    const days = Math.round((Date.parse(`${endDate}T12:00:00Z`) - Date.parse(`${startDate}T12:00:00Z`)) / 86400000) + 1;
    if (isAIPlan ? (days < 1 || days > 730) : (days < 28 || days > 31)) {
      errors.push(isAIPlan ? 'AI体能训练起止日期应覆盖1至730天' : '体能训练须按一个月设置，起止日期应覆盖28至31天');
    }
  }
  if (!title || title.length > (isAIPlan ? 80 : 60)) errors.push(`训练名称应为1至${isAIPlan ? 80 : 60}个字符`);
  if ((!scheduleLabel && !isAIPlan) || scheduleLabel.length > 80) errors.push(`训练日安排应为${isAIPlan ? '0至80' : '1至80'}个字符`);
  if (!weekKeys.length) errors.push('至少需要一个训练阶段');

  const rawExercises = Array.isArray(source.exercises) ? source.exercises : [];
  if (!rawExercises.length) errors.push('至少添加一个训练项目');
  const exerciseLimit = isAIPlan ? 40 : 20;
  if (rawExercises.length > exerciseLimit) errors.push(`训练项目最多${exerciseLimit}项`);
  let totalLines = 0;
  const exercises: TrainingPlanExercise[] = rawExercises.slice(0, exerciseLimit).map((rawExercise, exerciseIndex) => {
    const exercise = rawExercise && typeof rawExercise === 'object' && !Array.isArray(rawExercise)
      ? rawExercise as Record<string, unknown>
      : {};
    const name = cleanString(exercise.name);
    const unitNote = cleanString(exercise.unitNote);
    const category = isStrengthTrainingCategory(exercise.category) ? exercise.category : inferStrengthCategory(name);
    const bodyPosition = isStrengthBodyPosition(exercise.bodyPosition) ? exercise.bodyPosition : inferStrengthBodyPosition(name);
    if (name.length > 60) errors.push(`第${exerciseIndex + 1}项训练名称不能超过60个字符`);
    if (unitNote.length > 20) errors.push(`第${exerciseIndex + 1}项备注不能超过20个字符`);
    const rawLines = Array.isArray(exercise.lines) ? exercise.lines : [];
    if (!rawLines.length) errors.push(`第${exerciseIndex + 1}项至少需要一行处方`);
    const lineLimit = isAIPlan ? 20 : 8;
    if (rawLines.length > lineLimit) errors.push(`第${exerciseIndex + 1}项处方最多${lineLimit}行`);
    totalLines += rawLines.length;
    const lines: TrainingPlanLine[] = rawLines.slice(0, lineLimit).map((rawLine, lineIndex) => {
      const line = rawLine && typeof rawLine === 'object' && !Array.isArray(rawLine)
        ? rawLine as Record<string, unknown>
        : {};
      const rawWeeks = line.weeks && typeof line.weeks === 'object' && !Array.isArray(line.weeks)
        ? line.weeks as Record<string, unknown>
        : {};
      const weeks = {} as TrainingPlanLine['weeks'];
      for (const weekKey of weekKeys) {
        const rawWeek = rawWeeks[weekKey] && typeof rawWeeks[weekKey] === 'object' && !Array.isArray(rawWeeks[weekKey])
          ? rawWeeks[weekKey] as Record<string, unknown>
          : {};
        const sets = cleanString(rawWeek.sets);
        const reps = cleanString(rawWeek.reps);
        const actualCompleted = cleanString(rawWeek.actualCompleted);
        const arrangement = cleanString(rawWeek.arrangement);
        if (sets.length > 12 || reps.length > 20 || actualCompleted.length > 30) {
          errors.push(`第${exerciseIndex + 1}项第${lineIndex + 1}行第${weekKey}周输入过长`);
        }
        if (arrangement.length > 500) errors.push(`第${exerciseIndex + 1}项第${lineIndex + 1}行第${weekKey}周安排不能超过500个字符`);
        weeks[weekKey] = {
          sets,
          reps,
          percentage: optionalNumber(rawWeek.percentage, 0, 100, '训练百分比', errors),
          actualCompleted,
          arrangement
        };
      }
      return {
        id: cleanString(line.id).slice(0, 50) || randomUUID(),
        weeks
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
      lines
    };
  });
  if (!exercises.some((exercise) => exercise.name)) errors.push('至少填写一个训练项目名称');
  if (totalLines > (isAIPlan ? 200 : 30)) errors.push(isAIPlan ? 'AI体能训练最多容纳200行训练处方' : '导出模板最多容纳30行训练处方');

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
    ...(sourceType ? {
      sourceType,
      summary: cleanString(source.summary).slice(0, 1000),
      durationWeeks: optionalNumber(source.durationWeeks, 0, 52, '训练阶段数', errors),
      weeklyPlans: Array.isArray(source.weeklyPlans) ? source.weeklyPlans : [],
      confidence: optionalNumber(source.confidence, 0, 1, '识别置信度', errors),
      warnings: Array.isArray(source.warnings) ? source.warnings.map(cleanString).filter(Boolean).slice(0, 50) : [],
      unmappedContent: Array.isArray(source.unmappedContent) ? source.unmappedContent.map(cleanString).filter(Boolean).slice(0, 100) : []
    } : {})
  };
  return { data, errors: [...new Set(errors)] };
}

function planRecord(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function emptyMatrixWeek(): TrainingPlanWeekEntry {
  return { sets: '', reps: '', percentage: null, actualCompleted: '', arrangement: '' };
}

function aiPercentage(value: unknown) {
  if (value === '' || value === null || value === undefined) return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 0 && numeric <= 100 ? Math.round(numeric * 10) / 10 : null;
}

function recentTrainingPlanMaxWeights(athleteId: number) {
  const rows = db.prepare(`
    SELECT plan_data AS dataJson FROM training_plans
    WHERE athlete_id = ? ORDER BY start_date DESC, id DESC LIMIT 12
  `).all(athleteId) as Array<{ dataJson: string }>;
  const maxWeights = new Map<string, number>();
  for (const row of rows) {
    try {
      const stored = planRecord(JSON.parse(row.dataJson));
      const exercises = Array.isArray(stored.exercises) ? stored.exercises : [];
      for (const exerciseValue of exercises) {
        const exercise = planRecord(exerciseValue);
        const name = cleanString(exercise.name);
        const maxWeight = Number(exercise.maxWeight);
        if (name && Number.isFinite(maxWeight) && maxWeight >= 0 && !maxWeights.has(name.toLocaleLowerCase())) {
          maxWeights.set(name.toLocaleLowerCase(), maxWeight);
        }
      }
    } catch {}
  }
  return maxWeights;
}

function normalizeAIPlanToMatrix(planValue: unknown, athleteId?: number) {
  const plan = planRecord(planValue);
  const sourceType = plan.sourceType === 'ai_import' ? 'ai_import' : 'ai_generated';
  const sourceWeeks = Array.isArray(plan.weeklyPlans) ? plan.weeklyPlans.map(planRecord) : [];
  const weekKeys = sourceWeeks.map((_week, index) => String(index + 1));
  const weekLabels = Object.fromEntries(sourceWeeks.map((week, index) => {
    const weekNumber = Number(week.weekNumber);
    const label = cleanString(week.label);
    return [weekKeys[index], label || (Number.isFinite(weekNumber) && weekNumber > 0 ? `WEEK ${weekNumber}` : `阶段 ${index + 1}`)];
  }));
  const configuredMax = new Map<string, number>();
  for (const exerciseValue of Array.isArray(plan.exercises) ? plan.exercises : []) {
    const exercise = planRecord(exerciseValue);
    const name = cleanString(exercise.name);
    const maxWeight = Number(exercise.maxWeight);
    if (name && Number.isFinite(maxWeight) && maxWeight >= 0) configuredMax.set(name.toLocaleLowerCase(), maxWeight);
  }
  const recentMax = athleteId ? recentTrainingPlanMaxWeights(athleteId) : new Map<string, number>();
  const exerciseMap = new Map<string, TrainingPlanExercise>();

  sourceWeeks.forEach((week, weekIndex) => {
    const weekKey = weekKeys[weekIndex];
    const occurrenceByExercise = new Map<string, number>();
    const days = Array.isArray(week.days) ? week.days.map(planRecord) : [];
    for (const day of days) {
      const dayLabel = sourceType === 'ai_import'
        ? [cleanString(day.date), cleanString(day.dayLabel)].filter(Boolean).join(' ')
        : cleanString(day.dayOfWeek);
      const dayFocus = cleanString(day.focus);
      const items = sourceType === 'ai_import'
        ? (Array.isArray(day.items) ? day.items.map(planRecord) : [])
        : (Array.isArray(day.exercises) ? day.exercises.map(planRecord) : []);
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
            lines: []
          };
          exerciseMap.set(normalizedName, exercise);
        }
        while (exercise.lines.length <= occurrence) {
          exercise.lines.push({
            id: randomUUID(),
            weeks: Object.fromEntries(weekKeys.map((key) => [key, emptyMatrixWeek()]))
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
          sourceType === 'ai_import' && cleanString(item.rawText) !== name ? cleanString(item.rawText) : ''
        ].filter((part): part is string => Boolean(part));
        exercise.lines[occurrence].weeks[weekKey] = {
          sets: cleanString(item.sets),
          reps: cleanString(item.reps),
          percentage: aiPercentage(item.percentage),
          actualCompleted: '',
          arrangement: [...new Set(detailParts)].join(' · ').slice(0, 500)
        };
      }
    }
  });

  return {
    ...plan,
    sourceType,
    weekKeys,
    weekLabels,
    exercises: [...exerciseMap.values()]
  };
}

function readStoredTrainingPlanData(dataJson: string): unknown {
  const raw = JSON.parse(dataJson || '{}') as Record<string, unknown>;
  if (raw.sourceType === 'ai_import' || raw.sourceType === 'ai_generated' || Array.isArray(raw.weeklyPlans)) {
    const exercises = Array.isArray(raw.exercises) ? raw.exercises.map(planRecord) : [];
    const hasMatrixLines = exercises.some((exercise) => Array.isArray(exercise.lines));
    return parseTrainingPlanData(hasMatrixLines ? raw : normalizeAIPlanToMatrix(raw)).data;
  }
  return parseTrainingPlanData(raw).data;
}

function excelCellText(cell: ExcelJS.Cell) {
  const value = cell.value;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (value && typeof value === 'object' && 'result' in value) {
    const result = (value as { result?: unknown }).result;
    if (result instanceof Date) return result.toISOString().slice(0, 10);
    return cleanString(result);
  }
  return cell.text.trim();
}

function excelNumberOrText(value: string) {
  const trimmed = value.trim();
  if (/^\d+(?:\.\d+)?$/.test(trimmed)) return Number(trimmed);
  return trimmed || null;
}

async function buildTrainingPlanWorkbook(input: {
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
      margins: { left: 0.2, right: 0.2, top: 0.25, bottom: 0.25, header: 0.1, footer: 0.1 }
    },
    views: [{ state: 'frozen', xSplit: 2, ySplit: 6, topLeftCell: 'C7' }]
  });
  const widths = [9, 18];
  for (let week = 0; week < 4; week += 1) widths.push(5.5, 3.5, 7, 7, 8.5, 12);
  widths.forEach((width, index) => { sheet.getColumn(index + 1).width = width; });
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
    right: { style: 'thin', color: { argb: 'FF162832' } }
  };
  const center: Partial<ExcelJS.Alignment> = { horizontal: 'center', vertical: 'middle', wrapText: true };
  const ink = 'FF0B3442';
  const blue = 'FF9DC2E0';
  const blueBody = 'FFDCEBF6';
  const amber = 'FFFFD977';
  const amberBody = 'FFFFF0BD';
  const maxFill = 'FFFFC20A';

  for (let row = 1; row <= 36; row += 1) {
    for (let column = 1; column <= 26; column += 1) {
      const cell = sheet.getCell(row, column);
      cell.font = { name: 'Microsoft YaHei UI', size: row <= 6 ? 10.5 : 10, color: { argb: 'FF122832' } };
      cell.alignment = center;
      cell.border = allBorder;
    }
  }

  sheet.mergeCells('A1:B3');
  const photoCell = sheet.getCell('A1');
  photoCell.value = '证件照\n未上传';
  photoCell.font = { name: 'Microsoft YaHei UI', size: 10, bold: true, color: { argb: 'FF6E7F87' } };
  photoCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F4F5' } };

  const labelValue = (labelRange: string, valueRange: string, label: string, value: string | number | null) => {
    sheet.mergeCells(labelRange);
    sheet.mergeCells(valueRange);
    const labelCell = sheet.getCell(labelRange.split(':')[0]);
    const valueCell = sheet.getCell(valueRange.split(':')[0]);
    labelCell.value = label;
    labelCell.font = { name: 'Microsoft YaHei UI', size: 10, italic: true, bold: true, color: { argb: ink } };
    valueCell.value = value ?? '';
    valueCell.font = { name: 'Microsoft YaHei UI', size: 11, bold: true, color: { argb: 'FF081F29' } };
  };
  const periodLabel = `${input.data.startDate.replaceAll('-', '.')}—${input.data.endDate.slice(5).replace('-', '.')}`;
  labelValue('C1:D1', 'E1:J1', '周期', periodLabel);
  sheet.getCell('E1').font = { name: 'Bahnschrift', size: 8.5, bold: true, color: { argb: 'FF081F29' } };
  labelValue('K1:L1', 'M1:N1', '年龄', input.data.age);
  labelValue('O1:P1', 'Q1:R1', '体重', input.data.bodyWeight === null ? '' : `${input.data.bodyWeight} kg`);
  labelValue('C2:D2', 'E2:J2', '姓名', input.athleteName);
  labelValue('K2:L2', 'M2:R2', '项目 / 组别', `${input.project} · ${input.team}`);
  const exerciseNames = input.data.exercises
    .map((exercise) => exercise.name.trim().replace(/\s*\r?\n\s*/g, ' / ').replace(/\s{2,}/g, ' '))
    .filter(Boolean)
    .slice(0, 8);
  labelValue('C3:D3', 'E3:F3', '项目数', `${exerciseNames.length} / 8`);
  sheet.mergeCells('G3:R3');
  const exerciseNamesCell = sheet.getCell('G3');
  exerciseNamesCell.value = exerciseNames.join(' ｜ ');
  exerciseNamesCell.font = { name: 'Microsoft YaHei UI', size: 9.5, bold: true, color: { argb: ink } };
  exerciseNamesCell.alignment = center;
  sheet.mergeCells('S1:Z3');
  sheet.getCell('S1').value = input.data.title;
  sheet.getCell('S1').font = { name: 'Microsoft YaHei UI', size: 15, bold: true, color: { argb: 'FFE53B2F' } };
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
        editAs: 'oneCell'
      } as never);
      photoCell.value = '';
    }
  }

  sheet.mergeCells('A4:Z4');
  sheet.getCell('A4').value = input.data.scheduleLabel;
  sheet.getCell('A4').font = { name: 'Microsoft YaHei UI', size: 15, bold: true, italic: true, color: { argb: 'FF102A35' } };
  sheet.getCell('A4').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: maxFill } };

  sheet.mergeCells('A5:A6');
  sheet.mergeCells('B5:B6');
  sheet.getCell('A5').value = 'MAX';
  sheet.getCell('B5').value = '项目';
  for (const coordinate of ['A5', 'B5']) {
    sheet.getCell(coordinate).font = { name: 'Microsoft YaHei UI', size: 11, bold: true, italic: true, color: { argb: 'FF081F29' } };
    sheet.getCell(coordinate).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: maxFill } };
  }
  const weekStarts = [3, 9, 15, 21];
  const subHeaders = ['组', '×', '次', '%', '重量', '完成次数'];
  weekStarts.forEach((start, weekIndex) => {
    sheet.mergeCells(5, start, 5, start + 5);
    const header = sheet.getCell(5, start);
    header.value = `WEEK ${weekIndex + 1}`;
    header.font = { name: 'Bahnschrift', size: 12, bold: true, italic: true, color: { argb: 'FF0B2530' } };
    header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: weekIndex % 2 === 0 ? blue : amber } };
    subHeaders.forEach((label, offset) => {
      const cell = sheet.getCell(6, start + offset);
      cell.value = label;
      cell.font = { name: 'Microsoft YaHei UI', size: 10, bold: true, color: { argb: 'FF0B2530' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: weekIndex % 2 === 0 ? blue : amber } };
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
    itemCell.font = { name: 'Microsoft YaHei UI', size: 11, bold: true, color: { argb: 'FF102A35' } };

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
            fgColor: { argb: bodyFill }
          };
        }
        sheet.getCell(rowNumber, columnStart).value = excelNumberOrText(week.sets);
        sheet.getCell(rowNumber, columnStart + 1).value = week.sets || week.reps || week.percentage !== null ? '×' : '';
        sheet.getCell(rowNumber, columnStart + 2).value = excelNumberOrText(week.reps);
        const percentageCell = sheet.getCell(rowNumber, columnStart + 3);
        percentageCell.value = week.percentage === null ? null : week.percentage / 100;
        percentageCell.numFmt = '0.0%';
        const weightCell = sheet.getCell(rowNumber, columnStart + 4);
        const percentageCoordinate = percentageCell.address;
        const calculated = exercise.maxWeight !== null && week.percentage !== null
          ? Math.round(exercise.maxWeight * week.percentage) / 100
          : 0;
        weightCell.value = {
          formula: `IF(OR($A$${startRow}="",${percentageCoordinate}=""),"",ROUND($A$${startRow}*${percentageCoordinate},1))`,
          result: calculated || undefined
        };
        weightCell.numFmt = '0.0';
        weightCell.font = { name: 'Bahnschrift', size: 10, bold: true, color: { argb: 'FFE64132' } };
        sheet.getCell(rowNumber, columnStart + 5).value = excelNumberOrText(week.actualCompleted);
        sheet.getCell(rowNumber, columnStart + 5).font = {
          name: 'Microsoft YaHei UI',
          size: 9.5,
          bold: Boolean(week.actualCompleted),
          color: { argb: 'FF14706D' }
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

function parseStrengthValues(input: unknown, targetsOnly = false) {
  const values: StrengthMetricValues = {};
  const errors: string[] = [];
  const source = input && typeof input === 'object' && !Array.isArray(input)
    ? input as Record<string, unknown>
    : {};
  for (const metric of STRENGTH_METRICS) {
    if (targetsOnly && !metric.targetEnabled) continue;
    const raw = source[metric.key];
    if (raw === '' || raw === null || raw === undefined) continue;
    const value = Number(raw);
    if (!Number.isFinite(value) || value < metric.min || value > metric.max) {
      errors.push(`${metric.label}应在${metric.min}至${metric.max}${metric.unit}之间`);
      continue;
    }
    values[metric.key] = Math.round(value * 10) / 10;
  }
  return { values, errors };
}

type StrengthAdviceContent = {
  title: string;
  overview: string;
  strengths: string[];
  priorities: string[];
  weeks: Array<{ week: number; focus: string; load: string; prescription: string[] }>;
  recovery: string[];
  cautions: string[];
};

type AdviceTestRow = {
  strengthTestId: number;
  athleteId: number;
  athleteName: string;
  project: string;
  team: string;
  gender: string;
  testDate: string;
  metricsJson: string;
  targetsJson: string;
};

function adviceTestById(strengthTestId: number) {
  return db.prepare(`
    SELECT st.id AS strengthTestId, st.athlete_id AS athleteId, st.test_date AS testDate,
      st.metrics_json AS metricsJson, st.targets_json AS targetsJson,
      a.name AS athleteName, a.project, a.team, a.gender
    FROM athlete_strength_tests st
    JOIN athletes a ON a.id = st.athlete_id
    WHERE st.id = ?
  `).get(strengthTestId) as AdviceTestRow | undefined;
}

function limitedText(value: unknown, fallback: string, max = 500) {
  const text = cleanString(value).replace(/\s+/g, ' ');
  return (text || fallback).slice(0, max);
}

function limitedList(value: unknown, fallback: string[], maxItems = 6) {
  if (!Array.isArray(value)) return fallback;
  const list = value.map((item) => limitedText(item, '', 240)).filter(Boolean).slice(0, maxItems);
  return list.length ? list : fallback;
}

function normalizeAdviceContent(input: unknown): StrengthAdviceContent {
  const source = input && typeof input === 'object' && !Array.isArray(input)
    ? input as Record<string, unknown>
    : {};
  const rawWeeks = Array.isArray(source.weeks) ? source.weeks : [];
  const weeks = Array.from({ length: 4 }, (_, index) => {
    const raw = rawWeeks[index] && typeof rawWeeks[index] === 'object'
      ? rawWeeks[index] as Record<string, unknown>
      : {};
    return {
      week: index + 1,
      focus: limitedText(raw.focus, `第${index + 1}周训练重点`, 120),
      load: limitedText(raw.load, '负荷由教练结合当周状态确定', 160),
      prescription: limitedList(raw.prescription, ['根据测试短板安排专项练习，动作质量优先。'], 5)
    };
  });
  return {
    title: limitedText(source.title, '个人力量训练建议方案', 80),
    overview: limitedText(source.overview, '根据本次力量测试与教练目标生成，须经教练审核后执行。', 800),
    strengths: limitedList(source.strengths, ['本次数据不足，暂不判断优势项目。'], 5),
    priorities: limitedList(source.priorities, ['本次数据不足，建议补充测试后再确定训练重点。'], 5),
    weeks,
    recovery: limitedList(source.recovery, ['记录睡眠、疲劳和晨脉，根据恢复状态调整训练量。'], 5),
    cautions: limitedList(source.cautions, ['所有负荷调整须经负责教练确认；出现疼痛或异常疲劳时立即停止训练并复核。'], 5)
  };
}

function buildRuleAdvice(test: AdviceTestRow): StrengthAdviceContent {
  const metrics = JSON.parse(test.metricsJson || '{}') as StrengthMetricValues;
  const targets = JSON.parse(test.targetsJson || '{}') as StrengthMetricValues;
  const comparisons = adviceComparisons(test, metrics, targets);
  const strengths = comparisons
    .filter((item) => item.difference >= 0)
    .sort((left, right) => right.difference - left.difference)
    .slice(0, 3)
    .map((item) => `${item.label}达到目标的${(100 + item.difference).toFixed(1)}%，可作为稳定能力继续保持。`);
  const gaps = comparisons
    .filter((item) => item.difference < 0)
    .sort((left, right) => left.difference - right.difference)
    .slice(0, 3);
  const priorities = gaps.map((item) => `${item.label}距离目标仍差${Math.abs(item.difference).toFixed(1)}%，列入本周期优先改善项。`);
  const focus = gaps.map((item) => item.label).join('、') || '动作质量与基础力量';
  return normalizeAdviceContent({
    title: `${test.testDate} 个人力量训练建议方案`,
    overview: comparisons.length
      ? `本次共有${comparisons.length}项指标可与目标比较，其中${strengths.length}项达到目标、${gaps.length}项列为优先改善项。方案以${focus}为主线，采用逐周递进并在末周复核。`
      : '本次尚未形成完整的目标对比。以下为建议训练框架，请先由教练补充目标值，再确认具体负荷。',
    strengths: strengths.length ? strengths : ['暂未发现同时具备实测值和目标值的达标项目。'],
    priorities: priorities.length ? priorities : ['补充关键项目目标值，并核对测试动作、单位和测试条件。'],
    weeks: [
      { week: 1, focus: '动作校准与基础适应', load: '中低负荷，主观用力RPE 5—6', prescription: [`围绕${focus}完成技术动作校准`, '主练动作3—4组，每组6—10次', '左右侧动作分别记录完成质量'] },
      { week: 2, focus: '重点能力累积', load: '中等负荷，RPE 6—7', prescription: [`提高${focus}的有效训练量`, '主练动作4组，每组5—8次', '保留2—3次余力，避免力竭'] },
      { week: 3, focus: '专项强化', load: '中高负荷，RPE 7—8', prescription: [`强化${focus}，减少无关训练量`, '主练动作3—5组，每组3—6次', '组间充分恢复并记录实际完成值'] },
      { week: 4, focus: '减量巩固与复测', load: '较上周减量20%—30%', prescription: ['保持动作速度和质量', '避免新增高疲劳训练内容', '周期末按相同条件完成复测'] }
    ],
    recovery: ['每次训练记录RPE、睡眠和疲劳指数。', '同一重点力量能力之间建议保留足够恢复时间。', '若连续两天恢复指标明显变差，由教练下调当日总量。'],
    cautions: ['本方案依据有限测试数据生成，必须由负责教练结合专项课表审核。', '单次测试结果仅用于训练调整，不用于选材定论。', '训练中出现疼痛、眩晕或异常疲劳时立即停止并复核。']
  });
}

async function buildAiAdvice(test: AdviceTestRow) {
  const apiKey = cleanString(process.env.AI_API_KEY);
  const baseUrl = cleanString(process.env.AI_BASE_URL).replace(/\/+$/, '');
  const model = cleanString(process.env.AI_MODEL);
  if (!apiKey || !baseUrl || !model) {
    return { content: buildRuleAdvice(test), source: 'rules' as const, model: '内置规则' };
  }

  const metrics = JSON.parse(test.metricsJson || '{}') as StrengthMetricValues;
  const targets = JSON.parse(test.targetsJson || '{}') as StrengthMetricValues;
  const comparison = adviceComparisons(test, metrics, targets);
  const recentRecords = db.prepare(`
    SELECT date, training_type AS trainingType, duration_min AS durationMin, rpe, srpe,
      sleep_hours AS sleepHours, fatigue_index AS fatigueIndex, status
    FROM training_records
    WHERE athlete_id = ? AND date BETWEEN date(?, '-27 days') AND ?
    ORDER BY date
  `).all(test.athleteId, test.testDate, test.testDate);
  const endpoint = baseUrl.endsWith('/chat/completions') ? baseUrl : `${baseUrl}/chat/completions`;
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        ...(model.toLowerCase().startsWith('qwen') ? { enable_thinking: false } : {}),
        max_completion_tokens: 12000,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: `你是${test.project}体能训练建议助手。只依据给定数据生成供教练审核的草案，不作医疗诊断，不虚构缺失数据，不把相关性写成因果。输出严格JSON，字段为title、overview、strengths、priorities、weeks、recovery、cautions；weeks固定4项，每项含week、focus、load、prescription。训练强度使用范围并强调动作质量和教练确认。`
          },
          {
            role: 'user',
            content: JSON.stringify({
              context: '匿名运动员力量测试与最近28天训练记录',
              testDate: test.testDate,
              project: test.project,
              team: test.team,
              gender: test.gender,
              targetType: test.project === '激流' ? '同性别冠军模型参考区间边界' : '教练确认目标值',
              comparison,
              recentRecords
            })
          }
        ]
      }),
      signal: AbortSignal.timeout(Number(process.env.AI_TIMEOUT_MS) || 180000)
    });
    if (!response.ok) throw new Error(`AI service returned ${response.status}`);
    const payload = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    const raw = cleanString(payload.choices?.[0]?.message?.content).replace(/^```json\s*|\s*```$/g, '');
    if (!raw) throw new Error('AI service returned empty content');
    return { content: normalizeAdviceContent(JSON.parse(raw)), source: 'ai' as const, model };
  } catch {
    return {
      content: buildRuleAdvice(test),
      source: 'rules' as const,
      model: 'AI服务不可用·规则兜底',
      fallbackReason: 'ai_unavailable' as const
    };
  }
}

function adviceComparisons(test: AdviceTestRow, metrics: StrengthMetricValues, targets: StrengthMetricValues) {
  if (test.project === '激流') {
    return SLALOM_CHAMPION_METRICS.flatMap((metric) => {
      const comparison = slalomComparison(metric, metrics, test.gender);
      if (!comparison.range || comparison.value === null) return [];
      const target = metric.direction === 'higher' ? comparison.range[0] : comparison.range[1];
      const difference = metric.direction === 'higher'
        ? (comparison.value - target) / target * 100
        : (target - comparison.value) / target * 100;
      return [{
        key: metric.key,
        label: metric.label,
        unit: metric.unit,
        value: comparison.value,
        measured: comparison.value,
        target,
        referenceRange: comparison.range,
        direction: metric.direction,
        difference: Math.round(difference * 10) / 10
      }];
    });
  }
  return STRENGTH_METRICS
    .filter((metric) => metric.targetEnabled && !metric.projects)
    .flatMap((metric) => {
      const value = metrics[metric.key];
      const target = targets[metric.key];
      if (typeof value !== 'number' || typeof target !== 'number' || target <= 0) return [];
      return [{ key: metric.key, label: metric.label, unit: metric.unit, value, measured: value, target, direction: 'higher' as const, difference: Math.round((value - target) / target * 1000) / 10 }];
    });
}

function mapAdviceRow(row: Record<string, unknown>) {
  return {
    id: Number(row.id),
    strengthTestId: Number(row.strengthTestId),
    version: Number(row.version),
    content: normalizeAdviceContent(JSON.parse(String(row.contentJson || '{}'))),
    source: row.source,
    model: row.model,
    status: row.status,
    generatedAt: row.generatedAt,
    generatedBy: row.generatedBy,
    reviewedAt: row.reviewedAt || null,
    reviewedBy: row.reviewedBy || null
  };
}

function latestAdvice(strengthTestId: number, approvedOnly = false) {
  const row = db.prepare(`
    SELECT sa.id, sa.strength_test_id AS strengthTestId, sa.version,
      sa.content_json AS contentJson, sa.source, sa.model, sa.status,
      sa.generated_at AS generatedAt, generator.display_name AS generatedBy,
      sa.reviewed_at AS reviewedAt, reviewer.display_name AS reviewedBy
    FROM strength_ai_advice sa
    JOIN users generator ON generator.id = sa.generated_by
    LEFT JOIN users reviewer ON reviewer.id = sa.reviewed_by
    WHERE sa.strength_test_id = ? ${approvedOnly ? "AND sa.status = 'approved'" : ''}
    ORDER BY sa.version DESC LIMIT 1
  `).get(strengthTestId) as Record<string, unknown> | undefined;
  return row ? mapAdviceRow(row) : null;
}

function validatePersonName(value: unknown) {
  const name = cleanString(value);
  if (name.length < 2 || name.length > 20) {
    return { name, error: '姓名须为2—20个字符。' };
  }
  if (/[\r\n\t<>]/.test(name)) {
    return { name, error: '姓名包含无效字符。' };
  }
  return { name, error: '' };
}

function userById(userId: number): AuthUser | null {
  const row = db.prepare(`
    SELECT id, username, display_name AS displayName, role, athlete_id AS athleteId
    FROM users WHERE id = ?
  `).get(userId) as AuthUser | undefined;
  return row || null;
}

function numberOrNull(value: unknown): number | null {
  if (value === '' || value === undefined || value === null) return null;
  const numeric = Number(String(value).replace(/,/g, ''));
  return Number.isFinite(numeric) ? numeric : null;
}

function parseDate(value: unknown): string {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
  if (typeof value === 'number') {
    const parsed = new Date(Math.round((value - 25569) * 86400 * 1000));
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
  }
  const raw = cleanString(value).replace(/[./年]/g, '-').replace(/月/g, '-').replace(/日/g, '');
  const match = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (!match) return '';
  return `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`;
}

function isValidIsoDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function pick(row: Record<string, unknown>, aliases: string[]) {
  const normalized = new Map(Object.entries(row).map(([key, value]) => [key.replace(/\s+/g, '').toLowerCase(), value]));
  for (const alias of aliases) {
    const value = normalized.get(alias.replace(/\s+/g, '').toLowerCase());
    if (value !== undefined) return value;
  }
  return undefined;
}

function numberOrZero(value: unknown) {
  return numberOrNull(value) ?? 0;
}

function formatServerNumber(value: number | null | undefined, digits = 1) {
  return typeof value === 'number' && Number.isFinite(value) ? value.toFixed(digits) : '—';
}

function emptyZoneDistances(): Record<IntensityZoneKey, number> {
  return { U3: 0, U2: 0, U1: 0, AT: 0, TPT: 0, AN: 0, ATP: 0 };
}

function emptyTrainingBreakdown(): TrainingBreakdown {
  return {
    waterMinutes: 0,
    ergMinutes: 0,
    landMinutes: {
      functional: 0,
      endurance: 0,
      maxStrength: 0,
      speedStrength: 0,
      recovery: 0,
      running: 0,
      other: 0
    },
    waterDistanceByZone: emptyZoneDistances(),
    waterTimeByZone: emptyZoneDistances(),
    ergDistanceByZone: emptyZoneDistances()
  };
}

function parseTrainingBreakdownJson(value: string): TrainingBreakdown {
  try {
    const parsed = JSON.parse(value || '{}') as Partial<TrainingBreakdown>;
    const fallback = emptyTrainingBreakdown();
    return {
      waterMinutes: Number(parsed.waterMinutes) || 0,
      ergMinutes: Number(parsed.ergMinutes) || 0,
      landMinutes: { ...fallback.landMinutes, ...(parsed.landMinutes || {}) },
      waterDistanceByZone: { ...fallback.waterDistanceByZone, ...(parsed.waterDistanceByZone || {}) },
      waterTimeByZone: { ...fallback.waterTimeByZone, ...(parsed.waterTimeByZone || {}) },
      ergDistanceByZone: { ...fallback.ergDistanceByZone, ...(parsed.ergDistanceByZone || {}) }
    };
  } catch {
    return emptyTrainingBreakdown();
  }
}

function trainingSessionBreakdown(input: { trainingType: string; structureType: string; intensityZone: string; durationMin: number; distanceKm: number }): TrainingBreakdown {
  const breakdown = emptyTrainingBreakdown();
  const zone = input.intensityZone as IntensityZoneKey;
  if ((input.trainingType === '专项训练' || input.distanceKm > 0) && intensityZones.includes(zone)) {
    breakdown.waterMinutes = input.durationMin;
    breakdown.waterDistanceByZone[zone] = input.distanceKm;
    breakdown.waterTimeByZone[zone] = input.durationMin;
  } else if (input.structureType === '最大力量') breakdown.landMinutes.maxStrength = input.durationMin;
  else if (input.structureType === '速度力量') breakdown.landMinutes.speedStrength = input.durationMin;
  else if (input.structureType === '功能训练') breakdown.landMinutes.functional = input.durationMin;
  else if (input.structureType === '再生恢复') breakdown.landMinutes.recovery = input.durationMin;
  else breakdown.landMinutes.other = input.durationMin;
  return breakdown;
}

app.get('/api/teams', (_req, res) => {
  const teams = db.prepare(`
    SELECT pt.id, pt.project, pt.name,
      (SELECT COUNT(*) FROM athletes a WHERE a.project = pt.project AND a.team = pt.name AND a.active = 1) AS athleteCount
    FROM project_teams pt WHERE pt.active = 1 ORDER BY pt.project, pt.name
  `).all();
  res.json({ teams });
});

app.get('/api/admin/teams', requireAuth, requireRole('SCC', 'PRJ', 'REG', 'TD', 'DMD'), (req, res) => {
  const currentUser = req.authUser!;
  const permissions = accountPermissions(currentUser.id);
  const allTeams = db.prepare(`
    SELECT id, project, name FROM project_teams WHERE active = 1 ORDER BY project, name
  `).all() as Array<{ id: number; project: string; name: string }>;
  const athleteIds = accessibleAthleteIds(currentUser);
  const visibleAthletes = athleteIds.length ? db.prepare(`
    SELECT project, team FROM athletes WHERE id IN (${athleteIds.map(() => '?').join(',')}) AND active = 1
  `).all(...athleteIds) as Array<{ project: string; team: string }> : [];
  const athleteCounts = new Map<string, number>();
  for (const athlete of visibleAthletes) {
    const key = `${athlete.project}\u0000${athlete.team}`;
    athleteCounts.set(key, (athleteCounts.get(key) || 0) + 1);
  }
  const teams = allTeams
    .filter((team) => permissionsAllowProjectTeam(permissions, team.project, team.name))
    .map((team) => ({
      ...team,
      athleteCount: athleteCounts.get(`${team.project}\u0000${team.name}`) || 0,
      canDelete: currentUser.role !== 'SCC'
    }));
  const canCreateProjects = currentUser.role === 'SCC' ? [] : PROJECTS.filter((project) =>
    (permissions.projects.includes('*') || permissions.projects.includes(project))
      && permissions.teams.some((item) => (item.project === '*' || item.project === project) && item.team === '*')
  );
  res.json({ teams, canCreateProjects });
});

app.post('/api/admin/teams', requireAuth, requireRole('SCC', 'PRJ', 'REG', 'TD', 'DMD'), (req, res) => {
  const project = cleanString(req.body?.project);
  const name = cleanString(req.body?.name);
  if (!projectSet.has(project)) return res.status(400).json({ message: '请选择有效项目。' });
  if (name.length < 2 || name.length > 30) return res.status(400).json({ message: '队伍名称须为2—30个字符。' });
  const permissions = accountPermissions(req.authUser!.id);
  const canCreate = req.authUser!.role !== 'SCC'
    && (permissions.projects.includes('*') || permissions.projects.includes(project))
    && permissions.teams.some((item) => (item.project === '*' || item.project === project) && item.team === '*');
  if (!canCreate) return res.status(403).json({ message: '无权在该项目下新增队伍。' });
  const existing = db.prepare('SELECT id, active FROM project_teams WHERE project = ? AND name = ?').get(project, name) as { id: number; active: number } | undefined;
  if (existing?.active) return res.status(409).json({ message: '该项目下已存在同名队伍。' });
  if (existing) {
    db.prepare('UPDATE project_teams SET active = 1 WHERE id = ?').run(existing.id);
    return res.status(201).json({ message: '队伍已恢复。', id: existing.id });
  }
  const result = db.prepare('INSERT INTO project_teams (project, name) VALUES (?, ?)').run(project, name);
  res.status(201).json({ message: '队伍已添加。', id: Number(result.lastInsertRowid) });
});

app.delete('/api/admin/teams/:id', requireAuth, requireRole('SCC', 'PRJ', 'REG', 'TD', 'DMD'), (req, res) => {
  const id = Number(req.params.id);
  const team = db.prepare('SELECT id, project, name FROM project_teams WHERE id = ? AND active = 1').get(id) as { id: number; project: string; name: string } | undefined;
  if (!team) return res.status(404).json({ message: '队伍不存在。' });
  if (req.authUser!.role === 'SCC' || !permissionsAllowProjectTeam(accountPermissions(req.authUser!.id), team.project, team.name)) {
    return res.status(403).json({ message: '无权删除该队伍。' });
  }
  const athleteCount = (db.prepare('SELECT COUNT(*) AS count FROM athletes WHERE project = ? AND team = ? AND active = 1').get(team.project, team.name) as { count: number }).count;
  const pendingCount = (db.prepare("SELECT COUNT(*) AS count FROM registration_requests WHERE project = ? AND team = ? AND status = 'pending'").get(team.project, team.name) as { count: number }).count;
  if (athleteCount || pendingCount) return res.status(409).json({ message: '该队伍仍有运动员或待审核申请，不能删除。' });
  db.prepare('UPDATE project_teams SET active = 0 WHERE id = ?').run(id);
  res.json({ message: '队伍已删除。' });
});

app.post('/api/auth/register', (req, res) => {
  if (consumeRateLimit(req, 'register', 30, 15 * 60 * 1000)) {
    return res.status(429).json({ message: '申请次数过多，请稍后再试。' });
  }
  const username = cleanString(req.body?.username).toLowerCase();
  const password = cleanString(req.body?.password);
  const displayName = cleanString(req.body?.displayName);
  const requestedRoleInput = cleanString(req.body?.role);
  const requestedRole = requestedRoleInput === 'athlete' ? 'ATL' : requestedRoleInput;
  const project = cleanString(req.body?.project);
  const team = cleanString(req.body?.team);
  const identityNumber = cleanString(req.body?.identityNumber).toUpperCase();
  const gender = /^\d{17}[\dX]$/.test(identityNumber) ? (Number(identityNumber[16]) % 2 ? '男' : '女') : '';
  const nativePlace = cleanString(req.body?.nativePlace);
  const errors: string[] = [];
  const [nativePlaceProvince = '', nativePlaceCity = '', ...nativePlaceRest] = nativePlace.split('/');

  if (!/^[a-z0-9_]{4,24}$/.test(username)) errors.push('账号须为4—24位字母、数字或下划线');
  if (password.length < 8 || password.length > 72 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) {
    errors.push('密码须为8—72位，并同时包含字母和数字');
  }
  if (displayName.length < 2 || displayName.length > 20) errors.push('姓名须为2—20个字符');
  if (requestedRole !== 'ATL') errors.push('当前仅开放运动员注册');
  if (!projectSet.has(project)) errors.push('请选择赛艇、皮划艇或激流');
  const validTeam = db.prepare('SELECT id FROM project_teams WHERE project = ? AND name = ? AND active = 1').get(project, team);
  if (!validTeam) errors.push('请选择该项目下的有效队伍');
  if (!/^\d{17}[\dX]$/.test(identityNumber)) errors.push('身份证号须为18位，前17位为数字，末位为数字或X');
  if (nativePlaceRest.length || !PROVINCE_CITIES[nativePlaceProvince]?.includes(nativePlaceCity)) {
    errors.push('请选择有效且对应的籍贯省市');
  }
  if (errors.length) return res.status(400).json({ message: errors.join('；') });

  const existingUser = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (existingUser) return res.status(409).json({ message: '该账号已存在。' });
  const existingRequest = db.prepare('SELECT id, status FROM registration_requests WHERE username = ?').get(username) as { id: number; status: string } | undefined;
  if (existingRequest?.status === 'pending') return res.status(409).json({ message: '该账号正在审核中。' });
  if (existingRequest?.status === 'approved') return res.status(409).json({ message: '该账号已通过审核，请直接登录。' });

  const passwordHash = bcrypt.hashSync(password, 11);
  if (existingRequest?.status === 'rejected') {
    db.prepare(`
      UPDATE registration_requests SET password_hash = ?, display_name = ?, requested_role = ?,
        project = ?, team = ?, gender = ?, identity_number = ?, native_place = ?, region = NULL, city = NULL, county = NULL, status = 'pending', reviewed_by = NULL,
        reviewed_at = NULL, created_at = CURRENT_TIMESTAMP WHERE id = ?
    `).run(passwordHash, displayName, requestedRole, project, team, gender, identityNumber, nativePlace, existingRequest.id);
  } else {
    db.prepare(`
      INSERT INTO registration_requests (
        username, password_hash, display_name, requested_role, project, team, gender, identity_number, native_place
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(username, passwordHash, displayName, requestedRole, project, team, gender, identityNumber, nativePlace);
  }
  res.status(201).json({ message: '申请已提交，审核通过后即可登录。' });
});

app.post('/api/auth/login', (req, res) => {
  if (consumeRateLimit(req, 'login', 12, 15 * 60 * 1000)) {
    return res.status(429).json({ message: '登录尝试过多，请稍后再试。' });
  }
  const username = cleanString(req.body?.username).toLowerCase();
  const password = cleanString(req.body?.password);
  const row = db.prepare(
    'SELECT id, username, password_hash, display_name, role, athlete_id FROM users WHERE username = ? AND active = 1'
  ).get(username) as { id: number; username: string; password_hash: string; display_name: string; role: Role; athlete_id: number | null } | undefined;

  if (!row) {
    const request = db.prepare('SELECT status FROM registration_requests WHERE username = ?').get(username) as { status: string } | undefined;
    if (request?.status === 'pending') return res.status(403).json({ message: '账户正在审核中。' });
    if (request?.status === 'rejected') return res.status(403).json({ message: '注册申请未通过，请联系管理员。' });
  }
  if (!row || !bcrypt.compareSync(password, row.password_hash)) {
    return res.status(401).json({ message: '账号或密码不正确。' });
  }

  const user: AuthUser = {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    role: row.role,
    athleteId: row.athlete_id
  };
  const token = jwt.sign(user, jwtSecret, { expiresIn: '12h' });
  clearRateLimit(req, 'login');
  res.json({ token, user });
});

app.get('/api/me', requireAuth, (req, res) => {
  const user = userById(req.authUser!.id);
  if (!user) return res.status(404).json({ message: '账户不存在。' });
  res.json({ user });
});

app.get('/api/preferences/overview-layout', requireAuth, (req, res) => {
  const project = cleanString(req.query.project);
  const scope = cleanString(req.query.scope);
  if (!projectSet.has(project)) return res.status(400).json({ message: '项目参数无效。' });
  if (!['self', 'team'].includes(scope)) return res.status(400).json({ message: '总览范围参数无效。' });

  const row = db.prepare(`
    SELECT layout_json AS layoutJson, updated_at AS updatedAt
    FROM user_dashboard_preferences
    WHERE user_id = ? AND dashboard = 'overview' AND project = ? AND scope = ?
  `).get(req.authUser!.id, project, scope) as { layoutJson: string; updatedAt: string } | undefined;

  if (!row) return res.json({ layout: null, updatedAt: null });
  try {
    const layout = JSON.parse(row.layoutJson) as unknown;
    if (!isOverviewLayoutState(layout)) return res.json({ layout: null, updatedAt: row.updatedAt });
    res.json({ layout, updatedAt: row.updatedAt });
  } catch {
    res.json({ layout: null, updatedAt: row.updatedAt });
  }
});

app.put('/api/preferences/overview-layout', requireAuth, (req, res) => {
  const project = cleanString(req.body?.project);
  const scope = cleanString(req.body?.scope);
  const layout = req.body?.layout as unknown;
  if (!projectSet.has(project)) return res.status(400).json({ message: '项目参数无效。' });
  if (!['self', 'team'].includes(scope)) return res.status(400).json({ message: '总览范围参数无效。' });
  if (!isOverviewLayoutState(layout)) return res.status(400).json({ message: '卡片布局数据无效。' });

  db.prepare(`
    INSERT INTO user_dashboard_preferences (user_id, dashboard, project, scope, layout_json, updated_at)
    VALUES (?, 'overview', ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(user_id, dashboard, project, scope) DO UPDATE SET
      layout_json = excluded.layout_json,
      updated_at = CURRENT_TIMESTAMP
  `).run(req.authUser!.id, project, scope, JSON.stringify(layout));

  const row = db.prepare(`
    SELECT updated_at AS updatedAt
    FROM user_dashboard_preferences
    WHERE user_id = ? AND dashboard = 'overview' AND project = ? AND scope = ?
  `).get(req.authUser!.id, project, scope) as { updatedAt: string } | undefined;
  res.json({ message: '训练总览布局已同步。', updatedAt: row?.updatedAt || new Date().toISOString() });
});

app.put('/api/profile/name', requireAuth, (req, res) => {
  const { name, error } = validatePersonName(req.body?.name);
  if (error) return res.status(400).json({ message: error });
  const current = userById(req.authUser!.id);
  if (!current) return res.status(404).json({ message: '账户不存在。' });

  db.exec('BEGIN');
  try {
    db.prepare('UPDATE users SET display_name = ? WHERE id = ?').run(name, current.id);
    if (current.role === 'ATL' && current.athleteId) {
      db.prepare('UPDATE athletes SET name = ? WHERE id = ?').run(name, current.athleteId);
    }
    db.prepare('INSERT INTO audit_logs (user_id, action, entity_type, entity_id, detail) VALUES (?, ?, ?, ?, ?)')
      .run(current.id, 'UPDATE_OWN_NAME', 'user', current.id, JSON.stringify({ from: current.displayName, to: name }));
    db.exec('COMMIT');
    res.json({ message: '姓名已修改。', user: { ...current, displayName: name } });
  } catch (renameError) {
    db.exec('ROLLBACK');
    const message = renameError instanceof Error && renameError.message.includes('UNIQUE')
      ? '该姓名已被其他运动员使用。'
      : '姓名修改失败。';
    res.status(409).json({ message });
  }
});

app.put('/api/users/:id/name', requireAuth, (req, res) => {
  const targetId = Number(req.params.id);
  const target = userById(targetId);
  if (!target) return res.status(404).json({ message: '账户不存在。' });
  const requester = req.authUser!;
  const canRename = canManageAccount(requester, target);
  if (!canRename) return res.status(403).json({ message: '当前账户没有修改该姓名的权限。' });
  const { name, error } = validatePersonName(req.body?.name);
  if (error) return res.status(400).json({ message: error });

  db.exec('BEGIN');
  try {
    db.prepare('UPDATE users SET display_name = ? WHERE id = ?').run(name, target.id);
    if (target.role === 'ATL' && target.athleteId) {
      db.prepare('UPDATE athletes SET name = ? WHERE id = ?').run(name, target.athleteId);
    }
    db.prepare('INSERT INTO audit_logs (user_id, action, entity_type, entity_id, detail) VALUES (?, ?, ?, ?, ?)')
      .run(requester.id, 'UPDATE_USER_NAME', 'user', target.id, JSON.stringify({ from: target.displayName, to: name }));
    db.exec('COMMIT');
    res.json({ message: '姓名已修改。', displayName: name });
  } catch (renameError) {
    db.exec('ROLLBACK');
    const message = renameError instanceof Error && renameError.message.includes('UNIQUE')
      ? '该姓名已被其他运动员使用。'
      : '姓名修改失败。';
    res.status(409).json({ message });
  }
});

const athleteHealthStatuses = new Set(['健康', '观察', '训练受限', '康复中']);
const athleteTrainingStatuses = new Set(['在训', '集训', '休整', '离队']);

function readAthleteAdminPayload(body: Record<string, unknown>) {
  return {
    name: cleanString(body.name),
    project: cleanString(body.project),
    team: cleanString(body.team),
    gender: cleanString(body.gender),
    region: cleanString(body.region),
    city: cleanString(body.city),
    county: cleanString(body.county),
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
    coachId: Number(body.coachId) || 0
  };
}

function athletePayloadErrors(payload: ReturnType<typeof readAthleteAdminPayload>) {
  const errors: string[] = [];
  const nameResult = validatePersonName(payload.name);
  if (nameResult.error) errors.push(nameResult.error);
  if (!projectSet.has(payload.project)) errors.push('请选择有效的运动项目');
  if (!db.prepare('SELECT id FROM project_teams WHERE project = ? AND name = ? AND active = 1').get(payload.project, payload.team)) errors.push('请选择有效的所属队伍');
  if (!['男', '女'].includes(payload.gender)) errors.push('请选择运动员性别');
  if (!payload.region || !payload.city || !payload.county) errors.push('请填写完整的省、市、区县');
  if (payload.identityNumber && !/^\d{17}[\dX]$/.test(payload.identityNumber)) errors.push('身份证号格式不正确');
  if (payload.phone && !/^1\d{10}$/.test(payload.phone)) errors.push('手机号须为11位');
  if (payload.emergencyPhone && !/^1\d{10}$/.test(payload.emergencyPhone)) errors.push('紧急联系电话须为11位');
  if (!athleteHealthStatuses.has(payload.healthStatus)) errors.push('请选择有效的身体状态');
  if (!athleteTrainingStatuses.has(payload.athleteStatus)) errors.push('请选择有效的运动员状态');
  return errors;
}

function upsertAthleteProfile(athleteId: number, payload: ReturnType<typeof readAthleteAdminPayload>) {
  db.prepare(`
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
  `).run(
    athleteId, payload.identityNumber, payload.ethnicity, payload.phone, payload.bloodType,
    payload.emergencyContact, payload.emergencyPhone, payload.education, payload.technicalLevel,
    payload.athletePosition, payload.healthStatus, payload.bestResult, payload.nativePlace, payload.homeAddress,
    payload.athleteStatus, payload.startSportDate, payload.trainingVenue, payload.currentEvent,
    payload.trainingPhase, payload.campPeriod, payload.originPlace, payload.originUnit,
    payload.originCoach, payload.specialties, payload.notes
  );
}

app.post('/api/admin/athletes', requireAuth, requireRole('PRJ', 'REG', 'TD', 'DMD'), (req, res) => {
  const currentUser = req.authUser!;
  const payload = readAthleteAdminPayload(req.body || {});
  const username = cleanString(req.body?.username).toLowerCase();
  const password = cleanString(req.body?.password);
  const errors = athletePayloadErrors(payload);
  if (!/^[a-z0-9_]{4,24}$/.test(username)) errors.push('登录账号须为4—24位字母、数字或下划线');
  if (password.length < 8 || password.length > 72 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) errors.push('初始密码须为8—72位，并同时包含字母和数字');
  const permissions = {
    areas: [{ areaLevel: 'county' as const, province: payload.region, city: payload.city, county: payload.county }],
    projects: [payload.project],
    teams: [{ project: payload.project, team: payload.team }]
  };
  if (!permissionsContain(accountPermissions(currentUser.id), permissions)) errors.push('运动员范围不能超出当前账号权限');
  if (db.prepare('SELECT id FROM users WHERE username = ?').get(username)) errors.push('该登录账号已存在');
  if (db.prepare('SELECT id FROM athletes WHERE name = ?').get(payload.name)) errors.push('该运动员姓名已存在');
  const coach = payload.coachId ? userById(payload.coachId) : null;
  if (payload.coachId && (!coach || coach.role !== 'SCC' || !canManageAccount(currentUser, coach))) errors.push('请选择可管理范围内的教练');
  if (errors.length) return res.status(400).json({ message: [...new Set(errors)].join('；') });

  db.exec('BEGIN');
  try {
    const athleteResult = db.prepare(`
      INSERT INTO athletes (name, project, team, gender, region, city, county, birth_date)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(payload.name, payload.project, payload.team, payload.gender, payload.region, payload.city, payload.county, payload.birthDate || null);
    const athleteId = Number(athleteResult.lastInsertRowid);
    upsertAthleteProfile(athleteId, payload);
    const userResult = db.prepare(`
      INSERT INTO users (username, password_hash, display_name, role, athlete_id, active)
      VALUES (?, ?, ?, 'ATL', ?, 1)
    `).run(username, bcrypt.hashSync(password, 11), payload.name, athleteId);
    const userId = Number(userResult.lastInsertRowid);
    db.prepare('INSERT INTO account_profiles (user_id, parent_user_id, account_code) VALUES (?, ?, ?)')
      .run(userId, currentUser.id, accountCodeFor(userId, 'ATL', payload.region, payload.project));
    replaceAccountScope({ userId, role: 'ATL', parentUserId: currentUser.id, permissions, grantedBy: currentUser.id });
    if (payload.coachId) db.prepare('INSERT INTO coach_athletes (coach_user_id, athlete_id) VALUES (?, ?)').run(payload.coachId, athleteId);
    db.prepare('INSERT INTO audit_logs (user_id, action, entity_type, entity_id, detail) VALUES (?, ?, ?, ?, ?)')
      .run(currentUser.id, 'CREATE_ATHLETE', 'athlete', athleteId, JSON.stringify({ username, project: payload.project, team: payload.team }));
    db.exec('COMMIT');
    res.status(201).json({ message: '运动员及登录账号已创建。', id: athleteId, accountId: userId });
  } catch (error) {
    db.exec('ROLLBACK');
    res.status(409).json({ message: error instanceof Error && error.message.includes('UNIQUE') ? '运动员姓名或登录账号已存在。' : '运动员创建失败。' });
  }
});

app.put('/api/admin/athletes/:id', requireAuth, requireRole('PRJ', 'REG', 'TD', 'DMD'), (req, res) => {
  const currentUser = req.authUser!;
  const athleteId = Number(req.params.id);
  if (!hasAthleteAccess(currentUser, athleteId)) return res.status(404).json({ message: '运动员不存在或不在可管理范围内。' });
  const payload = readAthleteAdminPayload(req.body || {});
  const errors = athletePayloadErrors(payload);
  const permissions = {
    areas: [{ areaLevel: 'county' as const, province: payload.region, city: payload.city, county: payload.county }],
    projects: [payload.project],
    teams: [{ project: payload.project, team: payload.team }]
  };
  if (!permissionsContain(accountPermissions(currentUser.id), permissions)) errors.push('运动员范围不能超出当前账号权限');
  const coach = payload.coachId ? userById(payload.coachId) : null;
  if (payload.coachId && (!coach || coach.role !== 'SCC' || !canManageAccount(currentUser, coach))) errors.push('请选择可管理范围内的教练');
  if (errors.length) return res.status(400).json({ message: [...new Set(errors)].join('；') });

  db.exec('BEGIN');
  try {
    db.prepare(`UPDATE athletes SET name = ?, project = ?, team = ?, gender = ?, region = ?, city = ?, county = ?, birth_date = ? WHERE id = ?`)
      .run(payload.name, payload.project, payload.team, payload.gender, payload.region, payload.city, payload.county, payload.birthDate || null, athleteId);
    upsertAthleteProfile(athleteId, payload);
    db.prepare("UPDATE users SET display_name = ? WHERE role = 'ATL' AND athlete_id = ?").run(payload.name, athleteId);
    const athleteUser = db.prepare("SELECT u.id, ap.parent_user_id AS parentUserId FROM users u LEFT JOIN account_profiles ap ON ap.user_id = u.id WHERE u.role = 'ATL' AND u.athlete_id = ?")
      .get(athleteId) as { id: number; parentUserId: number | null } | undefined;
    if (athleteUser) replaceAccountScope({ userId: athleteUser.id, role: 'ATL', parentUserId: athleteUser.parentUserId || currentUser.id, permissions, grantedBy: currentUser.id });
    db.prepare('DELETE FROM coach_athletes WHERE athlete_id = ?').run(athleteId);
    if (payload.coachId) db.prepare('INSERT INTO coach_athletes (coach_user_id, athlete_id) VALUES (?, ?)').run(payload.coachId, athleteId);
    db.prepare('INSERT INTO audit_logs (user_id, action, entity_type, entity_id) VALUES (?, ?, ?, ?)')
      .run(currentUser.id, 'UPDATE_ATHLETE_PROFILE', 'athlete', athleteId);
    db.exec('COMMIT');
    res.json({ message: '运动员资料已更新。' });
  } catch (error) {
    db.exec('ROLLBACK');
    res.status(409).json({ message: error instanceof Error && error.message.includes('UNIQUE') ? '该运动员姓名已存在。' : '运动员资料更新失败。' });
  }
});

app.put('/api/admin/athletes/bulk/profile', requireAuth, requireRole('PRJ', 'REG', 'TD', 'DMD'), (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? [...new Set(req.body.ids.map(Number).filter(Number.isFinite))] as number[] : [];
  if (!ids.length || ids.some((id) => !hasAthleteAccess(req.authUser!, id))) return res.status(400).json({ message: '请选择可管理范围内的运动员。' });
  const allowed = [
    ['technicalLevel', 'technical_level'], ['athletePosition', 'position'], ['healthStatus', 'health_status'],
    ['currentEvent', 'current_event'], ['athleteStatus', 'athlete_status'], ['trainingPhase', 'training_phase']
  ] as const;
  const changes = allowed.map(([key, column]) => ({ column, value: cleanString(req.body?.[key]) })).filter((item) => item.value);
  if (!changes.length) return res.status(400).json({ message: '请至少填写一项批量修改内容。' });
  if (changes.some((item) => item.column === 'health_status' && !athleteHealthStatuses.has(item.value))) return res.status(400).json({ message: '身体状态无效。' });
  if (changes.some((item) => item.column === 'athlete_status' && !athleteTrainingStatuses.has(item.value))) return res.status(400).json({ message: '运动员状态无效。' });
  db.exec('BEGIN');
  try {
    for (const id of ids) {
      db.prepare('INSERT OR IGNORE INTO athlete_profiles (athlete_id) VALUES (?)').run(id);
      for (const change of changes) db.prepare(`UPDATE athlete_profiles SET ${change.column} = ?, updated_at = CURRENT_TIMESTAMP WHERE athlete_id = ?`).run(change.value, id);
      db.prepare('INSERT INTO audit_logs (user_id, action, entity_type, entity_id) VALUES (?, ?, ?, ?)').run(req.authUser!.id, 'BULK_UPDATE_ATHLETE', 'athlete', id);
    }
    db.exec('COMMIT');
    res.json({ message: `已更新 ${ids.length} 名运动员。` });
  } catch {
    db.exec('ROLLBACK');
    res.status(500).json({ message: '批量修改失败。' });
  }
});

app.post('/api/admin/athletes/bulk/delete', requireAuth, requireRole('PRJ', 'REG', 'TD', 'DMD'), (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? [...new Set(req.body.ids.map(Number).filter(Number.isFinite))] as number[] : [];
  if (!ids.length || ids.some((id) => !hasAthleteAccess(req.authUser!, id))) return res.status(400).json({ message: '请选择可管理范围内的运动员。' });
  const placeholders = ids.map(() => '?').join(',');
  db.exec('BEGIN');
  try {
    db.prepare(`UPDATE athletes SET active = 0 WHERE id IN (${placeholders})`).run(...ids);
    db.prepare(`UPDATE users SET active = 0 WHERE role = 'ATL' AND athlete_id IN (${placeholders})`).run(...ids);
    for (const id of ids) db.prepare('INSERT INTO audit_logs (user_id, action, entity_type, entity_id) VALUES (?, ?, ?, ?)').run(req.authUser!.id, 'DELETE_ATHLETE', 'athlete', id);
    db.exec('COMMIT');
    res.json({ message: `已删除 ${ids.length} 名运动员。` });
  } catch {
    db.exec('ROLLBACK');
    res.status(500).json({ message: '运动员删除失败。' });
  }
});

app.delete('/api/admin/athletes/:id', requireAuth, requireRole('PRJ', 'REG', 'TD', 'DMD'), (req, res) => {
  const athleteId = Number(req.params.id);
  if (!hasAthleteAccess(req.authUser!, athleteId)) return res.status(404).json({ message: '运动员不存在或不在可管理范围内。' });
  db.exec('BEGIN');
  try {
    db.prepare('UPDATE athletes SET active = 0 WHERE id = ?').run(athleteId);
    db.prepare("UPDATE users SET active = 0 WHERE role = 'ATL' AND athlete_id = ?").run(athleteId);
    db.prepare('INSERT INTO audit_logs (user_id, action, entity_type, entity_id) VALUES (?, ?, ?, ?)').run(req.authUser!.id, 'DELETE_ATHLETE', 'athlete', athleteId);
    db.exec('COMMIT');
    res.json({ message: '运动员已删除。' });
  } catch {
    db.exec('ROLLBACK');
    res.status(500).json({ message: '运动员删除失败。' });
  }
});

app.put('/api/admin/athletes/:id/name', requireAuth, (req, res) => {
  const athleteId = Number(req.params.id);
  if (!canManageRole(req.authUser!.role, 'ATL') || !hasAthleteAccess(req.authUser!, athleteId)) {
    return res.status(403).json({ message: '当前账户不能修改该运动员姓名。' });
  }
  const athlete = db.prepare('SELECT id, name FROM athletes WHERE id = ?').get(athleteId) as { id: number; name: string } | undefined;
  if (!athlete) return res.status(404).json({ message: '运动员不存在。' });
  const { name, error } = validatePersonName(req.body?.name);
  if (error) return res.status(400).json({ message: error });

  db.exec('BEGIN');
  try {
    db.prepare('UPDATE athletes SET name = ? WHERE id = ?').run(name, athleteId);
    db.prepare("UPDATE users SET display_name = ? WHERE athlete_id = ? AND role = 'ATL'").run(name, athleteId);
    db.prepare('INSERT INTO audit_logs (user_id, action, entity_type, entity_id, detail) VALUES (?, ?, ?, ?, ?)')
      .run(req.authUser!.id, 'UPDATE_ATHLETE_NAME', 'athlete', athleteId, JSON.stringify({ from: athlete.name, to: name }));
    db.exec('COMMIT');
    res.json({ message: '运动员姓名已修改。', name });
  } catch (renameError) {
    db.exec('ROLLBACK');
    const message = renameError instanceof Error && renameError.message.includes('UNIQUE')
      ? '该姓名已被其他运动员使用。'
      : '姓名修改失败。';
    res.status(409).json({ message });
  }
});

app.post('/api/auth/change-password', requireAuth, (req, res) => {
  if (consumeRateLimit(req, 'change-password', 6, 15 * 60 * 1000)) {
    return res.status(429).json({ message: '操作次数过多，请稍后再试。' });
  }
  const currentPassword = cleanString(req.body?.currentPassword);
  const newPassword = cleanString(req.body?.newPassword);
  if (newPassword.length < 8 || newPassword.length > 72 || !/[A-Za-z]/.test(newPassword) || !/\d/.test(newPassword)) {
    return res.status(400).json({ message: '新密码须为8—72位，并同时包含字母和数字。' });
  }
  if (currentPassword === newPassword) return res.status(400).json({ message: '新密码不能与当前密码相同。' });
  const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.authUser!.id) as { password_hash: string } | undefined;
  if (!row || !bcrypt.compareSync(currentPassword, row.password_hash)) {
    return res.status(401).json({ message: '当前密码不正确。' });
  }
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(newPassword, 11), req.authUser!.id);
  db.prepare('INSERT INTO audit_logs (user_id, action, entity_type, entity_id) VALUES (?, ?, ?, ?)')
    .run(req.authUser!.id, 'CHANGE_PASSWORD', 'user', req.authUser!.id);
  clearRateLimit(req, 'change-password');
  res.json({ message: '密码已修改。' });
});

app.get('/api/athletes', requireAuth, (req, res) => {
  const ids = accessibleAthleteIds(req.authUser!);
  if (!ids.length) return res.json({ athletes: [] });
  const placeholders = ids.map(() => '?').join(',');
  const athletes = db.prepare(`
    SELECT a.id, a.name, a.project, a.team, a.gender, a.region, a.region AS province, a.city, a.county,
      a.photo_url AS photoUrl, a.birth_date AS birthDate, COALESCE(ap.identity_number, '') AS identityNumber,
      COALESCE(ap.ethnicity, '汉族') AS ethnicity, COALESCE(ap.phone, '') AS phone,
      COALESCE(ap.blood_type, '') AS bloodType, COALESCE(ap.emergency_contact, '') AS emergencyContact,
      COALESCE(ap.emergency_phone, '') AS emergencyPhone, COALESCE(ap.education, '') AS education,
      COALESCE(ap.technical_level, '') AS technicalLevel, COALESCE(ap.position, '') AS athletePosition,
      COALESCE(ap.best_result, '') AS bestResult,
      COALESCE(ap.native_place, '') AS nativePlace, COALESCE(ap.home_address, '') AS homeAddress,
      COALESCE(ap.athlete_status, '在训') AS athleteStatus, COALESCE(ap.start_sport_date, '') AS startSportDate,
      COALESCE(ap.training_venue, '') AS trainingVenue, COALESCE(ap.current_event, '') AS currentEvent,
      COALESCE(ap.training_phase, '') AS trainingPhase, COALESCE(ap.camp_period, '') AS campPeriod,
      COALESCE(ap.origin_place, '') AS originPlace, COALESCE(ap.origin_unit, '') AS originUnit,
      COALESCE(ap.origin_coach, '') AS originCoach, COALESCE(ap.specialties, '') AS specialties,
      COALESCE(ap.notes, '') AS notes, COALESCE(ap.created_at, '2026-01-01 00:00:00') AS createdAt,
      COALESCE((SELECT CASE ir.status WHEN 'healthy' THEN '健康' WHEN 'observation' THEN '观察' WHEN 'rehab' THEN '康复中' ELSE '训练受限' END
        FROM injury_records ir WHERE ir.athlete_id = a.id ORDER BY ir.created_at DESC, ir.id DESC LIMIT 1), ap.health_status, '健康') AS healthStatus,
      (SELECT bm.height_cm FROM athlete_body_measurements bm WHERE bm.athlete_id = a.id ORDER BY bm.measurement_date DESC, bm.id DESC LIMIT 1) AS heightCm,
      (SELECT bm.weight_kg FROM athlete_body_measurements bm WHERE bm.athlete_id = a.id ORDER BY bm.measurement_date DESC, bm.id DESC LIMIT 1) AS weightKg,
      (SELECT bm.body_fat_pct FROM athlete_body_measurements bm WHERE bm.athlete_id = a.id ORDER BY bm.measurement_date DESC, bm.id DESC LIMIT 1) AS bodyFatPct,
      (SELECT bm.skeletal_muscle_kg FROM athlete_body_measurements bm WHERE bm.athlete_id = a.id ORDER BY bm.measurement_date DESC, bm.id DESC LIMIT 1) AS skeletalMuscleKg,
      (SELECT bm.muscle_mass_kg FROM athlete_body_measurements bm WHERE bm.athlete_id = a.id ORDER BY bm.measurement_date DESC, bm.id DESC LIMIT 1) AS muscleMassKg,
      (SELECT bm.upper_limb_muscle_kg FROM athlete_body_measurements bm WHERE bm.athlete_id = a.id ORDER BY bm.measurement_date DESC, bm.id DESC LIMIT 1) AS upperLimbMuscleKg,
      (SELECT bm.lower_limb_muscle_kg FROM athlete_body_measurements bm WHERE bm.athlete_id = a.id ORDER BY bm.measurement_date DESC, bm.id DESC LIMIT 1) AS lowerLimbMuscleKg,
      (SELECT bm.trunk_muscle_kg FROM athlete_body_measurements bm WHERE bm.athlete_id = a.id ORDER BY bm.measurement_date DESC, bm.id DESC LIMIT 1) AS trunkMuscleKg,
      (SELECT bm.subcutaneous_fat_mm FROM athlete_body_measurements bm WHERE bm.athlete_id = a.id ORDER BY bm.measurement_date DESC, bm.id DESC LIMIT 1) AS subcutaneousFatMm,
      (SELECT bm.triceps_skinfold_mm FROM athlete_body_measurements bm WHERE bm.athlete_id = a.id ORDER BY bm.measurement_date DESC, bm.id DESC LIMIT 1) AS tricepsSkinfoldMm,
      (SELECT bm.abdominal_skinfold_mm FROM athlete_body_measurements bm WHERE bm.athlete_id = a.id ORDER BY bm.measurement_date DESC, bm.id DESC LIMIT 1) AS abdominalSkinfoldMm,
      (SELECT bm.thigh_skinfold_mm FROM athlete_body_measurements bm WHERE bm.athlete_id = a.id ORDER BY bm.measurement_date DESC, bm.id DESC LIMIT 1) AS thighSkinfoldMm,
      (SELECT bm.calf_skinfold_mm FROM athlete_body_measurements bm WHERE bm.athlete_id = a.id ORDER BY bm.measurement_date DESC, bm.id DESC LIMIT 1) AS calfSkinfoldMm,
      (SELECT bm.visceral_fat_level FROM athlete_body_measurements bm WHERE bm.athlete_id = a.id ORDER BY bm.measurement_date DESC, bm.id DESC LIMIT 1) AS visceralFatLevel,
      (SELECT bm.basal_metabolism_kcal FROM athlete_body_measurements bm WHERE bm.athlete_id = a.id ORDER BY bm.measurement_date DESC, bm.id DESC LIMIT 1) AS basalMetabolismKcal,
      (SELECT bm.total_body_water_kg FROM athlete_body_measurements bm WHERE bm.athlete_id = a.id ORDER BY bm.measurement_date DESC, bm.id DESC LIMIT 1) AS totalBodyWaterKg,
      (SELECT bm.ecw_tbw_ratio FROM athlete_body_measurements bm WHERE bm.athlete_id = a.id ORDER BY bm.measurement_date DESC, bm.id DESC LIMIT 1) AS ecwTbwRatio,
      (SELECT bm.phase_angle_deg FROM athlete_body_measurements bm WHERE bm.athlete_id = a.id ORDER BY bm.measurement_date DESC, bm.id DESC LIMIT 1) AS phaseAngleDeg,
      (SELECT bm.visceral_fat_area_cm2 FROM athlete_body_measurements bm WHERE bm.athlete_id = a.id ORDER BY bm.measurement_date DESC, bm.id DESC LIMIT 1) AS visceralFatAreaCm2,
      (SELECT bm.left_arm_lean_kg FROM athlete_body_measurements bm WHERE bm.athlete_id = a.id ORDER BY bm.measurement_date DESC, bm.id DESC LIMIT 1) AS leftArmLeanKg,
      (SELECT bm.right_arm_lean_kg FROM athlete_body_measurements bm WHERE bm.athlete_id = a.id ORDER BY bm.measurement_date DESC, bm.id DESC LIMIT 1) AS rightArmLeanKg,
      (SELECT bm.trunk_lean_kg FROM athlete_body_measurements bm WHERE bm.athlete_id = a.id ORDER BY bm.measurement_date DESC, bm.id DESC LIMIT 1) AS trunkLeanKg,
      (SELECT bm.left_leg_lean_kg FROM athlete_body_measurements bm WHERE bm.athlete_id = a.id ORDER BY bm.measurement_date DESC, bm.id DESC LIMIT 1) AS leftLegLeanKg,
      (SELECT bm.right_leg_lean_kg FROM athlete_body_measurements bm WHERE bm.athlete_id = a.id ORDER BY bm.measurement_date DESC, bm.id DESC LIMIT 1) AS rightLegLeanKg,
      (SELECT bm.measurement_date FROM athlete_body_measurements bm WHERE bm.athlete_id = a.id ORDER BY bm.measurement_date DESC, bm.id DESC LIMIT 1) AS bodyMeasurementDate,
      COALESCE((SELECT bm.note FROM athlete_body_measurements bm WHERE bm.athlete_id = a.id ORDER BY bm.measurement_date DESC, bm.id DESC LIMIT 1), '') AS bodyMeasurementNote,
      GROUP_CONCAT(u.display_name, '、') AS coaches
    FROM athletes a
    LEFT JOIN athlete_profiles ap ON ap.athlete_id = a.id
    LEFT JOIN coach_athletes ca ON ca.athlete_id = a.id
    LEFT JOIN users u ON u.id = ca.coach_user_id
    WHERE a.id IN (${placeholders}) AND a.active = 1
    GROUP BY a.id ORDER BY a.project, a.team, a.name
  `).all(...ids) as Array<{
    id: number;
    name: string;
    project: string;
    team: string;
    gender: string;
    region: string;
    province: string;
    city: string;
    county: string;
    photoUrl: string;
    birthDate: string | null;
    heightCm: number | null;
    weightKg: number | null;
    bodyFatPct: number | null;
    skeletalMuscleKg: number | null;
    muscleMassKg: number | null;
    upperLimbMuscleKg: number | null;
    lowerLimbMuscleKg: number | null;
    trunkMuscleKg: number | null;
    subcutaneousFatMm: number | null;
    tricepsSkinfoldMm: number | null;
    abdominalSkinfoldMm: number | null;
    thighSkinfoldMm: number | null;
    calfSkinfoldMm: number | null;
    visceralFatLevel: number | null;
    basalMetabolismKcal: number | null;
    totalBodyWaterKg: number | null;
    ecwTbwRatio: number | null;
    phaseAngleDeg: number | null;
    visceralFatAreaCm2: number | null;
    leftArmLeanKg: number | null;
    rightArmLeanKg: number | null;
    trunkLeanKg: number | null;
    leftLegLeanKg: number | null;
    rightLegLeanKg: number | null;
    bodyMeasurementDate: string | null;
    bodyMeasurementNote: string;
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
    coaches: string | null;
  }>;
  const coachRows = db.prepare(`
    SELECT ca.athlete_id AS athleteId, u.id, u.display_name AS displayName
    FROM coach_athletes ca
    JOIN users u ON u.id = ca.coach_user_id
    WHERE ca.athlete_id IN (${placeholders})
    ORDER BY u.display_name
  `).all(...ids) as Array<{ athleteId: number; id: number; displayName: string }>;
  res.json({
    athletes: athletes.map((athlete) => ({
      ...athlete,
      coaches: athlete.coaches || '',
      coachUsers: coachRows
        .filter((coach) => coach.athleteId === athlete.id)
        .map(({ id, displayName }) => ({ id, displayName }))
    }))
  });
});

app.put('/api/athletes/:id/position', requireAuth, (req, res) => {
  const user = req.authUser!;
  const athleteId = Number(req.params.id);
  if (!athleteId || !hasAthleteAccess(user, athleteId)) {
    return res.status(403).json({ message: '无权维护该运动员的位置/号位。' });
  }
  if (user.role === 'ATL' && user.athleteId !== athleteId) {
    return res.status(403).json({ message: '运动员只能修改本人的位置/号位。' });
  }
  const athletePosition = cleanString(req.body?.athletePosition);
  if (athletePosition.length > 40) return res.status(400).json({ message: '位置/号位不能超过40个字符。' });
  const athlete = db.prepare('SELECT id FROM athletes WHERE id = ? AND active = 1').get(athleteId);
  if (!athlete) return res.status(404).json({ message: '运动员不存在。' });
  db.prepare('INSERT OR IGNORE INTO athlete_profiles (athlete_id) VALUES (?)').run(athleteId);
  db.prepare('UPDATE athlete_profiles SET position = ?, updated_at = CURRENT_TIMESTAMP WHERE athlete_id = ?').run(athletePosition, athleteId);
  db.prepare('INSERT INTO audit_logs (user_id, action, entity_type, entity_id, detail) VALUES (?, ?, ?, ?, ?)')
    .run(user.id, 'UPDATE_ATHLETE_POSITION', 'athlete', athleteId, JSON.stringify({ athletePosition }));
  res.json({ message: '位置/号位已保存。', athletePosition });
});

const bodyCompositionFields = [
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
  ['rightLegLeanKg', 'right_leg_lean_kg', 2, 35]
] as const;

app.get('/api/athletes/:id/body-composition', requireAuth, (req, res) => {
  const user = req.authUser!;
  const athleteId = Number(req.params.id);
  if (!athleteId || !hasAthleteAccess(user, athleteId)) {
    return res.status(403).json({ message: '无权查看该运动员的身体成分数据。' });
  }
  const athlete = db.prepare('SELECT id FROM athletes WHERE id = ? AND active = 1').get(athleteId);
  if (!athlete) return res.status(404).json({ message: '运动员不存在。' });
  const history = db.prepare(`
    SELECT measurement_date AS measurementDate,
      height_cm AS heightCm, weight_kg AS weightKg, body_fat_pct AS bodyFatPct,
      skeletal_muscle_kg AS skeletalMuscleKg, muscle_mass_kg AS muscleMassKg,
      upper_limb_muscle_kg AS upperLimbMuscleKg, lower_limb_muscle_kg AS lowerLimbMuscleKg,
      trunk_muscle_kg AS trunkMuscleKg, subcutaneous_fat_mm AS subcutaneousFatMm,
      triceps_skinfold_mm AS tricepsSkinfoldMm, abdominal_skinfold_mm AS abdominalSkinfoldMm,
      thigh_skinfold_mm AS thighSkinfoldMm, calf_skinfold_mm AS calfSkinfoldMm,
      visceral_fat_level AS visceralFatLevel, basal_metabolism_kcal AS basalMetabolismKcal,
      total_body_water_kg AS totalBodyWaterKg, ecw_tbw_ratio AS ecwTbwRatio,
      phase_angle_deg AS phaseAngleDeg, visceral_fat_area_cm2 AS visceralFatAreaCm2,
      left_arm_lean_kg AS leftArmLeanKg, right_arm_lean_kg AS rightArmLeanKg,
      trunk_lean_kg AS trunkLeanKg, left_leg_lean_kg AS leftLegLeanKg,
      right_leg_lean_kg AS rightLegLeanKg, COALESCE(note, '') AS note
    FROM athlete_body_measurements
    WHERE athlete_id = ?
    ORDER BY measurement_date DESC, id DESC
    LIMIT 24
  `).all(athleteId);
  res.json({ history });
});

app.put('/api/athletes/:id/body-composition', requireAuth, (req, res) => {
  const user = req.authUser!;
  const athleteId = Number(req.params.id);
  if (!athleteId || !hasAthleteAccess(user, athleteId)) {
    return res.status(403).json({ message: '无权维护该运动员的身体成分数据。' });
  }
  if (user.role === 'ATL' && user.athleteId !== athleteId) {
    return res.status(403).json({ message: '运动员只能填写本人的身体成分数据。' });
  }
  const athlete = db.prepare('SELECT id FROM athletes WHERE id = ? AND active = 1').get(athleteId);
  if (!athlete) return res.status(404).json({ message: '运动员不存在。' });
  const measurementDate = parseDate(req.body?.measurementDate);
  if (!measurementDate || !isValidIsoDate(measurementDate)) return res.status(400).json({ message: '测量日期格式无效。' });

  const values: Record<string, number | null> = {};
  for (const [inputKey, , min, max] of bodyCompositionFields) {
    const value = numberOrNull(req.body?.[inputKey]);
    if (value !== null && (value < min || value > max)) {
      return res.status(400).json({ message: `${inputKey}超出合理范围。` });
    }
    values[inputKey] = value;
  }
  if (Object.values(values).every((value) => value === null)) {
    return res.status(400).json({ message: '请至少填写一项身体成分指标。' });
  }
  const note = cleanString(req.body?.note).slice(0, 300);
  db.prepare(`
    INSERT INTO athlete_body_measurements (
      athlete_id, measurement_date, height_cm, weight_kg, body_fat_pct,
      skeletal_muscle_kg, muscle_mass_kg, upper_limb_muscle_kg, lower_limb_muscle_kg,
      trunk_muscle_kg, subcutaneous_fat_mm, triceps_skinfold_mm, abdominal_skinfold_mm,
      thigh_skinfold_mm, calf_skinfold_mm, visceral_fat_level, basal_metabolism_kcal,
      total_body_water_kg, ecw_tbw_ratio, phase_angle_deg, visceral_fat_area_cm2,
      left_arm_lean_kg, right_arm_lean_kg, trunk_lean_kg, left_leg_lean_kg, right_leg_lean_kg,
      note, source, quality
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'manual', 'valid')
    ON CONFLICT(athlete_id, measurement_date) DO UPDATE SET
      height_cm = excluded.height_cm, weight_kg = excluded.weight_kg, body_fat_pct = excluded.body_fat_pct,
      skeletal_muscle_kg = excluded.skeletal_muscle_kg, muscle_mass_kg = excluded.muscle_mass_kg,
      upper_limb_muscle_kg = excluded.upper_limb_muscle_kg, lower_limb_muscle_kg = excluded.lower_limb_muscle_kg,
      trunk_muscle_kg = excluded.trunk_muscle_kg, subcutaneous_fat_mm = excluded.subcutaneous_fat_mm,
      triceps_skinfold_mm = excluded.triceps_skinfold_mm, abdominal_skinfold_mm = excluded.abdominal_skinfold_mm,
      thigh_skinfold_mm = excluded.thigh_skinfold_mm, calf_skinfold_mm = excluded.calf_skinfold_mm,
      visceral_fat_level = excluded.visceral_fat_level, basal_metabolism_kcal = excluded.basal_metabolism_kcal,
      total_body_water_kg = excluded.total_body_water_kg, ecw_tbw_ratio = excluded.ecw_tbw_ratio,
      phase_angle_deg = excluded.phase_angle_deg, visceral_fat_area_cm2 = excluded.visceral_fat_area_cm2,
      left_arm_lean_kg = excluded.left_arm_lean_kg, right_arm_lean_kg = excluded.right_arm_lean_kg,
      trunk_lean_kg = excluded.trunk_lean_kg, left_leg_lean_kg = excluded.left_leg_lean_kg,
      right_leg_lean_kg = excluded.right_leg_lean_kg,
      note = excluded.note, source = 'manual', quality = 'valid'
  `).run(
    athleteId, measurementDate, values.heightCm, values.weightKg, values.bodyFatPct,
    values.skeletalMuscleKg, values.muscleMassKg, values.upperLimbMuscleKg, values.lowerLimbMuscleKg,
    values.trunkMuscleKg, values.subcutaneousFatMm, values.tricepsSkinfoldMm, values.abdominalSkinfoldMm,
    values.thighSkinfoldMm, values.calfSkinfoldMm, values.visceralFatLevel, values.basalMetabolismKcal,
    values.totalBodyWaterKg, values.ecwTbwRatio, values.phaseAngleDeg, values.visceralFatAreaCm2,
    values.leftArmLeanKg, values.rightArmLeanKg, values.trunkLeanKg, values.leftLegLeanKg, values.rightLegLeanKg,
    note
  );
  db.prepare('INSERT INTO audit_logs (user_id, action, entity_type, entity_id, detail) VALUES (?, ?, ?, ?, ?)')
    .run(user.id, 'UPSERT_BODY_COMPOSITION', 'athlete', athleteId, JSON.stringify({ measurementDate }));
  res.json({ message: '身体成分数据已保存。' });
});

app.post('/api/athletes/:id/photo', requireAuth, photoUpload.single('photo'), (req, res) => {
  const user = req.authUser!;
  const athleteId = Number(req.params.id);
  if (!athleteId || !hasAthleteAccess(user, athleteId)) {
    return res.status(403).json({ message: '无权维护该运动员的证件照。' });
  }
  if (user.role === 'ATL' && user.athleteId !== athleteId) {
    return res.status(403).json({ message: '运动员只能上传本人的证件照。' });
  }
  const athlete = db.prepare('SELECT id FROM athletes WHERE id = ? AND active = 1').get(athleteId);
  if (!athlete) return res.status(404).json({ message: '运动员不存在。' });
  if (!req.file) return res.status(400).json({ message: '请选择一张证件照。' });
  const extension = req.file.mimetype === 'image/png' ? 'png' : 'jpg';
  const filename = `athlete-${athleteId}-${randomUUID()}.${extension}`;
  writeFileSync(resolve(athletePhotoRoot, filename), req.file.buffer);
  const photoUrl = `/uploads/athlete-photos/${filename}`;
  db.prepare('UPDATE athletes SET photo_url = ? WHERE id = ?').run(photoUrl, athleteId);
  db.prepare('INSERT INTO audit_logs (user_id, action, entity_type, entity_id, detail) VALUES (?, ?, ?, ?, ?)')
    .run(user.id, 'UPLOAD_ATHLETE_PHOTO', 'athlete', athleteId, JSON.stringify({ photoUrl }));
  res.json({ message: '证件照已保存，并已绑定到该运动员。', photoUrl });
});

const injuryStatuses = new Set(['healthy', 'observation', 'restricted', 'rehab', 'suspended']);
const injurySides = new Set(['left', 'right', 'bilateral', 'center', 'unspecified']);

function injuryRecordById(recordId: number) {
  return db.prepare(`
    SELECT ir.id, ir.athlete_id AS athleteId, ir.record_type AS recordType,
      ir.injury_name AS injuryName, ir.body_part AS bodyPart, ir.side, ir.status,
      ir.pain_score AS painScore, ir.onset_date AS onsetDate,
      ir.restrictions, ir.rehab_plan AS rehabPlan, ir.review_date AS reviewDate,
      ir.note, u.display_name AS createdBy, u.role AS creatorRole, ir.created_at AS createdAt
    FROM injury_records ir
    JOIN users u ON u.id = ir.created_by
    WHERE ir.id = ?
  `).get(recordId);
}

app.get('/api/athletes/:id/injuries', requireAuth, (req, res) => {
  const athleteId = Number(req.params.id || 0);
  if (!athleteId || !hasAthleteAccess(req.authUser!, athleteId)) {
    return res.status(403).json({ message: '无权查看该运动员的伤病记录。' });
  }
  const records = db.prepare(`
    SELECT ir.id, ir.athlete_id AS athleteId, ir.record_type AS recordType,
      ir.injury_name AS injuryName, ir.body_part AS bodyPart, ir.side, ir.status,
      ir.pain_score AS painScore, ir.onset_date AS onsetDate,
      ir.restrictions, ir.rehab_plan AS rehabPlan, ir.review_date AS reviewDate,
      ir.note, u.display_name AS createdBy, u.role AS creatorRole, ir.created_at AS createdAt
    FROM injury_records ir
    JOIN users u ON u.id = ir.created_by
    WHERE ir.athlete_id = ?
    ORDER BY ir.created_at DESC, ir.id DESC
    LIMIT 100
  `).all(athleteId);
  res.json({ records });
});

app.post('/api/athletes/:id/injuries', requireAuth, (req, res) => {
  const user = req.authUser!;
  const athleteId = Number(req.params.id || 0);
  if (!athleteId || !hasAthleteAccess(user, athleteId)) {
    return res.status(403).json({ message: '无权为该运动员新增伤病记录。' });
  }
  const isAthleteFeedback = user.role === 'ATL';
  if (isAthleteFeedback && user.athleteId !== athleteId) {
    return res.status(403).json({ message: '运动员只能提交本人的疼痛反馈。' });
  }
  const bodyPart = cleanString(req.body?.bodyPart);
  const injuryName = cleanString(req.body?.injuryName);
  const side = cleanString(req.body?.side) || 'unspecified';
  const requestedStatus = cleanString(req.body?.status);
  const painScore = Number(req.body?.painScore);
  const onsetDate = cleanString(req.body?.onsetDate);
  const reviewDate = cleanString(req.body?.reviewDate);
  const restrictions = isAthleteFeedback ? '' : cleanString(req.body?.restrictions);
  const rehabPlan = isAthleteFeedback ? '' : cleanString(req.body?.rehabPlan);
  const note = cleanString(req.body?.note);
  const status = isAthleteFeedback ? 'observation' : requestedStatus;
  const errors: string[] = [];
  if (!bodyPart || bodyPart.length > 30) errors.push('请选择或填写有效的伤病部位');
  if (!injuryName || injuryName.length > 80) errors.push(isAthleteFeedback ? '请填写不适情况' : '请填写问题名称或诊断');
  if (!injurySides.has(side)) errors.push('请选择有效的身体侧别');
  if (!injuryStatuses.has(status)) errors.push('请选择有效的健康状态');
  if (!Number.isInteger(painScore) || painScore < 0 || painScore > 10) errors.push('疼痛评分应为0至10的整数');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(onsetDate)) errors.push('请选择首次出现日期');
  if (reviewDate && !/^\d{4}-\d{2}-\d{2}$/.test(reviewDate)) errors.push('复查日期格式错误');
  if (restrictions.length > 500 || rehabPlan.length > 500 || note.length > 800) errors.push('文字内容过长');
  if (errors.length) return res.status(400).json({ message: errors.join('；') });

  const result = db.prepare(`
    INSERT INTO injury_records
      (athlete_id, record_type, injury_name, body_part, side, status, pain_score,
       onset_date, restrictions, rehab_plan, review_date, note, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    athleteId,
    isAthleteFeedback ? 'feedback' : 'formal',
    injuryName,
    bodyPart,
    side,
    status,
    painScore,
    onsetDate,
    restrictions,
    rehabPlan,
    reviewDate,
    note,
    user.id
  );
  const recordId = Number(result.lastInsertRowid);
  db.prepare('INSERT INTO audit_logs (user_id, action, entity_type, entity_id, detail) VALUES (?, ?, ?, ?, ?)')
    .run(user.id, isAthleteFeedback ? 'SUBMIT_INJURY_FEEDBACK' : 'CREATE_INJURY_RECORD', 'injury_record', recordId, JSON.stringify({ athleteId, bodyPart, status, painScore }));
  res.status(201).json({
    message: isAthleteFeedback ? '疼痛反馈已提交，等待教练确认。' : '伤病与恢复记录已保存。',
    record: injuryRecordById(recordId)
  });
});

app.get('/api/training-plans', requireAuth, (req, res) => {
  const user = req.authUser!;
  const athleteId = Number(req.query.athleteId || user.athleteId || 0);
  if (!athleteId) return res.status(400).json({ message: '请选择一名运动员。' });
  if (!hasAthleteAccess(user, athleteId)) return res.status(403).json({ message: '无权查看该运动员的体能训练。' });
  const rows = db.prepare(`
    SELECT tp.id, tp.athlete_id AS athleteId, a.name AS athleteName, a.project, a.team,
      a.photo_url AS photoUrl, tp.plan_data AS dataJson, tp.updated_at AS updatedAt,
      u.display_name AS updatedBy
    FROM training_plans tp
    JOIN athletes a ON a.id = tp.athlete_id
    JOIN users u ON u.id = tp.updated_by
    WHERE tp.athlete_id = ?
    ORDER BY tp.start_date DESC, tp.id DESC
  `).all(athleteId) as Array<{
    id: number;
    athleteId: number;
    athleteName: string;
    project: string;
    team: string;
    photoUrl: string;
    dataJson: string;
    updatedAt: string;
    updatedBy: string;
  }>;
  res.json({
    plans: rows.map(({ dataJson, ...row }) => ({
      ...row,
      data: readStoredTrainingPlanData(dataJson)
    }))
  });
});

app.post('/api/training-plans', requireAuth, requireRole('SCC', 'PRJ', 'REG', 'TD', 'DMD'), (req, res) => {
  const user = req.authUser!;
  const athleteId = Number(req.body?.athleteId || 0);
  const requestedPlanId = Number(req.body?.planId || 0);
  if (!athleteId || !hasAthleteAccess(user, athleteId)) {
    return res.status(403).json({ message: '无权维护该运动员的体能训练。' });
  }
  const parsed = parseTrainingPlanData(req.body?.data);
  if (parsed.errors.length) return res.status(400).json({ message: parsed.errors.join('；') });
  const existing = requestedPlanId
    ? db.prepare('SELECT id FROM training_plans WHERE id = ? AND athlete_id = ?').get(requestedPlanId, athleteId) as { id: number } | undefined
    : db.prepare('SELECT id FROM training_plans WHERE athlete_id = ? AND plan_date = ?').get(athleteId, parsed.data.startDate) as { id: number } | undefined;
  if (requestedPlanId && !existing) return res.status(404).json({ message: '要更新的历史训练不存在。' });
  try {
    if (existing) {
      db.prepare(`
        UPDATE training_plans SET
          plan_date = ?, start_date = ?, end_date = ?, title = ?, schedule_label = ?,
          plan_data = ?, updated_by = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(
        parsed.data.startDate,
        parsed.data.startDate,
        parsed.data.endDate,
        parsed.data.title,
        parsed.data.scheduleLabel,
        JSON.stringify(parsed.data),
        user.id,
        existing.id
      );
    } else {
      db.prepare(`
        INSERT INTO training_plans
          (athlete_id, plan_date, start_date, end_date, title, schedule_label, plan_data, created_by, updated_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        athleteId,
        parsed.data.startDate,
        parsed.data.startDate,
        parsed.data.endDate,
        parsed.data.title,
        parsed.data.scheduleLabel,
        JSON.stringify(parsed.data),
        user.id,
        user.id
      );
    }
  } catch (saveError) {
    if (saveError instanceof Error && saveError.message.includes('UNIQUE')) {
      return res.status(409).json({ message: '该运动员已有相同开始日期的体能训练。' });
    }
    throw saveError;
  }
  const saved = existing || db.prepare('SELECT id FROM training_plans WHERE athlete_id = ? AND plan_date = ?')
    .get(athleteId, parsed.data.startDate) as { id: number };
  db.prepare('INSERT INTO audit_logs (user_id, action, entity_type, entity_id, detail) VALUES (?, ?, ?, ?, ?)')
    .run(user.id, existing ? 'UPDATE_TRAINING_PLAN' : 'CREATE_TRAINING_PLAN', 'training_plan', saved.id, JSON.stringify({
      athleteId,
      startDate: parsed.data.startDate,
      endDate: parsed.data.endDate,
      exercises: parsed.data.exercises.length
    }));
  res.json({ message: existing ? '体能训练已更新。' : '体能训练已保存。', id: saved.id });
});

app.delete('/api/training-plans/:id', requireAuth, requireRole('SCC', 'PRJ', 'REG', 'TD', 'DMD'), (req, res) => {
  const planId = Number(req.params.id);
  const row = db.prepare(`
    SELECT tp.id, tp.athlete_id AS athleteId, tp.start_date AS startDate,
      tp.end_date AS endDate, tp.title, a.name AS athleteName
    FROM training_plans tp
    JOIN athletes a ON a.id = tp.athlete_id
    WHERE tp.id = ?
  `).get(planId) as {
    id: number;
    athleteId: number;
    startDate: string;
    endDate: string;
    title: string;
    athleteName: string;
  } | undefined;
  if (!row) return res.status(404).json({ message: '历史训练不存在或已经删除。' });
  if (!hasAthleteAccess(req.authUser!, row.athleteId)) {
    return res.status(403).json({ message: '无权删除该运动员的体能训练。' });
  }
  db.exec('BEGIN');
  try {
    db.prepare('DELETE FROM training_plans WHERE id = ?').run(planId);
    db.prepare('INSERT INTO audit_logs (user_id, action, entity_type, entity_id, detail) VALUES (?, ?, ?, ?, ?)')
      .run(req.authUser!.id, 'DELETE_TRAINING_PLAN', 'training_plan', planId, JSON.stringify(row));
    db.exec('COMMIT');
    res.json({ message: '历史训练已删除。' });
  } catch (deleteError) {
    db.exec('ROLLBACK');
    throw deleteError;
  }
});

// ============================================
// AI 驱动体能训练 API
// ============================================

/**
 * 获取运动员上下文（历史数据）
 */
function getAthleteContext(athleteId: number): AthleteContext {
  // 获取运动员基本信息
  const athlete = db.prepare(`
    SELECT id, name, project, team, gender, region
    FROM athletes WHERE id = ?
  `).get(athleteId) as {
    id: number;
    name: string;
    project: string;
    team: string;
    gender: string;
    region: string;
  };

  // 获取最近6个月的体能训练
  const recentPlans = db.prepare(`
    SELECT plan_date as date, plan_data as dataJson
    FROM training_plans
    WHERE athlete_id = ? AND plan_date >= date('now', '-6 months')
    ORDER BY plan_date DESC
    LIMIT 3
  `).all(athleteId) as Array<{ date: string; dataJson: string }>;

  const parsedPlans = recentPlans.map(plan => {
    try {
      const data = JSON.parse(plan.dataJson);
      return {
        date: plan.date,
        duration: data.durationWeeks || 4,
        title: data.title || '',
        exercises: data.exercises?.map((e: { name: string }) => e.name) || [],
        maxWeights: data.exercises?.reduce((acc: Record<string, number>, e: { name: string; maxWeight: number | null }) => {
          if (e.maxWeight) acc[e.name] = e.maxWeight;
          return acc;
        }, {} as Record<string, number>) || {}
      };
    } catch {
      return null;
    }
  }).filter(Boolean);

  // 获取最近28天训练记录
  const recentRecords = db.prepare(`
    SELECT date, training_type as trainingType, duration_min as durationMin, rpe, fatigue_index as fatigueIndex, status
    FROM training_records
    WHERE athlete_id = ? AND date >= date('now', '-28 days')
    ORDER BY date DESC
  `).all(athleteId) as Array<{
    date: string;
    trainingType: string;
    durationMin: number;
    rpe: number | null;
    fatigueIndex: number | null;
    status: string;
  }>;

  // 获取最近3次力量测试
  const strengthTests = db.prepare(`
    SELECT test_date as date, metrics_json as metricsJson
    FROM athlete_strength_tests
    WHERE athlete_id = ?
    ORDER BY test_date DESC
    LIMIT 3
  `).all(athleteId) as Array<{ date: string; metricsJson: string }>;

  const parsedTests = strengthTests.map(test => {
    try {
      return {
        date: test.date,
        metrics: JSON.parse(test.metricsJson)
      };
    } catch {
      return null;
    }
  }).filter(Boolean);

  return {
    athlete,
    recentPlans: parsedPlans as AthleteContext['recentPlans'],
    recentRecords,
    strengthTests: parsedTests as AthleteContext['strengthTests']
  };
}

/**
 * POST /api/training-plans/ai/analyze
 * AI 分析输入内容，生成体能训练预览
 */
app.post(
  '/api/training-plans/ai/analyze',
  requireAuth,
  requireRole('SCC', 'PRJ', 'REG', 'TD', 'DMD'),
  upload.none(),
  async (req, res) => {
    try {
      const athleteId = Number(req.body.athleteId);

      if (!athleteId) {
        return res.status(400).json({ message: '请选择运动员' });
      }

      if (!hasAthleteAccess(req.authUser!, athleteId)) {
        return res.status(403).json({ message: '无权访问该运动员数据' });
      }

      // 获取运动员上下文
      const context = getAthleteContext(athleteId);

      const inputContent = cleanString(req.body.text);
      if (!inputContent) {
        return res.status(400).json({ message: '请输入训练需求描述' });
      }

      // 调用 AI 生成体能训练
      const aiService = new TrainingPlanAIService();
      const result = await aiService.generateTrainingPlan(context, inputContent);

      // 记录审计日志
      db.prepare('INSERT INTO audit_logs (user_id, action, entity_type, entity_id, detail) VALUES (?, ?, ?, ?, ?)')
        .run(
          req.authUser!.id,
          'AI_GENERATE_TRAINING_PLAN',
          'training_plan',
          athleteId,
          JSON.stringify({ model: result.modelUsed, inputType: 'text' })
        );

      res.json({
        plan: result.plan,
        aiMetadata: {
          inputType: 'text',
          inputContent: inputContent.slice(0, 1000),
          modelUsed: result.modelUsed,
          attempts: result.attempts,
          generatedAt: new Date().toISOString()
        }
      });
    } catch (error) {
      console.error('[AI Training Plan] Error:', error);
      res.status(500).json({
        message: `AI 生成失败：${error instanceof Error ? error.message : '未知错误'}`
      });
    }
  }
);

/**
 * POST /api/training-plans/ai/save
 * 保存 AI 生成的体能训练
 */
app.post(
  '/api/training-plans/ai/save',
  requireAuth,
  requireRole('SCC', 'PRJ', 'REG', 'TD', 'DMD'),
  (req, res) => {
    try {
      const { athleteId, plan, aiMetadata } = req.body;
      const targetId = Number(athleteId);
      if (!Number.isInteger(targetId) || targetId <= 0 || !plan) {
        return res.status(400).json({ message: '缺少必要参数' });
      }
      if (plan.sourceType === 'ai_import' || aiMetadata?.operation === 'import') {
        return res.status(400).json({ message: '仅支持保存 AI 生成的体能训练' });
      }
      if (!hasAthleteAccess(req.authUser!, targetId)) {
        return res.status(403).json({ message: '无权管理该运动员' });
      }
      if (!cleanString(plan.title) || cleanString(plan.title).length > 80) {
        return res.status(400).json({ message: '请确认训练名称，长度应为1至80个字符' });
      }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(cleanString(plan.startDate)) || !/^\d{4}-\d{2}-\d{2}$/.test(cleanString(plan.endDate))) {
        return res.status(400).json({ message: '请人工确认有效的开始日期和结束日期' });
      }
      if (plan.startDate > plan.endDate) {
        return res.status(400).json({ message: '结束日期不能早于开始日期' });
      }
      if (!Array.isArray(plan.weeklyPlans) || plan.weeklyPlans.length === 0) {
        return res.status(400).json({ message: '体能训练内容为空' });
      }

      const athlete = db.prepare('SELECT id, name FROM athletes WHERE id = ?').get(targetId) as { id: number; name: string } | undefined;
      if (!athlete) return res.status(400).json({ message: '运动员不存在，请刷新名单后重试' });
      const existing = db.prepare('SELECT id FROM training_plans WHERE athlete_id = ? AND plan_date = ?')
        .get(targetId, plan.startDate) as { id: number } | undefined;
      if (existing) return res.status(409).json({ message: '该运动员已有相同开始日期的体能训练' });

      const storedPlan = normalizeAIPlanToMatrix({
        sourceType: 'ai_generated',
        title: plan.title,
        summary: plan.summary || '',
        startDate: plan.startDate,
        endDate: plan.endDate,
        scheduleLabel: plan.scheduleLabel || '',
        bodyWeight: plan.bodyWeight ?? null,
        age: plan.age ?? null,
        durationWeeks: plan.durationWeeks ?? null,
        weeklyPlans: plan.weeklyPlans,
        exercises: Array.isArray(plan.exercises) ? plan.exercises : []
      }, targetId);
      if (!Array.isArray(storedPlan.exercises) || !storedPlan.exercises.length) {
        return res.status(400).json({ message: 'AI体能训练没有可写入训练矩阵的项目' });
      }

      const inserted = db.prepare(`
        INSERT INTO training_plans
          (athlete_id, plan_date, start_date, end_date, title, schedule_label, plan_data, ai_metadata, created_by, updated_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        targetId,
        plan.startDate,
        plan.startDate,
        plan.endDate,
        plan.title,
        plan.scheduleLabel || '',
        JSON.stringify(storedPlan),
        JSON.stringify(aiMetadata),
        req.authUser!.id,
        req.authUser!.id
      );
      const planId = Number(inserted.lastInsertRowid);
      db.prepare('INSERT INTO audit_logs (user_id, action, entity_type, entity_id, detail) VALUES (?, ?, ?, ?, ?)')
        .run(
          req.authUser!.id,
          'SAVE_AI_TRAINING_PLAN',
          'training_plan',
          planId,
          JSON.stringify({ athleteId: targetId, title: plan.title, model: aiMetadata?.modelUsed })
        );
      res.json({
        message: 'AI 体能训练已保存',
        id: planId,
        created: 1,
        replaced: 0,
        skipped: 0,
        results: [{ athleteId: targetId, athleteName: athlete.name, status: 'created', planId }]
      });
    } catch (error) {
      console.error('[AI Training Plan Save] Error:', error);
      if (error instanceof Error && error.message.includes('UNIQUE')) {
        return res.status(409).json({ message: '该运动员已有相同开始日期的体能训练' });
      }
      res.status(500).json({ message: `保存失败：${error instanceof Error ? error.message : '未知错误'}` });
    }
  }
);

app.get('/api/training-plans/:id/export', requireAuth, async (req, res) => {
  const planId = Number(req.params.id);
  const row = db.prepare(`
    SELECT tp.id, tp.athlete_id AS athleteId, a.name AS athleteName, a.project, a.team,
      a.photo_url AS photoUrl, tp.plan_data AS dataJson
    FROM training_plans tp
    JOIN athletes a ON a.id = tp.athlete_id
    WHERE tp.id = ?
  `).get(planId) as {
    id: number;
    athleteId: number;
    athleteName: string;
    project: string;
    team: string;
    photoUrl: string;
    dataJson: string;
  } | undefined;
  if (!row) return res.status(404).json({ message: '体能训练不存在。' });
  if (!hasAthleteAccess(req.authUser!, row.athleteId)) return res.status(403).json({ message: '无权导出该体能训练。' });
  const parsed = parseTrainingPlanData(JSON.parse(row.dataJson || '{}'));
  if (parsed.errors.length) return res.status(409).json({ message: `体能训练数据不完整：${parsed.errors.join('；')}` });
  const workbook = await buildTrainingPlanWorkbook({
    athleteName: row.athleteName,
    project: row.project,
    team: row.team,
    photoUrl: row.photoUrl,
    data: parsed.data
  });
  const buffer = await workbook.xlsx.writeBuffer();
  const safePeriod = `${parsed.data.startDate.replaceAll('-', '')}-${parsed.data.endDate.replaceAll('-', '')}`;
  const filename = `${row.athleteName}_${safePeriod}_四周体能训练.xlsx`;
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
  res.send(Buffer.from(buffer));
});

function strengthImportCandidates(user: AuthUser) {
  const ids = accessibleAthleteIds(user);
  if (!ids.length) return [] as Array<{ id: number; name: string; project: string; team: string; gender: string }>;
  const placeholders = ids.map(() => '?').join(',');
  return db.prepare(`
    SELECT id, name, project, team, gender
    FROM athletes WHERE id IN (${placeholders}) AND active = 1
    ORDER BY name, id
  `).all(...ids) as Array<{ id: number; name: string; project: string; team: string; gender: string }>;
}

function strengthImportDate(value: unknown) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, '0');
    const day = String(value.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
  const text = cleanString(value).replace(/[.\/年]/g, '-').replace(/月/g, '-').replace(/日/g, '').replace(/-+/g, '-');
  const match = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (!match) return text;
  return `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`;
}

function strengthImportNumber(value: unknown) {
  if (value === '' || value === null || value === undefined) return null;
  const match = cleanString(value).replace(',', '.').match(/-?\d+(?:\.\d+)?/);
  const number = match ? Number(match[0]) : Number.NaN;
  return Number.isFinite(number) ? Math.round(number * 10) / 10 : null;
}

function strengthImportBoolean(value: unknown, fallback = true) {
  if (typeof value === 'boolean') return value;
  const text = cleanString(value).toLowerCase();
  if (['否', '未完成', 'false', '0', 'no'].includes(text)) return false;
  if (['是', '完成', 'true', '1', 'yes'].includes(text)) return true;
  return fallback;
}

function strengthCellText(value: ExcelJS.CellValue) {
  if (value instanceof Date) return strengthImportDate(value);
  if (value && typeof value === 'object') {
    if ('result' in value) return cleanString(value.result);
    if ('text' in value) return cleanString(value.text);
    if ('richText' in value && Array.isArray(value.richText)) return value.richText.map((item) => item.text).join('');
  }
  return cleanString(value);
}

function normalizedStrengthHeader(value: unknown) {
  return cleanString(value).toLowerCase().replace(/[\s_()（）/\\-]/g, '');
}

function strengthRecordValue(record: Record<string, unknown>, aliases: string[]) {
  for (const alias of aliases) {
    const value = record[normalizedStrengthHeader(alias)];
    if (value !== undefined && cleanString(value) !== '') return value;
  }
  return '';
}

function validateStrengthImportRow(
  source: Record<string, unknown>,
  rowNumber: number,
  athletes: Array<{ id: number; name: string; project: string; team: string; gender: string }>
): StrengthImportRow {
  const athleteName = cleanString(source.athleteName ?? strengthRecordValue(source, ['运动员', '运动员姓名', '姓名', 'athlete']));
  const team = cleanString(source.team ?? strengthRecordValue(source, ['队伍', '组别', 'team']));
  const requestedAthleteId = Number(source.athleteId || 0);
  let matches = requestedAthleteId ? athletes.filter((athlete) => athlete.id === requestedAthleteId) : athletes.filter((athlete) => athlete.name === athleteName);
  if (matches.length > 1 && team) matches = matches.filter((athlete) => athlete.team === team);
  const matched = matches.length === 1 ? matches[0] : null;
  const trainingDate = strengthImportDate(source.trainingDate ?? strengthRecordValue(source, ['训练日期', '日期', 'date']));
  const sessionLabel = cleanString(source.sessionLabel ?? strengthRecordValue(source, ['训练场次', '场次', '训练名称', 'session'])) || '体能训练';
  const exerciseName = cleanString(source.exerciseName ?? strengthRecordValue(source, ['动作', '动作名称', '训练项目', '项目', 'exercise']));
  const categoryValue = cleanString(source.trainingCategory ?? strengthRecordValue(source, ['训练类型', '体能类型', '训练分类', 'category']));
  const bodyPositionValue = cleanString(source.bodyPosition ?? strengthRecordValue(source, ['身体位置', '训练身体位置', '部位', 'bodyposition']));
  const environmentValue = cleanString(source.trainingEnvironment ?? strengthRecordValue(source, ['训练环境', '水陆类型', '训练场地', 'environment']));
  const intensityZoneValue = cleanString(source.intensityZone ?? strengthRecordValue(source, ['强度区间', '强度分区', 'intensityzone'])).toUpperCase();
  const trainingCategory = isStrengthTrainingCategory(categoryValue) ? categoryValue : inferStrengthCategory(exerciseName);
  const bodyPosition = isStrengthBodyPosition(bodyPositionValue) ? bodyPositionValue : inferStrengthBodyPosition(exerciseName);
  const trainingEnvironment = isStrengthTrainingEnvironment(environmentValue) ? environmentValue : '陆上';
  const intensityZone = isStrengthIntensityZone(intensityZoneValue) ? intensityZoneValue : 'AN';
  const setIndex = Math.max(1, Math.round(strengthImportNumber(source.setIndex ?? strengthRecordValue(source, ['组次', '第几组', '组序号', 'set'])) || 1));
  const targetReps = strengthImportNumber(source.targetReps ?? strengthRecordValue(source, ['计划次数', '目标次数', 'targetreps']));
  const actualReps = strengthImportNumber(source.actualReps ?? strengthRecordValue(source, ['实际次数', '完成次数', '次数', 'actualreps', 'reps']));
  const plannedWeightKg = strengthImportNumber(source.plannedWeightKg ?? strengthRecordValue(source, ['计划重量kg', '计划重量', '目标重量kg', 'plannedweightkg']));
  const actualWeightKg = strengthImportNumber(source.actualWeightKg ?? strengthRecordValue(source, ['实际重量kg', '实际重量', '重量kg', '重量', 'weightkg']));
  const durationMin = strengthImportNumber(source.durationMin ?? strengthRecordValue(source, ['训练时间min', '训练时长min', '训练时间', '时长', 'durationmin'])) || 0;
  const distanceKm = strengthImportNumber(source.distanceKm ?? strengthRecordValue(source, ['训练距离km', '训练距离', '距离km', 'distancekm'])) || 0;
  const intensityPercent = strengthImportNumber(source.intensityPercent ?? strengthRecordValue(source, ['强度%', '训练强度%', '强度百分比', 'intensitypercent']));
  const rpe = strengthImportNumber(source.rpe ?? strengthRecordValue(source, ['rpe', '主观疲劳']));
  const completed = strengthImportBoolean(source.completed ?? strengthRecordValue(source, ['是否完成', '完成状态', 'completed']), true);
  const note = cleanString(source.note ?? strengthRecordValue(source, ['备注', '说明', 'note']));
  const confidence = strengthImportNumber(source.confidence ?? strengthRecordValue(source, ['置信度', 'confidence']));
  const originalText = cleanString(source.originalText) || JSON.stringify(source).slice(0, 1000);
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trainingDate)) errors.push('训练日期格式应为YYYY-MM-DD');
  if (!athleteName && !requestedAthleteId) errors.push('缺少运动员姓名');
  else if (!matched) errors.push(matches.length > 1 ? '同名运动员需要选择队伍' : '未匹配到权限范围内的运动员');
  if (!exerciseName) errors.push('缺少动作名称');
  if (actualReps === null || actualReps < 0 || actualReps > 1000) errors.push('实际次数应在0至1000之间');
  if (actualWeightKg === null || actualWeightKg < 0 || actualWeightKg > 1000) errors.push('实际重量应在0至1000kg之间');
  if (targetReps !== null && (targetReps < 0 || targetReps > 1000)) errors.push('计划次数应在0至1000之间');
  if (plannedWeightKg !== null && (plannedWeightKg < 0 || plannedWeightKg > 1000)) errors.push('计划重量应在0至1000kg之间');
  if (durationMin < 0 || durationMin > 1440) errors.push('训练时间应在0至1440分钟之间');
  if (distanceKm < 0 || distanceKm > 1000) errors.push('训练距离应在0至1000km之间');
  if (intensityPercent !== null && (intensityPercent < 0 || intensityPercent > 100)) errors.push('训练强度应在0至100%之间');
  if (rpe !== null && (rpe < 0 || rpe > 10)) errors.push('RPE应在0至10之间');
  if (categoryValue && !isStrengthTrainingCategory(categoryValue)) warnings.push(`训练类型“${categoryValue}”无法识别，已按动作归入${trainingCategory}`);
  if (bodyPositionValue && !isStrengthBodyPosition(bodyPositionValue)) warnings.push(`身体位置“${bodyPositionValue}”无法识别，已自动归类`);
  if (environmentValue && !isStrengthTrainingEnvironment(environmentValue)) warnings.push(`训练环境“${environmentValue}”无法识别，已按陆上训练处理`);
  if (intensityZoneValue && !isStrengthIntensityZone(intensityZoneValue)) warnings.push(`强度区间“${intensityZoneValue}”无法识别，已按AN处理`);
  if (confidence !== null && confidence < 0.7) warnings.push('AI识别置信度较低，请人工核对');
  const duplicate = Boolean(matched && /^\d{4}-\d{2}-\d{2}$/.test(trainingDate) && exerciseName && db.prepare(`
    SELECT srs.id
    FROM strength_result_sets srs
    JOIN training_sessions ts ON ts.id = srs.training_session_id
    WHERE ts.athlete_id = ? AND ts.session_date = ? AND ts.content = ?
      AND srs.exercise_name = ? AND srs.set_index = ?
    LIMIT 1
  `).get(matched.id, trainingDate, sessionLabel, exerciseName, setIndex));
  if (duplicate) warnings.push('系统中存在相同场次、动作和组次');
  return {
    rowNumber,
    athleteId: matched?.id || null,
    athleteName,
    matchedAthleteName: matched?.name || '',
    team: matched?.team || team,
    trainingDate,
    sessionLabel,
    trainingCategory,
    bodyPosition,
    trainingEnvironment,
    exerciseName,
    setIndex,
    targetReps,
    actualReps,
    actualWeightKg,
    plannedWeightKg,
    durationMin,
    distanceKm,
    intensityPercent,
    intensityZone,
    rpe,
    completed,
    note,
    confidence,
    originalText,
    duplicate,
    errors,
    warnings
  };
}

function parseStrengthCsv(buffer: Buffer) {
  const lines = buffer.toString('utf8').replace(/^\uFEFF/, '').split(/\r?\n/).filter((line) => line.trim());
  const parseLine = (line: string) => {
    const values: string[] = [];
    let value = '';
    let quoted = false;
    for (let index = 0; index < line.length; index += 1) {
      const character = line[index];
      if (character === '"' && quoted && line[index + 1] === '"') { value += '"'; index += 1; }
      else if (character === '"') quoted = !quoted;
      else if (character === ',' && !quoted) { values.push(value); value = ''; }
      else value += character;
    }
    values.push(value);
    return values;
  };
  const headers = parseLine(lines.shift() || '').map(normalizedStrengthHeader);
  return lines.map((line) => Object.fromEntries(parseLine(line).map((value, index) => [headers[index] || `column${index}`, value])));
}

async function parseStrengthImportFile(file: Express.Multer.File, athletes: ReturnType<typeof strengthImportCandidates>) {
  const filename = file.originalname.toLowerCase();
  if (filename.endsWith('.xlsx') || file.mimetype.includes('spreadsheet')) {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(file.buffer as unknown as ArrayBuffer);
    const records: Record<string, unknown>[] = [];
    workbook.eachSheet((sheet) => {
      let headers: string[] = [];
      let headerNumber = 0;
      for (let rowNumber = 1; rowNumber <= Math.min(sheet.rowCount, 12); rowNumber += 1) {
        const values = sheet.getRow(rowNumber).values as ExcelJS.CellValue[];
        const candidate = values.slice(1).map((value) => normalizedStrengthHeader(strengthCellText(value)));
        if (candidate.some((value) => ['运动员', '运动员姓名', '姓名'].includes(value)) && candidate.some((value) => ['动作', '动作名称', '训练项目', '项目'].includes(value))) {
          headers = candidate;
          headerNumber = rowNumber;
          break;
        }
      }
      if (!headerNumber) return;
      for (let rowNumber = headerNumber + 1; rowNumber <= sheet.rowCount; rowNumber += 1) {
        const row = sheet.getRow(rowNumber);
        const record = Object.fromEntries(headers.map((header, index) => [header || `column${index}`, strengthCellText(row.getCell(index + 1).value)]));
        if (Object.values(record).some((value) => cleanString(value))) records.push({ ...record, originalText: `${sheet.name}!${rowNumber}` });
      }
    });
    if (!records.length) throw new Error('未找到包含“运动员”和“动作”表头的训练结果工作表。');
    return { records, sourceType: 'excel' as const, modelUsed: '结构化Excel解析' };
  }
  if (filename.endsWith('.csv') || file.mimetype.includes('csv')) {
    return { records: parseStrengthCsv(file.buffer), sourceType: 'csv' as const, modelUsed: '结构化CSV解析' };
  }
  if (file.mimetype.startsWith('image/') || file.mimetype === 'application/pdf') {
    const recognized = await recognizeStrengthImport({ buffer: file.buffer, filename: file.originalname, mimetype: file.mimetype, athletes });
    return {
      records: recognized.rows as Array<RecognizedStrengthRow & Record<string, unknown>>,
      sourceType: file.mimetype === 'application/pdf' ? 'pdf' as const : 'image' as const,
      modelUsed: recognized.modelUsed
    };
  }
  throw new Error('仅支持XLSX、CSV、JPG、PNG、WEBP或PDF文件。');
}

app.get('/api/strength-training/results', requireAuth, (req, res) => {
  const athleteId = Number(req.query.athleteId || 0);
  if (!athleteId || !hasAthleteAccess(req.authUser!, athleteId)) return res.status(403).json({ message: '无权查看该运动员的体能训练结果。' });
  const rows = db.prepare(`
    SELECT ts.id AS sessionId, ts.session_date AS trainingDate, ts.session_order AS sessionOrder,
      ts.content AS sessionLabel, ts.rpe AS sessionRpe, ts.smvl AS volume, ts.source,
      ts.duration_min AS sessionDurationMin, ts.distance_km AS sessionDistanceKm,
      ts.training_type AS trainingType, ts.structure_type AS structureType,
      ts.intensity_zone AS sessionIntensityZone, ts.srpe,
      srs.id, srs.exercise_name AS exerciseName, srs.set_index AS setIndex,
      srs.target_reps AS targetReps, srs.actual_reps AS actualReps,
      srs.actual_weight_kg AS actualWeightKg, srs.planned_weight_kg AS plannedWeightKg,
      srs.training_category AS trainingCategory, srs.body_position AS bodyPosition,
      srs.training_environment AS trainingEnvironment, srs.duration_min AS durationMin,
      srs.distance_km AS distanceKm, srs.intensity_percent AS intensityPercent,
      srs.intensity_zone AS setIntensityZone, srs.rpe, srs.completed,
      srs.note, srs.import_batch_id AS importBatchId, srs.ai_confidence AS confidence,
      sib.source_filename AS sourceFilename, sib.model_used AS modelUsed,
      COALESCE(sib.committed_at, srs.updated_at) AS importedAt
    FROM training_sessions ts
    JOIN strength_result_sets srs ON srs.training_session_id = ts.id
    LEFT JOIN strength_import_batches sib ON sib.id = srs.import_batch_id
    WHERE ts.athlete_id = ?
    ORDER BY ts.session_date DESC, ts.session_order DESC, srs.exercise_name, srs.set_index
  `).all(athleteId) as Array<Record<string, unknown> & { sessionId: number }>;
  const grouped = new Map<number, { id: number; trainingDate: string; sessionOrder: number; sessionLabel: string; rpe: number | null; volume: number; durationMin: number; distanceKm: number; trainingType: string; structureType: string; intensityZone: StrengthIntensityZone; srpe: number; source: string; sourceFilename: string; modelUsed: string; importedAt: string; sets: Array<Record<string, unknown>> }>();
  for (const row of rows) {
    const sessionId = Number(row.sessionId);
    if (!grouped.has(sessionId)) grouped.set(sessionId, {
      id: sessionId,
      trainingDate: cleanString(row.trainingDate),
      sessionOrder: Number(row.sessionOrder),
      sessionLabel: cleanString(row.sessionLabel),
      rpe: row.sessionRpe === null ? null : Number(row.sessionRpe),
      volume: Number(row.volume || 0),
      durationMin: Number(row.sessionDurationMin || 0),
      distanceKm: Number(row.sessionDistanceKm || 0),
      trainingType: cleanString(row.trainingType),
      structureType: cleanString(row.structureType),
      intensityZone: isStrengthIntensityZone(row.sessionIntensityZone) ? row.sessionIntensityZone : 'AN',
      srpe: Number(row.srpe || 0),
      source: cleanString(row.source),
      sourceFilename: cleanString(row.sourceFilename),
      modelUsed: cleanString(row.modelUsed),
      importedAt: cleanString(row.importedAt),
      sets: []
    });
    grouped.get(sessionId)!.sets.push({
      id: Number(row.id), exerciseName: cleanString(row.exerciseName), setIndex: Number(row.setIndex),
      targetReps: row.targetReps === null ? null : Number(row.targetReps), actualReps: Number(row.actualReps),
      actualWeightKg: Number(row.actualWeightKg), plannedWeightKg: row.plannedWeightKg === null ? null : Number(row.plannedWeightKg),
      trainingCategory: isStrengthTrainingCategory(row.trainingCategory) ? row.trainingCategory : inferStrengthCategory(cleanString(row.exerciseName)),
      bodyPosition: isStrengthBodyPosition(row.bodyPosition) ? row.bodyPosition : inferStrengthBodyPosition(cleanString(row.exerciseName)),
      trainingEnvironment: isStrengthTrainingEnvironment(row.trainingEnvironment) ? row.trainingEnvironment : '陆上',
      durationMin: Number(row.durationMin || 0), distanceKm: Number(row.distanceKm || 0),
      intensityPercent: row.intensityPercent === null ? null : Number(row.intensityPercent),
      intensityZone: isStrengthIntensityZone(row.setIntensityZone) ? row.setIntensityZone : 'AN',
      rpe: row.rpe === null ? null : Number(row.rpe),
      completed: Boolean(row.completed), note: cleanString(row.note), importBatchId: cleanString(row.importBatchId),
      confidence: row.confidence === null ? null : Number(row.confidence)
    });
  }
  res.json({ sessions: [...grouped.values()] });
});

app.get('/api/strength-training/import/template', requireAuth, requireRole('SCC', 'PRJ', 'REG', 'TD', 'DMD'), async (_req, res) => {
  const templatePath = resolve(process.cwd(), 'public', 'templates', '竞迹体能训练数据导入模板.xlsx');
  if (!existsSync(templatePath)) return res.status(404).json({ message: '体能训练导入模板尚未部署。' });
  res.download(templatePath, '竞迹体能训练数据导入模板.xlsx');
});

app.post('/api/strength-training/import/preview', requireAuth, requireRole('SCC', 'PRJ', 'REG', 'TD', 'DMD'), upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ message: '请选择训练结果文件。' });
    const athletes = strengthImportCandidates(req.authUser!);
    if (!athletes.length) return res.status(403).json({ message: '当前账号没有可导入的运动员。' });
    const parsed = await parseStrengthImportFile(req.file, athletes);
    const rows = parsed.records.slice(0, 1000).map((record, index) => validateStrengthImportRow(record, index + 1, athletes));
    const token = randomUUID();
    strengthImportCache.set(token, {
      ownerId: req.authUser!.id,
      filename: req.file.originalname,
      mimetype: req.file.mimetype,
      sourceType: parsed.sourceType,
      rows,
      modelUsed: parsed.modelUsed,
      expiresAt: Date.now() + 30 * 60 * 1000
    });
    res.json({
      token,
      filename: req.file.originalname,
      modelUsed: parsed.modelUsed,
      total: rows.length,
      valid: rows.filter((row) => !row.errors.length).length,
      invalid: rows.filter((row) => row.errors.length).length,
      duplicate: rows.filter((row) => row.duplicate).length,
      rows
    });
  } catch (error) {
    next(error);
  }
});

app.post('/api/strength-training/import/commit', requireAuth, requireRole('SCC', 'PRJ', 'REG', 'TD', 'DMD'), (req, res) => {
  const token = cleanString(req.body?.token);
  const cached = strengthImportCache.get(token);
  if (!cached || cached.ownerId !== req.authUser!.id || cached.expiresAt < Date.now()) {
    strengthImportCache.delete(token);
    return res.status(410).json({ message: '导入预览已过期，请重新上传文件。' });
  }
  const policy = ['skip', 'update', 'new'].includes(cleanString(req.body?.conflictPolicy)) ? cleanString(req.body.conflictPolicy) as 'skip' | 'update' | 'new' : 'skip';
  const athletes = strengthImportCandidates(req.authUser!);
  const sourceRows = Array.isArray(req.body?.rows) ? req.body.rows : cached.rows;
  const rows: StrengthImportRow[] = sourceRows.map((row: Record<string, unknown>, index: number) => validateStrengthImportRow(row, Number(row.rowNumber || index + 1), athletes));
  const invalid = rows.filter((row) => row.errors.length);
  if (invalid.length) return res.status(400).json({ message: `仍有${invalid.length}行未通过校验，请先修正红色字段。`, rows });

  let imported = 0;
  let updated = 0;
  let skipped = 0;
  const batchId = token;
  const sessionIds = new Set<number>();
  const sessionMap = new Map<string, number>();
  const source = cached.sourceType === 'image' || cached.sourceType === 'pdf' ? 'ai_import' : 'file_import';
  db.exec('BEGIN');
  try {
    db.prepare(`
      INSERT INTO strength_import_batches
        (id, source_filename, source_mimetype, source_type, model_used, status, row_count, created_by)
      VALUES (?, ?, ?, ?, ?, 'preview', ?, ?)
    `).run(batchId, cached.filename, cached.mimetype, cached.sourceType, cached.modelUsed, rows.length, req.authUser!.id);

    for (const row of rows) {
      const baseKey = `${row.athleteId}|${row.trainingDate}|${row.sessionLabel}`;
      let sessionId = sessionMap.get(baseKey);
      if (!sessionId) {
        const existing = policy === 'new' ? undefined : db.prepare(`
          SELECT id FROM training_sessions
          WHERE athlete_id = ? AND session_date = ? AND training_type = '力量训练' AND content = ?
          ORDER BY session_order DESC LIMIT 1
        `).get(row.athleteId, row.trainingDate, row.sessionLabel) as { id: number } | undefined;
        if (existing) sessionId = existing.id;
        else {
          const orderRow = db.prepare('SELECT COALESCE(MAX(session_order), 0) AS maxOrder FROM training_sessions WHERE athlete_id = ? AND session_date = ?')
            .get(row.athleteId, row.trainingDate) as { maxOrder: number };
          const inserted = db.prepare(`
            INSERT INTO training_sessions
              (athlete_id, session_date, session_order, start_time, training_type, structure_type,
               intensity_zone, content, duration_min, distance_km, rpe, srpe, smvl,
               source, quality, is_demo, created_by)
            VALUES (?, ?, ?, '', '力量训练', '体能训练', 'AN', ?, 0, 0, NULL, 0, 0, ?, ?, 0, ?)
          `).run(row.athleteId, row.trainingDate, Number(orderRow.maxOrder) + 1, row.sessionLabel, source, row.confidence !== null && row.confidence < 0.7 ? 'partial' : 'valid', req.authUser!.id);
          sessionId = Number(inserted.lastInsertRowid);
        }
        sessionMap.set(baseKey, sessionId);
      }
      sessionIds.add(sessionId);
      const existingSet = db.prepare('SELECT id FROM strength_result_sets WHERE training_session_id = ? AND exercise_name = ? AND set_index = ?')
        .get(sessionId, row.exerciseName, row.setIndex) as { id: number } | undefined;
      if (existingSet && policy === 'skip') { skipped += 1; continue; }
      if (existingSet) {
        db.prepare(`
          UPDATE strength_result_sets SET target_reps = ?, actual_reps = ?, actual_weight_kg = ?, planned_weight_kg = ?,
            training_category = ?, body_position = ?, training_environment = ?, duration_min = ?, distance_km = ?,
            intensity_percent = ?, intensity_zone = ?, rpe = ?, completed = ?,
            note = ?, source = ?, import_batch_id = ?, source_row = ?, original_text = ?, ai_confidence = ?,
            created_by = ?, updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `).run(row.targetReps, row.actualReps, row.actualWeightKg, row.plannedWeightKg,
          row.trainingCategory, row.bodyPosition, row.trainingEnvironment, row.durationMin, row.distanceKm,
          row.intensityPercent, row.intensityZone, row.rpe, row.completed ? 1 : 0, row.note, source,
          batchId, String(row.rowNumber), row.originalText, row.confidence, req.authUser!.id, existingSet.id);
        updated += 1;
      } else {
        db.prepare(`
          INSERT INTO strength_result_sets
            (training_session_id, exercise_name, set_index, target_reps, actual_reps, actual_weight_kg, planned_weight_kg,
             training_category, body_position, training_environment, duration_min, distance_km, intensity_percent,
             intensity_zone, rpe, completed, note, source, import_batch_id, source_row, original_text, ai_confidence, created_by)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(sessionId, row.exerciseName, row.setIndex, row.targetReps, row.actualReps, row.actualWeightKg,
          row.plannedWeightKg, row.trainingCategory, row.bodyPosition, row.trainingEnvironment, row.durationMin,
          row.distanceKm, row.intensityPercent, row.intensityZone, row.rpe, row.completed ? 1 : 0, row.note,
          source, batchId, String(row.rowNumber), row.originalText, row.confidence, req.authUser!.id);
        imported += 1;
      }
    }

    for (const sessionId of sessionIds) {
      const totals = db.prepare(`
        SELECT COALESCE(SUM(actual_reps * actual_weight_kg), 0) AS volume,
          AVG(CASE WHEN rpe IS NOT NULL THEN rpe END) AS averageRpe,
          COALESCE(SUM(duration_min), 0) AS durationMin,
          COALESCE(SUM(distance_km), 0) AS distanceKm
        FROM strength_result_sets WHERE training_session_id = ?
      `).get(sessionId) as { volume: number; averageRpe: number | null; durationMin: number; distanceKm: number };
      const dominant = db.prepare(`
        SELECT training_environment AS environment, intensity_zone AS zone
        FROM strength_result_sets WHERE training_session_id = ?
        GROUP BY training_environment, intensity_zone ORDER BY SUM(duration_min) DESC, COUNT(*) DESC LIMIT 1
      `).get(sessionId) as { environment: string; zone: string } | undefined;
      const duration = Math.round(Number(totals.durationMin || 0) * 10) / 10;
      const averageRpe = totals.averageRpe === null ? null : Math.round(Number(totals.averageRpe) * 10) / 10;
      db.prepare(`UPDATE training_sessions SET rpe = ?, smvl = ?, duration_min = ?, distance_km = ?, srpe = ?,
        structure_type = ?, intensity_zone = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
        .run(averageRpe, Math.round(Number(totals.volume || 0) * 10) / 10, duration,
          Math.round(Number(totals.distanceKm || 0) * 10) / 10, Math.round((averageRpe || 0) * duration * 10) / 10,
          dominant?.environment || '陆上', isStrengthIntensityZone(dominant?.zone) ? dominant.zone : 'AN', sessionId);
    }
    db.prepare(`
      UPDATE strength_import_batches SET status = 'committed', imported_count = ?, skipped_count = ?, committed_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(imported + updated, skipped, batchId);
    db.prepare('INSERT INTO audit_logs (user_id, action, entity_type, entity_id, detail) VALUES (?, ?, ?, ?, ?)')
      .run(req.authUser!.id, 'IMPORT_STRENGTH_RESULTS', 'strength_import_batch', null, JSON.stringify({ batchId, imported, updated, skipped, sourceType: cached.sourceType }));
    db.exec('COMMIT');
    strengthImportCache.delete(token);
    res.json({ message: `已保存${imported + updated}条体能训练结果。`, imported, updated, skipped, sessions: sessionIds.size });
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
});

app.get('/api/overview', requireAuth, (req, res) => {
  const user = req.authUser!;
  const range = normalizeOverviewRange({
    from: cleanString(req.query.from),
    to: cleanString(req.query.to),
    period: cleanString(req.query.period)
  });
  const { from, to } = range;
  const requestedId = Number(req.query.athleteId || 0);
  const project = cleanString(req.query.project);
  if (!projectSet.has(project)) return res.status(400).json({ message: '请选择赛艇、皮划艇或激流项目。' });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) {
    return res.status(400).json({ message: '请选择有效的分析日期范围。' });
  }
  if (user.role !== 'ATL' && requestedId) {
    return res.status(400).json({ message: '管理账号的训练总览按权限范围进行团队聚合，请前往个人档案查看单人数据。' });
  }
  if (user.role === 'ATL' && requestedId && requestedId !== user.athleteId) {
    return res.status(403).json({ message: '运动员账号只能查看本人的训练总览。' });
  }
  let ids = accessibleAthleteIds(user);
  if (ids.length) {
    const placeholders = ids.map(() => '?').join(',');
    ids = (db.prepare(`SELECT id FROM athletes WHERE id IN (${placeholders}) AND project = ? AND active = 1`)
      .all(...ids, project) as Array<{ id: number }>).map((row) => row.id);
  }
  if (user.role === 'ATL') {
    if (!user.athleteId) return res.status(403).json({ message: '当前运动员账号未绑定人员档案。' });
    const selected = db.prepare('SELECT project FROM athletes WHERE id = ?').get(user.athleteId) as { project: string } | undefined;
    if (!selected || selected.project !== project) return res.status(400).json({ message: '本人档案不属于当前项目。' });
    ids = [user.athleteId];
  }
  res.json({ overview: buildOverviewPayload({ athleteIds: ids, from, to, project, individual: user.role === 'ATL', period: range.period }) });
});

app.get('/api/records', requireAuth, (req, res) => {
  const user = req.authUser!;
  const from = cleanString(req.query.from) || '2026-06-01';
  const to = cleanString(req.query.to) || '2026-12-31';
  const requestedId = Number(req.query.athleteId || 0);
  const project = cleanString(req.query.project);
  if (!projectSet.has(project)) return res.status(400).json({ message: '请选择赛艇、皮划艇或激流项目。' });
  let ids = accessibleAthleteIds(user);
  if (ids.length) {
    const placeholders = ids.map(() => '?').join(',');
    ids = (db.prepare(`SELECT id FROM athletes WHERE id IN (${placeholders}) AND project = ?`).all(...ids, project) as Array<{ id: number }>).map((row) => row.id);
  }
  if (requestedId) {
    if (!hasAthleteAccess(user, requestedId)) return res.status(403).json({ message: '无权查看该运动员。' });
    const selected = db.prepare('SELECT project FROM athletes WHERE id = ?').get(requestedId) as { project: string } | undefined;
    if (!selected || selected.project !== project) return res.status(400).json({ message: '所选运动员不属于当前项目。' });
    ids = [requestedId];
  }
  if (!ids.length) return res.json({ records: [] });
  const placeholders = ids.map(() => '?').join(',');
  const records = db.prepare(`
    SELECT ts.id, ts.athlete_id AS athleteId, a.name AS athleteName,
      a.project, a.team, a.region, a.region AS province, a.city, a.county,
      ts.session_date AS date, ts.training_type AS trainingType, ts.structure_type AS structureType,
      ts.intensity_zone AS intensityZone, ts.content, ts.duration_min AS durationMin,
      ts.distance_km AS distanceKm, ts.rpe, ts.srpe, ts.smvl,
      dw.morning_pulse AS morningPulse, dw.weight_kg AS weightKg,
      dw.sleep_hours AS sleepHours, dw.fatigue_index AS fatigueIndex,
      COALESCE(dw.status, 'normal') AS status, '' AS coachNote,
      ts.average_heart_rate AS averageHeartRate, ts.max_heart_rate AS maxHeartRate,
      ts.average_power_w AS averagePowerW, ts.stroke_rate_spm AS strokeRateSpm,
      ts.updated_at AS updatedAt, COALESCE(u.display_name, '系统') AS updatedBy
    FROM training_sessions ts
    JOIN athletes a ON a.id = ts.athlete_id
    LEFT JOIN daily_wellness dw ON dw.athlete_id = ts.athlete_id AND dw.wellness_date = ts.session_date
    LEFT JOIN users u ON u.id = ts.created_by
    WHERE ts.athlete_id IN (${placeholders}) AND ts.session_date BETWEEN ? AND ?
    ORDER BY ts.session_date, ts.session_order, a.name
  `).all(...ids, from, to) as Array<Record<string, unknown> & { trainingType: string; structureType: string; intensityZone: string; durationMin: number; distanceKm: number }>;
  res.json({
    records: records.map((record) => ({
      ...record,
      trainingBreakdown: trainingSessionBreakdown(record)
    }))
  });
});

app.post('/api/special-training/sessions', requireAuth, requireRole('SCC', 'PRJ', 'REG', 'TD', 'DMD'), (req, res) => {
  const user = req.authUser!;
  const rows = Array.isArray(req.body?.sessions) ? req.body.sessions.slice(0, 1000) : [];
  if (!rows.length) return res.status(400).json({ message: '请提供需要保存的训练数据。' });
  const insert = db.prepare(`
    INSERT INTO training_sessions
      (athlete_id, session_date, session_order, start_time, training_type, structure_type,
       intensity_zone, content, duration_min, distance_km, rpe, srpe, smvl,
       average_heart_rate, max_heart_rate, average_power_w, stroke_rate_spm,
       source, quality, is_demo, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, 'valid', 0, ?)
  `);
  const nextOrder = db.prepare('SELECT COALESCE(MAX(session_order), 0) + 1 AS value FROM training_sessions WHERE athlete_id = ? AND session_date = ?');
  let imported = 0;
  try {
    db.exec('BEGIN');
    for (const row of rows) {
      const athleteId = Number(row?.athleteId || 0);
      const athlete = db.prepare('SELECT id, project FROM athletes WHERE id = ? AND active = 1').get(athleteId) as { id: number; project: string } | undefined;
      if (!athlete || !hasAthleteAccess(user, athleteId)) throw new Error('存在无权录入或不存在的运动员。');
      const date = cleanString(row?.date);
      if (!isValidIsoDate(date)) throw new Error('训练日期无效，请使用正确的年月日。');
      if (cleanString(row?.project) && cleanString(row.project) !== athlete.project) throw new Error('训练项目与运动员档案不一致。');
      const duration = numberOrNull(row?.duration);
      const distance = numberOrNull(row?.distance);
      const rpe = numberOrNull(row?.rpe);
      const heartRate = numberOrNull(row?.heartRate);
      const maxHeartRate = numberOrNull(row?.maxHeartRate);
      const power = numberOrNull(row?.power);
      const strokeRate = numberOrNull(row?.strokeRate);
      if (duration === null || duration <= 0 || duration > 1440) throw new Error('训练时长须在 1—1440 分钟之间。');
      if (distance === null || distance < 0 || distance > 500) throw new Error('训练距离须在 0—500 公里之间。');
      if (rpe === null || rpe < 1 || rpe > 10) throw new Error('RPE 须在 1—10 之间。');
      if (heartRate === null || heartRate < 30 || heartRate > 240) throw new Error('平均心率须在 30—240 bpm 之间。');
      if (maxHeartRate === null || maxHeartRate < 30 || maxHeartRate > 240 || maxHeartRate < heartRate) throw new Error('最大心率须在 30—240 bpm 之间，且不能低于平均心率。');
      if (power === null || power < 0 || power > 3000) throw new Error('平均功率须在 0—3000 W 之间。');
      if (strokeRate === null || strokeRate < 1 || strokeRate > 250) throw new Error('桨频或划频须在 1—250 次/分之间。');
      const order = (nextOrder.get(athleteId, date) as { value: number }).value;
      const trainingType = cleanString(row?.type) || '专项训练';
      const content = cleanString(row?.content);
      if (!content || content.length > 100) throw new Error('训练内容须填写且不能超过 100 个字符。');
      const defaultStructure = trainingType === '专项力量' ? '最大力量' : trainingType === '恢复训练' ? '再生恢复' : '专项训练';
      insert.run(athleteId, date, order, cleanString(row?.startTime), trainingType,
        cleanString(row?.structureType) || defaultStructure, cleanString(row?.intensityZone) || 'U2',
        content, duration, distance, rpe, Math.round(duration * rpe), heartRate,
        maxHeartRate, power, strokeRate,
        cleanString(row?.source) === 'import' ? 'table_import' : 'manual', user.id);
      imported += 1;
    }
    db.exec('COMMIT');
    res.status(201).json({ message: `已保存 ${imported} 条专项训练数据。`, imported });
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch {}
    res.status(400).json({ message: error instanceof Error ? error.message : '专项训练数据保存失败。' });
  }
});

app.get('/api/analysis/model', requireAuth, (req, res) => {
  const project = cleanString(req.query.project);
  if (!projectSet.has(project)) return res.status(400).json({ message: '请选择赛艇、皮划艇或激流项目。' });
  res.json({ standard: analysisStandardForProject(project) });
});

app.get('/api/analysis/summary', requireAuth, (req, res) => {
  const user = req.authUser!;
  const from = cleanString(req.query.from);
  const to = cleanString(req.query.to);
  const requestedId = Number(req.query.athleteId || user.athleteId || 0);
  const project = cleanString(req.query.project);
  if (!projectSet.has(project)) return res.status(400).json({ message: '请选择赛艇、皮划艇或激流项目。' });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) {
    return res.status(400).json({ message: '请选择有效的分析日期范围。' });
  }
  if (!requestedId) return res.status(400).json({ message: '请选择一名运动员后再进行个人分析。' });
  if (!hasAthleteAccess(user, requestedId)) return res.status(403).json({ message: '无权分析该运动员。' });
  const athlete = db.prepare('SELECT project FROM athletes WHERE id = ?').get(requestedId) as { project: string } | undefined;
  if (!athlete || athlete.project !== project) return res.status(400).json({ message: '所选运动员不属于当前项目。' });

  const records = db.prepare(`
    SELECT date, training_type AS trainingType, structure_type AS structureType,
      intensity_zone AS intensityZone, duration_min AS durationMin, distance_km AS distanceKm,
      rpe, srpe, smvl, morning_pulse AS morningPulse, weight_kg AS weightKg,
      sleep_hours AS sleepHours, fatigue_index AS fatigueIndex, status
    FROM training_records
    WHERE athlete_id = ? AND date BETWEEN ? AND ?
    ORDER BY date, id
  `).all(requestedId, from, to) as RowingAnalysisRecord[];

  const standard = analysisStandardForProject(project);
  res.json({
    standard: {
      version: standard.version,
      decision: standard.decision,
      missingDataRule: standard.missingDataRule
    },
    analysis: analyzePeriodForProject(project, records)
  });
});

app.get('/api/athletes/:id/overview', requireAuth, (req, res) => {
  const user = req.authUser!;
  const athleteId = Number(req.params.id || 0);
  const range = normalizeOverviewRange({
    from: cleanString(req.query.from),
    to: cleanString(req.query.to),
    period: cleanString(req.query.period)
  });
  const project = cleanString(req.query.project);
  if (!athleteId) return res.status(400).json({ message: '请选择一名运动员。' });
  if (!hasAthleteAccess(user, athleteId)) return res.status(403).json({ message: '无权查看该运动员档案分析。' });
  if (!projectSet.has(project)) return res.status(400).json({ message: '请选择赛艇、皮划艇或激流项目。' });
  const athlete = db.prepare('SELECT project FROM athletes WHERE id = ? AND active = 1').get(athleteId) as { project: string } | undefined;
  if (!athlete || athlete.project !== project) return res.status(400).json({ message: '所选运动员不属于当前项目。' });
  res.json({ overview: buildOverviewPayload({ athleteIds: [athleteId], from: range.from, to: range.to, project, individual: true, period: range.period }) });
});

app.get('/api/athletes/:id/champion-model', requireAuth, (req, res) => {
  const user = req.authUser!;
  const athleteId = Number(req.params.id || 0);
  if (!athleteId) return res.status(400).json({ message: '请选择一名运动员。' });
  if (!hasAthleteAccess(user, athleteId)) return res.status(403).json({ message: '无权查看该运动员冠军模型对标。' });
  const athlete = db.prepare(`
    SELECT id, name, project, gender
    FROM athletes
    WHERE id = ? AND active = 1
  `).get(athleteId) as { id: number; name: string; project: Project; gender: string } | undefined;
  if (!athlete) return res.status(404).json({ message: '运动员不存在。' });
  const gender = athlete.gender?.includes('女') ? '女' : '男';
  const standards = db.prepare(`
    SELECT cms.metric_code AS code, cms.model_version AS modelVersion,
      cms.target_min AS targetMin, cms.target_max AS targetMax, cms.elite_mean AS eliteMean,
      cms.weight, cms.rationale, cms.source_note AS sourceNote,
      md.label, md.domain, md.unit, md.direction
    FROM champion_model_standards cms
    JOIN metric_definitions md ON md.code = cms.metric_code
    WHERE cms.project = ? AND cms.gender = ? AND cms.active = 1
    ORDER BY cms.weight DESC, cms.metric_code
  `).all(athlete.project, gender) as Array<{
    code: string; modelVersion: string; targetMin: number | null; targetMax: number | null;
    eliteMean: number | null; weight: number; rationale: string; sourceNote: string;
    label: string; domain: string; unit: string; direction: 'higher_better' | 'lower_better' | 'neutral';
  }>;
  if (!standards.length) {
    return res.json({
      benchmark: {
        athleteId: athlete.id,
        athleteName: athlete.name,
        project: athlete.project,
        gender,
        modelVersion: 'CHAMPION-2026-R1',
        rows: [],
        summary: { score: null, averageStandardDistance: null, topPriorityIndex: null, achieved: 0, comparable: 0, primaryGap: '暂无该项目冠军模型标准。', source: '暂无标准' }
      }
    });
  }
  const codes = standards.map((row) => row.code);
  const placeholders = codes.map(() => '?').join(',');
  const measurements = db.prepare(`
    SELECT tm.metric_code AS code, tm.value_num AS value, tm.target_value AS target,
      ts.test_date AS testDate, ts.id AS sessionId
    FROM test_sessions ts
    JOIN test_measurements tm ON tm.test_session_id = ts.id
    WHERE ts.athlete_id = ? AND tm.metric_code IN (${placeholders})
    ORDER BY tm.metric_code, ts.test_date DESC, ts.id DESC
  `).all(athlete.id, ...codes) as Array<{ code: string; value: number; target: number | null; testDate: string; sessionId: number }>;
  const byCode = new Map<string, Array<{ value: number; target: number | null; testDate: string; sessionId: number }>>();
  for (const measurement of measurements) {
    byCode.set(measurement.code, [...(byCode.get(measurement.code) || []), measurement]);
  }
  const lowerScore = (value: number, targetMax: number | null) => targetMax && value > 0 ? targetMax / value * 100 : null;
  const higherScore = (value: number, targetMin: number | null) => targetMin && targetMin > 0 ? value / targetMin * 100 : null;
  const standardDistanceFor = (value: number, standard: { targetMin: number | null; targetMax: number | null; eliteMean: number | null; direction: 'higher_better' | 'lower_better' | 'neutral' }) => {
    if (standard.targetMin === null || standard.targetMax === null || standard.targetMin === standard.targetMax) return null;
    const width = Math.abs(standard.targetMax - standard.targetMin);
    if (standard.direction === 'higher_better') {
      if (value >= standard.targetMin && value <= standard.targetMax) return 0;
      if (value > standard.targetMax) return Math.round((standard.targetMax - value) / width * 100) / 100;
      return Math.round((standard.targetMin - value) / width * 100) / 100;
    }
    if (standard.direction === 'lower_better') {
      if (value >= standard.targetMin && value <= standard.targetMax) return 0;
      if (value < standard.targetMin) return Math.round((value - standard.targetMin) / width * 100) / 100;
      return Math.round((value - standard.targetMax) / width * 100) / 100;
    }
    if (!standard.eliteMean) return null;
    return Math.round(Math.abs(value - standard.eliteMean) / width * 100) / 100;
  };
  const rows = standards.map((standard) => {
    const history = byCode.get(standard.code) || [];
    const current = history[0];
    const previous = history.find((item) => item.testDate !== current?.testDate);
    const value = current?.value ?? null;
    const rawPercent = value === null ? null : standard.direction === 'lower_better'
      ? lowerScore(value, standard.targetMax)
      : standard.direction === 'higher_better'
        ? higherScore(value, standard.targetMin)
        : standard.eliteMean ? 100 - Math.abs(value - standard.eliteMean) / standard.eliteMean * 100 : null;
    const percent = rawPercent === null ? null : Math.round(rawPercent * 10) / 10;
    const score = percent === null ? null : Math.min(120, Math.max(0, percent));
    const status = score === null ? 'missing' : score >= 100 ? 'elite' : score >= 90 ? 'near' : 'develop';
    const standardDistance = value === null ? null : standardDistanceFor(value, standard);
    const eliteGapPct = value === null || !standard.eliteMean ? null
      : Math.round(Math.abs(value - standard.eliteMean) / standard.eliteMean * 1000) / 10;
    const priorityIndex = standardDistance === null ? null : Math.max(0, Math.round(standardDistance * standard.weight * 1000) / 10);
    const gap = value === null ? null : standard.direction === 'lower_better'
      ? (standard.targetMax === null ? null : Math.round((value - standard.targetMax) * 100) / 100)
      : (standard.targetMin === null ? null : Math.round((standard.targetMin - value) * 100) / 100);
    return {
      code: standard.code,
      label: standard.label,
      domain: standard.domain,
      unit: standard.unit,
      direction: standard.direction,
      value,
      previous: previous?.value ?? null,
      targetMin: standard.targetMin,
      targetMax: standard.targetMax,
      eliteMean: standard.eliteMean,
      percent,
      score,
      gap,
      standardDistance,
      eliteGapPct,
      priorityIndex,
      status,
      weight: standard.weight,
      rationale: standard.rationale,
      sourceNote: standard.sourceNote,
      testDate: current?.testDate ?? null
    };
  });
  const comparable = rows.filter((row) => row.score !== null);
  const scoreSum = comparable.reduce((sum, row) => sum + (row.score || 0) * row.weight, 0);
  const weightSum = comparable.reduce((sum, row) => sum + row.weight, 0);
  const score = weightSum ? Math.round(scoreSum / weightSum * 10) / 10 : null;
  const gapRows = comparable.filter((row) => row.standardDistance !== null && row.standardDistance > 0);
  const averageStandardDistance = gapRows.length
    ? Math.round(gapRows.reduce((sum, row) => sum + (row.standardDistance || 0) * row.weight, 0) / gapRows.reduce((sum, row) => sum + row.weight, 0) * 100) / 100
    : comparable.length ? 0 : null;
  const topPriorityIndex = comparable.length ? Math.max(...comparable.map((row) => row.priorityIndex || 0)) : null;
  const achieved = comparable.filter((row) => row.status === 'elite').length;
  const primary = comparable
    .filter((row) => row.status !== 'elite')
    .sort((left, right) => ((right.priorityIndex || 0) - (left.priorityIndex || 0)))[0];
  const primaryGap = primary
    ? `${primary.label}标准化差距 ${formatServerNumber(primary.standardDistance, 2)} 个冠军区间宽度，加权补强优先级 ${formatServerNumber(primary.priorityIndex, 1)}，建议优先纳入下一阶段训练目标。`
    : comparable.length ? '已测试指标整体达到冠军模型参考区间，下一阶段重点维持专项表现和伤病风险控制。' : '暂无可对标实测数据，请先录入专业综合评估。';
  res.json({
    benchmark: {
      athleteId: athlete.id,
      athleteName: athlete.name,
      project: athlete.project,
      gender,
      modelVersion: standards[0]?.modelVersion || 'CHAMPION-2026-R1',
      rows,
      summary: {
        score,
        averageStandardDistance,
        topPriorityIndex,
        achieved,
        comparable: comparable.length,
        primaryGap,
        source: standards[0]?.sourceNote || '项目冠军模型初始化生成'
      }
    }
  });
});

app.get('/api/strength-tests', requireAuth, (req, res) => {
  const user = req.authUser!;
  const athleteId = Number(req.query.athleteId || user.athleteId || 0);
  if (!athleteId) return res.status(400).json({ message: '请选择一名运动员。' });
  if (!hasAthleteAccess(user, athleteId)) return res.status(403).json({ message: '无权查看该运动员的力量测试档案。' });
  const rows = db.prepare(`
    SELECT st.id, st.athlete_id AS athleteId, st.test_date AS testDate,
      st.metrics_json AS metricsJson, st.targets_json AS targetsJson, st.notes,
      st.updated_at AS updatedAt, u.display_name AS updatedBy
    FROM athlete_strength_tests st
    JOIN users u ON u.id = st.updated_by
    WHERE st.athlete_id = ?
    ORDER BY st.test_date DESC, st.id DESC
  `).all(athleteId) as Array<{
    id: number;
    athleteId: number;
    testDate: string;
    metricsJson: string;
    targetsJson: string;
    notes: string;
    updatedAt: string;
    updatedBy: string;
  }>;
  res.json({
    tests: rows.map(({ metricsJson, targetsJson, ...row }) => ({
      ...row,
      metrics: JSON.parse(metricsJson || '{}'),
      targets: JSON.parse(targetsJson || '{}')
    }))
  });
});

app.post('/api/strength-tests', requireAuth, requireRole('SCC', 'PRJ', 'REG', 'TD', 'DMD'), (req, res) => {
  const user = req.authUser!;
  const athleteId = Number(req.body?.athleteId || 0);
  const testDate = cleanString(req.body?.testDate);
  const notes = cleanString(req.body?.notes);
  if (!athleteId || !hasAthleteAccess(user, athleteId)) {
    return res.status(403).json({ message: '无权维护该运动员的力量测试档案。' });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(testDate)) {
    return res.status(400).json({ message: '请选择有效的测试日期。' });
  }
  if (notes.length > 500) return res.status(400).json({ message: '备注不能超过500个字符。' });
  const metricsResult = parseStrengthValues(req.body?.metrics);
  const targetsResult = parseStrengthValues(req.body?.targets, true);
  const errors = [...metricsResult.errors, ...targetsResult.errors];
  if (!Object.keys(metricsResult.values).length) errors.push('至少填写一项实测数据');
  if (errors.length) return res.status(400).json({ message: [...new Set(errors)].join('；') });

  const existing = db.prepare(`
    SELECT id FROM athlete_strength_tests WHERE athlete_id = ? AND test_date = ?
  `).get(athleteId, testDate) as { id: number } | undefined;
  db.prepare(`
    INSERT INTO athlete_strength_tests
      (athlete_id, test_date, metrics_json, targets_json, notes, created_by, updated_by)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(athlete_id, test_date) DO UPDATE SET
      metrics_json = excluded.metrics_json,
      targets_json = excluded.targets_json,
      notes = excluded.notes,
      updated_by = excluded.updated_by,
      updated_at = CURRENT_TIMESTAMP
  `).run(
    athleteId,
    testDate,
    JSON.stringify(metricsResult.values),
    JSON.stringify(targetsResult.values),
    notes,
    user.id,
    user.id
  );
  const saved = db.prepare(`
    SELECT id FROM athlete_strength_tests WHERE athlete_id = ? AND test_date = ?
  `).get(athleteId, testDate) as { id: number };
  db.prepare(`
    INSERT INTO audit_logs (user_id, action, entity_type, entity_id, detail)
    VALUES (?, ?, 'athlete_strength_test', ?, ?)
  `).run(
    user.id,
    existing ? 'UPDATE_STRENGTH_TEST' : 'CREATE_STRENGTH_TEST',
    saved.id,
    JSON.stringify({ athleteId, testDate })
  );
  res.json({ message: existing ? '力量测试档案已更新。' : '力量测试档案已保存。', id: saved.id });
});

app.get('/api/strength-tests/:id/advice', requireAuth, (req, res) => {
  const user = req.authUser!;
  const strengthTestId = Number(req.params.id || 0);
  const test = adviceTestById(strengthTestId);
  if (!test) return res.status(404).json({ message: '力量测试不存在。' });
  if (!hasAthleteAccess(user, test.athleteId)) {
    return res.status(403).json({ message: '无权查看该运动员的训练建议。' });
  }
  res.json({ advice: latestAdvice(strengthTestId, user.role === 'ATL') });
});

app.post(
  '/api/strength-tests/:id/advice/generate',
  requireAuth,
  requireRole('SCC', 'PRJ', 'REG', 'TD', 'DMD'),
  async (req, res, next) => {
    try {
      const user = req.authUser!;
      const strengthTestId = Number(req.params.id || 0);
      const test = adviceTestById(strengthTestId);
      if (!test) return res.status(404).json({ message: '力量测试不存在。' });
      if (!hasAthleteAccess(user, test.athleteId)) {
        return res.status(403).json({ message: '无权为该运动员生成训练建议。' });
      }
      const generated = await buildAiAdvice(test);
      const nextVersion = Number((db.prepare(`
        SELECT COALESCE(MAX(version), 0) + 1 AS version
        FROM strength_ai_advice WHERE strength_test_id = ?
      `).get(strengthTestId) as { version: number }).version);
      const result = db.prepare(`
        INSERT INTO strength_ai_advice
          (strength_test_id, version, content_json, source, model, status, generated_by)
        VALUES (?, ?, ?, ?, ?, 'draft', ?)
      `).run(
        strengthTestId,
        nextVersion,
        JSON.stringify(generated.content),
        generated.source,
        generated.model,
        user.id
      );
      const adviceId = Number(result.lastInsertRowid);
      db.prepare(`
        INSERT INTO audit_logs (user_id, action, entity_type, entity_id, detail)
        VALUES (?, 'GENERATE_STRENGTH_ADVICE', 'strength_ai_advice', ?, ?)
      `).run(user.id, adviceId, JSON.stringify({
        strengthTestId,
        version: nextVersion,
        source: generated.source,
        model: generated.model
      }));
      res.json({
        message: generated.source === 'ai'
          ? 'AI训练建议草案已生成。'
          : 'fallbackReason' in generated
            ? 'AI服务暂时不可用，已自动生成规则兜底草案。'
            : '尚未配置AI API，已根据现有规则生成训练建议草案。',
        advice: latestAdvice(strengthTestId)
      });
    } catch (error) {
      next(error);
    }
  }
);

app.put(
  '/api/strength-tests/:id/advice/:adviceId',
  requireAuth,
  requireRole('SCC', 'PRJ', 'REG', 'TD', 'DMD'),
  (req, res) => {
    const user = req.authUser!;
    const strengthTestId = Number(req.params.id || 0);
    const adviceId = Number(req.params.adviceId || 0);
    const test = adviceTestById(strengthTestId);
    if (!test) return res.status(404).json({ message: '力量测试不存在。' });
    if (!hasAthleteAccess(user, test.athleteId)) {
      return res.status(403).json({ message: '无权编辑该运动员的训练建议。' });
    }
    const exists = db.prepare(`
      SELECT id FROM strength_ai_advice WHERE id = ? AND strength_test_id = ?
    `).get(adviceId, strengthTestId);
    if (!exists) return res.status(404).json({ message: '训练建议不存在。' });
    const content = normalizeAdviceContent(req.body?.content);
    db.prepare(`
      UPDATE strength_ai_advice
      SET content_json = ?, status = 'draft', reviewed_by = NULL, reviewed_at = NULL,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND strength_test_id = ?
    `).run(JSON.stringify(content), adviceId, strengthTestId);
    db.prepare(`
      INSERT INTO audit_logs (user_id, action, entity_type, entity_id, detail)
      VALUES (?, 'UPDATE_STRENGTH_ADVICE', 'strength_ai_advice', ?, ?)
    `).run(user.id, adviceId, JSON.stringify({ strengthTestId }));
    res.json({ message: '训练建议草案已保存，需重新确认。', advice: latestAdvice(strengthTestId) });
  }
);

app.post(
  '/api/strength-tests/:id/advice/:adviceId/approve',
  requireAuth,
  requireRole('SCC', 'PRJ', 'REG', 'TD', 'DMD'),
  (req, res) => {
    const user = req.authUser!;
    const strengthTestId = Number(req.params.id || 0);
    const adviceId = Number(req.params.adviceId || 0);
    const test = adviceTestById(strengthTestId);
    if (!test) return res.status(404).json({ message: '力量测试不存在。' });
    if (!hasAthleteAccess(user, test.athleteId)) {
      return res.status(403).json({ message: '无权确认该运动员的训练建议。' });
    }
    const result = db.prepare(`
      UPDATE strength_ai_advice
      SET status = 'approved', reviewed_by = ?, reviewed_at = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND strength_test_id = ?
    `).run(user.id, adviceId, strengthTestId);
    if (!result.changes) return res.status(404).json({ message: '训练建议不存在。' });
    db.prepare(`
      INSERT INTO audit_logs (user_id, action, entity_type, entity_id, detail)
      VALUES (?, 'APPROVE_STRENGTH_ADVICE', 'strength_ai_advice', ?, ?)
    `).run(user.id, adviceId, JSON.stringify({ strengthTestId }));
    res.json({ message: '训练建议已由教练确认，运动员现在可以查看和下载。', advice: latestAdvice(strengthTestId) });
  }
);

function parseRaceTime(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date) {
    return ((value.getUTCHours() * 60 + value.getUTCMinutes()) * 60 + value.getUTCSeconds()) * 1000 + value.getUTCMilliseconds();
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value <= 0) return null;
    return Math.round(value < 1 ? value * 86400000 : value * 1000);
  }
  const raw = cleanString(value).replace(/[’′]/g, ':').replace(/[”″]/g, '').replace(/，/g, '.');
  if (!raw) return null;
  const parts = raw.split(':').map((part) => Number(part));
  if (parts.some((part) => !Number.isFinite(part) || part < 0) || parts.length > 3) return null;
  let seconds = 0;
  if (parts.length === 3) seconds = parts[0] * 3600 + parts[1] * 60 + parts[2];
  else if (parts.length === 2) seconds = parts[0] * 60 + parts[1];
  else seconds = parts[0];
  return seconds > 0 ? Math.round(seconds * 1000) : null;
}

function findSpecialTestSheet(workbook: ExcelJS.Workbook) {
  for (const sheet of workbook.worksheets) {
    for (let rowNumber = 1; rowNumber <= Math.min(sheet.rowCount, 15); rowNumber += 1) {
      const headings: string[] = [];
      sheet.getRow(rowNumber).eachCell({ includeEmpty: true }, (cell) => headings.push(excelCellText(cell).replace(/\s+/g, '')));
      const hasCrew = headings.includes('运动员/组合') || headings.includes('运动员姓名') || headings.includes('组合名称');
      const hasDate = headings.includes('训练日期') || headings.includes('测试日期');
      const hasDistance = headings.includes('训练距离(m)') || headings.includes('测试距离(m)');
      if (hasDate && hasDistance && hasCrew) return { sheet, headerRowNumber: rowNumber };
    }
  }
  return null;
}

async function parseSpecialTestWorkbook(buffer: Buffer, user: AuthUser, expectedProject: string): Promise<SpecialTestImportRow[]> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
  const found = findSpecialTestSheet(workbook);
  if (!found) throw new Error('未找到专项训练表头，请使用最新模板中的“专项训练成绩”工作表');
  const { sheet, headerRowNumber } = found;
  const headers: string[] = [];
  sheet.getRow(headerRowNumber).eachCell({ includeEmpty: true }, (cell, columnNumber) => { headers[columnNumber] = excelCellText(cell).trim(); });
  const athletes = db.prepare('SELECT id, name, project FROM athletes WHERE active = 1').all() as Array<{ id: number; name: string; project: string }>;
  const athleteByName = new Map(athletes.map((athlete) => [athlete.name.replace(/\s+/g, ''), athlete]));
  const allowed = new Set(accessibleAthleteIds(user));
  const rows: SpecialTestImportRow[] = [];

  sheet.eachRow({ includeEmpty: false }, (excelRow, rowNumber) => {
    if (rowNumber <= headerRowNumber) return;
    const item: Record<string, unknown> = {};
    let hasValue = false;
    headers.forEach((header, columnNumber) => {
      if (!header || !columnNumber) return;
      const cell = excelRow.getCell(columnNumber);
      let value: unknown = cell.value;
      if (value && typeof value === 'object' && 'formula' in value) value = 'result' in value ? (value as { result?: unknown }).result ?? '' : '';
      if (value !== null && value !== undefined && value !== '') hasValue = true;
      item[header] = value ?? '';
    });
    if (!hasValue) return;
    const errors: string[] = [];
    const warnings: string[] = [];
    const testDate = parseDate(pick(item, ['训练日期', '测试日期', '日期']));
    const project = cleanString(pick(item, ['项目', '运动项目'])) as SpecialTestImportRow['project'];
    const distanceM = Math.round(numberOrZero(pick(item, ['训练距离(m)', '训练距离（m）', '训练距离', '测试距离(m)', '测试距离（m）', '测试距离', '距离(m)'])));
    const boatClass = cleanString(pick(item, ['艇型', '项目'])) || '未分组';
    const genderGroup = cleanString(pick(item, ['性别组别', '组别'])) || '未分组';
    const rawCrewName = cleanString(pick(item, ['运动员/组合', '组合名称', '运动员姓名', '姓名']));
    const rawMemberNames = cleanString(pick(item, ['运动员姓名', '成员姓名', '成员']));
    const memberNames = (rawMemberNames || rawCrewName).split(/[、,，+＋/]/).map((name) => name.trim()).filter(Boolean);
    const members = memberNames.map((name) => athleteByName.get(name.replace(/\s+/g, ''))).filter(Boolean) as Array<{ id: number; name: string; project: string }>;
    const attemptsMs = ['第1轮', '第一轮', '一', '第2轮', '第二轮', '二', '第3轮', '第三轮', '三']
      .reduce<number[]>((times, alias, index) => {
        if (index % 3 !== 0) return times;
        const aliases = index === 0 ? ['第1轮', '第一轮', '一'] : index === 3 ? ['第2轮', '第二轮', '二'] : ['第3轮', '第三轮', '三'];
        const parsed = parseRaceTime(pick(item, aliases));
        if (parsed !== null) times.push(parsed);
        return times;
      }, []);
    const previousBestMs = parseRaceTime(pick(item, ['历史最好', '个人最好', '此前最好']));
    if (!testDate) errors.push('训练日期格式无效，应为YYYY-MM-DD');
    if (!projectSet.has(project)) errors.push('项目必须填写“赛艇”“皮划艇”或“激流”');
    else if (project !== expectedProject) errors.push(`当前为${expectedProject}空间，不能导入${project}数据`);
    if (distanceM <= 0 || distanceM > 100000) errors.push('训练距离应为1—100000米');
    if (!rawCrewName) errors.push('缺少运动员/组合');
    if (!memberNames.length) errors.push('缺少运动员姓名');
    for (const name of memberNames) {
      const athlete = athleteByName.get(name.replace(/\s+/g, ''));
      if (!athlete) errors.push(`运动员“${name}”不在系统名单中`);
      else if (!allowed.has(athlete.id)) errors.push(`当前账户无权导入运动员“${name}”`);
      else if (athlete.project !== project) errors.push(`运动员“${name}”属于${athlete.project}，与本行项目不一致`);
    }
    if (!attemptsMs.length) errors.push('至少填写一轮有效成绩，如0:55.15');
    if (attemptsMs.length < 2) warnings.push('仅有一轮成绩，稳定性分析将不完整');
    const averageMs = attemptsMs.length ? Math.round(attemptsMs.reduce((sum, value) => sum + value, 0) / attemptsMs.length) : 0;
    const bestMs = attemptsMs.length ? Math.min(...attemptsMs) : 0;
    rows.push({
      rowNumber,
      testDate,
      project,
      distanceM,
      boatClass,
      genderGroup,
      crewName: rawCrewName,
      memberAthleteIds: members.map((member) => member.id),
      memberNames,
      session: cleanString(pick(item, ['上午/下午', '时段', '训练时段', '测试时段'])),
      windConditions: cleanString(pick(item, ['风向风速', '风况', '风向'])),
      location: cleanString(pick(item, ['训练地点', '测试地点', '地点'])),
      note: cleanString(pick(item, ['备注', '训练备注', '测试备注'])),
      previousBestMs,
      attemptsMs,
      averageMs,
      bestMs,
      errors: [...new Set(errors)],
      warnings: [...new Set(warnings)]
    });
  });
  return rows;
}

app.get('/api/special-tests', requireAuth, (req, res) => {
  const user = req.authUser!;
  const project = cleanString(req.query.project);
  if (!projectSet.has(project)) return res.status(400).json({ message: '请选择赛艇、皮划艇或激流项目。' });
  const from = parseDate(req.query.from) || '1900-01-01';
  const to = parseDate(req.query.to) || '2999-12-31';
  const events = db.prepare(`
    SELECT id, project, test_date AS testDate, distance_m AS distanceM, boat_class AS boatClass,
      gender_group AS genderGroup, session, wind_conditions AS windConditions, location, note
    FROM special_test_events WHERE project = ? AND test_date BETWEEN ? AND ? ORDER BY test_date DESC, distance_m ASC
  `).all(project, from, to) as Array<{ id: number; project: Project; testDate: string; distanceM: number; boatClass: string; genderGroup: string; session: string; windConditions: string; location: string; note: string }>;
  const allowed = new Set(accessibleAthleteIds(user));
  const selectResults = db.prepare(`
    SELECT id, crew_name AS crewName, member_athlete_ids AS memberAthleteIds,
      member_names AS memberNames, previous_best_ms AS previousBestMs,
      attempts_ms AS attemptsMs, average_ms AS averageMs, best_ms AS bestMs
    FROM special_test_results WHERE event_id = ? ORDER BY best_ms ASC, average_ms ASC
  `);
  const output = events.map((event) => {
    const all = (selectResults.all(event.id) as Array<{ id: number; crewName: string; memberAthleteIds: string; memberNames: string; previousBestMs: number | null; attemptsMs: string; averageMs: number; bestMs: number }>).map((row, index) => ({
      ...row,
      rank: index + 1,
      memberAthleteIds: JSON.parse(row.memberAthleteIds || '[]') as number[],
      memberNames: JSON.parse(row.memberNames || '[]') as string[],
      attemptsMs: JSON.parse(row.attemptsMs || '[]') as number[]
    }));
    const visible = all.filter((row) => user.role === 'ATL'
      ? row.memberAthleteIds.some((id) => allowed.has(id))
      : row.memberAthleteIds.every((id) => allowed.has(id)));
    const leaderMs = all[0]?.bestMs || 0;
    return {
      ...event,
      results: visible.map((row) => ({
        ...row,
        crewName: user.role === 'ATL' ? user.displayName : row.crewName,
        memberNames: user.role === 'ATL' ? [user.displayName] : row.memberNames,
        memberAthleteIds: user.role === 'ATL' && user.athleteId ? [user.athleteId] : row.memberAthleteIds,
        deltaPreviousMs: row.previousBestMs === null ? null : row.bestMs - row.previousBestMs,
        gapLeaderMs: leaderMs ? row.bestMs - leaderMs : 0
      }))
    };
  }).filter((event) => event.results.length > 0);
  res.json({ events: output });
});

app.post('/api/special-tests/import/preview', requireAuth, requireRole('SCC', 'PRJ', 'REG', 'TD', 'DMD'), upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ message: '请选择Excel文件。' });
  if (!req.file.originalname.toLowerCase().endsWith('.xlsx')) return res.status(400).json({ message: '当前版本仅支持.xlsx文件。' });
  const project = cleanString(req.body?.project);
  if (!projectSet.has(project)) return res.status(400).json({ message: '请选择赛艇、皮划艇或激流项目。' });
  try {
    const rows = await parseSpecialTestWorkbook(req.file.buffer, req.authUser!, project);
    if (!rows.length) return res.status(400).json({ message: 'Excel中没有可读取的专项训练成绩。' });
    const importId = randomUUID();
    specialTestImportCache.set(importId, { ownerId: req.authUser!.id, rows, expiresAt: Date.now() + 30 * 60 * 1000 });
    res.json({
      importId,
      fileName: req.file.originalname,
      total: rows.length,
      valid: rows.filter((row) => row.errors.length === 0).length,
      invalid: rows.filter((row) => row.errors.length > 0).length,
      warningCount: rows.reduce((sum, row) => sum + row.warnings.length, 0),
      rows: rows.map(({ memberAthleteIds: _ids, ...row }) => row)
    });
  } catch (error) {
    res.status(400).json({ message: `无法读取专项训练Excel：${error instanceof Error ? error.message : '文件格式错误'}` });
  }
});

app.post('/api/special-tests/import/commit', requireAuth, requireRole('SCC', 'PRJ', 'REG', 'TD', 'DMD'), (req, res) => {
  const importId = cleanString(req.body?.importId);
  const cached = specialTestImportCache.get(importId);
  if (!cached || cached.expiresAt < Date.now() || cached.ownerId !== req.authUser!.id) {
    return res.status(400).json({ message: '导入预览已失效，请重新上传Excel。' });
  }
  const rows = cached.rows.filter((row) => row.errors.length === 0);
  const grouped = new Map<string, SpecialTestImportRow[]>();
  for (const row of rows) {
    const key = [row.project, row.testDate, row.distanceM, row.boatClass, row.genderGroup, row.session].join('|');
    grouped.set(key, [...(grouped.get(key) || []), row]);
  }
  const upsertEvent = db.prepare(`
    INSERT INTO special_test_events
      (project, test_date, distance_m, boat_class, gender_group, session, wind_conditions, location, note, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(project, test_date, distance_m, boat_class, gender_group, session) DO UPDATE SET
      wind_conditions = excluded.wind_conditions, location = excluded.location, note = excluded.note
    RETURNING id
  `);
  const insertResult = db.prepare(`
    INSERT INTO special_test_results
      (event_id, crew_name, member_athlete_ids, member_names, previous_best_ms, attempts_ms, average_ms, best_ms)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  db.exec('BEGIN');
  try {
    for (const eventRows of grouped.values()) {
      const first = eventRows[0];
      const saved = upsertEvent.get(first.project, first.testDate, first.distanceM, first.boatClass, first.genderGroup, first.session, first.windConditions, first.location, first.note, req.authUser!.id) as { id: number };
      db.prepare('DELETE FROM special_test_results WHERE event_id = ?').run(saved.id);
      for (const row of eventRows) {
        insertResult.run(saved.id, row.crewName, JSON.stringify(row.memberAthleteIds), JSON.stringify(row.memberNames), row.previousBestMs, JSON.stringify(row.attemptsMs), row.averageMs, row.bestMs);
      }
    }
    db.prepare("INSERT INTO audit_logs (user_id, action, entity_type, detail) VALUES (?, 'IMPORT_SPECIAL_TEST', 'special_test_event', ?)")
      .run(req.authUser!.id, JSON.stringify({ events: grouped.size, results: rows.length }));
    db.exec('COMMIT');
    specialTestImportCache.delete(importId);
    res.json({ imported: rows.length, events: grouped.size, skipped: cached.rows.length - rows.length });
  } catch (error) {
    db.exec('ROLLBACK');
    res.status(500).json({ message: `写入专项训练数据失败：${error instanceof Error ? error.message : '未知错误'}` });
  }
});

app.get('/api/special-tests/import/template', requireAuth, requireRole('SCC', 'PRJ', 'REG', 'TD', 'DMD'), async (_req, res, next) => {
  const templateName = '竞迹专项训练导入模板.xlsx';
  const templatePath = resolve(process.cwd(), 'public', 'templates', templateName);
  if (!existsSync(templatePath)) return res.status(500).json({ message: '标准模板尚未部署，请联系管理员。' });
  try {
    const template = readFileSync(templatePath);
    const downloadName = '竞迹专项训练导入模板.xlsx';
    res.setHeader('Content-Disposition', `attachment; filename="special-training-import-template.xlsx"; filename*=UTF-8''${encodeURIComponent(downloadName)}`);
    res.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').send(template);
  } catch (error) {
    next(error);
  }
});

app.get('/api/admin/registrations', requireAuth, requireRole('SCC', 'PRJ', 'REG', 'TD', 'DMD'), (req, res) => {
  const requestedStatus = cleanString(req.query.status);
  const status = ['pending', 'approved', 'rejected'].includes(requestedStatus) ? requestedStatus : 'pending';
  const allRequests = db.prepare(`
    SELECT id, username, display_name AS displayName, requested_role AS requestedRole,
      project, team, gender, identity_number AS identityNumber, native_place AS nativePlace, status,
      created_at AS createdAt, reviewed_at AS reviewedAt
    FROM registration_requests WHERE status = ? ORDER BY created_at ASC
  `).all(status) as Array<{
    id: number;
    username: string;
    displayName: string;
    requestedRole: 'ATL' | 'SCC';
    project: string;
    team: string;
    gender: string | null;
    identityNumber: string | null;
    nativePlace: string | null;
    status: string;
    createdAt: string;
    reviewedAt: string | null;
  }>;
  const reviewer = req.authUser!;
  const permissions = accountPermissions(reviewer.id);
  const requests = allRequests.filter((request) =>
    canManageRole(reviewer.role, request.requestedRole)
      && permissionsAllowProjectTeam(permissions, request.project, request.team)
  );
  const pending = status === 'pending' ? requests.length : (db.prepare(`
    SELECT requested_role AS requestedRole, project, team
    FROM registration_requests WHERE status = 'pending'
  `).all() as Array<{ requestedRole: 'ATL' | 'SCC'; project: string; team: string }>)
    .filter((request) => canManageRole(reviewer.role, request.requestedRole)
      && permissionsAllowProjectTeam(permissions, request.project, request.team)).length;
  res.json({ requests, pending });
});

app.put('/api/admin/registrations/:id/name', requireAuth, requireRole('SCC', 'PRJ', 'REG', 'TD', 'DMD'), (req, res) => {
  const requestId = Number(req.params.id);
  const registration = db.prepare(`
    SELECT id, username, display_name AS displayName, requested_role AS requestedRole, status
    FROM registration_requests WHERE id = ?
  `).get(requestId) as {
    id: number;
    username: string;
    displayName: string;
    requestedRole: 'ATL' | 'SCC';
    status: 'pending' | 'approved' | 'rejected';
  } | undefined;
  if (!registration) return res.status(404).json({ message: '注册申请不存在。' });
  const registrationScope = db.prepare(`
    SELECT requested_role AS requestedRole, project, team
    FROM registration_requests WHERE id = ?
  `).get(requestId) as { requestedRole: Role; project: string; team: string };
  if (
    !canManageRole(req.authUser!.role, registrationScope.requestedRole)
    || !permissionsAllowProjectTeam(accountPermissions(req.authUser!.id), registrationScope.project, registrationScope.team)
  ) return res.status(403).json({ message: '无权修改该注册申请。' });
  const { name, error } = validatePersonName(req.body?.name);
  if (error) return res.status(400).json({ message: error });

  db.exec('BEGIN');
  try {
    db.prepare('UPDATE registration_requests SET display_name = ? WHERE id = ?').run(name, requestId);
    if (registration.status === 'approved') {
      const linkedUser = db.prepare('SELECT id, athlete_id AS athleteId FROM users WHERE username = ?').get(registration.username) as {
        id: number;
        athleteId: number | null;
      } | undefined;
      if (linkedUser) {
        db.prepare('UPDATE users SET display_name = ? WHERE id = ?').run(name, linkedUser.id);
        if (registration.requestedRole === 'ATL' && linkedUser.athleteId) {
          db.prepare('UPDATE athletes SET name = ? WHERE id = ?').run(name, linkedUser.athleteId);
        }
      }
    }
    db.prepare('INSERT INTO audit_logs (user_id, action, entity_type, entity_id, detail) VALUES (?, ?, ?, ?, ?)')
      .run(
        req.authUser!.id,
        'UPDATE_REGISTRATION_NAME',
        'registration_request',
        requestId,
        JSON.stringify({ from: registration.displayName, to: name })
      );
    db.exec('COMMIT');
    res.json({ message: '申请姓名已修改。', displayName: name });
  } catch (renameError) {
    db.exec('ROLLBACK');
    const message = renameError instanceof Error && renameError.message.includes('UNIQUE')
      ? '该姓名已被其他运动员使用。'
      : '姓名修改失败。';
    res.status(409).json({ message });
  }
});

app.post('/api/admin/registrations/:id/approve', requireAuth, requireRole('SCC', 'PRJ', 'REG', 'TD', 'DMD'), (req, res) => {
  const requestId = Number(req.params.id);
  const request = db.prepare(`
    SELECT id, username, password_hash, display_name, requested_role,
      project, team, gender, identity_number, native_place, status
    FROM registration_requests WHERE id = ?
  `).get(requestId) as {
    id: number; username: string; password_hash: string; display_name: string;
    requested_role: 'ATL' | 'SCC'; project: string; team: string;
    gender: string | null; status: string;
    identity_number: string | null; native_place: string | null;
  } | undefined;
  if (!request) return res.status(404).json({ message: '注册申请不存在。' });
  if (request.status !== 'pending') return res.status(409).json({ message: '该申请已经处理。' });
  if (db.prepare('SELECT id FROM users WHERE username = ?').get(request.username)) {
    return res.status(409).json({ message: '账号已存在，无法重复审核。' });
  }
  const reviewer = req.authUser!;
  if (
    !canManageRole(reviewer.role, request.requested_role)
    || !permissionsAllowProjectTeam(accountPermissions(reviewer.id), request.project, request.team)
  ) return res.status(403).json({ message: '该申请超出当前账号的管辖范围。' });

  db.exec('BEGIN');
  try {
    let athleteId: number | null = null;
    if (request.requested_role === 'ATL') {
      const athlete = db.prepare('SELECT id FROM athletes WHERE name = ?').get(request.display_name) as { id: number } | undefined;
      if (athlete) {
        const linkedUser = db.prepare("SELECT id FROM users WHERE athlete_id = ? AND role = 'ATL'").get(athlete.id);
        if (linkedUser) throw new Error('该运动员已有登录账户。');
        athleteId = athlete.id;
      } else {
        const result = db.prepare(`
          INSERT INTO athletes (name, project, team, gender, region, city, county)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `)
          .run(
            request.display_name,
            request.project,
            request.team,
            request.gender,
            '未设置',
            '未设置',
            '未设置'
          );
        athleteId = Number(result.lastInsertRowid);
      }
      db.prepare(`
        INSERT OR IGNORE INTO athlete_profiles (athlete_id, identity_number, native_place, created_at)
        VALUES (?, ?, ?, CURRENT_TIMESTAMP)
      `).run(athleteId, request.identity_number || '', request.native_place || '');
      const [originProvince = '', originCity = '', originCounty = ''] = (request.native_place || '').split('/');
      if (athleteId && provinceSet.has(originProvince) && originCity) {
        upsertAthleteOrigin({
          athleteId,
          province: originProvince,
          city: originCity,
          county: originCounty,
          source: 'registration',
          quality: 'valid'
        });
      }
    }

    const result = db.prepare(`
      INSERT INTO users (username, password_hash, display_name, role, athlete_id)
      VALUES (?, ?, ?, ?, ?)
    `).run(request.username, request.password_hash, request.display_name, request.requested_role, athleteId);
    const newUserId = Number(result.lastInsertRowid);
    if (request.requested_role === 'SCC') {
      db.prepare('INSERT OR IGNORE INTO coach_profiles (user_id, category) VALUES (?, ?)')
        .run(newUserId, DEFAULT_COACH_CATEGORY);
    }
    const inheritedArea = accountPermissions(reviewer.id).areas[0] || {
      areaLevel: 'national' as AreaLevel, province: '', city: '', county: ''
    };
    initializeAccountScope({
      userId: newUserId,
      role: request.requested_role,
      parentUserId: reviewer.id,
      province: inheritedArea.province,
      city: inheritedArea.city,
      county: inheritedArea.county,
      project: request.project,
      team: request.team,
      grantedBy: reviewer.id,
      areaLevel: inheritedArea.areaLevel
    });
    if (request.requested_role === 'ATL' && reviewer.role === 'SCC' && athleteId) {
      db.prepare('INSERT OR IGNORE INTO coach_athletes (coach_user_id, athlete_id) VALUES (?, ?)')
        .run(reviewer.id, athleteId);
    }
    db.prepare(`
      UPDATE registration_requests SET status = 'approved', reviewed_by = ?, reviewed_at = CURRENT_TIMESTAMP WHERE id = ?
    `).run(req.authUser!.id, requestId);
    db.prepare('INSERT INTO audit_logs (user_id, action, entity_type, entity_id, detail) VALUES (?, ?, ?, ?, ?)')
      .run(req.authUser!.id, 'APPROVE_REGISTRATION', 'user', Number(result.lastInsertRowid), JSON.stringify({ requestId, role: request.requested_role }));
    db.exec('COMMIT');
    res.json({ message: '账户已开通。' });
  } catch (error) {
    db.exec('ROLLBACK');
    res.status(400).json({ message: error instanceof Error ? error.message : '审核失败。' });
  }
});

app.post('/api/admin/registrations/:id/reject', requireAuth, requireRole('SCC', 'PRJ', 'REG', 'TD', 'DMD'), (req, res) => {
  const requestId = Number(req.params.id);
  const registration = db.prepare(`
    SELECT requested_role AS requestedRole, project, team
    FROM registration_requests WHERE id = ?
  `).get(requestId) as {
    requestedRole: Role; project: string; team: string;
  } | undefined;
  if (!registration) return res.status(404).json({ message: '注册申请不存在。' });
  if (
    !canManageRole(req.authUser!.role, registration.requestedRole)
    || !permissionsAllowProjectTeam(accountPermissions(req.authUser!.id), registration.project, registration.team)
  ) return res.status(403).json({ message: '无权处理该注册申请。' });
  const result = db.prepare(`
    UPDATE registration_requests SET status = 'rejected', reviewed_by = ?, reviewed_at = CURRENT_TIMESTAMP
    WHERE id = ? AND status = 'pending'
  `).run(req.authUser!.id, requestId);
  if (!result.changes) return res.status(409).json({ message: '申请不存在或已经处理。' });
  db.prepare('INSERT INTO audit_logs (user_id, action, entity_type, entity_id) VALUES (?, ?, ?, ?)')
    .run(req.authUser!.id, 'REJECT_REGISTRATION', 'registration_request', requestId);
  res.json({ message: '申请已拒绝。' });
});

app.get('/api/admin/assignments', requireAuth, requireRole('SCC', 'PRJ', 'REG', 'TD', 'DMD'), (req, res) => {
  const ids = accessibleAthleteIds(req.authUser!);
  if (!ids.length) return res.json({ athletes: [], coaches: [] });
  const placeholders = ids.map(() => '?').join(',');
  const athletes = db.prepare(`
    SELECT a.id, a.name, a.project, a.team, a.gender, a.region, a.region AS province, a.city, a.county,
      COALESCE(GROUP_CONCAT(u.display_name, '、'), '') AS coaches,
      COALESCE(GROUP_CONCAT(u.id, ','), '') AS coachIds
    FROM athletes a
    LEFT JOIN coach_athletes ca ON ca.athlete_id = a.id
    LEFT JOIN users u ON u.id = ca.coach_user_id
    WHERE a.id IN (${placeholders}) AND a.active = 1
    GROUP BY a.id ORDER BY a.project, a.team, a.name
  `).all(...ids);
  const allCoaches = db.prepare(`
    SELECT u.id, u.username, u.display_name AS displayName, u.role, u.athlete_id AS athleteId,
      COALESCE(cp.category, '体能教练') AS category
    FROM users u
    LEFT JOIN coach_profiles cp ON cp.user_id = u.id
    WHERE u.role = 'SCC' AND u.active = 1 ORDER BY u.id
  `).all() as Array<AuthUser & { displayName: string; category: string }>;
  const coaches = allCoaches
    .filter((coach) => coach.id === req.authUser!.id || canManageAccount(req.authUser!, coach))
    .map(({ id, displayName, category }) => ({ id, displayName, category }));
  res.json({ athletes, coaches });
});

app.put('/api/admin/coaches/:id/category', requireAuth, requireRole('PRJ', 'REG', 'TD', 'DMD'), (req, res) => {
  const currentUser = req.authUser!;
  const coachId = Number(req.params.id);
  const category = cleanString(req.body?.category);
  const coach = userById(coachId);
  if (!coach || coach.role !== 'SCC' || !canManageAccount(currentUser, coach)) {
    return res.status(404).json({ message: '教练不存在或不在可管理范围内。' });
  }
  if (!isCoachCategory(category)) return res.status(400).json({ message: '教练类别无效。' });
  db.prepare(`
    INSERT INTO coach_profiles (user_id, category, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(user_id) DO UPDATE SET category = excluded.category, updated_at = CURRENT_TIMESTAMP
  `).run(coachId, category);
  db.prepare('INSERT INTO audit_logs (user_id, action, entity_type, entity_id, detail) VALUES (?, ?, ?, ?, ?)')
    .run(currentUser.id, 'UPDATE_COACH_CATEGORY', 'user', coachId, JSON.stringify({ category }));
  res.json({ message: '教练类别已更新。', category });
});

app.put('/api/admin/assignments/:athleteId', requireAuth, requireRole('PRJ', 'REG', 'TD', 'DMD'), (req, res) => {
  const athleteId = Number(req.params.athleteId);
  const coachIds = Array.isArray(req.body?.coachIds) ? req.body.coachIds.map(Number).filter(Number.isFinite) : [];
  const region = cleanString(req.body?.region);
  const city = cleanString(req.body?.city);
  const county = cleanString(req.body?.county);
  const currentUser = req.authUser!;
  const validCoaches = new Set(
    (db.prepare(`
      SELECT id, username, display_name AS displayName, role, athlete_id AS athleteId
      FROM users WHERE role = 'SCC' AND active = 1
    `).all() as AuthUser[])
      .filter((coach) => canManageAccount(currentUser, coach))
      .map((row) => row.id)
  );
  const athlete = db.prepare('SELECT id, project, team FROM athletes WHERE id = ?').get(athleteId) as {
    id: number; project: string; team: string;
  } | undefined;
  const targetScope = {
    id: athleteId,
    region,
    city,
    county,
    project: athlete?.project || '',
    team: athlete?.team || ''
  };
  if (
    !athlete
    || !hasAthleteAccess(currentUser, athleteId)
    || coachIds.some((id: number) => !validCoaches.has(id))
    || !provinceSet.has(region)
    || city.length < 2
    || county.length < 2
    || !permissionsAllowAthlete(accountPermissions(currentUser.id), targetScope)
  ) {
    return res.status(400).json({ message: '运动员或教练信息无效。' });
  }
  db.exec('BEGIN');
  try {
    db.prepare('UPDATE athletes SET region = ?, city = ?, county = ? WHERE id = ?').run(region, city, county, athleteId);
    db.prepare(`
      UPDATE training_records SET province = ?, city = ?, county = ? WHERE athlete_id = ?
    `).run(region, city, county, athleteId);
    const athleteUser = db.prepare("SELECT id FROM users WHERE athlete_id = ? AND role = 'ATL'").get(athleteId) as { id: number } | undefined;
    if (athleteUser) {
      db.prepare('DELETE FROM user_area_permissions WHERE user_id = ?').run(athleteUser.id);
      db.prepare(`
        INSERT INTO user_area_permissions (user_id, area_level, province, city, county, granted_by)
        VALUES (?, 'county', ?, ?, ?, ?)
      `).run(athleteUser.id, region, city, county, currentUser.id);
    }
    db.prepare('DELETE FROM coach_athletes WHERE athlete_id = ?').run(athleteId);
    const insert = db.prepare('INSERT INTO coach_athletes (coach_user_id, athlete_id) VALUES (?, ?)');
    for (const coachId of coachIds) insert.run(coachId, athleteId);
    db.prepare('INSERT INTO audit_logs (user_id, action, entity_type, entity_id, detail) VALUES (?, ?, ?, ?, ?)')
      .run(currentUser.id, 'UPDATE_ASSIGNMENT', 'athlete', athleteId, JSON.stringify({ coachIds, region, city, county }));
    db.exec('COMMIT');
    res.json({ updated: true });
  } catch (error) {
    db.exec('ROLLBACK');
    res.status(500).json({ message: `更新关系失败：${error instanceof Error ? error.message : '未知错误'}` });
  }
});

type AccountRow = AuthUser & {
  active: number;
  parentUserId: number | null;
  parentName: string | null;
  accountCode: string;
};

function allAccountRows() {
  return db.prepare(`
    SELECT u.id, u.username, u.display_name AS displayName, u.role,
      u.athlete_id AS athleteId, u.active,
      ap.parent_user_id AS parentUserId, parent.display_name AS parentName,
      COALESCE(ap.account_code, '') AS accountCode
    FROM users u
    LEFT JOIN account_profiles ap ON ap.user_id = u.id
    LEFT JOIN users parent ON parent.id = ap.parent_user_id
    ORDER BY CASE u.role
      WHEN 'DMD' THEN 5 WHEN 'TD' THEN 4 WHEN 'PRJ' THEN 3
      WHEN 'REG' THEN 3 WHEN 'SCC' THEN 2 ELSE 1 END DESC,
      u.display_name, u.id
  `).all() as AccountRow[];
}

function serializeAccount(row: AccountRow) {
  const permissions = accountPermissions(row.id);
  return {
    ...row,
    roleLabel: ROLE_META[row.role].label,
    roleLevel: ROLE_META[row.role].level,
    standardName: standardAccountName({
      displayName: row.displayName,
      role: row.role,
      areas: permissions.areas,
      projects: permissions.projects,
      teams: permissions.teams
    }),
    areas: permissions.areas,
    projects: permissions.projects,
    teams: permissions.teams
  };
}

function resolveParent(
  currentUser: AuthUser,
  targetRole: Role,
  parentUserId: number,
  targetPermissions: ReturnType<typeof parseScopePayload>
) {
  const parent = userById(parentUserId);
  if (!parent || !canManageRole(parent.role, targetRole)) return { error: '上级账号层级不符合要求。', parent: null };
  if (parent.id !== currentUser.id && !canManageAccount(currentUser, parent)) {
    return { error: '不能选择权限范围外的上级账号。', parent: null };
  }
  if (!permissionsContain(accountPermissions(parent.id), targetPermissions)) {
    return { error: '账号权限范围不能超出上级账号。', parent: null };
  }
  return { error: '', parent };
}

app.get('/api/access/accounts', requireAuth, requireRole('SCC', 'PRJ', 'REG', 'TD', 'DMD'), (req, res) => {
  const currentUser = req.authUser!;
  const rows = allAccountRows();
  const current = rows.find((row) => row.id === currentUser.id);
  const accounts = rows.filter((row) => row.id !== currentUser.id && canManageAccount(currentUser, row));
  const visibleParents = rows.filter((row) =>
    row.active === 1
    && (row.id === currentUser.id || canManageAccount(currentUser, row))
    && canManageRole(currentUser.role, 'ATL')
  );
  res.json({
    current: current ? serializeAccount(current) : null,
    accounts: accounts.map(serializeAccount),
    possibleParents: visibleParents.map((row) => ({
      id: row.id,
      displayName: row.displayName,
      role: row.role,
      roleLabel: ROLE_META[row.role].label
    })),
    meta: {
      roles: ROLE_META,
      hierarchy: ROLE_HIERARCHY,
      areaLevels: AREA_LEVEL_META,
      provinces: PROVINCES,
      projects: [...PROJECTS]
    }
  });
});

app.post('/api/access/accounts', requireAuth, requireRole('SCC', 'PRJ', 'REG', 'TD', 'DMD'), (req, res) => {
  const currentUser = req.authUser!;
  const username = cleanString(req.body?.username).toLowerCase();
  const password = cleanString(req.body?.password);
  const displayNameResult = validatePersonName(req.body?.displayName);
  const role = cleanString(req.body?.role) as Role;
  const parentUserId = Number(req.body?.parentUserId);
  const gender = cleanString(req.body?.gender);
  const coachCategory = cleanString(req.body?.coachCategory) || DEFAULT_COACH_CATEGORY;
  const permissions = parseScopePayload(req.body);
  const errors: string[] = [];
  if (!/^[a-z0-9_]{4,24}$/.test(username)) errors.push('账号须为4—24位字母、数字或下划线');
  if (password.length < 8 || password.length > 72 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) {
    errors.push('密码须为8—72位，并同时包含字母和数字');
  }
  if (displayNameResult.error) errors.push(displayNameResult.error);
  if (!ROLES.includes(role) || !canManageRole(currentUser.role, role)) errors.push('不能创建该层级的账号');
  const scopeError = validateScopePayload(permissions);
  if (scopeError) errors.push(scopeError);
  if (!permissionsContain(accountPermissions(currentUser.id), permissions)) errors.push('账号权限范围不能超出当前账号');
  if (role === 'ATL') {
    if (permissions.areas.length !== 1 || permissions.areas[0].areaLevel !== 'county') {
      errors.push('运动员必须绑定一个省、市、区县');
    }
    if (permissions.projects.length !== 1 || permissions.projects[0] === '*') errors.push('运动员必须绑定一个具体项目');
    if (permissions.teams.length !== 1 || permissions.teams[0].team === '*') errors.push('运动员必须绑定一个具体队伍');
    if (!['男', '女'].includes(gender)) errors.push('请选择运动员性别');
  }
  if (role === 'SCC' && !isCoachCategory(coachCategory)) errors.push('请选择有效的教练类别');
  const parentResult = Number.isFinite(parentUserId)
    ? resolveParent(currentUser, role, parentUserId, permissions)
    : { error: '请选择上级管理账号。', parent: null };
  if (parentResult.error) errors.push(parentResult.error);
  if (errors.length) return res.status(400).json({ message: [...new Set(errors)].join('；') });
  if (db.prepare('SELECT id FROM users WHERE username = ?').get(username)) {
    return res.status(409).json({ message: '该登录账号已存在。' });
  }

  db.exec('BEGIN');
  try {
    let athleteId: number | null = null;
    const area = permissions.areas[0];
    const project = permissions.projects[0];
    const team = permissions.teams[0].team;
    if (role === 'ATL') {
      const athleteResult = db.prepare(`
        INSERT INTO athletes (name, project, team, gender, region, city, county)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(displayNameResult.name, project, team, gender, area.province, area.city, area.county);
      athleteId = Number(athleteResult.lastInsertRowid);
      db.prepare(`
        INSERT INTO athlete_profiles (athlete_id, created_at)
        VALUES (?, CURRENT_TIMESTAMP)
      `).run(athleteId);
    }
    const userResult = db.prepare(`
      INSERT INTO users (username, password_hash, display_name, role, athlete_id, active)
      VALUES (?, ?, ?, ?, ?, 1)
    `).run(username, bcrypt.hashSync(password, 11), displayNameResult.name, role, athleteId);
    const userId = Number(userResult.lastInsertRowid);
    if (role === 'SCC') {
      db.prepare('INSERT INTO coach_profiles (user_id, category) VALUES (?, ?)').run(userId, coachCategory);
    }
    db.prepare(`
      INSERT INTO account_profiles (user_id, parent_user_id, account_code)
      VALUES (?, ?, ?)
    `).run(userId, parentUserId, accountCodeFor(userId, role, area.province, project));
    replaceAccountScope({ userId, role, parentUserId, permissions, grantedBy: currentUser.id });
    if (role === 'ATL' && athleteId && parentResult.parent?.role === 'SCC') {
      db.prepare('INSERT INTO coach_athletes (coach_user_id, athlete_id) VALUES (?, ?)').run(parentUserId, athleteId);
    }
    db.prepare('INSERT INTO audit_logs (user_id, action, entity_type, entity_id, detail) VALUES (?, ?, ?, ?, ?)')
      .run(currentUser.id, 'CREATE_ACCOUNT', 'user', userId, JSON.stringify({ username, role, parentUserId, permissions }));
    db.exec('COMMIT');
    res.status(201).json({ message: '账号已创建并完成权限绑定。', id: userId });
  } catch (error) {
    db.exec('ROLLBACK');
    const message = error instanceof Error && error.message.includes('UNIQUE')
      ? '姓名或账号已存在，请核对后再试。'
      : error instanceof Error ? error.message : '创建账号失败。';
    res.status(400).json({ message });
  }
});

app.put('/api/access/accounts/:id', requireAuth, requireRole('PRJ', 'REG', 'TD', 'DMD'), (req, res) => {
  const currentUser = req.authUser!;
  const targetId = Number(req.params.id);
  const target = userById(targetId);
  if (!target || !canManageAccount(currentUser, target)) {
    return res.status(404).json({ message: '账号不存在或不在可管理范围内。' });
  }
  const role = cleanString(req.body?.role) as Role;
  const parentUserId = Number(req.body?.parentUserId);
  const permissions = parseScopePayload(req.body);
  const scopeError = validateScopePayload(permissions);
  if (!ROLES.includes(role) || !canManageRole(currentUser.role, role)) {
    return res.status(400).json({ message: '目标角色层级无效。' });
  }
  if ((target.role === 'ATL') !== (role === 'ATL')) {
    return res.status(400).json({ message: '运动员账号不能与管理岗位相互转换。' });
  }
  if (scopeError) return res.status(400).json({ message: scopeError });
  if (!permissionsContain(accountPermissions(currentUser.id), permissions)) {
    return res.status(403).json({ message: '新的权限范围不能超出当前账号。' });
  }
  const parentResult = resolveParent(currentUser, role, parentUserId, permissions);
  if (parentResult.error) return res.status(400).json({ message: parentResult.error });
  if (parentUserId === targetId) return res.status(400).json({ message: '上级账号不能选择本人。' });
  if (target.role === 'ATL') {
    if (permissions.areas.length !== 1 || permissions.areas[0].areaLevel !== 'county'
      || permissions.projects.length !== 1 || permissions.projects[0] === '*'
      || permissions.teams.length !== 1 || permissions.teams[0].team === '*') {
      return res.status(400).json({ message: '运动员必须绑定一个具体区县、项目和队伍。' });
    }
  }

  db.exec('BEGIN');
  try {
    db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, targetId);
    replaceAccountScope({ userId: targetId, role, parentUserId, permissions, grantedBy: currentUser.id });
    if (target.role === 'ATL' && target.athleteId) {
      const area = permissions.areas[0];
      const project = permissions.projects[0];
      const team = permissions.teams[0].team;
      db.prepare(`
        UPDATE athletes SET region = ?, city = ?, county = ?, project = ?, team = ? WHERE id = ?
      `).run(area.province, area.city, area.county, project, team, target.athleteId);
      db.prepare(`
        UPDATE training_records SET province = ?, city = ?, county = ?, project = ?, team = ? WHERE athlete_id = ?
      `).run(area.province, area.city, area.county, project, team, target.athleteId);
      db.prepare('DELETE FROM coach_athletes WHERE athlete_id = ?').run(target.athleteId);
      if (parentResult.parent?.role === 'SCC') {
        db.prepare('INSERT INTO coach_athletes (coach_user_id, athlete_id) VALUES (?, ?)').run(parentUserId, target.athleteId);
      }
    }
    db.prepare('INSERT INTO audit_logs (user_id, action, entity_type, entity_id, detail) VALUES (?, ?, ?, ?, ?)')
      .run(currentUser.id, 'UPDATE_ACCOUNT_ACCESS', 'user', targetId, JSON.stringify({ role, parentUserId, permissions }));
    db.exec('COMMIT');
    res.json({ message: '角色、上级账号和数据范围已更新。' });
  } catch (error) {
    db.exec('ROLLBACK');
    res.status(500).json({ message: error instanceof Error ? error.message : '权限更新失败。' });
  }
});

app.put('/api/access/accounts/:id/status', requireAuth, requireRole('PRJ', 'REG', 'TD', 'DMD'), (req, res) => {
  const currentUser = req.authUser!;
  const targetId = Number(req.params.id);
  const target = userById(targetId);
  if (!target || !canManageAccount(currentUser, target)) {
    return res.status(404).json({ message: '账号不存在或不在可管理范围内。' });
  }
  const active = req.body?.active === true;
  db.prepare('UPDATE users SET active = ? WHERE id = ?').run(active ? 1 : 0, targetId);
  db.prepare('INSERT INTO audit_logs (user_id, action, entity_type, entity_id, detail) VALUES (?, ?, ?, ?, ?)')
    .run(currentUser.id, active ? 'ENABLE_ACCOUNT' : 'DISABLE_ACCOUNT', 'user', targetId, JSON.stringify({ active }));
  res.json({ message: active ? '账号已启用。' : '账号已停用。', active });
});

app.get('/api/access/audit-logs', requireAuth, requireRole('DMD'), (req, res) => {
  const currentUser = req.authUser!;
  const visibleIds = allAccountRows()
    .filter((row) => row.id === currentUser.id || canManageAccount(currentUser, row))
    .map((row) => row.id);
  if (!visibleIds.length) return res.json({ logs: [] });
  const placeholders = visibleIds.map(() => '?').join(',');
  const logs = db.prepare(`
    SELECT l.id, l.action, l.entity_type AS entityType, l.entity_id AS entityId,
      l.detail, l.created_at AS createdAt,
      u.id AS actorId, u.display_name AS actorName, u.username AS actorUsername
    FROM audit_logs l
    JOIN users u ON u.id = l.user_id
    WHERE l.user_id IN (${placeholders})
    ORDER BY l.id DESC LIMIT 200
  `).all(...visibleIds);
  res.json({ logs });
});

const distPath = resolve(process.cwd(), 'dist');
if (existsSync(distPath)) {
  app.use(express.static(distPath));
  app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(resolve(distPath, 'index.html')));
}

app.use((error: Error, _req: Request, res: Response, _next: NextFunction) => {
  const status = Number((error as Error & { status?: number }).status || 0);
  if (error instanceof multer.MulterError || error.message.startsWith('证件照仅支持')) {
    return res.status(400).json({ message: error.message });
  }
  if (status === 404) return res.status(404).json({ message: '文件不存在。' });
  res.status(500).json({ message: error.message || '服务器发生错误。' });
});

const server = app.listen(port, () => {
  console.log(`Training Monitor API running at http://localhost:${port}`);
});

let shuttingDown = false;
function shutdown(signal: NodeJS.Signals) {
  if (shuttingDown) return;
  shuttingDown = true;
  server.close(() => {
    try { db.close(); } catch {}
    process.exit(0);
  });
  setTimeout(() => {
    try { db.close(); } catch {}
    process.exit(0);
  }, 5000).unref();
  console.log(`收到 ${signal}，正在关闭服务。`);
}

process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));
