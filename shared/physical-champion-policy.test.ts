import { describe, expect, it } from 'vitest';
import {
  canEditPhysicalChampionValues,
  canManageGlobalPhysicalReferences,
} from './physical-champion-policy.js';

const globalPermissions = {
  projects: ['*'],
  areas: [{ areaLevel: 'national' }],
  teams: [{ project: '*', team: '*' }],
};

describe('冠军参考全局管理权限', () => {
  it('仅允许同时覆盖全国、全部项目和全部队伍的 DMD 修改全局参考', () => {
    expect(canManageGlobalPhysicalReferences('DMD', globalPermissions)).toBe(true);
  });
  it('其他角色即使拥有全局范围也不能修改', () => {
    expect(canManageGlobalPhysicalReferences('COACH', globalPermissions)).toBe(false);
  });
  it('只拥有特定项目的 DMD 不能修改', () => {
    expect(
      canManageGlobalPhysicalReferences('DMD', { ...globalPermissions, projects: ['ROWING'] })
    ).toBe(false);
  });
  it('省级范围的 DMD 不能修改', () => {
    expect(
      canManageGlobalPhysicalReferences('DMD', {
        ...globalPermissions,
        areas: [{ areaLevel: 'province' }],
      })
    ).toBe(false);
  });
  it('全项目中的特定队伍范围不能修改', () => {
    expect(
      canManageGlobalPhysicalReferences('DMD', {
        ...globalPermissions,
        teams: [{ project: '*', team: '测试队' }],
      })
    ).toBe(false);
  });
  it('仅单项目的全部队伍范围不能修改', () => {
    expect(
      canManageGlobalPhysicalReferences('DMD', {
        ...globalPermissions,
        teams: [{ project: 'ROWING', team: '*' }],
      })
    ).toBe(false);
  });
  it('项目通配与队伍通配分属不同授权条目时不能组合提升权限', () => {
    expect(
      canManageGlobalPhysicalReferences('DMD', {
        ...globalPermissions,
        teams: [
          { project: '*', team: '测试队' },
          { project: 'ROWING', team: '*' },
        ],
      })
    ).toBe(false);
  });
  it('缺少授权范围时拒绝修改', () => {
    expect(canManageGlobalPhysicalReferences('DMD', { projects: [], areas: [], teams: [] })).toBe(
      false
    );
  });
});

describe('冠军数值快捷编辑权限', () => {
  it.each(['SCC', 'REG', 'TD', 'DMD'])('%s仅可维护授权项目冠军值', (role) => {
    expect(canEditPhysicalChampionValues(role, { projects: ['ROWING'] }, 'ROWING')).toBe(true);
    expect(canEditPhysicalChampionValues(role, { projects: ['ROWING'] }, 'VOLLEYBALL')).toBe(false);
    expect(canEditPhysicalChampionValues(role, { projects: [] }, 'ROWING')).toBe(false);
  });
  it('运动员和未知角色即使具有项目通配也只读', () => {
    expect(canEditPhysicalChampionValues('ATL', { projects: ['*'] }, 'ROWING')).toBe(false);
    expect(canEditPhysicalChampionValues('COACH', { projects: ['*'] }, 'ROWING')).toBe(false);
  });
});
