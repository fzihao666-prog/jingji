import { describe, expect, it } from 'vitest';
import { canManageGlobalPhysicalReferences } from './physical-champion-policy.js';

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
