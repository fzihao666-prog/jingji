import { describe, expect, it } from 'vitest';
import { dataImportPersonKey, normalizeImportPersonName, importPersonNeedsConfirmation } from './data-import-person.js';

describe('导入人员稳定标识', () => {
  it('优先使用服务端身份标识，同名不同队不会合并', () => {
    expect(dataImportPersonKey({ rawAthleteName: '张某', payload: { personKey: '张某|A队' } })).toBe('张某|A队');
    expect(dataImportPersonKey({ rawAthleteName: '张某', payload: { personKey: '张某|B队' } })).toBe('张某|B队');
  });
  it('旧草稿仅规范姓名，不自动推断队伍或关联编号', () => {
    expect(dataImportPersonKey({ rawAthleteName: ' 张 某 ', payload: {} })).toBe('张某');
    expect(normalizeImportPersonName('Ａ·⾬')).toBe('A雨');
  });
});

it('排除全部业务行后不要求确认人员，保留一行则需要确认', () => {
  const person = { normalizedName: '新队员', status: 'pending', excluded: false, confirmed: false };
  const row = { rawAthleteName: '新队员', payload: {}, itemType: 'wellness', quality: 'valid', resolution: '' };
  expect(importPersonNeedsConfirmation(person, [row])).toBe(true);
  expect(importPersonNeedsConfirmation(person, [{ ...row, resolution: 'skip' }])).toBe(false);
  expect(importPersonNeedsConfirmation(person, [{ ...row, quality: 'skipped' }])).toBe(false);
  expect(importPersonNeedsConfirmation({ ...person, confirmed: true }, [row])).toBe(false);
});
