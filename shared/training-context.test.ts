import { describe, expect, it } from 'vitest';
import { trainingContext } from './training-context.js';

describe('训练指标活动适用范围', () => {
  it('拒绝把骑行功率写入排球技术或未知排球活动', () => {
    for (const activityCode of ['volleyball_technique', 'unknown']) {
      expect(() => trainingContext('VOLLEYBALL', { trainingType: '专项训练', activityCode, averagePowerW: 800 })).toThrow('功率');
    }
  });
  it('仅接收有适用活动的功率，保留旧水上客户端兼容', () => {
    for (const [project, activityCode] of [['ROWING', 'on_water'], ['ROWING', 'ergometer'], ['ROWING', 'unknown'], ['CYCLING_ROAD', 'cycling']]) {
      expect(trainingContext(project, { trainingType: '专项训练', activityCode, averagePowerW: 0 }).project).toBe(project);
    }
    expect(() => trainingContext('ROWING', { trainingType: '体能训练', activityCode: 'strength', averagePowerW: 100 })).toThrow('功率');
  });
});

it('按项目和活动校验必填量，骑行距离不替代排球或水上时长', async () => {
 const { validateSessionQuantity } = await import('./training-context.js');
 expect(()=>validateSessionQuantity('VOLLEYBALL',{activityCode:'volleyball_technique',duration:null,distance:10})).toThrow('时长');
 expect(()=>validateSessionQuantity('ROWING',{activityCode:'on_water',duration:null,distance:10})).toThrow('时长');
 expect(()=>validateSessionQuantity('CYCLING_ROAD',{activityCode:'cycling',duration:null,distance:10})).not.toThrow();
 expect(()=>validateSessionQuantity('CYCLING_ROAD',{activityCode:'cycling',duration:null,distance:0})).toThrow('时长');
});

it('项目和实际活动共同约束强度体系，不给排球或骑行套水上体系',()=>{
 expect(()=>trainingContext('VOLLEYBALL',{trainingType:'专项训练',activityCode:'volleyball_technique',intensitySystem:'U_SYSTEM',intensityZone:'U2'})).toThrow('适用');
 expect(()=>trainingContext('ROWING',{trainingType:'体能训练',activityCode:'cycling',intensitySystem:'UT_SYSTEM',intensityZone:'UT2'})).toThrow('适用');
 expect(()=>trainingContext('ROWING',{trainingType:'专项训练',activityCode:'on_water',intensitySystem:'UT_SYSTEM',intensityZone:'UT2'})).not.toThrow();
 expect(()=>trainingContext('CYCLING_ROAD',{trainingType:'专项训练',activityCode:'cycling',intensityZone:'Z2'})).not.toThrow();
});
