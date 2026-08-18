import express, { type NextFunction, type Request, type Response } from 'express';
import multer from 'multer';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import ExcelJS from 'exceljs';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { db } from './db.ts';
import { PROVINCES } from '../shared/regions.ts';
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
import {
  STRENGTH_METRICS,
  type StrengthMetricValues
} from '../shared/strength-model.ts';

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
};

type TrainingPlanLine = {
  id: string;
  weeks: Record<'1' | '2' | '3' | '4', TrainingPlanWeekEntry>;
};

type TrainingPlanExercise = {
  id: string;
  name: string;
  maxWeight: number | null;
  unitNote: string;
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
};

type ImportRow = {
  rowNumber: number;
  athleteId: number | null;
  athleteName: string;
  province: string;
  city: string;
  county: string;
  project: string;
  team: string;
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
  status: 'normal' | 'attention' | 'alert' | 'rest' | 'missing';
  coachNote: string;
  trainingBreakdown: TrainingBreakdown;
  errors: string[];
  warnings: string[];
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
const importCache = new Map<string, { ownerId: number; rows: ImportRow[]; expiresAt: number }>();
const specialTestImportCache = new Map<string, { ownerId: number; rows: SpecialTestImportRow[]; expiresAt: number }>();
const trainingPlanBatchCache = new Map<string, {
  ownerId: number;
  athleteIds: number[];
  data: TrainingPlanData;
  conflicts: number[];
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

function optionalNumber(value: unknown, min: number, max: number, label: string, errors: string[]) {
  if (value === '' || value === null || value === undefined) return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < min || numeric > max) {
    errors.push(`${label}应在${min}至${max}之间`);
    return null;
  }
  return Math.round(numeric * 10) / 10;
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
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
    errors.push('请选择有效的开始日期和结束日期');
  } else {
    const days = Math.round((Date.parse(`${endDate}T12:00:00Z`) - Date.parse(`${startDate}T12:00:00Z`)) / 86400000) + 1;
    if (days < 28 || days > 31) errors.push('训练计划须按一个月设置，起止日期应覆盖28至31天');
  }
  if (!title || title.length > 60) errors.push('计划名称应为1至60个字符');
  if (!scheduleLabel || scheduleLabel.length > 40) errors.push('训练日安排应为1至40个字符');

  const rawExercises = Array.isArray(source.exercises) ? source.exercises : [];
  if (!rawExercises.length) errors.push('至少添加一个训练项目');
  if (rawExercises.length > 8) errors.push('训练项目最多8项');
  let totalLines = 0;
  const exercises: TrainingPlanExercise[] = rawExercises.slice(0, 8).map((rawExercise, exerciseIndex) => {
    const exercise = rawExercise && typeof rawExercise === 'object' && !Array.isArray(rawExercise)
      ? rawExercise as Record<string, unknown>
      : {};
    const name = cleanString(exercise.name);
    const unitNote = cleanString(exercise.unitNote);
    if (name.length > 60) errors.push(`第${exerciseIndex + 1}项训练名称不能超过60个字符`);
    if (unitNote.length > 20) errors.push(`第${exerciseIndex + 1}项备注不能超过20个字符`);
    const rawLines = Array.isArray(exercise.lines) ? exercise.lines : [];
    if (!rawLines.length) errors.push(`第${exerciseIndex + 1}项至少需要一行处方`);
    if (rawLines.length > 8) errors.push(`第${exerciseIndex + 1}项处方最多8行`);
    totalLines += rawLines.length;
    const lines: TrainingPlanLine[] = rawLines.slice(0, 8).map((rawLine, lineIndex) => {
      const line = rawLine && typeof rawLine === 'object' && !Array.isArray(rawLine)
        ? rawLine as Record<string, unknown>
        : {};
      const rawWeeks = line.weeks && typeof line.weeks === 'object' && !Array.isArray(line.weeks)
        ? line.weeks as Record<string, unknown>
        : {};
      const weeks = {} as TrainingPlanLine['weeks'];
      for (const weekKey of ['1', '2', '3', '4'] as const) {
        const rawWeek = rawWeeks[weekKey] && typeof rawWeeks[weekKey] === 'object' && !Array.isArray(rawWeeks[weekKey])
          ? rawWeeks[weekKey] as Record<string, unknown>
          : {};
        const sets = cleanString(rawWeek.sets);
        const reps = cleanString(rawWeek.reps);
        const actualCompleted = cleanString(rawWeek.actualCompleted);
        if (sets.length > 12 || reps.length > 20 || actualCompleted.length > 30) {
          errors.push(`第${exerciseIndex + 1}项第${lineIndex + 1}行第${weekKey}周输入过长`);
        }
        weeks[weekKey] = {
          sets,
          reps,
          percentage: optionalNumber(rawWeek.percentage, 0, 100, '训练百分比', errors),
          actualCompleted
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
      lines
    };
  });
  if (!exercises.some((exercise) => exercise.name)) errors.push('至少填写一个训练项目名称');
  if (totalLines > 30) errors.push('导出模板最多容纳30行训练处方');

  const data: TrainingPlanData = {
    startDate,
    endDate,
    title,
    scheduleLabel,
    bodyWeight: optionalNumber(source.bodyWeight, 0, 400, '体重', errors),
    age: optionalNumber(source.age, 8, 80, '年龄', errors),
    exercises
  };
  return { data, errors: [...new Set(errors)] };
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

function findBatchPlanSheet(workbook: ExcelJS.Workbook) {
  for (const sheet of workbook.worksheets) {
    for (let rowNumber = 1; rowNumber <= Math.min(sheet.rowCount, 15); rowNumber += 1) {
      const headings: string[] = [];
      sheet.getRow(rowNumber).eachCell({ includeEmpty: true }, (cell) => {
        headings.push(excelCellText(cell).replace(/\s+/g, ''));
      });
      if (headings.includes('项目') && headings.includes('第1周组数') && headings.includes('第1周强度%')) {
        return { sheet, headerRowNumber: rowNumber };
      }
    }
  }
  return null;
}

async function parseBatchTrainingPlanWorkbook(buffer: Buffer) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
  const found = findBatchPlanSheet(workbook);
  if (!found) throw new Error('未找到批量计划表头，请下载并使用最新模板');
  const { sheet, headerRowNumber } = found;
  const metadata: Record<string, string> = {};
  for (let rowNumber = 1; rowNumber < headerRowNumber; rowNumber += 1) {
    const label = excelCellText(sheet.getCell(rowNumber, 1)).replace(/[：:]/g, '').trim();
    const value = excelCellText(sheet.getCell(rowNumber, 2));
    if (label) metadata[label] = value;
  }
  const headers: Record<string, number> = {};
  sheet.getRow(headerRowNumber).eachCell({ includeEmpty: true }, (cell, columnNumber) => {
    const heading = excelCellText(cell).replace(/\s+/g, '');
    if (heading) headers[heading] = columnNumber;
  });
  const required = ['项目', '第1周组数', '第1周次数', '第1周强度%', '第2周组数', '第2周次数', '第2周强度%', '第3周组数', '第3周次数', '第3周强度%', '第4周组数', '第4周次数', '第4周强度%'];
  const missing = required.filter((heading) => !headers[heading]);
  if (missing.length) throw new Error(`模板缺少字段：${missing.join('、')}`);

  const exerciseMap = new Map<string, TrainingPlanExercise>();
  sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber <= headerRowNumber) return;
    const name = excelCellText(row.getCell(headers['项目']));
    if (!name) return;
    let exercise = exerciseMap.get(name);
    if (!exercise) {
      exercise = { id: randomUUID(), name, maxWeight: null, unitNote: '', lines: [] };
      exerciseMap.set(name, exercise);
    }
    const weeks = {} as TrainingPlanLine['weeks'];
    for (const weekKey of ['1', '2', '3', '4'] as const) {
      const percentageText = excelCellText(row.getCell(headers[`第${weekKey}周强度%`]));
      const percentage = percentageText === '' ? null : Number(percentageText.replace('%', ''));
      weeks[weekKey] = {
        sets: excelCellText(row.getCell(headers[`第${weekKey}周组数`])),
        reps: excelCellText(row.getCell(headers[`第${weekKey}周次数`])),
        percentage: Number.isFinite(percentage) ? percentage : null,
        actualCompleted: ''
      };
    }
    exercise.lines.push({ id: randomUUID(), weeks });
  });

  const parsed = parseTrainingPlanData({
    title: metadata['计划名称'],
    startDate: metadata['开始日期'],
    endDate: metadata['结束日期'],
    scheduleLabel: metadata['训练日安排'],
    bodyWeight: null,
    age: null,
    exercises: [...exerciseMap.values()]
  });
  if (parsed.errors.length) throw new Error(parsed.errors.join('；'));
  return parsed.data;
}

function latestPlanData(athleteId: number) {
  const row = db.prepare(`
    SELECT plan_data AS dataJson FROM training_plans
    WHERE athlete_id = ? ORDER BY start_date DESC, id DESC LIMIT 1
  `).get(athleteId) as { dataJson: string } | undefined;
  if (!row) return null;
  try {
    return parseTrainingPlanData(JSON.parse(row.dataJson)).data;
  } catch {
    return null;
  }
}

function personalizeBatchPlan(template: TrainingPlanData, athleteId: number) {
  const previous = latestPlanData(athleteId);
  const previousMax = new Map((previous?.exercises || []).map((exercise) => [exercise.name.trim(), exercise.maxWeight]));
  return {
    ...template,
    bodyWeight: previous?.bodyWeight ?? null,
    age: previous?.age ?? null,
    exercises: template.exercises.map((exercise) => ({
      ...exercise,
      id: randomUUID(),
      maxWeight: previousMax.get(exercise.name.trim()) ?? null,
      lines: exercise.lines.map((line) => ({
        ...line,
        id: randomUUID(),
        weeks: Object.fromEntries(Object.entries(line.weeks).map(([weekKey, week]) => [weekKey, { ...week, actualCompleted: '' }])) as TrainingPlanLine['weeks']
      }))
    }))
  } satisfies TrainingPlanData;
}

async function buildBatchTrainingPlanTemplate() {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = '竞迹训练监控平台';
  const sheet = workbook.addWorksheet('多人四周训练计划', { views: [{ state: 'frozen', ySplit: 8 }] });
  sheet.mergeCells('A1:N1');
  sheet.getCell('A1').value = '多人四周力量训练计划导入模板';
  sheet.getCell('A1').font = { name: 'Microsoft YaHei', size: 18, bold: true, color: { argb: 'FFFFFFFF' } };
  sheet.getCell('A1').alignment = { horizontal: 'center', vertical: 'middle' };
  sheet.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF073B49' } };
  sheet.getRow(1).height = 34;
  const nextMonth = new Date();
  nextMonth.setDate(1);
  nextMonth.setMonth(nextMonth.getMonth() + 1);
  const startDate = nextMonth.toISOString().slice(0, 10);
  const end = new Date(`${startDate}T12:00:00Z`);
  end.setUTCDate(end.getUTCDate() + 29);
  const metadata = [
    ['计划名称', '四周力量训练计划'],
    ['开始日期', startDate],
    ['结束日期', end.toISOString().slice(0, 10)],
    ['训练日安排', '周二 / 周五'],
    ['填写说明', '每行是一条处方；同一项目可填写多行。MAX按运动员已有数据自动沿用，导入后可逐人调整。']
  ];
  metadata.forEach(([label, value], index) => {
    const row = index + 2;
    sheet.getCell(row, 1).value = label;
    sheet.getCell(row, 1).font = { bold: true, color: { argb: 'FF0B5963' } };
    sheet.mergeCells(row, 2, row, 14);
    sheet.getCell(row, 2).value = value;
  });
  const headers = ['项目', '处方行', ...(['1', '2', '3', '4'].flatMap((week) => [`第${week}周组数`, `第${week}周次数`, `第${week}周强度%`]))];
  sheet.getRow(8).values = headers;
  sheet.getRow(8).height = 36;
  sheet.getRow(8).eachCell((cell, columnNumber) => {
    const gold = columnNumber <= 2;
    cell.font = { name: 'Microsoft YaHei', bold: true, color: { argb: gold ? 'FF14343E' : 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: gold ? 'FFFFC20A' : 'FF167F83' } };
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    cell.border = { top: { style: 'thin', color: { argb: 'FFB8CBCE' } }, bottom: { style: 'thin', color: { argb: 'FFB8CBCE' } }, left: { style: 'thin', color: { argb: 'FFB8CBCE' } }, right: { style: 'thin', color: { argb: 'FFB8CBCE' } } };
  });
  const examples = [
    ['卧拉', 1, 1, 10, 70, 1, 10, 70, 1, 10, 72, 1, 10, 72],
    ['卧拉', 2, 2, 8, 75, 2, 8, 75, 2, 8, 78, 2, 8, 78],
    ['卧推', 1, 1, 10, 70, 1, 10, 70, 1, 10, 72, 1, 10, 72],
    ['深蹲', 1, 4, 8, 70, 4, 8, 72, 4, 8, 75, 4, 8, 75]
  ];
  examples.forEach((values, index) => { sheet.getRow(9 + index).values = values; });
  for (let rowNumber = 9; rowNumber <= 38; rowNumber += 1) {
    const row = sheet.getRow(rowNumber);
    row.height = 25;
    row.eachCell({ includeEmpty: true }, (cell, columnNumber) => {
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: columnNumber <= 2 ? 'FFFFF7DA' : rowNumber % 2 ? 'FFF3F8F8' : 'FFFFFFFF' } };
      cell.border = { bottom: { style: 'hair', color: { argb: 'FFB8CBCE' } }, right: { style: 'hair', color: { argb: 'FFD5E0E2' } } };
    });
    for (const columnNumber of [5, 8, 11, 14]) {
      row.getCell(columnNumber).dataValidation = { type: 'decimal', operator: 'between', formulae: [0, 100], allowBlank: true, showErrorMessage: true, errorTitle: '强度格式错误', error: '请输入0至100之间的数字。' };
    }
  }
  headers.forEach((_header, index) => { sheet.getColumn(index + 1).width = index === 0 ? 19 : index === 1 ? 10 : 14; });
  sheet.autoFilter = { from: 'A8', to: 'N38' };
  return workbook;
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
  const sheet = workbook.addWorksheet('个人体能计划', {
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
      : '本次尚未形成完整的目标对比。以下为演示性训练框架，请先由教练补充目标值，再确认具体负荷。',
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
    return { content: buildRuleAdvice(test), source: 'rules' as const, model: '内置演示规则' };
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
      signal: AbortSignal.timeout(90000)
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

function buildTrainingBreakdown(row: Record<string, unknown>): TrainingBreakdown {
  const waterDistanceByZone = emptyZoneDistances();
  const waterTimeByZone = emptyZoneDistances();
  const ergDistanceByZone = emptyZoneDistances();
  for (const zone of intensityZones) {
    waterDistanceByZone[zone] = numberOrZero(pick(row, [`水上${zone}(km)`, `水上${zone}（km）`]));
    waterTimeByZone[zone] = numberOrZero(pick(row, [`水上${zone}时间(min)`, `水上${zone}时间（min）`, `水上${zone}时长(min)`, `水上${zone}时长（min）`]));
    ergDistanceByZone[zone] = numberOrZero(pick(row, [`测功仪${zone}(km)`, `测功仪${zone}（km）`]));
  }
  const explicitWaterMinutes = numberOrZero(pick(row, ['水上训练时长(min)', '水上训练时长（min）', '水上训练时长']));
  const zonedWaterMinutes = Object.values(waterTimeByZone).reduce((sum, value) => sum + value, 0);
  return {
    waterMinutes: explicitWaterMinutes || zonedWaterMinutes,
    ergMinutes: numberOrZero(pick(row, ['测功仪训练时长(min)', '测功仪训练时长（min）', '测功仪训练时长'])),
    landMinutes: {
      functional: numberOrZero(pick(row, ['功能力量(min)', '功能力量（min）', '功能力量'])),
      endurance: numberOrZero(pick(row, ['力量耐力(min)', '力量耐力（min）', '力量耐力'])),
      maxStrength: numberOrZero(pick(row, ['最大力量(min)', '最大力量（min）', '最大力量'])),
      speedStrength: numberOrZero(pick(row, ['速度力量(min)', '速度力量（min）', '速度力量'])),
      recovery: numberOrZero(pick(row, ['拉伸再生(min)', '拉伸再生（min）', '恢复再生(min)', '拉伸再生'])),
      running: numberOrZero(pick(row, ['跑步(min)', '跑步（min）', '跑步'])),
      other: numberOrZero(pick(row, ['其他训练(min)', '其他训练（min）', '其他训练']))
    },
    waterDistanceByZone,
    waterTimeByZone,
    ergDistanceByZone
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

function breakdownNumbers(breakdown: TrainingBreakdown) {
  return [
    breakdown.waterMinutes,
    breakdown.ergMinutes,
    ...Object.values(breakdown.landMinutes),
    ...Object.values(breakdown.waterDistanceByZone),
    ...Object.values(breakdown.waterTimeByZone),
    ...Object.values(breakdown.ergDistanceByZone)
  ];
}

function breakdownDuration(breakdown: TrainingBreakdown) {
  return breakdown.waterMinutes + breakdown.ergMinutes
    + Object.values(breakdown.landMinutes).reduce((sum, value) => sum + value, 0);
}

function breakdownDistance(breakdown: TrainingBreakdown) {
  return [...Object.values(breakdown.waterDistanceByZone), ...Object.values(breakdown.ergDistanceByZone)]
    .reduce((sum, value) => sum + value, 0);
}

function dominantIntensity(breakdown: TrainingBreakdown) {
  return intensityZones
    .map((zone) => ({ zone, value: breakdown.waterDistanceByZone[zone] + breakdown.ergDistanceByZone[zone] }))
    .sort((a, b) => b.value - a.value)[0]?.value
      ? intensityZones
        .map((zone) => ({ zone, value: breakdown.waterDistanceByZone[zone] + breakdown.ergDistanceByZone[zone] }))
        .sort((a, b) => b.value - a.value)[0].zone
      : '-';
}

function inferTrainingType(breakdown: TrainingBreakdown) {
  const landTotal = Object.values(breakdown.landMinutes).reduce((sum, value) => sum + value, 0);
  const activeParts = [breakdown.waterMinutes > 0, breakdown.ergMinutes > 0, landTotal > 0].filter(Boolean).length;
  if (activeParts > 1) return '综合训练';
  if (breakdown.waterMinutes > 0) return '水上训练';
  if (breakdown.ergMinutes > 0) return '测功仪训练';
  if (breakdown.landMinutes.recovery > 0 && landTotal === breakdown.landMinutes.recovery) return '恢复训练';
  if (landTotal > 0) return '力量训练';
  return '专项训练';
}

function inferTrainingContent(breakdown: TrainingBreakdown) {
  const parts: string[] = [];
  if (breakdown.waterMinutes > 0) parts.push(`水上训练${breakdown.waterMinutes}min`);
  if (breakdown.ergMinutes > 0) parts.push(`测功仪${breakdown.ergMinutes}min`);
  const labels: Record<keyof TrainingBreakdown['landMinutes'], string> = {
    functional: '功能力量',
    endurance: '力量耐力',
    maxStrength: '最大力量',
    speedStrength: '速度力量',
    recovery: '拉伸再生',
    running: '跑步',
    other: '其他训练'
  };
  for (const [key, label] of Object.entries(labels) as Array<[keyof TrainingBreakdown['landMinutes'], string]>) {
    const value = breakdown.landMinutes[key];
    if (value > 0) parts.push(`${label}${value}min`);
  }
  const zoneParts = intensityZones
    .map((zone) => ({ zone, value: breakdown.waterDistanceByZone[zone] + breakdown.ergDistanceByZone[zone] }))
    .filter((item) => item.value > 0)
    .map((item) => `${item.zone} ${item.value}km`);
  if (zoneParts.length) parts.push(zoneParts.join('、'));
  return parts.join('；');
}

function findImportSheet(workbook: ExcelJS.Workbook) {
  const dateHeaders = new Set(['日期', '训练日期', 'date']);
  const athleteHeaders = new Set(['运动员', '运动员姓名', '姓名', 'athlete']);
  for (const sheet of workbook.worksheets) {
    const maxHeaderRow = Math.min(Math.max(sheet.rowCount, 1), 15);
    for (let rowNumber = 1; rowNumber <= maxHeaderRow; rowNumber += 1) {
      const values = sheet.getRow(rowNumber).values;
      const normalized = (Array.isArray(values) ? values : [])
        .map((value) => cleanString(value).replace(/\s+/g, '').toLowerCase());
      if (normalized.some((value) => dateHeaders.has(value)) && normalized.some((value) => athleteHeaders.has(value))) {
        return { sheet, headerRowNumber: rowNumber };
      }
    }
  }
  return null;
}

function deriveStatus(input: {
  explicit: string;
  trainingType: string;
  rpe: number | null;
  sleepHours: number | null;
  fatigueIndex: number | null;
}) {
  const explicitMap: Record<string, ImportRow['status']> = {
    正常: 'normal', 关注: 'attention', 异常: 'alert', 预警: 'alert', 休息: 'rest', 缺失: 'missing',
    normal: 'normal', attention: 'attention', alert: 'alert', rest: 'rest', missing: 'missing'
  };
  const matched = explicitMap[input.explicit.toLowerCase()] || explicitMap[input.explicit];
  if (matched) return matched;
  if (input.trainingType.includes('休息')) return 'rest';
  if ((input.fatigueIndex ?? 0) >= 7 || (input.sleepHours !== null && input.sleepHours < 5.5) || (input.rpe ?? 0) >= 9) return 'alert';
  if ((input.fatigueIndex ?? 0) >= 5 || (input.sleepHours !== null && input.sleepHours < 7) || (input.rpe ?? 0) >= 8) return 'attention';
  return 'normal';
}

async function parseWorkbook(buffer: Buffer, user: AuthUser): Promise<ImportRow[]> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
  const importSheet = findImportSheet(workbook);
  if (!importSheet) throw new Error('未找到同时包含“日期”和“运动员”的数据表头，请使用最新标准模板');
  const { sheet, headerRowNumber } = importSheet;
  const headerRow = sheet.getRow(headerRowNumber);
  const headers: string[] = [];
  headerRow.eachCell({ includeEmpty: true }, (cell, columnNumber) => {
    headers[columnNumber] = cell.text.trim();
  });
  const rawRows: Array<{ values: Record<string, unknown>; rowNumber: number }> = [];
  sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber <= headerRowNumber) return;
    const item: Record<string, unknown> = {};
    let hasValue = false;
    headers.forEach((header, columnNumber) => {
      if (!header || !columnNumber) return;
      const cell = row.getCell(columnNumber);
      let value: unknown = cell.value;
      if (value && typeof value === 'object' && 'formula' in value) {
        value = 'result' in value ? (value as { result: unknown }).result ?? '' : '';
      }
      if (value !== null && value !== undefined && value !== '') hasValue = true;
      item[header] = value ?? '';
    });
    if (hasValue) rawRows.push({ values: item, rowNumber });
  });
  const athletes = db.prepare(`
    SELECT id, name, region AS province, city, county, project, team
    FROM athletes WHERE active = 1
  `).all() as Array<{
    id: number;
    name: string;
    province: string;
    city: string;
    county: string;
    project: string;
    team: string;
  }>;
  const athleteByName = new Map(athletes.map((athlete) => [athlete.name.replace(/\s+/g, ''), athlete]));
  const allowed = new Set(accessibleAthleteIds(user));

  return rawRows.map(({ values: row, rowNumber }) => {
    const errors: string[] = [];
    const warnings: string[] = [];
    const trainingBreakdown = buildTrainingBreakdown(row);
    const componentDuration = breakdownDuration(trainingBreakdown);
    const componentDistance = breakdownDistance(trainingBreakdown);
    const hasComponentData = breakdownNumbers(trainingBreakdown).some((value) => value !== 0);
    const athleteName = cleanString(pick(row, ['运动员', '运动员姓名', '姓名', 'athlete']));
    const athlete = athleteByName.get(athleteName.replace(/\s+/g, ''));
    const date = parseDate(pick(row, ['日期', '训练日期', 'date']));
    const trainingType = cleanString(pick(row, ['训练类型', '类型'])) || inferTrainingType(trainingBreakdown);
    const structureType = cleanString(pick(row, ['结构分类', '训练结构'])) || trainingType;
    const intensityZone = cleanString(pick(row, ['强度区间', '强度分区', '训练强度'])) || dominantIntensity(trainingBreakdown);
    const content = cleanString(pick(row, ['训练内容', '内容'])) || inferTrainingContent(trainingBreakdown);
    const explicitDuration = numberOrNull(pick(row, ['训练时长(分钟)', '训练时长（分钟）', '训练时间(分钟)', '时长', '分钟']));
    const duration = explicitDuration ?? (hasComponentData ? componentDuration : null);
    const explicitDistance = numberOrNull(pick(row, ['专项距离(km)', '专项距离（km）', '训练距离(km)', '距离(km)', '距离']));
    const distance = explicitDistance ?? componentDistance;
    const rpe = numberOrNull(pick(row, ['RPE', 'rpe']));
    const rawSrpe = numberOrNull(pick(row, ['SRPE', 'srpe']));
    const smvl = numberOrNull(pick(row, ['SMVL', 'smvl']));
    const morningPulse = numberOrNull(pick(row, ['晨脉', '晨间脉搏']));
    const weightKg = numberOrNull(pick(row, ['体重(kg)', '体重（kg）', '体重']));
    const sleepHours = numberOrNull(pick(row, ['睡眠(小时)', '睡眠（小时）', '睡眠时间', '睡眠']));
    const fatigueIndex = numberOrNull(pick(row, ['疲劳指数', '疲劳']));
    const explicitStatus = cleanString(pick(row, ['训练状态', '状态']));
    const coachNote = cleanString(pick(row, ['教练备注', '备注']));

    if (!athleteName) errors.push('缺少运动员姓名');
    else if (!athlete) errors.push('运动员不在系统名单中');
    else if (!allowed.has(athlete.id)) errors.push('当前账户无权导入该运动员数据');
    if (!date) errors.push('日期格式无效，应为YYYY-MM-DD');
    if (duration === null) errors.push('缺少训练时长');
    if (duration !== null && duration < 0) errors.push('训练时长不能为负数');
    if (breakdownNumbers(trainingBreakdown).some((value) => value < 0)) errors.push('分项训练时长和距离不能为负数');
    if (rpe !== null && (rpe < 0 || rpe > 10)) errors.push('RPE应在0—10之间');
    if (fatigueIndex !== null && (fatigueIndex < 0 || fatigueIndex > 10)) errors.push('疲劳指数应在0—10之间');
    if (sleepHours === null) warnings.push('未填写睡眠时间');
    if (morningPulse === null) warnings.push('未填写晨脉');
    if (weightKg === null) warnings.push('未填写体重');
    if (!content && !trainingType.includes('休息')) warnings.push('未填写训练内容');
    if (hasComponentData && explicitDuration === null) warnings.push('已根据分项训练时长自动计算总时长');
    if (componentDistance > 0 && explicitDistance === null) warnings.push('已根据U3—ATP分项距离自动计算专项距离');

    const status = deriveStatus({ explicit: explicitStatus, trainingType, rpe, sleepHours, fatigueIndex });
    return {
      rowNumber,
      athleteId: athlete?.id ?? null,
      athleteName,
      province: athlete?.province || '',
      city: athlete?.city || '',
      county: athlete?.county || '',
      project: athlete?.project || '',
      team: athlete?.team || '',
      date,
      trainingType,
      structureType,
      intensityZone,
      content,
      durationMin: duration ?? 0,
      distanceKm: distance ?? 0,
      rpe,
      srpe: rawSrpe ?? Math.round((duration ?? 0) * (rpe ?? 0)),
      smvl: smvl ?? 0,
      morningPulse,
      weightKg,
      sleepHours,
      fatigueIndex,
      status,
      coachNote,
      trainingBreakdown,
      errors,
      warnings
    };
  });
}

app.post('/api/auth/register', (req, res) => {
  if (consumeRateLimit(req, 'register', 30, 15 * 60 * 1000)) {
    return res.status(429).json({ message: '申请次数过多，请稍后再试。' });
  }
  const username = cleanString(req.body?.username).toLowerCase();
  const password = cleanString(req.body?.password);
  const displayName = cleanString(req.body?.displayName);
  const requestedRoleInput = cleanString(req.body?.role);
  const requestedRole = (requestedRoleInput === 'athlete' ? 'ATL' : requestedRoleInput === 'coach' ? 'SCC' : requestedRoleInput) as 'ATL' | 'SCC';
  const project = cleanString(req.body?.project);
  const team = cleanString(req.body?.team);
  const gender = cleanString(req.body?.gender);
  const region = cleanString(req.body?.region);
  const city = cleanString(req.body?.city);
  const county = cleanString(req.body?.county);
  const errors: string[] = [];

  if (!/^[a-z0-9_]{4,24}$/.test(username)) errors.push('账号须为4—24位字母、数字或下划线');
  if (password.length < 8 || password.length > 72 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) {
    errors.push('密码须为8—72位，并同时包含字母和数字');
  }
  if (displayName.length < 2 || displayName.length > 20) errors.push('姓名须为2—20个字符');
  if (!['ATL', 'SCC'].includes(requestedRole)) errors.push('只能申请运动员或队伍体能教练账户');
  if (!projectSet.has(project)) errors.push('请选择赛艇、皮划艇或激流');
  if (team.length < 2 || team.length > 30) errors.push('请填写2—30个字符的队伍或组别');
  if (!provinceSet.has(region)) errors.push('请选择所属省份');
  if (city.length < 2 || city.length > 30) errors.push('请填写所属城市');
  if (county.length < 2 || county.length > 30) errors.push('请填写所属区县');
  if (gender && !['男', '女'].includes(gender)) errors.push('性别信息无效');
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
        project = ?, team = ?, gender = ?, region = ?, city = ?, county = ?, status = 'pending', reviewed_by = NULL,
        reviewed_at = NULL, created_at = CURRENT_TIMESTAMP WHERE id = ?
    `).run(passwordHash, displayName, requestedRole, project, team, gender || null, region, city, county, existingRequest.id);
  } else {
    db.prepare(`
      INSERT INTO registration_requests (
        username, password_hash, display_name, requested_role, project, team, gender, region, city, county
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(username, passwordHash, displayName, requestedRole, project, team, gender || null, region, city, county);
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
      a.photo_url AS photoUrl,
      GROUP_CONCAT(u.display_name, '、') AS coaches
    FROM athletes a
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
  if (!hasAthleteAccess(user, athleteId)) return res.status(403).json({ message: '无权查看该运动员的训练计划。' });
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
      data: parseTrainingPlanData(JSON.parse(dataJson || '{}')).data
    }))
  });
});

app.get('/api/training-plans/batch/template', requireAuth, requireRole('SCC', 'PRJ', 'REG', 'TD', 'DMD'), async (_req, res) => {
  const workbook = await buildBatchTrainingPlanTemplate();
  const buffer = await workbook.xlsx.writeBuffer();
  const filename = '多人四周训练计划导入模板.xlsx';
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="batch-training-plan-template.xlsx"; filename*=UTF-8''${encodeURIComponent(filename)}`);
  res.send(Buffer.from(buffer));
});

app.post(
  '/api/training-plans/batch/preview',
  requireAuth,
  requireRole('SCC', 'PRJ', 'REG', 'TD', 'DMD'),
  upload.single('file'),
  async (req, res) => {
    if (!req.file) return res.status(400).json({ message: '请选择Excel计划文件。' });
    if (!req.file.originalname.toLowerCase().endsWith('.xlsx')) return res.status(400).json({ message: '计划导入仅支持.xlsx文件。' });
    let athleteIds: number[] = [];
    try {
      const raw = JSON.parse(cleanString(req.body?.athleteIds) || '[]');
      athleteIds = [...new Set((Array.isArray(raw) ? raw : []).map(Number).filter((id) => Number.isInteger(id) && id > 0))];
    } catch {
      return res.status(400).json({ message: '运动员选择数据格式错误。' });
    }
    if (!athleteIds.length) return res.status(400).json({ message: '请至少选择一名运动员。' });
    if (athleteIds.length > 100) return res.status(400).json({ message: '单次最多为100名运动员生成计划。' });
    if (athleteIds.some((athleteId) => !hasAthleteAccess(req.authUser!, athleteId))) {
      return res.status(403).json({ message: '所选人员中包含无权管理的运动员。' });
    }
    try {
      const data = await parseBatchTrainingPlanWorkbook(req.file.buffer);
      const athletes = athleteIds.map((athleteId) => {
        const athlete = db.prepare('SELECT id, name, team FROM athletes WHERE id = ?').get(athleteId) as { id: number; name: string; team: string } | undefined;
        if (!athlete) throw new Error(`运动员ID ${athleteId} 不存在`);
        const hasConflict = Boolean(db.prepare('SELECT id FROM training_plans WHERE athlete_id = ? AND plan_date = ?').get(athleteId, data.startDate));
        const personalized = personalizeBatchPlan(data, athleteId);
        return {
          ...athlete,
          hasConflict,
          reusedMaxCount: personalized.exercises.filter((exercise) => exercise.maxWeight !== null).length
        };
      });
      const importId = randomUUID();
      const conflicts = athletes.filter((athlete) => athlete.hasConflict).map((athlete) => athlete.id);
      trainingPlanBatchCache.set(importId, {
        ownerId: req.authUser!.id,
        athleteIds,
        data,
        conflicts,
        expiresAt: Date.now() + 30 * 60 * 1000
      });
      res.json({
        importId,
        fileName: req.file.originalname,
        data,
        exerciseCount: data.exercises.length,
        lineCount: data.exercises.reduce((sum, exercise) => sum + exercise.lines.length, 0),
        athletes,
        conflictCount: conflicts.length
      });
    } catch (error) {
      res.status(400).json({ message: `无法读取计划Excel：${error instanceof Error ? error.message : '文件格式错误'}` });
    }
  }
);

app.post('/api/training-plans/batch/commit', requireAuth, requireRole('SCC', 'PRJ', 'REG', 'TD', 'DMD'), (req, res) => {
  const importId = cleanString(req.body?.importId);
  const replaceExisting = req.body?.replaceExisting === true;
  const cached = trainingPlanBatchCache.get(importId);
  if (!cached || cached.ownerId !== req.authUser!.id || cached.expiresAt < Date.now()) {
    return res.status(400).json({ message: '批量计划预览已失效，请重新上传Excel。' });
  }
  if (cached.athleteIds.some((athleteId) => !hasAthleteAccess(req.authUser!, athleteId))) {
    return res.status(403).json({ message: '运动员权限已变化，请重新选择人员。' });
  }
  const insert = db.prepare(`
    INSERT INTO training_plans
      (athlete_id, plan_date, start_date, end_date, title, schedule_label, plan_data, created_by, updated_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const update = db.prepare(`
    UPDATE training_plans SET title = ?, schedule_label = ?, end_date = ?, plan_data = ?, updated_by = ?, updated_at = CURRENT_TIMESTAMP
    WHERE athlete_id = ? AND plan_date = ?
  `);
  let created = 0;
  let replaced = 0;
  let skipped = 0;
  db.exec('BEGIN');
  try {
    for (const athleteId of cached.athleteIds) {
      const existing = db.prepare('SELECT id FROM training_plans WHERE athlete_id = ? AND plan_date = ?').get(athleteId, cached.data.startDate) as { id: number } | undefined;
      if (existing && !replaceExisting) {
        skipped += 1;
        continue;
      }
      const personalized = personalizeBatchPlan(cached.data, athleteId);
      if (existing) {
        update.run(personalized.title, personalized.scheduleLabel, personalized.endDate, JSON.stringify(personalized), req.authUser!.id, athleteId, personalized.startDate);
        replaced += 1;
      } else {
        insert.run(athleteId, personalized.startDate, personalized.startDate, personalized.endDate, personalized.title, personalized.scheduleLabel, JSON.stringify(personalized), req.authUser!.id, req.authUser!.id);
        created += 1;
      }
    }
    db.prepare('INSERT INTO audit_logs (user_id, action, entity_type, detail) VALUES (?, ?, ?, ?)')
      .run(req.authUser!.id, 'BATCH_IMPORT_TRAINING_PLAN', 'training_plan', JSON.stringify({ importId, athleteIds: cached.athleteIds, created, replaced, skipped, startDate: cached.data.startDate }));
    db.exec('COMMIT');
    trainingPlanBatchCache.delete(importId);
    res.json({
      message: `已生成${created + replaced}份个人计划${skipped ? `，跳过${skipped}份已有计划` : ''}。现在可逐人调整MAX、组数、次数和强度。`,
      created,
      replaced,
      skipped,
      firstAthleteId: cached.athleteIds[0] || null
    });
  } catch (error) {
    db.exec('ROLLBACK');
    res.status(500).json({ message: `批量生成失败：${error instanceof Error ? error.message : '未知错误'}` });
  }
});

app.post('/api/training-plans', requireAuth, requireRole('SCC', 'PRJ', 'REG', 'TD', 'DMD'), (req, res) => {
  const user = req.authUser!;
  const athleteId = Number(req.body?.athleteId || 0);
  const requestedPlanId = Number(req.body?.planId || 0);
  if (!athleteId || !hasAthleteAccess(user, athleteId)) {
    return res.status(403).json({ message: '无权维护该运动员的训练计划。' });
  }
  const parsed = parseTrainingPlanData(req.body?.data);
  if (parsed.errors.length) return res.status(400).json({ message: parsed.errors.join('；') });
  const existing = requestedPlanId
    ? db.prepare('SELECT id FROM training_plans WHERE id = ? AND athlete_id = ?').get(requestedPlanId, athleteId) as { id: number } | undefined
    : db.prepare('SELECT id FROM training_plans WHERE athlete_id = ? AND plan_date = ?').get(athleteId, parsed.data.startDate) as { id: number } | undefined;
  if (requestedPlanId && !existing) return res.status(404).json({ message: '要更新的历史计划不存在。' });
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
      return res.status(409).json({ message: '该运动员已有相同开始日期的训练计划。' });
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
  res.json({ message: existing ? '训练计划已更新。' : '训练计划已保存。', id: saved.id });
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
  if (!row) return res.status(404).json({ message: '历史计划不存在或已经删除。' });
  if (!hasAthleteAccess(req.authUser!, row.athleteId)) {
    return res.status(403).json({ message: '无权删除该运动员的训练计划。' });
  }
  db.exec('BEGIN');
  try {
    db.prepare('DELETE FROM training_plans WHERE id = ?').run(planId);
    db.prepare('INSERT INTO audit_logs (user_id, action, entity_type, entity_id, detail) VALUES (?, ?, ?, ?, ?)')
      .run(req.authUser!.id, 'DELETE_TRAINING_PLAN', 'training_plan', planId, JSON.stringify(row));
    db.exec('COMMIT');
    res.json({ message: '历史计划已删除。' });
  } catch (deleteError) {
    db.exec('ROLLBACK');
    throw deleteError;
  }
});

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
  if (!row) return res.status(404).json({ message: '训练计划不存在。' });
  if (!hasAthleteAccess(req.authUser!, row.athleteId)) return res.status(403).json({ message: '无权导出该训练计划。' });
  const parsed = parseTrainingPlanData(JSON.parse(row.dataJson || '{}'));
  if (parsed.errors.length) return res.status(409).json({ message: `计划数据不完整：${parsed.errors.join('；')}` });
  const workbook = await buildTrainingPlanWorkbook({
    athleteName: row.athleteName,
    project: row.project,
    team: row.team,
    photoUrl: row.photoUrl,
    data: parsed.data
  });
  const buffer = await workbook.xlsx.writeBuffer();
  const safePeriod = `${parsed.data.startDate.replaceAll('-', '')}-${parsed.data.endDate.replaceAll('-', '')}`;
  const filename = `${row.athleteName}_${safePeriod}_四周体能计划.xlsx`;
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
  res.send(Buffer.from(buffer));
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
    SELECT tr.id, tr.athlete_id AS athleteId, a.name AS athleteName,
      tr.project, tr.team, tr.province AS region, tr.province, tr.city, tr.county,
      tr.date, tr.training_type AS trainingType, tr.structure_type AS structureType,
      tr.intensity_zone AS intensityZone, tr.content, tr.duration_min AS durationMin,
      tr.distance_km AS distanceKm, tr.rpe, tr.srpe, tr.smvl,
      tr.morning_pulse AS morningPulse, tr.weight_kg AS weightKg,
      tr.sleep_hours AS sleepHours, tr.fatigue_index AS fatigueIndex,
      tr.status, tr.coach_note AS coachNote, tr.training_breakdown AS trainingBreakdownJson,
      tr.updated_at AS updatedAt,
      u.display_name AS updatedBy
    FROM training_records tr
    JOIN athletes a ON a.id = tr.athlete_id
    JOIN users u ON u.id = tr.updated_by
    WHERE tr.athlete_id IN (${placeholders}) AND tr.date BETWEEN ? AND ?
    ORDER BY tr.date, a.name
  `).all(...ids, from, to) as Array<Record<string, unknown> & { trainingBreakdownJson: string }>;
  res.json({
    records: records.map(({ trainingBreakdownJson, ...record }) => ({
      ...record,
      trainingBreakdown: parseTrainingBreakdownJson(trainingBreakdownJson)
    }))
  });
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
            : '尚未配置AI API，已生成可完整体验的规则演示草案。',
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
      if (headings.includes('测试日期') && headings.includes('测试距离(m)') && hasCrew) return { sheet, headerRowNumber: rowNumber };
    }
  }
  return null;
}

async function parseSpecialTestWorkbook(buffer: Buffer, user: AuthUser, expectedProject: string): Promise<SpecialTestImportRow[]> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
  const found = findSpecialTestSheet(workbook);
  if (!found) throw new Error('未找到专项测试表头，请使用最新模板中的“专项测试成绩”工作表');
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
    const testDate = parseDate(pick(item, ['测试日期', '日期']));
    const project = cleanString(pick(item, ['项目', '运动项目'])) as SpecialTestImportRow['project'];
    const distanceM = Math.round(numberOrZero(pick(item, ['测试距离(m)', '测试距离（m）', '测试距离', '距离(m)'])));
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
    if (!testDate) errors.push('测试日期格式无效，应为YYYY-MM-DD');
    if (!projectSet.has(project)) errors.push('项目必须填写“赛艇”“皮划艇”或“激流”');
    else if (project !== expectedProject) errors.push(`当前为${expectedProject}空间，不能导入${project}数据`);
    if (distanceM <= 0 || distanceM > 100000) errors.push('测试距离应为1—100000米');
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
      session: cleanString(pick(item, ['上午/下午', '时段', '测试时段'])),
      windConditions: cleanString(pick(item, ['风向风速', '风况', '风向'])),
      location: cleanString(pick(item, ['测试地点', '地点'])),
      note: cleanString(pick(item, ['备注', '测试备注'])),
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
    if (!rows.length) return res.status(400).json({ message: 'Excel中没有可读取的专项测试成绩。' });
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
    res.status(400).json({ message: `无法读取专项测试Excel：${error instanceof Error ? error.message : '文件格式错误'}` });
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
    res.status(500).json({ message: `写入专项测试数据失败：${error instanceof Error ? error.message : '未知错误'}` });
  }
});

async function currentTrainingImportTemplate(templatePath: string) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(templatePath);
  const daily = workbook.getWorksheet('每日训练数据');
  const special = workbook.getWorksheet('专项测试成绩');
  const instructions = workbook.getWorksheet('填写说明');
  if (!daily || !special || !instructions) throw new Error('训练数据模板工作表不完整。');
  for (let row = 7; row <= 56; row += 1) {
    daily.getCell(row, 6).dataValidation = { type: 'list', formulae: ['"赛艇,皮划艇,激流"'], allowBlank: true };
    special.getCell(row, 2).dataValidation = { type: 'list', formulae: ['"赛艇,皮划艇,激流"'], allowBlank: true };
  }
  special.getCell('A2').value = '项目必填。赛艇、皮划艇与激流分别形成独立排名；每个运动员或组合占一行，多人艇姓名用“、”分隔。';
  instructions.getCell('F4').value = '项目必须填写；赛艇、皮划艇与激流数据分别进入各自空间';
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

app.get('/api/special-tests/import/template', requireAuth, requireRole('SCC', 'PRJ', 'REG', 'TD', 'DMD'), async (_req, res, next) => {
  const templateName = '竞迹训练数据导入模板.xlsx';
  const templatePath = resolve(process.cwd(), 'public', 'templates', templateName);
  if (!existsSync(templatePath)) return res.status(500).json({ message: '标准模板尚未部署，请联系管理员。' });
  try {
    const template = await currentTrainingImportTemplate(templatePath);
    res.setHeader('Content-Disposition', `attachment; filename="special-test-import-template.xlsx"; filename*=UTF-8''${encodeURIComponent(templateName)}`);
    res.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').send(template);
  } catch (error) {
    next(error);
  }
});

app.post('/api/import/preview', requireAuth, requireRole('SCC', 'PRJ', 'REG', 'TD', 'DMD'), upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ message: '请选择Excel文件。' });
  if (!req.file.originalname.toLowerCase().endsWith('.xlsx')) return res.status(400).json({ message: '当前版本仅支持.xlsx文件。' });
  const project = cleanString(req.body?.project);
  if (!projectSet.has(project)) return res.status(400).json({ message: '请选择赛艇、皮划艇或激流项目。' });
  try {
    const rows = await parseWorkbook(req.file.buffer, req.authUser!);
    for (const row of rows) {
      if (row.project && row.project !== project) row.errors.push(`当前为${project}空间，不能导入${row.project}数据`);
    }
    if (!rows.length) return res.status(400).json({ message: 'Excel中没有可读取的训练数据。' });
    const importId = randomUUID();
    importCache.set(importId, { ownerId: req.authUser!.id, rows, expiresAt: Date.now() + 30 * 60 * 1000 });
    res.json({
      importId,
      fileName: req.file.originalname,
      total: rows.length,
      valid: rows.filter((row) => row.errors.length === 0).length,
      invalid: rows.filter((row) => row.errors.length > 0).length,
      warningCount: rows.reduce((sum, row) => sum + row.warnings.length, 0),
      rows
    });
  } catch (error) {
    res.status(400).json({ message: `无法读取Excel：${error instanceof Error ? error.message : '文件格式错误'}` });
  }
});

app.post('/api/import/commit', requireAuth, requireRole('SCC', 'PRJ', 'REG', 'TD', 'DMD'), (req, res) => {
  const importId = cleanString(req.body?.importId);
  const cached = importCache.get(importId);
  if (!cached || cached.expiresAt < Date.now() || cached.ownerId !== req.authUser!.id) {
    return res.status(400).json({ message: '导入预览已失效，请重新上传Excel。' });
  }
  const validRows = cached.rows.filter((row) => row.errors.length === 0 && row.athleteId);
  const upsert = db.prepare(`
    INSERT INTO training_records (
      athlete_id, date, training_type, structure_type, intensity_zone, content,
      duration_min, distance_km, rpe, srpe, smvl, morning_pulse, weight_kg,
      sleep_hours, fatigue_index, status, coach_note, training_breakdown,
      province, city, county, project, team, created_by, updated_by
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(athlete_id, date) DO UPDATE SET
      training_type = excluded.training_type,
      structure_type = excluded.structure_type,
      intensity_zone = excluded.intensity_zone,
      content = excluded.content,
      duration_min = excluded.duration_min,
      distance_km = excluded.distance_km,
      rpe = excluded.rpe,
      srpe = excluded.srpe,
      smvl = excluded.smvl,
      morning_pulse = excluded.morning_pulse,
      weight_kg = excluded.weight_kg,
      sleep_hours = excluded.sleep_hours,
      fatigue_index = excluded.fatigue_index,
      status = excluded.status,
      coach_note = excluded.coach_note,
      training_breakdown = excluded.training_breakdown,
      province = excluded.province,
      city = excluded.city,
      county = excluded.county,
      project = excluded.project,
      team = excluded.team,
      updated_by = excluded.updated_by,
      updated_at = CURRENT_TIMESTAMP
  `);

  db.exec('BEGIN');
  try {
    for (const row of validRows) {
      upsert.run(
        row.athleteId, row.date, row.trainingType, row.structureType, row.intensityZone,
        row.content, row.durationMin, row.distanceKm, row.rpe, row.srpe, row.smvl,
        row.morningPulse, row.weightKg, row.sleepHours, row.fatigueIndex, row.status,
        row.coachNote, JSON.stringify(row.trainingBreakdown), row.province, row.city, row.county, row.project, row.team,
        req.authUser!.id, req.authUser!.id
      );
    }
    db.prepare('INSERT INTO audit_logs (user_id, action, entity_type, detail) VALUES (?, ?, ?, ?)')
      .run(req.authUser!.id, 'IMPORT_EXCEL', 'training_record', JSON.stringify({ count: validRows.length }));
    db.exec('COMMIT');
    importCache.delete(importId);
    res.json({ imported: validRows.length, skipped: cached.rows.length - validRows.length });
  } catch (error) {
    db.exec('ROLLBACK');
    res.status(500).json({ message: `写入数据失败：${error instanceof Error ? error.message : '未知错误'}` });
  }
});

app.get('/api/import/template', requireAuth, requireRole('SCC', 'PRJ', 'REG', 'TD', 'DMD'), async (_req, res, next) => {
  const templateName = '竞迹训练数据导入模板.xlsx';
  const templatePath = resolve(process.cwd(), 'public', 'templates', templateName);
  if (!existsSync(templatePath)) return res.status(500).json({ message: '标准模板尚未部署，请联系管理员。' });
  try {
    const template = await currentTrainingImportTemplate(templatePath);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="training-import-template.xlsx"; filename*=UTF-8''${encodeURIComponent(templateName)}`
    );
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
      project, team, gender, region, city, county, status,
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
    region: string;
    city: string;
    county: string;
    status: string;
    createdAt: string;
    reviewedAt: string | null;
  }>;
  const reviewer = req.authUser!;
  const permissions = accountPermissions(reviewer.id);
  const requests = allRequests.filter((request) =>
    canManageRole(reviewer.role, request.requestedRole)
      && permissionsAllowAthlete(permissions, {
        id: 0,
        region: request.region,
        city: request.city,
        county: request.county,
        project: request.project,
        team: request.team
      })
  );
  const pending = status === 'pending' ? requests.length : (db.prepare(`
    SELECT requested_role AS requestedRole, project, team, region, city, county
    FROM registration_requests WHERE status = 'pending'
  `).all() as Array<{ requestedRole: 'ATL' | 'SCC'; project: string; team: string; region: string; city: string; county: string }>)
    .filter((request) => canManageRole(reviewer.role, request.requestedRole) && permissionsAllowAthlete(permissions, {
      id: 0, region: request.region, city: request.city, county: request.county, project: request.project, team: request.team
    })).length;
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
    SELECT requested_role AS requestedRole, project, team, region, city, county
    FROM registration_requests WHERE id = ?
  `).get(requestId) as { requestedRole: Role; project: string; team: string; region: string; city: string; county: string };
  if (
    !canManageRole(req.authUser!.role, registrationScope.requestedRole)
    || !permissionsAllowAthlete(accountPermissions(req.authUser!.id), {
      id: 0,
      region: registrationScope.region,
      city: registrationScope.city,
      county: registrationScope.county,
      project: registrationScope.project,
      team: registrationScope.team
    })
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
      project, team, gender, region, city, county, status
    FROM registration_requests WHERE id = ?
  `).get(requestId) as {
    id: number; username: string; password_hash: string; display_name: string;
    requested_role: 'ATL' | 'SCC'; project: string; team: string;
    gender: string | null; region: string; city: string; county: string; status: string;
  } | undefined;
  if (!request) return res.status(404).json({ message: '注册申请不存在。' });
  if (request.status !== 'pending') return res.status(409).json({ message: '该申请已经处理。' });
  if (db.prepare('SELECT id FROM users WHERE username = ?').get(request.username)) {
    return res.status(409).json({ message: '账号已存在，无法重复审核。' });
  }
  const reviewer = req.authUser!;
  if (
    !canManageRole(reviewer.role, request.requested_role)
    || !permissionsAllowAthlete(accountPermissions(reviewer.id), {
      id: 0,
      region: request.region,
      city: request.city,
      county: request.county,
      project: request.project,
      team: request.team
    })
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
        if (request.region && provinceSet.has(request.region)) {
          db.prepare(`
            UPDATE athletes SET
              region = CASE WHEN region = '未设置' OR region = '' THEN ? ELSE region END,
              city = CASE WHEN city = '未设置' OR city = '' THEN ? ELSE city END,
              county = CASE WHEN county = '未设置' OR county = '' THEN ? ELSE county END
            WHERE id = ?
          `).run(request.region, request.city, request.county, athlete.id);
        }
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
            request.region,
            request.city,
            request.county
          );
        athleteId = Number(result.lastInsertRowid);
      }
    }

    const result = db.prepare(`
      INSERT INTO users (username, password_hash, display_name, role, athlete_id)
      VALUES (?, ?, ?, ?, ?)
    `).run(request.username, request.password_hash, request.display_name, request.requested_role, athleteId);
    const newUserId = Number(result.lastInsertRowid);
    initializeAccountScope({
      userId: newUserId,
      role: request.requested_role,
      parentUserId: reviewer.id,
      province: request.region,
      city: request.city,
      county: request.county,
      project: request.project,
      team: request.team,
      grantedBy: reviewer.id
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
    SELECT requested_role AS requestedRole, project, team, region, city, county
    FROM registration_requests WHERE id = ?
  `).get(requestId) as {
    requestedRole: Role; project: string; team: string; region: string; city: string; county: string;
  } | undefined;
  if (!registration) return res.status(404).json({ message: '注册申请不存在。' });
  if (
    !canManageRole(req.authUser!.role, registration.requestedRole)
    || !permissionsAllowAthlete(accountPermissions(req.authUser!.id), {
      id: 0,
      region: registration.region,
      city: registration.city,
      county: registration.county,
      project: registration.project,
      team: registration.team
    })
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
    SELECT id, username, display_name AS displayName, role, athlete_id AS athleteId
    FROM users WHERE role = 'SCC' AND active = 1 ORDER BY id
  `).all() as Array<AuthUser & { displayName: string }>;
  const coaches = allCoaches
    .filter((coach) => coach.id === req.authUser!.id || canManageAccount(req.authUser!, coach))
    .map(({ id, displayName }) => ({ id, displayName }));
  res.json({ athletes, coaches });
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
    }
    const userResult = db.prepare(`
      INSERT INTO users (username, password_hash, display_name, role, athlete_id, active)
      VALUES (?, ?, ?, ?, ?, 1)
    `).run(username, bcrypt.hashSync(password, 11), displayNameResult.name, role, athleteId);
    const userId = Number(userResult.lastInsertRowid);
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

app.listen(port, () => {
  console.log(`Training Monitor API running at http://localhost:${port}`);
});
