import { activityMetricFields } from './sport-rules.js';
import { normalizeProject, projectCapability } from './projects.js';
import { trainingLoadCategory } from './training-content-category.js';

type SpecialFact = {
  projectCode?: string | null; projectStatus?: string; trainingType?: string; structureType?: string; content?: string;
  trainingCategory?: string | null; activityCode?: string | null; durationMin: number; distanceKm?: number;
  durationReported?: boolean; distanceReported?: boolean; rpe: number | null; srpe: number | null;
  averagePowerW?: number | null; cadenceRpm?: number | null; strokeRateSpm?: number | null;
};
type Field = { key: 'averagePowerW' | 'cadenceRpm' | 'strokeRateSpm'; label: string; unit: string };
const measuredTotal = (values: Array<number | null>) => {
  const valid = values.filter((value): value is number => value !== null && Number.isFinite(value));
  return valid.length ? valid.reduce((sum, value) => sum + value, 0) : null;
};
export function projectSpecialTraining<T extends SpecialFact>(input: string, facts: T[]) {
  const project = normalizeProject(input);
  const rows = project ? facts.filter(row => row.projectStatus === 'confirmed' && row.projectCode === project && trainingLoadCategory(row) === 'special') : [];
  const fields: Field[] = project === 'CYCLING_ROAD' || project === 'CYCLING_TRACK'
    ? [{ key: 'averagePowerW', label: '平均功率', unit: 'W' }, { key: 'cadenceRpm', label: '踏频', unit: 'rpm' }]
    : project && projectCapability(project)
      ? [{ key: 'averagePowerW', label: '平均功率', unit: 'W' }, { key: 'strokeRateSpm', label: project === 'ROWING' ? '桨频' : '划频', unit: '次/分' }]
      : [];
  const groups=[...new Set(rows.map(row=>row.activityCode||'unknown'))].map(activity=>({activity,fields:activityMetricFields(project,activity),rows:rows.filter(row=>(row.activityCode||'unknown')===activity)}));
  return { rows, fields, groups, summary: {
    sessions: rows.length,
    duration: measuredTotal(rows.map(row => row.durationReported === false ? null : row.durationMin)),
    distance: measuredTotal(rows.map(row => row.distanceReported ? row.distanceKm ?? null : null)),
    srpe: measuredTotal(rows.map(row => row.rpe === null || row.durationReported === false ? null : row.srpe)),
    loadSampleCount: rows.filter(row => row.rpe !== null && row.durationReported !== false && row.srpe != null).length,
  } };
}
