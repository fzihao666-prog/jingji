import { expect, it } from 'vitest';
import { projectSpecialTraining } from './project-special-training.js';
it('专项只读取已确认项目的实测，不推算缺失RPE或功率曲线', () => {
  const data = projectSpecialTraining('CYCLING_ROAD', [
    { projectCode: 'CYCLING_ROAD', projectStatus: 'confirmed', trainingType: '专项训练', durationMin: 60, durationReported: true, distanceKm: 0, distanceReported: false, rpe: null, srpe: 999, averagePowerW: 250, cadenceRpm: 80 },
    { projectCode: 'ROWING', projectStatus: 'confirmed', trainingType: '专项训练', durationMin: 20, rpe: 5, srpe: 100 },
    { projectCode: null, projectStatus: 'pending_verification', trainingType: '专项训练', durationMin: 10, rpe: 5, srpe: 50 },
  ]);
  expect(data.summary).toEqual({ sessions: 1, duration: 60, distance: null, srpe: null, loadSampleCount: 0 });
  expect(data.fields.map(field => field.key)).toEqual(['averagePowerW', 'cadenceRpm']);
  expect(projectSpecialTraining('VOLLEYBALL', []).fields).toEqual([]);
  expect(projectSpecialTraining('未知项目', []).rows).toEqual([]);
});

it('同项目骑行与水上课次使用各自指标，不按项目把桨频套到骑行',()=>{
 const common={projectCode:'ROWING',projectStatus:'confirmed',trainingType:'专项训练',durationMin:30,rpe:5,srpe:150};
 const data=projectSpecialTraining('ROWING',[{...common,activityCode:'on_water'},{...common,activityCode:'cycling'}]);
 expect(data.groups[0].fields.map(field=>field.key)).toContain('strokeRateSpm');
 expect(data.groups[1].fields.map(field=>field.key)).toContain('cadenceRpm');
 expect(data.groups[1].fields.map(field=>field.key)).not.toContain('strokeRateSpm');
});
