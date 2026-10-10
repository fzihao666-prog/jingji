import { expect, it } from 'vitest';
import { ROLES, ROLE_META, ROLE_HIERARCHY, canManageRole } from './access.js';

it('仅提供五级五角色，业务负责人按范围管理下级且不能管理同级', () => {
  expect(ROLES).toEqual(['ATL', 'SCC', 'REG', 'TD', 'DMD']);
  expect(ROLE_META.REG.label).toBe('业务负责人');
  expect(ROLE_HIERARCHY).toEqual([['DMD'], ['TD'], ['REG'], ['SCC'], ['ATL']]);
  expect(canManageRole('REG', 'SCC')).toBe(true);
  expect(canManageRole('REG', 'ATL')).toBe(true);
  expect(canManageRole('REG', 'REG')).toBe(false);
  expect(canManageRole('REG', 'TD')).toBe(false);
});
