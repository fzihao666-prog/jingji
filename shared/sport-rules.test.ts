import { describe, expect, it } from 'vitest';
import { projectRules, SPORT_MODULES } from './sport-rules.js';

describe('多项目规则边界', () => {
  it('未知和模糊项目没有默认规则', () => {
    expect(projectRules('自行车')).toBeNull();
    expect(projectRules('toString')).toBeNull();
  });
  it('项目目录不代表专项和参考已就绪', () => {
    const rules = projectRules('VOLLEYBALL')!;
    expect(rules.project).toBe('VOLLEYBALL');
    expect(rules.capabilities.management.status).toBe('available');
    expect(rules.capabilities.reference.status).toBe('pending_configuration');
    expect(rules.capabilities.reference.reason).toBeTruthy();
  });
  it('骑行和排球使用自己的活动及指标', () => {
    expect(projectRules('CYCLING_ROAD')!.activities).toContain('cycling');
    expect(projectRules('VOLLEYBALL')!.activities).toContain('volleyball_technique');
    expect(projectRules('VOLLEYBALL')!.activities).not.toContain('on_water');
    expect(projectRules('ROWING')!.activities).toContain('cycling');
    expect(projectRules('CYCLING_MOUNTAIN_BIKE')!.capabilities.special.status).toBe('pending_configuration');
  });
  it('同类公共业务只有一个归属，组合模块与专项模块分开', () => {
    expect(SPORT_MODULES.find(row => row.key === 'wellness')?.kind).toBe('common');
    expect(SPORT_MODULES.find(row => row.key === 'profile')?.kind).toBe('composed');
    expect(SPORT_MODULES.find(row => row.key === 'special')?.kind).toBe('specific');
    expect(new Set(SPORT_MODULES.map(row => row.key)).size).toBe(SPORT_MODULES.length);
  });
});
