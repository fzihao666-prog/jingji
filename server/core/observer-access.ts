// 外部阅览账号仅能访问逐项确认的接口，新增业务接口默认不可见。
const observerReads = new Set([
  '/api/me',
  '/api/teams',
  '/api/observer/teams',
  '/api/athletes',
  '/api/preferences/current-project',
  '/api/overview',
  '/api/overview/teams',
  '/api/records',
  '/api/special-tests',
  '/api/strength-tests',
  '/api/strength-training/results',
  '/api/special-training/overview',
  '/api/team-plans',
  '/api/training-plans',
  '/api/training-plans/catalog',
  '/api/projects/rules',
  '/api/analysis/model',
  '/api/analysis/summary',
  '/api/physical-champion',
  '/api/special-champion-models',
  '/api/enode/data',
  '/api/team-training-stats',
  '/api/coach/plan-execution',
]);
const athleteRead =
  /^\/api\/athletes\/[1-9]\d*\/(?:overview|training-sessions|body-composition|photo|wellness-trends|aerobic-endurance|profile-comparison|radar-models|champion-model|reports(?:\/[a-f0-9-]{36})?)$/;

export function observerRequestAllowed(method: string, path: string) {
  if (method === 'POST' && ['/api/auth/logout', '/api/auth/change-password'].includes(path))
    return true;
  if (method === 'PUT' && path === '/api/preferences/current-project') return true;
  return method === 'GET' && (observerReads.has(path) || athleteRead.test(path));
}

// 已有聚合接口和历史快照也必须经过同一字段边界，避免嵌套数据泄露。
const privateFields = new Set([
  'identityNumber',
  'identity_number',
  'emergency_contact',
  'emergency_phone',
  'family',
  'familyMembers',
  'medicalRecords',
  'identityNo',
  'idCard',
  'address',
  'province',
  'city',
  'county',
  'region',
  'ethnicity',
  'native_place',
  'phone',
  'emergencyContact',
  'emergencyPhone',
  'homeAddress',
  'home_address',
  'nativePlace',
  'originPlace',
  'originUnit',
  'originCoach',
  'bloodType',
  'healthStatus',
  'health_status',
  'injuries',
  'injuryRecords',
  'injuryStatus',
  'injuryDistribution',
  'injurySummary',
  'medical',
  'diagnosis',
  'treatment',
  'painScore',
  'provinceDistribution',
  'originDistribution',
  'notes',
  'note',
  'bodyMeasurementNote',
  'coachNote',
  'aiMetadata',
  'internalNotes',
  'passwordHash',
  'password_hash',
  'sourceFilename',
  'modelUsed',
  'importedAt',
  'importBatchId',
  'confidence',
  'filename',
  'sourceRow',
]);

const observerAthleteFields = new Set([
  'id',
  'name',
  'project',
  'teamId',
  'team',
  'gender',
  'technicalLevel',
  'athletePosition',
  'bestResult',
  'athleteStatus',
  'currentEvent',
  'trainingPhase',
  'specialties',
  'coaches',
  'headCoaches',
  'coachUsers',
  'photoUrl',
  'birthDate',
  'startSportDate',
  'trainingVenue',
  'campPeriod',
  'heightCm',
  'weightKg',
  'bodyFatPct',
  'skeletalMuscleKg',
  'muscleMassKg',
  'upperLimbMuscleKg',
  'lowerLimbMuscleKg',
  'trunkMuscleKg',
  'subcutaneousFatMm',
  'tricepsSkinfoldMm',
  'abdominalSkinfoldMm',
  'thighSkinfoldMm',
  'calfSkinfoldMm',
  'visceralFatLevel',
  'basalMetabolismKcal',
  'totalBodyWaterKg',
  'ecwTbwRatio',
  'phaseAngleDeg',
  'visceralFatAreaCm2',
  'leftArmLeanKg',
  'rightArmLeanKg',
  'trunkLeanKg',
  'leftLegLeanKg',
  'rightLegLeanKg',
  'bodyMeasurementDate',
]);

export function observerResponse(value: unknown, roster = false): unknown {
  if (Array.isArray(value)) return value.map((item) => observerResponse(item));
  if (!value || typeof value !== 'object') return value;
  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (roster && key === 'athletes' && Array.isArray(item)) {
      result[key] = item.map((athlete) => {
        if (!athlete || typeof athlete !== 'object') return athlete;
        return Object.fromEntries(
          Object.entries(athlete).filter(([field]) => observerAthleteFields.has(field))
        );
      });
    } else if (key === 'context' && item && typeof item === 'object' && !Array.isArray(item)) {
      result[key] = Object.fromEntries(
        Object.entries(item).filter(([field]) =>
          ['workoutStart', 'workoutEnd', 'exercises'].includes(field)
        )
      );
    } else if (key === 'commentary') {
      result[key] = { highlights: [], concerns: [], suggestions: [] };
    } else if (!privateFields.has(key)) {
      result[key] = observerResponse(item);
    }
  }
  return result;
}
