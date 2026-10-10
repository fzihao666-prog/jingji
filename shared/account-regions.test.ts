import { describe, expect, it } from 'vitest';
import { getAccountCities, getAccountCounties, validateAccountAreas } from './account-regions.js';
import snapshot from './region-data/mca-2025-with-2026-updates.json' with { type: 'json' };

describe('账号省市区县字典', () => {
  it('省市县代码为唯一六位码', () => {
    expect(new Set(snapshot.map(([code]) => code)).size).toBe(snapshot.length);
    expect(snapshot.every(([code]) => /^\d{6}$/.test(String(code)))).toBe(true);
  });
  it('普通城市按所属省市筛选区县', () => {
    expect(getAccountCities('四川')).toContain('成都市');
    expect(getAccountCounties('四川', '成都市')).toContainEqual({ name: '武侯区', code: '510107' });
    expect(getAccountCounties('四川', '杭州市')).toEqual([]);
    expect(getAccountCounties('四川', '成都市').some((county) => county.name === '西湖区')).toBe(
      false
    );
  });
  it('直辖市包含现行区县，废止区县不作为新候选', () => {
    expect(getAccountCities('重庆')).toEqual(['重庆市']);
    const counties = getAccountCounties('重庆', '重庆市');
    expect(counties).toContainEqual({ name: '两江新区', code: '500157' });
    expect(counties.some((county) => ['江北区', '渝北区'].includes(county.name))).toBe(false);
    expect(getAccountCounties('北京', '北京市')).toContainEqual({ name: '东城区', code: '110101' });
  });
  it('省直辖县级单位按既有汇总名称分组且不混入地级市区县', () => {
    const city = getAccountCities('河南').find((name) => name.includes('直辖县级'))!;
    expect(getAccountCounties('河南', city)).toContainEqual({ name: '济源市', code: '419001' });
    expect(getAccountCounties('河南', city).some((county) => county.name === '中原区')).toBe(false);
  });
  it('包含已核对的2026增量', () => {
    expect(getAccountCounties('新疆', '喀什地区')).toContainEqual({
      name: '岑岭县',
      code: '653132',
    });
    const direct = getAccountCities('新疆').find((name) => name.includes('直辖县级'))!;
    expect(getAccountCounties('新疆', direct)).toContainEqual({ name: '草湖市', code: '659013' });
  });
  it.each([
    ['广东', '东莞市', '441900'],
    ['广东', '中山市', '442000'],
    ['海南', '儋州市', '460400'],
    ['甘肃', '嘉峪关市', '620200'],
  ])('不设区城市 %s %s 使用实际市码，不伪造县码', (province, city, code) => {
    expect(getAccountCounties(province, city)).toEqual([{ name: city, code, wholeCity: true }]);
  });
  it('空值与未知省份不产生候选', () => {
    expect(getAccountCities('')).toEqual([]);
    expect(getAccountCities('无效省')).toEqual([]);
    expect(getAccountCounties('四川', '')).toEqual([]);
  });
  it('港澳台没有可靠区县数据时明确返回空候选', () => {
    for (const province of ['香港', '澳门', '台湾']) {
      const city = getAccountCities(province)[0];
      expect(city).toBeTruthy();
      expect(getAccountCounties(province, city)).toEqual([]);
    }
  });
  it('拒绝错误的省市区县组合，允许完全相同的历史范围原样保留', () => {
    const area = {
      areaLevel: 'county' as const,
      province: '四川',
      city: '成都市',
      county: '武侯区',
    };
    expect(validateAccountAreas([area])).toBe('');
    expect(validateAccountAreas([{ ...area, city: '杭州市' }])).not.toBe('');
    const legacy = { ...area, province: '重庆', city: '重庆市', county: '渝北区' };
    expect(validateAccountAreas([legacy])).not.toBe('');
    expect(validateAccountAreas([legacy], [legacy])).toBe('');
    expect(validateAccountAreas([{ ...legacy, city: '其他城市' }], [legacy])).not.toBe('');
  });
});
