import { expect, it } from 'vitest';
import { ROLES, ROLE_META, ROLE_HIERARCHY, canManageRole } from './access.js';

it('保留内部角色等级，特邀观察员仅由管理角色管理', () => {
  expect(ROLES).toEqual(['OBS', 'ATL', 'SCC', 'REG', 'TD', 'DMD']);
  expect(ROLE_META.REG.label).toBe('业务负责人');
  expect(ROLE_HIERARCHY).toEqual([['DMD'], ['TD'], ['REG'], ['SCC'], ['ATL', 'OBS']]);
  expect(canManageRole('REG', 'SCC')).toBe(true);
  expect(canManageRole('REG', 'ATL')).toBe(true);
  expect(canManageRole('REG', 'REG')).toBe(false);
  expect(canManageRole('REG', 'TD')).toBe(false);
});

it('观察员没有账号管理能力，教练不能创建或管理观察员', () => {
  for (const role of ROLES) expect(canManageRole('OBS', role)).toBe(false);
  expect(canManageRole('SCC', 'OBS')).toBe(false);
  expect(canManageRole('ATL', 'OBS')).toBe(false);
  for (const manager of ['REG', 'TD', 'DMD'] as const) {
    expect(canManageRole(manager, 'OBS')).toBe(true);
  }
});
