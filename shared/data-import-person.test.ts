import { describe, expect, it } from 'vitest';
import { automaticImportPersonLinks } from './data-import-person.js';
const athletes = [{ id: 1, name: '张某', project: '赛艇', team: 'A队' }];
const candidate = { id: 10, name: '张某', project: '赛艇', team: '旧队伍', status: 'pending', excluded: false, matchedAthleteId: null, suggested: [{ id: 1, name: '张某' }] };
describe('打开导入草稿自动关联', () => {
  it('旧草稿的唯一同名运动员自动关联，不要求再次选择队伍', () => {
    expect(automaticImportPersonLinks([candidate], athletes).get(10)).toBe(1);
  });
  it('首次创建没有已有人员可关联', () => {
    expect(automaticImportPersonLinks([{ ...candidate, name: '新队员', suggested: [] }], athletes).size).toBe(0);
  });
  it('同名多人、冲突编号、已排除与同批不同身份不自动合并', () => {
    expect(automaticImportPersonLinks([candidate], [...athletes, { ...athletes[0], id: 2, team: 'B队' }]).size).toBe(0);
    expect(automaticImportPersonLinks([{ ...candidate, suggested: [{ id: 2, name: '另一人' }] }], athletes).size).toBe(0);
    expect(automaticImportPersonLinks([{ ...candidate, excluded: true }], athletes).size).toBe(0);
    expect(automaticImportPersonLinks([candidate, { ...candidate, id: 11 }], athletes).size).toBe(0);
  });
  it('同名不同队时由相同队伍唯一匹配', () => {
    expect(automaticImportPersonLinks([{ ...candidate, team: 'A队' }], [...athletes, { ...athletes[0], id: 2, team: 'B队' }]).get(10)).toBe(1);
  });
});
